import type { SystemTaskEnvironment, TaskProgress, TaskResult } from "./task-engine";

type BackupScope = "institution-row" | "institution-column" | "user-relation" | "role-relation";
type BackupTable = {
  name: string;
  scope: BackupScope;
};

// D1's Worker binding intentionally restricts SQLite schema-introspection
// surfaces such as sqlite_master/PRAGMA. Keep the application-owned backup
// surface explicit instead. Every migration that adds an institution-owned
// table must add it here in the same change.
const BACKUP_TABLES: readonly BackupTable[] = [
  { name: "institutions", scope: "institution-row" },
  { name: "accounting_periods", scope: "institution-column" },
  { name: "users", scope: "institution-column" },
  { name: "idempotency_keys", scope: "institution-column" },
  { name: "audit_events", scope: "institution-column" },
  { name: "outbox_events", scope: "institution-column" },
  { name: "user_sessions", scope: "user-relation" },
  { name: "login_history", scope: "user-relation" },
  { name: "registration_requests", scope: "institution-column" },
  { name: "auth_challenges", scope: "institution-column" },
  { name: "roles", scope: "institution-column" },
  { name: "role_permissions", scope: "role-relation" },
  { name: "meal_configurations", scope: "institution-column" },
  { name: "meal_entries", scope: "institution-column" },
  { name: "guest_meals", scope: "institution-column" },
  { name: "meal_overrides", scope: "institution-column" },
  { name: "leave_applications", scope: "institution-column" },
  { name: "billing_snapshots", scope: "institution-column" },
  { name: "bills", scope: "institution-column" },
  { name: "payments", scope: "institution-column" },
  { name: "refunds", scope: "institution-column" },
  { name: "expenses", scope: "institution-column" },
  { name: "refund_transactions", scope: "institution-column" },
  { name: "adjustments", scope: "institution-column" },
  { name: "financial_reference_sequences", scope: "institution-column" },
  { name: "variables", scope: "institution-column" },
  { name: "variable_versions", scope: "institution-column" },
  { name: "formulas", scope: "institution-column" },
  { name: "formula_versions", scope: "institution-column" },
  { name: "billing_cycles", scope: "institution-column" },
  { name: "billing_cycle_events", scope: "institution-column" },
  { name: "announcements", scope: "institution-column" },
  { name: "notifications", scope: "institution-column" },
  { name: "settings", scope: "institution-column" },
  { name: "policies", scope: "institution-column" },
  { name: "holidays", scope: "institution-column" },
  { name: "background_tasks", scope: "institution-column" },
];

// `permissions` is a global application catalog seeded by migrations rather than
// institution-owned data. Wrangler/D1 metadata and the runtime probe are omitted
// from the manifest entirely and therefore can never enter an institution backup.
const SKIPPED_TABLES = ["permissions"] as const;

const REDACTED_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  users: new Set(["password_hash"]),
  user_sessions: new Set(["token_digest"]),
  auth_challenges: new Set(["secret_hash"]),
  idempotency_keys: new Set(["request_hash"]),
};

function safeIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`Unsafe D1 identifier in backup: ${value}`);
  }
  return `"${value}"`;
}

function stripRedactedColumns(
  table: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const redacted = REDACTED_COLUMNS[table];
  if (!redacted) return rows;

  return rows.map((row) => {
    const sanitized: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) {
      if (!redacted.has(column)) sanitized[column] = value;
    }
    return sanitized;
  });
}

async function rowsForTable(
  db: D1Database,
  table: BackupTable,
  institutionId: string,
): Promise<Record<string, unknown>[]> {
  const tableName = safeIdentifier(table.name);

  if (table.scope === "institution-row") {
    return (await db
      .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
      .bind(institutionId)
      .all<Record<string, unknown>>()).results;
  }

  if (table.scope === "user-relation") {
    return (await db.prepare(
      `SELECT t.*
         FROM ${tableName} t
         JOIN users u ON u.id = t.user_id
        WHERE u.institution_id = ?`,
    ).bind(institutionId).all<Record<string, unknown>>()).results;
  }

  if (table.scope === "role-relation") {
    return (await db.prepare(
      `SELECT t.*
         FROM ${tableName} t
         JOIN roles r ON r.id = t.role_id
        WHERE r.institution_id = ?`,
    ).bind(institutionId).all<Record<string, unknown>>()).results;
  }

  return (await db
    .prepare(`SELECT * FROM ${tableName} WHERE institution_id = ?`)
    .bind(institutionId)
    .all<Record<string, unknown>>()).results;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createPrivateLogicalBackup(
  env: SystemTaskEnvironment,
  institutionId: string,
  updateProgress: TaskProgress,
): Promise<TaskResult> {
  const exported: Record<string, Record<string, unknown>[]> = {};
  let rowCount = 0;

  for (const [index, table] of BACKUP_TABLES.entries()) {
    const rows = stripRedactedColumns(
      table.name,
      await rowsForTable(env.DB, table, institutionId),
    );
    exported[table.name] = rows;
    rowCount += rows.length;
    await updateProgress(Math.min(
      92,
      Math.round(((index + 1) / BACKUP_TABLES.length) * 92),
    ));
  }

  const createdAt = new Date().toISOString();
  const snapshot = {
    format: "boardops-d1-logical-backup-v1",
    createdAt,
    institutionId,
    security: {
      privateR2Object: true,
      redactedColumns: [
        "users.password_hash",
        "user_sessions.token_digest",
        "auth_challenges.secret_hash",
        "idempotency_keys.request_hash",
      ],
      note: "Authentication secret material is intentionally excluded from System data-export backups.",
    },
    skippedTables: [...SKIPPED_TABLES],
    tables: exported,
  };

  const body = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(body);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const objectKey = `backups/${institutionId}/${createdAt.replace(/[:.]/gu, "-")}-${crypto.randomUUID()}.json`;

  await updateProgress(96);
  // R2 accepts strings directly. Keeping the object-storage boundary textual
  // avoids ArrayBufferView transport/serialization differences between local
  // Miniflare and production workerd while preserving byte-for-byte UTF-8
  // content used for the size and SHA-256 values above.
  const stored = await env.FILES.put(objectKey, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      format: "boardops-d1-logical-backup-v1",
      institutionId,
      sha256,
      redacted: "true",
    },
  });
  if (!stored) {
    throw new Error("R2 did not confirm the logical backup write");
  }
  await updateProgress(99);

  return {
    objectKey,
    bytes: bytes.byteLength,
    sha256,
    rowCount,
    tableCount: Object.keys(exported).length,
    skippedTables: [...SKIPPED_TABLES],
    redacted: true,
  };
}
