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

export function getDb() {
    if (!db) {
        db = new DatabaseSync(dbPath);
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA foreign_keys = ON');
        db.exec(schema);

        // Migrations
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

        // Migration: add why column to strategies if it doesn't exist
        const strategyColumns = db.prepare("PRAGMA table_info(strategies)").all();
        const hasWhy = strategyColumns.some(col => col.name === 'why');
        if (!hasWhy) {
            db.exec('ALTER TABLE strategies ADD COLUMN why TEXT');
        }
    }
    return db;
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
