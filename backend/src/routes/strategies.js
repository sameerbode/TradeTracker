import { Router } from 'express';
import * as strategyService from '../services/strategyService.js';

const router = Router();

// GET /api/strategies - List all strategies with trades and P&L
router.get('/', (req, res) => {
    try {
        const strategies = strategyService.getAllStrategies();
        res.json(strategies);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/strategies/grouped-trades - Get trade IDs that are in strategies
router.get('/grouped-trades', (req, res) => {
    try {
        const tradeIds = strategyService.getGroupedTradeIds();
        res.json(tradeIds);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/strategies - Create a new strategy
router.post('/', (req, res) => {
    try {
        const { name, tradeIds, notes } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Strategy name is required' });
        }
        const strategy = strategyService.createStrategy(name, tradeIds || [], notes || '');
        res.status(201).json(strategy);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/strategies/:id - Update strategy
router.patch('/:id', (req, res) => {
    try {
        const { name, notes } = req.body;
        const result = strategyService.updateStrategy(parseInt(req.params.id), { name, notes });
        if (result === null) {
            return res.status(400).json({ error: 'No updates provided' });
        }
        if (!result) {
            return res.status(404).json({ error: 'Strategy not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/strategies/:id - Delete strategy
router.delete('/:id', (req, res) => {
    try {
        const result = strategyService.deleteStrategy(parseInt(req.params.id));
        if (!result) {
            return res.status(404).json({ error: 'Strategy not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/strategies/:id/trades - Add trades to strategy
router.post('/:id/trades', (req, res) => {
    try {
        const { tradeIds } = req.body;
        if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
            return res.status(400).json({ error: 'tradeIds array is required' });
        }
        const result = strategyService.addTradesToStrategy(parseInt(req.params.id), tradeIds);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/strategies/:id/trades - Remove trades from strategy
router.delete('/:id/trades', (req, res) => {
    try {
        const { tradeIds } = req.body;
        if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
            return res.status(400).json({ error: 'tradeIds array is required' });
        }
        const result = strategyService.removeTradesFromStrategy(parseInt(req.params.id), tradeIds);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/strategies/merge - Merge multiple strategies
router.post('/merge', (req, res) => {
    try {
        const { strategyIds, name } = req.body;
        if (!Array.isArray(strategyIds) || strategyIds.length < 2) {
            return res.status(400).json({ error: 'At least 2 strategy IDs required' });
        }
        if (!name) {
            return res.status(400).json({ error: 'New strategy name is required' });
        }
        const strategy = strategyService.mergeStrategies(strategyIds, name);
        res.json(strategy);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
