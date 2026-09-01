import { describe, expect, it } from "vitest";
import { authWorkflowRoutes } from "./auth-workflows";
import type { AppEnv } from "../types";

function productionEnv(): AppEnv["Bindings"] {
  const DB = {
    prepare() {
      throw new Error("D1 must not be touched when auth email delivery is unavailable");
    },
  } as unknown as D1Database;

  return {
    DB,
    FILES: {} as R2Bucket,
    ENVIRONMENT: "production",
  };
}

type PreparedCall = { sql: string; args: unknown[] };

function registrationProductionEnv(): {
  env: AppEnv["Bindings"];
  calls: PreparedCall[];
} {
  const calls: PreparedCall[] = [];
  const DB = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          calls.push({ sql, args });
          return statement;
        },
        async first() {
          if (sql.includes("FROM institutions")) {
            return { id: "inst_test", name: "BoardOps Institute" };
          }
          return null;
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
  } as unknown as D1Database;

  return {
    env: {
      DB,
      FILES: {} as R2Bucket,
      ENVIRONMENT: "production",
    },
    calls,
  };
}

function jsonPostWithEnv(
  path: string,
  body: Record<string, unknown>,
  env: AppEnv["Bindings"],
) {
  return authWorkflowRoutes.request(
    `http://boardops.local${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

function jsonPost(path: string, body: Record<string, unknown>) {
  return jsonPostWithEnv(path, body, productionEnv());
}

describe("Phase 04 auth delivery boundary", () => {
  it("temporarily allows registration without email delivery and auto-marks the account verified", async () => {
    const { env, calls } = registrationProductionEnv();
    const response = await jsonPostWithEnv("/register", {
      name: "Production Applicant",
      institutionName: "BoardOps Institute",
      institutionUserId: "PROD-001",
      phone: "+919876543210",
      email: "production.applicant@example.test",
      password: "BoardOps@Production#2026A1",
      confirmPassword: "BoardOps@Production#2026A1",
      room: "P-101",
      gender: "OTHER",
      consents: { rules: true, privacy: true, terms: true },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        email: "production.applicant@example.test",
        verificationRequired: false,
      },
    });

    const userInsert = calls.find((call) => call.sql.includes("INSERT INTO users"));
    expect(userInsert).toBeTruthy();
    expect(userInsert?.args[7]).toBe(1);
  });

  it("keeps verification resend non-enumerating and mutation-free when delivery is unavailable", async () => {
    const response = await jsonPost("/send-verification", {
      email: "unknown@example.test",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { sent: true, deliveryConfigured: false },
    });
  });

  it("keeps password recovery non-enumerating and mutation-free when delivery is unavailable", async () => {
    const response = await jsonPost("/forgot-password", {
      email: "unknown@example.test",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { sent: true, deliveryConfigured: false },
    });
  });
});