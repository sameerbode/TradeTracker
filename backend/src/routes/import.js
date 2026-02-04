import { Router } from 'express';
import multer from 'multer';
import * as importService from '../services/importService.js';

const router = Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});

// POST /api/import/csv - Import CSV file
router.post('/csv', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const content = req.file.buffer.toString('utf-8');
        const result = await importService.importCsv(req.file.originalname, content);

        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// POST /api/import/pdf - Import PDF statement (for futures)
router.post('/pdf', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        if (!req.file.originalname.toLowerCase().endsWith('.pdf')) {
            return res.status(400).json({ error: 'File must be a PDF' });
        }

        const result = await importService.importPdf(req.file.originalname, req.file.buffer);

        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// GET /api/import/history - Get import history
router.get('/history', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const history = importService.getImportHistory(limit);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/import/export - Export all data as JSON backup
router.get('/export', (req, res) => {
    try {
        const backup = importService.exportAllData();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="tradetracker-backup-${new Date().toISOString().split('T')[0]}.json"`);
        res.json(backup);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/import/backup - Import JSON backup
router.post('/backup', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const content = req.file.buffer.toString('utf-8');
        let backup;
        try {
            backup = JSON.parse(content);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON file' });
        }

        const result = importService.importBackup(backup);
        res.json({
            success: true,
            restored: result
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

export default router;
