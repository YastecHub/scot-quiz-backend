import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { initDB } from './db/database';
import authRouter     from './routes/auth';
import quizRouter     from './routes/quiz';
import topicsRouter   from './routes/topics';
import resourcesRouter from './routes/resources';
import scoresRouter   from './routes/scores';
import adminRouter    from './routes/admin';
import attemptsRouter from './routes/attempts';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      'http://localhost:5173',
      /\.vercel\.app$/,
    ];
    if (!origin || allowed.some(p => typeof p === 'string' ? p === origin : p.test(origin))) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/auth',      authRouter);
app.use('/api/quiz',      quizRouter);
app.use('/api/topics',    topicsRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/scores',    scoresRouter);
app.use('/api/admin',     adminRouter);
app.use('/api/attempts',  attemptsRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'SCOT Free API', version: '2.0.0' }));

initDB();
app.listen(PORT, () =>
  console.log(`\n🌿 SCOT Free API  →  http://localhost:${PORT}\n   Admin login  →  admin@scotfree.com / Admin2026!\n`)
);
