import { Hono, type Context } from "hono";
import { authenticatedPrincipal, hasPermission, PERMISSIONS, type AuthPrincipal } from "../auth/authorization";
import { createPrivateLogicalBackup } from "../system/backup";
import {
  cancelQueuedTask,
  cleanupExpiredSessions,
  createBackgroundTask,
  executeBackgroundTask,
  taskStatus,
  type BackgroundTaskStatus,
  type RunnableSystemTaskType,
  type TaskExecutor,
} from "../system/task-engine";
import type { AppEnv } from "../types";

export const auditSystemRoutes = new Hono<AppEnv>();

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string;
  reason: string | null;
  metadata_json: string | null;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_avatar_url: string | null;
};

type TaskRow = {
  id: string;
  type: string;
  status: BackgroundTaskStatus;
  progress: number;
  payload_json: string | null;
  result_json: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  triggered_by: string | null;
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_email: string | null;
};

function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip")
    ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "127.0.0.1";
}

function userAgent(c: Context<AppEnv>): string | null {
  return c.req.header("user-agent")?.slice(0, 512) ?? null;
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function serializedValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function mappedAudit(row: AuditRow) {
  const metadata = parseMetadata(row.metadata_json);
  return {
    id: row.id,
    actorId: row.actor_user_id,
    action: row.action,
    entity: row.entity_type,
    entityId: row.entity_id,
    oldValue: serializedValue(metadata.oldValue ?? metadata.old_value),
    newValue: serializedValue(metadata.newValue ?? metadata.new_value),
    ipAddress: typeof (metadata.ipAddress ?? metadata.ip_address) === "string"
      ? String(metadata.ipAddress ?? metadata.ip_address)
      : null,
    userAgent: typeof (metadata.userAgent ?? metadata.user_agent) === "string"
      ? String(metadata.userAgent ?? metadata.user_agent)
      : null,
    reason: row.reason,
    createdAt: row.created_at,
    actor: row.actor_user_id && row.actor_name
      ? {
          id: row.actor_user_id,
          name: row.actor_name,
          email: row.actor_email ?? "",
          avatarUrl: row.actor_avatar_url,
        }
      : null,
  };
}

function mappedTask(row: TaskRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: Number(row.progress),
    payload: row.payload_json,
    result: row.result_json,
    errorMessage: row.error_message,
    retryCount: Number(row.retry_count),
    maxRetries: Number(row.max_retries),
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: row.user_name ? { name: row.user_name, email: row.user_email ?? "" } : null,
  };
}

async function principal(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const value = await authenticatedPrincipal(c);
  return value ?? c.json({ success: false, error: "Authentication required" }, 401);
}

async function appendAudit(
  db: D1Database,
  input: {
    institutionId: string;
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    requestId: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await db.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id, request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      input.institutionId,
      input.actorId,
      input.action,
      input.entity,
      input.entityId,
      input.requestId,
      input.reason ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      new Date().toISOString(),
    )
    .run();
}

function taskExecutor(
  c: Context<AppEnv>,
  type: RunnableSystemTaskType,
  institutionId: string,
): TaskExecutor {
  if (type === "SESSION_CLEANUP") {
    return async (updateProgress) => {
      await updateProgress(25);
      const purgedSessions = await cleanupExpiredSessions(c.env.DB, institutionId);
      await updateProgress(90);
      return { purgedSessions };
    };
  }
  return (updateProgress) => createPrivateLogicalBackup(c.env, institutionId, updateProgress);
}

function backgroundAction(type: RunnableSystemTaskType, outcome: string): string {
  return `${type}_${outcome}`;
}

async function queueSystemTask(
  c: Context<AppEnv>,
  viewer: AuthPrincipal,
  type: RunnableSystemTaskType,
  payload?: Record<string, unknown> | null,
): Promise<string> {
  const taskId = await createBackgroundTask(c.env.DB, {
    institutionId: viewer.institutionId,
    type,
    payload,
    triggeredBy: viewer.id,
    maxRetries: 0,
  });
  const requestId = c.get("requestId");
  const requestMetadata = {
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    newValue: { taskId, type, status: "QUEUED" },
  };
  await appendAudit(c.env.DB, {
    institutionId: viewer.institutionId,
    actorId: viewer.id,
    action: backgroundAction(type, "QUEUED"),
    entity: "BackgroundTask",
    entityId: taskId,
    requestId,
    metadata: requestMetadata,
  });

  const execution = (async () => {
    const outcome = await executeBackgroundTask(
      c.env.DB,
      taskId,
      taskExecutor(c, type, viewer.institutionId),
    );
    if (outcome === "IGNORED") return;
    const finalTask = await c.env.DB.prepare(
      `SELECT result_json, error_message FROM background_tasks
        WHERE id = ? AND institution_id = ? LIMIT 1`,
    )
      .bind(taskId, viewer.institutionId)
      .first<{ result_json: string | null; error_message: string | null }>();
    await appendAudit(c.env.DB, {
      institutionId: viewer.institutionId,
      actorId: viewer.id,
      action: backgroundAction(type, outcome),
      entity: "BackgroundTask",
      entityId: taskId,
      requestId: `${requestId}:${taskId}:completion`,
      reason: finalTask?.error_message ?? null,
      metadata: {
        newValue: finalTask?.result_json ? JSON.parse(finalTask.result_json) : { status: outcome },
      },
    });
  })().catch((error) => {
    console.error(`[BoardOps] Background task ${taskId} completion audit failed`, error);
  });
  c.executionCtx.waitUntil(execution);
  return taskId;
}

async function taskById(db: D1Database, institutionId: string, id: string): Promise<TaskRow | null> {
  return db.prepare(
    `SELECT t.*, u.name AS user_name, u.email AS user_email
       FROM background_tasks t
       LEFT JOIN users u ON u.id = t.triggered_by
      WHERE t.id = ? AND t.institution_id = ?
      LIMIT 1`,
  )
    .bind(id, institutionId)
    .first<TaskRow>();
}

auditSystemRoutes.get("/audit-logs", async (c) => {
  const viewer = await principal(c);
  if (viewer instanceof Response) return viewer;

  const rawLimit = Number(c.req.query("limit") ?? 50);
  const rawOffset = Number(c.req.query("offset") ?? 0);
  const limit = Number.isInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50;
  const offset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
  const entity = c.req.query("entity")?.trim();
  const entityId = c.req.query("entityId")?.trim();
  const action = c.req.query("action")?.trim();
  const actorId = c.req.query("actorId")?.trim();
  const search = c.req.query("search")?.trim().slice(0, 200);

  const clauses = ["a.institution_id = ?"];
  const params: unknown[] = [viewer.institutionId];
  if (entity) { clauses.push("a.entity_type = ?"); params.push(entity); }
  if (entityId) { clauses.push("a.entity_id = ?"); params.push(entityId); }
  if (action) { clauses.push("a.action LIKE ?"); params.push(`%${action}%`); }
  if (actorId) { clauses.push("a.actor_user_id = ?"); params.push(actorId); }
  if (search) {
    clauses.push("(a.action LIKE ? OR a.entity_type LIKE ? OR COALESCE(a.reason, '') LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const where = clauses.join(" AND ");

  const [logs, totalRow, entityRows, actionRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id, a.request_id,
              a.reason, a.metadata_json, a.created_at,
              u.name AS actor_name, u.email AS actor_email, u.avatar_url AS actor_avatar_url
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ? OFFSET ?`,
    ).bind(...params, limit, offset).all<AuditRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM audit_events a WHERE ${where}`)
      .bind(...params).first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT entity_type AS value FROM audit_events
        WHERE institution_id = ? ORDER BY entity_type`,
    ).bind(viewer.institutionId).all<{ value: string }>(),
    c.env.DB.prepare(
      `SELECT DISTINCT action AS value FROM audit_events
        WHERE institution_id = ? ORDER BY action`,
    ).bind(viewer.institutionId).all<{ value: string }>(),
  ]);

  const total = Number(totalRow?.total ?? 0);
  return c.json({
    success: true,
    data: {
      logs: logs.results.map(mappedAudit),
      total,
      pagination: { limit, offset, hasMore: offset + logs.results.length < total },
      filters: {
        entities: entityRows.results.map((row) => row.value),
        actions: actionRows.results.map((row) => row.value),
      },
    },
  });
});

auditSystemRoutes.get("/tasks", async (c) => {
  const viewer = await principal(c);
  if (viewer instanceof Response) return viewer;
  const status = c.req.query("status")?.trim().toUpperCase();
  const type = c.req.query("type")?.trim().toUpperCase();
  const rawLimit = Number(c.req.query("limit") ?? 100);
  const limit = Number.isInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 100;
  const validStatuses = new Set(["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
  if (status && !validStatuses.has(status)) {
    return c.json({ success: false, error: "Invalid task status filter" }, 400);
  }

  const clauses = ["t.institution_id = ?"];
  const params: unknown[] = [viewer.institutionId];
  if (status) { clauses.push("t.status = ?"); params.push(status); }
  if (type) { clauses.push("t.type = ?"); params.push(type); }

  const rows = await c.env.DB.prepare(
    `SELECT t.*, u.name AS user_name, u.email AS user_email
       FROM background_tasks t
       LEFT JOIN users u ON u.id = t.triggered_by
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ?`,
  ).bind(...params, limit).all<TaskRow>();
  return c.json({ success: true, data: rows.results.map(mappedTask) });
});

auditSystemRoutes.post("/tasks", async (c) => {
  const viewer = await principal(c);
  if (viewer instanceof Response) return viewer;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: "Invalid JSON body" }, 400); }
  const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  if (input.scheduledFor != null) {
    return c.json({ success: false, error: "Scheduled dispatch is unavailable until a Cloudflare scheduler is configured" }, 422);
  }
  const type = typeof input.type === "string" ? input.type.trim().toUpperCase() : "";
  if (type !== "SESSION_CLEANUP" && type !== "SYSTEM_BACKUP") {
    return c.json({
      success: false,
      error: "This task type is owned by its canonical domain or is not dispatchable from System",
    }, 422);
  }
  const runnableType = type as RunnableSystemTaskType;
  const required = runnableType === "SESSION_CLEANUP" ? PERMISSIONS.TASKS_CLEANUP : PERMISSIONS.SYSTEM_BACKUP;
  if (!hasPermission(viewer, required)) {
    return c.json({ success: false, error: "Permission denied", requiredPermission: required }, 403);
  }
  const payload = typeof input.payload === "object" && input.payload !== null
    ? input.payload as Record<string, unknown>
    : null;
  const taskId = await queueSystemTask(c, viewer, runnableType, payload);
  return c.json({ success: true, data: { taskId, queued: true } }, 202);
});

auditSystemRoutes.post("/tasks/cleanup", async (c) => {
  const viewer = await principal(c);
  if (viewer instanceof Response) return viewer;
  const taskId = await queueSystemTask(c, viewer, "SESSION_CLEANUP");
  return c.json({
    success: true,
    data: { taskId, queued: true, result: null, output: "Session cleanup queued" },
  }, 202);
});

auditSystemRoutes.get("/tasks/:id", async (c) => {
  const viewer = await principal(c);
  if (viewer instanceof Response) return viewer;
  const row = await taskById(c.env.DB, viewer.institutionId, c.req.param("id"));
  if (!row) return c.json({ success: false, error: "Task not found" }, 404);
  return c.json({ success: true, data: mappedTask(row) });
});

auditSystemRoutes.post("/tasks/:id/cancel", async (c) => {
  const viewer = await principal(c);
  if (viewer instanceof Response) return viewer;
  const id = c.req.param("id");
  const current = await taskStatus(c.env.DB, viewer.institutionId, id);
  if (!current) return c.json({ success: false, error: "Task not found" }, 404);
  if (current !== "QUEUED") {
    return c.json({ success: false, error: "Only queued tasks can be safely cancelled" }, 409);
  }
  if (!await cancelQueuedTask(c.env.DB, viewer.institutionId, id)) {
    return c.json({ success: false, error: "Task is no longer queued" }, 409);
  }
  await appendAudit(c.env.DB, {
    institutionId: viewer.institutionId,
    actorId: viewer.id,
    action: "BACKGROUND_TASK_CANCELLED",
    entity: "BackgroundTask",
    entityId: id,
    requestId: c.get("requestId"),
    metadata: {
      ipAddress: clientIp(c),
      userAgent: userAgent(c),
      newValue: { status: "CANCELLED" },
    },
  });
  return c.json({ success: true, data: { cancelled: true, taskId: id } });
});

auditSystemRoutes.post("/system/backup", async (c) => {
  const viewer = await principal(c);
  if (viewer instanceof Response) return viewer;
  const taskId = await queueSystemTask(c, viewer, "SYSTEM_BACKUP");
  return c.json({
    success: true,
    data: {
      taskId,
      queued: true,
      output: "Private D1 logical backup queued for R2 storage",
    },
  }, 202);
});
