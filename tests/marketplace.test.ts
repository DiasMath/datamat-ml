import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTariff,
  listingQuality,
  advertisingIndicators,
  operationalAttention,
} from "../src/domain/marketplace";
test("tariff decomposition is exact, includes zero fixed fees and rejects unknown components", () => {
  const row = {
    listing_type_id: "gold_special",
    sale_fee_amount: 14,
    sale_fee_details: { percentage_fee: 14, fixed_fee: 0 },
  };
  assert.deepEqual(normalizeTariff([row], "gold_special", "100"), {
    mlPercent: "14",
    mlFixed: "0",
    total: "14.00",
  });
  assert.throws(
    () =>
      normalizeTariff([{ ...row, sale_fee_amount: 19 }], "gold_special", "100"),
    /adicionais/,
  );
  assert.throws(() => normalizeTariff([row], "gold_pro", "100"), /modalidade/);
  assert.throws(() =>
    normalizeTariff(
      [{ ...row, sale_fee_details: { percentage_fee: -1, fixed_fee: 0 } }],
      "gold_special",
      "100",
    ),
  );
});
test("daily priorities put negative margins and observed critical issues before incomplete fields", () => {
  const negative = operationalAttention({
    calculation: { margin: "-0.01" },
    pending: ["SKU"],
  });
  const stock = operationalAttention({
    quality: [{ title: "Sem estoque", priority: "high" }],
    pending: [],
  });
  const incomplete = operationalAttention({
    pending: ["SKU"],
    costs_stale: true,
  });
  assert.ok(
    negative.priority > stock.priority && stock.priority > incomplete.priority,
  );
  assert.ok(negative.reasons.includes("Margem de contribuição negativa"));
  assert.equal(
    operationalAttention({ calculation: { margin: null }, pending: [] })
      .priority,
    0,
  );
});
test("quality flags use observed facts; unknown photos/stock are not treated as zero", () => {
  const plain = {
    sku: "0001",
    brand: "Marca",
    description: "Conteúdo",
    status: "active",
  };
  assert.deepEqual(listingQuality(plain), []);
  const issues = listingQuality({
    ...plain,
    ml: {
      currencyId: "BRL",
      photoCount: 0,
      availableQuantity: 0,
      missingRequiredAttributes: [{ id: "MODEL", name: "Modelo" }],
      variablePrices: true,
    },
  });
  assert.deepEqual(
    issues.map((i) => i.key),
    ["photos", "stock", "attribute:MODEL", "variations"],
  );
  assert.deepEqual(listingQuality({ ...plain, ml: { currencyId: "BRL" } }), []);
});
test("advertising ratios share the same period and handle zeros and unavailable data", () => {
  assert.deepEqual(advertisingIndicators("100", "500", "1000"), {
    roas: "5.00",
    acos: "20.00",
    tacos: "10.00",
  });
  assert.deepEqual(advertisingIndicators("0", "500", "1000"), {
    roas: null,
    acos: "0.00",
    tacos: "0.00",
  });
  assert.deepEqual(advertisingIndicators("100", "0", null), {
    roas: "0.00",
    acos: null,
    tacos: null,
  });
  assert.deepEqual(advertisingIndicators("-1", "500", "1000"), {
    roas: null,
    acos: null,
    tacos: null,
  });
});
