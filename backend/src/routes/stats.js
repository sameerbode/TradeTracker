import { Router } from 'express';
import * as statsService from '../services/statsService.js';

const router = Router();

// GET /api/stats - Get overall statistics
router.get('/', (req, res) => {
    try {
        const stats = statsService.getOverallStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/stats/daily - Get daily stats
router.get('/daily', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const stats = statsService.getDailyStats(days);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/stats/symbol/:symbol - Get stats for specific symbol
router.get('/symbol/:symbol', (req, res) => {
    try {
        const stats = statsService.getSymbolStats(req.params.symbol);
        if (!stats) {
            return res.status(404).json({ error: 'Symbol not found' });
        }
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
