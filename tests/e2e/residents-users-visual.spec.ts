import { expect, test, type Page } from "@playwright/test";

function userCard(page: Page, name: string) {
  return page
    .getByText(name, { exact: true })
    .locator("xpath=ancestor::*[.//button[@aria-label='User actions']][1]");
}

test("User Management preserves review and seven-day deletion UX", async ({ page }) => {
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();
  await expect(page.getByText("Kabir Mehta", { exact: true })).toBeVisible();

  const kabirCard = userCard(page, "Kabir Mehta");
  await kabirCard.getByRole("button", { name: "User actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Request Changes", exact: true }).click();

  const changesDialog = page.getByRole("dialog");
  await expect(changesDialog.getByText("Request Changes — Kabir Mehta", { exact: true })).toBeVisible();
  await expect(changesDialog.getByText("Fields needing correction", { exact: true })).toBeVisible();
  await expect(changesDialog.getByText("Full Name", { exact: true })).toBeVisible();
  await expect(changesDialog.getByText("Institution User ID", { exact: true })).toBeVisible();
  await expect(changesDialog.getByText("Room Number", { exact: true })).toBeVisible();
  await expect(changesDialog.getByText(/resident will be notified/u)).toBeVisible();
  await changesDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  const riyaCard = userCard(page, "Riya Sen");
  await riyaCard.getByRole("button", { name: "User actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();

  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog.getByText("Delete Riya Sen?", { exact: true })).toBeVisible();
  await expect(deleteDialog.getByText(/deletion queue/u).first()).toBeVisible();
  await expect(deleteDialog.getByText(/permanently deleted after/u)).toBeVisible();
  await expect(deleteDialog.getByText("7 days", { exact: true })).toBeVisible();
  await expect(deleteDialog.getByText(/notification about the scheduled deletion/u)).toBeVisible();
  await expect(deleteDialog.getByRole("button", { name: "Move to Deletion Queue", exact: true })).toBeVisible();
});
