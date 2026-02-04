# TradeTracker - Technical Documentation

## Tech Stack

### Frontend
| Technology | Purpose | Version |
|------------|---------|---------|
| React | UI framework | 18.x |
| Vite | Build tool & dev server | 5.x |
| TailwindCSS | Utility-first CSS styling | 3.x |
| React Query | Server state management & data fetching | 5.x |
| Recharts | Charts and data visualization | 2.x |

### Backend
| Technology | Purpose | Version |
|------------|---------|---------|
| Node.js | Runtime | 24.x |
| Express | Web framework | 4.x |
| better-sqlite3 | SQLite database driver | 11.x |
| multer | File upload handling | 1.x |

### Parsing Libraries
| Library | Purpose |
|---------|---------|
| papaparse | CSV parsing (Robinhood, Webull) |
| pdf-parse | PDF parsing (Robinhood futures statements) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (React + Vite)                     │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ App.jsx     │  │ Components  │  │ API Client (client.js)  │  │
│  │ - Filters   │  │ - Positions │  │ - REST calls            │  │
│  │ - Import    │  │ - Strategies│  │ - React Query hooks     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                                                                  │
│  Port: 5173 (dev)                    TailwindCSS for styling    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                          REST API
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                      Backend (Express)                           │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Routes      │  │ Services    │  │ Parsers                 │  │
│  │ - /trades   │  │ - trade     │  │ - robinhoodCsv.js       │  │
│  │ - /import   │  │ - strategy  │  │ - webullCsv.js          │  │
│  │ - /stats    │  │ - import    │  │ - robinhoodFuturesPdf.js│  │
│  │ - /accounts │  │ - account   │  │                         │  │
│  │ - /strategies│ │             │  │                         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                                                                  │
│  Port: 3001                                                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                          SQLite
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                      Database (SQLite)                           │
│                                                                  │
│  Tables:                                                         │
│  - accounts        (broker accounts)                             │
│  - trades          (all trade records)                           │
│  - strategies      (multi-leg option strategies)                 │
│  - strategy_trades (trade-to-strategy mapping)                   │
│  - imports         (import history log)                          │
│                                                                  │
│  File: backend/data/trades.db                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Trades
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trades` | List trades (with filters) |
| GET | `/api/trades/:id` | Get single trade |
| DELETE | `/api/trades/:id` | Delete trade |
| DELETE | `/api/trades` | Clear all trades |
| GET | `/api/trades/symbols` | Get unique symbols |
| GET | `/api/trades/positions` | Get FIFO positions |
| PATCH | `/api/trades/review` | Set review status (0/1/2) |
| POST | `/api/trades/expire` | Mark trades as expired |

### Import/Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/import/csv` | Import CSV file |
| POST | `/api/import/pdf` | Import PDF statement |
| POST | `/api/import/backup` | Restore from JSON backup |
| GET | `/api/import/export` | Download JSON backup |
| GET | `/api/import/history` | Get import history |

### Strategies
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/strategies` | List all strategies |
| POST | `/api/strategies` | Create strategy |
| PATCH | `/api/strategies/:id` | Update strategy |
| DELETE | `/api/strategies/:id` | Delete strategy |
| POST | `/api/strategies/:id/trades` | Add trades to strategy |
| DELETE | `/api/strategies/:id/trades` | Remove trades from strategy |
| GET | `/api/strategies/grouped-trades` | Get trade IDs in strategies |

### Stats & Accounts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Overall statistics |
| GET | `/api/stats/daily` | Daily P&L |
| GET | `/api/accounts` | List accounts |
| POST | `/api/accounts` | Create account |
| DELETE | `/api/accounts/:id` | Delete account |

---

## Database Schema

```sql
-- Broker accounts
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broker TEXT NOT NULL,           -- 'robinhood' | 'webull'
    nickname TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- All trades
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    broker_trade_id TEXT,           -- For deduplication
    symbol TEXT NOT NULL,           -- OCC symbol for options
    asset_type TEXT NOT NULL,       -- 'stock' | 'option' | 'future'
    side TEXT NOT NULL,             -- 'buy' | 'sell'
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    fees REAL DEFAULT 0,
    executed_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expiration_date TEXT,           -- Options expiry
    review INTEGER DEFAULT 0,       -- 0=none, 1=reviewing, 2=reviewed
    expired_worthless INTEGER DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    UNIQUE(account_id, broker_trade_id)
);

-- Multi-leg strategies
CREATE TABLE strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Strategy-trade mapping
CREATE TABLE strategy_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    trade_id INTEGER NOT NULL,
    FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
    FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
    UNIQUE(strategy_id, trade_id)
);

-- Import history
CREATE TABLE imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,        -- 'csv' | 'pdf'
    trades_imported INTEGER DEFAULT 0,
    trades_skipped INTEGER DEFAULT 0,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);
```

---

## File Structure

```
TradeTracker/
├── CLAUDE.md              # Project rules & conventions
├── DEVLOG.md              # Development changelog
├── TECH.md                # This file
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js          # API client functions
│   │   ├── components/
│   │   │   ├── ImportButton.jsx   # Import/Export/Clear buttons
│   │   │   ├── PositionsTable.jsx # Main positions container
│   │   │   └── StrategiesView.jsx # Strategies & positions view
│   │   ├── App.jsx                # Main app with filters
│   │   └── main.jsx               # Entry point
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── trades.js
│   │   │   ├── strategies.js
│   │   │   ├── import.js
│   │   │   ├── stats.js
│   │   │   └── accounts.js
│   │   ├── services/
│   │   │   ├── tradeService.js    # FIFO matching, positions
│   │   │   ├── strategyService.js # Strategy metrics
│   │   │   ├── importService.js   # Import/export logic
│   │   │   └── accountService.js
│   │   ├── parsers/
│   │   │   ├── index.js
│   │   │   ├── robinhoodCsv.js
│   │   │   ├── webullCsv.js
│   │   │   └── robinhoodFuturesPdf.js
│   │   ├── utils/
│   │   │   └── optionParser.js    # OCC symbol parsing
│   │   ├── db/
│   │   │   ├── database.js        # DB connection & migrations
│   │   │   └── schema.js          # Schema definitions
│   │   └── index.js               # Express app entry
│   ├── package.json
│   └── data/
│       └── trades.db              # SQLite database file
│
└── data/                          # Sample import files
```

---

## Data Flow

### Import Flow
```
CSV/PDF File → Parser → Deduplicate → Insert Trades → Log Import
```

### Position Calculation (FIFO)
```
Trades → Group by Symbol → Sort by Date → Match Buys to Sells → Calculate P&L
```

### Strategy Creation
```
Select Trades → Drag to Basket → Name Strategy → Create → Link Trades
```

### Backup/Restore
```
Export: DB Tables → JSON File → Download
Import: JSON File → Parse → Clear DB → Insert All → Refresh UI
```

---

## Key Algorithms

### FIFO Position Matching
- Groups trades by underlying+expiry+strike+type (options) or symbol (stocks)
- Maintains buy/sell queues per group
- Matches oldest buys to sells (First In, First Out)
- Supports partial closes
- Tracks open positions and calculates P&L for closed positions

### Option Symbol Parsing (OCC Format)
```
Input:  SPXW260107P06920000
Output: { underlying: 'SPX', expiry: Date, strike: 6920, type: 'Put' }
```

### Review System
- Three states: 0 (none) → 1 (reviewing) → 2 (reviewed) → 0 (reset)
- Aggregated at position/strategy level using max of trade states

---

## Development

### Start Development Servers
```bash
# Terminal 1 - Backend
cd backend && npm start

# Terminal 2 - Frontend
cd frontend && npm run dev
```

### Ports
- Frontend: http://localhost:5173 (or 5174 if 5173 in use)
- Backend: http://localhost:3001

### Environment
- No environment variables required
- Single-user application (no authentication)
- SQLite database auto-created on first run
