import { test, expect } from "@playwright/test";

test("backdrop closes clean dialogs and search, but cancels the discard prompt without losing an edit", async ({
  page,
}) => {
  await page.goto("/acoes?store=juntos-com");
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Nova ação", exact: true });
  await expect(form).toBeVisible();
  const box = (await form.boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + 2);
  await expect(form).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(form).not.toBeVisible();
  await page.getByRole("button", { name: "Nova ação", exact: true }).click();
  const title = form.getByLabel("Título *", { exact: true });
  await title.fill("Não perder esta edição");
  const field = (await title.boundingBox())!;
  await page.mouse.move(field.x + 20, field.y + 12);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  const decision = page.getByRole("dialog", { name: "Descartar alterações?" });
  await expect(decision).not.toBeVisible();
  await expect(form).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(decision).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(decision).not.toBeVisible();
  await expect(title).toHaveValue("Não perder esta edição");
  await page.mouse.click(2, 2);
  await decision.getByRole("button", { name: "Descartar e continuar" }).click();
  await expect(form).not.toBeVisible();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Busca rápida de anúncios" });
  await expect(search).toBeVisible();
  await search.getByRole("combobox").fill("Texto da busca");
  await page.mouse.click(2, 2);
  await expect(search).not.toBeVisible();
  await expect(decision).not.toBeVisible();
});

test("store filters update without notifications or moving the page heading", async ({
  page,
}) => {
  await page.goto(
    "/acoes?store=juntos-com&brand=Marca%20antiga&category=Categoria%20antiga",
  );
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  const heading = (await page.locator(".page-heading").boundingBox())!;
  await page.getByLabel("Loja global").selectOption("juntos-data");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(/store=juntos-data/);
  expect(new URL(page.url()).searchParams.has("brand")).toBe(false);
  expect(new URL(page.url()).searchParams.has("category")).toBe(false);
  await expect(page.locator(".toast")).toHaveCount(0);
  expect((await page.locator(".page-heading").boundingBox())!.y).toBe(
    heading.y,
  );
});

test("sidebar collapse persists, preserves navigation, and the mobile drawer scrolls at short heights", async ({
  page,
}) => {
  await page.goto("/?store=juntos-com");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator(".brand img")).toHaveAttribute(
    "src",
    "/icon.svg",
  );
  await page
    .getByRole("button", { name: "Recolher menu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Expandir menu", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  expect((await sidebar.boundingBox())!.width).toBe(76);
  await expect(sidebar.locator(".nav-item > span").first()).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expandir menu", exact: true }),
  ).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBe(76);
  await sidebar.getByRole("button", { name: "Ações", exact: true }).click();
  await expect(page).toHaveURL(/\/acoes/);
  expect((await sidebar.boundingBox())!.width).toBe(76);
  for (const width of [320, 390, 768, 850]) {
    await page.setViewportSize({ width, height: 480 });
    const trigger = page.getByRole("button", {
      name: "Abrir navegação",
      exact: true,
    });
    await trigger.click();
    await expect(sidebar).toHaveClass(/is-open/);
    expect((await sidebar.boundingBox())!.width).toBeGreaterThan(76);
    await expect(page.locator(".main-shell")).toHaveAttribute("inert", "");
    await expect(
      sidebar.getByRole("button", { name: "Recolher menu", exact: true }),
    ).toHaveCount(0);
    const nav = sidebar.getByRole("navigation");
    expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    await sidebar
      .getByRole("button", { name: "Configurações", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      sidebar.getByRole("button", { name: "Configurações", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: `test-results/sidebar-mobile-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveAttribute("inert", "");
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  for (const width of [851, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 480 });
    await expect(sidebar).not.toHaveAttribute("inert", "");
    expect((await sidebar.boundingBox())!.width).toBe(76);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/sidebar-collapsed.png" });
  await page
    .getByRole("button", { name: "Expandir menu", exact: true })
    .click();
  expect((await sidebar.boundingBox())!.width).toBe(232);
  await expect(sidebar.locator(".nav-item > span").first()).toBeVisible();
});
