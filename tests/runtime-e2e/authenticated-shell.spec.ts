import { expect, test, type Page } from "@playwright/test";

async function expectNoStuckPersistentOpacity(page: Page) {
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

async function expectRuntimeLayoutHealth(page: Page) {
  const health = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    const nav = document.querySelector('nav[aria-label="Primary navigation"]') as HTMLElement | null;
    const navRect = nav?.getBoundingClientRect();
    const mainStyle = main ? getComputedStyle(main) : null;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      mainTextLength: (main?.innerText || "").trim().length,
      navHeight: navRect?.height ?? 0,
      mainPaddingBottom: mainStyle ? Number.parseFloat(mainStyle.paddingBottom || "0") : 0,
    };
  });

  expect(health.scrollWidth).toBeLessThanOrEqual(health.viewportWidth + 2);
  expect(health.mainTextLength).toBeGreaterThan(10);
  expect(health.mainPaddingBottom).toBeGreaterThanOrEqual(health.navHeight + 16);
}

async function expectPersistentGlyphs(page: Page) {
  for (const label of ["Open menu", "Search", "Theme switcher", "Notifications"]) {
    const button = page.getByRole("button", { name: new RegExp(`^${label}`) }).first();
    await expect(button).toBeVisible();
    const svg = button.locator("svg").first();
    await expect(svg).toBeVisible();
    const painted = await svg.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: rect.width,
        height: rect.height,
        opacity: Number.parseFloat(style.opacity || "1"),
      };
    });
    expect(painted.width).toBeGreaterThan(8);
    expect(painted.height).toBeGreaterThan(8);
    expect(painted.opacity).toBeGreaterThan(0.9);
  }
}

test("real local runtime loads a complete and usable golden-master administrator shell", async ({ page }) => {
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
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel("Loading dashboard data")).toHaveCount(0, { timeout: 5_000 });

  await expect(page.getByText("Signed in administrator", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View profile", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open profile", exact: true })).toBeVisible();

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

  await expectPersistentGlyphs(page);
  await expectNoStuckPersistentOpacity(page);
  await expectRuntimeLayoutHealth(page);

  // The top-bar notification panel existed in the golden frontend but its Bell
  // handler immediately navigated away, making the panel impossible to open.
  const notificationsButton = page.getByRole("button", { name: /^Notifications/ }).first();
  await notificationsButton.click();
  await expect(notificationsButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Recent notifications" })).toBeVisible();
  await expect(page.getByText("You're all caught up", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Recent notifications" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile(?:\?|$)/, { timeout: 5_000 });
  await expect(page.getByRole("heading", { name: "My Profile", exact: true })).toBeVisible();
  await expect(page.getByText("BoardOps Admin", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("admin@boardops.local", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload avatar", exact: true })).toBeVisible();

  const heroIdentityOpacity = await page
    .getByRole("heading", { name: "BoardOps Admin", exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element.parentElement!).opacity));
  expect(heroIdentityOpacity).toBeGreaterThan(0.9);

  const avatarWrapperOpacity = await page
    .getByRole("button", { name: "Upload avatar", exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element.parentElement!).opacity));
  expect(avatarWrapperOpacity).toBeGreaterThan(0.9);

  // Visible Profile actions must not be decorative dead controls.
  await page.getByRole("button", { name: /Active Sessions/ }).click();
  await expect(page.getByRole("heading", { name: "Active Sessions", exact: true })).toBeVisible();
  await expect(page.getByText("Chrome on Linux", { exact: true })).toBeVisible();
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Active Sessions", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Change Password/ }).click();
  await expect(page.getByRole("heading", { name: "Change Password", exact: true })).toBeVisible();
  await expect(page.getByLabel("Current Password", { exact: true })).toBeVisible();
  await expect(page.getByLabel("New Password", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Change Password", exact: true })).toHaveCount(0);

  await expectNoStuckPersistentOpacity(page);
  await expectRuntimeLayoutHealth(page);
  expect(failedApiResponses).toEqual([]);

  // Sign Out must revoke the HttpOnly server session, not merely hide the UI.
  const logoutResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth/logout" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign Out", exact: true }).last().click();
  await expect((await logoutResponse).status()).toBe(200);
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toBeVisible();
});
