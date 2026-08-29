import { expect, test, type Page } from "@playwright/test";

async function expectNoStuckPersistentOpacity(page: Page) {
  // Playwright's built-in `toBeVisible()` intentionally treats opacity: 0 as
  // visible because the element still has layout. BoardOps had a real browser
  // failure where Framer Motion stranded content at opacity: 0 forever, so we
  // explicitly audit mounted, content-bearing shell wrappers after animations
  // have had time to settle.
  await page.waitForTimeout(350);
  const stuck = await page.locator("header, main, nav").evaluateAll((roots) => {
    const failures: string[] = [];
    const seen = new Set<Element>();

    for (const root of roots) {
      root.querySelectorAll("div").forEach((candidate) => {
        if (seen.has(candidate)) return;
        seen.add(candidate);

        const element = candidate as HTMLElement;
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        if (element.closest('[aria-hidden="true"]')) return;
        if (element.getAttribute("data-state") === "closed") return;

        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity !== "0") return;

        const text = (element.textContent || "").trim();
        const hasUiDescendant = Boolean(
          element.querySelector("button, a, input, textarea, select, svg, img, h1, h2, h3, p"),
        );
        if (!hasUiDescendant && text.length === 0) return;

        const className = typeof element.className === "string" ? element.className : "";
        failures.push(`${element.tagName.toLowerCase()}.${className.slice(0, 120)}`);
      });
    }

    return failures.slice(0, 12);
  });

  expect(stuck).toEqual([]);
}

test("real local runtime loads the complete administrator shell", async ({ page }) => {
  const failedApiResponses: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && response.status() >= 400) {
      failedApiResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Email", exact: true }).fill("admin@boardops.local");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("BoardOps@Fresh#2026!A7");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 5_000 });

  // Essential account identity is available independently of dashboard-domain
  // data, so a slow/failed KPI request can never leave the administrator with
  // an anonymous shell.
  await expect(page.getByText("Signed in administrator", { exact: true })).toBeVisible();
  await expect(page.getByText("BoardOps Admin", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("admin@boardops.local", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel("Loading dashboard data")).toHaveCount(0, { timeout: 5_000 });

  // Golden-master glass/background prerequisites must be installed in the real
  // runtime, not only in the fixture build.
  await expect(page.locator(".mesh-bg")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-glass-mode", "on");
  await expect(page.locator("html")).toHaveAttribute("data-blur-intensity", "normal");
  await expect(page.locator("html")).toHaveAttribute("data-transparency", "medium");

  const mesh = await page.locator(".mesh-bg").evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      backgroundImage: style.backgroundImage,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(mesh.backgroundImage).not.toBe("none");
  expect(mesh.width).toBeGreaterThan(300);
  expect(mesh.height).toBeGreaterThan(300);

  // The theme glyph previously became an empty circle because its Motion
  // wrapper remained at opacity: 0 even though the button itself was "visible".
  const themeGlyphOpacity = await page
    .getByRole("button", { name: "Theme switcher", exact: true })
    .locator(":scope > div")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
  expect(themeGlyphOpacity).toBeGreaterThan(0.9);
  await expectNoStuckPersistentOpacity(page);

  await page.getByRole("button", { name: "View profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
  await expect(page.getByText("BoardOps Admin", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("admin@boardops.local", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload avatar", exact: true })).toBeVisible();

  // Profile hero identity/avatar are content-bearing Motion wrappers. Assert
  // their effective wrappers are actually opaque, not merely laid out.
  const heroIdentityOpacity = await page
    .getByRole("heading", { name: "BoardOps Admin", exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element.parentElement!).opacity));
  expect(heroIdentityOpacity).toBeGreaterThan(0.9);

  const avatarWrapperOpacity = await page
    .getByRole("button", { name: "Upload avatar", exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element.parentElement!).opacity));
  expect(avatarWrapperOpacity).toBeGreaterThan(0.9);
  await expectNoStuckPersistentOpacity(page);

  expect(failedApiResponses).toEqual([]);
});
