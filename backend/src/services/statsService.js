import { getDb } from '../db/database.js';

export function getOverallStats() {
    const db = getDb();

    const totalTrades = db.prepare('SELECT COUNT(*) as count FROM trades').get().count;

    const byAssetType = db.prepare(`
        SELECT asset_type, COUNT(*) as count, SUM(total) as volume
        FROM trades
        GROUP BY asset_type
    `).all();

    const bySide = db.prepare(`
        SELECT side, COUNT(*) as count, SUM(total) as volume
        FROM trades
        GROUP BY side
    `).all();

    const byBroker = db.prepare(`
        SELECT a.broker, COUNT(*) as count, SUM(t.total) as volume
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        GROUP BY a.broker
    `).all();

    const topSymbols = db.prepare(`
        SELECT symbol, COUNT(*) as count, SUM(total) as volume
        FROM trades
        GROUP BY symbol
        ORDER BY count DESC
        LIMIT 10
    `).all();

    const totalVolume = db.prepare('SELECT SUM(total) as volume FROM trades').get().volume || 0;
    const totalFees = db.prepare('SELECT SUM(fees) as fees FROM trades').get().fees || 0;

    return {
        total_trades: totalTrades,
        total_volume: totalVolume,
        total_fees: totalFees,
        by_asset_type: byAssetType,
        by_side: bySide,
        by_broker: byBroker,
        top_symbols: topSymbols,
    };
}

export function getDailyStats(days = 30) {
    const db = getDb();

    return db.prepare(`
        SELECT
            DATE(executed_at) as date,
            COUNT(*) as trade_count,
            SUM(CASE WHEN side = 'buy' THEN total ELSE 0 END) as buy_volume,
            SUM(CASE WHEN side = 'sell' THEN total ELSE 0 END) as sell_volume,
            SUM(total) as total_volume
        FROM trades
        WHERE executed_at >= DATE('now', '-' || ? || ' days')
        GROUP BY DATE(executed_at)
        ORDER BY date DESC
    `).all(days);
}

export function getSymbolStats(symbol) {
    const db = getDb();

    return db.prepare(`
        SELECT
            symbol,
            COUNT(*) as trade_count,
            SUM(CASE WHEN side = 'buy' THEN quantity ELSE 0 END) as total_bought,
            SUM(CASE WHEN side = 'sell' THEN quantity ELSE 0 END) as total_sold,
            SUM(CASE WHEN side = 'buy' THEN total ELSE 0 END) as buy_volume,
            SUM(CASE WHEN side = 'sell' THEN total ELSE 0 END) as sell_volume,
            AVG(price) as avg_price,
            MIN(executed_at) as first_trade,
            MAX(executed_at) as last_trade
        FROM trades
        WHERE symbol = ?
        GROUP BY symbol
    `).get(symbol);
}
