import express from 'express';
import cors from 'cors';
import { getDb, closeDb } from './db/database.js';

import tradesRouter from './routes/trades.js';
import accountsRouter from './routes/accounts.js';
import statsRouter from './routes/stats.js';
import importRouter from './routes/import.js';
import positionsRouter from './routes/positions.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
getDb();

// Routes
app.use('/api/trades', tradesRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/import', importRouter);
app.use('/api/positions', positionsRouter);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    closeDb();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`TradeTracker API running on http://localhost:${PORT}`);
});
