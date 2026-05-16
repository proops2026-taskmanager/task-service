import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import pool from '../db';
import app from '../app';

beforeAll(async () => {
  await pool.query('DROP TABLE IF EXISTS comments CASCADE');
  await pool.query('DROP TABLE IF EXISTS tasks CASCADE');
  await pool.query('DROP TYPE IF EXISTS task_status CASCADE');
  const migration = readFileSync(
    join(__dirname, '../../db/migrations/001_create_tables.sql'),
    'utf8'
  );
  await pool.query(migration);
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE comments RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE TABLE tasks RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';
const ASSIGNEE_ID = '33333333-3333-3333-3333-333333333333';

describe('GET /health', () => {
  it('200 — returns status ok with service name', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'task-service' });
  });
});

describe('POST /tasks', () => {
  const valid = {
    title: 'Implement login page',
    description: 'Build the login form with email/password fields',
    assignee_id: ASSIGNEE_ID,
    due_date: '2026-05-01T00:00:00.000Z',
  };

  it('201 — valid data returns full task object with status TODO', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('X-User-Id', USER_ID)
      .send(valid);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: valid.title,
      description: valid.description,
      status: 'TODO',
      assignee_id: ASSIGNEE_ID,
      created_by: USER_ID,
    });
    expect(res.body.id).toBeDefined();
    expect(res.body.created_at).toBeDefined();
    expect(res.body.updated_at).toBeDefined();
  });

  it('201 — optional fields default to null', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('X-User-Id', USER_ID)
      .send({ title: 'Minimal task', assignee_id: ASSIGNEE_ID });

    expect(res.status).toBe(201);
    expect(res.body.description).toBeNull();
    expect(res.body.due_date).toBeNull();
  });

  it('201 — created_by is set from X-User-Id, never from body', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('X-User-Id', USER_ID)
      .send({ ...valid, created_by: OTHER_USER });

    expect(res.status).toBe(201);
    expect(res.body.created_by).toBe(USER_ID);
  });

  it('400 — missing title', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('X-User-Id', USER_ID)
      .send({ assignee_id: ASSIGNEE_ID });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'title is required' });
  });

  it('400 — missing assignee_id', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('X-User-Id', USER_ID)
      .send({ title: 'No assignee' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'assignee_id is required' });
  });

  it('401 — missing X-User-Id header', async () => {
    const res = await request(app)
      .post('/tasks')
      .send(valid);

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

async function createTask(userId: string, assigneeId: string, title = 'Task') {
  const res = await request(app)
    .post('/tasks')
    .set('X-User-Id', userId)
    .send({ title, assignee_id: assigneeId });
  return res.body as { id: string; status: string };
}

describe('PATCH /tasks/:id/status — T-11', () => {
  it('200 — TODO → IN_PROGRESS', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', USER_ID)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('200 — IN_PROGRESS → DONE', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    await request(app).patch(`/tasks/${task.id}/status`).set('X-User-Id', USER_ID).send({ status: 'IN_PROGRESS' });
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', USER_ID)
      .send({ status: 'DONE' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DONE');
  });

  it('200 — TODO → CANCELLED', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', USER_ID)
      .send({ status: 'CANCELLED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('400 — DONE → IN_PROGRESS (backward, terminal)', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    await request(app).patch(`/tasks/${task.id}/status`).set('X-User-Id', USER_ID).send({ status: 'IN_PROGRESS' });
    await request(app).patch(`/tasks/${task.id}/status`).set('X-User-Id', USER_ID).send({ status: 'DONE' });
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', USER_ID)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual('Invalid status transition');
  });

  it('400 — CANCELLED → TODO (terminal)', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    await request(app).patch(`/tasks/${task.id}/status`).set('X-User-Id', USER_ID).send({ status: 'CANCELLED' });
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', USER_ID)
      .send({ status: 'TODO' });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual('Invalid status transition');
  });

  it('400 — missing status body', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', USER_ID)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'status is required' });
  });

  it('400 — invalid status value (not in enum)', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', USER_ID)
      .send({ status: 'INVALID_STATUS' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'status must be one of: TODO, IN_PROGRESS, DONE, CANCELLED' });
  });

  it('403 — caller is not assignee or creator', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID);
    const res = await request(app)
      .patch(`/tasks/${task.id}/status`)
      .set('X-User-Id', OTHER_USER)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'you do not have permission to update this task' });
  });

  it('404 — task not found', async () => {
    const res = await request(app)
      .patch('/tasks/00000000-0000-0000-0000-000000000000/status')
      .set('X-User-Id', USER_ID)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'task not found' });
  });
});

// ---------------------------------------------------------------------------

describe('GET /tasks — T-13 (role-based)', () => {
  beforeEach(async () => {
    // lead creates a task assigned to ASSIGNEE_ID
    await createTask(USER_ID, ASSIGNEE_ID, 'Lead task');
    // other user creates a task assigned to OTHER_USER
    await createTask(OTHER_USER, OTHER_USER, 'Other task');
  });

  it('200 — lead sees all tasks', async () => {
    const res = await request(app)
      .get('/tasks')
      .set('X-User-Id', USER_ID)
      .set('X-User-Role', 'lead');

    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBe(2);
    expect(res.body.total).toBe(2);
  });

  it('200 — member sees only own tasks (assignee or creator)', async () => {
    const res = await request(app)
      .get('/tasks')
      .set('X-User-Id', USER_ID)
      .set('X-User-Role', 'member');

    expect(res.status).toBe(200);
    // USER_ID is creator of 'Lead task' — should see it
    expect(res.body.tasks.length).toBe(1);
    expect(res.body.tasks[0].title).toBe('Lead task');
    expect(res.body.total).toBe(1);
  });

  it('200 — lead filters by status', async () => {
    const task = await createTask(USER_ID, ASSIGNEE_ID, 'In progress task');
    await request(app).patch(`/tasks/${task.id}/status`).set('X-User-Id', USER_ID).send({ status: 'IN_PROGRESS' });

    const res = await request(app)
      .get('/tasks?status=IN_PROGRESS')
      .set('X-User-Id', USER_ID)
      .set('X-User-Role', 'lead');

    expect(res.status).toBe(200);
    expect(res.body.tasks.every((t: { status: string }) => t.status === 'IN_PROGRESS')).toBe(true);
  });

  it('200 — empty result returns tasks:[] and total:0', async () => {
    const res = await request(app)
      .get('/tasks?status=DONE')
      .set('X-User-Id', USER_ID)
      .set('X-User-Role', 'lead');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tasks: [], total: 0 });
  });
});
