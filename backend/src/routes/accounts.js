import { Router } from 'express';
import * as accountService from '../services/accountService.js';

const router = Router();

// GET /api/accounts - List all accounts
router.get('/', (req, res) => {
    try {
        const accounts = accountService.getAllAccounts();
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/accounts/:id - Get single account
router.get('/:id', (req, res) => {
    try {
        const account = accountService.getAccountById(parseInt(req.params.id));
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }
        res.json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/accounts - Create account
router.post('/', (req, res) => {
    try {
        const { broker, nickname } = req.body;
        if (!broker) {
            return res.status(400).json({ error: 'Broker is required' });
        }
        if (!['robinhood', 'webull'].includes(broker.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid broker. Supported: robinhood, webull' });
        }
        const account = accountService.createAccount(broker.toLowerCase(), nickname);
        res.status(201).json(account);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/accounts/:id - Delete account and all its trades
router.delete('/:id', (req, res) => {
    try {
        const result = accountService.deleteAccount(parseInt(req.params.id));
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
