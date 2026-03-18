// ── EXPRESS AUGMENTATION ────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string; name: string; is_admin: number };
    }
  }
}

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
}

export interface Question {
  id: number;
  subject: string;
  topic: string;
  question: string;
  options: string;        // stored as JSON string in SQLite
  answer_index: number;
  explanation: string;
  exam_source: string;
  created_by: number;
  created_at: string;
}

export interface Topic {
  id: number;
  subject: string;
  name: string;
  slug: string;
}

export interface Resource {
  id: number;
  subject: string;
  topic: string;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  resource_type: string;   // 'note' | 'pq'
  created_at: string;
}

export interface Test {
  id: number;
  title: string;
  description: string;
  subject: string | null;
  time_limit: number;
  is_active: number;
  created_by: number;
  created_at: string;
}

export interface TestQuestion {
  test_id: number;
  question_id: number;
  position: number;
}

export interface Attempt {
  id: number;
  test_id: number;
  user_id: number;
  started_at: string;
  submitted_at: string | null;
  status: 'in_progress' | 'completed' | 'timed_out';
  score: number | null;
  total: number | null;
  pct: number | null;
}

export interface AttemptAnswer {
  id: number;
  attempt_id: number;
  question_id: number;
  chosen_index: number | null;
  is_correct: number;
}

export interface Score {
  id: number;
  user_id: number;
  subject: string;
  topic: string | null;
  correct: number;
  total: number;
  pct: number;
  created_at: string;
}

export {};
