import { getDb, withTransaction } from '../db/database.js';

export function getAllTrades(filters = {}) {
    const db = getDb();
    let query = `
        SELECT t.*, a.broker, a.nickname as account_name, i.filename as import_filename
        FROM trades t
        JOIN accounts a ON t.account_id = a.id
        LEFT JOIN imports i ON t.import_id = i.id
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
    db.prepare('DELETE FROM position_trades').run();
    db.prepare('DELETE FROM positions').run();
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
    const validStatus = [0, 1, 2].includes(status) ? status : 0;
    return db.prepare(`UPDATE trades SET review = ? WHERE id IN (${placeholders})`).run(validStatus, ...ids);
}

export function expireTrades(ids) {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    return db.prepare(`UPDATE trades SET expired_worthless = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function insertTrades(accountId, trades, importId = null) {
    const db = getDb();
    const insert = db.prepare(`
        INSERT OR IGNORE INTO trades
        (account_id, broker_trade_id, symbol, asset_type, side, quantity, price, total, fees, executed_at, expiration_date, import_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                trade.expiration_date || null,
                importId
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
