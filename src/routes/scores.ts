import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { requireAuth } from '../middleware/auth';
import type { Score } from '../types';

const router = Router();

// GET /api/scores
router.get('/', requireAuth, (req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user!.id) as Score[];
  res.json(rows);
});

// GET /api/scores/summary
router.get('/summary', requireAuth, (req: Request, res: Response) => {
  const summary = db.prepare(`
    SELECT subject,
           COUNT(*) as sessions,
           SUM(correct) as total_correct,
           SUM(total) as total_questions,
           ROUND(AVG(pct), 1) as avg_pct,
           MAX(pct) as best_pct
    FROM scores WHERE user_id = ?
    GROUP BY subject ORDER BY subject
  `).all(req.user!.id);
  res.json(summary);
});

// POST /api/scores
router.post('/', requireAuth, (req: Request, res: Response, next) => {
  if (req.user!.is_admin) { res.status(403).json({ error: 'Admins cannot record practice scores.' }); return; }
  next();
}, (req: Request, res: Response) => {
  const { subject, topic, correct, total } = req.body as {
    subject?: string; topic?: string; correct?: number; total?: number;
  };
  if (!subject || correct === undefined || !total) {
    res.status(400).json({ error: 'subject, correct and total are required.' }); return;
  }
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const result = db.prepare(
    'INSERT INTO scores (user_id, subject, topic, correct, total, pct) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user!.id, subject, topic ?? null, correct, total, pct);
  const saved = db.prepare('SELECT * FROM scores WHERE id = ?').get(result.lastInsertRowid) as Score;
  res.status(201).json(saved);
});

export default router;
