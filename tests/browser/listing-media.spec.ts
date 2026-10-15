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
test.beforeEach(async ({ request }) => {
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
  await expect(page.locator(".offers-table tbody")).toContainText(
    "Estoque: 4 un.",
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
      name: "Ordenar por: SKU / código ML",
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
  await expect(second).toContainText("Margem: 100%");
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
  await page.route("**/api/catalog/indicators", async (route) => {
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
    .getByRole("button", { name: "Consultar indicadores ML", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Operação em andamento" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Consultar indicadores ML", exact: true }),
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
