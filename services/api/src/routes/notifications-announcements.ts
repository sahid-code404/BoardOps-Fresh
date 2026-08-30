import { Hono, type Context } from "hono";
import {
  authenticatedPrincipal,
  hasPermission,
  PERMISSIONS,
  type AuthPrincipal,
} from "../auth/authorization";
import { prepareNotificationDelivery, type NotificationType } from "../notifications/delivery";
import type { AppEnv } from "../types";

type AnnouncementType = "INFO" | "WARNING" | "MAINTENANCE" | "EVENT";
type AnnouncementPriority = "NORMAL" | "HIGH" | "URGENT";
type AnnouncementAudience = "ALL" | "RESIDENTS" | "ADMINS";
type AnnouncementStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "EXPIRED" | "ARCHIVED";

type NotificationRow = {
  id: string;
  title: string;
  description: string;
  type: NotificationType;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  route: string | null;
  read_at: string | null;
  created_at: string;
};

type AnnouncementRow = {
  id: string;
  institution_id: string;
  title: string;
  body: string;
  type: AnnouncementType;
  priority: AnnouncementPriority;
  target_audience: AnnouncementAudience;
  is_pinned: number;
  status: AnnouncementStatus;
  published_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  creator_name?: string | null;
};

type RecipientRow = { id: string };

const ANNOUNCEMENT_TYPES = new Set<AnnouncementType>(["INFO", "WARNING", "MAINTENANCE", "EVENT"]);
const ANNOUNCEMENT_PRIORITIES = new Set<AnnouncementPriority>(["NORMAL", "HIGH", "URGENT"]);
const ANNOUNCEMENT_AUDIENCES = new Set<AnnouncementAudience>(["ALL", "RESIDENTS", "ADMINS"]);
const ANNOUNCEMENT_STATUSES = new Set<AnnouncementStatus>(["DRAFT", "SCHEDULED", "PUBLISHED", "EXPIRED", "ARCHIVED"]);

export const notificationAnnouncementRoutes = new Hono<AppEnv>();

async function principalFor(c: Context<AppEnv>): Promise<AuthPrincipal | Response> {
  const principal = await authenticatedPrincipal(c);
  return principal ?? c.json({ success: false, error: "Authentication required" }, 401);
}

async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

function nullableIso(value: unknown): string | null | "INVALID" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "INVALID";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "INVALID" : parsed.toISOString();
}

function notificationResponse(row: NotificationRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority,
    route: row.route ?? undefined,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function announcementResponse(row: AnnouncementRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    priority: row.priority,
    targetAudience: row.target_audience,
    isPinned: row.is_pinned === 1,
    status: row.status,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    user: row.creator_name ? { name: row.creator_name } : null,
  };
}

async function loadAnnouncement(
  c: Context<AppEnv>,
  institutionId: string,
  id: string,
): Promise<AnnouncementRow | null> {
  return c.env.DB.prepare(
    `SELECT a.*, u.name AS creator_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.institution_id = ? AND a.id = ?
      LIMIT 1`,
  ).bind(institutionId, id).first<AnnouncementRow>();
}

async function recipientsForAudience(
  c: Context<AppEnv>,
  institutionId: string,
  audience: AnnouncementAudience,
): Promise<RecipientRow[]> {
  let roleClause = "";
  if (audience === "RESIDENTS") roleClause = " AND role = 'USER'";
  if (audience === "ADMINS") roleClause = " AND role IN ('ADMIN','SUPER_ADMIN')";
  const rows = await c.env.DB.prepare(
    `SELECT id
       FROM users
      WHERE institution_id = ?
        AND status = 'ACTIVE'
        AND deleted_at IS NULL${roleClause}
      ORDER BY id`,
  ).bind(institutionId).all<RecipientRow>();
  return rows.results;
}

function notificationTypeForAnnouncement(type: AnnouncementType): NotificationType {
  return type === "WARNING" || type === "MAINTENANCE" ? "WARNING" : "INFO";
}

async function deliveryStatements(
  c: Context<AppEnv>,
  announcement: Pick<AnnouncementRow, "id" | "institution_id" | "title" | "body" | "type" | "priority" | "target_audience" | "published_at">,
): Promise<D1PreparedStatement[]> {
  const recipients = await recipientsForAudience(c, announcement.institution_id, announcement.target_audience);
  const createdAt = announcement.published_at ?? new Date().toISOString();
  return recipients.map((recipient) => prepareNotificationDelivery(c.env.DB, {
    institutionId: announcement.institution_id,
    userId: recipient.id,
    title: announcement.title,
    description: announcement.body,
    type: notificationTypeForAnnouncement(announcement.type),
    priority: announcement.priority,
    route: "/notifications",
    sourceType: "ANNOUNCEMENT",
    sourceId: announcement.id,
    deliveryKey: `announcement:${announcement.id}:published`,
    createdAt,
  }));
}

function auditStatement(
  c: Context<AppEnv>,
  principal: AuthPrincipal,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): D1PreparedStatement {
  return c.env.DB.prepare(
    `INSERT INTO audit_events
      (id, institution_id, actor_user_id, action, entity_type, entity_id,
       request_id, reason, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'Announcement', ?, ?, NULL, ?, ?)`,
  ).bind(
    crypto.randomUUID(), principal.institutionId, principal.id, action, entityId,
    c.get("requestId"), JSON.stringify(metadata), new Date().toISOString(),
  );
}

notificationAnnouncementRoutes.get("/notifications", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const unreadOnly = c.req.query("unread") === "true";
  const unreadClause = unreadOnly ? " AND read_at IS NULL" : "";

  const [rows, unread] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, title, description, type, priority, route, read_at, created_at
         FROM notifications
        WHERE institution_id = ? AND user_id = ?${unreadClause}
        ORDER BY created_at DESC, id DESC
        LIMIT 50`,
    ).bind(principal.institutionId, principal.id).all<NotificationRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM notifications
        WHERE institution_id = ? AND user_id = ? AND read_at IS NULL`,
    ).bind(principal.institutionId, principal.id).first<{ count: number | null }>(),
  ]);

  return c.json({
    success: true,
    data: {
      notifications: rows.results.map(notificationResponse),
      unreadCount: Number(unread?.count ?? 0),
    },
  });
});

notificationAnnouncementRoutes.patch("/notifications", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);
  const now = new Date().toISOString();

  if (body.markAllRead === true) {
    await c.env.DB.prepare(
      `UPDATE notifications
          SET read_at = ?
        WHERE institution_id = ? AND user_id = ? AND read_at IS NULL`,
    ).bind(now, principal.institutionId, principal.id).run();
    return c.json({ success: true, data: { success: true } });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return c.json({ success: false, error: "Nothing to update" }, 400);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM notifications WHERE id = ? AND institution_id = ? AND user_id = ? LIMIT 1`,
  ).bind(id, principal.institutionId, principal.id).first<{ id: string }>();
  if (!existing) return c.json({ success: false, error: "Notification not found" }, 404);

  // Marking one notification is intentionally idempotent; clicking an already
  // read notification never toggles it back to unread.
  await c.env.DB.prepare(
    `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND institution_id = ? AND user_id = ?`,
  ).bind(now, id, principal.institutionId, principal.id).run();
  return c.json({ success: true, data: { success: true } });
});

notificationAnnouncementRoutes.get("/announcements", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const now = new Date().toISOString();
  const canManage = hasPermission(principal, PERMISSIONS.ANNOUNCEMENTS_UPDATE);
  const requestedStatus = c.req.query("status")?.trim().toUpperCase();

  const clauses = ["a.institution_id = ?"];
  const bindings: unknown[] = [principal.institutionId];

  if (canManage) {
    if (requestedStatus) {
      if (!ANNOUNCEMENT_STATUSES.has(requestedStatus as AnnouncementStatus)) {
        return c.json({ success: false, error: "Invalid announcement status" }, 400);
      }
      clauses.push("a.status = ?");
      bindings.push(requestedStatus);
    } else {
      clauses.push("a.status <> 'ARCHIVED'");
    }
  } else {
    clauses.push("a.status = 'PUBLISHED'", "a.published_at IS NOT NULL", "a.published_at <= ?", "(a.expires_at IS NULL OR a.expires_at > ?)");
    bindings.push(now, now);
    if (principal.role === "USER") {
      clauses.push("a.target_audience IN ('ALL','RESIDENTS')");
    } else {
      clauses.push("a.target_audience = 'ALL'");
    }
  }

  const rows = await c.env.DB.prepare(
    `SELECT a.*, u.name AS creator_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE ${clauses.join(" AND ")}
      ORDER BY a.is_pinned DESC, COALESCE(a.published_at, a.created_at) DESC, a.id DESC`,
  ).bind(...bindings).all<AnnouncementRow>();

  return c.json({ success: true, data: rows.results.map(announcementResponse) });
});

notificationAnnouncementRoutes.post("/announcements", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const announcementBody = typeof body.body === "string" ? body.body.trim() : "";
  const type = String(body.type ?? "INFO").toUpperCase() as AnnouncementType;
  const priority = String(body.priority ?? "NORMAL").toUpperCase() as AnnouncementPriority;
  const audience = String(body.targetAudience ?? "ALL").toUpperCase() as AnnouncementAudience;
  const status = String(body.status ?? "PUBLISHED").toUpperCase() as AnnouncementStatus;
  const expiresAt = nullableIso(body.expiresAt);

  if (title.length < 3 || title.length > 200) return c.json({ success: false, error: "Title must be 3 to 200 characters" }, 422);
  if (announcementBody.length < 5 || announcementBody.length > 5000) return c.json({ success: false, error: "Body must be 5 to 5000 characters" }, 422);
  if (!ANNOUNCEMENT_TYPES.has(type)) return c.json({ success: false, error: "Invalid announcement type" }, 422);
  if (!ANNOUNCEMENT_PRIORITIES.has(priority)) return c.json({ success: false, error: "Invalid announcement priority" }, 422);
  if (!ANNOUNCEMENT_AUDIENCES.has(audience)) return c.json({ success: false, error: "Invalid target audience" }, 422);
  if (!new Set<AnnouncementStatus>(["DRAFT", "SCHEDULED", "PUBLISHED"]).has(status)) {
    return c.json({ success: false, error: "New announcements must be DRAFT, SCHEDULED, or PUBLISHED" }, 422);
  }
  if (expiresAt === "INVALID") return c.json({ success: false, error: "Invalid expiry date" }, 422);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const publishedAt = status === "PUBLISHED" ? now : null;
  const isPinned = body.isPinned === true ? 1 : 0;
  const insert = c.env.DB.prepare(
    `INSERT INTO announcements (
       id, institution_id, title, body, type, priority, target_audience,
       is_pinned, status, published_at, expires_at, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, principal.institutionId, title, announcementBody, type, priority, audience,
    isPinned, status, publishedAt, expiresAt, principal.id, now, now,
  );

  const statements: D1PreparedStatement[] = [insert];
  if (status === "PUBLISHED") {
    statements.push(...await deliveryStatements(c, {
      id,
      institution_id: principal.institutionId,
      title,
      body: announcementBody,
      type,
      priority,
      target_audience: audience,
      published_at: publishedAt,
    }));
  }
  statements.push(auditStatement(c, principal, "ANNOUNCEMENT_CREATE", id, {
    type, priority, targetAudience: audience, status,
  }));
  await c.env.DB.batch(statements);

  const created = await loadAnnouncement(c, principal.institutionId, id);
  return c.json({ success: true, data: announcementResponse(created!) }, 201);
});

notificationAnnouncementRoutes.patch("/announcements/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadAnnouncement(c, principal.institutionId, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Announcement not found" }, 404);
  if (existing.status === "ARCHIVED") {
    return c.json({ success: false, error: "Archived announcements are immutable" }, 422);
  }

  const body = await readBody(c);
  if (!body) return c.json({ success: false, error: "Invalid JSON body" }, 400);

  const title = body.title === undefined ? existing.title : typeof body.title === "string" ? body.title.trim() : "";
  const announcementBody = body.body === undefined ? existing.body : typeof body.body === "string" ? body.body.trim() : "";
  const type = body.type === undefined ? existing.type : String(body.type).toUpperCase() as AnnouncementType;
  const priority = body.priority === undefined ? existing.priority : String(body.priority).toUpperCase() as AnnouncementPriority;
  const audience = body.targetAudience === undefined ? existing.target_audience : String(body.targetAudience).toUpperCase() as AnnouncementAudience;
  const status = body.status === undefined ? existing.status : String(body.status).toUpperCase() as AnnouncementStatus;
  const expiresAt = body.expiresAt === undefined ? existing.expires_at : nullableIso(body.expiresAt);
  const isPinned = body.isPinned === undefined ? existing.is_pinned : body.isPinned === true ? 1 : 0;

  if (title.length < 3 || title.length > 200) return c.json({ success: false, error: "Title must be 3 to 200 characters" }, 422);
  if (announcementBody.length < 5 || announcementBody.length > 5000) return c.json({ success: false, error: "Body must be 5 to 5000 characters" }, 422);
  if (!ANNOUNCEMENT_TYPES.has(type) || !ANNOUNCEMENT_PRIORITIES.has(priority) || !ANNOUNCEMENT_AUDIENCES.has(audience) || !ANNOUNCEMENT_STATUSES.has(status)) {
    return c.json({ success: false, error: "Invalid announcement update" }, 422);
  }
  if (expiresAt === "INVALID") return c.json({ success: false, error: "Invalid expiry date" }, 422);

  const deliveryChanged = title !== existing.title || announcementBody !== existing.body || type !== existing.type
    || priority !== existing.priority || audience !== existing.target_audience;
  if (existing.published_at && deliveryChanged) {
    return c.json({ success: false, error: "Published announcement delivery content cannot be edited; archive it and create a correction" }, 422);
  }
  if (existing.published_at && (status === "DRAFT" || status === "SCHEDULED")) {
    return c.json({ success: false, error: "A published announcement cannot return to draft or scheduled state" }, 422);
  }

  const now = new Date().toISOString();
  const publishedAt = existing.published_at ?? (status === "PUBLISHED" ? now : null);
  const finalPinned = status === "ARCHIVED" ? 0 : isPinned;
  const update = c.env.DB.prepare(
    `UPDATE announcements
        SET title = ?, body = ?, type = ?, priority = ?, target_audience = ?,
            is_pinned = ?, status = ?, published_at = ?, expires_at = ?, updated_at = ?
      WHERE id = ? AND institution_id = ?`,
  ).bind(
    title, announcementBody, type, priority, audience, finalPinned, status,
    publishedAt, expiresAt, now, existing.id, principal.institutionId,
  );

  const statements: D1PreparedStatement[] = [update];
  if (status === "PUBLISHED") {
    statements.push(...await deliveryStatements(c, {
      id: existing.id,
      institution_id: principal.institutionId,
      title,
      body: announcementBody,
      type,
      priority,
      target_audience: audience,
      published_at: publishedAt,
    }));
  }
  statements.push(auditStatement(c, principal, "ANNOUNCEMENT_UPDATE", existing.id, {
    status, isPinned: finalPinned === 1, expiresAt,
  }));
  await c.env.DB.batch(statements);

  const updated = await loadAnnouncement(c, principal.institutionId, existing.id);
  return c.json({ success: true, data: announcementResponse(updated!) });
});

notificationAnnouncementRoutes.delete("/announcements/:id", async (c) => {
  const principal = await principalFor(c);
  if (principal instanceof Response) return principal;
  const existing = await loadAnnouncement(c, principal.institutionId, c.req.param("id"));
  if (!existing) return c.json({ success: false, error: "Announcement not found" }, 404);
  if (existing.status === "ARCHIVED") {
    return c.json({ success: true, data: announcementResponse(existing) });
  }

  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE announcements SET status = 'ARCHIVED', is_pinned = 0, updated_at = ? WHERE id = ? AND institution_id = ?`,
    ).bind(now, existing.id, principal.institutionId),
    auditStatement(c, principal, "ANNOUNCEMENT_ARCHIVE", existing.id, { previousStatus: existing.status }),
  ]);
  const archived = await loadAnnouncement(c, principal.institutionId, existing.id);
  return c.json({ success: true, data: announcementResponse(archived!) });
});
