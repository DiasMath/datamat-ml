import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, key } from "../../src/server/db";
const connectionId = key("juntos-com", "mercadolivre");
async function post(request: APIRequestContext, path: string, data: unknown) {
  const r = await request.post(path, {
    headers: { Origin: "http://localhost:3100" },
    data,
  });
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
async function fixture(request: APIRequestContext, mlId: string) {
  await post(request, "/api/parameters/juntos-com", {
    minMargin: "10",
    desiredMargin: "20",
    taxRate: "5",
    taxBase: "price",
    managementRate: "1",
    managementBase: "price",
    reviewDays: 30,
  });
  const created = await post(request, "/api/offers", {
    storeId: "juntos-com",
    name: "Produto integração ML",
    title: "Anúncio integração " + mlId,
    mlId,
    sku: "000ML",
    brand: "Marca ML",
    category: "Categoria ML",
    description: "Descrição ML",
    type: "unit",
    status: "active",
    price: "100",
  });
  await post(request, `/api/offers/${created.id}/costs`, {
    goods: "40",
    mlPercent: "10",
    mlFixed: "2",
    shipping: "5",
    packaging: "1",
    advertising: "2",
    other: "0",
  });
  const ref = db().collection("offers").doc(created.id),
    o = (await ref.get()).data()!;
  const ml = {
    connectionId,
    sellerId: "111",
    authVersion: 77,
    currencyId: "BRL",
    categoryId: "MLB100",
    listingTypeId: "gold_special",
    shippingMode: "me2",
    logisticType: "drop_off",
    photoCount: 0,
    availableQuantity: 0,
    variablePrices: false,
    missingRequiredAttributes: [{ id: "MODEL", name: "Modelo" }],
    observedAt: new Date().toISOString(),
  };
  await ref.set({ ...o, ml });
  await db().collection("connections").doc(connectionId).set({
    store_id: "juntos-com",
    provider: "mercadolivre",
    external_account: "111",
    nickname: "Vendedor teste",
    status: "connected",
    auth_version: 77,
  });
  return { ...o, id: created.id as string, version: Number(o.version), ml };
}
test.afterEach(async () => {
  await db().collection("connections").doc(connectionId).set({
    store_id: "juntos-com",
    provider: "mercadolivre",
    external_account: null,
    status: "unauthorized",
    auth_version: 78,
  });
});
test("automatic tariffs debounce typing, discard obsolete replies and preserve the official quote in proposal", async ({
  page,
  request,
}) => {
  const o = await fixture(request, "MLB7001");
  const quoted: string[] = [];
  await page.route(`**/api/offers/${o.id}/ml-quote`, async (route) => {
    const input = route.request().postDataJSON();
    quoted.push(input.price);
    if (input.price === "90.00") await new Promise((r) => setTimeout(r, 800));
    const quote = {
      id: randomUUID(),
      offer_id: o.id,
      store_id: "juntos-com",
      offer_version: o.version,
      connection_id: connectionId,
      auth_version: 77,
      seller_id: "111",
      price: input.price,
      mlPercent: "14",
      mlFixed: "2",
      total: String(Number(input.price) * 0.14 + 2),
      expires_at: Date.now() + 300000,
      quoted_at: new Date().toISOString(),
      source: "Mercado Livre · contrato simulado",
      shippingVerified: false,
    };
    await db().collection("ml_quotes").doc(quote.id).set(quote);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(quote),
    });
  });
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=costs`);
  const panel = page.locator(".calculation-panel"),
    price = page.getByLabel("Preço proposto (R$)");
  await expect(page.locator(".ml-tariff-box")).toContainText(
    "Tarifa consultada",
  );
  await expect(panel.locator(".margin-result")).toContainText("R$ 30,00");
  await price.fill("90");
  await expect(
    panel.getByRole("button", { name: "Salvar para revisão" }),
  ).toBeDisabled();
  await expect.poll(() => quoted.includes("90.00")).toBe(true);
  await price.fill("");
  await price.pressSequentially("8");
  await price.pressSequentially("5");
  await expect(panel.locator(".price-comparison")).toContainText("R$ 85,00");
  await expect(page.locator(".ml-tariff-box")).toContainText(
    "Tarifa consultada",
  );
  await expect(panel.locator(".margin-result")).toContainText("R$ 18,00");
  expect(quoted).not.toContain("8.00");
  await expect(price).toBeFocused();
  await page.getByLabel("Conferi as tarifas e o frete").check();
  await panel
    .getByLabel("Motivo da proposta")
    .fill("Aplicar tarifa oficial ao cenário");
  await panel.getByRole("button", { name: "Salvar para revisão" }).click();
  await expect(page.getByRole("status")).toContainText("Proposta salva");
  const proposals = await db()
    .collection("proposals")
    .where("offer_id", "==", o.id)
    .get();
  const snapshot = JSON.parse(proposals.docs[0].data().snapshot_json);
  expect(snapshot.mlQuote.price).toBe("85.00");
  expect(snapshot.input.mlPercent).toBe("14");
  expect(snapshot.proposed.margin).toBe("18.00");
  expect((await db().collection("offers").doc(o.id).get()).data()!.price).toBe(
    "100",
  );
});
test("tariff errors allow explicit manual mode and keep mobile pricing responsive", async ({
  page,
  request,
}) => {
  const o = await fixture(request, "MLB7002");
  await page.route(`**/api/offers/${o.id}/ml-quote`, (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Tarifas indisponíveis no momento" }),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=costs`);
  await expect(page.locator(".ml-tariff-box")).toContainText(
    "Tarifas indisponíveis",
  );
  const panel = page.locator(".calculation-panel");
  await expect(
    panel.getByRole("button", { name: "Salvar para revisão" }),
  ).toBeDisabled();
  await page.getByLabel("Consultar tarifas do ML automaticamente").uncheck();
  await expect(
    panel.getByRole("button", { name: "Salvar para revisão" }),
  ).toBeEnabled();
  const price = page.getByLabel("Preço proposto (R$)");
  await price.fill("85");
  await expect(
    page.getByRole("region", { name: "Resumo da precificação ao digitar" }),
  ).toContainText("21,40");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
test("quality issues create a single usable task and remain visible on narrow screens", async ({
  page,
  request,
}) => {
  const o = await fixture(request, "MLB7003");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=overview`);
  const checklist = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Próximas melhorias do anúncio" }),
  });
  const row = checklist
    .locator(".list-item")
    .filter({ hasText: "Anúncio ativo sem estoque" });
  await row.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(
    row.getByRole("button", { name: "Tarefa criada" }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    row.getByRole("button", { name: "Tarefa criada" }),
  ).toBeDisabled();
  const tasks = await db()
    .collection("tasks")
    .where("offer_id", "==", o.id)
    .get();
  expect(tasks.size).toBe(1);
  expect(tasks.docs[0].data().description).toContain("ERP");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("performance uses the imported period and advertising ratios update live without changing costs", async ({
  page,
  request,
}) => {
  const o = await fixture(request, "MLB7004");
  await db().collection("ml_metrics").doc(o.id).set({
    store_id: "juntos-com",
    seller_id: "111",
    offer_id: o.id,
    visits: 100,
    auth_version: 77,
    paidOrders: 3,
    units: 5,
    grossRevenue: "400",
    orderVisitRate: "3",
    unansweredQuestions: 2,
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-10-01T00:00:00.000Z",
    observed_at: new Date().toISOString(),
    source: "Mercado Livre · contrato simulado",
  });
  await page.goto(`/anuncios/${o.id}?store=juntos-com&tab=performance`);
  await expect(
    page.getByRole("heading", { name: "Desempenho do anúncio" }),
  ).toBeVisible();
  await expect(page.locator(".detail-stats").first()).toContainText(
    "R$ 400,00",
  );
  await page
    .getByText("Conferir retorno da publicidade", { exact: true })
    .click();
  await page.getByLabel("Investimento em publicidade (R$)").fill("100");
  await page.getByLabel("Receita atribuída aos anúncios (R$)").fill("500");
  await page.getByLabel("Receita total do período (R$)").fill("1000");
  const ads = page
    .locator("details")
    .filter({ hasText: "Conferir retorno da publicidade" });
  await expect(ads).toContainText("5.00×");
  await expect(ads).toContainText("20%");
  await expect(ads).toContainText("10%");
  const costs = JSON.parse(
    (await db().collection("costs").doc(o.id).get()).data()!.data_json,
  );
  expect(costs.advertising).toBe("2");
});
