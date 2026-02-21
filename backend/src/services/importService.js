import { getDb } from '../db/database.js';
import { getOrCreateAccount } from './accountService.js';
import { insertTrades } from './tradeService.js';
import {
    parseRobinhoodCsv,
    isRobinhoodCsv,
    parseWebullCsv,
    isWebullCsv,
    parseRobinhoodFuturesPdf,
} from '../parsers/index.js';

export async function importCsv(filename, content) {
    let broker;
    let trades;

    // Detect broker and parse
    if (isRobinhoodCsv(content)) {
        broker = 'robinhood';
        trades = parseRobinhoodCsv(content);
    } else if (isWebullCsv(content)) {
        broker = 'webull';
        trades = parseWebullCsv(content);
    } else {
        throw new Error('Unknown CSV format. Supported: Robinhood, Webull');
    }

    if (trades.length === 0) {
        return {
            broker,
            trades_imported: 0,
            trades_skipped: 0,
            message: 'No trades found in file',
        };
    }

    // Get or create account
    const account = getOrCreateAccount(broker);

    // Create import record first to get import_id
    const importId = logImport(account.id, filename, 'csv', 0, 0);

    // Insert trades with import_id
    const { imported, skipped } = insertTrades(account.id, trades, importId);

    // Update import record with actual counts
    updateImportCounts(importId, imported, skipped);

    return {
        broker,
        account_id: account.id,
        trades_imported: imported,
        trades_skipped: skipped,
        total_in_file: trades.length,
    };
}

export async function importPdf(filename, buffer) {
    const trades = await parseRobinhoodFuturesPdf(buffer);

    if (trades.length === 0) {
        return {
            broker: 'robinhood',
            trades_imported: 0,
            trades_skipped: 0,
            message: 'No futures trades found in PDF',
        };
    }

    // Get or create robinhood account
    const account = getOrCreateAccount('robinhood');

    // Create import record first to get import_id
    const importId = logImport(account.id, filename, 'pdf', 0, 0);

    // Insert trades with import_id
    const { imported, skipped } = insertTrades(account.id, trades, importId);

    // Update import record with actual counts
    updateImportCounts(importId, imported, skipped);

    return {
        broker: 'robinhood',
        account_id: account.id,
        trades_imported: imported,
        trades_skipped: skipped,
        total_in_file: trades.length,
    };
}

export function getImportHistory(limit = 20) {
    const db = getDb();
    return db.prepare(`
        SELECT i.*, a.broker, a.nickname
        FROM imports i
        JOIN accounts a ON i.account_id = a.id
        ORDER BY i.imported_at DESC
        LIMIT ?
    `).all(limit);
}

export function deleteImport(importId) {
    const db = getDb();
    const transaction = db.transaction(() => {
        // Get trade IDs for this import
        const tradeIds = db.prepare('SELECT id FROM trades WHERE import_id = ?').all(importId).map(r => r.id);

        // Clean up strategy_trades references
        if (tradeIds.length > 0) {
            const placeholders = tradeIds.map(() => '?').join(',');
            db.prepare(`DELETE FROM strategy_trades WHERE trade_id IN (${placeholders})`).run(...tradeIds);
        }

        // Delete trades
        const tradesDeleted = db.prepare('DELETE FROM trades WHERE import_id = ?').run(importId).changes;

        // Delete the import record
        db.prepare('DELETE FROM imports WHERE id = ?').run(importId);

        return { trades_deleted: tradesDeleted };
    });
    return transaction();
}

function logImport(accountId, filename, fileType, imported, skipped) {
    const db = getDb();
    const result = db.prepare(`
        INSERT INTO imports (account_id, filename, file_type, trades_imported, trades_skipped)
        VALUES (?, ?, ?, ?, ?)
    `).run(accountId, filename, fileType, imported, skipped);
    return result.lastInsertRowid;
}

function updateImportCounts(importId, imported, skipped) {
    const db = getDb();
    db.prepare(`
        UPDATE imports SET trades_imported = ?, trades_skipped = ? WHERE id = ?
    `).run(imported, skipped, importId);
}

// Export all data as JSON for backup
export function exportAllData() {
    const db = getDb();

    const accounts = db.prepare('SELECT * FROM accounts').all();
    const trades = db.prepare('SELECT * FROM trades').all();
    const strategies = db.prepare('SELECT * FROM strategies').all();
    const strategyTrades = db.prepare('SELECT * FROM strategy_trades').all();

    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
            accounts,
            trades,
            strategies,
            strategyTrades
        }
    };
}

// Import backup JSON data
export function importBackup(backup) {
    const db = getDb();

    if (!backup.version || !backup.data) {
        throw new Error('Invalid backup format');
    }

    const { accounts, trades, strategies, strategyTrades } = backup.data;

    // Use a transaction to ensure atomicity
    const transaction = db.transaction(() => {
        // Clear existing data in reverse dependency order
        db.prepare('DELETE FROM strategy_trades').run();
        db.prepare('DELETE FROM strategies').run();
        db.prepare('DELETE FROM imports').run();
        db.prepare('DELETE FROM trades').run();
        db.prepare('DELETE FROM accounts').run();

        // Reset auto-increment counters
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('accounts', 'trades', 'strategies', 'strategy_trades', 'imports')").run();

        // Insert accounts
        const insertAccount = db.prepare(`
            INSERT INTO accounts (id, broker, nickname, created_at)
            VALUES (?, ?, ?, ?)
        `);
        for (const account of accounts) {
            insertAccount.run(account.id, account.broker, account.nickname, account.created_at);
        }

        // Insert trades
        const insertTrade = db.prepare(`
            INSERT INTO trades (id, account_id, broker_trade_id, symbol, asset_type, side, quantity, price, total, fees, executed_at, created_at, expiration_date, review, expired_worthless)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const trade of trades) {
            insertTrade.run(
                trade.id, trade.account_id, trade.broker_trade_id, trade.symbol,
                trade.asset_type, trade.side, trade.quantity, trade.price,
                trade.total, trade.fees, trade.executed_at, trade.created_at,
                trade.expiration_date, trade.review || 0, trade.expired_worthless || 0
            );
        }

        // Insert strategies
        const insertStrategy = db.prepare(`
            INSERT INTO strategies (id, name, notes, created_at)
            VALUES (?, ?, ?, ?)
        `);
        for (const strategy of strategies) {
            insertStrategy.run(strategy.id, strategy.name, strategy.notes, strategy.created_at);
        }

        // Insert strategy_trades
        const insertStrategyTrade = db.prepare(`
            INSERT INTO strategy_trades (strategy_id, trade_id)
            VALUES (?, ?)
        `);
        for (const st of strategyTrades) {
            insertStrategyTrade.run(st.strategy_id, st.trade_id);
        }

        return {
            accounts: accounts.length,
            trades: trades.length,
            strategies: strategies.length,
            strategyTrades: strategyTrades.length
        };
    });

    return transaction();
}
