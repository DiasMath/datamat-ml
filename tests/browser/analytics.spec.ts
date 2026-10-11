import { test, expect } from "@playwright/test";
import { db, key } from "../../src/server/db";
import {
  aggregateAnalytics,
  analysisRange,
  businessDay,
  shiftDay,
  type StoreAnalysis,
} from "../../src/domain/analytics";

test.beforeEach(async ({ request }) => {
  expect((await request.get("/api/workspace")).ok()).toBe(true);
  await db()
    .collection("connections")
    .doc(key("juntos-com", "mercadolivre"))
    .set({
      store_id: "juntos-com",
      provider: "mercadolivre",
      status: "connected",
      external_account: "111",
      auth_version: 900,
    });
});
test.afterEach(async () => {
  await db()
    .collection("connections")
    .doc(key("juntos-com", "mercadolivre"))
    .set({
      store_id: "juntos-com",
      provider: "mercadolivre",
      status: "unauthorized",
      external_account: null,
      auth_version: 901,
    });
});
function reportFor(url: URL) {
  const range = analysisRange(
    url.searchParams.get("from") || businessDay(),
    url.searchParams.get("to") || businessDay(),
  );
  const source: StoreAnalysis = {
    storeId: "juntos-com",
    storeName: "juntos.com",
    connected: true,
    sellerId: "111",
    authVersion: 900,
    observedAt: new Date().toISOString(),
    complete: true,
    totalReported: 25,
    error: null,
    warnings: [],
    unanswered: 2,
    reputation: {
      level: "5_green",
      powerSeller: null,
      completed: 100,
      cancelled: 1,
      period: "historic",
    },
    shipping: { sampled: 0, total: 0, statuses: {} },
    visits: Array.from({ length: range.days }, (_, i) => ({
      day: shiftDay(range.from, i),
      visits: 100,
    })),
    orders: Array.from({ length: 25 }, (_, i) => ({
      id: String(1000 + i),
      storeId: "juntos-com",
      status: "paid",
      created: new Date(
        Math.min(range.start + 3600000, range.end - 1000),
      ).toISOString(),
      shipmentId: null,
      lines: [
        {
          itemId: "MLB" + (1000 + i),
          title: "Produto de análise " + String(i + 1).padStart(2, "0"),
          quantity: 1,
          price: "100.00",
          fee: "10.00",
          contribution: i === 0 ? null : "20.00",
          offerId: null,
        },
      ],
    })),
  };
  return aggregateAnalytics([source], range);
}
test("analytics navigation, charts, pagination, live advertising calculations and export work", async ({
  page,
}) => {
  await page.route("**/api/analytics**", (route) =>
    route.fulfill({ json: reportFor(new URL(route.request().url())) }),
  );
  await page.goto("/analises?store=juntos-com");
  await expect(
    page.getByRole("heading", { name: "Análises", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".analytics-metric")
      .filter({ has: page.getByText("Receita bruta", { exact: true }) })
      .locator("strong"),
  ).toHaveText("R$ 2.500,00");
  await expect(
    page.getByRole("img", { name: "Evolução das vendas" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Indicador do gráfico" })
    .selectOption("orders");
  await page.getByRole("tab", { name: "Produtos", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Produtos nas análises" })
      .locator("tbody tr"),
  ).toHaveCount(20);
  await page
    .getByRole("button", { name: "Próxima página: Produtos nas análises" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Produtos nas análises" })
      .locator("tbody tr"),
  ).toHaveCount(5);
  await page.getByRole("tab", { name: "Tráfego", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Visitas por dia" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Financeiro", exact: true }).click();
  await expect(
    page.getByText("Margem na parcela coberta", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Publicidade", exact: true }).click();
  await page
    .getByText("Simular indicadores sem salvar", { exact: true })
    .click();
  await page.getByLabel("Investimento em anúncios (R$)").fill("100");
  await page.getByLabel("Receita atribuída (R$)").fill("500");
  await page.getByLabel("Impressões", { exact: true }).fill("1000");
  await page.getByLabel("Cliques", { exact: true }).fill("50");
  await expect(
    page
      .locator(".analytics-metric")
      .filter({ hasText: /^ROAS/ })
      .locator("strong"),
  ).toHaveText("5.00×");
  await expect(
    page
      .locator(".analytics-metric")
      .filter({ hasText: /^CTR/ })
      .locator("strong"),
  ).toHaveText("5%");
  await expect(
    page
      .locator(".analytics-metric")
      .filter({ hasText: /^TACOS/ })
      .locator("strong"),
  ).toHaveText("4%");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar dados" }).click();
  expect((await download).suggestedFilename()).toContain("datamat-analises-");
  await expect(page.locator('link[rel="icon"][href*="icon.svg"]')).toHaveCount(
    1,
  );
});
test("live refresh starts automatically, pauses and resumes without requiring manual save", async ({
  page,
}) => {
  let refreshes = 0;
  await page.route("**/api/analytics**", (route) => {
    if (route.request().method() === "POST") refreshes++;
    return route.fulfill({ json: reportFor(new URL(route.request().url())) });
  });
  await page.goto("/analises?store=juntos-com");
  await page
    .getByRole("button", { name: "Análise ao vivo", exact: true })
    .click();
  await expect(page).toHaveURL(/analises\/ao-vivo/);
  await expect(
    page.getByRole("heading", { name: "Análise ao vivo", exact: true }),
  ).toBeVisible();
  await expect.poll(() => refreshes).toBeGreaterThan(0);
  await expect(
    page.getByRole("img", { name: "Vendas por hora" }),
  ).toBeVisible();
  const hour = await page.evaluate(() =>
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    ),
  );
  await expect(
    page.getByRole("img", { name: "Vendas por hora" }).locator("circle"),
  ).toHaveCount(hour + 1);
  await expect(page.locator(".analytics-freshness")).toHaveText(
    /Última consulta:.*\d{2}:\d{2}:\d{2}/,
  );
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(
    page.getByText("Atualização pausada", { exact: true }),
  ).toBeVisible();
  const before = refreshes;
  await page.clock.install();
  await page.clock.fastForward(65000);
  expect(refreshes).toBe(before);
  await page.getByRole("button", { name: "Retomar", exact: true }).click();
  await expect.poll(() => refreshes).toBeGreaterThan(before);
  const resumed = refreshes;
  await expect(
    page.getByRole("button", { name: "Atualizar ML", exact: true }),
  ).toBeEnabled();
  await page.clock.fastForward(65000);
  await expect.poll(() => refreshes).toBeGreaterThan(resumed);
  await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.evaluate(() => document.exitFullscreen());
});
test("analytics endpoints enforce store scope, origin and valid periods", async ({
  request,
}) => {
  const report = await request.get("/api/analytics?store=juntos-com");
  expect(report.status()).toBe(200);
  expect((await report.json()).available).toBe(false);
  expect((await request.get("/api/analytics?store=foreign")).status()).toBe(
    404,
  );
  expect((await request.get("/api/analytics?from=invalid")).status()).toBe(422);
  expect(
    (
      await request.post("/api/analytics/refresh?store=juntos-com", {
        headers: { Origin: "https://untrusted.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
});
test("analytics and live views stay within the viewport on mobile, tablet and desktop", async ({
  page,
}) => {
  await page.route("**/api/analytics**", (route) =>
    route.fulfill({ json: reportFor(new URL(route.request().url())) }),
  );
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/analises?store=juntos-com");
    await expect(
      page.getByRole("heading", { name: "Evolução das vendas" }),
    ).toBeVisible();
    for (const name of ["Produtos", "Financeiro", "Operação", "Publicidade"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
        `${width}px: ${name}`,
      ).toBeLessThanOrEqual(1);
    }
    await page
      .getByRole("button", { name: "Análise ao vivo", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ritmo de vendas de hoje" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
      `${width}px: ao vivo`,
    ).toBeLessThanOrEqual(1);
  }
  await page.screenshot({
    path: "/tmp/datamat-analytics-live-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: "/tmp/datamat-analytics-live-mobile.png",
    fullPage: true,
  });
});
test("failed refreshes preserve sales and partial reports suppress comparisons", async ({
  page,
}) => {
  await page.route("**/api/analytics**", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ status: 502, json: { error: "ML indisponível" } });
    const report = reportFor(new URL(route.request().url()));
    report.complete = false;
    report.changes = null;
    return route.fulfill({ json: report });
  });
  await page.goto("/analises?store=juntos-com");
  await expect(page.getByText(/Análise parcial:/)).toBeVisible();
  await page.getByRole("button", { name: "Atualizar ML", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "ML indisponível" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".analytics-metric")
      .filter({ has: page.getByText("Receita bruta", { exact: true }) })
      .locator("strong"),
  ).toHaveText("R$ 2.500,00");
});
