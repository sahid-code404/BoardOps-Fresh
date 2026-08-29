import { expect, test, type Page } from "@playwright/test";

const HUBS = [
  {
    path: "/notifications",
    title: "Notifications & Announcements",
    tabs: ["Personal", "Announcements"],
  },
  {
    path: "/settings",
    title: "Settings & Policies",
    tabs: ["Institution", "Policies", "Appearance", "Calendar"],
  },
  {
    path: "/formula-engine",
    title: "Formula Engine",
    tabs: ["Variables", "Formulas"],
  },
  {
    path: "/system",
    title: "System (Audit & Tasks)",
    tabs: ["Audit Log", "Background Tasks", "Data Export"],
  },
] as const;

async function expectHealthyMountedTab(page: Page) {
  await expect(page.getByLabel("Loading section")).toHaveCount(0, { timeout: 5_000 });
  await page.waitForTimeout(200);

  const health = await page.locator("main").evaluate((main) => {
    const root = document.documentElement;
    const rect = main.getBoundingClientRect();
    const visibleText = (main.textContent || "").replace(/\s+/g, " ").trim();
    const stuckOpacity = Array.from(main.querySelectorAll<HTMLElement>("div")).filter((element) => {
      if (element.closest('[aria-hidden="true"]')) return false;
      const elementRect = element.getBoundingClientRect();
      if (elementRect.width < 2 || elementRect.height < 2) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity !== "0") return false;
      return Boolean(
        (element.textContent || "").trim() ||
          element.querySelector("button, a, input, textarea, select, svg, img, h1, h2, h3, p"),
      );
    });

    return {
      width: rect.width,
      height: rect.height,
      textLength: visibleText.length,
      scrollWidth: root.scrollWidth,
      viewportWidth: window.innerWidth,
      stuckOpacityCount: stuckOpacity.length,
    };
  });

  expect(health.width).toBeGreaterThan(100);
  expect(health.height).toBeGreaterThan(40);
  expect(health.textLength).toBeGreaterThan(10);
  expect(health.scrollWidth).toBeLessThanOrEqual(health.viewportWidth + 2);
  expect(health.stuckOpacityCount).toBe(0);
}

for (const hub of HUBS) {
  test(`${hub.path} keeps every internal golden-master tab usable`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(hub.path);
    await expect(page.getByRole("heading", { name: hub.title, exact: true })).toBeVisible({ timeout: 5_000 });
    await expectHealthyMountedTab(page);

    const main = page.locator("main");
    for (const label of hub.tabs) {
      const tab = main.getByRole("button", { name: label, exact: true }).first();
      await expect(tab, `${hub.path}: ${label} tab must be visible`).toBeVisible();
      await tab.click();
      await expectHealthyMountedTab(page);
      expect(pageErrors, `${hub.path}: ${label} must not throw`).toEqual([]);
    }
  });
}
