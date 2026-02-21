# TradeTracker Architecture Proposal: Zero Cloud Data

## Goal
Use free cloud services for **compute only** (running servers), but **keep all data local** — not stored on any third-party service.

---

## Current Architecture (Problem)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Railway   │────▶│  Railway DB │
│  (Frontend) │     │  (Backend)  │     │  (Postgres) │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                    YOUR DATA LIVES HERE
                                    (on Railway's servers)
```

**Problems:**
- Data stored on third-party servers
- Railway DB costs money after trial
- Data loss risk if service changes
- Privacy concerns

---

## Proposed Architecture Options

### Option A: Browser-First (IndexedDB)

```
┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Railway   │
│  (Frontend) │     │  (Backend)  │
└─────────────┘     └─────────────┘
       │                   │
       │              (stateless)
       │              (no database)
       ▼
┌─────────────┐
│  IndexedDB  │
│  (Browser)  │
└─────────────┘
       │
 YOUR DATA LIVES HERE
 (on YOUR device)
```

**How it works:**
- All trades stored in browser's IndexedDB
- Backend only handles CSV parsing (stateless)
- Data never leaves your device
- Export/Import JSON for backup & device sync

**Pros:**
- Truly free forever
- Complete privacy
- Works offline
- Fast (local storage)

**Cons:**
- Data tied to browser (clear cache = lose data)
- Need manual export/import between devices
- Browser storage limits (~50MB-1GB depending on browser)

**Best for:** Single device usage, privacy-focused

---

### Option B: File-Based (Session Model)

```
┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Railway   │
│  (Frontend) │     │  (Backend)  │
└─────────────┘     └─────────────┘
       │                   │
       │              (stateless)
       │              (processes files)
       │
       ▼
┌─────────────────────────────┐
│  User's Device              │
│  ┌───────────────────────┐  │
│  │  trades.json          │  │
│  │  (downloaded file)    │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**How it works:**
1. User opens app → uploads their `trades.json` file
2. App loads data into memory
3. User makes changes (import CSV, edit trades)
4. User clicks "Save" → downloads updated `trades.json`
5. Next session, upload the file again

**Pros:**
- Complete control over data
- Easy to backup (it's just a file)
- Works across devices (bring your file)
- No storage limits

**Cons:**
- Manual save/load each session
- Easy to forget to save
- File management overhead

**Best for:** Power users, multi-device, explicit control

---

### Option C: Hybrid (IndexedDB + File Sync)

```
┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Railway   │
│  (Frontend) │     │  (Backend)  │
└─────────────┘     └─────────────┘
       │                   │
       │              (stateless)
       ▼
┌─────────────┐
│  IndexedDB  │◀──── Auto-save
│  (Browser)  │
└─────────────┘
       │
       ▼ Manual Export/Import
┌─────────────┐
│ trades.json │ ◀─── Sync between devices
│  (File)     │      via Dropbox/Drive/USB
└─────────────┘
```

**How it works:**
- IndexedDB for daily use (auto-saves)
- Export to JSON for backup
- Import JSON to sync between devices
- Best of both worlds

**Pros:**
- Automatic saving (IndexedDB)
- Portable backups (JSON file)
- Sync via any cloud storage YOU control
- Privacy maintained

**Cons:**
- Slightly more complex
- Still need manual sync between devices

**Best for:** Best balance of convenience and control

---

### Option D: Bring Your Own Database (BYOD)

```
┌─────────────┐     ┌─────────────┐
│   Vercel    │────▶│   Railway   │
│  (Frontend) │     │  (Backend)  │
└─────────────┘     └─────────────┘
                          │
                          │ DATABASE_URL
                          │ (user provides)
                          ▼
              ┌─────────────────────┐
              │  User's Database    │
              │  ┌───────────────┐  │
              │  │ Local Postgres│  │
              │  │ Home Server   │  │
              │  │ NAS           │  │
              │  │ VPS           │  │
              │  └───────────────┘  │
              └─────────────────────┘
```

**How it works:**
- User runs their own Postgres (home server, Raspberry Pi, VPS)
- Enters their DATABASE_URL in app settings
- Backend connects to user's database
- Full database features, user owns the data

**Pros:**
- Full SQL database features
- User controls everything
- Can host anywhere
- Real multi-device sync

**Cons:**
- Requires technical setup
- User must maintain database
- Need static IP or tunnel for home server

**Best for:** Technical users, self-hosters

---

## Recommendation

**For TradeTracker, I recommend Option C (Hybrid):**

1. **Primary storage:** IndexedDB in browser
2. **Backup/Sync:** JSON file export/import
3. **Backend:** Stateless (only parses CSV/PDF)

This gives you:
- ✅ Zero cloud data storage
- ✅ Free hosting forever
- ✅ Privacy (data on your device)
- ✅ Convenience (auto-save)
- ✅ Portability (JSON backup)
- ✅ Works offline

---

## Implementation Plan (Option C)

### Phase 1: Move Storage to Frontend

**Step 1:** Add IndexedDB library to frontend
```bash
cd frontend
npm install idb
```

**Step 2:** Create IndexedDB wrapper
- `frontend/src/db/indexedDb.js`
- Tables: trades, accounts, strategies, imports

**Step 3:** Migrate all data operations to frontend
- Currently: Frontend → API → SQLite
- New: Frontend → IndexedDB (local)

### Phase 2: Make Backend Stateless

**Step 4:** Remove database from backend
- Delete `backend/src/db/` folder
- Remove `better-sqlite3` dependency

**Step 5:** Backend only handles:
- CSV parsing (`POST /api/parse/csv`)
- PDF parsing (`POST /api/parse/pdf`)
- Returns parsed data, doesn't store it

**Step 6:** Frontend stores parsed data in IndexedDB

### Phase 3: Add Export/Import

**Step 7:** Export feature
- Export all IndexedDB data as JSON
- Download as `tradetracker-backup-YYYY-MM-DD.json`

**Step 8:** Import feature
- Upload JSON backup
- Merge or replace IndexedDB data

### Phase 4: Deploy

**Step 9:** Update Railway
- Backend is now stateless
- No database needed
- Cheaper/free tier works fine

**Step 10:** Test
- Import CSV
- Verify data persists in browser
- Export backup
- Import on different device

---

## File Changes Summary

### Frontend (New/Modified)
| File | Action |
|------|--------|
| `src/db/indexedDb.js` | NEW - IndexedDB wrapper |
| `src/db/migrations.js` | NEW - Schema versioning |
| `src/hooks/useDatabase.js` | NEW - React hook for DB |
| `src/api/client.js` | MODIFY - Local-first logic |
| `src/components/ExportButton.jsx` | NEW |
| `src/components/ImportBackup.jsx` | MODIFY |
| `package.json` | ADD `idb` package |

### Backend (Modified/Deleted)
| File | Action |
|------|--------|
| `src/db/*` | DELETE - No more database |
| `src/services/*` | DELETE or SIMPLIFY |
| `src/routes/parse.js` | NEW - Stateless parsing |
| `src/routes/trades.js` | DELETE |
| `src/routes/accounts.js` | DELETE |
| `src/routes/strategies.js` | DELETE |
| `package.json` | REMOVE `better-sqlite3` |

---

## Timeline Estimate

| Phase | Time |
|-------|------|
| Phase 1: IndexedDB Setup | 2-3 hours |
| Phase 2: Backend Stateless | 1-2 hours |
| Phase 3: Export/Import | 1 hour |
| Phase 4: Deploy & Test | 30 min |
| **Total** | **5-7 hours** |

---

## Questions to Decide

1. **Option A, B, C, or D?** (I recommend C)
2. **Keep backend at all?** (Could go frontend-only with client-side CSV parsing)
3. **Sync between devices?** (Manual JSON, or integrate with Dropbox/Drive API?)

---

*Created: 2026-02-21*
*Author: Kavi ⚡*
