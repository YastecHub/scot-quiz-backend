import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import type { Topic } from '../types';

const router = Router();

// GET /api/topics
router.get('/', (_req: Request, res: Response) => {
  const topics = db.prepare('SELECT * FROM topics ORDER BY subject, name').all() as Topic[];
  res.json(topics);
});

// GET /api/topics/:subject
router.get('/:subject', (req: Request, res: Response) => {
  const { subject } = req.params;
  const topics = db.prepare('SELECT * FROM topics WHERE subject = ? COLLATE NOCASE ORDER BY name').all(subject) as Topic[];
  if (topics.length === 0) { res.status(404).json({ error: `No topics found for subject: ${subject}` }); return; }

  const withCount = topics.map(t => {
    const row = db.prepare('SELECT COUNT(*) as count FROM questions WHERE subject = ? COLLATE NOCASE AND topic = ?').get(subject, t.slug) as { count: number };
    return { ...t, questionCount: row.count };
  });

  res.json(withCount);
});

export default router;
