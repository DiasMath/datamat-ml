import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { db, key } from "../../src/server/db";
import {
  analysisRange,
  businessDay,
  shiftDay,
  aggregateAnalytics,
  type StoreAnalysis,
} from "../../src/domain/analytics";
import writeXlsxFile from "write-excel-file/node";
import { emptyCosts } from "../../src/domain/finance";
const headers = { Origin: "http://localhost:3100" },
  connectionId = key("juntos-com", "mercadolivre");
let original: Record<string, any>, originalParameters: Record<string, any>;
test.beforeEach(async ({ request }) => {
  expect((await request.get("/api/workspace")).ok()).toBe(true);
  original = (
    await db().collection("connections").doc(connectionId).get()
  ).data()!;
  originalParameters = (
    await db().collection("parameters").doc("juntos-com").get()
  ).data()!;
});
test.afterEach(async () => {
  await db().collection("connections").doc(connectionId).set(original);
  await db().collection("parameters").doc("juntos-com").set(originalParameters);
});
async function ownOffer(request: APIRequestContext) {
  const mlId = "MLB" + Date.now() + Math.floor(Math.random() * 10),
    title = "Inteligência Produto " + mlId;
  const response = await request.post("/api/offers", {
    headers,
    data: {
      storeId: "juntos-com",
      name: title,
      title,
      mlId,
      type: "unit",
      status: "active",
      price: "100",
      brand: "Marca",
      sku: "SKU-" + mlId,
      description: "Descrição real do produto",
    },
  });
  expect(response.ok()).toBe(true);
  const offer = await response.json();
  const ml = {
    sellerId: "111",
    authVersion: 997,
    connectionId,
    currencyId: "BRL",
    listingTypeId: "gold_special",
    categoryId: "MLB100",
    catalogListing: true,
    photoCount: 1,
    availableQuantity: 5,
    health: 0.83,
    observedAt: new Date().toISOString(),
    pictures: [
      { id: "P1", url: "https://http2.mlstatic.com/datamat-test.jpg" },
    ],
    videoId: "video-legado",
    videoAvailable: true,
    attributes: [{ id: "BRAND", name: "Marca", value: "Marca" }],
    variationDetails: [],
    missingRequiredAttributes: [],
  };
  await db()
    .collection("offers")
    .doc(offer.id)
    .set({ ...offer, ml });
  await db().collection("connections").doc(connectionId).set({
    store_id: "juntos-com",
    provider: "mercadolivre",
    status: "connected",
    external_account: "111",
    auth_version: 997,
  });
  return { ...offer, ml };
}
async function mockAnalytics(page: Page, offer?: Record<string, any>) {
  await page.route("**/api/analytics*", async (route) => {
    const url = new URL(route.request().url()),
      range = analysisRange(
        url.searchParams.get("from") || businessDay(),
        url.searchParams.get("to") || businessDay(),
      );
    const source: StoreAnalysis = {
      storeId: "juntos-com",
      storeName: "juntos.com",
      connected: true,
      sellerId: "111",
      authVersion: 997,
      observedAt: new Date().toISOString(),
      complete: true,
      totalReported: 8,
      error: null,
      warnings: [],
      unanswered: 0,
      reputation: null,
      shipping: null,
      visits: null,
      orders: offer
        ? Array.from({ length: 8 }, (_, i) => ({
            id: String(i),
            storeId: "juntos-com",
            created: new Date(
              (i < 3 ? range.start : range.previousStart) + 3600000,
            ).toISOString(),
            status: "paid",
            shipmentId: null,
            lines: [
              {
                itemId: offer.ml_id,
                title: offer.title,
                quantity: 1,
                price: "100",
                fee: null,
                contribution: null,
                offerId: offer.id,
              },
            ],
          }))
        : [],
    };
    await route.fulfill({ json: aggregateAnalytics([source], range) });
  });
}
test("compact header and styled dropdown options preserve native selection, keyboard and mobile layout", async ({
  page,
}) => {
  await page.goto("/anuncios?store=juntos-com");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  expect((await page.locator(".topbar").boundingBox())!.height).toBe(48);
  expect(
    await page.evaluate(() => CSS.supports("appearance", "base-select")),
  ).toBe(true);
  const select = page.getByRole("combobox", { name: "Loja global" });
  await select.click();
  await expect(select.locator('option[value="juntos-data"]')).toBeVisible();
  await select.locator('option[value="juntos-data"]').click();
  await expect(select).toHaveValue("juntos-data");
  await expect(page).toHaveURL(/store=juntos-data/);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await select.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("juntos-com");
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  expect((await page.locator(".topbar").boundingBox())!.height).toBe(52);
  expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await select.click();
  await expect(select.locator('option[value="all"]')).toBeVisible();
  await page.screenshot({
    path: "test-results/dropdown-options-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("campaign reports calculate live, persist updates, deduplicate review tasks and delete locally", async ({
  page,
}) => {
  const name = "CAMPANHA-" + Date.now();
  await page.goto("/analises?store=juntos-com");
  await page.getByRole("tab", { name: "Publicidade", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Performance das campanhas" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Novo relatório", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("Nome da campanha").fill(name);
  await modal.getByLabel("Investimento (R$)", { exact: true }).fill("100");
  await modal.getByLabel("Receita atribuída (R$)", { exact: true }).fill("500");
  await modal.getByLabel("Margem antes de Ads (%)").fill("10");
  await expect(modal.locator(".detail-stats")).toContainText("5.00×");
  await expect(modal.locator(".detail-stats")).toContainText("-R$ 50,00");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/campaign-report-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await modal.getByRole("button", { name: "Salvar relatório" }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  let docs = (
    await db().collection("campaign_reports").where("name", "==", name).get()
  ).docs;
  expect(docs).toHaveLength(1);
  expect(docs[0].data().version).toBe(1);
  await page.reload();
  await page.getByRole("tab", { name: "Publicidade", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  modal = page.getByRole("dialog");
  await modal.getByLabel("Investimento (R$)", { exact: true }).fill("120");
  await modal.getByRole("button", { name: "Salvar relatório" }).click();
  await expect(modal).not.toBeVisible();
  expect((await docs[0].ref.get()).data()!.version).toBe(2);
  await page.getByRole("button", { name, exact: true }).click();
  await modal.getByRole("button", { name: "Criar tarefa de revisão" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Tarefa de revisão criada" }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Criar tarefa de revisão" }).click();
  expect(
    (
      await db()
        .collection("tasks")
        .where("title", "==", "Revisar campanha: " + name)
        .get()
    ).size,
  ).toBe(1);
  await modal.getByRole("button", { name: "Excluir relatório" }).click();
  await page
    .getByRole("dialog", { name: "Excluir relatório?" })
    .getByRole("button", { name: "Excluir relatório", exact: true })
    .click();
  await expect(modal).not.toBeVisible();
  expect((await docs[0].ref.get()).exists).toBe(false);
  expect(
    (
      await db()
        .collection("history")
        .where("field", "==", "campaign.deleted")
        .get()
    ).size,
  ).toBeGreaterThan(0);
});
test("campaign Excel import requires a preview and export can update the same report without duplicates", async ({
  page,
}) => {
  const name = "EXCEL-CAMP-" + Date.now(),
    from = shiftDay(businessDay(), -6),
    to = businessDay();
  const buffer = await writeXlsxFile([
    {
      sheet: "Campanhas",
      data: [
        ["campanha", "investimento", "receita atribuída", "margem antes ads"],
        [name, 123.45, 500, 30],
      ],
    },
  ]).toBuffer();
  await page.goto("/analises?store=juntos-com");
  await page.getByRole("tab", { name: "Publicidade", exact: true }).click();
  await page.getByLabel("Importar relatório de campanhas").setInputFiles({
    name: "campanhas.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  const modal = page.locator("dialog.modal:not(.confirmation-modal)");
  await expect(modal).toContainText(name);
  expect(
    (await db().collection("campaign_reports").where("name", "==", name).get())
      .size,
  ).toBe(0);
  await modal.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  const id = key("datamat", "juntos-com", name, from, to);
  expect(
    (await db().collection("campaign_reports").doc(id).get()).data()!.spend,
  ).toBe("123.45");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar campanhas" }).click();
  const download = await downloadPromise,
    stream = (await download.createReadStream())!;
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const csv = Buffer.concat(chunks).toString().replace("123.45", "125.45");
  await page.getByLabel("Importar relatório de campanhas").setInputFiles({
    name: "atualizar.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await modal.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(modal).not.toBeVisible();
  expect(
    (await db().collection("campaign_reports").doc(id).get()).data()!.spend,
  ).toBe("125.45");
  expect(
    (await db().collection("campaign_reports").where("name", "==", name).get())
      .size,
  ).toBe(1);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.screenshot({
    path: "test-results/campaigns-mobile.png",
    fullPage: true,
  });
});
test("listing diagnostics separates decline and margin and displays official media and catalogue competition", async ({
  page,
  request,
}) => {
  const o = await ownOffer(request);
  await db()
    .collection("parameters")
    .doc("juntos-com")
    .set({
      ...originalParameters,
      data_json: JSON.stringify({
        ...JSON.parse(originalParameters.data_json),
        minMargin: "10",
        desiredMargin: "20",
      }),
    });
  await db()
    .collection("costs")
    .doc(o.id)
    .set({
      offer_id: o.id,
      store_id: o.store_id,
      data_json: JSON.stringify({
        ...emptyCosts(),
        goods: "90",
        mlPercent: "16",
        mlFixed: "0",
        shipping: "10",
        packaging: "0",
        advertising: "0",
        other: "0",
        taxRate: "0",
        taxBase: "price",
        managementRate: "0",
        managementBase: "price",
      }),
      updated_at: new Date().toISOString(),
    });
  await mockAnalytics(page, o);
  await page.goto("/analises?store=juntos-com");
  await page.getByRole("tab", { name: "Diagnóstico", exact: true }).click();
  const row = page
    .getByRole("region", { name: "Diagnóstico dos anúncios", exact: true })
    .locator("tbody tr")
    .filter({ hasText: o.title });
  await expect(row).toContainText("Perdendo vendas");
  await expect(row).toContainText("Margem de contribuição negativa");
  await expect(row).toContainText("83 / 100");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await row.getByRole("button", { name: o.title, exact: true }).click();
  await page.route("https://http2.mlstatic.com/**", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="white"/></svg>',
    }),
  );
  await page
    .getByText("Mídia e ficha técnica da última consulta", { exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Foto 1 de " + o.title }),
  ).toBeVisible();
  await expect(page.locator(".ml-attributes")).toContainText("Marca");
  await expect(page.getByText(/Vídeo legado na API/)).toContainText(
    "video-legado",
  );
  await page.route("**/api/offers/*/ml-competition", async (route) => {
    const snapshot = {
      offer_id: o.id,
      store_id: o.store_id,
      seller_id: "111",
      auth_version: 997,
      offer_version: o.version,
      status: "losing",
      priceToWin: "95.00",
      currentPrice: "100.00",
      consistent: true,
      observed_at: new Date().toISOString(),
    };
    await db().collection("ml_competition").doc(o.id).set(snapshot);
    await route.fulfill({ json: snapshot });
  });
  await page.getByRole("button", { name: "Desempenho", exact: true }).click();
  await page
    .getByRole("button", { name: "Consultar competição no ML" })
    .click();
  await expect(
    page.getByText("Perdendo a disputa", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/preço indicativo está abaixo/)).toBeVisible();
  expect((await db().collection("offers").doc(o.id).get()).data()!.price).toBe(
    o.price,
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.screenshot({
    path: "test-results/listing-competition-mobile.png",
    fullPage: true,
  });
});
test("catalogue polling reflects external changes and pauses for drafts, dialogs and hidden pages", async ({
  page,
  request,
}) => {
  const o = await ownOffer(request);
  let calls = 0;
  let reads = 0;
  let release: () => void = () => {};
  await page.route("**/api/workspace?*", async (route) => {
    reads++;
    if (reads === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.continue();
  });
  await page.route("**/api/catalog/refresh*", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ offerId: o.id });
    calls++;
    const ref = db().collection("offers").doc(o.id),
      current = (await ref.get()).data()!;
    await ref.set({
      ...current,
      price: "125.00",
      version: current.version + 1,
      ml: { ...current.ml, observedAt: new Date().toISOString() },
    });
    await route.fulfill({
      json: {
        results: [{ storeId: "juntos-com", status: "confirmed", updated: 1 }],
        partial: false,
      },
    });
  });
  await page.clock.install();
  await page.goto(`/anuncios/${o.id}?store=juntos-com`);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page.clock.fastForward(61000);
  await expect.poll(() => calls).toBe(1);
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".workspace-data")).toHaveJSProperty(
    "disabled",
    false,
  );
  await expect(page.getByLabel("Loja global")).toBeEnabled();
  await expect(
    page.getByRole("progressbar", { name: "Operação em andamento" }),
  ).toHaveCount(0);
  release();
  await expect(page.locator(".detail-stats").first()).toContainText(
    "R$ 125,00",
  );
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page
    .getByText("Analisar título e termos da concorrência", { exact: true })
    .click();
  const title = page.getByLabel("Rascunho do título");
  await title.fill("Rascunho de teste que não deve ser sobrescrito");
  await page.clock.fastForward(61000);
  expect(calls).toBe(1);
  await expect(title).toHaveValue(
    "Rascunho de teste que não deve ser sobrescrito",
  );
  await page.getByRole("button", { name: "Salvar rascunho como nota" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Rascunho salvo" }),
  ).toBeVisible();
  expect(
    (
      await db().collection("notes").where("offer_id", "==", o.id).get()
    ).docs.some(
      (d) => d.data().body === "Rascunho de teste que não deve ser sobrescrito",
    ),
  ).toBe(true);
  expect((await db().collection("offers").doc(o.id).get()).data()!.title).toBe(
    o.title,
  );
  await page
    .getByRole("button", { name: "Editar cadastro", exact: true })
    .click();
  await page.clock.fastForward(61000);
  expect(calls).toBe(1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(180000);
  expect(calls).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(61000);
  await expect.poll(() => calls).toBe(2);
});
