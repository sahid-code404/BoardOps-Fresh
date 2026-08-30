import type { SystemTaskEnvironment, TaskProgress, TaskResult } from "./task-engine";

type TableInfoRow = { name: string };
type TableNameRow = { name: string };

const SKIPPED_TABLES = new Set([
  "_runtime_probe",
  "d1_migrations",
  "sqlite_sequence",
]);

const REDACTED_COLUMNS: Record<string, Set<string>> = {
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

function quoteColumns(columns: string[], alias?: string): string {
  return columns
    .map((column) => `${alias ? `${alias}.` : ""}${safeIdentifier(column)} AS ${safeIdentifier(column)}`)
    .join(", ");
}

async function columnsForTable(db: D1Database, table: string): Promise<string[]> {
  const info = await db.prepare(`PRAGMA table_info(${safeIdentifier(table)})`).all<TableInfoRow>();
  const redacted = REDACTED_COLUMNS[table] ?? new Set<string>();
  return info.results.map((row) => row.name).filter((name) => !redacted.has(name));
}

async function institutionRows(
  db: D1Database,
  table: string,
  columns: string[],
  institutionId: string,
): Promise<Record<string, unknown>[] | null> {
  if (columns.length === 0) return [];
  const tableName = safeIdentifier(table);
  const selected = quoteColumns(columns);

  if (table === "institutions") {
    return (await db.prepare(`SELECT ${selected} FROM ${tableName} WHERE id = ?`).bind(institutionId).all<Record<string, unknown>>()).results;
  }

  if (table === "user_sessions") {
    const selectedWithAlias = quoteColumns(columns, "s");
    return (await db.prepare(
      `SELECT ${selectedWithAlias}
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.institution_id = ?`,
    ).bind(institutionId).all<Record<string, unknown>>()).results;
  }

  if (table === "login_history") {
    const selectedWithAlias = quoteColumns(columns, "l");
    return (await db.prepare(
      `SELECT ${selectedWithAlias}
         FROM login_history l
         JOIN users u ON u.id = l.user_id
        WHERE u.institution_id = ?`,
    ).bind(institutionId).all<Record<string, unknown>>()).results;
  }

  if (table === "role_permissions") {
    const selectedWithAlias = quoteColumns(columns, "rp");
    return (await db.prepare(
      `SELECT ${selectedWithAlias}
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
        WHERE r.institution_id = ?`,
    ).bind(institutionId).all<Record<string, unknown>>()).results;
  }

  if (columns.includes("institution_id")) {
    return (await db.prepare(
      `SELECT ${selected} FROM ${tableName} WHERE institution_id = ?`,
    ).bind(institutionId).all<Record<string, unknown>>()).results;
  }

  return null;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createPrivateLogicalBackup(
  env: SystemTaskEnvironment,
  institutionId: string,
  updateProgress: TaskProgress,
): Promise<TaskResult> {
  const tableRows = await env.DB.prepare(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  ).all<TableNameRow>();

  const tables = tableRows.results
    .map((row) => row.name)
    .filter((name) => !SKIPPED_TABLES.has(name));

  const exported: Record<string, Record<string, unknown>[]> = {};
  const skipped: string[] = [];
  let rowCount = 0;

  for (const [index, table] of tables.entries()) {
    const columns = await columnsForTable(env.DB, table);
    const rows = await institutionRows(env.DB, table, columns, institutionId);
    if (rows === null) {
      skipped.push(table);
    } else {
      exported[table] = rows;
      rowCount += rows.length;
    }
    await updateProgress(Math.min(92, Math.round(((index + 1) / Math.max(1, tables.length)) * 92)));
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
    skippedTables: skipped,
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
    skippedTables: skipped,
    redacted: true,
  };
}
