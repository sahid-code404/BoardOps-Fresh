import { expect, test } from "@playwright/test";

test("visual Funds renders the canonical composite contract and interactions", async ({ page }) => {
  // Keep this visual fixture anchored to the canonical August 2026 dataset.
  // Without a fixed clock the Funds page defaults to the runner's current
  // month, so the test becomes date-dependent as soon as the calendar rolls.
  await page.clock.setFixedTime(new Date("2026-08-15T12:00:00.000Z"));
  await page.goto("/funds");

  await expect(page.getByText("Total Deposit", { exact: true })).toBeVisible();
  await expect(page.getByText("Remaining Fund", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Deficit", { exact: true })).toBeVisible();
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();
  await expect(page.getByText("Room B-204", { exact: true })).toBeVisible();
  await expect(page.getByText("Deposit", { exact: true })).toBeVisible();
  await expect(page.getByText("Deficit", { exact: true }).last()).toBeVisible();

  const deficitFilter = page.getByRole("button", { name: /Deficit/ });
  await deficitFilter.click();
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();

  const search = page.getByPlaceholder("Search by name, email, or room…");
  await search.fill("B-204");
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();

  await search.fill("does-not-exist");
  await expect(page.getByText("No users match your search.", { exact: true })).toBeVisible();
});
