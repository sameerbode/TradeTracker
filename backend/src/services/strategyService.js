import { getDb } from '../db/database.js';
import { getDisplaySymbol } from '../utils/optionParser.js';

/**
 * Get all strategies with their trades and calculated P&L
 */
export function getAllStrategies() {
    const db = getDb();

    const strategies = db.prepare(`
        SELECT s.*,
               GROUP_CONCAT(st.trade_id) as trade_ids
        FROM strategies s
        LEFT JOIN strategy_trades st ON s.id = st.strategy_id
        GROUP BY s.id
        ORDER BY s.created_at DESC
    `).all();

    return strategies.map(strategy => {
        const tradeIds = strategy.trade_ids
            ? strategy.trade_ids.split(',').map(id => parseInt(id))
            : [];

        // Get full trade details
        const trades = tradeIds.length > 0
            ? db.prepare(`
                SELECT t.*, a.broker
                FROM trades t
                JOIN accounts a ON t.account_id = a.id
                WHERE t.id IN (${tradeIds.join(',')})
                ORDER BY t.executed_at ASC
            `).all()
            : [];

        // Calculate strategy metrics
        const metrics = calculateStrategyMetrics(trades);

        return {
            id: strategy.id,
            name: strategy.name,
            notes: strategy.notes,
            created_at: strategy.created_at,
            tradeIds,
            trades: trades.map(t => ({
                id: t.id,
                symbol: t.symbol,
                displaySymbol: getDisplaySymbol(t.symbol, t.asset_type),
                asset_type: t.asset_type,
                side: t.side,
                quantity: t.quantity,
                price: t.price,
                total: t.total,
                executed_at: t.executed_at,
                expiration_date: t.expiration_date,
                expired_worthless: t.expired_worthless,
                broker: t.broker,
            })),
            ...metrics,
        };
    });
}

/**
 * Check if an option has expired
 */
function isOptionExpired(trade) {
    if (trade.asset_type !== 'option') return false;

    const expDate = trade.expiration_date;
    if (!expDate) return false;

    const exp = new Date(expDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const expDateOnly = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());

    return expDateOnly < today;
}

/**
 * Calculate P&L and other metrics for a set of trades
 * Only marks legs as expired if user has manually marked them via expired_worthless flag
 */
function calculateStrategyMetrics(trades) {
    if (trades.length === 0) {
        return {
            totalBuy: 0,
            totalSell: 0,
            pnl: null,
            pnlPercent: null,
            status: 'empty',
            symbols: [],
            legs: 0,
            expiredLegs: [],
            pendingExpiryLegs: [],
            reviewStatus: 0,
        };
    }

    // Group trades by contract (symbol)
    const contractMap = {};
    for (const trade of trades) {
        if (!contractMap[trade.symbol]) {
            contractMap[trade.symbol] = {
                symbol: trade.symbol,
                displaySymbol: getDisplaySymbol(trade.symbol, trade.asset_type),
                asset_type: trade.asset_type,
                expiration_date: trade.expiration_date,
                buys: [],
                sells: [],
                buyQty: 0,
                sellQty: 0,
                buyTotal: 0,
                sellTotal: 0,
                tradeIds: [],
                hasManuallyExpired: false,
            };
        }
        const contract = contractMap[trade.symbol];
        contract.tradeIds.push(trade.id);

        // Check if any trade in this contract is manually marked as expired
        if (trade.expired_worthless) {
            contract.hasManuallyExpired = true;
        }

        if (trade.side === 'buy') {
            contract.buys.push(trade);
            contract.buyQty += trade.quantity;
            contract.buyTotal += trade.total;
        } else {
            contract.sells.push(trade);
            contract.sellQty += trade.quantity;
            contract.sellTotal += trade.total;
        }
    }

    let totalBuy = 0;
    let totalSell = 0;
    let allBalancedOrExpired = true;
    const symbols = new Set();
    const expiredLegs = [];      // Manually marked as expired
    const pendingExpiryLegs = []; // Past expiry but not yet marked

    for (const symbol of Object.keys(contractMap)) {
        const contract = contractMap[symbol];
        symbols.add(contract.displaySymbol);

        totalBuy += contract.buyTotal;
        totalSell += contract.sellTotal;

        const netQty = contract.buyQty - contract.sellQty;
        const isBalanced = netQty === 0;

        if (!isBalanced) {
            const isPastExpiry = contract.asset_type === 'option' &&
                contract.expiration_date &&
                isOptionExpired(contract);

            if (contract.hasManuallyExpired) {
                // User has manually marked this as expired - calculate P&L
                if (netQty > 0) {
                    // Long position expired worthless - loss
                    const remainingCost = (netQty / contract.buyQty) * contract.buyTotal;
                    expiredLegs.push({
                        symbol: contract.symbol,
                        displaySymbol: contract.displaySymbol,
                        type: 'long',
                        quantity: netQty,
                        pnlImpact: -remainingCost,
                        expiration_date: contract.expiration_date,
                        tradeIds: contract.tradeIds,
                    });
                } else {
                    // Short position expired worthless - profit (keep premium)
                    const remainingCredit = (Math.abs(netQty) / contract.sellQty) * contract.sellTotal;
                    expiredLegs.push({
                        symbol: contract.symbol,
                        displaySymbol: contract.displaySymbol,
                        type: 'short',
                        quantity: Math.abs(netQty),
                        pnlImpact: remainingCredit,
                        expiration_date: contract.expiration_date,
                        tradeIds: contract.tradeIds,
                    });
                }
            } else if (isPastExpiry) {
                // Past expiry but NOT manually marked - pending action
                pendingExpiryLegs.push({
                    symbol: contract.symbol,
                    displaySymbol: contract.displaySymbol,
                    type: netQty > 0 ? 'long' : 'short',
                    quantity: Math.abs(netQty),
                    expiration_date: contract.expiration_date,
                    tradeIds: contract.tradeIds,
                });
                allBalancedOrExpired = false; // Still needs action
            } else {
                // Unbalanced and not expired - still open
                allBalancedOrExpired = false;
            }
        }
    }

    // Calculate P&L
    let pnl = null;
    let pnlPercent = null;
    let status = 'open';

    if (allBalancedOrExpired && pendingExpiryLegs.length === 0) {
        // Start with P&L from balanced (closed) legs only
        pnl = totalSell - totalBuy;
        // Expired legs' cost is already included in totalBuy/totalSell above,
        // so we do NOT add pnlImpact again — it would double-count
        pnlPercent = totalBuy > 0 ? (pnl / totalBuy) * 100 : null;
        status = expiredLegs.length > 0 ? 'expired' : 'closed';
    } else if (pendingExpiryLegs.length > 0) {
        status = 'pending_expiry';
    }

    // Get aggregate review status (max of all trades: 0=none, 1=reviewing, 2=reviewed)
    const reviewStatus = Math.max(...trades.map(t => t.review || 0));

    return {
        totalBuy,
        totalSell,
        pnl,
        pnlPercent,
        status,
        symbols: Array.from(symbols),
        legs: trades.length,
        expiredLegs,
        pendingExpiryLegs,
        hasExpiredLegs: expiredLegs.length > 0,
        hasPendingExpiry: pendingExpiryLegs.length > 0,
        reviewStatus,
    };
}

/**
 * Create a new strategy
 */
export function createStrategy(name, tradeIds = [], notes = '') {
    const db = getDb();

    const result = db.prepare(`
        INSERT INTO strategies (name, notes)
        VALUES (?, ?)
    `).run(name, notes);

    const strategyId = result.lastInsertRowid;

    // Add trades to strategy
    if (tradeIds.length > 0) {
        const insert = db.prepare(`
            INSERT OR IGNORE INTO strategy_trades (strategy_id, trade_id)
            VALUES (?, ?)
        `);

        for (const tradeId of tradeIds) {
            insert.run(strategyId, tradeId);
        }
    }

    return { id: strategyId, name, notes };
}

/**
 * Update strategy name or notes
 */
export function updateStrategy(id, { name, notes }) {
    const db = getDb();

    const updates = [];
    const params = [];

    if (name !== undefined) {
        updates.push('name = ?');
        params.push(name);
    }
    if (notes !== undefined) {
        updates.push('notes = ?');
        params.push(notes);
    }

    if (updates.length === 0) {
        return null;
    }

    params.push(id);
    const result = db.prepare(`
        UPDATE strategies SET ${updates.join(', ')} WHERE id = ?
    `).run(...params);

    return result.changes > 0;
}

/**
 * Delete a strategy
 */
export function deleteStrategy(id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM strategies WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Add trades to a strategy
 */
export function addTradesToStrategy(strategyId, tradeIds) {
    const db = getDb();

    const insert = db.prepare(`
        INSERT OR IGNORE INTO strategy_trades (strategy_id, trade_id)
        VALUES (?, ?)
    `);

    let added = 0;
    for (const tradeId of tradeIds) {
        const result = insert.run(strategyId, tradeId);
        if (result.changes > 0) added++;
    }

    return { added };
}

/**
 * Remove trades from a strategy
 */
export function removeTradesFromStrategy(strategyId, tradeIds) {
    const db = getDb();

    const placeholders = tradeIds.map(() => '?').join(',');
    const result = db.prepare(`
        DELETE FROM strategy_trades
        WHERE strategy_id = ? AND trade_id IN (${placeholders})
    `).run(strategyId, ...tradeIds);

    return { removed: result.changes };
}

/**
 * Get trade IDs that are already in strategies
 */
export function getGroupedTradeIds() {
    const db = getDb();
    const rows = db.prepare('SELECT DISTINCT trade_id FROM strategy_trades').all();
    return rows.map(r => r.trade_id);
}

/**
 * Merge multiple strategies into one
 */
export function mergeStrategies(strategyIds, newName) {
    const db = getDb();

    // Get all trade IDs from strategies being merged
    const placeholders = strategyIds.map(() => '?').join(',');
    const trades = db.prepare(`
        SELECT DISTINCT trade_id FROM strategy_trades
        WHERE strategy_id IN (${placeholders})
    `).all(...strategyIds);

    const tradeIds = trades.map(t => t.trade_id);

    // Create new strategy with all trades
    const newStrategy = createStrategy(newName, tradeIds);

    // Delete old strategies
    db.prepare(`DELETE FROM strategies WHERE id IN (${placeholders})`).run(...strategyIds);

    return newStrategy;
}
