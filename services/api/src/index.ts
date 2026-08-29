import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

const REQUIRED_CORE_TABLES = [
  "institutions",
  "accounting_periods",
  "users",
  "idempotency_keys",
  "audit_events",
  "outbox_events",
] as const;

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header("x-request-id", requestId);
  await next();
});

app.get("/api/health", (c) => c.json({ status: "ok", service: "boardops-api" }));

app.get("/api/ready", async (c) => {
  try {
    const probe = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (probe?.ok !== 1) throw new Error("D1 readiness probe failed");

    const placeholders = REQUIRED_CORE_TABLES.map(() => "?").join(", ");
    const schema = await c.env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
      .bind(...REQUIRED_CORE_TABLES)
      .all<{ name: string }>();

    const present = new Set(schema.results.map((row) => row.name));
    const missing = REQUIRED_CORE_TABLES.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(`Missing database core tables: ${missing.join(", ")}`);
    }

    return c.json({
      status: "ready",
      service: "boardops-api",
      schema: "phase03-core",
    });
  } catch {
    return c.json(
      {
        status: "not_ready",
        service: "boardops-api",
        schema: "phase03-core",
      },
      503,
    );
  }
});

export default app;
