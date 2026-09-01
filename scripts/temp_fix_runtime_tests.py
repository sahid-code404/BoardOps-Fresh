from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"expected one match in {path}, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1))

replace_once(
    "tests/runtime-e2e/billing.spec.ts",
    '  await page.getByRole("button", { name: "Previous month", exact: true }).click();\n  await expect(page.getByText("Arjun Rao", { exact: true }).first()).toBeVisible({ timeout: 8_000 });',
    '  const billingNow = new Date();\n  const billingCurrentKey = billingNow.getFullYear() * 12 + billingNow.getMonth();\n  const july2026Key = 2026 * 12 + 6;\n  for (let step = 0; step < Math.max(0, billingCurrentKey - july2026Key); step += 1) {\n    await page.getByRole("button", { name: "Previous month", exact: true }).click();\n  }\n  await expect(page.getByText("Arjun Rao", { exact: true }).first()).toBeVisible({ timeout: 8_000 });',
)

replace_once(
    "tests/runtime-e2e/expenses.spec.ts",
    '  await page.goto("/expenses");\n  await expect(page).toHaveURL(/\\/expenses(?:\\?|$)/, { timeout: 5_000 });\n  await expect(page.getByText("Monthly groceries", { exact: true })).toBeVisible({ timeout: 8_000 });',
    '  await page.goto("/expenses");\n  await expect(page).toHaveURL(/\\/expenses(?:\\?|$)/, { timeout: 5_000 });\n  const expensesNow = new Date();\n  const expensesCurrentKey = expensesNow.getFullYear() * 12 + expensesNow.getMonth();\n  const august2026Key = 2026 * 12 + 7;\n  for (let step = 0; step < Math.max(0, expensesCurrentKey - august2026Key); step += 1) {\n    await page.getByRole("button", { name: "Previous month", exact: true }).click();\n  }\n  await expect(page.getByText("Monthly groceries", { exact: true })).toBeVisible({ timeout: 8_000 });',
)

replace_once(
    "tests/runtime-e2e/monthly-closing.spec.ts",
    '  // The screen defaults to July 2026 on the deterministic test date. Navigate\n  // through the real month controls to the isolated May closing fixture.\n  await page.getByRole("button", { name: "Previous month", exact: true }).click();\n  await page.getByRole("button", { name: "Previous month", exact: true }).click();\n  await expect(page.getByRole("button", { name: /Generate Bills & Close May 2026/u })).toBeVisible({ timeout: 8_000 });',
    '  const closingNow = new Date();\n  const latestClosableKey = closingNow.getFullYear() * 12 + closingNow.getMonth() - 1;\n  const may2026Key = 2026 * 12 + 4;\n  for (let step = 0; step < Math.max(0, latestClosableKey - may2026Key); step += 1) {\n    await page.getByRole("button", { name: "Previous month", exact: true }).click();\n  }\n  await expect(page.getByRole("button", { name: /Generate Bills & Close May 2026/u })).toBeVisible({ timeout: 8_000 });',
)

replace_once(
    "tests/runtime-e2e/reports.spec.ts",
    '    await expect(page.getByRole("heading", { name: "Reports & Analytics", exact: true })).toBeVisible({ timeout: 8_000 });\n    await expect(page.getByText("Total Expenses", { exact: true })).toBeVisible();',
    '    await expect(page.getByRole("heading", { name: "Reports & Analytics", exact: true })).toBeVisible({ timeout: 8_000 });\n    const reportsNow = new Date();\n    const reportsCurrentKey = reportsNow.getFullYear() * 12 + reportsNow.getMonth();\n    const august2026Key = 2026 * 12 + 7;\n    for (let step = 0; step < Math.max(0, reportsCurrentKey - august2026Key); step += 1) {\n      await page.getByRole("button", { name: "Previous month", exact: true }).click();\n    }\n    await expect(page.getByText("Total Expenses", { exact: true })).toBeVisible();',
)

replace_once(
    "tests/runtime-e2e/registration-workflow.spec.ts",
    '  await page.getByRole("button", { name: /Create account/u }).click();\n  await expect(page.getByText("Verify your email", { exact: true })).toBeVisible();\n  await expect(page.getByText(applicant.email, { exact: true })).toBeVisible();\n\n  const otpInput = page.locator(\'[data-slot="input-otp"]\');\n  await expect(otpInput).toBeVisible();\n  await otpInput.fill("424242");\n  await page.getByRole("button", { name: "Verify Email", exact: true }).click();\n\n  await expect(page.getByText("Registration received", { exact: true })).toBeVisible();\n  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();',
    '  await page.getByRole("button", { name: /Create account/u }).click();\n  await expect(page.getByText("Registration received", { exact: true })).toBeVisible();\n  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();\n  await expect(page.getByText(applicant.email, { exact: true })).toBeVisible();\n  await expect(page.getByText("Verify your email", { exact: true })).toHaveCount(0);\n  await expect(page.locator(\'[data-slot="input-otp"]\')).toHaveCount(0);',
)

replace_once(
    "tests/runtime-e2e/registration-workflow.spec.ts",
    '    await expect(page.getByText("Verify your email", { exact: true })).toBeVisible({ timeout: 10_000 });\n    await expect(page.getByText(UPDATED_EMAIL, { exact: true })).toBeVisible();\n    const otpInput = page.locator(\'[data-slot="input-otp"]\');\n    await otpInput.fill("424242");\n    await page.getByRole("button", { name: "Verify Email", exact: true }).click();\n\n    await expect(page.getByText("Registration received", { exact: true })).toBeVisible();\n    await expect(page.getByText("Email verified", { exact: true })).toBeVisible();\n    await expect(page.getByText("In review", { exact: true })).toBeVisible({ timeout: 10_000 });',
    '    await expect(page.getByText("Registration received", { exact: true })).toBeVisible({ timeout: 10_000 });\n    await expect(page.getByText("Email verified", { exact: true })).toBeVisible();\n    await expect(page.getByText(UPDATED_EMAIL, { exact: true })).toBeVisible();\n    await expect(page.getByText("Verify your email", { exact: true })).toHaveCount(0);\n    await expect(page.locator(\'[data-slot="input-otp"]\')).toHaveCount(0);\n    await expect(page.getByText("In review", { exact: true })).toBeVisible({ timeout: 10_000 });',
)

replace_once(
    "tests/runtime-e2e/residents-users.spec.ts",
    '  await page.getByRole("button", { name: /Create account/u }).click();\n  await expect(page.getByText("Verify your email", { exact: true })).toBeVisible();\n  await page.locator(\'[data-slot="input-otp"]\').fill("424242");\n  await page.getByRole("button", { name: "Verify Email", exact: true }).click();\n  await expect(page.getByText("Registration received", { exact: true })).toBeVisible();',
    '  await page.getByRole("button", { name: /Create account/u }).click();\n  await expect(page.getByText("Registration received", { exact: true })).toBeVisible();\n  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();\n  await expect(page.getByText("Verify your email", { exact: true })).toHaveCount(0);\n  await expect(page.locator(\'[data-slot="input-otp"]\')).toHaveCount(0);',
)

p = Path("tests/runtime-e2e/resident-meals-leave.spec.ts")
text = p.read_text()
for old, new in [
    ('const oneTimeDate = "2026-09-20";', 'const oneTimeDate = "2026-09-15";'),
    ('2026-09-19', '2026-09-14'),
    ('2026-09-21', '2026-09-16'),
]:
    if old not in text:
        raise SystemExit(f"missing resident meal date {old}")
    text = text.replace(old, new)
p.write_text(text)
