import { expect, test } from "@playwright/test";

test("visual User 360 uses the same composite contract and never renders a blank panel", async ({ page }) => {
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();

  const riyaCard = page
    .getByText("Riya Sen", { exact: true })
    .locator("xpath=ancestor::*[.//button[@aria-label='View 360']][1]");
  await riyaCard.getByRole("button", { name: "View 360", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Resident 360° View" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Riya Sen", exact: true })).toBeVisible();
  await expect(dialog.getByText("resident@boardops.local", { exact: true })).toBeVisible();

  const content = dialog.getByTestId("user-360-tab-content");
  await expect(content).toBeVisible();
  const presentation = await content.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      opacity: Number.parseFloat(style.opacity || "1"),
      height: rect.height,
      textLength: (element.textContent || "").trim().length,
    };
  });
  expect(presentation.opacity).toBeGreaterThan(0.99);
  expect(presentation.height).toBeGreaterThan(120);
  expect(presentation.textLength).toBeGreaterThan(60);

  await expect(dialog.getByText("Profile", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Resident Fund Account", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Not available in this phase", { exact: true }).first()).toBeVisible();

  await dialog.getByRole("tab", { name: "Bills", exact: true }).click();
  await expect(dialog.getByText("Billing history", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(dialog.getByText("Payments & refunds", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Ledger", exact: true }).click();
  await expect(dialog.getByText("Resident ledger", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Restrictions", exact: true }).click();
  await expect(dialog.getByText("Restriction evaluation", { exact: true })).toBeVisible();
});
