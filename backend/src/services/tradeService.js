import { getDb, withTransaction } from '../db/database.js';
import { parseOptionSymbol, getDisplaySymbol } from '../utils/optionParser.js';

/**
 * Check if an option has expired based on stored expiration_date or symbol
 * @returns {object|null} { expired: boolean, expirationDate: Date } or null if not an option
 */
function checkOptionExpiration(symbol, assetType, storedExpirationDate) {
    if (assetType !== 'option') return null;

    let expDate;

    // Use stored expiration date if available
    if (storedExpirationDate) {
        expDate = new Date(storedExpirationDate);
    } else {
        // Fall back to parsing from symbol
        const parsed = parseOptionSymbol(symbol);
        if (!parsed) return null;
        expDate = parsed.expiration;
    }

    const now = new Date();
    // Options expire at market close on expiration day, so compare dates only
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const expDateOnly = new Date(expDate.getFullYear(), expDate.getMonth(), expDate.getDate());

    return {
        expired: expDateOnly < today,
        expirationDate: expDate,
    };
}

/**
 * Generate a grouping key for FIFO matching
 * For options: underlying_expiry_strike_type_option (e.g., "AAPL_2026-01-06_150_C_option")
 * For stocks/futures: symbol_asset_type (e.g., "AAPL_stock")
 */
function getGroupingKey(trade) {
    if (trade.asset_type === 'option') {
        const parsed = parseOptionSymbol(trade.symbol);
        if (parsed) {
            // Format expiration as ISO date for consistent grouping
            const expDateStr = parsed.expiration.toISOString().split('T')[0];
            return `${parsed.underlying}_${expDateStr}_${parsed.strike}_${parsed.typeShort}_option`;
        }
    }
    // Fallback to symbol + asset_type for non-options or unparseable options
    return `${trade.symbol}_${trade.asset_type}`;
}

/**
 * Get parsed option info for display purposes
 */
function getOptionInfo(trade) {
    if (trade.asset_type !== 'option') {
        return null;
    }
    const parsed = parseOptionSymbol(trade.symbol);
    if (!parsed) {
        return null;
    }
    return {
        underlying: parsed.underlying,
        expiry: parsed.expiration,
        strike: parsed.strike,
        type: parsed.type,
        typeShort: parsed.typeShort,
    };
}

/**
 * Get the aggregate review status from multiple trades
 * Returns the highest status: 0=none, 1=reviewing, 2=reviewed
 */
function getReviewStatus(trades) {
    return Math.max(...trades.map(t => t.review || 0));
}

export function getAllTrades(filters = {}) {
    const db = getDb();
    let query = `
        SELECT t.*, a.broker, a.nickname as account_name
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        WHERE 1=1
    `;
    const params = [];

    if (filters.symbol) {
        query += ' AND t.symbol = ?';
        params.push(filters.symbol);
    }
    if (filters.asset_type) {
        query += ' AND t.asset_type = ?';
        params.push(filters.asset_type);
    }
    if (filters.side) {
        query += ' AND t.side = ?';
        params.push(filters.side);
    }
    if (filters.account_id) {
        query += ' AND t.account_id = ?';
        params.push(filters.account_id);
    }
    if (filters.broker) {
        query += ' AND a.broker = ?';
        params.push(filters.broker);
    }
    if (filters.from_date) {
        query += ' AND t.executed_at >= ?';
        params.push(filters.from_date);
    }
    if (filters.to_date) {
        query += ' AND t.executed_at <= ?';
        params.push(filters.to_date);
    }

    query += ' ORDER BY t.executed_at DESC';

    if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
}

export function getTradeById(id) {
    const db = getDb();
    return db.prepare(`
        SELECT t.*, a.broker, a.nickname as account_name
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.id = ?
    `).get(id);
}

export function deleteTrade(id) {
    const db = getDb();
    return db.prepare('DELETE FROM trades WHERE id = ?').run(id);
}

export function deleteAllTrades() {
    const db = getDb();
    // Clear strategy_trades first (foreign key), then strategies, then trades
    db.prepare('DELETE FROM strategy_trades').run();
    db.prepare('DELETE FROM strategies').run();
    return db.prepare('DELETE FROM trades').run();
}

export function toggleTradeReview(id) {
    const db = getDb();
    const result = db.prepare('UPDATE trades SET review = NOT review WHERE id = ?').run(id);
    if (result.changes === 0) {
        return null;
    }
    return db.prepare('SELECT review FROM trades WHERE id = ?').get(id);
}

/**
 * Set review status for trades
 * @param {number[]} ids - Trade IDs
 * @param {number} status - 0=none, 1=reviewing, 2=reviewed
 */
export function setTradesReview(ids, status) {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    // Ensure status is 0, 1, or 2
    const validStatus = [0, 1, 2].includes(status) ? status : 0;
    return db.prepare(`UPDATE trades SET review = ? WHERE id IN (${placeholders})`).run(validStatus, ...ids);
}

export function expireTrades(ids) {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`UPDATE trades SET expired_worthless = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function insertTrades(accountId, trades) {
    const db = getDb();
    const insert = db.prepare(`
        INSERT OR IGNORE INTO trades
        (account_id, broker_trade_id, symbol, asset_type, side, quantity, price, total, fees, executed_at, expiration_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let imported = 0;
    let skipped = 0;

    withTransaction(db, () => {
        for (const trade of trades) {
            const result = insert.run(
                accountId,
                trade.broker_trade_id,
                trade.symbol,
                trade.asset_type,
                trade.side,
                trade.quantity,
                trade.price,
                trade.total,
                trade.fees,
                trade.executed_at,
                trade.expiration_date || null
            );
            if (result.changes > 0) {
                imported++;
            } else {
                skipped++;
            }
        }
    });

    return { imported, skipped };
}

export function getUniqueSymbols() {
    const db = getDb();
    return db.prepare('SELECT DISTINCT symbol FROM trades ORDER BY symbol').all()
        .map(row => row.symbol);
}

/**
 * Get positions/round trips - matched buy and sell trades with P&L
 *
 * For each ticker symbol:
 * 1. Sort all trades by date/time
 * 2. Maintain a running queue of open buys
 * 3. Match sells against the oldest unmatched buys first (FIFO)
 * 4. Track partial fills (if sell qty > one buy, split across multiple buys)
 *
 * For options, matching is done by underlying+expiry+strike+type (not full OCC symbol)
 */
export function getPositions() {
    const db = getDb();
    const trades = db.prepare(`
        SELECT t.*, a.broker
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        ORDER BY t.executed_at ASC
    `).all();

    // Group trades by grouping key (underlying+expiry+strike+type for options)
    const tradesByKey = {};
    for (const trade of trades) {
        const key = getGroupingKey(trade);
        if (!tradesByKey[key]) {
            tradesByKey[key] = [];
        }
        tradesByKey[key].push(trade);
    }

    const positions = [];

    for (const key of Object.keys(tradesByKey)) {
        // Trades already sorted by executed_at ASC from query
        const symbolTrades = tradesByKey[key];
        const symbol = symbolTrades[0].symbol;

        // Queue of open buys and sells with remaining quantity
        const openBuys = [];
        const openSells = []; // For short positions (Sell to Open)

        for (const trade of symbolTrades) {
            if (trade.side === 'buy') {
                // First try to close any open short positions (Buy to Close)
                let buyQtyRemaining = trade.quantity;

                for (const sell of openSells) {
                    if (buyQtyRemaining <= 0) break;
                    if (sell.remainingQty <= 0) continue;

                    // Match as much as possible
                    const matchedQty = Math.min(sell.remainingQty, buyQtyRemaining);
                    const sellTotal = (matchedQty / sell.quantity) * sell.total;
                    const buyTotal = (matchedQty / trade.quantity) * trade.total;
                    const pnl = sellTotal - buyTotal; // Short P&L: sell high, buy low

                    // Create closed short position
                    const positionTrades = [
                        {
                            id: sell.id,
                            symbol: sell.symbol,
                            asset_type: sell.asset_type,
                            side: 'sell',
                            quantity: matchedQty,
                            price: sell.price,
                            total: sellTotal,
                            executed_at: sell.executed_at,
                            expiration_date: sell.expiration_date,
                            review: sell.review,
                        },
                        {
                            id: trade.id,
                            symbol: trade.symbol,
                            asset_type: trade.asset_type,
                            side: 'buy',
                            quantity: matchedQty,
                            price: trade.price,
                            total: buyTotal,
                            executed_at: trade.executed_at,
                            expiration_date: trade.expiration_date,
                            review: trade.review,
                        },
                    ];
                    const optionInfo = getOptionInfo(trade);
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, trade.asset_type),
                        asset_type: trade.asset_type,
                        quantity: -matchedQty, // Negative for short
                        buyPrice: trade.price,
                        sellPrice: sell.price,
                        buyDate: trade.executed_at,
                        sellDate: sell.executed_at,
                        buyTotal,
                        sellTotal,
                        pnl,
                        pnlPercent: sellTotal > 0 ? ((pnl / sellTotal) * 100) : 0,
                        broker: trade.broker,
                        status: 'closed',
                        expirationDate: trade.expiration_date || sell.expiration_date || null,
                        reviewStatus: getReviewStatus(positionTrades),
                        tradeIds: positionTrades.map(t => t.id),
                        trades: positionTrades,
                        // Option-specific fields
                        optionInfo,
                    });

                    sell.remainingQty -= matchedQty;
                    buyQtyRemaining -= matchedQty;
                }

                // Add remaining buy quantity to open buys queue
                if (buyQtyRemaining > 0) {
                    openBuys.push({
                        ...trade,
                        remainingQty: buyQtyRemaining,
                    });
                }
            } else if (trade.side === 'sell') {
                // First try to close any open long positions (Sell to Close)
                let sellQtyRemaining = trade.quantity;

                for (const buy of openBuys) {
                    if (sellQtyRemaining <= 0) break;
                    if (buy.remainingQty <= 0) continue;

                    // Match as much as possible
                    const matchedQty = Math.min(buy.remainingQty, sellQtyRemaining);
                    const buyTotal = (matchedQty / buy.quantity) * buy.total;
                    const sellTotal = (matchedQty / trade.quantity) * trade.total;
                    const pnl = sellTotal - buyTotal;

                    // Create closed position
                    const positionTrades = [
                        {
                            id: buy.id,
                            symbol: buy.symbol,
                            asset_type: buy.asset_type,
                            side: 'buy',
                            quantity: matchedQty,
                            price: buy.price,
                            total: buyTotal,
                            executed_at: buy.executed_at,
                            expiration_date: buy.expiration_date,
                            review: buy.review,
                        },
                        {
                            id: trade.id,
                            symbol: trade.symbol,
                            asset_type: trade.asset_type,
                            side: 'sell',
                            quantity: matchedQty,
                            price: trade.price,
                            total: sellTotal,
                            executed_at: trade.executed_at,
                            expiration_date: trade.expiration_date,
                            review: trade.review,
                        },
                    ];
                    const optionInfo = getOptionInfo(trade);
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, trade.asset_type),
                        asset_type: trade.asset_type,
                        quantity: matchedQty,
                        buyPrice: buy.price,
                        sellPrice: trade.price,
                        buyDate: buy.executed_at,
                        sellDate: trade.executed_at,
                        buyTotal,
                        sellTotal,
                        pnl,
                        pnlPercent: buyTotal > 0 ? ((pnl / buyTotal) * 100) : 0,
                        broker: trade.broker,
                        status: 'closed',
                        expirationDate: trade.expiration_date || buy.expiration_date || null,
                        reviewStatus: getReviewStatus(positionTrades),
                        tradeIds: positionTrades.map(t => t.id),
                        trades: positionTrades,
                        // Option-specific fields
                        optionInfo,
                    });

                    buy.remainingQty -= matchedQty;
                    sellQtyRemaining -= matchedQty;
                }

                // Add remaining sell quantity to open sells queue (short position)
                if (sellQtyRemaining > 0) {
                    openSells.push({
                        ...trade,
                        remainingQty: sellQtyRemaining,
                    });
                }
            }
        }

        // Add open long positions (buys with remaining quantity)
        for (const buy of openBuys) {
            if (buy.remainingQty > 0) {
                const openBuyTotal = (buy.remainingQty / buy.quantity) * buy.total;
                const optionInfo = getOptionInfo(buy);

                // Check if option has expired (use stored expiration_date)
                const expInfo = checkOptionExpiration(symbol, buy.asset_type, buy.expiration_date);
                const isPastExpiry = expInfo?.expired || false;
                const isManuallyExpired = !!buy.expired_worthless;

                if (isManuallyExpired) {
                    // User manually marked as expired - 100% loss for long position
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, buy.asset_type),
                        asset_type: buy.asset_type,
                        quantity: buy.remainingQty,
                        buyPrice: buy.price,
                        sellPrice: 0,
                        buyDate: buy.executed_at,
                        sellDate: expInfo?.expirationDate?.toISOString() || buy.expiration_date,
                        buyTotal: openBuyTotal,
                        sellTotal: 0,
                        pnl: -openBuyTotal,
                        pnlPercent: -100,
                        broker: buy.broker,
                        status: 'expired',
                        expirationDate: buy.expiration_date || null,
                        reviewStatus: buy.review || 0,
                        tradeIds: [buy.id],
                        trades: [
                            {
                                id: buy.id,
                                symbol: buy.symbol,
                                asset_type: buy.asset_type,
                                side: 'buy',
                                quantity: buy.remainingQty,
                                price: buy.price,
                                total: openBuyTotal,
                                executed_at: buy.executed_at,
                                expiration_date: buy.expiration_date,
                                review: buy.review,
                            },
                        ],
                        optionInfo,
                    });
                } else if (isPastExpiry) {
                    // Past expiry but not manually marked - pending_expiry status
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, buy.asset_type),
                        asset_type: buy.asset_type,
                        quantity: buy.remainingQty,
                        buyPrice: buy.price,
                        sellPrice: null,
                        buyDate: buy.executed_at,
                        sellDate: null,
                        buyTotal: openBuyTotal,
                        sellTotal: null,
                        pnl: null, // Not calculated until user confirms
                        pnlPercent: null,
                        broker: buy.broker,
                        status: 'pending_expiry',
                        expirationDate: buy.expiration_date || null,
                        reviewStatus: buy.review || 0,
                        tradeIds: [buy.id],
                        trades: [
                            {
                                id: buy.id,
                                symbol: buy.symbol,
                                asset_type: buy.asset_type,
                                side: 'buy',
                                quantity: buy.remainingQty,
                                price: buy.price,
                                total: openBuyTotal,
                                executed_at: buy.executed_at,
                                expiration_date: buy.expiration_date,
                                review: buy.review,
                            },
                        ],
                        optionInfo,
                    });
                } else {
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, buy.asset_type),
                        asset_type: buy.asset_type,
                        quantity: buy.remainingQty,
                        buyPrice: buy.price,
                        sellPrice: null,
                        buyDate: buy.executed_at,
                        sellDate: null,
                        buyTotal: openBuyTotal,
                        sellTotal: null,
                        pnl: null,
                        pnlPercent: null,
                        broker: buy.broker,
                        status: 'open',
                        expirationDate: buy.expiration_date || null,
                        reviewStatus: buy.review || 0,
                        tradeIds: [buy.id],
                        trades: [
                            {
                                id: buy.id,
                                symbol: buy.symbol,
                                asset_type: buy.asset_type,
                                side: 'buy',
                                quantity: buy.remainingQty,
                                price: buy.price,
                                total: openBuyTotal,
                                executed_at: buy.executed_at,
                                expiration_date: buy.expiration_date,
                                review: buy.review,
                            },
                        ],
                        optionInfo,
                    });
                }
            }
        }

        // Add open short positions (sells with remaining quantity)
        for (const sell of openSells) {
            if (sell.remainingQty > 0) {
                const openSellTotal = (sell.remainingQty / sell.quantity) * sell.total;
                const optionInfo = getOptionInfo(sell);

                // Check if option has expired (use stored expiration_date)
                const expInfo = checkOptionExpiration(symbol, sell.asset_type, sell.expiration_date);
                const isPastExpiry = expInfo?.expired || false;
                const isManuallyExpired = !!sell.expired_worthless;

                if (isManuallyExpired) {
                    // User manually marked as expired - 100% profit for short position (premium kept)
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, sell.asset_type),
                        asset_type: sell.asset_type,
                        quantity: -sell.remainingQty, // Negative for short
                        buyPrice: 0,
                        sellPrice: sell.price,
                        buyDate: expInfo?.expirationDate?.toISOString() || sell.expiration_date,
                        sellDate: sell.executed_at,
                        buyTotal: 0,
                        sellTotal: openSellTotal,
                        pnl: openSellTotal, // Full premium kept
                        pnlPercent: 100,
                        broker: sell.broker,
                        status: 'expired',
                        expirationDate: sell.expiration_date || null,
                        reviewStatus: sell.review || 0,
                        tradeIds: [sell.id],
                        trades: [
                            {
                                id: sell.id,
                                symbol: sell.symbol,
                                asset_type: sell.asset_type,
                                side: 'sell',
                                quantity: sell.remainingQty,
                                price: sell.price,
                                total: openSellTotal,
                                executed_at: sell.executed_at,
                                expiration_date: sell.expiration_date,
                                review: sell.review,
                            },
                        ],
                        optionInfo,
                    });
                } else if (isPastExpiry) {
                    // Past expiry but not manually marked - pending_expiry status
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, sell.asset_type),
                        asset_type: sell.asset_type,
                        quantity: -sell.remainingQty, // Negative for short
                        buyPrice: null,
                        sellPrice: sell.price,
                        buyDate: null,
                        sellDate: sell.executed_at,
                        buyTotal: null,
                        sellTotal: openSellTotal,
                        pnl: null, // Not calculated until user confirms
                        pnlPercent: null,
                        broker: sell.broker,
                        status: 'pending_expiry',
                        expirationDate: sell.expiration_date || null,
                        reviewStatus: sell.review || 0,
                        tradeIds: [sell.id],
                        trades: [
                            {
                                id: sell.id,
                                symbol: sell.symbol,
                                asset_type: sell.asset_type,
                                side: 'sell',
                                quantity: sell.remainingQty,
                                price: sell.price,
                                total: openSellTotal,
                                executed_at: sell.executed_at,
                                expiration_date: sell.expiration_date,
                                review: sell.review,
                            },
                        ],
                        optionInfo,
                    });
                } else {
                    // Open short position
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, sell.asset_type),
                        asset_type: sell.asset_type,
                        quantity: -sell.remainingQty, // Negative for short
                        buyPrice: null,
                        sellPrice: sell.price,
                        buyDate: null,
                        sellDate: sell.executed_at,
                        buyTotal: null,
                        sellTotal: openSellTotal,
                        pnl: null,
                        pnlPercent: null,
                        broker: sell.broker,
                        status: 'open',
                        expirationDate: sell.expiration_date || null,
                        reviewStatus: sell.review || 0,
                        tradeIds: [sell.id],
                        trades: [
                            {
                                id: sell.id,
                                symbol: sell.symbol,
                                asset_type: sell.asset_type,
                                side: 'sell',
                                quantity: sell.remainingQty,
                                price: sell.price,
                                total: openSellTotal,
                                executed_at: sell.executed_at,
                                expiration_date: sell.expiration_date,
                                review: sell.review,
                            },
                        ],
                        optionInfo,
                    });
                }
            }
        }
    }

    // Sort by most recent activity first
    positions.sort((a, b) => {
        const dateA = new Date(a.sellDate || a.buyDate);
        const dateB = new Date(b.sellDate || b.buyDate);
        return dateB - dateA;
    });

    return positions;
}

/**
 * Get round-trip positions - grouped by balanced buy/sell quantities
 *
 * Logic:
 * 1. Sort trades by date
 * 2. Accumulate buys and sells
 * 3. When net quantity returns to 0 (buys = sells), that's one complete round trip
 * 4. Use actual totals for P&L (already includes 100x multiplier for options)
 */
export function getRoundTripPositions() {
    const db = getDb();
    // Sort by date, then by side (buy before sell) so all buys are accumulated before sells on same timestamp
    const trades = db.prepare(`
        SELECT t.*, a.broker
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        ORDER BY t.executed_at ASC, CASE WHEN t.side = 'buy' THEN 0 ELSE 1 END ASC
    `).all();

    // Group trades by symbol AND asset_type
    const tradesByKey = {};
    for (const trade of trades) {
        const key = `${trade.symbol}_${trade.asset_type}`;
        if (!tradesByKey[key]) {
            tradesByKey[key] = [];
        }
        tradesByKey[key].push(trade);
    }

    const positions = [];

    for (const key of Object.keys(tradesByKey)) {
        const symbolTrades = tradesByKey[key];
        const symbol = symbolTrades[0].symbol;
        const asset_type = symbolTrades[0].asset_type;

        // Accumulate trades into round trips
        let currentTrip = {
            buys: [],
            sells: [],
            buyQty: 0,
            sellQty: 0,
            buyTotal: 0,
            sellTotal: 0,
        };

        for (const trade of symbolTrades) {
            if (trade.side === 'buy') {
                currentTrip.buys.push(trade);
                currentTrip.buyQty += trade.quantity;
                currentTrip.buyTotal += trade.total;
            } else {
                currentTrip.sells.push(trade);
                currentTrip.sellQty += trade.quantity;
                currentTrip.sellTotal += trade.total;
            }

            // Check if round trip is complete (balanced)
            if (currentTrip.buyQty === currentTrip.sellQty && currentTrip.buyQty > 0) {
                const pnl = currentTrip.sellTotal - currentTrip.buyTotal;
                const allTrades = [...currentTrip.buys, ...currentTrip.sells].sort(
                    (a, b) => new Date(a.executed_at) - new Date(b.executed_at)
                );
                // Get expiration date from first trade (all trades in same contract have same expiration)
                const storedExpDate = currentTrip.buys[0]?.expiration_date || currentTrip.sells[0]?.expiration_date;

                positions.push({
                    symbol,
                    displaySymbol: getDisplaySymbol(symbol, asset_type),
                    asset_type,
                    quantity: currentTrip.buyQty,
                    buyTotal: currentTrip.buyTotal,
                    sellTotal: currentTrip.sellTotal,
                    buyDate: currentTrip.buys[0].executed_at,
                    sellDate: currentTrip.sells[currentTrip.sells.length - 1].executed_at,
                    pnl,
                    pnlPercent: currentTrip.buyTotal > 0 ? ((pnl / currentTrip.buyTotal) * 100) : 0,
                    broker: symbolTrades[0].broker,
                    status: 'closed',
                    expirationDate: storedExpDate || null,
                    reviewStatus: getReviewStatus(allTrades),
                    tradeIds: allTrades.map(t => t.id),
                    trades: allTrades.map(t => ({
                        id: t.id,
                        symbol: t.symbol,
                        asset_type: t.asset_type,
                        side: t.side,
                        quantity: t.quantity,
                        price: t.price,
                        total: t.total,
                        executed_at: t.executed_at,
                        expiration_date: t.expiration_date,
                        review: t.review,
                    })),
                });

                // Reset for next round trip
                currentTrip = {
                    buys: [],
                    sells: [],
                    buyQty: 0,
                    sellQty: 0,
                    buyTotal: 0,
                    sellTotal: 0,
                };
            }
        }

        // Add open position if there's an imbalance
        if (currentTrip.buyQty !== currentTrip.sellQty) {
            const netQty = currentTrip.buyQty - currentTrip.sellQty;
            const allTrades = [...currentTrip.buys, ...currentTrip.sells].sort(
                (a, b) => new Date(a.executed_at) - new Date(b.executed_at)
            );

            if (netQty > 0) {
                // Get stored expiration date from trades
                const storedExpDate = currentTrip.buys[0]?.expiration_date || currentTrip.sells[0]?.expiration_date;

                // Check if option has expired (use stored expiration_date)
                const expInfo = checkOptionExpiration(symbol, asset_type, storedExpDate);
                const isExpired = expInfo?.expired || false;

                if (isExpired) {
                    // Option expired worthless - calculate P&L as if sold at $0
                    // The net position expired, so we lost the proportional buy cost
                    const proportionalBuyCost = (netQty / currentTrip.buyQty) * currentTrip.buyTotal;
                    const pnl = currentTrip.sellTotal - currentTrip.buyTotal; // Total loss

                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, asset_type),
                        asset_type,
                        quantity: netQty,
                        buyTotal: currentTrip.buyTotal,
                        sellTotal: currentTrip.sellTotal,
                        buyDate: currentTrip.buys[0]?.executed_at,
                        sellDate: expInfo.expirationDate.toISOString(),
                        pnl,
                        pnlPercent: currentTrip.buyTotal > 0 ? ((pnl / currentTrip.buyTotal) * 100) : 0,
                        broker: symbolTrades[0].broker,
                        status: 'expired',
                        expirationDate: storedExpDate || null,
                        reviewStatus: getReviewStatus(allTrades),
                        tradeIds: allTrades.map(t => t.id),
                        trades: allTrades.map(t => ({
                            id: t.id,
                            symbol: t.symbol,
                            asset_type: t.asset_type,
                            side: t.side,
                            quantity: t.quantity,
                            price: t.price,
                            total: t.total,
                            executed_at: t.executed_at,
                            expiration_date: t.expiration_date,
                            review: t.review,
                        })),
                    });
                } else {
                    // More buys than sells - open long position
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, asset_type),
                        asset_type,
                        quantity: netQty,
                        buyTotal: currentTrip.buyTotal,
                        sellTotal: currentTrip.sellTotal,
                        buyDate: currentTrip.buys[0]?.executed_at,
                        sellDate: currentTrip.sells[currentTrip.sells.length - 1]?.executed_at || null,
                        pnl: null,
                        pnlPercent: null,
                        broker: symbolTrades[0].broker,
                        status: 'open',
                        expirationDate: storedExpDate || null,
                        reviewStatus: getReviewStatus(allTrades),
                        tradeIds: allTrades.map(t => t.id),
                        trades: allTrades.map(t => ({
                            id: t.id,
                            symbol: t.symbol,
                            asset_type: t.asset_type,
                            side: t.side,
                            quantity: t.quantity,
                            price: t.price,
                            total: t.total,
                            executed_at: t.executed_at,
                            expiration_date: t.expiration_date,
                            review: t.review,
                        })),
                    });
                }
            } else if (netQty < 0) {
                // More sells than buys - short position (Sell to Open)
                const storedExpDate = currentTrip.sells[0]?.expiration_date || currentTrip.buys[0]?.expiration_date;
                const expInfo = checkOptionExpiration(symbol, asset_type, storedExpDate);
                const isExpired = expInfo?.expired || false;

                if (isExpired) {
                    // Short option expired worthless - seller keeps full premium
                    const pnl = currentTrip.sellTotal - currentTrip.buyTotal;

                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, asset_type),
                        asset_type,
                        quantity: netQty, // Negative to indicate short
                        buyTotal: currentTrip.buyTotal,
                        sellTotal: currentTrip.sellTotal,
                        buyDate: currentTrip.buys[0]?.executed_at || null,
                        sellDate: expInfo.expirationDate.toISOString(),
                        pnl,
                        pnlPercent: currentTrip.sellTotal > 0 ? ((pnl / currentTrip.sellTotal) * 100) : 0,
                        broker: symbolTrades[0].broker,
                        status: 'expired',
                        expirationDate: storedExpDate || null,
                        reviewStatus: getReviewStatus(allTrades),
                        tradeIds: allTrades.map(t => t.id),
                        trades: allTrades.map(t => ({
                            id: t.id,
                            symbol: t.symbol,
                            asset_type: t.asset_type,
                            side: t.side,
                            quantity: t.quantity,
                            price: t.price,
                            total: t.total,
                            executed_at: t.executed_at,
                            expiration_date: t.expiration_date,
                            review: t.review,
                        })),
                    });
                } else {
                    // Open short position
                    positions.push({
                        symbol,
                        displaySymbol: getDisplaySymbol(symbol, asset_type),
                        asset_type,
                        quantity: netQty, // Negative to indicate short
                        buyTotal: currentTrip.buyTotal,
                        sellTotal: currentTrip.sellTotal,
                        buyDate: currentTrip.buys[0]?.executed_at || null,
                        sellDate: currentTrip.sells[0]?.executed_at,
                        pnl: null,
                        pnlPercent: null,
                        broker: symbolTrades[0].broker,
                        status: 'open',
                        expirationDate: storedExpDate || null,
                        reviewStatus: getReviewStatus(allTrades),
                        tradeIds: allTrades.map(t => t.id),
                        trades: allTrades.map(t => ({
                            id: t.id,
                            symbol: t.symbol,
                            asset_type: t.asset_type,
                            side: t.side,
                            quantity: t.quantity,
                            price: t.price,
                            total: t.total,
                            executed_at: t.executed_at,
                            expiration_date: t.expiration_date,
                            review: t.review,
                        })),
                    });
                }
            }
        }
    }

    // Sort by most recent activity first
    positions.sort((a, b) => {
        const dateA = new Date(a.sellDate || a.buyDate);
        const dateB = new Date(b.sellDate || b.buyDate);
        return dateB - dateA;
    });

    return positions;
}
