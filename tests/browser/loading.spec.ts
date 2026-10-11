import { test, expect } from "@playwright/test";

test("toast countdown works with reduced motion and pauses both width and expiry", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/acoes?store=juntos-com");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page.getByLabel("Loja global").selectOption("juntos-data");
  const toast = page.locator(".toast").filter({ hasText: "Loja atualizada" });
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  const bar = toast.locator(".toast-progress");
  const initial = (await bar.boundingBox())!.width;
  await expect
    .poll(async () => (await bar.boundingBox())?.width || 0)
    .toBeLessThan(initial * 0.9);
  await toast.hover();
  const paused = (await bar.boundingBox())!.width;
  await page.waitForTimeout(700);
  expect((await bar.boundingBox())!.width).toBeCloseTo(paused, 0);
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => (await bar.boundingBox())?.width || 0)
    .toBeLessThan(paused * 0.9);
  await expect(toast).not.toBeVisible({ timeout: 9000 });
});

test("initial page loads use structured skeletons without overflow at mobile widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  let release: () => void = () => {};
  await page.route("**/api/workspace**", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.continue();
  });
  for (const path of [
    "/",
    "/anuncios",
    "/acoes",
    "/configuracoes",
    "/analises",
  ]) {
    await page.goto(path);
    await expect(page.locator(".skeleton-layout").first()).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    release();
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".skeleton-layout")).toHaveCount(0);
  }
});
