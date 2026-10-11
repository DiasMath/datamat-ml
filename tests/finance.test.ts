import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  emptyCosts,
  costSchema,
  parameterSchema,
  simulationSchema,
  type Costs,
  type Parameters,
} from "../src/domain/finance";
import { parseCsv, csvCell } from "../src/domain/csv";
const p: Parameters = {
  minMargin: "10",
  desiredMargin: "20",
  taxRate: "5",
  taxBase: "price",
  managementRate: "1",
  managementBase: "price",
  reviewDays: 30,
};
const c: Costs = {
  goods: "40",
  mlPercent: "10",
  mlFixed: "2",
  shipping: "5",
  packaging: "1",
  advertising: "2",
  other: "0",
  otherDescription: "",
};
test("contribution uses decimal precision and all independent costs", () => {
  const r = calculate("100", c, p);
  assert.equal(r.total, "66.00");
  assert.equal(r.margin, "34.00");
  assert.equal(r.marginPercent, "34.0000");
  assert.equal(r.minPrice, "67.57");
  assert.equal(r.desiredPrice, "78.13");
  assert.equal(r.maxDiscount, "32.4300");
});
test("empty costs never masquerade as zero or yield limits", () => {
  const r = calculate("100", emptyCosts(), p);
  assert.equal(r.margin, null);
  assert.equal(r.minPrice, null);
  assert.ok(r.pending.includes("Mercadoria (oferta inteira)"));
});
test("explicit zero overrides are preserved, undefined inherits and null stays pending", () => {
  assert.equal(
    calculate("100", { ...c, taxRate: "0", managementRate: "0" }, p).margin,
    "40.00",
  );
  assert.equal(calculate("100", { ...c, taxRate: null }, p).margin, null);
  assert.equal(calculate("100", c, p).margin, "34.00");
});
test("discount and price are alternative ways to define a scenario", () => {
  const a = calculate(
    "100",
    c,
    p,
    simulationSchema.parse({ mode: "discount", discount: "20" }),
  );
  const b = calculate(
    "100",
    c,
    p,
    simulationSchema.parse({ mode: "price", price: "80" }),
  );
  assert.equal(a.price, b.price);
  assert.equal(a.margin, b.margin);
  assert.equal(a.discount, "20.0000");
  assert.ok(a.warnings.some((w) => w.includes("Revalidar")));
});
test("ML subsidy is separate, configurable bases affect tax and management", () => {
  const r = calculate(
    "100",
    c,
    { ...p, taxBase: "revenue", managementBase: "revenue" },
    simulationSchema.parse({
      mode: "price",
      price: "80",
      mlContribution: "10",
    }),
  );
  assert.equal(r.revenue, "90.00");
  assert.equal(r.total, "63.40");
  assert.equal(r.margin, "26.60");
  assert.equal(r.discount, "20.0000");
  assert.equal(r.minPrice, "67.57");
});
test("infeasible margins do not produce a negative minimum or discount", () => {
  const r = calculate("100", { ...c, mlPercent: "95" }, p);
  assert.equal(r.minPrice, null);
  assert.equal(r.maxDiscount, null);
  assert.ok(r.warnings.some((w) => w.includes("inviável")));
  const low = calculate("20", c, p);
  assert.equal(low.maxDiscount, null);
});
test("missing bases or minimum margin remain pending rather than fabricated", () => {
  const r = calculate("100", c, {
    ...p,
    managementBase: null,
    minMargin: null,
  });
  assert.equal(r.margin, null);
  assert.equal(r.minPrice, null);
  assert.ok(r.pending.includes("Base da comissão"));
});
test("round only final totals, not each intermediate percentage", () => {
  const r = calculate(
    "0.03",
    {
      ...c,
      goods: "0",
      mlFixed: "0",
      shipping: "0",
      packaging: "0",
      advertising: "0",
      mlPercent: "16.666666",
    },
    { ...p, taxRate: "16.666666", managementRate: "16.666666" },
  );
  assert.equal(r.total, "0.01");
  assert.equal(r.margin, "0.02");
});
test("server schemas reject negative, NaN, percentages above 100 and impossible targets", () => {
  assert.throws(() => costSchema.parse({ ...c, goods: "-1" }));
  assert.throws(() => costSchema.parse({ ...c, mlPercent: "101" }));
  assert.throws(() =>
    parameterSchema.parse({ ...p, minMargin: "50", desiredMargin: "20" }),
  );
  assert.throws(() => costSchema.parse({ ...c, shipping: "NaN" }));
});
test("CSV handles quoted delimiters, line breaks, empty cells and escaped quotes", () => {
  const r = parseCsv(
    'name;title;price\r\n"Produto; A";"Título ""especial""\ncom linha";\r\n',
  );
  assert.equal(r.rows[0][0], "Produto; A");
  assert.equal(r.rows[0][1], 'Título "especial"\ncom linha');
  assert.equal(r.rows[0][2], "");
  assert.throws(() => parseCsv("x,x\na,b"));
  assert.throws(() => parseCsv("a,b\nx"));
  assert.throws(() => parseCsv('a\n"sem fechar'));
});
test("CSV exports neutralize spreadsheet formulas", () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.ok(csvCell("  +cmd").startsWith("\"'"));
});
test("discount rounds the actual selling price before computing costs and rejects sub-cent prices", () => {
  const discounted = calculate(
    "100.99",
    c,
    p,
    simulationSchema.parse({ mode: "discount", discount: "7.125" }),
  );
  const explicit = calculate(
    "100.99",
    c,
    p,
    simulationSchema.parse({ mode: "price", price: "93.79" }),
  );
  assert.equal(discounted.price, "93.79");
  assert.equal(discounted.margin, explicit.margin);
  assert.throws(() =>
    simulationSchema.parse({ mode: "price", price: "0.001" }),
  );
  assert.equal(
    calculate(
      "100",
      c,
      p,
      simulationSchema.parse({ mode: "discount", discount: "100" }),
    ).margin,
    null,
  );
});

test("subsidies use the configured bases independently, not a discount on every charge", () => {
  for (const [taxBase, managementBase, total, margin] of [
    ["price", "price", "62.80", "27.20"],
    ["revenue", "price", "63.30", "26.70"],
    ["price", "revenue", "62.90", "27.10"],
    ["revenue", "revenue", "63.40", "26.60"],
  ] as const) {
    const result = calculate(
      "100",
      c,
      { ...p, taxBase, managementBase },
      simulationSchema.parse({
        mode: "price",
        price: "80",
        mlContribution: "10",
      }),
    );
    assert.equal(result.total, total);
    assert.equal(result.margin, margin);
  }
});
test("full draft costs affect only the proposed calculation, including explicit zero and unknown overrides", () => {
  const draft = {
    ...c,
    goods: "60",
    shipping: "7",
    packaging: "3",
    advertising: "1",
    other: "4",
    otherDescription: "Seguro",
    taxRate: "2",
    managementRate: "0",
  };
  const result = calculate(
    "100",
    c,
    p,
    simulationSchema.parse({
      mode: "price",
      price: "90",
      costOverrides: draft,
    }),
  );
  assert.equal(result.total, "87.80");
  assert.equal(result.margin, "2.20");
  assert.equal(calculate("100", c, p).margin, "34.00");
  assert.equal(c.goods, "40");
  assert.equal(
    calculate(
      "100",
      c,
      p,
      simulationSchema.parse({
        mode: "price",
        price: "90",
        costOverrides: { ...draft, goods: null },
      }),
    ).margin,
    null,
  );
  assert.throws(() =>
    simulationSchema.parse({
      mode: "price",
      price: "90",
      costOverrides: { ...draft, goods: "-1" },
    }),
  );
});
test("maximum discount is rounded down and never crosses the minimum price, even on large tickets", () => {
  for (const price of ["99.99", "100.99", "10000", "1000000000"]) {
    const result = calculate(price, c, p);
    assert.ok(result.maxDiscount);
    const discounted = calculate(
      price,
      c,
      p,
      simulationSchema.parse({
        mode: "discount",
        discount: result.maxDiscount,
      }),
    );
    assert.ok(Number(discounted.price) >= Number(result.minPrice));
    assert.ok(Number(discounted.marginPercent) >= Number(p.minMargin));
  }
  const expensive = calculate(
    "1000000000",
    {
      ...c,
      goods: "1234567.89",
      mlPercent: "0",
      mlFixed: "0",
      shipping: "0",
      packaging: "0",
      advertising: "0",
    },
    {
      ...p,
      minMargin: "0",
      desiredMargin: "0",
      taxRate: "0",
      managementRate: "0",
    },
  );
  assert.equal(expensive.maxDiscount, "99.8765");
  assert.ok(
    Number(
      calculate(
        "1000000000",
        {
          ...c,
          goods: "1234567.89",
          mlPercent: "0",
          mlFixed: "0",
          shipping: "0",
          packaging: "0",
          advertising: "0",
        },
        {
          ...p,
          minMargin: "0",
          desiredMargin: "0",
          taxRate: "0",
          managementRate: "0",
        },
        simulationSchema.parse({
          mode: "discount",
          discount: expensive.maxDiscount,
        }),
      ).price,
    ) >= 1234567.89,
  );
});
test("negative contribution and a proposal below the minimum produce clear warnings", () => {
  const changedFee = calculate(
    "100",
    c,
    p,
    simulationSchema.parse({
      mode: "price",
      price: "100",
      costOverrides: { ...c, shipping: "15" },
    }),
  );
  assert.ok(
    changedFee.warnings.some((w) => w.includes("Revalidar tarifa e frete")),
  );
  const result = calculate(
    "100",
    c,
    p,
    simulationSchema.parse({ mode: "price", price: "15" }),
  );
  assert.equal(result.margin, "-37.40");
  assert.ok(result.warnings.some((w) => w.includes("negativa")));
  assert.ok(result.warnings.some((w) => w.includes("simulado abaixo")));
});
test("a full draft can switch from a stored zero override back to the store parameters", () => {
  const stored = { ...c, taxRate: "0", managementRate: "0" };
  const result = calculate(
    "100",
    stored,
    p,
    simulationSchema.parse({ mode: "price", price: "100", costOverrides: c }),
  );
  assert.equal(calculate("100", stored, p).margin, "40.00");
  assert.equal(result.margin, "34.00");
});
