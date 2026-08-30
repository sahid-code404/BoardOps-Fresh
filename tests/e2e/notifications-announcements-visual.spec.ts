import { expect, test } from "@playwright/test";

test("Notifications and Announcements preserve the golden communication surface", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  // Exercise the same live shell navigation users take instead of relying only
  // on a cold route mount.
  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Notifications", exact: true }).click();

  await expect(page).toHaveURL(/\/notifications(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Notifications & Announcements", exact: true })).toBeVisible();

  const personal = page.getByRole("tab", { name: "Personal", exact: true });
  const announcements = page.getByRole("tab", { name: "Announcements", exact: true });
  await expect(personal).toBeVisible();
  await expect(announcements).toBeVisible();
  await expect(personal).toHaveAttribute("aria-selected", "true");

  // Personal inbox keeps the expected controls and fixture-backed content.
  await expect(page.getByRole("button", { name: "Mark all read", exact: true })).toBeVisible();
  for (const filter of ["All", "Unread", "Info", "Success", "Warning", "Alerts"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${filter}`) }).first()).toBeVisible();
  }
  await expect(page.getByText("Monthly statement is ready", { exact: true })).toBeVisible({ timeout: 5_000 });

  await announcements.click();
  await expect(announcements).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Show archived", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Announcement", exact: true })).toBeVisible();

  const main = page.locator("main");
  for (const label of ["Total", "Pinned", "High Priority", "Expiring Soon"]) {
    await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // The create flow must render as a usable modal with all critical controls.
  await page.getByRole("button", { name: "New Announcement", exact: true }).click();
  const dialog = page.locator('[data-slot="dialog-content"]').filter({
    has: page.getByRole("heading", { name: "New Announcement", exact: true }),
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title *", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Message *", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Type", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Priority", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Target", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Expiry Date (optional)", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Pin to dashboard", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Final layout guard: no horizontal clipping on the communication hub.
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    mainText: (document.querySelector("main")?.textContent || "").trim().length,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 2);
  expect(geometry.mainText).toBeGreaterThan(20);
});
