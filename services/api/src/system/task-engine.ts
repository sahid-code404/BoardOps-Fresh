import type { Bindings } from "../types";

export type BackgroundTaskType =
  | "MONTHLY_CLOSING"
  | "REPORT_EXPORT"
  | "SESSION_CLEANUP"
  | "BILL_GENERATION"
  | "ANNOUNCEMENT_SCHEDULE"
  | "SYSTEM_BACKUP";

export type RunnableSystemTaskType = "SESSION_CLEANUP" | "SYSTEM_BACKUP";

export type BackgroundTaskStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type TaskResult = Record<string, unknown>;
export type TaskProgress = (progress: number) => Promise<void>;
export type TaskExecutor = (updateProgress: TaskProgress) => Promise<TaskResult>;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function changes(result: D1Result): number {
  return Number(result.meta?.changes ?? 0);
}

export async function createBackgroundTask(
  db: D1Database,
  input: {
    id?: string;
    institutionId: string;
    type: RunnableSystemTaskType;
    payload?: Record<string, unknown> | null | undefined;
    triggeredBy: string | null;
    maxRetries?: number;
  },
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO background_tasks
      (id, institution_id, type, status, progress, payload_json, retry_count, max_retries,
       scheduled_for, started_at, finished_at, triggered_by, created_at, updated_at)
     VALUES (?, ?, ?, 'QUEUED', 0, ?, 0, ?, NULL, NULL, NULL, ?, ?, ?)`,
  )
    .bind(
      id,
      input.institutionId,
      input.type,
      input.payload ? JSON.stringify(input.payload) : null,
      Math.max(0, Math.min(10, input.maxRetries ?? 0)),
      input.triggeredBy,
      now,
      now,
    )
    .run();
  return id;
}

export async function executeBackgroundTask(
  db: D1Database,
  taskId: string,
  executor: TaskExecutor,
): Promise<BackgroundTaskStatus | "IGNORED"> {
  const startedAt = new Date().toISOString();
  const claim = await db.prepare(
    `UPDATE background_tasks
        SET status = 'RUNNING', progress = 0, started_at = ?, error_message = NULL, updated_at = ?
      WHERE id = ? AND status = 'QUEUED'`,
  )
    .bind(startedAt, startedAt, taskId)
    .run();

  if (changes(claim) !== 1) return "IGNORED";

  const updateProgress: TaskProgress = async (value) => {
    const now = new Date().toISOString();
    await db.prepare(
      `UPDATE background_tasks
          SET progress = ?, updated_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
    )
      .bind(clampProgress(value), now, taskId)
      .run();
  };

  try {
    const result = await executor(updateProgress);
    const finishedAt = new Date().toISOString();
    const completed = await db.prepare(
      `UPDATE background_tasks
          SET status = 'COMPLETED', progress = 100, result_json = ?, error_message = NULL,
              finished_at = ?, updated_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
    )
      .bind(JSON.stringify(result), finishedAt, finishedAt, taskId)
      .run();
    return changes(completed) === 1 ? "COMPLETED" : "IGNORED";
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const failed = await db.prepare(
      `UPDATE background_tasks
          SET status = 'FAILED', error_message = ?, retry_count = retry_count + 1,
              finished_at = ?, updated_at = ?
        WHERE id = ? AND status = 'RUNNING'`,
    )
      .bind(message, finishedAt, finishedAt, taskId)
      .run();
    return changes(failed) === 1 ? "FAILED" : "IGNORED";
  }
}

export async function cleanupExpiredSessions(
  db: D1Database,
  institutionId: string,
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `DELETE FROM user_sessions
      WHERE user_id IN (
        SELECT id FROM users WHERE institution_id = ?
      )
        AND (revoked_at IS NOT NULL OR expires_at <= ?)`,
  )
    .bind(institutionId, now)
    .run();
  return changes(result);
}

export async function cancelQueuedTask(
  db: D1Database,
  institutionId: string,
  taskId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE background_tasks
        SET status = 'CANCELLED', finished_at = ?, updated_at = ?
      WHERE id = ? AND institution_id = ? AND status = 'QUEUED'`,
  )
    .bind(now, now, taskId, institutionId)
    .run();
  return changes(result) === 1;
}

export async function taskStatus(
  db: D1Database,
  institutionId: string,
  taskId: string,
): Promise<BackgroundTaskStatus | null> {
  const row = await db.prepare(
    `SELECT status FROM background_tasks WHERE id = ? AND institution_id = ? LIMIT 1`,
  )
    .bind(taskId, institutionId)
    .first<{ status: BackgroundTaskStatus }>();
  return row?.status ?? null;
}

export type SystemTaskEnvironment = Pick<Bindings, "DB" | "FILES">;
