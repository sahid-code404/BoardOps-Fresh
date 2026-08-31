import { expect, test } from "@playwright/test";

test("authentication preserves sign-in, registration, and password-recovery surfaces", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard?auth=1");

  await expect(page.getByRole("tab", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Register", exact: true })).toBeVisible();
  await expect(page.locator("form").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Register", exact: true }).click();
  await expect(page.getByLabel("Full Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Institution User ID", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Mobile Number", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Personal Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Room Number", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Create account/u })).toBeVisible();

  await page.getByRole("tab", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await expect(page.getByText("Reset Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send Reset Code", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Back to sign in/u })).toBeVisible();
});
