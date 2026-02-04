# TradeTracker - Project Rules

## Project Overview
A personal trade tracking application that aggregates trades from multiple brokerages (Robinhood, Webull) into a unified dashboard with statistics and analytics.

## Tech Stack
- **Frontend**: React + Vite + TailwindCSS + Recharts
- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **PDF Parsing**: pdf-parse (for Robinhood futures statements)
- **CSV Parsing**: papaparse

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                         │
│  Dashboard | Trade List | Stats | Import (CSV/PDF)         │
└─────────────────────────┬───────────────────────────────────┘
                          │ REST API
┌─────────────────────────┴───────────────────────────────────┐
│                    Backend (Express)                         │
│  /api/trades | /api/stats | /api/import                     │
│                                                              │
│  Parsers: Robinhood CSV | Webull CSV | Robinhood Futures PDF│
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                    SQLite Database                           │
│  trades | accounts | imports                                 │
└─────────────────────────────────────────────────────────────┘
```

## Data Sources

| Source | Format | Contains |
|--------|--------|----------|
| Robinhood CSV | CSV | Stocks, Options |
| Robinhood Statement | PDF | Futures trades |
| Webull CSV | CSV | All trades |

## Coding Conventions

### Backend (Node.js)
- Use ES modules (`import`/`export`)
- Use async/await for asynchronous operations
- Error handling with try/catch and proper HTTP status codes
- Keep routes thin, business logic in services
- Use parameterized queries for SQLite (prevent SQL injection)

### Frontend (React)
- Functional components with hooks
- Use React Query for data fetching
- TailwindCSS for styling (no CSS files)
- Keep components small and focused
- Co-locate related files

### Database
- Use migrations for schema changes
- All dates stored as ISO 8601 strings
- Use transactions for multi-table operations
- Deduplicate trades on import using broker_trade_id

## File Structure

```
TradeTracker/
├── CLAUDE.md
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── api/
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── parsers/
│   │   ├── db/
│   │   └── index.js
│   ├── package.json
│   └── data/
│       └── trades.db
└── README.md
```

## API Endpoints

### Trades
- `GET /api/trades` - List all trades (with filters)
- `GET /api/trades/:id` - Get single trade
- `DELETE /api/trades/:id` - Delete trade

### Import
- `POST /api/import/csv` - Import CSV file (Robinhood/Webull)
- `POST /api/import/pdf` - Import PDF statement (Robinhood futures)

### Stats
- `GET /api/stats` - Get overall statistics
- `GET /api/stats/daily` - Get daily P&L

### Accounts
- `GET /api/accounts` - List connected accounts
- `POST /api/accounts` - Add account
- `DELETE /api/accounts/:id` - Remove account

## Database Schema

```sql
-- Broker accounts
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker TEXT NOT NULL,  -- 'robinhood' | 'webull'
    nickname TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- All trades
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    broker_trade_id TEXT,  -- For deduplication
    symbol TEXT NOT NULL,
    asset_type TEXT NOT NULL,  -- 'stock' | 'option' | 'future'
    side TEXT NOT NULL,  -- 'buy' | 'sell'
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    fees REAL DEFAULT 0,
    executed_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    UNIQUE(account_id, broker_trade_id)
);

-- Import history
CREATE TABLE imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,  -- 'csv' | 'pdf'
    trades_imported INTEGER DEFAULT 0,
    trades_skipped INTEGER DEFAULT 0,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);
```

## Import Logic

1. User uploads file (CSV or PDF)
2. Detect broker based on file format/headers
3. Parse trades using appropriate parser
4. Deduplicate using broker_trade_id (skip existing)
5. Insert new trades
6. Log import to imports table
7. Return summary (imported count, skipped count)

## Key Rules

1. **No auto-sync** - All imports are manual via button
2. **Deduplication** - Never create duplicate trades
3. **Single user** - No auth required
4. **Futures from PDF only** - Robinhood doesn't export futures in CSV
5. **Keep it simple** - No over-engineering
6. **DEVLOG.md** - Always update DEVLOG.md with timestamps when making changes to the project. Format: `### YYYY-MM-DD HH:MM - Brief Title`. Document what was changed, why, and any technical details. This is mandatory for every code change.
