export type NotificationType = "INFO" | "SUCCESS" | "WARNING" | "DANGER";
export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type NotificationDelivery = {
  institutionId: string;
  userId: string;
  title: string;
  description?: string | null;
  type?: NotificationType;
  priority?: NotificationPriority;
  route?: string | null;
  sourceType: string;
  sourceId: string;
  deliveryKey: string;
  createdAt?: string;
};

/**
 * Build an INSERT OR IGNORE statement for durable inbox delivery.
 * The database UNIQUE(institution_id,user_id,delivery_key) constraint is the
 * authoritative idempotency boundary, so retries are safe across requests,
 * process restarts and concurrent Workers.
 */
export function prepareNotificationDelivery(
  db: D1Database,
  input: NotificationDelivery,
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO notifications (
       id, institution_id, user_id, title, description, type, priority, route,
       read_at, source_type, source_id, delivery_key, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.institutionId,
    input.userId,
    input.title.trim().slice(0, 200),
    (input.description ?? "").slice(0, 5000),
    input.type ?? "INFO",
    input.priority ?? "NORMAL",
    input.route ?? null,
    input.sourceType,
    input.sourceId,
    input.deliveryKey,
    input.createdAt ?? new Date().toISOString(),
  );
}

export async function deliverNotification(
  db: D1Database,
  input: NotificationDelivery,
): Promise<boolean> {
  const result = await prepareNotificationDelivery(db, input).run();
  return Number(result.meta.changes ?? 0) > 0;
}
