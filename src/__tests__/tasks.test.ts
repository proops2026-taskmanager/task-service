import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import pool from '../db';
import app from '../app';

beforeAll(async () => {
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
