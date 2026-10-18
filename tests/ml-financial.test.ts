import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import {
  initializeDatabase,
  get,
  put,
  key,
  find,
  type Row,
} from "../src/server/db";
import { workspaceActor, type Actor } from "../src/server/access";
import {
  saveOffer,
  saveCosts,
  saveParameters,
  offerDetail,
  workspace,
  simulate,
  insights,
  createProposal,
  decideProposal,
} from "../src/server/services";
import { extensionOffer } from "../src/server/extension";
import { applyApprovedPrice } from "../src/server/ml-price-application";
import {
  encryptSecret,
  quoteTariff,
  withMlReadBatch,
  withSellerData,
} from "../src/server/mercadolivre";
import { refreshListingIndicators } from "../src/server/listing-indicators";
import { refreshFinancialCosts } from "../src/server/ml-financial-sync";
import {
  automaticMlCosts,
  effectiveMlCosts,
  financialContext,
  attachFinancial,
  normalizeShipping,
  normalizeSalePrice,
  normalizePromotions,
} from "../src/domain/ml-financial";
import { emptyCosts, type Costs } from "../src/domain/finance";
import { listingFinancialStatus } from "../src/domain/listing-table";
import { todayReport } from "../src/server/today";
let actor: Actor;
const storeId = "juntos-com",
  connectionId = key(storeId, "mercadolivre");
const ml = {
  sellerId: "111",
  authVersion: 1,
  categoryId: "MLB10",
  listingTypeId: "gold_special",
  currencyId: "BRL",
  shippingMode: "me2",
  logisticType: "drop_off",
  freeShipping: true,
};
const rawCosts: Costs = {
  ...emptyCosts(),
  goods: "30",
  packaging: "1",
  advertising: "0",
  other: "0",
  taxRate: "0",
  taxBase: "price",
  managementRate: "0",
  managementBase: "price",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const offer = (id = "test") => ({
  id,
  store_id: storeId,
  ml_id: "MLB999",
  price: "100",
  ml,
});
const snapshot = (o: Row) => ({
  organization_id: "datamat",
  offer_id: o.id,
  store_id: storeId,
  price: o.price,
  seller_id: "111",
  auth_version: 1,
  context: financialContext(o),
  mlPercent: "12",
  mlFixed: "2",
  shipping: { amount: "8.00" },
  expires_at: Date.now() + 60000,
});
before(async () => {
  process.env.FIREBASE_PROJECT_ID = "demo-financial-" + randomUUID();
  process.env.APP_URL = "http://localhost:3000";
  process.env.ML_CLIENT_ID = "123456";
  process.env.ML_CLIENT_SECRET = "test-only";
  process.env.ML_REDIRECT_URI =
    "http://localhost:3000/api/mercadolivre/callback";
  process.env.ML_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  await initializeDatabase();
  actor = await workspaceActor();
  await saveParameters(actor, storeId, {
    minMargin: "10",
    desiredMargin: "20",
    taxRate: "0",
    taxBase: "price",
    managementRate: "0",
    managementBase: "price",
    reviewDays: 30,
  });
  await put("connections", connectionId, {
    store_id: storeId,
    provider: "mercadolivre",
    status: "connected",
    external_account: "111",
    auth_version: 1,
  });
  await put("ml_tokens", connectionId, {
    auth_version: 1,
    encrypted: encryptSecret({
      access_token: "test-access",
      refresh_token: "test-refresh",
    }),
    expires_at: Date.now() + 3600000,
  });
});
test("Firestore-safe package records retain existing financial quotes but changed dimensions invalidate them", () => {
  const old = {
    ...offer(),
    ml: {
      ...ml,
      financialAttributes: [
        ["SELLER_PACKAGE_HEIGHT", "10 cm"],
        ["SELLER_PACKAGE_WEIGHT", "500 g"],
      ],
    },
  };
  const saved = snapshot(old);
  const current = {
    ...old,
    ml: {
      ...ml,
      financialAttributes: [
        { id: "SELLER_PACKAGE_HEIGHT", value: "10 cm" },
        { id: "SELLER_PACKAGE_WEIGHT", value: "500 g" },
      ],
    },
    mlFinancial: saved,
  };
  assert.equal(financialContext(current), saved.context);
  assert.equal(automaticMlCosts(current).shipping, "8.00");
  current.ml.financialAttributes[0].value = "20 cm";
  assert.deepEqual(automaticMlCosts(current), {});
});
test("automatic ML costs preserve manual zero, missing values, context and authorization boundaries", () => {
  const o = offer(),
    f = snapshot(o),
    enriched = { ...o, mlFinancial: f };
  assert.deepEqual(effectiveMlCosts(emptyCosts(), enriched), {
    ...emptyCosts(),
    mlPercent: "12",
    mlFixed: "2",
    shipping: "8.00",
  });
  assert.equal(
    effectiveMlCosts({ ...emptyCosts(), shipping: "0" }, enriched).shipping,
    "0",
  );
  assert.deepEqual(automaticMlCosts(enriched, Date.now() + 120000), {});
  assert.deepEqual(automaticMlCosts(enriched, Date.now(), "150"), {});
  assert.deepEqual(automaticMlCosts({ ...enriched, price: "101" }), {});
  assert.deepEqual(
    automaticMlCosts({ ...enriched, ml: { ...ml, authVersion: 2 } }),
    {},
  );
  assert.equal(
    attachFinancial(
      o,
      f,
      { status: "connected", external_account: "111", auth_version: 1 },
      "foreign",
    ).mlFinancial,
    null,
  );
  assert.equal(
    attachFinancial(
      o,
      f,
      { status: "unauthorized", external_account: "111", auth_version: 1 },
      "datamat",
    ).mlFinancial,
    null,
  );
});
test("listing costs distinguish automatic, mixed, missing and expired sources without turning unknown freight into zero", () => {
  const o = offer(),
    enriched = { ...o, mlFinancial: snapshot(o) };
  const summarize = (raw = rawCosts, value: Row = enriched) =>
    listingFinancialStatus(
      value,
      raw,
      effectiveMlCosts(raw, value),
      ["Mercadoria (oferta inteira)", "Frete da loja"],
      null,
    );
  const automatic = summarize();
  assert.equal(automatic.tariff?.amount, "14.00");
  assert.equal(automatic.tariff?.source, "ml");
  assert.equal(automatic.shipping?.source, "ml");
  assert.equal(automatic.settlement, "78.00");
  assert.deepEqual(automatic.ownPending, ["Mercadoria (oferta inteira)"]);
  const mixed = summarize({ ...rawCosts, mlPercent: "0", shipping: "0" });
  assert.equal(mixed.tariff?.source, "mixed");
  assert.equal(mixed.tariff?.amount, "2.00");
  assert.equal(mixed.shipping?.source, "manual");
  assert.equal(mixed.settlement, "98.00");
  const buyerPaid = summarize(rawCosts, {
    ...enriched,
    mlFinancial: { ...snapshot(o), shipping: { amount: null } },
  });
  assert.equal(buyerPaid.tariff?.amount, "14.00");
  assert.equal(buyerPaid.shipping, null);
  assert.equal(buyerPaid.settlement, null);
  const expired = summarize(rawCosts, {
    ...enriched,
    mlFinancial: { ...snapshot(o), expires_at: 0 },
  });
  assert.equal(expired.tariff, null);
  assert.equal(expired.shipping, null);
  assert.equal(expired.settlement, null);
});
test("shipping uses the API quote without subtracting a discount twice and never infers buyer-paid shipping as zero", () => {
  const data = {
    coverage: {
      all_country: {
        list_cost: 8,
        currency_id: "BRL",
        discount: { rate: 0.5, promoted_amount: 8 },
      },
    },
  };
  assert.equal(normalizeShipping(data, true).amount, "8.00");
  assert.equal(normalizeShipping(data, false).amount, null);
  assert.equal(
    normalizeShipping(
      { coverage: { all_country: { list_cost: 0, currency_id: "BRL" } } },
      true,
    ).amount,
    "0.00",
  );
  assert.throws(() =>
    normalizeShipping(
      { coverage: { all_country: { list_cost: null, currency_id: "BRL" } } },
      true,
    ),
  );
  assert.throws(() =>
    normalizeShipping(
      { coverage: { all_country: { list_cost: 8, currency_id: "ARS" } } },
      true,
    ),
  );
});
test("promotional metadata distinguishes active and eligible campaigns without inventing a monetary subsidy", () => {
  assert.equal(
    normalizeSalePrice({
      amount: 80,
      regular_amount: 100,
      currency_id: "BRL",
      metadata: { promotion_id: "P1" },
    }).regularAmount,
    "100.00",
  );
  assert.equal(
    normalizePromotions([
      { id: "P1", type: "DEAL", status: "candidate", meli_percentage: 10 },
    ])[0].status,
    "candidate",
  );
  assert.throws(() => normalizeSalePrice({ amount: 80, currency_id: "USD" }));
});
async function ownOffer() {
  const o = await saveOffer(actor, {
    storeId,
    name: "Custos ML " + randomUUID(),
    title: "Anúncio de custos ML",
    type: "unit",
    price: "100",
    status: "paused",
  });
  await saveCosts(actor, o.id, rawCosts);
  const raw = (await get("offers", o.id))!;
  await put("offers", o.id, {
    ...raw,
    ml_id:
      "MLB" + String(Date.now()) + String(Math.floor(Math.random() * 1000)),
    ml: {
      ...ml,
      observedAt: new Date().toISOString(),
      photoCount: 1,
      availableQuantity: 2,
    },
  });
  return (await get("offers", o.id))!;
}
function handler(
  o: Row,
  {
    shipping = 8,
    fee = 12,
    promo = false,
    shippingFailure = false,
  }: {
    shipping?: number;
    fee?: number;
    promo?: boolean;
    shippingFailure?: boolean;
  } = {},
) {
  return (url: URL) => {
    if (url.pathname === "/items/" + o.ml_id)
      return json({
        id: o.ml_id,
        seller_id: 111,
        site_id: "MLB",
        title: o.title,
        category_id: "MLB10",
        currency_id: "BRL",
        price: Number(o.price),
        status: "paused",
        listing_type_id: "gold_special",
        available_quantity: 2,
        sold_quantity: 0,
        pictures: [],
        attributes: [],
        shipping: {
          mode: "me2",
          logistic_type: "drop_off",
          free_shipping: true,
        },
        variations: [],
      });
    if (url.pathname === "/sites/MLB/listing_prices") {
      const price = Number(url.searchParams.get("price"));
      return json({
        listing_type_id: "gold_special",
        sale_fee_amount: (price * fee) / 100 + 2,
        sale_fee_details: { percentage_fee: fee, fixed_fee: 2 },
      });
    }
    if (url.pathname === "/users/111/shipping_options/free") {
      assert.equal(url.searchParams.get("item_id"), o.ml_id);
      assert.ok(url.searchParams.get("item_price"));
      return shippingFailure
        ? json({ error: "forbidden" }, 403)
        : json({
            coverage: {
              all_country: { list_cost: shipping, currency_id: "BRL" },
            },
          });
    }
    if (url.pathname.endsWith("/sale_price"))
      return json({
        amount: promo ? 80 : 100,
        regular_amount: promo ? 100 : null,
        currency_id: "BRL",
        metadata: promo ? { promotion_id: "P1" } : {},
      });
    if (url.pathname.startsWith("/seller-promotions/items/"))
      return json(
        promo
          ? [
              {
                id: "P1",
                type: "DEAL",
                status: "started",
                meli_percentage: 10,
                seller_percentage: 10,
              },
            ]
          : [],
      );
    throw new Error("Unexpected test endpoint: " + url.pathname);
  };
}
async function mocked<T>(
  fn: (url: URL) => Response | Promise<Response>,
  work: () => Promise<T>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const u = new URL(String(input));
    assert.equal(u.origin, "https://api.mercadolibre.com");
    assert.equal(init.redirect, "error");
    return fn(u);
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}
test("background financial sync persists separate sources, updates all summaries, caches and preserves operator costs", async () => {
  const o = await ownOffer(),
    beforeCosts = (await get("costs", o.id))!;
  const result = await mocked(handler(o), () =>
    refreshFinancialCosts(actor, storeId, Date.now() + 55000, [o.id], true),
  );
  assert.equal(result.updated, 1);
  const saved = (await get("ml_financials", o.id))!;
  assert.equal(saved.mlPercent, "12");
  assert.equal(saved.shipping.amount, "8.00");
  assert.equal(saved.promotions.active, false);
  assert.equal((await get("costs", o.id))!.data_json, beforeCosts.data_json);
  assert.equal((await get("costs", o.id))!.updated_at, beforeCosts.updated_at);
  assert.equal((await get("offers", o.id))!.version, o.version + 1);
  const detail = await offerDetail(actor, o.id);
  assert.equal(detail.costs.mlPercent, null);
  assert.equal(detail.calculation.margin, "47.00");
  assert.equal((await extensionOffer(actor, o.id)).costs.shipping, "8.00");
  assert.ok(
    !(await insights(actor, o.id)).items.some((text: string) =>
      /Tarifa percentual ML|Frete da loja/.test(text),
    ),
  );

  const home = await todayReport(
    actor,
    new URLSearchParams({ store: storeId }),
  );
  assert.ok(home.portfolio.financiallyReady >= 1);
  await put("ml_current_quotes", o.id, {
    ...(await get("ml_current_quotes", o.id))!,
    expires_at: Date.now() - 1,
  });
  const catalogue = await workspace(
    actor,
    new URLSearchParams({ store: storeId }),
  );
  assert.equal(
    catalogue.offers.find((r: Row) => r.id === o.id)!.calculation.margin,
    "47.00",
  );
  assert.equal(
    catalogue.offers.find((r: Row) => r.id === o.id)!.settlementEstimate.amount,
    "78.00",
  );
  await mocked(
    () => {
      throw new Error("cached snapshots must not make network calls");
    },
    async () =>
      assert.equal(
        (
          await refreshFinancialCosts(actor, storeId, Date.now() + 55000, [
            o.id,
          ])
        ).updated,
        0,
      ),
  );
  assert.ok(
    (await find("history", { offer_id: o.id })).some(
      (r) => r.field === "ml_costs",
    ),
  );
  const version = (await get("offers", o.id))!.version;
  await put("ml_financials", o.id, {
    ...(await get("ml_financials", o.id))!,
    expires_at: Date.now() - 1,
  });
  await mocked(handler((await get("offers", o.id))!), () =>
    refreshFinancialCosts(actor, storeId, Date.now() + 55000, [o.id]),
  );
  assert.equal(
    (await get("offers", o.id))!.version,
    version,
    "renewing unchanged costs must not create edit conflicts",
  );
});
test("shipping denial preserves known fees and requires manual freight instead of inventing zero", async () => {
  const o = await ownOffer();
  await mocked(handler(o, { shippingFailure: true }), () =>
    refreshFinancialCosts(actor, storeId, Date.now() + 55000, [o.id], true),
  );
  const detail = await offerDetail(actor, o.id);
  assert.equal(detail.offer.mlFinancial.shipping, null);
  assert.equal(detail.calculation.margin, null);
  assert.ok(detail.calculation.pending.includes("Frete da loja"));
  assert.equal(detail.offer.mlFinancial.mlPercent, "12");
});
test("quotes reprice shipping, server-side calculations override forged fees and keep campaign subsidies unknown", async () => {
  const o = await ownOffer();
  const quote = await mocked(handler(o, { shipping: 15, promo: true }), () =>
    quoteTariff(actor, o.id, { price: "150", offerVersion: o.version }),
  );
  assert.ok(quote.shipping);
  assert.equal(quote.shipping.amount, "15.00");
  assert.equal(quote.promotions.active, true);
  assert.equal(quote.promotions.subsidyAmount, null);
  const result = await simulate(actor, o.id, {
    mode: "price",
    price: "150",
    mlQuoteId: quote.id,
    mlPercent: "0",
    mlFixed: "0",
    conditionsVerified: true,
  });
  assert.equal(result.proposed.breakdown.mlPercent, "18.00");
  assert.equal(result.proposed.breakdown.shipping, "15.00");
  assert.equal(result.proposed.margin, "84.00");
  assert.equal(result.input.mlContribution, "0");
  assert.equal(result.mlShippingApplied, true);
  const manual = await simulate(actor, o.id, {
    mode: "price",
    price: "150",
    mlQuoteId: quote.id,
    shipping: "0",
    conditionsVerified: true,
  });
  assert.equal(manual.proposed.breakdown.shipping, "0.00");
  assert.equal(manual.mlShippingApplied, false);
  const forged = await simulate(actor, o.id, {
    mode: "price",
    price: "150",
    mlQuoteId: quote.id,
    shipping: "999",
    mlShippingMode: "automatic",
    conditionsVerified: true,
  });
  assert.equal(forged.input.shipping, "15.00");
  assert.equal(forged.mlShippingApplied, true);
  await assert.rejects(
    simulate(actor, o.id, {
      mode: "price",
      price: "150",
      mlShippingMode: "automatic",
      shipping: "0",
    }),
    /Consulte o ML/,
  );
});
test("financial sync rejects foreign stores and viewer roles without querying the seller", async () => {
  await assert.rejects(
    refreshFinancialCosts({ ...actor, role: "viewer" }, storeId),
    /permissão|Permissão/,
  );
  await assert.rejects(refreshFinancialCosts(actor, "outside"), /Loja/);
  const o = await ownOffer();
  await put("offers", o.id, { ...o, organization_id: "foreign" });
  await assert.rejects(
    refreshFinancialCosts(actor, storeId, Date.now() + 55000, [o.id], true),
    /Anúncio/,
  );
});

test("concurrent financial workers share a lease and a late response never overwrites edited costs", async () => {
  const o = await ownOffer(),
    normal = handler(o);
  let arrived!: () => void, release!: () => void;
  const requested = new Promise<void>((r) => {
      arrived = r;
    }),
    blocked = new Promise<void>((r) => {
      release = r;
    });
  await mocked(
    async (url) => {
      if (url.pathname === "/sites/MLB/listing_prices") {
        arrived();
        await blocked;
      }
      return normal(url);
    },
    async () => {
      const first = refreshFinancialCosts(
        actor,
        storeId,
        Date.now() + 55000,
        [o.id],
        true,
      );
      await requested;
      assert.deepEqual(
        await refreshFinancialCosts(
          actor,
          storeId,
          Date.now() + 55000,
          [o.id],
          true,
        ),
        { updated: 0, failed: 0, pending: 0 },
      );
      await saveCosts(actor, o.id, { ...rawCosts, goods: "44" });
      release();
      assert.equal((await first).failed, 1);
    },
  );
  assert.equal(JSON.parse((await get("costs", o.id))!.data_json).goods, "44");
  assert.equal((await get("ml_financials", o.id))!.mlPercent, undefined);
  assert.equal(
    (await get("ml_finance_jobs", key(actor.organization_id, storeId)))!.until,
    0,
  );
});
test("failed refresh preserves the last known financial snapshot without extending its freshness", async () => {
  const o = await ownOffer();
  await mocked(handler(o), () =>
    refreshFinancialCosts(actor, storeId, Date.now() + 55000, [o.id], true),
  );
  const previous = (await get("ml_financials", o.id))!,
    current = (await get("offers", o.id))!,
    normal = handler(current);
  await mocked(
    (url) =>
      url.pathname === "/sites/MLB/listing_prices"
        ? json({ error: "server unavailable" }, 503)
        : normal(url),
    async () => {
      assert.equal(
        (
          await refreshFinancialCosts(
            actor,
            storeId,
            Date.now() + 55000,
            [o.id],
            true,
          )
        ).failed,
        1,
      );
    },
  );
  const after = (await get("ml_financials", o.id))!;
  assert.equal(after.expires_at, previous.expires_at);
  assert.equal(after.quoted_at, previous.quoted_at);
  assert.equal(after.shipping.amount, "8.00");
  assert.ok(after.last_error);
  await mocked(
    () => {
      throw new Error("must respect backoff");
    },
    async () =>
      assert.equal(
        (
          await refreshFinancialCosts(actor, storeId, Date.now() + 55000, [
            o.id,
          ])
        ).failed,
        0,
      ),
  );
});

async function approved(o: Row, price = "150", shipping = 8) {
  const quote = await mocked(handler(o, { shipping }), () =>
    quoteTariff(actor, o.id, { price, offerVersion: o.version }),
  );
  const proposal = await createProposal(actor, {
    offerId: o.id,
    offerVersion: o.version,
    requestId: randomUUID(),
    input: {
      mode: "price",
      price,
      mlQuoteId: quote.id,
      conditionsVerified: true,
    },
    reason: "Revisão oficial dos custos",
  });
  await decideProposal(actor, proposal.id, {
    action: "approve",
    requestId: randomUUID(),
    comment: "Conferido",
  });
  return proposal;
}
test("applying a quoted proposal keeps ML costs automatic instead of freezing them into manual fields", async () => {
  const o = await ownOffer(),
    proposal = await approved(o, "100");
  await decideProposal(actor, proposal.id, {
    action: "request",
    requestId: randomUUID(),
    comment: "Aplicar",
  });
  await decideProposal(actor, proposal.id, {
    action: "apply_manual",
    requestId: randomUUID(),
    comment: "Conferência externa",
  });
  const raw = JSON.parse((await get("costs", o.id))!.data_json);
  assert.equal(raw.goods, "30");
  assert.equal(raw.mlPercent, null);
  assert.equal(raw.mlFixed, null);
  assert.equal(raw.shipping, null);
  assert.equal((await offerDetail(actor, o.id)).calculation.margin, "47.00");
  const current = (await get("offers", o.id))!;
  await mocked(handler(current, { fee: 16, shipping: 10 }), () =>
    refreshFinancialCosts(actor, storeId, Date.now() + 55000, [o.id], true),
  );
  assert.equal((await offerDetail(actor, o.id)).calculation.margin, "41.00");
});
test("ML price writes are blocked when automatic freight changes or a campaign becomes active", async () => {
  const o = await ownOffer(),
    proposal = await approved(o);
  await mocked(handler(o, { shipping: 30 }), () =>
    assert.rejects(
      applyApprovedPrice(actor, proposal.id, { confirmed: true }),
      /frete atual difere/,
    ),
  );
  assert.equal((await get("offers", o.id))!.price, "100");
  await mocked(handler(o, { shipping: 8, promo: true }), () =>
    assert.rejects(
      applyApprovedPrice(actor, proposal.id, { confirmed: true }),
      /promoção ativa/,
    ),
  );
  assert.equal((await get("proposals", proposal.id))!.status, "approved");
});

test("automatic snapshots never reuse or expose records belonging to another organization", async () => {
  const o = await ownOffer();
  await put("ml_financials", o.id, {
    ...snapshot(o),
    organization_id: "foreign",
    mlPercent: "99",
    shipping: { amount: "12345.00" },
  });
  assert.equal((await offerDetail(actor, o.id)).offer.mlFinancial, null);
  await mocked(handler(o), () =>
    refreshFinancialCosts(actor, storeId, Date.now() + 55000, [o.id], true),
  );
  assert.equal((await offerDetail(actor, o.id)).calculation.margin, "47.00");
  const history = (await find("history", { offer_id: o.id })).find(
    (r) => r.field === "ml_costs",
  )!;
  assert.equal(JSON.parse(history.old_value).mlPercent, null);
  assert.ok(!history.old_value.includes("12345"));
});

test("ten indicators share item, fee and order reads while retaining per-offer metrics and manual costs", async () => {
  const offers: Row[] = [];
  for (let i = 0; i < 10; i++) offers.push(await ownOffer());
  const byMlId = new Map(offers.map((o) => [o.ml_id, o]));
  const counts = new Map<string, number>();
  const end = new Date().toISOString();
  const start = new Date(Date.now() - 7 * 86400000).toISOString();
  let active = 0,
    peak = 0;
  const result = await mocked(
    async (url) => {
      const route = url.pathname + url.search;
      counts.set(route, (counts.get(route) || 0) + 1);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (url.pathname.endsWith("/visits/time_window"))
        return json({ total_visits: 20, date_from: start, date_to: end });
      if (url.pathname === "/orders/search")
        return json({
          paging: { total: 1 },
          results: [
            {
              id: 100,
              seller: { id: 111 },
              status: "paid",
              date_created: end,
              currency_id: "BRL",
              order_items: offers.map((o, i) => ({
                item: { id: o.ml_id },
                quantity: i + 1,
                unit_price: 100,
              })),
            },
          ],
        });
      if (url.pathname === "/questions/search") return json({ total: 0 });
      const itemId = url.pathname.startsWith("/seller-promotions/items/")
        ? url.pathname.split("/")[3]
        : url.pathname.startsWith("/items/")
          ? url.pathname.split("/")[2]
          : url.searchParams.get("item_id");
      return handler(byMlId.get(itemId!) || offers[0])(url);
    },
    () =>
      refreshListingIndicators(
        actor,
        { ids: offers.map((o) => o.id) },
        storeId,
      ),
  );
  assert.equal(result.results.length, 10);
  assert.ok(
    result.results.every(
      (r) => r.metrics && r.fees && !r.deferred && !r.errors.length,
    ),
  );
  assert.ok(peak > 1, "independent reads should execute concurrently");
  assert.ok(peak <= 10, "provider concurrency must stay bounded");
  assert.equal(
    [...counts]
      .filter(([path]) => path.startsWith("/orders/search"))
      .reduce((n, [, count]) => n + count, 0),
    1,
  );
  assert.equal(
    [...counts]
      .filter(([path]) => path.startsWith("/sites/MLB/listing_prices"))
      .reduce((n, [, count]) => n + count, 0),
    1,
  );
  for (const [i, o] of offers.entries()) {
    assert.equal(counts.get("/items/" + o.ml_id), 1);
    const metrics = (await get("ml_metrics_7d", o.id))!;
    assert.equal(metrics.units, i + 1);
    assert.equal(metrics.grossRevenue, ((i + 1) * 100).toFixed(2));
    assert.equal(JSON.parse((await get("costs", o.id))!.data_json).goods, "30");
    assert.equal((await get("ml_financials", o.id))!.shipping.amount, "8.00");
  }
});
test("indicator scope rejects mixed shops or a mismatched filter before any provider call", async () => {
  const a = await ownOffer(),
    b = await ownOffer();
  await put("offers", b.id, { ...b, store_id: "juntos-data" });
  await mocked(
    () => {
      throw new Error("provider must not be called");
    },
    async () => {
      await assert.rejects(
        () => refreshListingIndicators(actor, { ids: [a.id, b.id] }),
        /única loja/,
      );
      await assert.rejects(
        () => refreshListingIndicators(actor, { ids: [a.id] }, "juntos-data"),
        /loja selecionada/,
      );
      await assert.rejects(
        () => refreshListingIndicators(actor, { ids: [a.id] }, "all"),
        /única loja/,
      );
    },
  );
});
test("shared ML reads expire after each operation and failed reads can be retried within the batch", async () => {
  let calls = 0;
  const read = () =>
    withSellerData(actor, connectionId, (api) => api("/test-shared"));
  await mocked(
    () => json({ read: ++calls }),
    async () => {
      await withMlReadBatch(async () => {
        const [a, b] = await Promise.all([read(), read()]);
        assert.deepEqual(a, b);
        assert.equal(calls, 1);
      });
      assert.deepEqual(await withMlReadBatch(read), { read: 2 });
    },
  );
  calls = 0;
  await mocked(
    () =>
      ++calls === 1 ? json({ error: "forbidden" }, 403) : json({ ok: true }),
    () =>
      withMlReadBatch(async () => {
        await assert.rejects(read);
        assert.deepEqual(await read(), { ok: true });
        assert.equal(calls, 2);
      }),
  );
});
