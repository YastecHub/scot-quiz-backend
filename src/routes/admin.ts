/**
 * Admin Routes – requires is_admin = true
 */
import { Router, Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../db/database';
import { requireAdmin } from '../middleware/auth';
import type { Question, Test, Attempt, Resource } from '../types';

// ─── FILE UPLOAD SETUP ────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed.'));
  },
});

const router = Router();
router.use(requireAdmin);

// ─── QUESTION BANK ────────────────────────────────────────────

// GET /api/admin/questions
router.get('/questions', (req: Request, res: Response) => {
  const { subject } = req.query as { subject?: string };
  let rows: (Question & { options: string })[];
  if (subject) {
    rows = db.prepare('SELECT * FROM questions WHERE subject = ? COLLATE NOCASE ORDER BY subject, topic').all(subject) as any;
  } else {
    rows = db.prepare('SELECT * FROM questions ORDER BY subject, topic').all() as any;
  }
  res.json(rows.map(q => ({ ...q, options: JSON.parse(q.options) })));
});

// POST /api/admin/questions
router.post('/questions', (req: Request, res: Response) => {
  const { subject, topic, question, options, answer_index, explanation, exam_source } = req.body as {
    subject?: string; topic?: string; question?: string;
    options?: string[]; answer_index?: number; explanation?: string; exam_source?: string;
  };
  if (!subject || !question || !Array.isArray(options) || options.length < 2 || answer_index === undefined) {
    res.status(400).json({ error: 'subject, question, options (array ≥2) and answer_index are required.' }); return;
  }
  if (answer_index < 0 || answer_index >= options.length) {
    res.status(400).json({ error: 'answer_index out of range.' }); return;
  }
  const result = db.prepare(
    'INSERT INTO questions (subject, topic, question, options, answer_index, explanation, exam_source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(subject, topic ?? '', question, JSON.stringify(options), answer_index, explanation ?? '', exam_source ?? '', req.user!.id);
  const created = db.prepare('SELECT * FROM questions WHERE id = ?').get(result.lastInsertRowid) as Question & { options: string };
  res.status(201).json({ ...created, options: JSON.parse(created.options) });
});

// PUT /api/admin/questions/:id
router.put('/questions/:id', (req: Request, res: Response) => {
  const { subject, topic, question, options, answer_index, explanation, exam_source } = req.body;
  db.prepare(
    'UPDATE questions SET subject = ?, topic = ?, question = ?, options = ?, answer_index = ?, explanation = ?, exam_source = ? WHERE id = ?'
  ).run(subject, topic ?? '', question, JSON.stringify(options), answer_index, explanation ?? '', exam_source ?? '', Number(req.params.id));
  const updated = db.prepare('SELECT * FROM questions WHERE id = ?').get(Number(req.params.id)) as (Question & { options: string }) | undefined;
  if (!updated) { res.status(404).json({ error: 'Question not found.' }); return; }
  res.json({ ...updated, options: JSON.parse(updated.options) });
});

// DELETE /api/admin/questions/:id
router.delete('/questions/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM questions WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// ─── TESTS ────────────────────────────────────────────────────

// GET /api/admin/tests
router.get('/tests', (_req: Request, res: Response) => {
  const tests = db.prepare(`
    SELECT t.*, u.name as creator_name
    FROM tests t LEFT JOIN users u ON t.created_by = u.id
    ORDER BY t.created_at DESC
  `).all() as (Test & { creator_name: string })[];

  const result = tests.map(t => {
    const question_count = (db.prepare('SELECT COUNT(*) as cnt FROM test_questions WHERE test_id = ?').get(t.id) as { cnt: number }).cnt;
    const attempt_count  = (db.prepare("SELECT COUNT(*) as cnt FROM attempts WHERE test_id = ? AND status IN ('completed', 'timed_out')").get(t.id) as { cnt: number }).cnt;
    return { ...t, question_count, attempt_count };
  });
  res.json(result);
});

// POST /api/admin/tests
router.post('/tests', (req: Request, res: Response) => {
  const { title, description, subject, time_limit, is_active } = req.body as {
    title?: string; description?: string; subject?: string; time_limit?: number; is_active?: boolean;
  };
  if (!title) { res.status(400).json({ error: 'title is required.' }); return; }
  const result = db.prepare(
    'INSERT INTO tests (title, description, subject, time_limit, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(title.trim(), description ?? '', subject || null, time_limit ?? 30, is_active !== false ? 1 : 0, req.user!.id);
  const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(result.lastInsertRowid) as Test;
  res.status(201).json(test);
});

// PUT /api/admin/tests/:id
router.put('/tests/:id', (req: Request, res: Response) => {
  const { title, description, subject, time_limit, is_active } = req.body;
  db.prepare(
    'UPDATE tests SET title = ?, description = ?, subject = ?, time_limit = ?, is_active = ? WHERE id = ?'
  ).run(title, description ?? '', subject || null, time_limit ?? 30, is_active ? 1 : 0, Number(req.params.id));
  const updated = db.prepare('SELECT * FROM tests WHERE id = ?').get(Number(req.params.id)) as Test | undefined;
  if (!updated) { res.status(404).json({ error: 'Test not found.' }); return; }
  res.json(updated);
});

// DELETE /api/admin/tests/:id
router.delete('/tests/:id', (req: Request, res: Response) => {
  const testId = Number(req.params.id);
  db.prepare('DELETE FROM test_questions WHERE test_id = ?').run(testId);
  db.prepare("DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE test_id = ?)").run(testId);
  db.prepare('DELETE FROM attempts WHERE test_id = ?').run(testId);
  db.prepare('DELETE FROM tests WHERE id = ?').run(testId);
  res.json({ success: true });
});

// ─── TEST QUESTIONS ───────────────────────────────────────────

// GET /api/admin/tests/:id/questions
router.get('/tests/:id/questions', (req: Request, res: Response) => {
  const testId = Number(req.params.id);
  const test = db.prepare('SELECT id FROM tests WHERE id = ?').get(testId);
  if (!test) { res.status(404).json({ error: 'Test not found.' }); return; }

  const rows = db.prepare(`
    SELECT q.*, tq.position
    FROM questions q
    JOIN test_questions tq ON tq.question_id = q.id
    WHERE tq.test_id = ? ORDER BY tq.position
  `).all(testId) as (Question & { options: string; position: number })[];

  res.json(rows.map(q => ({ ...q, options: JSON.parse(q.options) })));
});

// POST /api/admin/tests/:id/questions  – add question(s) to test
router.post('/tests/:id/questions', (req: Request, res: Response) => {
  const testId = Number(req.params.id);
  const { question_ids } = req.body as { question_ids?: number[] };
  if (!Array.isArray(question_ids) || question_ids.length === 0) {
    res.status(400).json({ error: 'question_ids array is required.' }); return;
  }

  const test = db.prepare('SELECT id FROM tests WHERE id = ?').get(testId);
  if (!test) { res.status(404).json({ error: 'Test not found.' }); return; }

  const maxPos = (db.prepare('SELECT MAX(position) as mp FROM test_questions WHERE test_id = ?').get(testId) as { mp: number | null }).mp ?? 0;
  const existing = new Set(
    (db.prepare('SELECT question_id FROM test_questions WHERE test_id = ?').all(testId) as { question_id: number }[]).map(r => r.question_id)
  );
  const newIds = question_ids.filter(id => !existing.has(id));
  const insert = db.prepare('INSERT OR IGNORE INTO test_questions (test_id, question_id, position) VALUES (?, ?, ?)');
  const insertMany = db.transaction(() => {
    newIds.forEach((id, i) => insert.run(testId, id, maxPos + i + 1));
  });
  insertMany();
  res.json({ added: newIds.length });
});

// DELETE /api/admin/tests/:id/questions/:qid
router.delete('/tests/:id/questions/:qid', (req: Request, res: Response) => {
  db.prepare('DELETE FROM test_questions WHERE test_id = ? AND question_id = ?').run(
    Number(req.params.id), Number(req.params.qid)
  );
  res.json({ success: true });
});

// ─── TEST RESULTS ─────────────────────────────────────────────

// GET /api/admin/tests/:id/results
router.get('/tests/:id/results', (req: Request, res: Response) => {
  const testId = Number(req.params.id);
  const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(testId) as Test | undefined;
  if (!test) { res.status(404).json({ error: 'Test not found.' }); return; }

  const results = db.prepare(`
    SELECT a.id, a.status, a.score, a.total, a.pct, a.submitted_at, a.violations, u.name, u.email
    FROM attempts a JOIN users u ON a.user_id = u.id
    WHERE a.test_id = ? AND a.status IN ('completed', 'timed_out')
    ORDER BY a.pct DESC, a.submitted_at ASC
  `).all(testId);

  res.json({ test, results });
});

// ─── PDF EXPORT ───────────────────────────────────────────────

// GET /api/admin/tests/:id/export.pdf
router.get('/tests/:id/export.pdf', (req: Request, res: Response) => {
  const testId = Number(req.params.id);
  const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(testId) as Test | undefined;
  if (!test) { res.status(404).json({ error: 'Test not found.' }); return; }

  const attempts = db.prepare(`
    SELECT a.score, a.total, a.pct, a.status, a.submitted_at, a.violations, u.name, u.email
    FROM attempts a JOIN users u ON a.user_id = u.id
    WHERE a.test_id = ? AND a.status IN ('completed', 'timed_out')
    ORDER BY a.pct DESC, a.submitted_at ASC
  `).all(testId) as { score: number; total: number; pct: number; status: string; submitted_at: string; violations: number; name: string; email: string }[];

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${test.title.replace(/[^a-z0-9]/gi, '_')}_results.pdf"`);
  doc.pipe(res);

  // Header
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#0a3d1f').text('SCOT Free by EduRaj Consult', { align: 'center' });
  doc.fontSize(10).font('Helvetica').fillColor('#6aab82').text('08149425466 · Comprehensive Classes 2026', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d4f0df').lineWidth(1.5).stroke();
  doc.moveDown(0.6);

  // Test info
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0a3d1f').text(test.title);
  if (test.description) doc.fontSize(10).font('Helvetica').fillColor('#6aab82').text(test.description);
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#2d6e47').text([
    `Subject: ${test.subject ?? 'Mixed'}`,
    `Time Limit: ${test.time_limit} minutes`,
    `Total Participants: ${attempts.length}`,
    `Generated: ${new Date().toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' })}`,
  ].join('   ·   '));
  doc.moveDown(0.8);

  // Table header
  const col = { rank: 50, name: 90, email: 250, score: 390, pct: 445, status: 490, flags: 535 };
  doc.rect(50, doc.y, 495, 20).fill('#0a3d1f');
  const rowY = doc.y - 20;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
  doc.text('#',      col.rank,   rowY + 6, { width: 30 });
  doc.text('Name',   col.name,   rowY + 6, { width: 155 });
  doc.text('Email',  col.email,  rowY + 6, { width: 135 });
  doc.text('Score',  col.score,  rowY + 6, { width: 50 });
  doc.text('%',      col.pct,    rowY + 6, { width: 40 });
  doc.text('Status', col.status, rowY + 6, { width: 40 });
  doc.text('Flags',  col.flags,  rowY + 6, { width: 30 });
  doc.moveDown(0.2);

  // Table rows
  attempts.forEach((a, i) => {
    const y = doc.y;
    if (i % 2 === 0) doc.rect(50, y, 495, 18).fill('#eaf7ef');
    const pctVal = a.pct ?? 0;
    const scoreColor = pctVal >= 70 ? '#16a34a' : pctVal >= 50 ? '#ca8a04' : '#dc2626';
    doc.fontSize(8).font('Helvetica').fillColor('#0d2b18');
    doc.text(`${i + 1}`,    col.rank,   y + 5, { width: 30 });
    doc.text(a.name ?? '',  col.name,   y + 5, { width: 155 });
    doc.fillColor('#6aab82');
    doc.text(a.email ?? '', col.email,  y + 5, { width: 135 });
    doc.fillColor(scoreColor).font('Helvetica-Bold');
    doc.text(`${a.score ?? 0}/${a.total ?? 0}`, col.score, y + 5, { width: 50 });
    doc.text(`${Math.round(pctVal)}%`,           col.pct,   y + 5, { width: 40 });
    doc.fillColor('#6aab82').font('Helvetica');
    doc.text(a.status,                           col.status, y + 5, { width: 40 });
    const flags = a.violations ?? 0;
    doc.fillColor(flags > 0 ? '#dc2626' : '#6aab82').font(flags > 0 ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(flags > 0 ? `⚑ ${flags}` : '—',   col.flags,  y + 5, { width: 30 });
    doc.y = y + 18;
  });

  if (attempts.length === 0) {
    doc.fontSize(11).fillColor('#6aab82').text('No completed attempts yet for this test.', { align: 'center' });
  }

  // Footer
  doc.moveDown(1.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d4f0df').lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fontSize(8).fillColor('#6aab82').text(
    'SCOT Free by EduRaj Consult · 08149425466 · Empowering Every Nigerian Student · 2026',
    { align: 'center' }
  );
  doc.end();
});

// ─── RESOURCES ────────────────────────────────────────────────

// GET /api/admin/resources
router.get('/resources', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM resources ORDER BY subject, topic, resource_type').all() as Resource[];
  res.json(rows);
});

// POST /api/admin/resources/upload  (multipart/form-data)
router.post('/resources/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'PDF file is required.' }); return; }
  const { subject, topic, resource_type, title, description } = req.body as {
    subject?: string; topic?: string; resource_type?: string; title?: string; description?: string;
  };
  if (!subject || !topic || !resource_type || !title) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: 'subject, topic, resource_type and title are required.' }); return;
  }
  if (!['note', 'pq'].includes(resource_type)) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "resource_type must be 'note' or 'pq'." }); return;
  }
  const file_url = `/uploads/${req.file.filename}`;
  const result = db.prepare(
    'INSERT INTO resources (subject, topic, title, description, file_url, file_type, resource_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(subject, topic, title, description ?? '', file_url, 'pdf', resource_type);
  const saved = db.prepare('SELECT * FROM resources WHERE id = ?').get(result.lastInsertRowid) as Resource;
  res.status(201).json(saved);
});

// DELETE /api/admin/resources/:id
router.delete('/resources/:id', (req: Request, res: Response) => {
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(req.params.id)) as Resource | undefined;
  if (!resource) { res.status(404).json({ error: 'Resource not found.' }); return; }
  // Delete the physical file if it's in our uploads folder
  if (resource.file_url.startsWith('/uploads/')) {
    const filePath = path.join(UPLOAD_DIR, path.basename(resource.file_url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM resources WHERE id = ?').run(Number(req.params.id));
  res.json({ success: true });
});

// ─── STUDENT LIST ─────────────────────────────────────────────

// GET /api/admin/students
router.get('/students', (_req: Request, res: Response) => {
  const students = db.prepare(`
    SELECT u.id, u.name, u.email, u.created_at,
           COUNT(DISTINCT a.test_id) as tests_taken,
           ROUND(AVG(CASE WHEN a.status IN ('completed','timed_out') THEN a.pct ELSE NULL END), 1) as avg_pct
    FROM users u
    LEFT JOIN attempts a ON a.user_id = u.id
    WHERE u.is_admin = 0
    GROUP BY u.id ORDER BY u.created_at DESC
  `).all();
  res.json(students);
});

export default router;
