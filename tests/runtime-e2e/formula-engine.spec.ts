import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_EMAIL = "browser.formula.resident@example.test";
const RESIDENT_PASSWORD = "BoardOps@Formula#2026!";

const RUNTIME_VARIABLE_KEY = "runtime.formula.rate";
const RUNTIME_FORMULA_KEY = "formula.runtime.e2e";

async function expectPermissionDenied(response: import("@playwright/test").APIResponse, permission: string) {
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    error: "Permission denied",
    requiredPermission: permission,
  });
}

test("Formula Engine renders real D1 data and enforces deterministic versioned dependencies", async ({ page }) => {
  test.setTimeout(50_000);

  const failedResponses: Array<{ url: string; status: number }> = [];
  page.on("response", (response) => {
    if (
      (response.url().includes("/api/variables") || response.url().includes("/api/formulas"))
      && response.status() >= 500
    ) {
      failedResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  await page.goto("/formula-engine");
  await expect(page).toHaveURL(/\/formula-engine(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Variables", exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByRole("button", { name: "Formulas", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Variable", exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Monthly Room Rent", { exact: true })).toBeVisible({ timeout: 8_000 });

  await page.getByRole("button", { name: "Formulas", exact: true }).click();
  await expect(page.getByRole("button", { name: "New Formula", exact: true }).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Meal Charges", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("formula.mealCharges", { exact: true })).toBeVisible();

  const result = await page.evaluate(async ({ variableKey, formulaKey }) => {
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(`/api${path}`, {
        credentials: "include",
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      const body = await response.json();
      return { status: response.status, body };
    };

    const initialVariables = await request("/variables");
    const initialFormulas = await request("/formulas");

    const canonicalTest = await request("/formulas/test", {
      method: "POST",
      body: JSON.stringify({
        expression: "breakfast_count * var('meal.rate.breakfast') + lunch_count * var('meal.rate.lunch') + dinner_count * var('meal.rate.dinner')",
        context: { breakfast_count: 3, lunch_count: 2, dinner_count: 1 },
      }),
    });

    const createVariable = await request("/variables", {
      method: "POST",
      body: JSON.stringify({
        key: variableKey,
        name: "Runtime Formula Rate",
        type: "CURRENCY",
        value: "12.34",
        unit: "INR",
        category: "BILLING",
        description: "Runtime-only formula lifecycle fixture",
      }),
    });
    const variableId = createVariable.body?.data?.id as string | undefined;

    const updateVariable = variableId
      ? await request(`/variables/${variableId}`, {
          method: "PUT",
          body: JSON.stringify({ value: "13.45", changeNote: "Runtime version check" }),
        })
      : null;

    const missingCreate = await request("/formulas", {
      method: "POST",
      body: JSON.stringify({
        name: "Missing Dependency Formula",
        key: "formula.runtime.missing",
        expression: "runtime_count * var('runtime.missing.rate')",
        returnType: "CURRENCY",
        category: "BILLING",
      }),
    });

    const createFormula = await request("/formulas", {
      method: "POST",
      body: JSON.stringify({
        name: "Runtime Formula",
        key: formulaKey,
        expression: `runtime_count * var('${variableKey}')`,
        returnType: "CURRENCY",
        category: "BILLING",
        description: "Runtime-only formula lifecycle fixture",
      }),
    });
    const formulaId = createFormula.body?.data?.id as string | undefined;

    const testCreatedFormula = await request("/formulas/test", {
      method: "POST",
      body: JSON.stringify({
        expression: `runtime_count * var('${variableKey}')`,
        context: { runtime_count: 2 },
      }),
    });

    const blockedVariableArchive = variableId
      ? await request(`/variables/${variableId}`, { method: "DELETE" })
      : null;

    const updateFormula = formulaId
      ? await request(`/formulas/${formulaId}`, {
          method: "PATCH",
          body: JSON.stringify({
            expression: `runtime_count * var('${variableKey}') + 1`,
            changeNote: "Runtime version two",
          }),
        })
      : null;

    const blockedMissingUpdate = formulaId
      ? await request(`/formulas/${formulaId}`, {
          method: "PATCH",
          body: JSON.stringify({
            expression: "runtime_count * var('runtime.missing.rate')",
            changeNote: "This version must be rejected",
          }),
        })
      : null;

    const afterRejectedUpdate = await request("/formulas");

    const archiveFormula = formulaId
      ? await request(`/formulas/${formulaId}`, { method: "DELETE" })
      : null;
    const archiveVariable = variableId
      ? await request(`/variables/${variableId}`, { method: "DELETE" })
      : null;
    const protectedArchive = await request("/variables/var_meal_rate_breakfast_local", { method: "DELETE" });

    const finalVariables = await request("/variables");
    const finalFormulas = await request("/formulas");

    return {
      initialVariables,
      initialFormulas,
      canonicalTest,
      createVariable,
      updateVariable,
      missingCreate,
      createFormula,
      testCreatedFormula,
      blockedVariableArchive,
      updateFormula,
      blockedMissingUpdate,
      afterRejectedUpdate,
      archiveFormula,
      archiveVariable,
      protectedArchive,
      finalVariables,
      finalFormulas,
    };
  }, { variableKey: RUNTIME_VARIABLE_KEY, formulaKey: RUNTIME_FORMULA_KEY });

  expect(result.initialVariables.status).toBe(200);
  expect(result.initialVariables.body.data).toHaveLength(10);
  expect(result.initialVariables.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "var_meal_rate_breakfast_local",
      key: "meal.rate.breakfast",
      name: "Breakfast Rate",
      type: "CURRENCY",
      value: "40",
      isProtected: true,
      version: 1,
    }),
  ]));

  expect(result.initialFormulas.status).toBe(200);
  expect(result.initialFormulas.body.data).toHaveLength(4);
  expect(result.initialFormulas.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "formula_meal_charges_local",
      key: "formula.mealCharges",
      name: "Meal Charges",
      version: 1,
      status: "ACTIVE",
    }),
  ]));

  expect(result.canonicalTest).toMatchObject({
    status: 200,
    body: {
      success: true,
      data: {
        valid: true,
        valueExact: "310",
        missingVariables: [],
        missingContext: [],
      },
    },
  });

  expect(result.createVariable.status).toBe(201);
  expect(result.createVariable.body.data).toMatchObject({
    key: RUNTIME_VARIABLE_KEY,
    value: "12.34",
    version: 1,
    status: "ACTIVE",
  });
  expect(result.updateVariable).toMatchObject({
    status: 200,
    body: { success: true, data: { value: "13.45", version: 2 } },
  });

  expect(result.missingCreate).toMatchObject({
    status: 422,
    body: {
      success: false,
      error: "Formula references missing or archived variables",
      missingVariables: ["runtime.missing.rate"],
    },
  });

  expect(result.createFormula.status).toBe(201);
  expect(result.createFormula.body.data).toMatchObject({
    key: RUNTIME_FORMULA_KEY,
    version: 1,
    status: "ACTIVE",
    referencedSlugs: [RUNTIME_VARIABLE_KEY],
    referencedContext: ["runtime_count"],
    missingVariables: [],
  });
  expect(result.testCreatedFormula).toMatchObject({
    status: 200,
    body: {
      success: true,
      data: {
        valid: true,
        valueExact: "26.9",
        missingVariables: [],
        missingContext: [],
      },
    },
  });

  expect(result.blockedVariableArchive).toMatchObject({
    status: 409,
    body: {
      success: false,
      error: "Variable is referenced by active formulas and cannot be archived",
      referencedBy: [expect.objectContaining({ key: RUNTIME_FORMULA_KEY })],
    },
  });

  expect(result.updateFormula).toMatchObject({
    status: 200,
    body: {
      success: true,
      data: { key: RUNTIME_FORMULA_KEY, version: 2 },
    },
  });
  expect(result.blockedMissingUpdate).toMatchObject({
    status: 422,
    body: {
      success: false,
      error: "Formula references missing or archived variables",
      missingVariables: ["runtime.missing.rate"],
    },
  });

  const unchangedFormula = result.afterRejectedUpdate.body.data.find((formula: { key: string }) => formula.key === RUNTIME_FORMULA_KEY);
  expect(unchangedFormula).toMatchObject({
    version: 2,
    expression: `runtime_count * var('${RUNTIME_VARIABLE_KEY}') + 1`,
  });
  expect(unchangedFormula.versions).toHaveLength(2);

  expect(result.archiveFormula).toMatchObject({ status: 200, body: { success: true } });
  expect(result.archiveVariable).toMatchObject({ status: 200, body: { success: true } });
  expect(result.protectedArchive).toMatchObject({
    status: 422,
    body: { success: false, error: "System-protected variables cannot be deleted" },
  });

  expect(result.finalVariables.body.data).toHaveLength(10);
  expect(result.finalVariables.body.data.some((variable: { key: string }) => variable.key === RUNTIME_VARIABLE_KEY)).toBe(false);
  expect(result.finalFormulas.body.data).toHaveLength(4);
  expect(result.finalFormulas.body.data.some((formula: { key: string }) => formula.key === RUNTIME_FORMULA_KEY)).toBe(false);
  expect(failedResponses).toEqual([]);
});

test("resident receives variables read-only and no Formula Engine administration", async ({ browser }) => {
  test.setTimeout(50_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();
  let residentUserId: string | null = null;

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const registration = await residentApi.post(`${API}/api/auth/register`, {
      data: {
        name: "Formula Resident",
        institutionName: "BoardOps Institute",
        institutionUserId: "RES-FORMULA-E2E",
        email: RESIDENT_EMAIL,
        phone: "+919876540630",
        password: RESIDENT_PASSWORD,
        confirmPassword: RESIDENT_PASSWORD,
        room: "FML-630",
        gender: "OTHER",
        consents: { rules: true, privacy: true, terms: true },
      },
    });
    expect(registration.ok()).toBeTruthy();
    const registrationBody = await registration.json() as { data: { userId: string } };
    residentUserId = registrationBody.data.userId;

    const verify = await residentApi.post(`${API}/api/auth/verify-email`, {
      data: { email: RESIDENT_EMAIL, otp: "424242" },
    });
    expect(verify.ok()).toBeTruthy();

    const approve = await adminApi.patch(`${API}/api/users/${residentUserId}`, {
      data: { action: "APPROVE", reason: "Formula Engine least-privilege verification" },
    });
    expect(approve.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const variablesRead = await residentApi.get(`${API}/api/variables`);
    expect(variablesRead.status()).toBe(200);
    const variablesBody = await variablesRead.json() as { data: unknown[] };
    expect(variablesBody.data).toHaveLength(10);

    await expectPermissionDenied(
      await residentApi.post(`${API}/api/variables`, {
        data: { key: "resident.denied", name: "Denied", type: "NUMBER", value: "1", category: "GENERAL" },
      }),
      "variables.create",
    );
    await expectPermissionDenied(
      await residentApi.put(`${API}/api/variables/var_meal_rate_breakfast_local`, { data: { value: "41" } }),
      "variables.update",
    );
    await expectPermissionDenied(
      await residentApi.delete(`${API}/api/variables/var_meal_rate_breakfast_local`),
      "variables.archive",
    );
    await expectPermissionDenied(
      await residentApi.get(`${API}/api/formulas`),
      "formulas.read",
    );
    await expectPermissionDenied(
      await residentApi.post(`${API}/api/formulas`, {
        data: {
          name: "Denied Formula",
          key: "formula.denied",
          expression: "1 + 1",
          returnType: "NUMBER",
          category: "BILLING",
        },
      }),
      "formulas.create",
    );
    await expectPermissionDenied(
      await residentApi.patch(`${API}/api/formulas/formula_meal_charges_local`, {
        data: { expression: "1 + 1", changeNote: "Denied" },
      }),
      "formulas.update",
    );
    await expectPermissionDenied(
      await residentApi.delete(`${API}/api/formulas/formula_meal_charges_local`),
      "formulas.archive",
    );
    await expectPermissionDenied(
      await residentApi.post(`${API}/api/formulas/test`, { data: { expression: "1 + 1" } }),
      "formulas.test",
    );
  } finally {
    if (residentUserId) {
      await adminContext.request.patch(`${API}/api/users/${residentUserId}`, {
        data: { action: "DEACTIVATE", reason: "Formula Engine runtime test cleanup" },
      }).catch(() => undefined);
    }
    await residentContext.close();
    await adminContext.close();
  }
});
