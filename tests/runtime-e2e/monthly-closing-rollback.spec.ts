import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const APRIL_CYCLE_ID = "cycle_2026_04_failed_local";

test("Monthly Closing rolls back unpublished FAILED state and reopens its accounting period", async ({ browser }) => {
  test.setTimeout(40_000);

  const context = await browser.newContext();
  try {
    const api = context.request;
    const login = await api.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();

    const before = await api.get(`${API}/api/billing-cycles`);
    expect(before.status()).toBe(200);
    const beforeBody = await before.json() as { data: Array<{ id: string; periodMonth: number; periodYear: number; status: string }> };
    expect(beforeBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: APRIL_CYCLE_ID,
        periodMonth: 3,
        periodYear: 2026,
        status: "FAILED",
      }),
    ]));

    const rollback = await api.post(`${API}/api/billing-cycles/${APRIL_CYCLE_ID}/rollback`, {
      data: { reason: "Runtime verifies safe pre-publication rollback" },
    });
    expect(rollback.status()).toBe(200);
    await expect(rollback.json()).resolves.toMatchObject({
      success: true,
      data: {
        id: APRIL_CYCLE_ID,
        periodMonth: 3,
        periodYear: 2026,
        status: "OPEN",
        errorMessage: null,
      },
    });

    const readiness = await api.get(`${API}/api/billing-cycles/readiness?month=3&year=2026`);
    expect(readiness.status()).toBe(200);
    const readinessBody = await readiness.json() as {
      data: {
        existingCycle: { id: string; status: string } | null;
        items: Array<{ key: string; status: string; detail: string }>;
      };
    };
    expect(readinessBody.data.existingCycle).toMatchObject({ id: APRIL_CYCLE_ID, status: "OPEN" });
    expect(readinessBody.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "cycle", status: "ready" }),
    ]));
    expect(readinessBody.data.items.find((item) => item.key === "cycle")?.detail).toContain("OPEN and can enter closing");

    // Rollback is a transition, not a reset/delete primitive. Once the cycle is
    // OPEN, repeating rollback is invalid and the durable cycle remains present.
    const duplicateRollback = await api.post(`${API}/api/billing-cycles/${APRIL_CYCLE_ID}/rollback`, {
      data: { reason: "A second rollback must not rewrite history" },
    });
    expect(duplicateRollback.status()).toBe(422);
    await expect(duplicateRollback.json()).resolves.toMatchObject({
      success: false,
      error: "Rollback is only allowed before immutable snapshot/bill publication",
    });

    const after = await api.get(`${API}/api/billing-cycles`);
    expect(after.status()).toBe(200);
    const afterBody = await after.json() as { data: Array<{ id: string; status: string }> };
    expect(afterBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: APRIL_CYCLE_ID, status: "OPEN" }),
    ]));
  } finally {
    await context.close();
  }
});
