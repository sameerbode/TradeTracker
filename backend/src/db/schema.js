export const schema = `
-- Broker accounts
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker TEXT NOT NULL,
    nickname TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- All trades
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    broker_trade_id TEXT,
    symbol TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    fees REAL DEFAULT 0,
    executed_at TEXT NOT NULL,
    expiration_date TEXT,
    review INTEGER DEFAULT 0,
    expired_worthless INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    UNIQUE(account_id, broker_trade_id)
);

-- Import history
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    trades_imported INTEGER DEFAULT 0,
    trades_skipped INTEGER DEFAULT 0,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- Custom strategy groupings
CREATE TABLE IF NOT EXISTS strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Links trades to strategies (many-to-many)
CREATE TABLE IF NOT EXISTS strategy_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    trade_id INTEGER NOT NULL,
    FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
    FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
    UNIQUE(strategy_id, trade_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at);
CREATE INDEX IF NOT EXISTS idx_trades_asset_type ON trades(asset_type);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_strategy ON strategy_trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_trades_trade ON strategy_trades(trade_id);
`;
