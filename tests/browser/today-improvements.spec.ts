import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, key, put } from "../../src/server/db";
import { businessDay } from "../../src/domain/analytics";
const headers = { Origin: "http://localhost:3100" };
let storeId: string;
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { headers, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test.beforeEach(async ({ request }) => {
  storeId = (
    await post(request, "/api/stores", {
      name: "Rotina mensal " + randomUUID(),
    })
  ).id;
});
test.afterEach(async () => {
  if (storeId)
    await db().collection("stores").doc(storeId).update({ active: 0 });
});
async function offers(request: APIRequestContext, count = 7) {
  const rows = [];
  for (let i = 1; i <= count; i++)
    rows.push(
      await post(request, "/api/offers", {
        storeId,
        name: "Sequência " + i,
        title: "Revisão " + String(i).padStart(2, "0"),
        price: "100",
        type: "unit",
        status: "paused",
      }),
    );
  return rows;
}
test("monthly progress uses the saved sales snapshot and invalidates across processes after partial data", async ({
  page,
  request,
}) => {
  const day = businessDay(),
    month = day.slice(0, 7),
    observedAt = new Date().toISOString();
  await post(request, "/api/today/goal", {
    storeId,
    month,
    target: "10000",
    version: 0,
  });
  const connectionId = key(storeId, "mercadolivre");
  const connection = (
    await db().collection("connections").doc(connectionId).get()
  ).data()!;
  await put("connections", connectionId, {
    ...connection,
    status: "connected",
    external_account: "monthly-test-seller",
    auth_version: 7,
  });
  const snapshotId = key(
    "datamat",
    storeId,
    month + "-01",
    day,
    "7",
    "monthly-test-seller",
  );
  const source = {
    storeId,
    storeName: "Mensal",
    connected: true,
    sellerId: "monthly-test-seller",
    authVersion: 7,
    observedAt,
    complete: true,
    totalReported: 1,
    visits: null,
    unanswered: null,
    reputation: null,
    shipping: null,
    warnings: [],
    error: null,
    orders: [
      {
        id: "monthly-order",
        storeId,
        created: new Date(Date.now() - 1).toISOString(),
        status: "paid",
        shipmentId: null,
        lines: [
          {
            itemId: "MLB1",
            title: "Teste mensal",
            quantity: 1,
            price: "5000",
            fee: null,
            contribution: null,
            offerId: null,
          },
        ],
      },
    ],
  };
  await put("ml_analytics", snapshotId, {
    store_id: storeId,
    data_json: JSON.stringify(source),
    sales_only: true,
    updated_at: observedAt,
    last_error: null,
  });
  // The UI's automatic daily refresh is controlled; no external ML account is used.
  let providerRefreshes = 0;
  await page.route("**/api/today/refresh?*", async (route) => {
    providerRefreshes++;
    await route.fulfill({
      json: await (await request.get(`/api/today?store=${storeId}`)).json(),
    });
  });
  await page.clock.install();
  await page.goto(`/?store=${storeId}`);
  const panel = page.locator(".today-monthly-goal");
  await expect(panel.locator(".monthly-goal-values > strong")).toContainText(
    "5.000,00",
  );
  await expect(panel.getByRole("meter")).toHaveAttribute("value", "50");
  await expect(panel).toContainText("50%");
  await page.clock.fastForward(61000);
  expect(providerRefreshes).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/monthly-goal-mobile.png",
    fullPage: true,
  });
  const requestEvent = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/today/monthly-refresh",
  );
  await panel.getByRole("button", { name: "Atualizar vendas do mês" }).click();
  expect((await requestEvent).postDataJSON()).toEqual({ force: true });
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await put("ml_analytics", snapshotId, {
    store_id: storeId,
    data_json: JSON.stringify({ ...source, complete: false }),
    sales_only: true,
    updated_at: observedAt,
    last_error: null,
  });
  await page.reload();
  await expect(panel).toContainText("Vendas parciais");
  await expect(panel.getByRole("meter")).toHaveCount(0);
  await expect(panel.locator(".monthly-goal-values > strong")).toContainText(
    "5.000,00",
  );
});
test("monthly goal can be created, edited, cancelled and removed on the site with persistent versions", async ({
  page,
  request,
}) => {
  await offers(request, 1);
  await page.goto(`/?store=${storeId}`);
  const panel = page.locator(".today-monthly-goal");
  await page.getByRole("button", { name: "Definir meta mensal" }).click();
  const modal = page.getByRole("dialog", {
    name: "Meta mensal de faturamento",
  });
  await modal
    .getByLabel("Meta de faturamento (R$) *", { exact: true })
    .fill("10000");
  await modal.getByRole("button", { name: "Salvar meta mensal" }).click();
  await expect(modal).not.toBeVisible();
  await expect(panel.locator(".monthly-goal-values > span")).toContainText(
    "10.000,00",
  );
  await expect(panel).toContainText("Aguardando consulta");
  await expect(panel.getByRole("meter")).toHaveCount(0);
  const goalId = key("datamat", storeId, businessDay().slice(0, 7));
  expect(
    (await db().collection("monthly_goals").doc(goalId).get()).data()!.version,
  ).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Editar meta mensal" }).click();
  const input = modal.getByLabel("Meta de faturamento (R$) *", { exact: true });
  await expect(input).toHaveValue("10000.00");
  await input.fill("15000");
  await page.mouse.click(2, 2);
  const decision = page.getByRole("dialog", { name: "Descartar alterações?" });
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "Continuar editando" }).click();
  await expect(input).toHaveValue("15000");
  await modal.getByRole("button", { name: "Salvar meta mensal" }).click();
  await expect(panel.locator(".monthly-goal-values > span")).toContainText(
    "15.000,00",
  );
  expect(
    (await db().collection("monthly_goals").doc(goalId).get()).data()!.version,
  ).toBe(2);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/monthly-goal-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Editar meta mensal" }).click();
  await modal
    .getByRole("button", { name: "Remover meta", exact: true })
    .click();
  const remove = page.getByRole("dialog", { name: "Remover meta mensal?" });
  await remove.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(modal).toBeVisible();
  await modal
    .getByRole("button", { name: "Remover meta", exact: true })
    .click();
  await remove
    .getByRole("button", { name: "Remover meta", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Definir meta mensal" }),
  ).toBeVisible();
  expect(
    (await db().collection("monthly_goals").doc(goalId).get()).exists,
  ).toBe(false);
});
test("Today loads five rows per response and pages without reloading the summary or navigation", async ({
  page,
  request,
}) => {
  await offers(request, 12);
  const initial = await (
    await request.get(`/api/today?store=${storeId}`)
  ).json();
  expect(initial.queue).toHaveLength(5);
  expect(initial.queuePage.total).toBe(12);
  let summaryReads = 0,
    navigationReads = 0,
    pages = 0;
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/api/today") summaryReads++;
    if (path === "/api/navigation") navigationReads++;
    if (path === "/api/today/queue") pages++;
  });
  await page.goto(`/?store=${storeId}`);
  await expect(page.locator(".today-queue-row")).toHaveCount(5);
  await page.evaluate(() => {
    (window as any).__metrics = document.querySelector(".today-metrics");
    (window as any).__nav = document.querySelector(".sidebar");
  });
  await page.getByRole("button", { name: "Próximos anúncios da fila" }).click();
  await expect(page.locator(".today-queue")).toContainText("Revisão 06");
  await expect(page.locator(".today-queue-row")).toHaveCount(5);
  expect(summaryReads).toBe(1);
  expect(navigationReads).toBe(1);
  expect(pages).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).__metrics ===
          document.querySelector(".today-metrics") &&
        (window as any).__nav === document.querySelector(".sidebar"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Próximos anúncios da fila" }).click();
  await expect(page.locator(".today-queue-row")).toHaveCount(2);
  await expect(page.locator(".today-queue-footer")).toContainText(
    "11–12 de 12",
  );
});
test("save and next preserves failed edits and advances through pages without applying ML prices", async ({
  page,
  request,
}) => {
  const listings = await offers(request, 7);
  let nextReads = 0,
    fail = true;
  page.on("request", (r) => {
    if (r.url().includes("/api/today/next")) nextReads++;
  });
  await page.route(`**/api/offers/${listings[0].id}/costs`, async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 409,
        json: { error: "Conflito controlado de custos" },
      });
    } else await route.continue();
  });
  await page.goto(`/?store=${storeId}&todayFocus=prepare`);
  const original = page.url();
  await page.getByRole("button", { name: "Revisar em sequência" }).click();
  const preview = page.locator(".offer-preview");
  const goods = preview.getByRole("spinbutton", { name: /Mercadoria/ });
  await goods.fill("20");
  await preview
    .getByRole("button", { name: "Salvar e próximo", exact: true })
    .click();
  await expect(preview).toContainText("Conflito controlado de custos");
  await expect(goods).toHaveValue("20");
  expect(nextReads).toBe(0);
  await preview
    .getByRole("button", { name: "Salvar e próximo", exact: true })
    .click();
  await expect(preview.locator(".preview-header h2")).toHaveText("Revisão 02");
  const stored = (
    await db().collection("costs").doc(listings[0].id).get()
  ).data()!;
  expect(JSON.parse(stored.data_json).goods).toBe("20");
  for (let i = 1; i < 7; i++) {
    await expect(preview.locator(".preview-header h2")).toHaveText(
      `Revisão ${String(i + 1).padStart(2, "0")}`,
    );
    await preview
      .getByRole("spinbutton", { name: /Mercadoria/ })
      .fill(String(20 + i));
    if (i === 1) {
      await preview
        .getByLabel("Preço proposto (R$)", { exact: true })
        .fill("90");
      await preview
        .getByLabel("Motivo da proposta *", { exact: true })
        .fill("Revisão diária de preço");
      await preview
        .getByRole("button", { name: "Salvar proposta e próximo", exact: true })
        .click();
    } else
      await preview
        .getByRole("button", { name: "Salvar e próximo", exact: true })
        .click();
  }
  await expect(preview).not.toBeVisible();
  await expect(page.getByLabel("Loja global")).toHaveValue(storeId);
  expect(page.url()).toBe(original);
  expect(nextReads).toBe(7);
  for (const listing of listings)
    expect(
      (await db().collection("offers").doc(listing.id).get()).data()!.price,
    ).toBe("100");
  const proposals = await db()
    .collection("proposals")
    .where("offer_id", "==", listings[1].id)
    .get();
  expect(proposals.size).toBe(1);
  expect(proposals.docs[0].data().status).toBe("review");
});
