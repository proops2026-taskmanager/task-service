# task-service — Agent Context

> Copy this file to the root of the task-service repo as `CLAUDE.md` when scaffolding.

---

## What This Service Does

`task-service` owns every task record, status transition, and comment.
- Creates and stores tasks
- Enforces status transition rules (TODO→IN_PROGRESS→DONE, any→CANCELLED)
- Stores comments on tasks
- Never validates JWT — reads identity from `X-User-Id` and `X-User-Role` headers injected by api-gateway

**Port:** 3002 (internal only — not exposed to host)
**Database:** task-db (PostgreSQL 15, separate from user-service)

---

## Governing Document

**IRD-002** is the law for this service. Read it before writing any code.

| Location | URL |
|----------|-----|
| Local (docs repo) | `../docs-taskmanager/docs/IRD-002.md` |
| Notion | https://www.notion.so/341dde5fafa98107b9f9de9ecf0dae4d |

Also read **IRD-003** for NFRs (error format, health endpoint, .env pattern, Docker).

---

## API Contract (summary — full spec in IRD-002)

```
POST   /tasks                Create task          → 201
GET    /tasks                List tasks           → 200 []
GET    /tasks/:id            Get task + comments  → 200
PATCH  /tasks/:id/status     Update status        → 200
DELETE /tasks/:id            Delete task          → 204
POST   /tasks/:id/comments   Add comment          → 201
GET    /health               Health check         → 200 { "status": "ok" }
```

---

## Role-Based Access — GET /tasks

```
X-User-Role: lead    → returns ALL tasks (no filter)
X-User-Role: member  → returns only tasks where assignee_id = X-User-Id
                        OR created_by = X-User-Id
```

---

## Data Model

```sql
CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        VARCHAR(255) NOT NULL,
  description  TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'TODO'
               CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  assignee_id  UUID,           -- plain UUID, no FK to user-service
  created_by   UUID NOT NULL,  -- from X-User-Id header
  due_date     TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL,  -- from X-User-Id header
  body       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## Status Transition Rules

```
TODO        → IN_PROGRESS   allowed
IN_PROGRESS → DONE          allowed (DONE is terminal — no exit)
TODO        → CANCELLED     allowed (CANCELLED is terminal — no exit)
IN_PROGRESS → CANCELLED     allowed
DONE        → anything      BLOCKED → 400 { "error": "Invalid status transition" }
CANCELLED   → anything      BLOCKED → 400 { "error": "Invalid status transition" }
```

---

## Standards (locked — do not change)

| Rule | Value |
|------|-------|
| Error format | `{ "error": "string" }` — every endpoint |
| Identity source | `X-User-Id` header (set by api-gateway, plain UUID) |
| Role source | `X-User-Role` header (set by api-gateway) |
| Cross-service reference | `assignee_id UUID` — no FK, no JOIN to user-service |
| Health endpoint | `GET /health → 200 { "status": "ok" }` |
| Secrets | `.env` (git-ignored) + `.env.example` (committed) |

**Never validate JWT in this service.** Never read the Authorization header.
Trust only `X-User-Id` and `X-User-Role` — they were set by api-gateway after JWT validation.

---

## Environment Variables

```env
# .env.example — commit this, not .env
PORT=3002
DATABASE_URL=postgresql://USER:PASS@HOST:5432/tasks_db
```

---

## Sprint 1 Tasks for This Service

| Task | Owner | Description |
|------|-------|-------------|
| T-07 | thai_dm | Scaffold: npm init, TS config, Express, /health, Dockerfile, .env.example |
| T-08 | chau_tv | POST /tasks — create task, set created_by from X-User-Id |
| T-09 | chau_tv | GET /tasks — list with role-based filter |
| T-10 | thai_dm | GET /tasks/:id — return task + comments array |
| T-11 | thai_dm | PATCH /tasks/:id/status — transition enforcement |
| T-12 | thai_dm | DELETE /tasks/:id |
| T-13 | thai_dm | POST /tasks/:id/comments |
| T-14 | thai_dm | Integration tests: jest + supertest, all endpoints |

---

## Session Startup for This Service

```
1. Read IRD-002 (local or Notion) — full API contract + status rules
2. Read IRD-003 — NFRs: error format, health, .env, Docker
3. Check which task you're on (see sprint-01.md in docs repo)
4. Implement — follow IRD-002 exactly, especially status transition table
```
