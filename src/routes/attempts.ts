/**
 * Student attempt routes
 * All routes require auth. Admins are blocked — they cannot take tests.
 */
import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { requireAuth } from '../middleware/auth';
import type { Test, Attempt, Question } from '../types';

const router = Router();
router.use(requireAuth);

// Block admins from every attempt endpoint
router.use((req: Request, res: Response, next) => {
  if (req.user!.is_admin) {
    res.status(403).json({ error: 'Admins cannot take tests. Use the admin dashboard.' });
    return;
  }
  next();
});

// ── LIST ACTIVE TESTS ─────────────────────────────────────────
router.get('/tests', (req: Request, res: Response) => {
  const tests = db.prepare('SELECT * FROM tests WHERE is_active = 1 ORDER BY created_at DESC').all() as Test[];
  const userId = req.user!.id;

  const result = tests.map(test => {
    const questionCount = (db.prepare('SELECT COUNT(*) as cnt FROM test_questions WHERE test_id = ?').get(test.id) as { cnt: number }).cnt;
    const attempt = db.prepare('SELECT * FROM attempts WHERE test_id = ? AND user_id = ?').get(test.id, userId) as Attempt | undefined;
    return {
      ...test,
      question_count:  questionCount,
      attempt_id:      attempt?.id ?? null,
      attempt_status:  attempt?.status ?? null,
      attempt_pct:     attempt?.pct ?? null,
    };
  });
  res.json(result);
});

// ── START / RESUME ATTEMPT ─────────────────────────────────────
router.post('/:testId/start', (req: Request, res: Response) => {
  const testId = Number(req.params.testId);
  const userId = req.user!.id;

  const test = db.prepare('SELECT * FROM tests WHERE id = ? AND is_active = 1').get(testId) as Test | undefined;
  if (!test) { res.status(404).json({ error: 'Test not found or inactive.' }); return; }

  const questionCount = (db.prepare('SELECT COUNT(*) as cnt FROM test_questions WHERE test_id = ?').get(testId) as { cnt: number }).cnt;
  if (questionCount === 0) { res.status(400).json({ error: 'This test has no questions yet.' }); return; }

  const existing = db.prepare('SELECT * FROM attempts WHERE test_id = ? AND user_id = ?').get(testId, userId) as Attempt | undefined;
  if (existing) {
    if (existing.status === 'in_progress') {
      const elapsed = (Date.now() - new Date(existing.started_at).getTime()) / 60000;
      if (elapsed > test.time_limit) {
        db.prepare("UPDATE attempts SET status = 'timed_out' WHERE id = ?").run(existing.id);
        res.status(410).json({ error: 'Time expired. This attempt has been closed.' }); return;
      }
      res.json({ attempt: existing, time_remaining: Math.ceil((test.time_limit - elapsed) * 60) });
      return;
    }
    res.status(409).json({ error: 'You have already completed this test.', attempt: existing }); return;
  }

  const result = db.prepare(
    "INSERT INTO attempts (test_id, user_id, started_at, status) VALUES (?, ?, datetime('now'), 'in_progress')"
  ).run(testId, userId);
  const attempt = db.prepare('SELECT * FROM attempts WHERE id = ?').get(result.lastInsertRowid) as Attempt;
  res.status(201).json({ attempt, time_remaining: test.time_limit * 60 });
});

// ── GET ATTEMPT + QUESTIONS (no answers/explanations) ──────────
router.get('/:testId', (req: Request, res: Response) => {
  const testId = Number(req.params.testId);
  const userId = req.user!.id;

  const attempt = db.prepare('SELECT * FROM attempts WHERE test_id = ? AND user_id = ?').get(testId, userId) as Attempt | undefined;
  if (!attempt) { res.status(404).json({ error: 'No attempt found. Please start the test first.' }); return; }

  const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(testId) as Test | undefined;
  if (!test) { res.status(404).json({ error: 'Test not found.' }); return; }

  if (attempt.status === 'in_progress') {
    const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 60000;
    if (elapsed > test.time_limit) {
      db.prepare("UPDATE attempts SET status = 'timed_out' WHERE id = ?").run(attempt.id);
      res.json({ attempt: { ...attempt, status: 'timed_out' }, test, questions: [], time_remaining: 0 }); return;
    }
    const timeRemaining = Math.ceil((test.time_limit - elapsed) * 60);

    // Questions WITHOUT answer_index or explanation
    const testQs = db.prepare(
      'SELECT question_id, position FROM test_questions WHERE test_id = ? ORDER BY position'
    ).all(testId) as { question_id: number; position: number }[];

    const questions = testQs.map(tq => {
      const q = db.prepare('SELECT id, subject, topic, question, options, exam_source FROM questions WHERE id = ?').get(tq.question_id) as (Omit<Question, 'answer_index' | 'explanation' | 'created_by' | 'created_at'> & { options: string }) | undefined;
      if (!q) return null;
      return { ...q, options: JSON.parse(q.options), position: tq.position };
    }).filter(Boolean);

    // Already-saved answers
    const savedAnswerRows = db.prepare(
      'SELECT question_id, chosen_index FROM attempt_answers WHERE attempt_id = ?'
    ).all(attempt.id) as { question_id: number; chosen_index: number | null }[];
    const savedAnswers: Record<number, number | null> = {};
    savedAnswerRows.forEach(a => { savedAnswers[a.question_id] = a.chosen_index; });

    res.json({ attempt, test, questions, time_remaining: timeRemaining, saved_answers: savedAnswers });
    return;
  }

  res.json({ attempt, test, questions: [], time_remaining: 0 });
});

// ── SAVE DRAFT ANSWER ──────────────────────────────────────────
router.patch('/:testId/answer', (req: Request, res: Response) => {
  const testId = Number(req.params.testId);
  const userId = req.user!.id;
  const { question_id, chosen_index } = req.body as { question_id?: number; chosen_index?: number | null };
  if (question_id === undefined) { res.status(400).json({ error: 'question_id required.' }); return; }

  const attempt = db.prepare("SELECT * FROM attempts WHERE test_id = ? AND user_id = ? AND status = 'in_progress'").get(testId, userId) as Attempt | undefined;
  if (!attempt) { res.status(404).json({ error: 'No active attempt found.' }); return; }

  const test = db.prepare('SELECT time_limit FROM tests WHERE id = ?').get(testId) as { time_limit: number } | undefined;
  if (!test) { res.status(404).json({ error: 'Test not found.' }); return; }
  const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 60000;
  if (elapsed > test.time_limit) {
    db.prepare("UPDATE attempts SET status = 'timed_out' WHERE id = ?").run(attempt.id);
    res.status(410).json({ error: 'Time expired.' }); return;
  }

  const ci = chosen_index ?? null;
  db.prepare(`
    INSERT INTO attempt_answers (attempt_id, question_id, chosen_index)
    VALUES (?, ?, ?)
    ON CONFLICT(attempt_id, question_id) DO UPDATE SET chosen_index = excluded.chosen_index
  `).run(attempt.id, question_id, ci);

  res.json({ saved: true });
});

// ── SUBMIT ATTEMPT ─────────────────────────────────────────────
router.post('/:testId/submit', (req: Request, res: Response) => {
  const testId = Number(req.params.testId);
  const userId = req.user!.id;
  const { answers } = req.body as { answers?: Record<number, number | null> };

  const attempt = db.prepare('SELECT * FROM attempts WHERE test_id = ? AND user_id = ?').get(testId, userId) as Attempt | undefined;
  if (!attempt) { res.status(404).json({ error: 'No attempt found.' }); return; }
  if (attempt.status === 'completed') { res.status(409).json({ error: 'Already submitted.', attempt }); return; }

  const testQs = db.prepare('SELECT question_id FROM test_questions WHERE test_id = ?').all(testId) as { question_id: number }[];
  const questions = testQs.map(tq =>
    db.prepare('SELECT id, answer_index FROM questions WHERE id = ?').get(tq.question_id) as { id: number; answer_index: number } | undefined
  ).filter(Boolean) as { id: number; answer_index: number }[];

  const allAnswers = answers ?? {};
  let correct = 0;

  const submitAnswers = db.transaction(() => {
    questions.forEach(q => {
      const chosen = allAnswers[q.id] ?? null;
      const isCorrect = chosen !== null && chosen === q.answer_index ? 1 : 0;
      if (isCorrect) correct++;
      db.prepare(`
        INSERT INTO attempt_answers (attempt_id, question_id, chosen_index, is_correct)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(attempt_id, question_id) DO UPDATE SET chosen_index = excluded.chosen_index, is_correct = excluded.is_correct
      `).run(attempt.id, q.id, chosen, isCorrect);
    });
  });
  submitAnswers();

  const total = questions.length;
  const pct   = total > 0 ? Math.round((correct / total) * 100) : 0;
  db.prepare(
    "UPDATE attempts SET status = 'completed', submitted_at = datetime('now'), score = ?, total = ?, pct = ? WHERE id = ?"
  ).run(correct, total, pct, attempt.id);

  const updated = db.prepare('SELECT * FROM attempts WHERE id = ?').get(attempt.id) as Attempt;
  res.json({ attempt: updated, score: correct, total, pct });
});

// ── REVIEW (after submit) ──────────────────────────────────────
router.get('/:testId/review', (req: Request, res: Response) => {
  const testId = Number(req.params.testId);
  const userId = req.user!.id;

  const attempt = db.prepare(
    "SELECT * FROM attempts WHERE test_id = ? AND user_id = ? AND status IN ('completed', 'timed_out')"
  ).get(testId, userId) as Attempt | undefined;
  if (!attempt) { res.status(404).json({ error: 'No completed attempt found.' }); return; }

  const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(testId) as Test | undefined;
  if (!test) { res.status(404).json({ error: 'Test not found.' }); return; }

  const testQs = db.prepare(
    'SELECT question_id, position FROM test_questions WHERE test_id = ? ORDER BY position'
  ).all(testId) as { question_id: number; position: number }[];

  const answerRows = db.prepare(
    'SELECT question_id, chosen_index, is_correct FROM attempt_answers WHERE attempt_id = ?'
  ).all(attempt.id) as { question_id: number; chosen_index: number | null; is_correct: number }[];
  const aMap = new Map(answerRows.map(a => [a.question_id, a]));

  const questions = testQs.map(tq => {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(tq.question_id) as (Question & { options: string }) | undefined;
    if (!q) return null;
    const ans = aMap.get(tq.question_id);
    return {
      ...q,
      options:         JSON.parse(q.options),
      position:        tq.position,
      chosen_index:    ans?.chosen_index ?? null,
      student_correct: ans?.is_correct ?? 0,
    };
  }).filter(Boolean);

  res.json({ attempt, test, questions });
});

export default router;
