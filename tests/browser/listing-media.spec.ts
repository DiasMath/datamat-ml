import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { db, key } from "../../src/server/db";
import { oauthPopupResponse } from "../../src/server/oauth-popup";
import { financialContext } from "../../src/domain/ml-financial";
const origin = { Origin: "http://localhost:3100" },
  connectionId = key("juntos-com", "mercadolivre");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=",
  "base64",
);
let previous: Record<string, any>;
test.beforeEach(async ({ request, page }) => {
  await page.route("**/api/catalog/refresh?*", (route) =>
    route.fulfill({
      json: {
        partial: false,
        results: [
          {
            storeId: "juntos-com",
            status: "confirmed",
            processed: 2,
            has_more: false,
          },
        ],
      },
    }),
  );
  await request.get("/api/workspace");
  previous = (
    await db().collection("connections").doc(connectionId).get()
  ).data()!;
});
test.afterEach(async () => {
  await db().collection("connections").doc(connectionId).set(previous);
});
async function seed(request: APIRequestContext) {
  const title = "MIDIA-" + Date.now() + " Produto de catálogo";
  const rows = [];
  await db()
    .collection("connections")
    .doc(connectionId)
    .set({
      ...previous,
      status: "connected",
      external_account: "111",
      auth_version: 998,
      has_more: false,
    });
  for (let i = 0; i < 2; i++) {
    const mlId = "MLB" + Date.now() + i;
    const response = await request.post("/api/offers", {
      headers: origin,
      data: {
        storeId: "juntos-com",
        name: title,
        title,
        mlId,
        price: "100",
        status: "active",
        type: "unit",
        sku: "MIDIA-" + i,
      },
    });
    expect(response.ok()).toBe(true);
    const row = await response.json();
    const ml = {
      sellerId: "111",
      connectionId,
      authVersion: 998,
      categoryId: "MLB100",
      listingTypeId: "gold_special",
      availableQuantity: 4,
      freeShipping: true,
      catalogListing: i === 0,
      health: 0.87,
      photoCount: 2,
      videoId: "aB123456789",
      videoAvailable: true,
      observedAt: new Date().toISOString(),
      pictures: [
        { id: "P1", url: `https://http2.mlstatic.com/datamat-e2e-${mlId}.png` },
        {
          id: "P2",
          url: `https://http2.mlstatic.com/datamat-e2e-${mlId}-second.png`,
        },
      ],
      attributes: [],
      variationDetails: [],
      subStatus: [],
    };
    await db()
      .collection("offers")
      .doc(row.id)
      .set({ ...row, ml });
    const costs = (await db().collection("costs").doc(row.id).get()).data()!;
    await db()
      .collection("costs")
      .doc(row.id)
      .set({
        ...costs,
        data_json: JSON.stringify({
          ...JSON.parse(costs.data_json),
          shipping: "10",
        }),
      });
    await db()
      .collection("ml_current_quotes")
      .doc(row.id)
      .set({
        offer_id: row.id,
        store_id: row.store_id,
        offer_version: row.version,
        auth_version: 998,
        seller_id: "111",
        price: "100.00",
        total: "15.00",
        quoted_at: new Date().toISOString(),
        expires_at: Date.now() + 300000,
      });
    await db()
      .collection("ml_metrics_7d")
      .doc(row.id)
      .set({
        offer_id: row.id,
        store_id: row.store_id,
        auth_version: 998,
        seller_id: "111",
        periodDays: 7,
        visits: 100,
        paidOrders: 3,
        units: 4,
        orderVisitRate: "3.00",
        from: new Date(Date.now() - 7 * 86400000).toISOString(),
        to: new Date().toISOString(),
        observed_at: new Date().toISOString(),
      });
    rows.push({ ...row, ml });
  }
  return { title, rows };
}
test("ML codes can be copied in both views and stock stays with the product, including zero and unknown values", async ({
  page,
  context,
  request,
}) => {
  const { title, rows } = await seed(request);
  await db()
    .collection("offers")
    .doc(rows[0].id)
    .update({ "ml.availableQuantity": 0 });
  await db()
    .collection("offers")
    .doc(rows[1].id)
    .update({ "ml.availableQuantity": null });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let loads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/workspace?")) loads++;
  });
  await page.goto("/anuncios?store=juntos-com&q=" + encodeURIComponent(title));
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  const initialLoads = loads;
  for (const view of ["operational", "registry"]) {
    await page.getByLabel("Visão da tabela").selectOption(view);
    await expect(
      page.getByRole("button", { name: "Ordenar por: Estoque", exact: true }),
    ).toHaveCount(0);
    const row = page
      .locator(".offers-table tbody tr")
      .filter({ hasText: rows[0].ml_id });
    await expect(
      row.locator(".offer-product-col .listing-stock-value"),
    ).toHaveText("Estoque: 0 un.");
    await expect(
      page
        .locator(".offers-table tbody tr")
        .filter({ hasText: rows[1].ml_id })
        .locator(".offer-product-col"),
    ).toContainText("Estoque: não informado");
    const url = page.url();
    await row
      .getByRole("button", {
        name: `Copiar código ML ${rows[0].ml_id}`,
        exact: true,
      })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      rows[0].ml_id,
    );
    await expect(page.locator(".toast-viewport")).toContainText(
      "Código ML copiado.",
    );
    expect(page.url()).toBe(url);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByLabel("Loja global")).toHaveValue("juntos-com");
  }
  expect(loads).toBe(initialLoads);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Permissão negada");
    };
  });
  await page
    .getByRole("button", {
      name: `Copiar código ML ${rows[1].ml_id}`,
      exact: true,
    })
    .click();
  await expect(page.locator(".toast-viewport")).toContainText(
    "Não foi possível copiar o código.",
  );
});

test("operational listings show photos, stock, conditions, honest estimates and distinct ID/title counts", async ({
  page,
  context,
  request,
}) => {
  const { title } = await seed(request);
  await context.route("https://http2.mlstatic.com/datamat-e2e-**", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.goto("/anuncios?store=juntos-com&q=" + encodeURIComponent(title));
  await expect(page.locator(".listing-counts")).toContainText("2 IDs ML");
  await expect(page.locator(".listing-counts")).toContainText(
    "1 título distinto",
  );
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".offer-thumbnail").first()).toHaveClass(/ready/);
  await expect(page.locator(".listing-stock-value").first()).toContainText(
    "4 un.",
  );
  await expect(page.locator(".offers-table tbody")).toContainText("Clássico");
  await expect(page.locator(".offers-table tbody")).toContainText("75,00");
  await expect(page.locator(".offers-table tbody")).toContainText("87 / 100");
  await expect(page.locator(".listing-metrics").first()).toContainText("100");
  await page.getByLabel("Tipo de publicação ML").selectOption("catalog");
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Visão da tabela").selectOption("registry");
  await expect(
    page.getByRole("button", {
      name: "Ordenar por: SKU",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Visão da tabela").selectOption("operational");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/listings-operational-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/listings-operational-mobile.png",
    fullPage: true,
  });
});
test("listings separate known ML fees from pending own costs, filter actionable rows and open costs in the side preview", async ({
  page,
  request,
}) => {
  const { title, rows } = await seed(request);
  for (const [i, row] of rows.entries()) {
    const costs = (await db().collection("costs").doc(row.id).get()).data()!;
    const ml = { ...row.ml, freeShipping: false };
    const raw =
      i === 0
        ? { ...JSON.parse(costs.data_json), shipping: null }
        : {
            goods: "0",
            packaging: "0",
            advertising: "0",
            other: "0",
            otherDescription: "",
            mlPercent: "0",
            mlFixed: "0",
            shipping: "0",
            taxRate: "0",
            taxBase: "price",
            managementRate: "0",
            managementBase: "price",
          };
    await db()
      .collection("offers")
      .doc(row.id)
      .set({ ...row, ml });
    await db()
      .collection("costs")
      .doc(row.id)
      .set({ ...costs, data_json: JSON.stringify(raw) });
    await db()
      .collection("ml_financials")
      .doc(row.id)
      .set({
        organization_id: row.organization_id,
        offer_id: row.id,
        store_id: row.store_id,
        seller_id: "111",
        auth_version: 998,
        context: financialContext({ ...row, ml }),
        price: row.price,
        total: "15.00",
        mlPercent: "15",
        mlFixed: "0",
        shipping: { amount: null },
        quoted_at: new Date().toISOString(),
        expires_at: Date.now() + 1800000,
      });
  }
  await page.goto("/anuncios?store=juntos-com&q=" + encodeURIComponent(title));
  const first = page
    .locator(".offers-table tbody tr")
    .filter({ hasText: "SKU MIDIA-0" });
  const second = page
    .locator(".offers-table tbody tr")
    .filter({ hasText: "SKU MIDIA-1" });
  await expect(first).toContainText("Tarifa: R$ 15,00");
  await expect(first).toContainText("Tarifa disponível");
  await expect(first).toContainText("custos próprios pendentes");
  await expect(second).toContainText("100,00");
  await expect(second).toContainText("Manual");
  await expect(second.locator(".listing-margin-value")).toContainText("100%");
  const original = page.url();
  await first
    .getByRole("button", { name: "Conferir frete da loja", exact: true })
    .click();
  await expect(
    page.locator("dialog.offer-preview .pricing-cost-editor"),
  ).toBeVisible();
  expect(page.url()).toBe(original);
  await page.keyboard.press("Escape");
  for (const [filter, sku] of [
    ["ml", "MIDIA-0"],
    ["ownCosts", "MIDIA-0"],
    ["ready", "MIDIA-1"],
  ]) {
    await page.getByLabel("Filtrar pendências").selectOption(filter);
    await expect(page.locator(".offers-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".offers-table tbody")).toContainText(sku);
    await expect(page.getByLabel("Loja global")).toHaveValue("juntos-com");
  }
  await page.getByLabel("Filtrar pendências").selectOption("");
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if ([390, 1440].includes(width))
      await page.screenshot({
        path: `test-results/listings-costs-${width}.png`,
        fullPage: true,
      });
  }
});
test("listing information is readable and accessible, financial limits stay live, and catalogue/sync summaries cover the whole selected store", async ({
  page,
  request,
}) => {
  const { rows } = await seed(request);
  const parameterDoc = db().collection("parameters").doc("juntos-com");
  const originalParameters = (await parameterDoc.get()).data()!;
  try {
    await parameterDoc.set({
      ...originalParameters,
      data_json: JSON.stringify({
        ...JSON.parse(originalParameters.data_json),
        minMargin: "10",
        desiredMargin: "20",
      }),
    });
    const stamp = new Date().toISOString();
    await db().collection("connections").doc(connectionId).set(
      {
        last_sync_at: stamp,
        last_catalog_sync_at: stamp,
        last_catalog_completed_at: stamp,
      },
      { merge: true },
    );
    for (const [i, row] of rows.entries()) {
      const ml = {
        ...row.ml,
        catalogListing: true,
        availableQuantity: i === 0 ? 0 : null,
      };
      await db()
        .collection("offers")
        .doc(row.id)
        .set({ ...row, ml, sku: `GLOBAL-${row.id}` });
      const costs = (await db().collection("costs").doc(row.id).get()).data()!;
      await db()
        .collection("costs")
        .doc(row.id)
        .set({
          ...costs,
          data_json: JSON.stringify({
            goods: "30",
            mlPercent: "10",
            mlFixed: "0",
            shipping: "5",
            packaging: "0",
            advertising: "0",
            other: "0",
            otherDescription: "",
            taxRate: "0",
            taxBase: "price",
            managementRate: "0",
            managementBase: "price",
          }),
        });
      await db()
        .collection("ml_competition")
        .doc(row.id)
        .set({
          organization_id: row.organization_id,
          offer_id: row.id,
          store_id: row.store_id,
          seller_id: "111",
          auth_version: 998,
          offer_version: row.version,
          status: i === 0 ? "winning" : "losing",
          currentPrice: "100.00",
          priceToWin: "40.00",
          consistent: true,
          observed_at: stamp,
        });
    }
    const url = `/anuncios?store=juntos-com&q=${encodeURIComponent("GLOBAL-" + rows[0].id)}`;
    await page.goto(url);
    await expect(page.locator(".offers-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".listing-stock-value")).toHaveText(
      "Estoque: 0 un.",
    );
    await expect(page.locator(".listing-margin-value")).toContainText(
      "R$ 55,00",
    );
    await expect(page.locator(".listing-margin-value")).toContainText(
      "R$ 43,75",
    );
    await expect(page.locator(".listing-margin-value")).toContainText("56,25%");
    const header = page.getByRole("button", {
      name: "Ordenar por: Condições",
      exact: true,
    });
    await expect(header.locator("..")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(header.locator("..")).toHaveCSS("font-size", "12px");
    const title = page.locator(".offer-title");
    expect(await title.getAttribute("title")).toBeNull();
    await title.hover();
    const information = page.getByRole("dialog", {
      name: "Anúncio e produto",
      exact: true,
    });
    await expect(information).toBeVisible();
    await expect(information).toContainText(rows[0].ml_id);
    await information.hover();
    await expect(information).toBeVisible();
    await information.screenshot({
      path: "test-results/listing-information-panel.png",
    });
    await page.keyboard.press("Escape");
    await expect(information).toHaveCount(0);
    const stock = page.locator(".listing-stock-value");
    await stock.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Estoque publicado", exact: true }),
    ).toBeVisible();
    await page.locator("h1").click();
    await expect(page.locator(".listing-information")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Competitividade do catálogo", exact: true })
      .click();
    const catalogue = page.getByRole("dialog", {
      name: "Competitividade do catálogo",
      exact: true,
    });
    await expect(catalogue).toBeVisible();
    await expect(catalogue).toContainText(rows[1].ml_id);
    await expect(catalogue).toContainText("Abaixo do piso estimado");
    await page.screenshot({
      path: "test-results/listing-catalogue-overview.png",
      fullPage: true,
    });
    let receivedIds: string[] = [];
    let release = () => {};
    await page.route("**/api/catalog/competition*", async (route) => {
      const ids: string[] = route.request().postDataJSON().ids;
      const first = receivedIds.length === 0;
      receivedIds.push(...ids);
      if (first)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route.fulfill({
        json: { results: ids.map((id) => ({ id, updated: true })) },
      });
    });
    await catalogue
      .getByRole("button", { name: "Consultar catálogo no ML", exact: true })
      .click();
    await expect.poll(() => receivedIds.length).toBeGreaterThan(0);
    expect(receivedIds).toEqual(
      expect.arrayContaining(rows.map((row) => row.id)),
    );
    await expect(
      catalogue.getByRole("button", {
        name: "Consultar catálogo no ML",
        exact: true,
      }),
    ).toBeDisabled();
    release();
    await expect(
      catalogue.getByRole("button", {
        name: "Consultar catálogo no ML",
        exact: true,
      }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", {
        name: "Sincronização da tela com o ML",
        exact: true,
      })
      .click();
    const sync = page.getByRole("dialog", {
      name: "Sincronização da tela com o ML",
      exact: true,
    });
    await expect(sync).toContainText("Catálogo completo");
    await expect(sync).toContainText("Conectado");
    await expect(sync).toContainText("juntos.com");
    await expect(sync).toContainText("Última consulta de anúncios");
    await page.keyboard.press("Escape");
    expect(page.url()).toContain("GLOBAL-");
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await stock.click();
      const popup = page.getByRole("dialog", {
        name: "Estoque publicado",
        exact: true,
      });
      await expect(popup).toBeVisible();
      const box = (await popup.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      if (width <= 390) {
        for (const name of [
          "Competitividade do catálogo",
          "Sincronização da tela com o ML",
        ]) {
          await page.getByRole("button", { name, exact: true }).click();
          const dialog = page.getByRole("dialog", { name, exact: true });
          await expect(dialog).toBeVisible();
          const bounds = (await dialog.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          expect(bounds.height).toBeLessThanOrEqual(900);
          if (width === 390 && name.startsWith("Sincronização"))
            await page.screenshot({
              path: "test-results/listing-sync-390.png",
              fullPage: true,
            });
          await page.keyboard.press("Escape");
        }
      }
      if ([390, 1920].includes(width))
        await page.screenshot({
          path: `test-results/listing-information-${width}.png`,
          fullPage: true,
        });
    }
  } finally {
    await parameterDoc.set(originalParameters);
  }
});
test("old metrics are marked historical and an inconsistent competition response preserves its consultation date", async ({
  page,
  request,
}) => {
  const { title, rows } = await seed(request);
  const old = new Date(Date.now() - 2 * 86400000).toISOString();
  await db()
    .collection("ml_metrics_7d")
    .doc(rows[0].id)
    .set({ observed_at: old, to: old, visits: 101 }, { merge: true });
  await db()
    .collection("ml_metrics_7d")
    .doc(rows[1].id)
    .set({ visits: 400 }, { merge: true });
  await db().collection("ml_competition").doc(rows[0].id).set({
    offer_id: rows[0].id,
    store_id: rows[0].store_id,
    offer_version: rows[0].version,
    seller_id: "111",
    auth_version: 998,
    status: "winning",
    consistent: false,
    observed_at: new Date().toISOString(),
  });
  await page.goto("/anuncios?store=juntos-com&q=" + encodeURIComponent(title));
  const historical = page
    .locator(".offers-table tbody tr")
    .filter({ hasText: "SKU MIDIA-0" });
  await expect(historical).toContainText("Métricas a atualizar");
  await expect(historical.locator(".listing-metrics")).toHaveCount(0);
  await expect(page.locator(".listing-metrics")).toHaveCount(1);
  await expect(page.locator(".listing-metrics")).toContainText("400");
  await historical
    .getByRole("button", { name: "Métricas a atualizar", exact: true })
    .click();
  const info = page.getByRole("dialog", {
    name: "Métricas da última consulta",
    exact: true,
  });
  await expect(info).toContainText("101");
  await expect(info).toContainText("históricos");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Ordenar por: Últimos 7 dias", exact: true })
    .click();
  await expect(page.locator(".offers-table tbody tr").first()).toContainText(
    "MIDIA-1",
  );
  await page
    .getByRole("button", { name: "Competitividade do catálogo", exact: true })
    .click();
  const row = page
    .locator(".listing-global-scroll tbody tr")
    .filter({ hasText: rows[0].ml_id });
  await expect(row).toContainText("condições inconsistentes");
  await expect(row).not.toContainText("Não consultado");
});
test("partial catalogue batches report every pending listing and resume without repeating completed requests", async ({
  page,
  request,
}) => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push(...(await seed(request)).rows);
  for (const row of rows)
    await db()
      .collection("offers")
      .doc(row.id)
      .set({ ml: { ...row.ml, catalogListing: true } }, { merge: true });
  const data = await (
    await request.get("/api/workspace?store=juntos-com")
  ).json();
  const count = data.listingOverview.competition.rows.length;
  const calls: string[][] = [];
  let resuming = false;
  await page.route("**/api/catalog/competition*", (route) => {
    const ids: string[] = route.request().postDataJSON().ids;
    calls.push(ids);
    if (!resuming && calls.length === 2)
      return route.fulfill({
        status: 503,
        json: { error: "ML temporariamente indisponível" },
      });
    return route.fulfill({
      json: {
        results: ids.map((id, i) => ({
          id,
          updated: resuming || i < 2,
          deferred: !resuming && i >= 2,
        })),
      },
    });
  });
  await page.goto(
    "/anuncios?store=juntos-com&q=" + encodeURIComponent(rows[0].sku),
  );
  await page
    .getByRole("button", { name: "Competitividade do catálogo", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Competitividade do catálogo",
    exact: true,
  });
  await modal
    .getByRole("button", { name: "Consultar catálogo no ML", exact: true })
    .click();
  await expect(modal.getByRole("status")).toContainText(
    `${count - 2} pendentes`,
  );
  await expect(modal.getByRole("status")).toContainText(
    "ML temporariamente indisponível",
  );
  const completed = calls[0].slice(0, 2);
  resuming = true;
  await modal
    .getByRole("button", { name: "Continuar consulta no ML", exact: true })
    .click();
  await expect(
    modal.getByRole("button", {
      name: "Consultar catálogo no ML",
      exact: true,
    }),
  ).toBeEnabled();
  for (const id of completed)
    expect(calls.flat().filter((value) => value === id)).toHaveLength(1);
  expect(new Set(calls.flat()).size).toBe(count);
  expect(new URL(page.url()).searchParams.get("q")).toBe(rows[0].sku);
});
test("indicator progress can be interrupted and resumes only unacknowledged listings without moving the page", async ({
  page,
  request,
}) => {
  const { title, rows } = await seed(request);
  for (let i = 0; i < 10; i++) {
    const id = randomUUID();
    await db()
      .collection("offers")
      .doc(id)
      .set({ ...rows[0], id, ml_id: `MLB990002${Date.now()}${i}` });
  }
  const calls: string[][] = [];
  let release = () => {};
  await page.route("**/api/catalog/indicators*", async (route) => {
    const ids: string[] = route.request().postDataJSON().ids;
    calls.push(ids);
    if (calls.length === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route
      .fulfill({
        json: {
          results: ids.map((id) => ({
            id,
            metrics: true,
            fees: true,
            errors: [],
          })),
        },
      })
      .catch(() => {});
  });
  try {
    await page.goto(
      `/anuncios?store=juntos-com&q=${encodeURIComponent(title)}&pageSize=50`,
    );
    await expect(page.locator(".offers-table tbody tr")).toHaveCount(12);
    const original = page.url();
    const top = (await page.locator(".offers-panel").boundingBox())!.y;
    const button = page.getByRole("button", {
      name: "Atualizar anúncios da loja",
      exact: true,
    });
    await button.click();
    const progress = page.getByRole("region", {
      name: "Atualização dos indicadores ML",
      exact: true,
    });
    await expect(progress).toContainText("10 de 12 anúncios consultados");
    await expect(progress.getByRole("progressbar")).toHaveAttribute(
      "value",
      "10",
    );
    expect((await page.locator(".offers-panel").boundingBox())!.y).toBe(top);
    await progress
      .getByRole("button", { name: "Interromper consulta de indicadores" })
      .click();
    await expect(progress).toHaveCount(0);
    await expect(button).toBeEnabled();
    await expect(page.getByLabel("Loja global")).toBeEnabled();
    await expect(
      page.getByRole("progressbar", { name: "Operação em andamento" }),
    ).toHaveCount(0);
    release();
    await button.click();
    await expect(page.locator(".toast-viewport")).toContainText(
      "2 anúncios com indicadores consultados.",
    );
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(calls[1]);
    expect(calls[2].some((id) => calls[0].includes(id))).toBe(false);
    expect(page.url()).toBe(original);
  } finally {
    release();
  }
});
test("a stalled indicator response body times out, clears every loader and remains retryable", async ({
  page,
  request,
}) => {
  const { title } = await seed(request);
  await page.clock.install();
  await page.goto(`/anuncios?store=juntos-com&q=${encodeURIComponent(title)}`);
  await expect(page.locator(".offers-table tbody tr")).toHaveCount(2);
  await page.evaluate(() => {
    const original = window.fetch;
    (window as any).__indicatorStalled = true;
    (window as any).__indicatorCalls = [];
    window.fetch = async (input, init) => {
      if (!String(input).includes("/api/catalog/indicators"))
        return original(input, init);
      const ids: string[] = JSON.parse(String(init?.body)).ids;
      (window as any).__indicatorCalls.push(ids);
      const response = new Response(
        JSON.stringify({
          results: ids.map((id) => ({
            id,
            metrics: true,
            fees: true,
            errors: [],
          })),
        }),
      );
      if ((window as any).__indicatorStalled)
        response.json = () => new Promise(() => {});
      return response;
    };
  });
  const button = page.getByRole("button", {
    name: "Atualizar anúncios da loja",
    exact: true,
  });
  await button.click();
  await expect(page.locator(".listing-update-progress")).toBeVisible();
  await page.clock.fastForward(66000);
  await expect(page.locator(".toast-viewport")).toContainText(
    "A consulta demorou além do esperado",
  );
  await expect(page.locator(".listing-update-progress")).toHaveCount(0);
  await expect(button).toBeEnabled();
  await expect(page.getByLabel("Loja global")).toBeEnabled();
  await expect(
    page.getByRole("progressbar", { name: "Operação em andamento" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__indicatorStalled = false;
  });
  await button.click();
  await expect(page.locator(".toast-viewport")).toContainText(
    "2 anúncios com indicadores consultados.",
  );
  const calls = await page.evaluate(() => (window as any).__indicatorCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
});
test("catalogue synchronization closes or cancels promptly and can start again after a stalled request", async ({
  page,
  request,
}) => {
  const { title } = await seed(request);
  let calls = 0;
  const releases: Array<() => void> = [];
  await page.route("**/api/catalog/refresh?*", async (route) => {
    calls++;
    if (calls < 3)
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    await route
      .fulfill({
        json: {
          results: [
            {
              storeId: "juntos-com",
              status: "confirmed",
              processed: 2,
              has_more: false,
            },
          ],
          partial: false,
        },
      })
      .catch(() => {});
  });
  try {
    await page.goto(
      `/anuncios?store=juntos-com&q=${encodeURIComponent(title)}`,
    );
    const icon = page.getByRole("button", {
      name: "Sincronização da tela com o ML",
      exact: true,
    });
    const dialog = page.getByRole("dialog", {
      name: "Sincronização da tela com o ML",
      exact: true,
    });
    await icon.click();
    await dialog
      .getByRole("button", { name: "Atualizar catálogo da loja" })
      .click();
    await expect.poll(() => calls).toBe(1);
    await dialog
      .getByRole("button", { name: "Interromper consulta", exact: true })
      .click();
    await expect(dialog).toContainText("Consulta interrompida");
    await expect(
      dialog.getByRole("button", { name: "Atualizar catálogo da loja" }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Atualizar catálogo da loja" })
      .click();
    await expect.poll(() => calls).toBe(2);
    await page.mouse.click(2, 2);
    await expect(dialog).not.toBeVisible();
    await expect(icon.locator(".spin")).toHaveCount(0);
    await icon.click();
    await dialog
      .getByRole("button", { name: "Atualizar catálogo da loja" })
      .click();
    await expect(dialog).toContainText(
      "Consulta do catálogo concluída · 2 anúncios consultados",
    );
    await expect(
      dialog.getByRole("button", { name: "Atualizar catálogo da loja" }),
    ).toBeEnabled();
    expect(calls).toBe(3);
  } finally {
    releases.forEach((release) => release());
  }
});
test("all-store overview cannot sync and selecting a shop only updates that shop", async ({
  page,
  request,
}) => {
  const { title } = await seed(request);
  const calls: string[] = [];
  await page.route("**/api/catalog/refresh?*", async (route) => {
    calls.push(new URL(route.request().url()).searchParams.get("store")!);
    await route.fulfill({
      json: {
        partial: false,
        results: [
          {
            storeId: "juntos-com",
            status: "confirmed",
            processed: 2,
            has_more: false,
          },
        ],
      },
    });
  });
  await page.goto(`/anuncios?store=all&q=${encodeURIComponent(title)}`);
  await expect(
    page.getByRole("button", {
      name: "Atualizar anúncios da loja",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Sincronização da tela com o ML",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Sincronização da tela com o ML",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Atualizar catálogo da loja" }),
  ).toBeDisabled();
  await expect(dialog).toContainText("Selecione uma loja no filtro");
  expect(calls).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByLabel("Loja global").selectOption("juntos-com");
  await page
    .getByRole("button", {
      name: "Sincronização da tela com o ML",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Atualizar catálogo da loja" })
    .click();
  await expect(dialog).toContainText("Consulta do catálogo concluída");
  expect(calls).toEqual(["juntos-com"]);
});
test("indicator requests show loading and update cached seven-day data without losing filters", async ({
  page,
  request,
}) => {
  const { title, rows } = await seed(request);
  const target =
    "/anuncios?store=juntos-com&q=" +
    encodeURIComponent(title) +
    "&pageSize=50";
  let release!: () => void;
  await page.route("**/api/catalog/indicators*", async (route) => {
    await new Promise<void>((resolve) => (release = resolve));
    for (const row of rows)
      await db()
        .collection("ml_metrics_7d")
        .doc(row.id)
        .set({ visits: 123 }, { merge: true });
    await route.fulfill({
      json: {
        results: rows.map((row) => ({
          id: row.id,
          metrics: true,
          fees: true,
          errors: [],
        })),
      },
    });
  });
  await page.goto(target);
  await page
    .getByRole("button", { name: "Atualizar anúncios da loja", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Operação em andamento" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Atualizar anúncios da loja",
      exact: true,
    }),
  ).toBeDisabled();
  await expect.poll(() => typeof release).toBe("function");
  release();
  await expect(page.locator(".listing-metrics").first()).toContainText("123");
  expect(new URL(page.url()).search).toBe(
    new URL(target, "http://localhost:3100").search,
  );
});
test("media gallery previews images/videos, prepares drafts and preserves official pictures after removal", async ({
  page,
  context,
  request,
}) => {
  const { rows } = await seed(request),
    row = rows[0];
  await context.route("https://http2.mlstatic.com/datamat-e2e-**", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route("**/api/media-storage/status*", (route) =>
    route.fulfill({ json: { status: "ready" } }),
  );
  await page.route("**/api/listing-media/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    if (route.request().method() === "DELETE") {
      await db()
        .collection("listing_media")
        .doc(id)
        .set({ status: "deleted" }, { merge: true });
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ contentType: "image/png", body: png });
  });
  await page.route(`**/api/offers/${row.id}/media`, async (route) => {
    const id = key(row.id, "browser-upload");
    await db().collection("listing_media").doc(id).set({
      id,
      organization_id: "datamat",
      store_id: "juntos-com",
      offer_id: row.id,
      status: "ready",
      type: "image/png",
      kind: "image",
      name: "nova-foto.png",
      bytes: png.length,
      created_at: new Date().toISOString(),
    });
    await route.fulfill({
      json: {
        id,
        name: "nova-foto.png",
        kind: "image",
        bytes: png.length,
        status: "draft",
        url: `/api/listing-media/${id}`,
      },
    });
  });
  await page.goto(`/anuncios/${row.id}?store=juntos-com&tab=media`);
  await expect(
    page.getByRole("heading", {
      name: "Fotos e vídeos publicados",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Foto principal/ }).click();
  await expect(page.getByRole("dialog").locator(".media-image")).toHaveClass(
    /ready/,
  );
  await page.getByRole("dialog").getByLabel("Fechar", { exact: true }).click();
  await page.getByRole("button", { name: /Vídeo publicado/ }).click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/aB123456789",
  );
  await page.getByRole("dialog").getByLabel("Fechar", { exact: true }).click();
  await expect(
    page.getByLabel("Adicionar fotos e vídeos em rascunho"),
  ).toBeEnabled();
  await page.getByLabel("Adicionar fotos e vídeos em rascunho").setInputFiles({
    name: "nova-foto.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator(".draft-gallery")).toContainText("nova-foto.png");
  await page.reload();
  await expect(page.locator(".draft-gallery")).toContainText("nova-foto.png");
  await page
    .getByRole("button", {
      name: "Remover rascunho nova-foto.png",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remover rascunho", exact: true })
    .click();
  await expect(page.locator(".draft-gallery .media-draft")).toHaveCount(0);
  expect(
    (await db().collection("offers").doc(row.id).get()).data()!.ml.pictures,
  ).toHaveLength(2);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/media-gallery-mobile.png",
    fullPage: true,
  });
});
test("ML authorization succeeds through a separate window, preserves the page and renders green connected state", async ({
  page,
  context,
}) => {
  await db()
    .collection("connections")
    .doc(connectionId)
    .set({
      ...previous,
      status: "unauthorized",
      external_account: null,
      auth_version: 998,
    });
  let release!: () => void;
  await context.route(
    "https://auth.mercadolivre.com.br/authorization?**",
    async (route) => {
      const state = new URL(route.request().url()).searchParams.get("state")!;
      await new Promise<void>((resolve) => (release = resolve));
      const target =
        "http://localhost:3100/api/mercadolivre/callback?" +
        new URLSearchParams({ state, code: "synthetic-test-code" });
      await route.fulfill({
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(target)})</script>`,
      });
    },
  );
  await context.route("**/api/mercadolivre/callback?**", async (route) => {
    const state = new URL(route.request().url()).searchParams.get("state")!;
    const pending = (
      await db()
        .collection("ml_oauth_states")
        .doc(createHash("sha256").update(state).digest("hex"))
        .get()
    ).data()!;
    await db().collection("connections").doc(connectionId).set(
      {
        status: "connected",
        external_account: "111",
        nickname: "Loja de teste",
        auth_version: 999,
      },
      { merge: true },
    );
    const response = oauthPopupResponse(
      new URL(
        "http://localhost:3100/configuracoes?store=juntos-com&mlAuthorization=connected",
      ),
      pending.popup_channel,
    );
    await route.fulfill({
      body: await response.text(),
      headers: Object.fromEntries(response.headers),
    });
  });
  const target =
    "/configuracoes?store=juntos-com&configTab=integrations&q=consulta&page=2";
  await page.goto(target);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  const marker = randomUUID();
  await page.evaluate((value) => {
    (window as any).__authorizationMarker = value;
  }, marker);
  await page
    .getByRole("button", { name: "Conectar conta ML", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Aguardando autorização…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("progressbar", { name: "Operação em andamento" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancelar autorização", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => typeof release).toBe("function");
  release();
  await expect(
    page.locator(".integration-card.is-connected .badge.connected"),
  ).toHaveText("Conectado");
  await expect(page.locator(".badge.connected")).toHaveCSS(
    "color",
    "rgb(131, 201, 163)",
  );
  expect(await page.evaluate(() => (window as any).__authorizationMarker)).toBe(
    marker,
  );
  expect(new URL(page.url()).search).toBe(
    new URL(target, "http://localhost:3100").search,
  );
  await page
    .getByRole("button", { name: "Configurar integração", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator("code")).toHaveText(
    "offline_access",
  );
});
test("media API parses multipart files, rejects invalid and oversized content, and keeps unavailable storage honest", async ({
  request,
}) => {
  const response = await request.post("/api/offers", {
    headers: origin,
    data: {
      storeId: "juntos-com",
      name: "Multipart " + randomUUID(),
      title: "Multipart " + randomUUID(),
      price: "100",
      status: "draft",
      type: "unit",
    },
  });
  expect(response.ok()).toBe(true);
  const offer = await response.json();
  const upload = (buffer: Buffer, mimeType: string) =>
    request.post(`/api/offers/${offer.id}/media`, {
      headers: origin,
      multipart: {
        file: { name: "foto.png", mimeType, buffer },
        requestId: randomUUID(),
        offerVersion: String(offer.version),
      },
    });
  const invalid = await upload(
    Buffer.from("<svg onload='evil()'/>"),
    "image/svg+xml",
  );
  expect(invalid.status()).toBe(422);
  expect((await invalid.json()).error).toContain("JPG");
  const large = await upload(Buffer.alloc(3 * 1024 * 1024 + 1), "image/png");
  expect(large.status()).toBe(413);
  const valid = await upload(png, "image/png");
  expect(valid.status()).toBe(503);
  expect((await valid.json()).error).toContain("Google Drive");
  const metadata = await db()
    .collection("listing_media")
    .where("offer_id", "==", offer.id)
    .get();
  expect(metadata.docs.map((doc) => doc.data().status)).toEqual(["failed"]);
  expect(
    (await (await request.get(`/api/offers/${offer.id}`)).json()).draftMedia,
  ).toEqual([]);
});

test("primary update finishes every catalogue page for the selected shop before indicators and reconciles the header", async ({
  page,
  request,
}) => {
  const { title, rows } = await seed(request);
  await db()
    .collection("connections")
    .doc(connectionId)
    .set({ has_more: true, last_catalog_completed_at: null }, { merge: true });
  const calls: string[] = [];
  let pages = 0;
  await page.route("**/api/catalog/refresh?*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("store")).toBe(
      "juntos-com",
    );
    pages++;
    calls.push("catalog");
    const partial = pages === 1;
    await db()
      .collection("connections")
      .doc(connectionId)
      .set(
        {
          has_more: partial,
          last_catalog_completed_at: partial ? null : new Date().toISOString(),
        },
        { merge: true },
      );
    await route.fulfill({
      json: {
        partial,
        results: [
          {
            storeId: "juntos-com",
            status: "confirmed",
            processed: partial ? 2 : 0,
            has_more: partial,
          },
        ],
      },
    });
  });
  await page.route("**/api/catalog/indicators*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("store")).toBe(
      "juntos-com",
    );
    calls.push("indicators");
    await route.fulfill({
      json: {
        results: rows.map((o) => ({
          id: o.id,
          metrics: true,
          fees: true,
          errors: [],
        })),
      },
    });
  });
  await page.goto(`/anuncios?store=juntos-com&q=${encodeURIComponent(title)}`);
  await expect(page.locator(".topbar .today-freshness")).toContainText(
    "Catálogo parcial",
  );
  await page
    .getByRole("button", { name: "Atualizar anúncios da loja", exact: true })
    .click();
  await expect(page.locator(".toast-viewport")).toContainText(
    "Catálogo da loja sincronizado",
  );
  await expect(page.locator(".topbar .today-freshness")).toContainText(
    "Catálogo sincronizado",
  );
  expect(calls).toEqual(["catalog", "catalog", "indicators"]);
  await expect(page.getByLabel("Loja global")).toHaveValue("juntos-com");
});
test("catalogue failure never reports success or consults indicators and preserves the store filter", async ({
  page,
  request,
}) => {
  const { title } = await seed(request);
  let indicatorCalls = 0;
  await page.route("**/api/catalog/refresh?*", (route) =>
    route.fulfill({
      status: 502,
      json: { error: "ML temporariamente indisponível" },
    }),
  );
  await page.route("**/api/catalog/indicators*", async (route) => {
    indicatorCalls++;
    await route.fulfill({ json: { results: [] } });
  });
  await page.goto(`/anuncios?store=juntos-com&q=${encodeURIComponent(title)}`);
  const button = page.getByRole("button", {
    name: "Atualizar anúncios da loja",
    exact: true,
  });
  await button.click();
  await expect(page.locator(".toast-viewport")).toContainText(
    "ML temporariamente indisponível",
  );
  await expect(button).toBeEnabled();
  await expect(page.getByLabel("Loja global")).toHaveValue("juntos-com");
  await expect(page.locator(".listing-update-progress")).toHaveCount(0);
  expect(indicatorCalls).toBe(0);
});
