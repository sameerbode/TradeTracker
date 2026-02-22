import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { schema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'trades.db');

// Create data directory if it doesn't exist
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

export function withTransaction(db, fn) {
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

/**
 * Compute round trips from trades using the round-trip algorithm.
 * This is used during migration to persist positions for unclaimed trades.
 * Returns array of { tradeIds, status } objects.
 */
function computeRoundTripsFromTrades(trades) {
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

            // Check if round trip is complete (balanced)
            if (currentTrip.buyQty === currentTrip.sellQty && currentTrip.buyQty > 0) {
                // Check for expiration
                let status = 'closed';
                if (asset_type === 'option') {
                    const hasExpired = symbolTrades.some(t => t.expired_worthless);
                    if (hasExpired) status = 'expired';
                }
                positions.push({ tradeIds: currentTrip.tradeIds, status });
                currentTrip = { tradeIds: [], buyQty: 0, sellQty: 0 };
            }
        }

        // Open position (imbalance)
        if (currentTrip.tradeIds.length > 0) {
            let status = 'open';
            if (asset_type === 'option') {
                const expDate = symbolTrades[0].expiration_date;
                if (expDate) {
                    const exp = new Date(expDate);
                    const now = new Date();
                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const expOnly = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());
                    const hasManualExpiry = symbolTrades.some(t => t.expired_worthless);
                    if (hasManualExpiry) {
                        status = 'expired';
                    } else if (expOnly < today) {
                        status = 'pending_expiry';
                    }
                }
            }
            positions.push({ tradeIds: currentTrip.tradeIds, status });
        }
    }

    return positions;
}

export function getDb() {
    if (!db) {
        db = new DatabaseSync(dbPath);
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA foreign_keys = ON');
        db.exec(schema);

        // Migrations for trades table columns
        const columns = db.prepare("PRAGMA table_info(trades)").all();

        // Migration: add review column if it doesn't exist
        const hasReview = columns.some(col => col.name === 'review');
        if (!hasReview) {
            db.exec('ALTER TABLE trades ADD COLUMN review INTEGER DEFAULT 0');
        }

        // Migration: add expiration_date column if it doesn't exist
        const hasExpirationDate = columns.some(col => col.name === 'expiration_date');
        if (!hasExpirationDate) {
            db.exec('ALTER TABLE trades ADD COLUMN expiration_date TEXT');
        }

        // Migration: add expired_worthless column if it doesn't exist
        const hasExpiredWorthless = columns.some(col => col.name === 'expired_worthless');
        if (!hasExpiredWorthless) {
            db.exec('ALTER TABLE trades ADD COLUMN expired_worthless INTEGER DEFAULT 0');
        }

        // Migration: add import_id column if it doesn't exist
        const hasImportId = columns.some(col => col.name === 'import_id');
        if (!hasImportId) {
            db.exec('ALTER TABLE trades ADD COLUMN import_id INTEGER REFERENCES imports(id)');
        }

        // Migration: add note column to why_options if it doesn't exist
        const whyColumns = db.prepare("PRAGMA table_info(why_options)").all();
        const hasNote = whyColumns.some(col => col.name === 'note');
        if (!hasNote) {
            db.exec('ALTER TABLE why_options ADD COLUMN note TEXT');
        }

        // Migration: strategies -> positions
        // Check if old strategies table exists but positions table was just created (empty)
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
        const hasStrategies = tables.includes('strategies');
        const hasPositions = tables.includes('positions');

        if (hasStrategies && hasPositions) {
            // Check if positions table is empty (needs migration)
            const posCount = db.prepare('SELECT COUNT(*) as cnt FROM positions').get().cnt;
            const stratCount = db.prepare('SELECT COUNT(*) as cnt FROM strategies').get().cnt;

            if (posCount === 0 && stratCount > 0) {
                console.log('[Migration] Migrating strategies -> positions...');
                migrateStrategiesToPositions(db);
            } else if (posCount === 0) {
                // No strategies either - just compute positions for all trades
                console.log('[Migration] Computing initial positions from trades...');
                computeInitialPositions(db);
                // Clean up old tables
                dropOldTables(db);
            } else {
                // Positions already populated, clean up old tables if they exist
                dropOldTables(db);
            }
        } else if (!hasStrategies && hasPositions) {
            // Fresh state or already migrated - check if positions need initial computation
            const posCount = db.prepare('SELECT COUNT(*) as cnt FROM positions').get().cnt;
            const tradeCount = db.prepare('SELECT COUNT(*) as cnt FROM trades').get().cnt;
            if (posCount === 0 && tradeCount > 0) {
                console.log('[Migration] Computing initial positions from trades...');
                computeInitialPositions(db);
            }
        }
    }
    return db;
}

function migrateStrategiesToPositions(db) {
    db.exec('BEGIN');
    try {
        // 1. Copy strategies -> positions
        const strategies = db.prepare('SELECT * FROM strategies').all();
        const insertPos = db.prepare(`
            INSERT INTO positions (id, name, notes, why, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const s of strategies) {
            // Determine status from trade data
            const stratTradeIds = db.prepare('SELECT trade_id FROM strategy_trades WHERE strategy_id = ?').all(s.id).map(r => r.trade_id);
            let status = 'open';
            if (stratTradeIds.length > 0) {
                const placeholders = stratTradeIds.map(() => '?').join(',');
                const trades = db.prepare(`SELECT * FROM trades WHERE id IN (${placeholders})`).all(...stratTradeIds);
                const buyQty = trades.filter(t => t.side === 'buy').reduce((sum, t) => sum + t.quantity, 0);
                const sellQty = trades.filter(t => t.side === 'sell').reduce((sum, t) => sum + t.quantity, 0);
                if (buyQty === sellQty && buyQty > 0) {
                    status = trades.some(t => t.expired_worthless) ? 'expired' : 'closed';
                } else if (trades.some(t => t.expired_worthless)) {
                    status = 'expired';
                }
            }
            insertPos.run(s.id, s.name, s.notes, s.why || null, status, s.created_at);
        }

        // 2. Copy strategy_trades -> position_trades
        const stTrades = db.prepare('SELECT * FROM strategy_trades').all();
        const insertPT = db.prepare(`
            INSERT OR IGNORE INTO position_trades (position_id, trade_id)
            VALUES (?, ?)
        `);
        for (const st of stTrades) {
            insertPT.run(st.strategy_id, st.trade_id);
        }

        // 3. Compute round trips for unclaimed trades
        const claimedIds = db.prepare('SELECT DISTINCT trade_id FROM position_trades').all().map(r => r.trade_id);
        const claimedSet = new Set(claimedIds);

        const allTrades = db.prepare(`
            SELECT t.* FROM trades t
            ORDER BY t.executed_at ASC, CASE WHEN t.side = 'buy' THEN 0 ELSE 1 END ASC
        `).all();

        const unclaimedTrades = allTrades.filter(t => !claimedSet.has(t.id));

        if (unclaimedTrades.length > 0) {
            const roundTrips = computeRoundTripsFromTrades(unclaimedTrades);
            const insertPosition = db.prepare(`
                INSERT INTO positions (name, status, created_at)
                VALUES (?, ?, datetime('now'))
            `);
            const insertPosTradeRow = db.prepare(`
                INSERT OR IGNORE INTO position_trades (position_id, trade_id)
                VALUES (?, ?)
            `);

            for (const rt of roundTrips) {
                const result = insertPosition.run(null, rt.status);
                const posId = result.lastInsertRowid;
                for (const tradeId of rt.tradeIds) {
                    insertPosTradeRow.run(posId, tradeId);
                }
            }
        }

        // 4. Drop old tables
        db.exec('DROP TABLE IF EXISTS strategy_trades');
        db.exec('DROP TABLE IF EXISTS strategies');

        db.exec('COMMIT');
        console.log('[Migration] Successfully migrated strategies -> positions');
    } catch (e) {
        db.exec('ROLLBACK');
        console.error('[Migration] Failed:', e.message);
        throw e;
    }
}

function computeInitialPositions(db) {
    const allTrades = db.prepare(`
        SELECT t.* FROM trades t
        ORDER BY t.executed_at ASC, CASE WHEN t.side = 'buy' THEN 0 ELSE 1 END ASC
    `).all();

    if (allTrades.length === 0) return;

    db.exec('BEGIN');
    try {
        const roundTrips = computeRoundTripsFromTrades(allTrades);
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
            for (const tradeId of rt.tradeIds) {
                insertPT.run(posId, tradeId);
            }
        }

        db.exec('COMMIT');
        console.log(`[Migration] Created ${roundTrips.length} positions from ${allTrades.length} trades`);
    } catch (e) {
        db.exec('ROLLBACK');
        console.error('[Migration] Failed to compute initial positions:', e.message);
        throw e;
    }
}

function dropOldTables(db) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    if (tables.includes('strategy_trades')) {
        db.exec('DROP TABLE IF EXISTS strategy_trades');
        console.log('[Migration] Dropped strategy_trades table');
    }
    if (tables.includes('strategies')) {
        db.exec('DROP TABLE IF EXISTS strategies');
        console.log('[Migration] Dropped strategies table');
    }
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
