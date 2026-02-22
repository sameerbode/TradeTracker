import { getDb, withTransaction } from '../db/database.js';
import { getDisplaySymbol } from '../utils/optionParser.js';
import { checkOptionExpiration, getGroupingKey, getOptionInfo, getReviewStatus } from '../utils/tradeUtils.js';

/**
 * Check if an option has expired (for strategy metrics)
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
 * Calculate P&L and metrics for a set of trades (reused from old strategyService)
 */
export function calculatePositionMetrics(trades) {
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
    const expiredLegs = [];
    const pendingExpiryLegs = [];

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
                if (netQty > 0) {
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
                pendingExpiryLegs.push({
                    symbol: contract.symbol,
                    displaySymbol: contract.displaySymbol,
                    type: netQty > 0 ? 'long' : 'short',
                    quantity: Math.abs(netQty),
                    expiration_date: contract.expiration_date,
                    tradeIds: contract.tradeIds,
                });
                allBalancedOrExpired = false;
            } else {
                allBalancedOrExpired = false;
            }
        }
    }

    let pnl = null;
    let pnlPercent = null;
    let status = 'open';

    if (allBalancedOrExpired && pendingExpiryLegs.length === 0) {
        pnl = totalSell - totalBuy;
        pnlPercent = totalBuy > 0 ? (pnl / totalBuy) * 100 : null;
        status = expiredLegs.length > 0 ? 'expired' : 'closed';
    } else if (pendingExpiryLegs.length > 0) {
        status = 'pending_expiry';
    }

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
 * Compute round trips from a set of trades (pure function).
 * Used for computing simple (white) positions.
 * Returns array of { tradeIds, status } objects.
 */
export function computeRoundTrips(trades) {
    // Group trades by symbol AND asset_type AND account_id (broker)
    // This ensures trades from different brokers don't get mixed
    const tradesByKey = {};
    for (const trade of trades) {
        const key = `${trade.symbol}_${trade.asset_type}_${trade.account_id}`;
        if (!tradesByKey[key]) {
            tradesByKey[key] = [];
        }
        tradesByKey[key].push(trade);
    }

    const positions = [];

    for (const key of Object.keys(tradesByKey)) {
        const symbolTrades = tradesByKey[key];
        const asset_type = symbolTrades[0].asset_type;

        let currentTrip = {
            tradeIds: [],
            buyQty: 0,
            sellQty: 0,
        };

        for (const trade of symbolTrades) {
            currentTrip.tradeIds.push(trade.id);
            if (trade.side === 'buy') {
                currentTrip.buyQty += trade.quantity;
            } else {
                currentTrip.sellQty += trade.quantity;
            }

            if (currentTrip.buyQty === currentTrip.sellQty && currentTrip.buyQty > 0) {
                let status = 'closed';
                if (asset_type === 'option') {
                    const hasExpired = symbolTrades.some(t =>
                        currentTrip.tradeIds.includes(t.id) && t.expired_worthless
                    );
                    if (hasExpired) status = 'expired';
                }
                positions.push({ tradeIds: [...currentTrip.tradeIds], status });
                currentTrip = { tradeIds: [], buyQty: 0, sellQty: 0 };
            }
        }

        if (currentTrip.tradeIds.length > 0) {
            let status = 'open';
            if (asset_type === 'option') {
                const expDate = symbolTrades[0].expiration_date;
                if (expDate) {
                    const exp = new Date(expDate);
                    const now = new Date();
                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const expOnly = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
                    const hasManualExpiry = currentTrip.tradeIds.some(id => {
                        const t = symbolTrades.find(t => t.id === id);
                        return t?.expired_worthless;
                    });
                    if (hasManualExpiry) {
                        status = 'expired';
                    } else if (expOnly < today) {
                        status = 'pending_expiry';
                    }
                }
            }
            positions.push({ tradeIds: [...currentTrip.tradeIds], status });
        }
    }

    return positions;
}

/**
 * Get all positions with their trades and calculated metrics.
 * This is the single source of truth - replaces both getAllStrategies and getRoundTripPositions.
 */
export function getAllPositions() {
    const db = getDb();

    const positions = db.prepare(`
        SELECT p.*,
               GROUP_CONCAT(pt.trade_id) as trade_ids
        FROM positions p
        LEFT JOIN position_trades pt ON p.id = pt.position_id
        GROUP BY p.id
        ORDER BY p.created_at DESC
    `).all();

    return positions.map(position => {
        const tradeIds = position.trade_ids
            ? position.trade_ids.split(',').map(id => parseInt(id))
            : [];

        const trades = tradeIds.length > 0
            ? db.prepare(`
                SELECT t.*, a.broker
                FROM trades t
                JOIN accounts a ON t.account_id = a.id
                WHERE t.id IN (${tradeIds.join(',')})
                ORDER BY t.executed_at ASC
            `).all()
            : [];

        const metrics = calculatePositionMetrics(trades);

        // Determine if this is a "multi-leg" (user-grouped) position
        // Multi-leg = has a name (user named it) or has trades with multiple distinct symbols
        const isMultiLeg = !!position.name || metrics.symbols.length > 1;

        // For simple positions, compute round-trip display data
        let displayData = {};
        if (!isMultiLeg && trades.length > 0) {
            const asset_type = trades[0].asset_type;
            const symbol = trades[0].symbol;
            const buyTrades = trades.filter(t => t.side === 'buy');
            const sellTrades = trades.filter(t => t.side === 'sell');
            const buyQty = buyTrades.reduce((sum, t) => sum + t.quantity, 0);
            const sellQty = sellTrades.reduce((sum, t) => sum + t.quantity, 0);
            const netQty = buyQty - sellQty;

            displayData = {
                symbol,
                displaySymbol: getDisplaySymbol(symbol, asset_type),
                asset_type,
                quantity: netQty !== 0 ? netQty : buyQty,
                buyDate: buyTrades[0]?.executed_at || null,
                sellDate: sellTrades[sellTrades.length - 1]?.executed_at || null,
                expirationDate: trades[0]?.expiration_date || null,
                broker: trades[0]?.broker || null,
            };
        }

        return {
            id: position.id,
            name: position.name,
            notes: position.notes,
            why: position.why,
            created_at: position.created_at,
            isMultiLeg,
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
                review: t.review,
            })),
            ...displayData,
            ...metrics,
        };
    });
}

/**
 * Create a new position (grouped / multi-leg)
 */
export function createPosition(name, tradeIds = [], notes = '') {
    const db = getDb();

    // Remove these trades from existing positions first
    if (tradeIds.length > 0) {
        const placeholders = tradeIds.map(() => '?').join(',');
        // Find positions that will lose trades
        const affectedPositionIds = db.prepare(`
            SELECT DISTINCT position_id FROM position_trades
            WHERE trade_id IN (${placeholders})
        `).all(...tradeIds).map(r => r.position_id);

        // Remove trade links
        db.prepare(`DELETE FROM position_trades WHERE trade_id IN (${placeholders})`).run(...tradeIds);

        // Delete positions that now have no trades (orphaned)
        for (const posId of affectedPositionIds) {
            const remaining = db.prepare('SELECT COUNT(*) as cnt FROM position_trades WHERE position_id = ?').get(posId).cnt;
            if (remaining === 0) {
                db.prepare('DELETE FROM positions WHERE id = ?').run(posId);
            }
        }
    }

    const result = db.prepare(`
        INSERT INTO positions (name, notes, status)
        VALUES (?, ?, 'open')
    `).run(name, notes);

    const positionId = result.lastInsertRowid;

    if (tradeIds.length > 0) {
        const insert = db.prepare(`
            INSERT OR IGNORE INTO position_trades (position_id, trade_id)
            VALUES (?, ?)
        `);
        for (const tradeId of tradeIds) {
            insert.run(positionId, tradeId);
        }
    }

    return { id: positionId, name, notes };
}

/**
 * Update position name, notes, or why
 */
export function updatePosition(id, { name, notes, why }) {
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
    if (why !== undefined) {
        updates.push('why = ?');
        params.push(why);
    }

    if (updates.length === 0) return null;

    params.push(id);
    const result = db.prepare(`
        UPDATE positions SET ${updates.join(', ')} WHERE id = ?
    `).run(...params);

    return result.changes > 0;
}

/**
 * Delete a position
 */
export function deletePosition(id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM positions WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Add trades to a position
 */
export function addTradesToPosition(positionId, tradeIds) {
    const db = getDb();

    // Remove these trades from their current positions first
    if (tradeIds.length > 0) {
        const placeholders = tradeIds.map(() => '?').join(',');
        const affectedPositionIds = db.prepare(`
            SELECT DISTINCT position_id FROM position_trades
            WHERE trade_id IN (${placeholders})
        `).all(...tradeIds).map(r => r.position_id);

        db.prepare(`DELETE FROM position_trades WHERE trade_id IN (${placeholders})`).run(...tradeIds);

        // Delete positions that now have no trades
        for (const posId of affectedPositionIds) {
            if (posId === positionId) continue; // Don't delete the target position
            const remaining = db.prepare('SELECT COUNT(*) as cnt FROM position_trades WHERE position_id = ?').get(posId).cnt;
            if (remaining === 0) {
                db.prepare('DELETE FROM positions WHERE id = ?').run(posId);
            }
        }
    }

    const insert = db.prepare(`
        INSERT OR IGNORE INTO position_trades (position_id, trade_id)
        VALUES (?, ?)
    `);

    let added = 0;
    for (const tradeId of tradeIds) {
        const result = insert.run(positionId, tradeId);
        if (result.changes > 0) added++;
    }

    return { added };
}

/**
 * Remove trades from a position
 */
export function removeTradesFromPosition(positionId, tradeIds) {
    const db = getDb();

    const placeholders = tradeIds.map(() => '?').join(',');
    const result = db.prepare(`
        DELETE FROM position_trades
        WHERE position_id = ? AND trade_id IN (${placeholders})
    `).run(positionId, ...tradeIds);

    return { removed: result.changes };
}

/**
 * Ungroup a position - split it back into individual round-trip positions.
 * Deletes the grouped position and creates new positions from its trades.
 */
export function ungroupPosition(id) {
    const db = getDb();

    // Get the position's trades
    const tradeIds = db.prepare('SELECT trade_id FROM position_trades WHERE position_id = ?')
        .all(id).map(r => r.trade_id);

    if (tradeIds.length === 0) {
        deletePosition(id);
        return { created: 0 };
    }

    // Get full trade data
    const placeholders = tradeIds.map(() => '?').join(',');
    const trades = db.prepare(`
        SELECT t.* FROM trades t
        WHERE t.id IN (${placeholders})
        ORDER BY t.executed_at ASC, CASE WHEN t.side = 'buy' THEN 0 ELSE 1 END ASC
    `).all(...tradeIds);

    // Compute round trips
    const roundTrips = computeRoundTrips(trades);

    // Delete the original position
    db.prepare('DELETE FROM positions WHERE id = ?').run(id);

    // Create new positions from round trips
    const insertPosition = db.prepare(`
        INSERT INTO positions (name, status, created_at)
        VALUES (?, ?, datetime('now'))
    `);
    const insertPT = db.prepare(`
        INSERT OR IGNORE INTO position_trades (position_id, trade_id)
        VALUES (?, ?)
    `);

    let created = 0;
    for (const rt of roundTrips) {
        const result = insertPosition.run(null, rt.status);
        const posId = result.lastInsertRowid;
        for (const tid of rt.tradeIds) {
            insertPT.run(posId, tid);
        }
        created++;
    }

    return { created };
}

/**
 * Merge multiple positions into one
 */
export function mergePositions(positionIds, newName) {
    const db = getDb();

    const placeholders = positionIds.map(() => '?').join(',');
    const trades = db.prepare(`
        SELECT DISTINCT trade_id FROM position_trades
        WHERE position_id IN (${placeholders})
    `).all(...positionIds);

    const tradeIds = trades.map(t => t.trade_id);

    // Create new position with all trades
    const newPosition = createPosition(newName, tradeIds);

    // Delete old positions (their trade links were already removed by createPosition)
    db.prepare(`DELETE FROM positions WHERE id IN (${placeholders})`).run(...positionIds);

    return newPosition;
}

/**
 * Compute and persist positions for all trades (or unclaimed trades).
 * Used during migration and for recompute-all.
 */
export function computeAndPersistAllPositions(excludeTradeIds = new Set()) {
    const db = getDb();

    // Get all trades not excluded
    const allTrades = db.prepare(`
        SELECT t.* FROM trades t
        ORDER BY t.executed_at ASC, CASE WHEN t.side = 'buy' THEN 0 ELSE 1 END ASC
    `).all();

    const trades = allTrades.filter(t => !excludeTradeIds.has(t.id));
    if (trades.length === 0) return { created: 0 };

    const roundTrips = computeRoundTrips(trades);

    const insertPosition = db.prepare(`
        INSERT INTO positions (name, status, created_at)
        VALUES (?, ?, datetime('now'))
    `);
    const insertPT = db.prepare(`
        INSERT OR IGNORE INTO position_trades (position_id, trade_id)
        VALUES (?, ?)
    `);

    let created = 0;
    for (const rt of roundTrips) {
        const result = insertPosition.run(null, rt.status);
        const posId = result.lastInsertRowid;
        for (const tid of rt.tradeIds) {
            insertPT.run(posId, tid);
        }
        created++;
    }

    return { created };
}

/**
 * Recompute positions after new trades are imported.
 * Finds positions whose symbols overlap with imported trades, deletes and recomputes them.
 */
export function recomputePositionsAfterImport(importedTradeIds) {
    const db = getDb();

    if (!importedTradeIds || importedTradeIds.length === 0) return { recomputed: 0 };

    // Get symbols of imported trades WITH broker info (via account_id)
    const placeholders = importedTradeIds.map(() => '?').join(',');
    const importedSymbols = db.prepare(`
        SELECT DISTINCT t.symbol, t.asset_type, t.account_id, a.broker 
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.id IN (${placeholders})
    `).all(...importedTradeIds);

    if (importedSymbols.length === 0) return { recomputed: 0 };

    // Find all simple (unnamed) positions that share symbols with imported trades
    // Leave user-named (multi-leg) positions alone
    // KEY: Include broker/account_id to keep different brokers separate
    const symbolKeys = importedSymbols.map(s => `${s.symbol}_${s.asset_type}_${s.account_id}`);

    // Get all simple position IDs that contain trades with affected symbols
    const allSimplePositions = db.prepare(`
        SELECT DISTINCT p.id as position_id
        FROM positions p
        JOIN position_trades pt ON p.id = pt.position_id
        JOIN trades t ON pt.trade_id = t.id
        WHERE p.name IS NULL
    `).all();

    const positionsToRecompute = [];
    for (const { position_id } of allSimplePositions) {
        const posTrades = db.prepare(`
            SELECT t.symbol, t.asset_type, t.account_id FROM trades t
            JOIN position_trades pt ON t.id = pt.trade_id
            WHERE pt.position_id = ?
        `).all(position_id);

        const posKeys = posTrades.map(t => `${t.symbol}_${t.asset_type}_${t.account_id}`);
        if (posKeys.some(k => symbolKeys.includes(k))) {
            positionsToRecompute.push(position_id);
        }
    }

    if (positionsToRecompute.length === 0) {
        // No existing positions to recompute, just create new ones for imported trades
        // Get all trades for affected symbols that aren't in named positions
        const namedPositionTradeIds = new Set(
            db.prepare(`
                SELECT pt.trade_id FROM position_trades pt
                JOIN positions p ON pt.position_id = p.id
                WHERE p.name IS NOT NULL
            `).all().map(r => r.trade_id)
        );

        // Get all unclaimed imported trade IDs
        const unclaimedImported = importedTradeIds.filter(id => !namedPositionTradeIds.has(id));
        if (unclaimedImported.length === 0) return { recomputed: 0 };

        // Get full trade data for these
        const ph2 = unclaimedImported.map(() => '?').join(',');
        const trades = db.prepare(`
            SELECT t.* FROM trades t
            WHERE t.id IN (${ph2})
            ORDER BY t.executed_at ASC, CASE WHEN t.side = 'buy' THEN 0 ELSE 1 END ASC
        `).all(...unclaimedImported);

        const roundTrips = computeRoundTrips(trades);
        const insertPosition = db.prepare(`
            INSERT INTO positions (name, status, created_at)
            VALUES (?, ?, datetime('now'))
        `);
        const insertPT = db.prepare(`
            INSERT OR IGNORE INTO position_trades (position_id, trade_id)
            VALUES (?, ?)
        `);

        for (const rt of roundTrips) {
            const result = insertPosition.run(null, rt.status);
            const posId = result.lastInsertRowid;
            for (const tid of rt.tradeIds) {
                insertPT.run(posId, tid);
            }
        }

        return { recomputed: roundTrips.length };
    }

    // Collect all trade IDs from positions being recomputed
    const recomputePlaceholders = positionsToRecompute.map(() => '?').join(',');
    const affectedTradeIds = db.prepare(`
        SELECT DISTINCT trade_id FROM position_trades
        WHERE position_id IN (${recomputePlaceholders})
    `).all(...positionsToRecompute).map(r => r.trade_id);

    // Also include newly imported trades for the same symbols that aren't in any position
    const allAffectedIds = new Set([...affectedTradeIds, ...importedTradeIds]);

    // Delete old simple positions
    db.prepare(`DELETE FROM positions WHERE id IN (${recomputePlaceholders})`).run(...positionsToRecompute);

    // Get all trades for recomputation (including new ones)
    // IMPORTANT: Group by account_id (broker) to keep different brokers separate
    const allSymbolConditions = importedSymbols.map(() => '(t.symbol = ? AND t.asset_type = ? AND t.account_id = ?)').join(' OR ');
    const symParams = importedSymbols.flatMap(s => [s.symbol, s.asset_type, s.account_id]);

    const tradesForRecompute = db.prepare(`
        SELECT t.* FROM trades t
        WHERE (${allSymbolConditions})
        ORDER BY t.executed_at ASC, CASE WHEN t.side = 'buy' THEN 0 ELSE 1 END ASC
    `).all(...symParams);

    // Filter out trades that are in named positions
    const namedPositionTradeIds = new Set(
        db.prepare(`
            SELECT pt.trade_id FROM position_trades pt
            JOIN positions p ON pt.position_id = p.id
            WHERE p.name IS NOT NULL
        `).all().map(r => r.trade_id)
    );

    const unclaimedTrades = tradesForRecompute.filter(t => !namedPositionTradeIds.has(t.id));

    // Recompute round trips
    const roundTrips = computeRoundTrips(unclaimedTrades);

    const insertPosition = db.prepare(`
        INSERT INTO positions (name, status, created_at)
        VALUES (?, ?, datetime('now'))
    `);
    const insertPT = db.prepare(`
        INSERT OR IGNORE INTO position_trades (position_id, trade_id)
        VALUES (?, ?)
    `);

    for (const rt of roundTrips) {
        const result = insertPosition.run(null, rt.status);
        const posId = result.lastInsertRowid;
        for (const tid of rt.tradeIds) {
            insertPT.run(posId, tid);
        }
    }

    return { recomputed: roundTrips.length };
}

/**
 * Force recompute ALL positions from scratch.
 * Preserves named (multi-leg) positions, recomputes simple ones.
 */
export function recomputeAllPositions() {
    const db = getDb();

    // Delete all simple (unnamed) positions
    const simpleIds = db.prepare(`SELECT id FROM positions WHERE name IS NULL`).all().map(r => r.id);
    if (simpleIds.length > 0) {
        const ph = simpleIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM positions WHERE id IN (${ph})`).run(...simpleIds);
    }

    // Get trade IDs in named positions
    const namedTradeIds = new Set(
        db.prepare(`
            SELECT pt.trade_id FROM position_trades pt
            JOIN positions p ON pt.position_id = p.id
            WHERE p.name IS NOT NULL
        `).all().map(r => r.trade_id)
    );

    // Compute positions for unclaimed trades
    return computeAndPersistAllPositions(namedTradeIds);
}

/**
 * Get trade IDs that are in positions (for tally check)
 */
export function getGroupedTradeIds() {
    const db = getDb();
    const rows = db.prepare('SELECT DISTINCT trade_id FROM position_trades').all();
    return rows.map(r => r.trade_id);
}
