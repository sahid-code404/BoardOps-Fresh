import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

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
    return c.json({ status: "ready", service: "boardops-api" });
  } catch {
    return c.json({ status: "not_ready", service: "boardops-api" }, 503);
  }
});

export default app;
