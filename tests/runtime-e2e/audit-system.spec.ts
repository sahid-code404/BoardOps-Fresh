import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_ID = "usr_resident_riya_local";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@System#2026!";

async function json<T>(response: APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

async function login(api: APIRequestContext, email: string, password: string) {
  const response = await api.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}

async function expectPermissionDenied(response: APIResponse, permission: string) {
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    error: "Permission denied",
    requiredPermission: permission,
  });
}

async function waitForTask(api: APIRequestContext, id: string) {
  let task: {
    id: string;
    type: string;
    status: string;
    result: string | null;
    errorMessage: string | null;
  } | null = null;

  await expect.poll(async () => {
    const response = await api.get(`${API}/api/tasks/${id}`);
    if (!response.ok()) return `HTTP_${response.status()}`;
    const body = await json<{ data: typeof task }>(response);
    task = body.data;
    if (task?.status === "FAILED") {
      throw new Error(`Background task ${id} failed: ${task.errorMessage ?? "unknown error"}`);
    }
    return task?.status ?? "MISSING";
  }, { timeout: 15_000, intervals: [100, 200, 400, 800] }).toBe("COMPLETED");

  expect(task).not.toBeNull();
  return task!;
}

async function loginAdminShell(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });
}

test("Audit, System, and Background Tasks are durable, scoped, asynchronous, and least-privilege", async ({ browser }) => {
  test.setTimeout(90_000);
  const adminContext = await browser.newContext();
  const staleSessionContext = await browser.newContext();
  const residentContext = await browser.newContext();
  const shellContext = await browser.newContext();

  try {
    const adminApi = adminContext.request;
    await login(adminApi, ADMIN_EMAIL, ADMIN_PASSWORD);

    const auditResponse = await adminApi.get(`${API}/api/audit-logs?entity=System&search=SYSTEM_CHECKPOINT`);
    expect(auditResponse.status()).toBe(200);
    const audit = await json<{
      data: {
        logs: Array<{ id: string; action: string; entity: string; actor: { name: string } | null }>;
        total: number;
        filters: { entities: string[]; actions: string[] };
      };
    }>(auditResponse);
    expect(audit.data.logs).toContainEqual(expect.objectContaining({
      id: "audit_system_checkpoint_seed",
      action: "SYSTEM_CHECKPOINT",
      entity: "System",
      actor: expect.objectContaining({ name: "BoardOps Admin" }),
    }));
    expect(audit.data.filters.entities).toContain("System");
    expect(audit.data.filters.actions).toContain("SYSTEM_CHECKPOINT");

    const initialTasks = await adminApi.get(`${API}/api/tasks`);
    expect(initialTasks.status()).toBe(200);
    const taskList = await json<{ data: Array<{ id: string; status: string; type: string }> }>(initialTasks);
    expect(taskList.data).toContainEqual(expect.objectContaining({
      id: "task_session_cleanup_seed",
      status: "COMPLETED",
      type: "SESSION_CLEANUP",
    }));
    expect(taskList.data).toContainEqual(expect.objectContaining({
      id: "task_system_backup_queued_seed",
      status: "QUEUED",
      type: "SYSTEM_BACKUP",
    }));

    const cancelSeed = await adminApi.post(`${API}/api/tasks/task_system_backup_queued_seed/cancel`);
    expect(cancelSeed.status()).toBe(200);
    await expect(cancelSeed.json()).resolves.toMatchObject({
      success: true,
      data: { cancelled: true, taskId: "task_system_backup_queued_seed" },
    });
    const repeatedCancel = await adminApi.post(`${API}/api/tasks/task_system_backup_queued_seed/cancel`);
    expect(repeatedCancel.status()).toBe(409);

    await login(staleSessionContext.request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const logout = await staleSessionContext.request.post(`${API}/api/auth/logout`);
    expect(logout.ok()).toBeTruthy();

    const cleanupResponse = await adminApi.post(`${API}/api/tasks/cleanup`);
    expect(cleanupResponse.status()).toBe(202);
    const cleanupQueued = await json<{ data: { taskId: string; queued: boolean } }>(cleanupResponse);
    expect(cleanupQueued.data.queued).toBe(true);
    const cleanupTask = await waitForTask(adminApi, cleanupQueued.data.taskId);
    const cleanupResult = JSON.parse(cleanupTask.result ?? "{}") as { purgedSessions?: number };
    expect(cleanupResult.purgedSessions).toBeGreaterThanOrEqual(1);

    const ownedTaskAttempt = await adminApi.post(`${API}/api/tasks`, {
      data: { type: "MONTHLY_CLOSING" },
    });
    expect(ownedTaskAttempt.status()).toBe(422);
    await expect(ownedTaskAttempt.json()).resolves.toMatchObject({
      success: false,
      error: "This task type is owned by its canonical domain or is not dispatchable from System",
    });

    const backupResponse = await adminApi.post(`${API}/api/system/backup`);
    expect(backupResponse.status()).toBe(202);
    const backupQueued = await json<{ data: { taskId: string; queued: boolean; output: string } }>(backupResponse);
    expect(backupQueued.data.queued).toBe(true);
    expect(backupQueued.data.output).toMatch(/private D1 logical backup/iu);
    const backupTask = await waitForTask(adminApi, backupQueued.data.taskId);
    const backupResult = JSON.parse(backupTask.result ?? "{}") as {
      objectKey?: string;
      bytes?: number;
      sha256?: string;
      rowCount?: number;
      tableCount?: number;
      redacted?: boolean;
    };
    expect(backupResult.objectKey).toMatch(/^backups\/inst_boardops_local\//u);
    expect(backupResult.bytes).toBeGreaterThan(0);
    expect(backupResult.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(backupResult.rowCount).toBeGreaterThan(0);
    expect(backupResult.tableCount).toBeGreaterThan(0);
    expect(backupResult.redacted).toBe(true);

    const setResidentPassword = await adminApi.put(`${API}/api/users/${RESIDENT_ID}`, {
      data: { password: RESIDENT_PASSWORD },
    });
    expect(setResidentPassword.ok()).toBeTruthy();
    await login(residentContext.request, RESIDENT_EMAIL, RESIDENT_PASSWORD);

    await expectPermissionDenied(await residentContext.request.get(`${API}/api/audit-logs`), "audit.read");
    await expectPermissionDenied(await residentContext.request.get(`${API}/api/tasks`), "tasks.read");
    await expectPermissionDenied(await residentContext.request.post(`${API}/api/tasks/cleanup`), "tasks.cleanup");
    await expectPermissionDenied(await residentContext.request.post(`${API}/api/system/backup`), "system.backup");

    const page = await shellContext.newPage();
    await loginAdminShell(page);
    await page.getByRole("button", { name: "More navigation" }).click();
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeInViewport();
    await sidebar.getByRole("button", { name: "System", exact: true }).click();
    await expect(page).toHaveURL(/\/system(?:\?|$)/, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "System (Audit & Tasks)", exact: true })).toBeVisible({ timeout: 8_000 });

    const main = page.locator("main");
    await expect(main.getByRole("tab", { name: "Audit Log", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(main.getByText("SYSTEM_CHECKPOINT", { exact: true }).first()).toBeVisible();

    await main.getByRole("tab", { name: "Background Tasks", exact: true }).click();
    await expect(main.getByRole("button", { name: "Run Session Cleanup", exact: true })).toBeVisible();
    await expect(main.getByText("Session Cleanup", { exact: true }).first()).toBeVisible();

    await main.getByRole("tab", { name: "Data Export", exact: true }).click();
    await expect(main.getByRole("button", { name: /Export Users/u })).toBeVisible();
    await expect(main.getByRole("button", { name: /Backup Database/u })).toBeVisible();
    await expect(main.getByText("Create a redacted D1 logical snapshot in private R2 storage", { exact: true })).toBeVisible();
  } finally {
    // Every API/browser login created by this test is explicitly revoked before
    // closing its context. BrowserContext.close() does not revoke server-side
    // D1 sessions, and leaking those rows makes later session-management tests
    // observe extra legitimate devices.
    await Promise.allSettled([
      shellContext.request.post(`${API}/api/auth/logout`),
      residentContext.request.post(`${API}/api/auth/logout`),
      staleSessionContext.request.post(`${API}/api/auth/logout`),
      adminContext.request.post(`${API}/api/auth/logout`),
    ]);
    await shellContext.close();
    await residentContext.close();
    await staleSessionContext.close();
    await adminContext.close();
  }
});
