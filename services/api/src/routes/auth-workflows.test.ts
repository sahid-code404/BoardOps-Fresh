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

function jsonPost(path: string, body: Record<string, unknown>) {
  return authWorkflowRoutes.request(
    `http://boardops.local${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    productionEnv(),
  );
}

describe("Phase 04 auth delivery boundary", () => {
  it("fails registration before creating any account or challenge when delivery is unavailable", async () => {
    const response = await jsonPost("/register", {
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
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Email verification delivery is not configured",
    });
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
