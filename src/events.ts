import redis from './redis';

const STREAM = 'task:events';

type TaskCreated = {
  event: 'task.created';
  task_id: string;
  task_title: string;
  actor_id: string;
  assignee_id: string;
  due_date?: string;
};

type TaskStatusUpdated = {
  event: 'task.status_updated';
  task_id: string;
  task_title: string;
  actor_id: string;
  old_status: string;
  new_status: string;
};

type CommentCreated = {
  event: 'comment.created';
  task_id: string;
  task_title: string;
  actor_id: string;
  comment_text: string;
};

type TaskEvent = TaskCreated | TaskStatusUpdated | CommentCreated;

// Fire-and-forget — never throws, never blocks the HTTP response.
export function publishEvent(payload: TaskEvent): void {
  const fields: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null) fields.push(k, String(v));
  }

  redis.xadd(STREAM, '*', ...fields).catch((err: Error) => {
    console.error('[events] Failed to publish:', err.message);
  });
}
