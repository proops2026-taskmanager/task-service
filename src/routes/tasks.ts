import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

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
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
