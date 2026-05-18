import { Router, Request, Response } from 'express';
import pool from '../db';
import { publishEvent } from '../events';

const router = Router();

const VALID_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

const VALID_TRANSITIONS: Record<string, string[]> = {
  TODO:        ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'CANCELLED'],
  DONE:        [],
  CANCELLED:   [],
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /tasks — list tasks (role-based)
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId   = req.headers['x-user-id']   as string | undefined;
  const userRole = req.headers['x-user-role'] as string | undefined;

  if (!userId) { res.status(401).json({ error: 'Missing X-User-Id header' }); return; }

  const { status, assignee_id } = req.query;
  const conditions: string[] = [];
  const values: unknown[]    = [];
  let idx = 1;

  if (userRole !== 'lead') {
    conditions.push(`(assignee_id = $${idx} OR created_by = $${idx})`);
    values.push(userId); idx++;
  }
  if (status) {
    conditions.push(`status = $${idx}::task_status`);
    values.push(status); idx++;
  }
  if (assignee_id) {
    conditions.push(`assignee_id = $${idx}::uuid`);
    values.push(assignee_id); idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query(
      `SELECT id, title, description, status, assignee_id, created_by, due_date, created_at, updated_at
       FROM tasks ${where} ORDER BY created_at DESC`,
      values,
    );
    res.json({ tasks: result.rows, total: result.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /tasks/:id — get task with comments
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  if (!req.headers['x-user-id']) { res.status(401).json({ error: 'Missing X-User-Id header' }); return; }

  try {
    const taskResult = await pool.query(
      `SELECT id, title, description, status, assignee_id, created_by, due_date, created_at, updated_at
       FROM tasks WHERE id = $1`,
      [req.params.id],
    );
    if (!taskResult.rows.length) { res.status(404).json({ error: 'task not found' }); return; }

    const commentsResult = await pool.query(
      `SELECT id, author_id, body, created_at FROM comments WHERE task_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );

    res.json({ ...taskResult.rows[0], comments: commentsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /tasks — create task
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) { res.status(401).json({ error: 'Missing X-User-Id header' }); return; }

  const { title, description, assignee_id, due_date } = req.body;
  if (!title)       { res.status(400).json({ error: 'title is required' }); return; }
  if (!assignee_id) { res.status(400).json({ error: 'assignee_id is required' }); return; }

  if (!UUID_REGEX.test(assignee_id)) {
    res.status(400).json({ error: 'assignee_id must be a valid UUID' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, description, assignee_id, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, status, assignee_id, created_by, due_date, created_at, updated_at`,
      [title, description ?? null, assignee_id, userId, due_date ?? null],
    );
    const task = result.rows[0];

    publishEvent({
      event:       'task.created',
      task_id:     task.id,
      task_title:  task.title,
      actor_id:    userId,
      assignee_id: task.assignee_id,
      ...(task.due_date ? { due_date: task.due_date } : {}),
    });

    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /tasks/:id — Lead only, 204 on success
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const userId   = req.headers['x-user-id']   as string | undefined;
  const userRole = req.headers['x-user-role'] as string | undefined;

  if (!userId) { res.status(401).json({ error: 'Missing X-User-Id header' }); return; }
  if (userRole !== 'lead') { res.status(403).json({ error: 'only leads can delete tasks' }); return; }

  try {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'task not found' }); return; }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /tasks/:id/status — Enforce transition rules + 403 authorization
router.patch('/:id/status', async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) { res.status(401).json({ error: 'Missing X-User-Id header' }); return; }

  const { status } = req.body;
  if (!status) { res.status(400).json({ error: 'status is required' }); return; }

  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: 'status must be one of: TODO, IN_PROGRESS, DONE, CANCELLED' });
    return;
  }

  try {
    const current = await pool.query(
      'SELECT id, title, status, assignee_id, created_by FROM tasks WHERE id = $1',
      [req.params.id],
    );
    if (!current.rows.length) { res.status(404).json({ error: 'task not found' }); return; }

    const task = current.rows[0];

    if (task.assignee_id !== userId && task.created_by !== userId) {
      res.status(403).json({ error: 'you do not have permission to update this task' });
      return;
    }

    const allowed = VALID_TRANSITIONS[task.status as string] ?? [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: 'Invalid status transition' });
      return;
    }

    const updated = await pool.query(
      `UPDATE tasks SET status = $1::task_status, updated_at = now() WHERE id = $2
       RETURNING id, title, description, status, assignee_id, created_by, due_date, created_at, updated_at`,
      [status, req.params.id],
    );

    publishEvent({
      event:      'task.status_updated',
      task_id:    task.id,
      task_title: task.title,
      actor_id:   userId,
      old_status: task.status,
      new_status: status,
    });

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /tasks/:id/comments — add comment
router.post('/:id/comments', async (req: Request, res: Response): Promise<void> => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) { res.status(401).json({ error: 'Missing X-User-Id header' }); return; }

  const { text, body: bodyField } = req.body;
  const commentText = text || bodyField;
  if (!commentText?.trim()) { res.status(400).json({ error: 'body is required' }); return; }

  try {
    const taskResult = await pool.query('SELECT id, title FROM tasks WHERE id = $1', [req.params.id]);
    if (!taskResult.rows.length) { res.status(404).json({ error: 'task not found' }); return; }
    const task = taskResult.rows[0];

    const comment = await pool.query(
      `INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3)
       RETURNING id, task_id, author_id, body, created_at`,
      [req.params.id, userId, commentText.trim()],
    );

    publishEvent({
      event:        'comment.created',
      task_id:      task.id,
      task_title:   task.title,
      actor_id:     userId,
      comment_text: commentText.trim(),
    });

    res.status(201).json(comment.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
