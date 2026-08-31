import { expect, test } from "@playwright/test";

test("visual User 360 renders hydrated finance, meal and ledger surfaces", async ({ page }) => {
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
  expect(presentation.textLength).toBeGreaterThan(80);

  await expect(dialog.getByText("Resident Fund Account", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Available Balance", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Outstanding Due", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Meals This Month", { exact: true })).toBeVisible();
  await expect(dialog.getByText("18", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Profile", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Bills", exact: true }).click();
  await expect(dialog.getByText(/BILL-2026-08-0204/u)).toBeVisible();
  await expect(dialog.getByText("PARTIALLY_PAID", { exact: true })).toBeVisible();

  await dialog.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(dialog.getByText("Recent Payments", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Recent Refunds", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/₹2,400 · UPI/u)).toBeVisible();
  await expect(dialog.getByText(/REF-2026-0204/u)).toBeVisible();

  await dialog.getByRole("tab", { name: "Ledger", exact: true }).click();
  await expect(dialog.getByText(/Payment · UPI/u)).toBeVisible();
  await expect(dialog.getByText(/Bill · 2026-08/u)).toBeVisible();

  await dialog.getByRole("tab", { name: "Restrictions", exact: true }).click();
  await expect(dialog.getByText("Restriction evaluation", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Financial and administrative restriction evaluation is not available in the current D1 schema yet.", { exact: true })).toBeVisible();
});
