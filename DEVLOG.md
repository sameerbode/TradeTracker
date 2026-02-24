# TradeTracker Development Log

## Project Overview
A personal trade tracking application that aggregates trades from multiple brokerages (Robinhood, Webull) into a unified dashboard with statistics and analytics.

---

## Changelog

### 2026-02-23 - Fix Symbol Sort Mismatch for Multi-Leg Positions

Multi-leg positions have no `displaySymbol` (undefined), which got converted to `Infinity` in the sort comparator. Comparing a string vs `Infinity` falls through to `aVal - bVal`, returning `NaN`. JavaScript sort treats `NaN` as 0 (equal), so multi-leg items kept their backend `created_at DESC` order rather than sorting alphabetically — causing them to appear in the wrong position. Only visible in prod because local data coincidentally hid it.

Fixed by using the displayed value in the sort: `name` for multi-leg positions, `displaySymbol` for simple ones.

**Files changed:** `frontend/src/components/PositionsView.jsx`

---

### 2026-02-23 16:00 - Fix Cross-Broker Position Grouping (Retroactive)

Commit 2372f69 fixed new position creation to group by broker, but existing positions in the DB that were created before the fix still contained cross-broker trades. Added a startup migration that detects and fixes these.

**Root cause:** Positions created before the broker-grouping fix had trades from multiple `account_id`s merged into single positions (e.g., AAPL trades from both Robinhood and Webull in one position).

**Fix:** Added `fixCrossBrokerPositions()` migration in `database.js` that runs on startup:
1. Finds simple (unnamed) positions where `COUNT(DISTINCT account_id) > 1`
2. Deletes those positions
3. Recomputes round trips using `computeRoundTripsFromTrades()` which groups by `symbol_assetType_accountId`
4. Idempotent — becomes a no-op once all cross-broker positions are fixed

**Result:** 35 cross-broker positions were split into 73 correctly-separated positions.

**Changes:**
- `backend/src/db/database.js`: Added `fixCrossBrokerPositions()` migration function, called during `getDb()` startup

### 2026-02-23 15:00 - Stock Split Per-Trade Adjustment

Added the ability to apply stock split adjustments to individual stock trades. When a stock splits, pre-split trades have incorrect quantity/price which prevents round-trip positions from closing. This feature adjusts quantity and price while keeping the total (cash) unchanged, then recomputes positions.

**Features:**
- Split icon on each stock trade row in the expanded position view
- Modal with quick-pick buttons for common forward splits (2:1 through 20:1) and reverse splits (1:2 through 1:10)
- Custom ratio input for non-standard splits
- Preview showing the resulting quantity before applying
- Automatic position recomputation after split is applied

**Changes:**
- `backend/src/services/tradeService.js`: Added `applyStockSplit(tradeIds, ratio)` - multiplies quantity by ratio, divides price by ratio, total unchanged
- `backend/src/routes/trades.js`: Added `POST /api/trades/split` endpoint with validation, calls `recomputePositionsAfterImport` to re-form positions
- `frontend/src/api/client.js`: Added `applyStockSplit()` API function
- `frontend/src/components/ActionToolbar.jsx`: Removed position-level split action (moved to per-trade)
- `frontend/src/components/PositionsView.jsx`: Added split icon to stock trade rows, split modal with forward/reverse presets + custom input, splitMutation

### 2026-02-23 - Integrate ActionToolbar as Gear Icon in Position Rows

Replaced the expand chevron with a gear icon at the start of each position row. Clicking the gear reveals contextual action icons inline (Note, Stock Split, Mark Expired, Ungroup). Rows still expand/collapse on click.

**Features:**
- Gear icon at the start of each row (replaces chevron); click to toggle action icons
- Actions shown based on position type: Note (always), Stock Split (stocks), Mark Expired (options), Ungroup (multi-leg)
- Modern SVG icons (Heroicons-style), gear highlights purple when open
- Notes modal: edit/save per-position notes via textarea modal (consistent with Why modal style)
- Small purple dot indicator on rows that have notes (click to view/edit)
- Stock Split action shows "coming soon" placeholder (no backend yet)

**Changes:**
- `ActionToolbar.jsx`: Gear icon toggle + contextual action icons, clean SVG icons, no floating/hover needed
- `PositionsView.jsx`: Replaced chevron with ActionToolbar gear, added `openGearRow` state, notes modal, purple dot notes indicator
- `PositionsView.jsx`: Updated `updatePositionMutation` to accept arbitrary fields (supports `notes`)

### 2026-02-21 - Unified Positions Table Refactor

Replaced the dual-system (on-the-fly round trips + strategies table) with a single `positions` table. All positions are now first-class DB records, enabling "why" assignment to any position.

**Database Changes:**
- New `positions` table (id, name, notes, why, status, created_at)
- New `position_trades` table (position_id, trade_id, UNIQUE(trade_id))
- Auto-migration from `strategies`/`strategy_trades` on startup
- Unclaimed trades computed into round-trip positions during migration

**Backend Changes:**
- `backend/src/utils/tradeUtils.js` — Shared utilities extracted from tradeService
- `backend/src/services/positionService.js` — Full CRUD, ungroup, merge, recompute
- `backend/src/routes/positions.js` — All position endpoints under `/api/positions`
- `backend/src/services/importService.js` — Recomputes positions after import, v2 export format
- Removed `strategyService.js`, `routes/strategies.js`
- Cleaned up `tradeService.js` (removed getPositions, getRoundTripPositions)

**Frontend Changes:**
- `frontend/src/api/client.js` — All calls now use `/positions` endpoints
- `frontend/src/components/StrategiesView.jsx` — Single `getPositions()` query, "why" works on all rows
- `frontend/src/components/ImportButton.jsx` — Updated query invalidation

**Key behavior:**
- Purple rows = multi-leg (user-grouped or multi-symbol positions)
- White rows = simple round trips (auto-computed)
- "Why" dropdown works on ALL positions
- Backup export v2 includes positions; v1 backups auto-migrate on import
- `POST /api/positions/recompute` to force-rebuild all simple positions

### 2026-02-09 14:00 - Import History with Delete

Added the ability to view import history and delete entire imports (along with their trades). This helps users undo overlapping CSV imports where deduplication may not catch everything due to `broker_trade_id` including `rowIndex`.

**Changes:**
- **Backend**: Added `deleteImport()` service function that deletes strategy_trades references, trades, and the import record in a transaction. Added `DELETE /api/import/:id` route.
- **Frontend**: Added `deleteImport()` API client function. Added import history panel to `ImportButton` component with a clock icon toggle, showing each import's filename, broker, trade count, date, and a delete button with confirmation.

### 2026-02-08 - Import Source Info Icon on Trades

Added an info icon next to the broker name in the All Trades view that shows which file the trade was imported from on hover.

**Backend Changes:**
- `database.js`: Migration to add `import_id` column to trades table
- `tradeService.js`: Updated `insertTrades()` to accept and store `import_id`; updated `getAllTrades()` to JOIN imports table and return `import_filename`
- `importService.js`: `logImport()` now returns the import ID; added `updateImportCounts()` to update counts after insert; import record created before trades so `import_id` is available

**Frontend Changes:**
- `TradeTable.jsx`: Info icon (circle-i) next to broker name with tooltip showing the import filename on hover

**Note:** Existing trades won't have an `import_filename` (no icon shown). Only newly imported trades will track their source file.

---

### 2026-02-08 - Fix Webull Options Total Calculation

Fixed Webull CSV parser not applying the 100x contract multiplier for options.

**Problem:** When the `Total` column was missing from Webull CSV, the fallback calculated `quantity * price` instead of `quantity * price * 100` for options. This meant a 1-contract option at $1.00 showed $1 total instead of $100.

**Fix (webullCsv.js):**
- Moved total calculation after asset type detection so the multiplier can be applied
- Options now correctly use `quantity * price * 100` as fallback
- Stocks and futures still use `quantity * price`

---

### 2026-02-03 - Technical Documentation

Created `TECH.md` with comprehensive technical documentation including:
- Tech stack table (React, Vite, TailwindCSS, Express, SQLite, etc.)
- Architecture diagram (Frontend → REST API → Backend → SQLite)
- All API endpoints with methods and descriptions
- Complete database schema with all columns
- File structure overview
- Data flow diagrams (Import, FIFO, Strategy, Backup)
- Key algorithms (FIFO matching, OCC parsing, Review system)
- Development setup instructions

---

### 2026-02-03 - Export/Import Backup Feature

Added ability to download complete data backup and restore from it.

**Backend Changes (importService.js):**
- `exportAllData()` - exports accounts, trades, strategies, strategy_trades as JSON
- `importBackup()` - restores from JSON backup, clears existing data first, uses transaction

**Backend Routes (import.js):**
- `GET /api/import/export` - download JSON backup file
- `POST /api/import/backup` - upload and restore from JSON backup

**Frontend Changes:**
- `client.js`: Added `exportBackup()` and `importBackup()` functions
- `ImportButton.jsx`: Added green "Download Backup" button
- File input now accepts `.json` for backup restoration
- Result display shows restore summary (accounts, trades, strategies count)
- Invalidates all queries (including strategies, positions) after restore

**Backup JSON Structure:**
```json
{
  "version": 1,
  "exportedAt": "ISO timestamp",
  "data": {
    "accounts": [...],
    "trades": [...],
    "strategies": [...],
    "strategyTrades": [...]
  }
}
```

**Flow:**
1. Click "Download Backup" - downloads `tradetracker-backup-YYYY-MM-DD.json`
2. Click "Import Trades" - select the `.json` file
3. All data restored including strategies and review states

---

### 2026-02-02 19:00 - Manual Expired Options in Strategies

Removed auto-detection of expired options. Now requires manual "Mark Expired" action.

**Backend Changes (strategyService.js):**
- `calculateStrategyMetrics()` no longer auto-calculates P&L for expired options
- Added `pendingExpiryLegs` array for options past expiry but not yet marked
- Only calculates P&L for legs where `expired_worthless` flag is set
- Strategy status shows `pending_expiry` when action is needed

**Frontend Changes (StrategiesView.jsx):**
- Added `expireMutation` for marking trades as expired
- Orange "Expired Options - Action Required" section with "Mark All Expired" button
- Individual "Mark Expired" buttons per leg
- Red "Expired Worthless" section shows already-marked expired legs with P&L
- Status badge shows "action required" for `pending_expiry` status

---

### 2026-02-02 20:00 - UI Cleanup and Dynamic Stats

Simplified the UI by removing unused views and making stats dynamic.

**Removed:**
- FIFO view (PositionsTable now only shows StrategiesView)
- Round Trip view
- Queue view and "Review" status filter button
- Static StatsCards component

**Added - Dynamic Stats:**
Stats cards now display at the top of StrategiesView and update based on current filter:
- Positions count (filtered)
- Total trades count
- Volume (buy + sell totals)
- Total P&L (with color coding)
- Top symbol shown in header

**File Changes:**
- `App.jsx`: Removed Queue button and StatsCards import
- `PositionsTable.jsx`: Simplified to just render StrategiesView
- `StrategiesView.jsx`: Added dynamic stats calculation and display

**Benefits:**
- Stats reflect what user is currently viewing (e.g., only closed positions)
- Cleaner UI with fewer tabs/buttons
- Single view for all position management

---

### 2026-02-02 19:30 - Multiple Strategy Baskets

Changed from single basket to multiple baskets to allow organizing all trades before creating strategies.

**Problem Solved:**
When creating a strategy, positions with ANY trades in a strategy disappear from the ungrouped list. This made it hard to organize related options that were in the same position.

**Features:**
- Multiple baskets displayed in a grid (responsive: 1/2/3 columns)
- "+ Add Basket" button to create new empty baskets
- Each basket has its own name and items
- "Create Strategy" button per basket
- "Create All Strategies" button when multiple baskets have items
- Trades can only be in ONE basket (prevents duplicates across baskets)
- Empty baskets can be removed (always keeps at least one)
- Stable position keys using trade IDs instead of array indices

**UX Flow:**
1. Add multiple baskets as needed
2. Expand positions and drag trades to appropriate baskets
3. Name each strategy
4. Either create individually or use "Create All Strategies"

---

### 2026-02-02 18:15 - Three-State Review System

Changed review from boolean toggle to three-state system for proper tracking.

**Review States (database: review column as INTEGER):**
- `0` = Not reviewed (gray "Review" button)
- `1` = Reviewing (orange "Reviewing" button - click to complete)
- `2` = Reviewed (green checkmark badge - final state)

**Flow (circular):** Review → Reviewing → Reviewed → Review (click to reset)

**Backend Changes:**
- `tradeService.js`: Updated `setTradesReview()` to accept status (0, 1, 2)
- `tradeService.js`: Added `getReviewStatus()` helper for aggregating status
- `tradeService.js`: Changed `review` property to `reviewStatus` in positions (FIFO & RoundTrip)
- `strategyService.js`: Added `reviewStatus` to strategy metrics
- `trades.js`: Updated PATCH /api/trades/review to validate status parameter

**Frontend Changes:**
- `client.js`: Updated `setTradesReview()` to send `status` instead of `review`
- `PositionsTable.jsx`: Three-state button display with appropriate colors
- `StrategiesView.jsx`: Updated to use three-state review system

---

### 2026-02-02 18:00 - FIFO View Redesign

Major redesign of FIFO position matching for options to support partial closes and manual expiration.

**Key Changes:**

1. **New Option Matching Logic**
   - Options now grouped by underlying+expiry+strike+type instead of full OCC symbol
   - Added `getGroupingKey()` function that parses options and groups by components
   - Supports partial closes (buy 3, sell 2 → 1 open position)

2. **Manual Expiration (No Auto-Expiry)**
   - Added `expired_worthless` column to trades table
   - New `pending_expiry` status for positions past expiration that haven't been manually marked
   - `POST /api/trades/expire` endpoint to mark trades as expired
   - Orange "Expired (Action)" badge with "Mark Expired" button

3. **Split Option Columns in Table**
   - Symbol: Shows underlying (AAPL instead of full OCC)
   - C/P: Green C or Red P badge
   - Strike: $150 format
   - Expiry: Date format

4. **Status Badge Colors**
   - Open: Yellow
   - Closed: Green
   - Pending Expiry: Orange
   - Expired: Red

**Files Modified:**
- `backend/src/db/database.js` - Migration for expired_worthless column
- `backend/src/db/schema.js` - Added expired_worthless column
- `backend/src/services/tradeService.js` - New matching logic, getGroupingKey(), expireTrades()
- `backend/src/routes/trades.js` - POST /api/trades/expire endpoint
- `frontend/src/api/client.js` - expireTrades() API call
- `frontend/src/components/PositionsTable.jsx` - New columns, expire button, status badges

---

### 2026-02-02 17:30 - Expired Legs in Strategies (Hybrid Approach)
Auto-detect expired legs in multi-leg strategies with visual indicator and details.

**Backend Changes (strategyService.js):**
- Added `isOptionExpired()` helper function
- Enhanced `calculateStrategyMetrics()` to:
  - Group trades by contract (symbol)
  - Detect unbalanced legs with past expiration
  - Calculate P&L impact per expired leg:
    - Long (BTO) expired → loss (premium lost)
    - Short (STO) expired → profit (premium kept)
  - Return `expiredLegs` array with details
  - Set status to "expired" when all legs closed/expired

**Frontend Changes (StrategiesView.jsx):**
- Orange "X expired" badge on strategies with expired legs
- Expanded view shows "Expired Legs" section:
  - Contract name in option format
  - Position type (Long BTO / Short STO)
  - Quantity and expiration date
  - P&L impact with "(lost)" or "(kept)" label
- Status badge shows "expired" in red

---

### 2026-02-02 17:00 - Short Position Support (Sell to Open)
Added support for short positions (STO - Sell to Open) that were previously missing from positions view.

**FIFO Function Updates (tradeService.js):**
- Added `openSells` queue to track short positions
- Buys first try to close open shorts (Buy to Close)
- Remaining sells become open short positions
- Short positions show negative quantity

**Round Trip Function Updates (tradeService.js):**
- Handle `netQty < 0` case (more sells than buys)
- Short options that expire worthless = 100% profit (keep premium)
- Open short positions tracked with negative quantity

---

### 2026-02-02 16:30 - Strategies Sorting Fix
Changed strategies to sort together with positions instead of being pinned to top.
- Strategies and positions now mixed and sorted by selected criteria
- Purple highlight still distinguishes strategies

---

### 2026-02-02 16:00 - Individual Trade Drag & Drop
Modified Strategies view to allow dragging individual trades instead of whole positions.

**Frontend Changes (StrategiesView.jsx):**
- Added `formatOptionDisplay()` function for "AAPL 230C 1/6/26" format
- Individual trades in expanded rows are now draggable
- Drag handle icon (dots) on each trade row
- Full option format displayed in blue text
- Visual feedback (purple ring) on valid drop targets

**Backend Changes (tradeService.js):**
- Added `symbol`, `asset_type`, `expiration_date` to trades array in positions

---

## Historical Sessions (Pre-2026-02-02)

### Session 3 - Strategies & Multi-Leg Options

**Strategies Feature Created:**
- Database tables: `strategies`, `strategy_trades`
- API endpoints for CRUD operations
- strategyService.js for business logic

**Strategies View (Frontend):**
- New "Strategies" tab in Positions table
- Drag & drop interface for creating strategies
- Purple highlight distinguishes strategies
- Inline rename by clicking strategy name
- "Ungroup" button to dissolve strategy

---

### Session 2 - Positions & Options Handling

**FIFO Position Matching:**
- Implemented FIFO algorithm for matching buys to sells
- Calculates P&L for each closed position
- Tracks open positions (unmatched buys)

**Round Trip Position Matching:**
- Alternative grouping until quantity balances
- Groups all buys and sells until net position = zero

**Option Symbol Parsing:**
- Created `optionParser.js` utility
- Parses OCC format: `SPXW260107P06920000` → `SPX 1/7/26 $6920 P`

**Expiration Date Handling:**
- Added `expiration_date` column to trades table
- Parse from Robinhood CSV: `"RTX 3/20/2026 Call $185.00"`
- Parse from Webull OCC symbol format
- Expired options detection and -100% P&L

---

### Session 1 - Initial Setup & Core Features

**Database Schema:**
- SQLite with tables: `accounts`, `trades`, `imports`
- `broker_trade_id` for deduplication

**Import Parsers:**
- Robinhood CSV Parser (stocks, options)
- Webull CSV Parser (all trades)
- Robinhood PDF Parser (futures from statements)

**Core API Endpoints:**
- Trades CRUD, Import CSV/PDF, Stats, Accounts

---

## Technical Reference

### Option Format Display
```javascript
// formatOptionDisplay() - Frontend helper
// Input: "SPXW260107P06920000" (OCC format)
// Output: "SPX 6920P 1/7/26"
```

### P&L Calculations
- Long position P&L: `sellTotal - buyTotal`
- Short position P&L: `sellTotal - buyTotal` (sell comes first)
- Expired long: P&L = `-buyTotal` (100% loss)
- Expired short: P&L = `+sellTotal` (100% profit)

### Trade Data Structure
```javascript
{
    id, symbol, displaySymbol, asset_type,
    quantity,  // negative for shorts
    buyTotal, sellTotal, buyDate, sellDate,
    pnl, pnlPercent,
    status,  // 'open' | 'closed' | 'pending_expiry' | 'expired'
    reviewStatus,  // 0=none, 1=reviewing, 2=reviewed
    expirationDate,
    optionInfo: { underlying, expiry, strike, type, typeShort },  // null for non-options
    trades: [{ id, symbol, asset_type, side, quantity, price, total, executed_at, expiration_date }]
}
```

### Strategy Data Structure
```javascript
{
    id, name, notes, created_at,
    tradeIds, trades,
    totalBuy, totalSell, pnl, pnlPercent,
    status,  // 'open' | 'closed' | 'expired' | 'empty'
    symbols, legs,
    expiredLegs: [{ symbol, displaySymbol, type, quantity, expiredValue, pnlImpact, expiration_date }],
    hasExpiredLegs
}
```

---

## File Structure
```
TradeTracker/
├── CLAUDE.md              # Project rules & conventions
├── DEVLOG.md              # This development log
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── PositionsTable.jsx
│       │   └── StrategiesView.jsx
│       └── api/
│           └── client.js
├── backend/
│   └── src/
│       ├── routes/
│       │   └── strategies.js
│       ├── services/
│       │   ├── tradeService.js
│       │   └── strategyService.js
│       ├── parsers/
│       │   └── robinhoodCsv.js
│       ├── utils/
│       │   └── optionParser.js
│       └── db/
│           ├── database.js
│           └── schema.js
└── data/
    └── trades.db
```

---

## Future Considerations
- Manual override for auto-detected expired legs
- Strategy templates (Iron Condor, Butterfly, etc.)
- Import strategies from broker if available
- P&L charts per strategy
- Risk/reward analysis for open strategies
