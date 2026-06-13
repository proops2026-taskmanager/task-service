-- Add priority enum and column to tasks
DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS priority task_priority NOT NULL DEFAULT 'MEDIUM';

CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
