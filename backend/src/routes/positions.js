import { Router } from 'express';
import * as positionService from '../services/positionService.js';
import { getDb } from '../db/database.js';

const router = Router();

// GET /api/positions - List all positions with trades and P&L
router.get('/', (req, res) => {
    try {
        const positions = positionService.getAllPositions();
        res.json(positions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/positions/why-options - List all why options
router.get('/why-options', (req, res) => {
    try {
        const db = getDb();
        const options = db.prepare('SELECT * FROM why_options ORDER BY label ASC').all();
        res.json(options);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/positions/why-options - Add a why option
router.post('/why-options', (req, res) => {
    try {
        const { label, note } = req.body;
        if (!label || !label.trim()) {
            return res.status(400).json({ error: 'Label is required' });
        }
        const db = getDb();
        const result = db.prepare('INSERT INTO why_options (label, note) VALUES (?, ?)').run(label.trim(), note || null);
        res.status(201).json({ id: result.lastInsertRowid, label: label.trim(), note: note || null });
    } catch (error) {
        if (error.message?.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Option already exists' });
        }
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/positions/why-options/:id - Update a why option
router.patch('/why-options/:id', (req, res) => {
    try {
        const { label, note } = req.body;
        const db = getDb();
        const updates = [];
        const params = [];
        if (label !== undefined) { updates.push('label = ?'); params.push(label.trim()); }
        if (note !== undefined) { updates.push('note = ?'); params.push(note); }
        if (updates.length === 0) return res.status(400).json({ error: 'No updates' });
        params.push(parseInt(req.params.id));
        const result = db.prepare(`UPDATE why_options SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        if (!result.changes) return res.status(404).json({ error: 'Option not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/positions/why-options/:id - Delete a why option
router.delete('/why-options/:id', (req, res) => {
    try {
        const db = getDb();
        const result = db.prepare('DELETE FROM why_options WHERE id = ?').run(parseInt(req.params.id));
        if (!result.changes) {
            return res.status(404).json({ error: 'Option not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/positions/merge - Merge multiple positions
router.post('/merge', (req, res) => {
    try {
        const { positionIds, name } = req.body;
        if (!Array.isArray(positionIds) || positionIds.length < 2) {
            return res.status(400).json({ error: 'At least 2 position IDs required' });
        }
        if (!name) {
            return res.status(400).json({ error: 'New position name is required' });
        }
        const position = positionService.mergePositions(positionIds, name);
        res.json(position);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/positions/recompute - Force recompute all positions
router.post('/recompute', (req, res) => {
    try {
        const result = positionService.recomputeAllPositions();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/positions - Create a new position
router.post('/', (req, res) => {
    try {
        const { name, tradeIds, notes } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Position name is required' });
        }
        const position = positionService.createPosition(name, tradeIds || [], notes || '');
        res.status(201).json(position);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/positions/:id - Update position
router.patch('/:id', (req, res) => {
    try {
        const { name, notes, why } = req.body;
        const result = positionService.updatePosition(parseInt(req.params.id), { name, notes, why });
        if (result === null) {
            return res.status(400).json({ error: 'No updates provided' });
        }
        if (!result) {
            return res.status(404).json({ error: 'Position not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/positions/:id - Delete position
router.delete('/:id', (req, res) => {
    try {
        const result = positionService.deletePosition(parseInt(req.params.id));
        if (!result) {
            return res.status(404).json({ error: 'Position not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/positions/:id/trades - Add trades to position
router.post('/:id/trades', (req, res) => {
    try {
        const { tradeIds } = req.body;
        if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
            return res.status(400).json({ error: 'tradeIds array is required' });
        }
        const result = positionService.addTradesToPosition(parseInt(req.params.id), tradeIds);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/positions/:id/trades - Remove trades from position
router.delete('/:id/trades', (req, res) => {
    try {
        const { tradeIds } = req.body;
        if (!Array.isArray(tradeIds) || tradeIds.length === 0) {
            return res.status(400).json({ error: 'tradeIds array is required' });
        }
        const result = positionService.removeTradesFromPosition(parseInt(req.params.id), tradeIds);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/positions/:id/ungroup - Split back into round trips
router.post('/:id/ungroup', (req, res) => {
    try {
        const result = positionService.ungroupPosition(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
