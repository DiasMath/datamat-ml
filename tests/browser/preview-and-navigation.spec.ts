import { test, expect, type APIRequestContext } from "@playwright/test";
import { db } from "../../src/server/db";
import { randomUUID } from "node:crypto";
const headers = { Origin: "http://localhost:3100" };
let storeId: string;
async function post(request: APIRequestContext, path: string, data: unknown) {
  const result = await request.post(path, { headers, data });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
}
test.beforeEach(async ({ request }) => {
  storeId = (
    await post(request, "/api/stores", { name: "Prévia " + randomUUID() })
  ).id;
});
test.afterEach(async () => {
  if (storeId)
    await db().collection("stores").doc(storeId).update({ active: 0 });
});
async function offer(request: APIRequestContext, extra = {}) {
  return post(request, "/api/offers", {
    storeId,
    name: "Produto de prévia",
    title: "Tomada Áudio portátil",
    sku: "0005",
    mlId: "MLB123456",
    price: "100",
    status: "draft",
    type: "unit",
    ...extra,
  });
}
test("every workspace screen shares consultation time in Brasilia and incomplete catalogue reads are identified", async ({
  page,
  request,
}) => {
  const a = await offer(request);
  let partial = false;
  await page.route("**/api/workspace?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.listingOverview.generatedAt = "2026-10-17T02:55:00.000Z";
    Object.assign(data.listingOverview.sync[0], {
      partial,
      running: false,
      lastCatalogSync: "2026-10-17T02:54:00.000Z",
      error: null,
      status: "connected",
    });
    await route.fulfill({ response, json: data });
  });
  for (const path of [
    "anuncios",
    `anuncios/${a.id}`,
    "precificacao",
    "concorrencia",
    "acoes",
    "historico",
    "estudos",
    "configuracoes",
  ]) {
    await page.goto(`/${path}?store=${storeId}`);
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".topbar .today-freshness")).toContainText(
      `Consultado às 23:55 · ${["anuncios", "precificacao", "concorrencia"].includes(path.split("/")[0]) ? "Catálogo sincronizado" : "Dados completos"}`,
    );
  }
  partial = true;
  await page.goto(`/anuncios?store=${storeId}`);
  await expect(page.locator(".topbar .today-freshness")).toContainText(
    "Consultado às 23:55 · Catálogo parcial",
  );
  await page
    .getByRole("button", { name: "Ver origem e atualização dos dados" })
    .click();
  await expect(
    page.locator(".today-coverage-popover:popover-open"),
  ).toContainText(
    "Atualização parcial; há páginas pendentes. A última sincronização completa continua disponível.",
  );
});
test("the same sidebar and navbar survive delayed filters and navigation between modules", async ({
  page,
  request,
}) => {
  const a = await offer(request);
  await offer(request, {
    title: "Segundo anúncio",
    sku: "0006",
    mlId: "MLB123457",
  });
  await post(request, "/api/tasks", {
    storeId,
    offerId: a.id,
    title: "Ação fixa da navegação",
    status: "todo",
    priority: "medium",
  });
  let release: () => void = () => {},
    pending = false,
    navigationReads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/navigation?")) navigationReads++;
  });
  await page.route("**/api/workspace?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "Segundo") {
      pending = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.continue();
  });
  try {
    await page.goto(`/anuncios?store=${storeId}`);
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".sidebar .nav-count")).toHaveText("1");
    await page.evaluate(() => {
      (window as any).__sidebar = document.querySelector(".sidebar");
      (window as any).__navbar = document.querySelector(".topbar");
    });
    await expect(page.locator(".user-card, .sidebar-bottom")).toHaveCount(0);
    const options = await page
      .getByLabel("Loja global")
      .locator("option")
      .count();
    await page.getByLabel("Buscar anúncios", { exact: true }).fill("Segundo");
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    await expect(page.locator(".user-card, .sidebar-bottom")).toHaveCount(0);
    await expect(page.locator(".sidebar .nav-count")).toHaveText("1");
    expect(await page.getByLabel("Loja global").locator("option").count()).toBe(
      options,
    );
    await expect(page.getByLabel("Loja global")).toBeEnabled();
    await expect(page.locator(".skeleton-layout")).toHaveCount(0);
    release();
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".offers-panel")).toContainText(
      "Segundo anúncio",
    );
    await page.getByRole("button", { name: "Hoje", exact: true }).click();
    await expect(page.locator(".today-dashboard")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).__sidebar === document.querySelector(".sidebar") &&
          (window as any).__navbar === document.querySelector(".topbar"),
      ),
    ).toBe(true);
    expect(navigationReads).toBe(1);
  } finally {
    release();
  }
});
test("Ctrl+K searches the selected store, opens a preview without changing filters and supports media and full detail", async ({
  page,
  request,
}) => {
  const a = await offer(request);
  await page.goto(`/?store=${storeId}&todayFocus=prepare&todayPage=1`);
  await expect(page.locator(".today-dashboard")).toBeVisible();
  const original = page.url();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Busca rápida de anúncios" });
  await expect(search).toBeVisible();
  await search.getByRole("combobox").fill("audio portatil");
  await expect(search.getByRole("option")).toHaveCount(1);
  await search.getByRole("combobox").fill("0005");
  await expect(search.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  const preview = page.locator("dialog.offer-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Tomada Áudio portátil");
  expect(page.url()).toBe(original);
  await preview.getByRole("tab", { name: "Resumo", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    preview.getByRole("tab", { name: "Fotos e vídeos" }),
  ).toBeFocused();
  await expect(
    preview.getByRole("heading", { name: "Fotos e vídeos publicados" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    preview.getByRole("tab", { name: "Simular preço" }),
  ).toBeFocused();
  await expect(
    preview.getByRole("region", { name: "Resumo da precificação ao digitar" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
  expect(page.url()).toBe(original);
  await page.keyboard.press("Meta+k");
  await search.getByRole("combobox").fill("MLB-123456");
  await expect(search.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await preview.getByRole("button", { name: "Abrir ficha completa" }).click();
  await expect(page).toHaveURL(new RegExp(`/anuncios/${a.id}`));
  await expect(
    page.getByRole("button", { name: "Voltar à Hoje" }),
  ).toBeVisible();
});
test("preview pricing calculates live, protects drafts and persists costs and a proposal without changing the listing price", async ({
  page,
  request,
}) => {
  const a = await offer(request);
  await post(request, `/api/parameters/${storeId}`, {
    minMargin: "10",
    desiredMargin: "20",
    taxRate: "0",
    taxBase: "price",
    managementRate: "0",
    managementBase: "price",
    reviewDays: 30,
  });
  await post(request, `/api/offers/${a.id}/costs`, {
    goods: "20",
    mlPercent: "10",
    mlFixed: "2",
    shipping: "5",
    packaging: "1",
    advertising: "2",
    other: "0",
    otherDescription: "",
  });
  await page.goto(`/anuncios?store=${storeId}`);
  await page
    .getByRole("button", {
      name: "Prévia de Tomada Áudio portátil",
      exact: true,
    })
    .click();
  const preview = page.locator("dialog.offer-preview");
  await preview.getByRole("tab", { name: "Simular preço" }).click();
  const price = preview.getByLabel("Preço proposto (R$)");
  await price.fill("1");
  await expect(preview.locator(".calculation-panel")).toContainText("29,10");
  await price.press("End");
  await price.press("5");
  await expect(price).toHaveValue("15");
  await expect(preview.locator(".calculation-panel")).toContainText("16,50");
  expect((await db().collection("offers").doc(a.id).get()).data()!.price).toBe(
    "100",
  );
  await page.mouse.click(2, 2);
  const confirm = page.getByRole("dialog", { name: "Descartar alterações?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Continuar editando" }).click();
  await expect(price).toHaveValue("15");
  await preview
    .getByRole("spinbutton", {
      name: "Mercadoria · oferta inteira",
      exact: true,
    })
    .fill("30");
  await preview
    .getByRole("button", { name: "Salvar custos", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await db().collection("costs").doc(a.id).get()).data()!.data_json,
        ).goods,
    )
    .toBe("30");
  await expect(price).toHaveValue("100");
  await price.fill("90");
  await preview.getByLabel("Conferi as tarifas").check();
  await preview.getByLabel("Motivo da proposta *").fill("Revisão na prévia");
  await preview
    .getByRole("button", { name: "Salvar para revisão", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await db().collection("proposals").where("offer_id", "==", a.id).get())
          .size,
    )
    .toBe(1);
  expect((await db().collection("offers").doc(a.id).get()).data()!.price).toBe(
    "100",
  );
  await preview.getByRole("button", { name: "Fechar prévia" }).click();
  await expect(preview).not.toBeVisible();
});
test("search recovers from errors and preview remains usable at mobile and desktop widths", async ({
  page,
  request,
}) => {
  await offer(request);
  let calls = 0;
  await page.route("**/api/search?*", async (route) => {
    calls++;
    if (calls === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Busca temporariamente indisponível" },
      });
    await route.continue();
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/?store=${storeId}`);
  await page
    .getByRole("button", { name: "Abrir busca rápida (Ctrl+K)" })
    .click();
  const search = page.getByRole("dialog", { name: "Busca rápida de anúncios" });
  await expect(search).toContainText("Busca temporariamente indisponível");
  await search.getByRole("button", { name: "Tentar novamente" }).click();
  await search.getByRole("combobox").fill("0005");
  await expect(search.getByRole("option")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/command-search-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Enter");
  const preview = page.locator("dialog.offer-preview");
  await expect(preview).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = (await preview.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await preview.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
  }
  await page.screenshot({
    path: "test-results/offer-preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 850 });
  await preview.getByRole("tab", { name: "Simular preço" }).click();
  await expect(preview.getByLabel("Preço proposto (R$)")).toBeVisible();
  await expect(
    preview.getByRole("region", { name: "Resumo da precificação ao digitar" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/offer-preview-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
});
