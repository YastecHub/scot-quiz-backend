import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/database';
import { requireAuth } from '../middleware/auth';
import type { User } from '../types';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'scot_dev_secret';

function signToken(user: { id: number; email: string; name: string; is_admin: number }): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function publicUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin };
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
  if (!name || !email || !password) { res.status(400).json({ error: 'Name, email and password are required.' }); return; }
  if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters.' }); return; }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) { res.status(409).json({ error: 'An account with this email already exists.' }); return; }

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
  ).run(name.trim(), email.toLowerCase().trim(), hash);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User;
  const pub = publicUser(user);
  res.status(201).json({ token: signToken(pub), user: pub });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) { res.status(400).json({ error: 'Email and password are required.' }); return; }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as User | undefined;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password.' }); return;
  }

  const pub = publicUser(user);
  res.json({ token: signToken(pub), user: pub });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = db.prepare('SELECT id, name, email, is_admin, created_at FROM users WHERE id = ?').get(req.user!.id) as Omit<User, 'password_hash'> | undefined;
  if (!user) { res.status(404).json({ error: 'User not found.' }); return; }
  res.json(user);
});

export default router;
