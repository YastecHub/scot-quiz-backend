import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'scot_dev_secret';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorised – token missing' });
    return;
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET) as {
      id: number; email: string; name: string; is_admin: number;
    };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorised – invalid or expired token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user?.is_admin) {
      res.status(403).json({ error: 'Forbidden – admin only' });
      return;
    }
    next();
  });
}
