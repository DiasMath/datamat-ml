import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import {
  campaignSchema,
  campaignIndicators,
  campaignImport,
} from "../src/domain/campaigns";
import {
  listingDiagnostics,
  titleTerms,
  titleChecks,
} from "../src/domain/listing-intelligence";
import {
  saveCampaigns,
  campaigns,
  deleteCampaign,
  campaignTask,
} from "../src/server/campaigns";
import { initializeDatabase, get, put, find, key } from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import {
  encryptSecret,
  safePictureUrl,
  syncListings,
  refreshCompetition,
} from "../src/server/mercadolivre";
import { refreshCatalog } from "../src/server/catalog-refresh";
import { saveOffer, workspace } from "../src/server/services";
import {
  listingCompetition,
  listingOverview,
} from "../src/domain/listing-overview";
import { refreshListingCompetition } from "../src/server/listing-indicators";
import { publicConnection } from "../src/server/mercadolivre";
let actor: Actor;
const connectionId = key("juntos-com", "mercadolivre");
before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  process.env.FIREBASE_PROJECT_ID = "demo-intelligence-" + randomUUID();
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "fake-intelligence-only";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  await initializeDatabase();
  actor = await workspaceActor();
  await put("connections", connectionId, {
    store_id: "juntos-com",
    provider: "mercadolivre",
    status: "connected",
    external_account: "111",
    auth_version: 9,
  });
  await put("ml_tokens", connectionId, {
    auth_version: 9,
    encrypted: encryptSecret({
      access_token: "fake-intelligence-access",
      refresh_token: "fake-intelligence-refresh",
    }),
    expires_at: Date.now() + 3600000,
  });
});
const report = (extra: Record<string, any> = {}) =>
  campaignSchema.parse({
    storeId: "juntos-com",
    campaignKey: randomUUID(),
    name: "Campanha teste",
    from: "2026-09-01",
    to: "2026-09-07",
    status: "active",
    spend: "100",
    attributedRevenue: "500",
    impressions: 1000,
    clicks: 50,
    orders: 10,
    marginBeforeAds: "40",
    targetAcos: "15",
    version: 0,
    ...extra,
  });
const save = (rows: any[], requestId = randomUUID()) =>
  saveCampaigns(actor, { rows, requestId });
test("campaign indicators use decimal ratios and subtract Ads once from pre-Ads contribution", () => {
  const r = campaignIndicators(report());
  assert.equal(r.roas, "5.00");
  assert.equal(r.acos, "20.00");
  assert.equal(r.ctr, "5.00");
  assert.equal(r.cpc, "2.00");
  assert.equal(r.cpo, "10.00");
  assert.equal(r.profit, "100.00");
  assert.equal(r.breakEvenAcos, "40");
  assert.equal(r.insights[0].key, "target");
});
test("unknown campaign fields do not become zero or a positive margin", () => {
  const r = campaignIndicators(
    report({
      attributedRevenue: null,
      impressions: null,
      clicks: null,
      orders: null,
      marginBeforeAds: null,
      targetAcos: null,
    }),
  );
  assert.equal(r.roas, null);
  assert.equal(r.acos, null);
  assert.equal(r.profit, null);
  assert.equal(r.ctr, null);
  assert.equal(r.state, "unknown");
  const zero = campaignIndicators(
    report({ attributedRevenue: "0", orders: 0, clicks: 40 }),
  );
  assert.equal(zero.roas, "0.00");
  assert.equal(zero.acos, null);
  assert.equal(zero.profit, "-100.00");
  assert.equal(zero.state, "loss");
  assert.ok(zero.insights.some((i) => i.key === "no-revenue"));
  assert.equal(
    campaignSchema.safeParse({ ...report(), clicks: 1001 }).success,
    false,
  );
  assert.equal(
    campaignSchema.safeParse({ ...report(), spend: "-1" }).success,
    false,
  );
});
test("campaign spreadsheet mapping preserves decimal comma, zeros, unknowns and versions", () => {
  const rows = campaignImport(
    [
      "campanha",
      "investimento",
      "receita atribuída",
      "impressões",
      "cliques",
      "pedidos",
      "margem antes ads",
      "versão",
    ],
    [["Busca", "1.234,56", "0", "1000", "0", "", "25", "2"]],
    { storeId: "juntos-com", from: "2026-09-01", to: "2026-09-07" },
  );
  assert.equal(rows[0].spend, "1234.56");
  assert.equal(rows[0].attributedRevenue, "0.00");
  assert.equal(rows[0].orders, null);
  assert.equal(rows[0].clicks, 0);
  assert.equal(rows[0].version, 2);
  assert.throws(
    () =>
      campaignImport(["name", "campanha", "spend"], [["A", "A", "10"]], {
        storeId: "juntos-com",
        from: "2026-09-01",
        to: "2026-09-07",
      }),
    /mesmo campo/,
  );
});
test("campaign saves are atomic, scoped and idempotent without duplicate audit records", async () => {
  const row = report(),
    op = randomUUID();
  await save([row], op);
  await save([row], op);
  const id = key(
    actor.organization_id,
    row.storeId,
    row.campaignKey,
    row.from,
    row.to,
  );
  assert.equal((await get("campaign_reports", id))!.version, 1);
  assert.equal(
    (await find("history", { field: "campaign.report" })).filter(
      (r) => JSON.parse(r.new_value).campaignKey === row.campaignKey,
    ).length,
    1,
  );
  await assert.rejects(
    () => save([{ ...row, name: "Mudou" }], op),
    /reutilizada/,
  );
  const first = report();
  await assert.rejects(
    () => save([first, { ...report(), storeId: "outside" }]),
    /Loja/,
  );
  assert.equal(
    await get(
      "campaign_reports",
      key(
        actor.organization_id,
        first.storeId,
        first.campaignKey,
        first.from,
        first.to,
      ),
    ),
    undefined,
  );
  await assert.rejects(
    () =>
      saveCampaigns(
        { ...actor, role: "viewer" },
        { rows: [report()], requestId: randomUUID() },
      ),
    /consulta/,
  );
});
test("campaign overlapping periods and stale versions never double-count or overwrite reports", async () => {
  const row = report();
  await save([row]);
  await assert.rejects(
    () => save([{ ...row, from: "2026-09-05", to: "2026-09-12" }]),
    /sobrepõem/,
  );
  await assert.rejects(() => save([row]), /alterado/);
  await save([{ ...row, name: "Atualizada", version: 1, spend: "120.00" }]);
  assert.equal(
    (await get(
      "campaign_reports",
      key(
        actor.organization_id,
        row.storeId,
        row.campaignKey,
        row.from,
        row.to,
      ),
    ))!.spend,
    "120.00",
  );
  await save([{ ...row, from: "2026-09-08", to: "2026-09-14" }]);
  const invalid = report();
  await assert.rejects(
    () => save([invalid, { ...invalid, from: "2026-09-02" }]),
    /sobrepõem/,
  );
  assert.equal(
    await get(
      "campaign_reports",
      key(
        actor.organization_id,
        invalid.storeId,
        invalid.campaignKey,
        invalid.from,
        invalid.to,
      ),
    ),
    undefined,
  );
});
test("campaign interval filters exclude intersecting reports without prorating metrics", async () => {
  const r = report({ from: "2026-08-01", to: "2026-08-31" });
  await save([r]);
  const narrow = await campaigns(
    actor,
    new URLSearchParams({
      store: r.storeId,
      from: "2026-08-01",
      to: "2026-08-07",
    }),
  );
  assert.equal(narrow.rows.length, 0);
  assert.equal(narrow.excluded, 1);
  const full = await campaigns(
    actor,
    new URLSearchParams({
      store: r.storeId,
      from: "2026-08-01",
      to: "2026-08-31",
    }),
  );
  assert.equal(full.rows[0].indicators.profit, "100.00");
  await assert.rejects(
    () =>
      campaigns(
        { ...actor, stores: [] },
        new URLSearchParams({ store: r.storeId }),
      ),
    /Loja/,
  );
});
test("campaign review tasks are deduplicated and local deletion keeps an audit trail", async () => {
  const row = report({ spend: "300" });
  await save([row]);
  const id = key(
      actor.organization_id,
      row.storeId,
      row.campaignKey,
      row.from,
      row.to,
    ),
    task = await campaignTask(actor, id);
  assert.equal((await campaignTask(actor, id)).id, task.id);
  await assert.rejects(
    () => deleteCampaign(actor, id, { version: 2, confirmed: true }),
    /alterado/,
  );
  await deleteCampaign(actor, id, { version: 1, confirmed: true });
  assert.equal(await get("campaign_reports", id), undefined);
  assert.ok(await get("tasks", task.id));
  assert.ok((await find("history", { field: "campaign.deleted" })).length);
  await assert.rejects(
    () => deleteCampaign(actor, id, { version: 1, confirmed: true }),
    /não encontrado/,
  );
});
test("title terms normalize accents and count distinct titles rather than repeated words", () => {
  const terms = titleTerms([
    "Câmera câmera IP WiFi",
    "Camera IP 1080p",
    "Kit com suporte",
  ]);
  assert.equal(terms.find((t) => t.term === "camera")?.count, 2);
  assert.equal(terms.find((t) => t.term === "ip")?.count, 2);
  assert.equal(
    terms.find((t) => t.term === "kit"),
    undefined,
  );
  assert.ok(
    titleChecks("Promoção frete grátis").some((s) => s.includes("promocional")),
  );
});
const diagnosisReport: any = {
  complete: true,
  current: {
    products: [
      { storeId: "juntos-com", id: "MLB321", revenue: "200.00", orders: 3 },
    ],
  },
  previous: {
    products: [
      { storeId: "juntos-com", id: "MLB321", revenue: "400.00", orders: 4 },
    ],
  },
  stores: [
    { storeId: "juntos-com", sellerId: "111", authVersion: 9, connected: true },
  ],
};
const own = {
  id: "offer",
  store_id: "juntos-com",
  title: "Produto",
  origin: "import",
  ml_id: "MLB321",
  status: "active",
  ml: {
    sellerId: "111",
    authVersion: 9,
    observedAt: new Date().toISOString(),
    health: 0.8,
    availableQuantity: 1,
  },
  calculation: { margin: "-10.00", marginPercent: "-5.00" },
  quality: [],
};
test("listing diagnostics separates sales decline, profitability and official health", () => {
  const r = listingDiagnostics([own], diagnosisReport)[0];
  assert.equal(r.trend, "down");
  assert.equal(r.delta, "-50.00");
  assert.equal(r.health, "80");
  assert.equal(r.margin, "-5.00");
  assert.equal(r.issues[0].title, "Margem de contribuição negativa");
  const up = listingDiagnostics([own], {
    ...diagnosisReport,
    current: {
      products: [{ ...diagnosisReport.current.products[0], revenue: "800.00" }],
    },
  })[0];
  assert.equal(up.trend, "up");
  assert.equal(up.issues[0].title, "Margem de contribuição negativa");
});
test("listing comparisons suppress partial, low-sample, changed-authority and missing-baseline percentages", () => {
  for (const report of [
    { ...diagnosisReport, complete: false },
    {
      ...diagnosisReport,
      stores: [{ ...diagnosisReport.stores[0], authVersion: 10 }],
    },
    {
      ...diagnosisReport,
      current: { products: [] },
      previous: { products: [] },
    },
    { ...diagnosisReport, previous: { products: [] } },
  ])
    assert.equal(listingDiagnostics([own], report)[0].trend, "unknown");
  const stale = listingDiagnostics(
    [{ ...own, ml: { ...own.ml, observedAt: "2020-01-01" } }],
    diagnosisReport,
  )[0];
  assert.equal(stale.stale, true);
  assert.ok(stale.issues.some((i) => i.title.includes("atualização")));
});
test("marketplace picture URLs reject spoofed hosts, credentials and unsafe protocols", () => {
  assert.equal(
    safePictureUrl("https://http2.mlstatic.com/D_1.jpg"),
    "https://http2.mlstatic.com/D_1.jpg",
  );
  for (const url of [
    "http://http2.mlstatic.com/a",
    "https://mlstatic.com.attacker.test/a",
    "https://user:pass@mlstatic.com/a",
    "javascript:alert(1)",
    "invalid",
  ])
    assert.equal(safePictureUrl(url), null);
});
const item = (id: string, extra: Record<string, any> = {}) => ({
  id,
  seller_id: 111,
  site_id: "MLB",
  title: "Produto integrado",
  category_id: "MLB100",
  currency_id: "BRL",
  price: 100,
  status: "active",
  listing_type_id: "gold_special",
  available_quantity: 5,
  sold_quantity: 10,
  pictures: [
    { id: "photo1", secure_url: "https://http2.mlstatic.com/photo1.jpg" },
  ],
  video_id: "video1",
  health: 0.8,
  attributes: [{ id: "BRAND", name: "Marca", value_name: "Marca real" }],
  shipping: { mode: "me2" },
  variations: [],
  ...extra,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function mocked<T>(
  fn: (url: URL) => Promise<Response> | Response,
  run: () => Promise<T>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.mercadolibre.com");
    assert.ok(!init.method || init.method === "GET");
    return fn(url);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}
let importedId = "";
test("catalogue overview excludes stale, inconsistent, foreign and incompatible results instead of inventing a winning status", () => {
  const clock = Date.UTC(2026, 9, 15, 12);
  const offer = {
    id: "o",
    organization_id: "datamat",
    store_id: "s",
    version: 2,
    title: "Produto",
    price: "100",
    ml_id: "MLB1",
    ml: { catalogListing: true, sellerId: "111", authVersion: 9 },
  };
  const account = {
    store_id: "s",
    provider: "mercadolivre",
    status: "connected",
    external_account: "111",
    auth_version: 9,
  };
  const snapshot = {
    offer_id: "o",
    store_id: "s",
    offer_version: 2,
    seller_id: "111",
    auth_version: 9,
    status: "losing",
    currentPrice: "100",
    priceToWin: "95",
    observed_at: new Date(clock - 60000).toISOString(),
  };
  assert.equal(
    listingCompetition(offer, account, snapshot, clock).status,
    "losing",
  );
  assert.equal(
    listingCompetition(
      offer,
      account,
      { ...snapshot, consistent: false },
      clock,
    ).observedAt,
    snapshot.observed_at,
  );
  const expiredDate = new Date(clock - 16 * 60000).toISOString();
  assert.equal(
    listingCompetition(
      offer,
      account,
      { ...snapshot, observed_at: expiredDate },
      clock,
    ).observedAt,
    expiredDate,
  );
  assert.equal(
    listingCompetition(
      offer,
      account,
      { ...snapshot, organization_id: "foreign" },
      clock,
    ).observedAt,
    null,
  );
  for (const patch of [
    { observed_at: new Date(clock - 16 * 60000).toISOString() },
    { observed_at: new Date(clock + 1000).toISOString() },
    { auth_version: 10 },
    { seller_id: "999" },
    { store_id: "foreign" },
    { organization_id: "foreign" },
    { offer_version: 3 },
    { consistent: false },
    { currentPrice: "101" },
    { status: "unexpected" },
  ]) {
    const result = listingCompetition(
      offer,
      account,
      { ...snapshot, ...patch },
      clock,
    );
    assert.equal(result.available, false);
    assert.equal(result.status, null);
    assert.equal(result.priceToWin, null);
  }
  const global = listingOverview(
    [offer, { ...offer, id: "other" }],
    [{ id: "s", name: "Loja" }],
    [account],
    [snapshot],
    clock,
  );
  assert.equal(global.competition.total, 2);
  assert.equal(global.competition.losing, 1);
  assert.equal(global.competition.winning, 0);
  assert.equal(global.competition.unavailable, 1);
  const partial = publicConnection({
    ...account,
    last_catalog_sync_at: new Date(clock).toISOString(),
    has_more: true,
  });
  assert.equal(partial.last_catalog_completed_at, null);
  const complete = publicConnection({
    ...account,
    last_catalog_sync_at: new Date(clock).toISOString(),
    has_more: false,
  });
  assert.equal(
    complete.last_catalog_completed_at,
    new Date(clock).toISOString(),
  );
});
test("media-only and stock changes update the official snapshot, version and audit while preserving costs", async () => {
  const id = "MLB987001",
    made = await saveOffer(actor, {
      storeId: "juntos-com",
      name: "Produto local",
      title: "Produto integrado",
      mlId: id,
      type: "unit",
      status: "active",
      price: "100.00",
    });
  importedId = made.id;
  const beforeCosts = await get("costs", made.id);
  let raw = item(id);
  const handler = (url: URL) =>
    url.pathname.endsWith("/description")
      ? json({ plain_text: "Descrição oficial" })
      : url.pathname.includes("/categories/")
        ? json([])
        : json(raw);
  await mocked(handler, () =>
    syncListings(actor, connectionId, {
      requestId: randomUUID(),
      itemIds: [id],
    }),
  );
  const first = (await get("offers", made.id))!;
  await mocked(handler, () =>
    syncListings(actor, connectionId, {
      requestId: randomUUID(),
      itemIds: [id],
    }),
  );
  assert.equal((await get("offers", made.id))!.version, first.version);
  raw = item(id, {
    pictures: [
      { id: "photo2", secure_url: "https://http2.mlstatic.com/photo2.jpg" },
    ],
    video_id: "video2",
    health: 0.7,
    available_quantity: 4,
  });
  await mocked(handler, () =>
    syncListings(actor, connectionId, {
      requestId: randomUUID(),
      itemIds: [id],
    }),
  );
  const next = (await get("offers", made.id))!;
  assert.equal(next.version, first.version + 1);
  assert.equal(next.ml.pictures[0].id, "photo2");
  assert.equal(next.ml.videoId, "video2");
  assert.equal(next.ml.availableQuantity, 4);
  const listing = await workspace(
    actor,
    new URLSearchParams({ store: "juntos-com" }),
  );
  assert.equal(
    (listing.connections.find((c: any) => c.id === connectionId) as any)
      ?.auth_version,
    9,
  );
  const listed = listing.offerChoices.find((r: any) => r.id === made.id)!;
  assert.equal(listed.ml.pictures, undefined);
  assert.equal(listed.ml.photoCount, 1);
  assert.equal(listed.ml.thumbnailUrl, "https://http2.mlstatic.com/photo2.jpg");
  assert.deepEqual(await get("costs", made.id), beforeCosts);
  const audit = (await find("history", { offer_id: made.id }))
    .filter((h) => h.field === "ml.observed_update")
    .find((h) => JSON.parse(h.new_value).mlContent.videoId === "video2")!;
  assert.equal(JSON.parse(audit.old_value).mlContent.videoId, "video1");
});
test("catalogue competition reads the official status and indicative price without any price write", async () => {
  const offer = (await get("offers", importedId))!;
  const result = await mocked(
    (url) =>
      url.pathname.endsWith("/price_to_win")
        ? json({
            item_id: offer.ml_id,
            status: "losing",
            current_price: 100,
            price_to_win: 95,
            consistent: true,
          })
        : json(item(offer.ml_id, { catalog_listing: true })),
    () => refreshCompetition(actor, offer.id),
  );
  assert.equal(result.status, "losing");
  assert.equal(result.priceToWin, "95.00");
  assert.equal((await get("offers", offer.id))!.price, "100.00");
  assert.equal(result.offer_version, offer.version);
});
test("competition rejects foreign sellers, mismatched resources and changed authorization", async () => {
  const o = (await get("offers", importedId))!;
  await assert.rejects(
    () =>
      mocked(
        () => json(item(o.ml_id, { seller_id: 999, catalog_listing: true })),
        () => refreshCompetition(actor, o.id),
      ),
    /outro vendedor/,
  );
  await assert.rejects(
    () =>
      mocked(
        (url) =>
          url.pathname.endsWith("/price_to_win")
            ? json({ item_id: "MLB2", status: "winning", price_to_win: 90 })
            : json(item(o.ml_id, { catalog_listing: true })),
        () => refreshCompetition(actor, o.id),
      ),
    /não corresponde/,
  );
  const saved = await get("ml_competition", o.id);
  await assert.rejects(
    () =>
      mocked(
        async (url) => {
          if (url.pathname.endsWith("/price_to_win")) {
            await put("connections", connectionId, {
              ...(await get("connections", connectionId)),
              auth_version: 10,
            });
            return json({
              item_id: o.ml_id,
              status: "winning",
              price_to_win: 95,
            });
          }
          return json(item(o.ml_id, { catalog_listing: true }));
        },
        () => refreshCompetition(actor, o.id),
      ),
    /contexto mudou/,
  );
  assert.deepEqual(await get("ml_competition", o.id), saved);
  await put("connections", connectionId, {
    ...(await get("connections", connectionId)),
    auth_version: 9,
  });
  await assert.rejects(
    () => refreshCompetition({ ...actor, role: "viewer" }, o.id),
    /consulta/,
  );
});
test("catalogue refresh validates role, organization, store and authorization before provider calls", async () => {
  await assert.rejects(
    () =>
      refreshCatalog({ ...actor, role: "viewer" }, new URLSearchParams(), {}),
    /administrador/,
  );
  await assert.rejects(
    () => refreshCatalog(actor, new URLSearchParams({ store: "outside" }), {}),
    /Loja/,
  );
  await assert.rejects(
    () =>
      refreshCatalog(actor, new URLSearchParams({ store: "juntos-data" }), {
        offerId: importedId,
      }),
    /divergente/,
  );
  const o = (await get("offers", importedId))!;
  await put("offers", o.id, { ...o, ml: { ...o.ml, authVersion: 10 } });
  await assert.rejects(
    () => refreshCatalog(actor, new URLSearchParams(), { offerId: o.id }),
    /autorização mudou/,
  );
  await put("offers", o.id, o);
});
test("catalogue continuation skips completed stores and rejects skips outside the authorized scope", async () => {
  const otherId = key("juntos-data", "mercadolivre");
  const previous = await get("connections", otherId);
  await put("connections", otherId, {
    ...previous,
    store_id: "juntos-data",
    provider: "mercadolivre",
    status: "connected",
    external_account: "222",
    auth_version: 9,
    sync_until: 0,
  });
  await put("ml_tokens", otherId, {
    auth_version: 9,
    encrypted: encryptSecret({
      access_token: "fake-other",
      refresh_token: "fake-refresh",
    }),
    expires_at: Date.now() + 3600000,
  });
  try {
    const paths: string[] = [];
    const result = await mocked(
      (url) => {
        paths.push(url.pathname);
        assert.equal(url.pathname, "/users/222/items/search");
        return json({ results: [], paging: { total: 0 } });
      },
      () =>
        refreshCatalog(actor, new URLSearchParams(), {
          completedStoreIds: ["juntos-com"],
        }),
    );
    assert.deepEqual(paths, ["/users/222/items/search"]);
    assert.equal(result.partial, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].storeId, "juntos-data");
    await assert.rejects(
      () =>
        refreshCatalog(actor, new URLSearchParams(), {
          completedStoreIds: ["outside"],
        }),
      /Loja/,
    );
    await assert.rejects(
      () =>
        refreshCatalog(actor, new URLSearchParams({ store: "juntos-com" }), {
          completedStoreIds: ["juntos-data"],
        }),
      /fora do filtro/,
    );
  } finally {
    await put(
      "connections",
      otherId,
      previous || {
        store_id: "juntos-data",
        provider: "mercadolivre",
        status: "unconfigured",
      },
    );
  }
});
test("batch competition validates the complete scope before requests, isolates denied resources and keeps the overview independent of listing filters", async () => {
  const offers: Record<string, any>[] = [];
  for (let i = 0; i < 2; i++) {
    const row = await saveOffer(actor, {
      storeId: "juntos-com",
      name: "Competição em lote " + randomUUID(),
      title: "Competição em lote " + i + randomUUID(),
      mlId: "MLB" + (987100 + i),
      type: "unit",
      status: "active",
      price: "100",
    });
    const own: Record<string, any> = {
      ...row,
      ml: {
        catalogListing: true,
        sellerId: "111",
        authVersion: 9,
        currencyId: "BRL",
      },
    };
    await put("offers", own.id, own);
    offers.push(own);
  }
  await assert.rejects(
    () =>
      refreshListingCompetition(
        { ...actor, role: "viewer" },
        { ids: [offers[0].id] },
      ),
    /consulta/,
  );
  await assert.rejects(() =>
    refreshListingCompetition(actor, { ids: Array(6).fill(offers[0].id) }),
  );
  const foreign: Record<string, any> = {
    ...offers[1],
    organization_id: "foreign",
  };
  await put("offers", foreign.id, foreign);
  await mocked(
    () => {
      throw new Error("No provider call before full validation");
    },
    async () => {
      await assert.rejects(
        () =>
          refreshListingCompetition(actor, { ids: offers.map((o) => o.id) }),
        /não encontrado/,
      );
    },
  );
  await put("offers", offers[1].id, offers[1]);
  const result = await mocked(
    (url) => {
      const id = url.pathname.split("/")[2];
      if (url.pathname.endsWith("/price_to_win"))
        return id === offers[0].ml_id
          ? json({
              item_id: id,
              status: "losing",
              current_price: 100,
              price_to_win: 95,
              consistent: true,
            })
          : json({ message: "unavailable" }, 403);
      return json(item(id, { catalog_listing: true }));
    },
    () => refreshListingCompetition(actor, { ids: offers.map((o) => o.id) }),
  );
  assert.equal(result.results[0].updated, true);
  assert.equal(result.results[1].updated, false);
  assert.equal((await get("offers", offers[0].id))!.price, "100");
  const catalogue = await workspace(
    actor,
    new URLSearchParams({ store: "juntos-com", q: offers[0].title }),
  );
  assert.equal(catalogue.offers.length, 1);
  assert.ok(
    catalogue.listingOverview.competition.rows.some(
      (r) => r.id === offers[1].id,
    ),
  );
  assert.equal(
    catalogue.listingOverview.competition.rows.find(
      (r) => r.id === offers[0].id,
    )!.status,
    "losing",
  );
  assert.equal(
    catalogue.listingOverview.competition.rows.find(
      (r) => r.id === offers[1].id,
    )!.status,
    null,
  );
});
