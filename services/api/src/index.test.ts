import { describe, expect, it } from "vitest";
import app from "./index";

const CORE_TABLES = [
  "institutions",
  "accounting_periods",
  "users",
  "idempotency_keys",
  "audit_events",
  "outbox_events",
  "user_sessions",
  "login_history",
];

function mockDb(tableNames = CORE_TABLES): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes("SELECT 1 AS ok")) {
        return {
          first: async () => ({ ok: 1 }),
        };
      }

      return {
        bind: (...names: unknown[]) => ({
          all: async () => ({
            results: names
              .filter((name): name is string => typeof name === "string" && tableNames.includes(name))
              .map((name) => ({ name })),
          }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe("health endpoint", () => {
  it("returns an explicit healthy response", async () => {
    const response = await app.request("http://boardops.local/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "boardops-api" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("readiness endpoint", () => {
  it("requires the Phase 04 auth-core D1 schema", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      service: "boardops-api",
      schema: "phase04-auth-core",
    });
  });

  it("fails closed when a required auth table is missing", async () => {
    const response = await app.request(
      "http://boardops.local/api/ready",
      undefined,
      { DB: mockDb(CORE_TABLES.filter((name) => name !== "user_sessions")), FILES: {} as R2Bucket, ENVIRONMENT: "local" },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      service: "boardops-api",
      schema: "phase04-auth-core",
    });
  });
});
