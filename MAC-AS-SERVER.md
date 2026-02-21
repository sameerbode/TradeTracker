# TradeTracker: Mac as Local Server Architecture

**Goal:** Mac continuously runs Postgres + Backend. All devices (Windows, iPhone, iPad) sync automatically via local network. Data never leaves your home.

---

## Architecture

```
┌─────────────────────────────────────┐
│         YOUR MAC MINI               │
│  (Connected to network, running)    │
│                                     │
│  ┌──────────────────────────────┐   │
│  │  PostgreSQL Database         │   │
│  │  (your trades data)          │   │
│  └──────────────────────────────┘   │
│                ▲                     │
│                │                     │
│  ┌──────────────────────────────┐   │
│  │  Node.js Backend Server      │   │
│  │  Port 3001                   │   │
│  │  Listens on 0.0.0.0:3001     │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
         ▲  ▲  ▲  ▲
         │  │  │  │ (local network)
    ┌────┘  │  │  └────┐
    │       │  │       │
    ▼       ▼  ▼       ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ iPad │ │Phone │ │ PC   │ │Mac 2 │
│ WiFi │ │ WiFi │ │ WiFi │ │ WiFi │
└──────┘ └──────┘ └──────┘ └──────┘
     (all connect to Mac's IP)
```

---

## Components

### 1. Mac Server (Always Running)
- **OS:** macOS (your Mac mini)
- **Database:** PostgreSQL (installed locally)
- **Server:** Node.js Backend (TradeTracker API)
- **Listens on:** `192.168.x.x:3001` (local network IP)

### 2. Devices (Any OS)
- **Frontend:** Vercel-hosted React app (or local)
- **Connects to:** Mac's IP address
- **Data location:** Only on Mac, never cached on device

---

## Setup Steps

### Phase 1: Mac Setup

#### Step 1: Install PostgreSQL on Mac
```bash
# Using Homebrew
brew install postgresql@15

# Start PostgreSQL
brew services start postgresql@15

# Create database
createdb tradetracker

# Test connection
psql tradetracker
```

#### Step 2: Find Your Mac's Local IP
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```
**Output will look like:** `192.168.1.100` (write this down!)

#### Step 3: Configure PostgreSQL to Listen on Network
Edit `/opt/homebrew/var/postgresql@15/postgresql.conf`:
```
listen_addresses = '*'
```

Edit `/opt/homebrew/var/postgresql@15/pg_hba.conf` (add line):
```
host    all    all    192.168.1.0/24    trust
```
(Replace `192.168.1.0/24` with your network range)

Restart PostgreSQL:
```bash
brew services restart postgresql@15
```

#### Step 4: Update Backend Code

Change environment variable setup. In `backend/src/db/database.js`:

**Before:**
```javascript
const connectionString = process.env.DATABASE_URL;
```

**After:**
```javascript
const connectionString = process.env.DATABASE_URL || 
  'postgresql://localhost:5432/tradetracker';
```

Add to `.env` (on Mac):
```
DATABASE_URL=postgresql://localhost:5432/tradetracker
```

#### Step 5: Bind Backend to 0.0.0.0 (Listen on all interfaces)

In `backend/src/index.js`, change:
```javascript
// Before
app.listen(PORT, () => {

// After
app.listen(PORT, '0.0.0.0', () => {
```

This makes the backend accessible from other devices.

#### Step 6: Start Backend on Mac
```bash
cd ~/Projects/TradeTracker/backend
npm run dev
```

**Output should be:**
```
TradeTracker API running on http://0.0.0.0:3001
```

✅ **Mac is now the server!**

---

### Phase 2: Frontend Configuration

#### Step 7: Update Frontend API Endpoint

Create `.env` file in frontend (you can have multiple):

**Frontend - Development (connecting to Mac):**
```
# frontend/.env.local
VITE_API_BASE_URL=http://192.168.1.100:3001/api
```

Replace `192.168.1.100` with your Mac's actual IP.

**Frontend - Production (Vercel):**
Still need `VITE_API_BASE_URL` set in Vercel environment variables pointing to Mac.

---

### Phase 3: Device Setup

#### Step 8: Configure Other Devices

**Windows Laptop:**
1. Make sure it's on the same WiFi as Mac
2. Open TradeTracker app (Vercel URL)
3. App uses `VITE_API_BASE_URL` to connect to Mac
4. Everything works!

**iPad/iPhone:**
1. Same WiFi network
2. Open web app in browser
3. Connects to Mac automatically

**Another Mac:**
1. Update `.env.local` to point to first Mac's IP
2. Run `npm run dev`
3. Data syncs

---

## Network Considerations

### Local Network Only
This setup works **only on your home WiFi**. If you want to access from outside:

#### Option A: Use Tailscale (VPN)
```bash
# Install Tailscale
brew install tailscale
tailscale up

# Get Tailscale IP
tailscale ip -4
```
Then use Tailscale IP in `VITE_API_BASE_URL`:
```
VITE_API_BASE_URL=http://100.x.x.x:3001/api
```
Works from anywhere (office, coffee shop) — encrypted tunnel to your Mac.

#### Option B: SSH Tunnel (Advanced)
Forward port 3001 via SSH to access remotely.

#### Option C: ngrok (Temporary Testing)
```bash
brew install ngrok
ngrok http 3001
```
Gives you a public URL, but it's temporary.

---

## Keeping Mac Running

### macOS Settings
1. **System Settings → Energy Saver**
   - Disable sleep when plugged in
   - Set to never sleep (or long timeout)

2. **Terminal Command (Better):**
```bash
# Prevent sleep permanently
caffeinate -i &

# Or set wake-on-network
pmset -a womp 1
```

### Background Process

Keep backend running in background:
```bash
# Option 1: Use launchd (native macOS)
# Option 2: Use PM2 (Node process manager)
npm install -g pm2
pm2 start backend/src/index.js --name tradetracker
pm2 startup
```

---

## Data Backup

### Local Backups (on Mac)
Since data is on your Mac, standard Mac backup works:
- Time Machine
- iCloud Drive
- Carbon Copy Cloner

### Manual Postgres Backup
```bash
# Backup
pg_dump tradetracker > backup-$(date +%Y-%m-%d).sql

# Restore (if needed)
psql tradetracker < backup-2026-02-21.sql
```

---

## Troubleshooting

### "Can't connect to 192.168.1.100:3001"
1. Check Mac IP is correct: `ifconfig`
2. Check backend is running: `ps aux | grep node`
3. Check firewall: **System Settings → Security & Privacy → Firewall**
   - Click **Firewall Options**
   - Add Node.js to allowed apps

### "PostgreSQL connection refused"
1. Check if running: `brew services list`
2. Start if stopped: `brew services start postgresql@15`
3. Check logs: `tail -f /opt/homebrew/var/log/postgresql@15/postgres.log`

### "Frontend can't reach backend"
1. Verify Mac IP: `ping 192.168.1.100`
2. Verify port: `netstat -an | grep 3001`
3. Check `VITE_API_BASE_URL` in frontend `.env`

---

## File Structure

```
~/Projects/TradeTracker/

├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── database.js (connects to local Postgres)
│   │   │   └── schema.js
│   │   ├── index.js (listens on 0.0.0.0:3001)
│   │   ├── routes/
│   │   └── services/
│   └── .env (DATABASE_URL=postgresql://localhost:5432/tradetracker)
│
├── frontend/
│   ├── .env.local (VITE_API_BASE_URL=http://192.168.x.x:3001/api)
│   └── src/
│       └── api/client.js (uses VITE_API_BASE_URL)
│
└── MAC-AS-SERVER.md (this file)
```

---

## Implementation Checklist

- [ ] Install PostgreSQL on Mac
- [ ] Find Mac's local IP
- [ ] Configure PostgreSQL network access
- [ ] Update backend to use Postgres
- [ ] Update backend to listen on 0.0.0.0
- [ ] Start backend on Mac
- [ ] Create `.env.local` in frontend with Mac's IP
- [ ] Test from Windows/other device
- [ ] Configure Mac to prevent sleep
- [ ] Set up PM2 for persistent backend
- [ ] Backup strategy (Time Machine)
- [ ] Document Mac's IP address

---

## Comparison: Mac Server vs Cloud

| Feature | Mac Server | Cloud (Railway) |
|---------|-----------|-----------------|
| **Data Location** | Your home | Third-party servers |
| **Cost** | Electricity only | $5+/month |
| **Multi-device** | Automatic (LAN) | Automatic |
| **Outside home** | Requires VPN | Works anywhere |
| **Data loss** | Your backups | Their reliability |
| **Privacy** | Complete | Depends on provider |
| **Offline** | Yes (LAN) | No |
| **Complexity** | Moderate | Simple |

---

## Next Steps

1. **Phase 1:** Set up Mac as Postgres + Node server
2. **Phase 2:** Update frontend to point to Mac's IP
3. **Phase 3:** Test from multiple devices
4. **Phase 4:** Secure remote access (Tailscale)
5. **Phase 5:** Set up automated backups

---

**Timeline Estimate:**
- Initial setup: 1-2 hours
- Testing: 30 min
- Optimization: As needed

---

*Created: 2026-02-21*
*Author: Kavi ⚡*
