import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import type { Resource } from '../types';

const router = Router();

// GET /api/resources
router.get('/', (req: Request, res: Response) => {
  const { subject } = req.query as { subject?: string };
  let rows: Resource[];
  if (subject && subject !== 'All') {
    rows = db.prepare('SELECT * FROM resources WHERE subject = ? COLLATE NOCASE ORDER BY subject, title').all(subject) as Resource[];
  } else {
    rows = db.prepare('SELECT * FROM resources ORDER BY subject, title').all() as Resource[];
  }
  res.json(rows);
});

// GET /api/resources/:id
router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(req.params.id)) as Resource | undefined;
  if (!row) { res.status(404).json({ error: 'Resource not found.' }); return; }
  res.json(row);
});

export default router;
