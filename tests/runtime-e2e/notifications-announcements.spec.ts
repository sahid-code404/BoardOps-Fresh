import { expect, test, type APIResponse, type Page } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const ADMIN_EMAIL = "admin@boardops.local";
const ADMIN_PASSWORD = "BoardOps@Fresh#2026!A7";
const RESIDENT_ID = "usr_resident_riya_local";
const RESIDENT_EMAIL = "riya@boardops.local";
const RESIDENT_PASSWORD = "BoardOps@Notifications#2026!";
const ANNOUNCEMENT_TITLE = "Runtime resident communication";
const ANNOUNCEMENT_BODY = "Runtime-only announcement used to prove idempotent resident delivery.";

async function json<T = Record<string, unknown>>(response: APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

async function expectPermissionDenied(response: APIResponse, permission: string) {
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    error: "Permission denied",
    requiredPermission: permission,
  });
}

async function loginAdminShell(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(ADMIN_PASSWORD);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });
}

test("Notifications and Announcements use durable self-scoped idempotent delivery", async ({ browser }) => {
  test.setTimeout(60_000);

  const adminContext = await browser.newContext();
  const residentContext = await browser.newContext();

  try {
    const adminApi = adminContext.request;
    const residentApi = residentContext.request;

    const adminLogin = await adminApi.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(adminLogin.ok()).toBeTruthy();

    // Reuse the deterministic active resident. This proves the real cookie/RBAC
    // path without spending another shared-IP email-verification challenge.
    const setResidentPassword = await adminApi.put(`${API}/api/users/${RESIDENT_ID}`, {
      data: { password: RESIDENT_PASSWORD },
    });
    expect(setResidentPassword.ok()).toBeTruthy();

    const residentLogin = await residentApi.post(`${API}/api/auth/login`, {
      data: { email: RESIDENT_EMAIL, password: RESIDENT_PASSWORD },
    });
    expect(residentLogin.ok()).toBeTruthy();

    const initialInboxResponse = await residentApi.get(`${API}/api/notifications`);
    expect(initialInboxResponse.status()).toBe(200);
    const initialInbox = await json<{
      success: boolean;
      data: { unreadCount: number; notifications: Array<{ id: string; title: string; readAt: string | null }> };
    }>(initialInboxResponse);
    expect(initialInbox.success).toBe(true);
    expect(initialInbox.data.notifications.some((item) => item.title === "BoardOps local notice")).toBe(true);

    // Create as DRAFT first so publishing is a separate lifecycle transition.
    const create = await adminApi.post(`${API}/api/announcements`, {
      data: {
        title: ANNOUNCEMENT_TITLE,
        body: ANNOUNCEMENT_BODY,
        type: "INFO",
        priority: "HIGH",
        targetAudience: "RESIDENTS",
        isPinned: false,
        status: "DRAFT",
      },
    });
    expect(create.status()).toBe(201);
    const created = await json<{ success: boolean; data: { id: string; status: string; publishedAt: string | null } }>(create);
    expect(created).toMatchObject({ success: true, data: { status: "DRAFT", publishedAt: null } });
    const announcementId = created.data.id;

    const beforePublish = await residentApi.get(`${API}/api/notifications`);
    const beforePublishBody = await json<{ data: { notifications: Array<{ title: string }> } }>(beforePublish);
    expect(beforePublishBody.data.notifications.filter((item) => item.title === ANNOUNCEMENT_TITLE)).toHaveLength(0);

    const publish = await adminApi.patch(`${API}/api/announcements/${announcementId}`, {
      data: { status: "PUBLISHED" },
    });
    expect(publish.status()).toBe(200);
    const publishBody = await json<{ data: { status: string; publishedAt: string | null } }>(publish);
    expect(publishBody.data.status).toBe("PUBLISHED");
    expect(publishBody.data.publishedAt).toBeTruthy();

    let residentInboxResponse = await residentApi.get(`${API}/api/notifications`);
    let residentInbox = await json<{
      data: {
        unreadCount: number;
        notifications: Array<{ id: string; title: string; description: string; readAt: string | null }>;
      };
    }>(residentInboxResponse);
    const firstDelivery = residentInbox.data.notifications.filter((item) => item.title === ANNOUNCEMENT_TITLE);
    expect(firstDelivery).toHaveLength(1);
    expect(firstDelivery[0]).toMatchObject({ description: ANNOUNCEMENT_BODY, readAt: null });

    // A harmless update to an already-published announcement intentionally runs
    // the delivery fan-out again. The database delivery key must keep one row.
    const replayPublish = await adminApi.patch(`${API}/api/announcements/${announcementId}`, {
      data: { isPinned: true },
    });
    expect(replayPublish.status()).toBe(200);

    residentInboxResponse = await residentApi.get(`${API}/api/notifications`);
    residentInbox = await json(residentInboxResponse);
    expect(residentInbox.data.notifications.filter((item) => item.title === ANNOUNCEMENT_TITLE)).toHaveLength(1);

    // Published delivery content is immutable; corrections require archive + new.
    const editPublished = await adminApi.patch(`${API}/api/announcements/${announcementId}`, {
      data: { body: "This mutation must be rejected after publication." },
    });
    expect(editPublished.status()).toBe(422);
    await expect(editPublished.json()).resolves.toMatchObject({
      success: false,
      error: "Published announcement delivery content cannot be edited; archive it and create a correction",
    });

    const residentAnnouncements = await residentApi.get(`${API}/api/announcements`);
    expect(residentAnnouncements.status()).toBe(200);
    const residentAnnouncementsBody = await json<{ data: Array<{ id: string; title: string; targetAudience: string }> }>(residentAnnouncements);
    expect(residentAnnouncementsBody.data).toContainEqual(expect.objectContaining({
      id: announcementId,
      title: ANNOUNCEMENT_TITLE,
      targetAudience: "RESIDENTS",
    }));

    await expectPermissionDenied(
      await residentApi.post(`${API}/api/announcements`, {
        data: { title: "Denied", body: "Resident cannot publish", status: "PUBLISHED" },
      }),
      "announcements.create",
    );
    await expectPermissionDenied(
      await residentApi.patch(`${API}/api/announcements/${announcementId}`, { data: { isPinned: false } }),
      "announcements.update",
    );
    await expectPermissionDenied(
      await residentApi.delete(`${API}/api/announcements/${announcementId}`),
      "announcements.archive",
    );

    // Exercise an independent canonical domain transition. The leave insert must
    // notify Admin, the decision must notify Riya, and retry must not redeliver.
    const leaveCreate = await residentApi.post(`${API}/api/leave`, {
      data: {
        startDate: "2026-10-10",
        endDate: "2026-10-11",
        reason: "Runtime notification event delivery",
        mealType: "ALL",
        mealIds: [],
      },
    });
    expect(leaveCreate.status()).toBe(201);
    const leaveBody = await json<{ data: { id: string; status: string } }>(leaveCreate);
    expect(leaveBody.data.status).toBe("PENDING");

    const adminInbox = await adminApi.get(`${API}/api/notifications`);
    expect(adminInbox.status()).toBe(200);
    const adminInboxBody = await json<{ data: { notifications: Array<{ title: string; description: string }> } }>(adminInbox);
    expect(adminInboxBody.data.notifications).toContainEqual(expect.objectContaining({
      title: "New leave application",
      description: expect.stringContaining("2026-10-10 to 2026-10-11"),
    }));

    const decideLeave = await adminApi.patch(`${API}/api/leave/${leaveBody.data.id}`, {
      data: { status: "REJECTED", adminNotes: "Runtime notification decision" },
    });
    expect(decideLeave.status()).toBe(200);

    const retryDecision = await adminApi.patch(`${API}/api/leave/${leaveBody.data.id}`, {
      data: { status: "REJECTED", adminNotes: "Retry must not redeliver" },
    });
    expect(retryDecision.status()).toBe(409);

    residentInboxResponse = await residentApi.get(`${API}/api/notifications`);
    residentInbox = await json(residentInboxResponse);
    const decisionDeliveries = residentInbox.data.notifications.filter(
      (item) => item.title === "Leave rejected" && item.description.includes("2026-10-10") && item.description.includes("Runtime notification decision"),
    );
    expect(decisionDeliveries).toHaveLength(1);

    const runtimeNotice = residentInbox.data.notifications.find((item) => item.title === ANNOUNCEMENT_TITLE);
    expect(runtimeNotice).toBeTruthy();
    expect(runtimeNotice?.readAt).toBeNull();
    const unreadBeforeMark = residentInbox.data.unreadCount;

    const markRead = await residentApi.patch(`${API}/api/notifications`, { data: { id: runtimeNotice!.id } });
    expect(markRead.status()).toBe(200);
    const markReadReplay = await residentApi.patch(`${API}/api/notifications`, { data: { id: runtimeNotice!.id } });
    expect(markReadReplay.status()).toBe(200);

    residentInboxResponse = await residentApi.get(`${API}/api/notifications`);
    residentInbox = await json(residentInboxResponse);
    const markedNotice = residentInbox.data.notifications.find((item) => item.id === runtimeNotice!.id);
    expect(markedNotice?.readAt).toBeTruthy();
    expect(residentInbox.data.unreadCount).toBe(unreadBeforeMark - 1);

    const archive = await adminApi.delete(`${API}/api/announcements/${announcementId}`);
    expect(archive.status()).toBe(200);
    const archiveReplay = await adminApi.delete(`${API}/api/announcements/${announcementId}`);
    expect(archiveReplay.status()).toBe(200);

    const afterArchiveResident = await residentApi.get(`${API}/api/announcements`);
    const afterArchiveResidentBody = await json<{ data: Array<{ id: string }> }>(afterArchiveResident);
    expect(afterArchiveResidentBody.data.some((item) => item.id === announcementId)).toBe(false);

    const archivedAdmin = await adminApi.get(`${API}/api/announcements?status=ARCHIVED`);
    const archivedAdminBody = await json<{ data: Array<{ id: string; status: string }> }>(archivedAdmin);
    expect(archivedAdminBody.data).toContainEqual(expect.objectContaining({ id: announcementId, status: "ARCHIVED" }));

    // Finally prove the real shell renders the same D1-backed communication data.
    // APIRequestContext cookies are not used as a browser bootstrap contract here;
    // use the same proven UI sign-in flow as the authenticated-shell runtime test.
    const adminPage = await adminContext.newPage();
    await loginAdminShell(adminPage);
    await adminPage.getByRole("button", { name: "More navigation" }).click();
    const sidebar = adminPage.getByRole("complementary");
    await expect(sidebar).toBeInViewport();
    await sidebar.getByRole("button", { name: "Notifications", exact: true }).click();
    await expect(adminPage).toHaveURL(/\/notifications(?:\?|$)/, { timeout: 5_000 });
    await expect(adminPage.getByRole("tab", { name: "Personal", exact: true })).toBeVisible();
    await expect(adminPage.getByRole("tab", { name: "Announcements", exact: true })).toBeVisible();
    await expect(adminPage.getByText("BoardOps local notice", { exact: true }).first()).toBeVisible({ timeout: 8_000 });

    await adminPage.getByRole("tab", { name: "Announcements", exact: true }).click();
    await expect(adminPage.getByRole("button", { name: "New Announcement", exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(adminPage.getByText("BoardOps local notice", { exact: true })).toBeVisible({ timeout: 8_000 });
  } finally {
    await residentContext.close();
    await adminContext.close();
  }
});
