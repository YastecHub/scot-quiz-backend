import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import type { Question } from '../types';

const router = Router();

function parseQ(q: Question & { options: string }) {
  return { ...q, options: JSON.parse(q.options) };
}

// GET /api/quiz/subjects
router.get('/subjects', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT DISTINCT subject FROM questions ORDER BY subject').all() as { subject: string }[];
  res.json(rows.map(r => r.subject));
});

// GET /api/quiz/:subject  – questions for a subject (random, optional topic/limit filters)
router.get('/:subject', (req: Request, res: Response) => {
  const { subject } = req.params;
  const { topic, limit } = req.query as { topic?: string; limit?: string };

  let query = 'SELECT * FROM questions WHERE subject = ? COLLATE NOCASE';
  const params: unknown[] = [subject];

  if (topic) { query += ' AND topic = ?'; params.push(topic); }
  query += ' ORDER BY RANDOM()';

  const n = limit ? parseInt(limit, 10) : 200;
  if (n > 0) { query += ' LIMIT ?'; params.push(n); }

  const rows = db.prepare(query).all(...params) as (Question & { options: string })[];
  if (rows.length === 0) { res.status(404).json({ error: `No questions found for subject: ${subject}` }); return; }

  res.json(rows.map(parseQ));
});

// GET /api/quiz/:subject/:topic
router.get('/:subject/:topic', (req: Request, res: Response) => {
  const { subject, topic } = req.params;
  const { limit } = req.query as { limit?: string };
  const n = limit ? parseInt(limit, 10) : 200;

  const rows = db.prepare(
    'SELECT * FROM questions WHERE subject = ? COLLATE NOCASE AND topic = ? ORDER BY RANDOM() LIMIT ?'
  ).all(subject, topic, n) as (Question & { options: string })[];

  if (rows.length === 0) { res.status(404).json({ error: `No questions found for ${subject}/${topic}` }); return; }

  res.json(rows.map(parseQ));
});

export default router;
