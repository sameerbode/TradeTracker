import { getDb, withTransaction } from '../db/database.js';
import { getOrCreateAccount } from './accountService.js';
import { insertTrades } from './tradeService.js';
import { recomputePositionsAfterImport, computeRoundTrips } from './positionService.js';
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

    // Compute positions for newly imported trades
    if (imported > 0) {
        const db = getDb();
        const importedTradeIds = db.prepare('SELECT id FROM trades WHERE import_id = ?')
            .all(importId).map(r => r.id);
        recomputePositionsAfterImport(importedTradeIds);
    }

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

    // Compute positions for newly imported trades
    if (imported > 0) {
        const db = getDb();
        const importedTradeIds = db.prepare('SELECT id FROM trades WHERE import_id = ?')
            .all(importId).map(r => r.id);
        recomputePositionsAfterImport(importedTradeIds);
    }

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

        // Clean up position_trades references and empty positions
        if (tradeIds.length > 0) {
            const placeholders = tradeIds.map(() => '?').join(',');

            // Find affected position IDs
            const affectedPositionIds = db.prepare(`
                SELECT DISTINCT position_id FROM position_trades
                WHERE trade_id IN (${placeholders})
            `).all(...tradeIds).map(r => r.position_id);

            // Remove trade links
            db.prepare(`DELETE FROM position_trades WHERE trade_id IN (${placeholders})`).run(...tradeIds);

            // Delete positions that now have no trades
            for (const posId of affectedPositionIds) {
                const remaining = db.prepare('SELECT COUNT(*) as cnt FROM position_trades WHERE position_id = ?').get(posId).cnt;
                if (remaining === 0) {
                    db.prepare('DELETE FROM positions WHERE id = ?').run(posId);
                }
            }
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
    const positions = db.prepare('SELECT * FROM positions').all();
    const positionTrades = db.prepare('SELECT * FROM position_trades').all();
    const whyOptions = db.prepare('SELECT * FROM why_options').all();

    return {
        version: 2,
        exportedAt: new Date().toISOString(),
        data: {
            accounts,
            trades,
            positions,
            positionTrades,
            whyOptions,
        }
    };
}

// Import backup JSON data
export function importBackup(backup) {
    const db = getDb();

    if (!backup.version || !backup.data) {
        throw new Error('Invalid backup format');
    }

    const version = backup.version;

    return withTransaction(db, () => {
        // Clear existing data in reverse dependency order
        db.prepare('DELETE FROM position_trades').run();
        db.prepare('DELETE FROM positions').run();
        db.prepare('DELETE FROM imports').run();
        db.prepare('DELETE FROM trades').run();
        db.prepare('DELETE FROM accounts').run();

        // Reset auto-increment counters
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('accounts', 'trades', 'positions', 'position_trades', 'imports')").run();

        const { accounts, trades } = backup.data;

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

        if (version >= 2) {
            // Version 2: positions + position_trades
            const { positions, positionTrades, whyOptions } = backup.data;

            const insertPosition = db.prepare(`
                INSERT INTO positions (id, name, notes, why, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (const pos of (positions || [])) {
                insertPosition.run(pos.id, pos.name, pos.notes, pos.why, pos.status, pos.created_at);
            }

            const insertPT = db.prepare(`
                INSERT INTO position_trades (position_id, trade_id)
                VALUES (?, ?)
            `);
            for (const pt of (positionTrades || [])) {
                insertPT.run(pt.position_id, pt.trade_id);
            }

            // Restore why_options if present
            if (whyOptions && whyOptions.length > 0) {
                db.prepare('DELETE FROM why_options').run();
                const insertWhy = db.prepare(`
                    INSERT INTO why_options (id, label, note, created_at)
                    VALUES (?, ?, ?, ?)
                `);
                for (const wo of whyOptions) {
                    insertWhy.run(wo.id, wo.label, wo.note, wo.created_at);
                }
            }

            return {
                accounts: accounts.length,
                trades: trades.length,
                positions: (positions || []).length,
                positionTrades: (positionTrades || []).length,
            };
        } else {
            // Version 1: old format with strategies + strategyTrades
            // Migrate on import
            const { strategies, strategyTrades } = backup.data;

            // Import strategies as positions
            const insertPosition = db.prepare(`
                INSERT INTO positions (id, name, notes, why, status, created_at)
                VALUES (?, ?, ?, ?, 'open', ?)
            `);
            for (const strategy of (strategies || [])) {
                insertPosition.run(strategy.id, strategy.name, strategy.notes, strategy.why || null, strategy.created_at);
            }

            // Import strategy_trades as position_trades
            const insertPT = db.prepare(`
                INSERT OR IGNORE INTO position_trades (position_id, trade_id)
                VALUES (?, ?)
            `);
            for (const st of (strategyTrades || [])) {
                insertPT.run(st.strategy_id, st.trade_id);
            }

            // Compute round trips for unclaimed trades
            const claimedIds = new Set((strategyTrades || []).map(st => st.trade_id));
            const unclaimedTrades = trades.filter(t => !claimedIds.has(t.id));

            if (unclaimedTrades.length > 0) {
                // Sort trades for round-trip computation
                unclaimedTrades.sort((a, b) => {
                    const dateCompare = new Date(a.executed_at) - new Date(b.executed_at);
                    if (dateCompare !== 0) return dateCompare;
                    return a.side === 'buy' ? -1 : 1;
                });

                const roundTrips = computeRoundTrips(unclaimedTrades);

                const insertPos = db.prepare(`
                    INSERT INTO positions (name, status, created_at)
                    VALUES (?, ?, datetime('now'))
                `);
                const insertPosTradeRow = db.prepare(`
                    INSERT OR IGNORE INTO position_trades (position_id, trade_id)
                    VALUES (?, ?)
                `);

                for (const rt of roundTrips) {
                    const result = insertPos.run(null, rt.status);
                    const posId = result.lastInsertRowid;
                    for (const tradeId of rt.tradeIds) {
                        insertPosTradeRow.run(posId, tradeId);
                    }
                }
            }

            return {
                accounts: accounts.length,
                trades: trades.length,
                strategies: (strategies || []).length,
                strategyTrades: (strategyTrades || []).length,
            };
        }
    });
}
