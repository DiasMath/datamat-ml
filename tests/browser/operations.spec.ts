import { test, expect, chromium } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { db, key } from "../../src/server/db";
import {
  aggregateAnalytics,
  analysisRange,
  businessDay,
} from "../../src/domain/analytics";
import { capturePage } from "../../extension/src/capture";

test("competitor CRUD, alerts, observed history and review task persist without shifting the page", async ({
  page,
  request,
}) => {
  await page.goto("/concorrencia?store=juntos-com");
  await page
    .getByRole("button", { name: "Adicionar referência", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Código ML *").fill("MLB777001");
  await dialog
    .getByLabel("Título *", { exact: true })
    .fill("Referência do navegador");
  await dialog
    .getByLabel("URL do anúncio *")
    .fill("https://produto.mercadolivre.com.br/MLB-777001-produto");
  await dialog.getByLabel("Preço observado (R$) *").fill("100");
  await dialog.getByRole("button", { name: "Salvar referência" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Referência do navegador", exact: true })
    .click();
  await dialog.getByLabel("Preço observado (R$) *").fill("90");
  await dialog.getByRole("button", { name: "Salvar referência" }).click();
  await expect(page.getByText("-10%", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Referência do navegador", exact: true })
    .click();
  await dialog.getByText("Histórico observado", { exact: false }).click();
  await expect(
    dialog.getByRole("cell", { name: "R$ 100,00", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Criar tarefa de revisão" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Ações", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Revisar concorrente: Referência do navegador",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/concorrencia?store=juntos-com");
  await page
    .getByRole("button", { name: "Referência do navegador", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Excluir referência", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Excluir referência?" })
    .getByRole("button", { name: "Excluir referência", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Referência do navegador", exact: true }),
  ).toHaveCount(0);
  expect((await request.get("/api/competitors?store=foreign")).status()).toBe(
    404,
  );
});

test("Hoje retains sales during refresh, preserves scope on failure and pauses automatic polling", async ({
  page,
  request,
}) => {
  const initial = await (
    await request.get("/api/today?store=juntos-com")
  ).json();
  const fixture = {
    ...initial,
    connections: [
      { store_id: "juntos-com", provider: "mercadolivre", status: "connected" },
    ],
    sales: {
      ...initial.sales,
      available: true,
      complete: true,
      revenue: "100.00",
      orders: 1,
      units: 2,
      ticket: "100.00",
      contribution: "20.00",
      contributionCoverage: "100.00",
      change: null,
      observedAt: new Date().toISOString(),
      stores: [
        { id: "juntos-com", name: "juntos.com", connected: true, error: null },
      ],
      days: [
        { day: "2026-10-01", revenue: "20" },
        { day: "2026-10-02", revenue: "70" },
        { day: "2026-10-03", revenue: "100" },
      ],
    },
  };
  let requests = 0;
  let release: () => void = () => {};
  await page.route("**/api/today?*", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/today/refresh?*", async (route) => {
    requests++;
    if (requests <= 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    if (requests === 3)
      return route.fulfill({
        status: 502,
        json: { error: "Consulta temporariamente indisponível" },
      });
    await route.fulfill({ json: fixture });
  });
  try {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/?store=juntos-com&todayFocus=prepare");
    const panel = page.locator(".today-dashboard");
    await expect.poll(() => requests).toBe(1);
    await expect(
      panel.locator(".today-metric").filter({ hasText: "Receita do mês" }),
    ).toContainText("R$ 100,00");
    await expect(
      page.getByRole("progressbar", { name: "Operação em andamento" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Loja global")).toBeEnabled();
    await expect(
      panel
        .getByRole("button", { name: "Atualizar ML", exact: true })
        .locator("svg.spin"),
    ).toBeVisible();
    await expect(panel.getByRole("tab", { name: /Preparar/ })).toBeEnabled();
    release();
    await expect(
      panel.getByRole("button", { name: "Atualizar ML", exact: true }),
    ).toBeEnabled();
    await expect(panel.locator(".today-financial")).toContainText("R$ 20,00");
    await page.screenshot({
      path: "test-results/today-live-compact-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".today-chart-panel > summary").click();
    await expect(page.locator(".today-chart-panel")).toHaveAttribute(
      "open",
      "",
    );
    await page.screenshot({
      path: "test-results/today-live-compact-desktop.png",
      fullPage: true,
    });
    await page.locator(".today-chart-panel > summary").click();
    await page.setViewportSize({ width: 320, height: 800 });
    await panel
      .getByRole("button", { name: "Atualizar ML", exact: true })
      .click();
    await expect.poll(() => requests).toBe(2);
    await expect(panel).toContainText("R$ 100,00");
    await expect(
      page
        .getByRole("progressbar", { name: "Operação em andamento" })
        .locator("svg.spin"),
    ).toBeVisible();
    await expect(page.locator(".request-loading-bar")).toHaveCount(0);
    release();
    await expect(
      panel.getByRole("button", { name: "Atualizar ML", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "Atualizar ML", exact: true })
      .click();
    await expect.poll(() => requests).toBe(3);
    await expect(
      page.locator(".toast").filter({ hasText: "Consulta temporariamente" }),
    ).toBeVisible();
    await expect(panel).toContainText("R$ 100,00");
    await expect(page).toHaveURL(/store=juntos-com&todayFocus=prepare/);
    await panel.getByLabel("Pausar atualização automática").click();
    await expect(
      panel.getByLabel("Retomar atualização automática"),
    ).toBeVisible();
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await page.clock.install();
    await page.clock.fastForward(61000);
    expect(requests).toBe(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    release();
  }
});

test("assisted capture reads supported public offer DOM and does not confuse catalog IDs or installment prices", async ({
  page,
}) => {
  await page.route("https://produto.mercadolivre.com.br/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<h1 class="ui-pdp-title">Produto próprio de teste</h1><div class="ui-pdp-price__second-line"><span class="andes-money-amount"><span class="andes-money-amount__currency-symbol">R$</span><span class="andes-money-amount__fraction">1.234</span><span class="andes-money-amount__cents">56</span></span></div><div class="installments">12 x R$ 102,88</div>',
    }),
  );
  await page.goto("https://produto.mercadolivre.com.br/MLB-12345-produto");
  const captured = await page.evaluate(capturePage);
  expect(captured).toHaveLength(1);
  expect(captured[0].price).toBe("1234.56");
  expect(captured[0].itemId).toBe("MLB12345");
  await page.goto("https://produto.mercadolivre.com.br/p/MLB999");
  expect(await page.evaluate(capturePage)).toEqual([]);
});

test("real unpacked extension pairs with isolated server, calculates live and saves a reference", async ({
  request,
}) => {
  const profile = await mkdtemp(resolve(tmpdir(), "datamat-extension-test-"));
  const extensionPath = resolve("extension/dist");
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    // Regular Chrome removed command-line extension loading; use Chrome for Testing.
    channel: "chromium",
    executablePath: chromium.executablePath(),
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--no-sandbox",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 10000 }));
    const extensionId = new URL(worker.url()).host;
    const headers = { Origin: "http://localhost:3100" };
    const offerResponse = await request.post("/api/offers", {
      headers,
      data: {
        storeId: "juntos-com",
        name: "Extensão produto",
        title: "Extensão produto",
        type: "unit",
        status: "active",
        price: "100",
        sku: "EXT-TEST",
      },
    });
    expect(offerResponse.ok()).toBe(true);
    const offer = await offerResponse.json();
    expect(
      (
        await request.post(`/api/offers/${offer.id}/costs`, {
          headers,
          data: {
            goods: "40",
            mlPercent: "10",
            mlFixed: "0",
            shipping: "0",
            packaging: "0",
            advertising: "0",
            other: "0",
            taxRate: "0",
            taxBase: "price",
            managementRate: "0",
            managementBase: "price",
          },
        })
      ).ok(),
    ).toBe(true);
    const pair = await request.post("/api/extension-devices", {
      headers,
      data: {
        storeId: "juntos-com",
        name: "Chrome real de teste",
        extensionId,
      },
    });
    expect(pair.ok()).toBe(true);
    const pairing = await pair.json();
    await context.route(
      "https://datamat-ml.vercel.app/api/extension/**",
      async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: "http://localhost:3100" + url.pathname + url.search,
          headers: {
            ...route.request().headers(),
            origin: `chrome-extension://${extensionId}`,
          },
        });
        await route.fulfill({ response });
      },
    );
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/panel.html`);
    await page.getByLabel("Código de pareamento").fill(pairing.token);
    await page.getByRole("button", { name: "Conectar extensão" }).click();
    await expect(page.locator("#connected")).toBeVisible();
    await page.getByLabel("Sua oferta", { exact: true }).selectOption(offer.id);
    await expect(page.locator("#margin")).toHaveText("R$ 50,00");
    await page.getByLabel("Preço para simular (R$)").fill("90");
    await expect(page.locator("#margin")).toHaveText("R$ 41,00");
    await page.evaluate(() => {
      (globalThis as any).chrome.runtime.sendMessage = async () => ({
        rows: [
          {
            itemId: "MLB777002",
            title: "Referência da extensão",
            url: "https://produto.mercadolivre.com.br/MLB-777002-produto",
            price: "88.00",
          },
        ],
      });
    });
    await page.getByRole("button", { name: "Capturar página atual" }).click();
    await page.getByRole("button", { name: "Salvar referência" }).click();
    await expect(page.getByRole("status")).toContainText("histórico salvos");
    const rows = await (
      await request.get("/api/competitors?store=juntos-com")
    ).json();
    expect(rows.find((r: any) => r.item_id === "MLB777002").offer_id).toBe(
      offer.id,
    );
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/extension-panel.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Desconectar", exact: true })
      .click();
    await expect(page.locator("#pairing")).toBeVisible();
  } finally {
    await context.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
