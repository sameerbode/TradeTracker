import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { schema } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/trades.db');

let db = null;

export function getDb() {
    if (!db) {
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
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
    }
    return db;
}

export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
