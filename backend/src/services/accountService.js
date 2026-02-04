import { getDb } from '../db/database.js';

export function getAllAccounts() {
    const db = getDb();
    return db.prepare(`
        SELECT a.*,
            (SELECT COUNT(*) FROM trades WHERE account_id = a.id) as trade_count
        FROM accounts a
        ORDER BY a.created_at DESC
    `).all();
}

export function getAccountById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function createAccount(broker, nickname = null) {
    const db = getDb();
    const result = db.prepare(
        'INSERT INTO accounts (broker, nickname) VALUES (?, ?)'
    ).run(broker, nickname);
    return { id: result.lastInsertRowid, broker, nickname };
}

export function deleteAccount(id) {
    const db = getDb();
    // Delete associated trades first
    db.prepare('DELETE FROM trades WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM imports WHERE account_id = ?').run(id);
    return db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export function getOrCreateAccount(broker, nickname = null) {
    const db = getDb();
    let account = db.prepare(
        'SELECT * FROM accounts WHERE broker = ? AND (nickname = ? OR (nickname IS NULL AND ? IS NULL))'
    ).get(broker, nickname, nickname);

    if (!account) {
        const result = db.prepare(
            'INSERT INTO accounts (broker, nickname) VALUES (?, ?)'
        ).run(broker, nickname);
        account = { id: result.lastInsertRowid, broker, nickname };
    }

    return account;
}
