import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

const VALID_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

const TRANSITIONS: Record<string, string[]> = {
  TODO: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /tasks — Create task
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
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

  if (!UUID_REGEX.test(assignee_id)) {
    res.status(400).json({ error: 'assignee_id must be a valid UUID' });
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

// GET /tasks — Role-based list with optional filters
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  const userRole = req.headers['x-user-role'] as string | undefined;

  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

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
    res.status(200).json({ tasks: result.rows, total: result.rows.length });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /tasks/:id/status — Enforce transition rules + 403 authorization
router.patch('/:id/status', async (req: Request, res: Response): Promise<void> => {
  const callerId = req.headers['x-user-id'] as string | undefined;
  if (!callerId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { id } = req.params;
  const { status: newStatus } = req.body;

  if (!newStatus) {
    res.status(400).json({ error: 'status is required' });
    return;
  }

  if (!VALID_STATUSES.includes(newStatus)) {
    res.status(400).json({ error: 'status must be one of: TODO, IN_PROGRESS, DONE, CANCELLED' });
    return;
  }

  try {
    const taskResult = await pool.query(
      'SELECT id, status, assignee_id, created_by FROM tasks WHERE id = $1',
      [id]
    );

    if (taskResult.rows.length === 0) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const task = taskResult.rows[0];

    if (task.assignee_id !== callerId && task.created_by !== callerId) {
      res.status(403).json({ error: 'you do not have permission to update this task' });
      return;
    }

    const allowed = TRANSITIONS[task.status as string] ?? [];
    if (!allowed.includes(newStatus)) {
      res.status(400).json({ error: 'Invalid status transition' });
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
