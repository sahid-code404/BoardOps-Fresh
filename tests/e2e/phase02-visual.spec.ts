import { expect, test, type Locator, type Page } from "@playwright/test";

// The viewport/theme audit deliberately walks every canonical route. Give the
// complete matrix enough time on CI without weakening any individual check.
test.setTimeout(150_000);

const ADMIN_ROUTES = [
  ["/dashboard", "Dashboard"],
  ["/meals", "Meal Configuration"],
  ["/user-meals", "Meals"],
  ["/kitchen", "Meal Counts"],
  ["/billing", "Billing & Closing"],
  ["/payments", "Payments & Wallet"],
  ["/expenses", "Expenses & Procurement"],
  ["/funds", "Funds Overview"],
  ["/monthly-closing", "Monthly Closing"],
  ["/formula-engine", "Formula Engine"],
  ["/users", "User Management"],
  ["/notifications", "Notifications & Announcements"],
  ["/settings", "Settings & Policies"],
  ["/system", "System (Audit & Tasks)"],
  ["/profile", "My Profile"],
] as const;

async function expectNoStuckPersistentOpacity(page: Page) {
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

async function expectPersistentControlGlyphs(page: Page) {
  const labels = ["Open menu", "Theme switcher", "Notifications"];
  if ((await page.viewportSize())?.width && page.viewportSize()!.width >= 640) labels.push("Search");

  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(`^${label}`) }).first();
    await expect(button).toBeVisible();
    const glyph = button.locator("svg").first();
    await expect(glyph).toBeVisible();
    const geometry = await glyph.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: rect.width,
        height: rect.height,
        opacity: Number.parseFloat(style.opacity || "1"),
        visibility: style.visibility,
      };
    });
    expect(geometry.width, `${label} glyph width`).toBeGreaterThan(8);
    expect(geometry.height, `${label} glyph height`).toBeGreaterThan(8);
    expect(geometry.opacity, `${label} glyph opacity`).toBeGreaterThan(0.9);
    expect(geometry.visibility, `${label} glyph visibility`).toBe("visible");
  }

  const profile = page.getByRole("button", { name: "Open profile", exact: true });
  await expect(profile).toBeVisible();
  const profileContent = await profile.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      opacity: Number.parseFloat(style.opacity || "1"),
      text: (element.textContent || "").trim(),
      hasImage: Boolean(element.querySelector("img")),
    };
  });
  expect(profileContent.width).toBeGreaterThanOrEqual(32);
  expect(profileContent.height).toBeGreaterThanOrEqual(32);
  expect(profileContent.opacity).toBeGreaterThan(0.9);
  expect(profileContent.hasImage || profileContent.text.length > 0).toBe(true);
}

async function expectLayoutHealth(page: Page) {
  const health = await page.evaluate(() => {
    const header = document.querySelector("header") as HTMLElement | null;
    const main = document.querySelector("main") as HTMLElement | null;
    const nav = document.querySelector('nav[aria-label="Primary navigation"]') as HTMLElement | null;
    const headerRect = header?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const navRect = nav?.getBoundingClientRect();
    const mainStyle = main ? getComputedStyle(main) : null;

    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headerWidth: headerRect?.width ?? 0,
      headerHeight: headerRect?.height ?? 0,
      mainWidth: mainRect?.width ?? 0,
      mainHeight: mainRect?.height ?? 0,
      navWidth: navRect?.width ?? 0,
      navHeight: navRect?.height ?? 0,
      mainPaddingBottom: mainStyle ? Number.parseFloat(mainStyle.paddingBottom || "0") : 0,
      mainTextLength: (main?.innerText || "").trim().length,
    };
  });

  expect(health.scrollWidth, "document must not overflow horizontally").toBeLessThanOrEqual(health.viewportWidth + 2);
  expect(health.headerWidth).toBeGreaterThan(100);
  expect(health.headerHeight).toBeGreaterThan(40);
  expect(health.mainWidth).toBeGreaterThan(100);
  expect(health.mainHeight).toBeGreaterThan(40);
  expect(health.navWidth).toBeGreaterThan(100);
  expect(health.navHeight).toBeGreaterThan(40);
  expect(health.mainTextLength, "route must contain meaningful mounted content").toBeGreaterThan(10);
  expect(health.mainPaddingBottom, "fixed bottom nav must not cover final page content").toBeGreaterThanOrEqual(
    health.navHeight + 16,
  );
}

async function expectShellHealth(page: Page) {
  await expect(page.getByLabel("Loading section")).toHaveCount(0, { timeout: 5_000 });
  await page.waitForTimeout(350);
  await expectNoStuckPersistentOpacity(page);
  await expectPersistentControlGlyphs(page);
  await expectLayoutHealth(page);

  await expect(page.locator(".mesh-bg")).toHaveCount(1);
  const mesh = await page.locator(".mesh-bg").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      backgroundImage: getComputedStyle(element).backgroundImage,
    };
  });
  expect(mesh.width).toBeGreaterThan(300);
  expect(mesh.height).toBeGreaterThan(300);
  expect(mesh.backgroundImage).not.toBe("none");
}

async function openRoute(page: Page, path: string, expectedTitle: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(path);
  await expect(page.getByRole("heading", { name: expectedTitle, exact: true })).toBeVisible({ timeout: 5_000 });
  expect(new URL(page.url()).pathname).toBe(path);
  expect(pageErrors).toEqual([]);
  await expectShellHealth(page);
}

function commandDialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]').filter({
    has: page.getByPlaceholder("Search navigation and actions…"),
  });
}

test("plain visual-mode root canonicalizes to the golden dashboard route", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
  await expect(page.getByText("Meals ON Today", { exact: true })).toBeVisible();
  await expect(page.getByText("Signed in administrator", { exact: true })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/dashboard");
  await expectShellHealth(page);
});

test("authentication panel remains visible on a cold unauthenticated render", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard?auth=1");
  await expect(page.getByText("Operations Suite", { exact: true })).toBeVisible();
  await expect(page.locator("form").getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toBeVisible();
});

for (const [path, title] of ADMIN_ROUTES) {
  test(`admin route ${path} has healthy persistent UI`, async ({ page }) => {
    await openRoute(page, path, title);
  });
}

const VIEWPORT_THEME_MATRIX = [
  { name: "phone-dark", width: 390, height: 844, theme: "dark" },
  { name: "tablet-dark", width: 768, height: 1024, theme: "dark" },
  { name: "desktop-dark", width: 1440, height: 900, theme: "dark" },
  { name: "desktop-light", width: 1440, height: 900, theme: "light" },
] as const;

for (const profile of VIEWPORT_THEME_MATRIX) {
  test(`full admin route matrix is layout-safe on ${profile.name}`, async ({ page }) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.addInitScript((theme) => window.localStorage.setItem("theme", theme), profile.theme);

    for (const [path, title] of ADMIN_ROUTES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 5_000 });
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${profile.theme}\\b`));
      await expectShellHealth(page);
    }
  });
}

test("dashboard preserves golden-master composition", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await expect(page.getByText("Admin Console", { exact: true })).toBeVisible();
  await expect(page.getByText("Total Users", { exact: true })).toBeVisible();
  await expect(page.getByText("Meals ON Today", { exact: true })).toBeVisible();
  await expect(page.getByText("Signed in administrator", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View profile", exact: true })).toHaveCount(0);
});

test("representative feature fixtures render essential content", async ({ page }) => {
  await openRoute(page, "/meals", "Meal Configuration");
  await expect(page.getByText("Breakfast", { exact: true }).first()).toBeVisible();

  await openRoute(page, "/user-meals", "Meals");
  await expect(page.getByText("Breakfast", { exact: true }).first()).toBeVisible();

  await openRoute(page, "/users", "User Management");
  await expect(page.getByText("Riya Sen", { exact: true })).toBeVisible();

  await openRoute(page, "/notifications", "Notifications & Announcements");
  await expect(page.getByText("Monthly statement is ready", { exact: true })).toBeVisible();
});

test("profile identity, avatar and theme controls are genuinely painted", async ({ page }) => {
  await openRoute(page, "/profile", "My Profile");
  await expect(page.getByText("Aarav Sharma", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload avatar", exact: true })).toBeVisible();

  const heroIdentityOpacity = await page
    .getByRole("heading", { name: "Aarav Sharma", exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element.parentElement!).opacity));
  expect(heroIdentityOpacity).toBeGreaterThan(0.9);

  const avatarWrapperOpacity = await page
    .getByRole("button", { name: "Upload avatar", exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element.parentElement!).opacity));
  expect(avatarWrapperOpacity).toBeGreaterThan(0.9);
});

test("legacy query navigation is canonicalized to a real route", async ({ page }) => {
  await page.goto("/?view=users");
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/users");
  expect(new URL(page.url()).searchParams.has("view")).toBe(false);
});

test("normal navigation preloads the route chunk instead of flashing a lazy skeleton", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Payments", exact: true }).click();
  await expect(page.getByLabel("Loading section")).toHaveCount(0);
  await expect(page).toHaveURL(/\/payments(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Payments & Wallet", exact: true })).toBeVisible();
});

test("More navigation opens a usable sidebar", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await page.getByRole("button", { name: "More navigation" }).click();
  const sidebar = page.getByRole("complementary");
  await expect(sidebar).toBeInViewport();
  await sidebar.getByRole("button", { name: "Meal Configuration", exact: true }).click();
  await expect(page).toHaveURL(/\/meals(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Meal Configuration", exact: true })).toBeVisible();
});

test("closed sidebar is inert and Escape reliably closes an open drawer", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  const sidebar = page.locator("aside");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect(await sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(true);

  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  expect(await sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await expect(page.getByRole("button", { name: "Close menu", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  expect(await sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
});

test("command palette opens from keyboard and routes without a lazy flash", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await page.keyboard.press("Control+K");
  const dialog = commandDialog(page);
  const input = dialog.getByPlaceholder("Search navigation and actions…");
  await expect(dialog).toBeVisible();
  await input.fill("formula");
  await dialog.getByText("Formula Engine", { exact: true }).click();
  await expect(page).toHaveURL(/\/formula-engine(?:\?|$)/);
  await expect(page.getByLabel("Loading section")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Formula Engine", exact: true })).toBeVisible();
});

test("resident command palette exposes resident Meals and hides admin-only routes", async ({ page }) => {
  await page.goto("/dashboard?role=user");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.keyboard.press("Control+K");
  const dialog = commandDialog(page);
  const input = dialog.getByPlaceholder("Search navigation and actions…");
  await expect(dialog).toBeVisible();
  await input.fill("meal");
  await expect(dialog.getByText("Meals", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Meal Configuration", { exact: true })).toHaveCount(0);
  await dialog.getByText("Meals", { exact: true }).click();
  await expect(page).toHaveURL(/\/user-meals(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Meals", exact: true })).toBeVisible();
});

test("theme switcher applies both dark and light modes", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  const switcher = page.getByRole("button", { name: "Theme switcher", exact: true });

  await switcher.click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await switcher.click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
});

test("browser back restores the previous BoardOps route", async ({ page }) => {
  await openRoute(page, "/dashboard", "Dashboard");
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/users(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "User Management", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});
