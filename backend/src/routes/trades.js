import { Router } from 'express';
import * as tradeService from '../services/tradeService.js';
import { recomputePositionsAfterImport } from '../services/positionService.js';

const router = Router();

// GET /api/trades - List all trades with optional filters
router.get('/', (req, res) => {
    try {
        const filters = {
            symbol: req.query.symbol,
            asset_type: req.query.asset_type,
            side: req.query.side,
            broker: req.query.broker,
            account_id: req.query.account_id ? parseInt(req.query.account_id) : undefined,
            from_date: req.query.from_date,
            to_date: req.query.to_date,
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
        };

        const trades = tradeService.getAllTrades(filters);
        res.json(trades);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/trades/symbols - Get unique symbols
router.get('/symbols', (req, res) => {
    try {
        const symbols = tradeService.getUniqueSymbols();
        res.json(symbols);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/trades/:id - Get single trade
router.get('/:id', (req, res) => {
    try {
        const trade = tradeService.getTradeById(parseInt(req.params.id));
        if (!trade) {
            return res.status(404).json({ error: 'Trade not found' });
        }
        res.json(trade);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/trades - Delete all trades
router.delete('/', (req, res) => {
    try {
        const result = tradeService.deleteAllTrades();
        res.json({ success: true, deleted: result.changes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/trades/:id - Delete trade
router.delete('/:id', (req, res) => {
    try {
        const result = tradeService.deleteTrade(parseInt(req.params.id));
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Trade not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/trades/:id/review - Toggle review status for a single trade
router.patch('/:id/review', (req, res) => {
    try {
        const result = tradeService.toggleTradeReview(parseInt(req.params.id));
        if (!result) {
            return res.status(404).json({ error: 'Trade not found' });
        }
        res.json({ success: true, review: !!result.review });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/trades/review - Set review status for multiple trades
// status: 0=none, 1=reviewing, 2=reviewed
router.patch('/review', (req, res) => {
    try {
        const { tradeIds, status } = req.body;
        if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
            return res.status(400).json({ error: 'tradeIds array is required' });
        }
        if (typeof status !== 'number' || ![0, 1, 2].includes(status)) {
            return res.status(400).json({ error: 'status must be 0, 1, or 2' });
        }
        const result = tradeService.setTradesReview(tradeIds, status);
        res.json({ success: true, updated: result.changes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/trades/expire - Mark trades as expired worthless
router.post('/expire', (req, res) => {
    try {
        const { tradeIds } = req.body;
        if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
            return res.status(400).json({ error: 'tradeIds array is required' });
        }
        const result = tradeService.expireTrades(tradeIds);
        res.json({ success: true, updated: result.changes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/trades/split - Apply stock split adjustment to trades
router.post('/split', (req, res) => {
    try {
        const { tradeIds, ratio } = req.body;
        if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
            return res.status(400).json({ error: 'tradeIds array is required' });
        }
        if (typeof ratio !== 'number' || ratio <= 0) {
            return res.status(400).json({ error: 'ratio must be a positive number' });
        }
        const result = tradeService.applyStockSplit(tradeIds, ratio);
        recomputePositionsAfterImport(tradeIds);
        res.json({ success: true, updated: result.changes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
