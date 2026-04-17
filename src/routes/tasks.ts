import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

const TRANSITIONS: Record<string, string[]> = {
  TODO: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

// POST /tasks — Create task
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) {
    res.status(401).json({ error: 'Missing X-User-Id header' });
    return;
  }

  const { title, description, assignee_id, due_date } = req.body;

  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  if (!assignee_id) {
    res.status(400).json({ error: 'assignee_id is required' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, description, assignee_id, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, status, assignee_id, created_by, due_date, created_at, updated_at`,
      [title, description ?? null, assignee_id, userId, due_date ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /tasks — List with role-based access + filters
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  const userRole = req.headers['x-user-role'] as string | undefined;
  const { status, assignee_id } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  // lead sees all; member sees only tasks they own or are assigned to
  if (userRole !== 'lead') {
    conditions.push(`(assignee_id = $${idx} OR created_by = $${idx})`);
    params.push(userId);
    idx++;
  }

  if (status) {
    conditions.push(`status = $${idx}`);
    params.push(status);
    idx++;
  }

  if (assignee_id) {
    conditions.push(`assignee_id = $${idx}`);
    params.push(assignee_id);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT id, title, description, status, assignee_id, created_by, due_date, created_at, updated_at
       FROM tasks ${where} ORDER BY created_at DESC`,
      params
    );
    res.status(200).json(result.rows);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /tasks/:id/status — Enforce transition rules
router.patch('/:id/status', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status: newStatus } = req.body;

  if (!newStatus) {
    res.status(400).json({ error: 'status is required' });
    return;
  }

  try {
    const taskResult = await pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [id]
    );

    if (taskResult.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const current = taskResult.rows[0].status as string;
    const allowed = TRANSITIONS[current] ?? [];

    if (!allowed.includes(newStatus)) {
      const valid = allowed.length ? allowed.join(', ') : 'none (terminal status)';
      res.status(400).json({
        error: `Invalid status transition from ${current}. Valid transitions: ${valid}`,
      });
      return;
    }

    const updated = await pool.query(
      `UPDATE tasks SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, title, description, status, assignee_id, created_by, due_date, created_at, updated_at`,
      [newStatus, id]
    );

    res.status(200).json(updated.rows[0]);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
