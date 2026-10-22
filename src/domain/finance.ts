import Decimal from "decimal.js";
import { z } from "zod";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
export const amount = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (v) => /^\d+(\.\d{1,6})?$/.test(v) && new Decimal(v).lte("1000000000"),
    "Informe um valor positivo com até 6 casas decimais",
  )
  .nullable();
export const percent = amount.refine(
  (v) => v === null || new Decimal(v).lte(100),
  "Percentual deve estar entre 0 e 100",
);
export const priceAmount = amount.refine(
  (v) =>
    v === null ||
    (new Decimal(v).gte("0.01") && new Decimal(v).decimalPlaces() <= 2),
  "O preço deve ser pelo menos R$ 0,01, com até 2 casas decimais",
);
export const base = z.enum(["price", "revenue"]).nullable();
export const costSchema = z.object({
  goods: amount,
  mlPercent: percent,
  mlFixed: amount,
  shipping: amount,
  packaging: amount,
  advertising: amount,
  other: amount,
  otherDescription: z.string().max(500).default(""),
  taxRate: percent.optional(),
  taxBase: base.optional(),
  managementRate: percent.optional(),
  managementBase: base.optional(),
});
export const parameterSchema = z
  .object({
    minMargin: percent,
    desiredMargin: percent,
    taxRate: percent,
    taxBase: base,
    managementRate: percent,
    managementBase: base,
    reviewDays: z.number().int().min(1).max(3650),
    salesMarginTarget: percent
      .refine(
        (v) => v !== null && new Decimal(v).lt(100),
        "A meta deve ser menor que 100%",
      )
      .optional(),
    enforceSalesMargin: z.boolean().optional(),
  })
  .refine(
    (p) =>
      p.minMargin === null ||
      p.desiredMargin === null ||
      new Decimal(p.desiredMargin).gte(p.minMargin),
    "Margem desejada deve ser maior ou igual à mínima",
  );
export const simulationSchema = z.object({
  mlQuoteId: z.uuid().optional(),
  mlShippingMode: z.enum(["automatic", "manual"]).optional(),
  mode: z.enum(["price", "discount"]),
  price: priceAmount.optional(),
  discount: percent.optional(),
  mlContribution: amount.default("0"),
  promotion: z.string().max(200).default(""),
  mlPercent: percent.optional(),
  mlFixed: amount.optional(),
  shipping: amount.optional(),
  advertising: amount.optional(),
  conditionsVerified: z.boolean().default(false),
  costOverrides: costSchema.optional(),
  proposedTitle: z.string().trim().min(1).max(200).optional(),
  proposedDescription: z.string().max(15000).optional(),
});
export type Costs = z.infer<typeof costSchema>;
export type Parameters = z.infer<typeof parameterSchema>;
export type Simulation = z.infer<typeof simulationSchema>;
export const emptyCosts = (): Costs => ({
  goods: null,
  mlPercent: null,
  mlFixed: null,
  shipping: null,
  packaging: null,
  advertising: null,
  other: null,
  otherDescription: "",
});
const labels: Record<string, string> = {
  goods: "Mercadoria (oferta inteira)",
  mlPercent: "Tarifa percentual ML",
  mlFixed: "Cobrança fixa ML",
  shipping: "Frete da loja",
  packaging: "Embalagem",
  advertising: "Publicidade por venda",
  other: "Outros custos",
  taxRate: "Alíquota de impostos",
  taxBase: "Base dos impostos",
  managementRate: "Comissão de gestão",
  managementBase: "Base da comissão",
};
const d = (v: Decimal.Value) => new Decimal(v);
const money = (v: Decimal) => v.toFixed(2);
const pct = (v: Decimal) => v.toFixed(4);
export function mlConditionsChanged(costs: Costs, input: Simulation) {
  return (["mlPercent", "mlFixed", "shipping"] as const).some((key) => {
    const value =
      input[key] !== undefined ? input[key] : input.costOverrides?.[key];
    return (
      value !== undefined &&
      (value === null || costs[key] === null
        ? value !== costs[key]
        : !d(value).eq(costs[key]!))
    );
  });
}
export function calculate(
  currentPrice: string | null,
  costs: Costs,
  parameters: Parameters,
  input?: Simulation,
) {
  const pending: string[] = [];
  const warnings: string[] = [];
  let price = currentPrice === null ? null : d(currentPrice);
  if (input) {
    if (input.mode === "price")
      price = input.price == null ? null : d(input.price);
    else
      price =
        currentPrice == null || input.discount == null
          ? null
          : d(currentPrice).mul(d(1).sub(d(input.discount).div(100)));
  }
  if (price) price = price.toDecimalPlaces(2);
  if (price === null || price.lte(0)) pending.push("Preço maior que zero");
  const effectiveCosts = input?.costOverrides ?? costs;
  const c: Record<string, string | null | undefined> = { ...effectiveCosts };
  for (const key of [
    "taxRate",
    "taxBase",
    "managementRate",
    "managementBase",
  ] as const) {
    // Undefined inherits. Null stays pending. Explicit zero is never replaced.
    if (effectiveCosts[key] === undefined) c[key] = parameters[key];
  }
  for (const key of [
    "mlPercent",
    "mlFixed",
    "shipping",
    "advertising",
  ] as const)
    if (input && input[key] !== undefined) c[key] = input[key];
  for (const key of [
    "goods",
    "mlPercent",
    "mlFixed",
    "shipping",
    "packaging",
    "advertising",
    "other",
    "taxRate",
    "taxBase",
    "managementRate",
    "managementBase",
  ])
    if (c[key] == null) pending.push(labels[key]);
  if (
    c.other != null &&
    d(c.other).gt(0) &&
    !effectiveCosts.otherDescription.trim()
  )
    pending.push("Descrição dos outros custos");
  const contribution = d(input?.mlContribution ?? "0");
  const revenue = price && price.gt(0) ? price.add(contribution) : null;
  const changed = !!price && currentPrice !== null && !price.eq(currentPrice);
  if (
    (changed || (input && mlConditionsChanged(costs, input))) &&
    !input?.conditionsVerified
  )
    warnings.push("Revalidar tarifa e frete no ML antes de aplicar");
  if (parameters.minMargin == null) warnings.push("Margem mínima não definida");
  if (parameters.desiredMargin == null)
    warnings.push("Margem desejada não definida");
  if (changed) warnings.push("A simulação não presume aumento de vendas");
  const breakdown: Record<string, string | null> = {};
  for (const key of [
    "goods",
    "mlFixed",
    "shipping",
    "packaging",
    "advertising",
    "other",
  ])
    breakdown[key] = c[key] == null ? null : money(d(c[key]!));
  breakdown.mlPercent =
    c.mlPercent == null || !price
      ? null
      : money(price.mul(d(c.mlPercent).div(100)));
  for (const [key, rate, basis] of [
    ["tax", "taxRate", "taxBase"],
    ["management", "managementRate", "managementBase"],
  ]) {
    const value =
      c[basis] === "price" ? price : c[basis] === "revenue" ? revenue : null;
    breakdown[key] =
      c[rate] == null || !value ? null : money(value.mul(d(c[rate]!).div(100)));
  }
  let total: string | null = null,
    margin: string | null = null,
    marginPercent: string | null = null,
    minPrice: string | null = null,
    maxDiscount: string | null = null,
    desiredPrice: string | null = null;
  const salesMarginTarget = parameters.salesMarginTarget ?? "40";
  let saleMarginPercent: string | null = null,
    salesMarginMet: boolean | null = null,
    salesTargetPrice: string | null = null;
  let policyMinPrice: string | null = null,
    policyMaxDiscount: string | null = null;
  if (!pending.length && price && revenue) {
    // Calculate unrounded amounts; round only the final displayed amounts.
    const fixed = [
      "goods",
      "mlFixed",
      "shipping",
      "packaging",
      "advertising",
      "other",
    ].reduce((sum, k) => sum.add(c[k]!), d(0));
    const mlRate = d(c.mlPercent!).div(100),
      taxRate = d(c.taxRate!).div(100),
      managementRate = d(c.managementRate!).div(100);
    const revenueRates = (c.taxBase === "revenue" ? taxRate : d(0)).add(
      c.managementBase === "revenue" ? managementRate : 0,
    );
    const rate = mlRate.add(taxRate).add(managementRate);
    const costsTotal = fixed
      .add(price.mul(rate))
      .add(contribution.mul(revenueRates));
    const m = revenue.sub(costsTotal);
    total = money(costsTotal);
    margin = money(m);
    marginPercent = pct(m.div(revenue).mul(100));
    saleMarginPercent = pct(m.div(price).mul(100));
    salesMarginMet = m.div(price).mul(100).gt(salesMarginTarget);
    const limit = (target: string | null) => {
      if (target === null) return null;
      const denominator = d(1).sub(rate).sub(d(target).div(100));
      if (denominator.lte(0)) {
        warnings.push(
          "Limite inviável: taxas e margem consomem 100% da receita",
        );
        return null;
      }
      // Conservatively exclude promotional ML subsidy from estimated standing limits.
      return Decimal.max(fixed.div(denominator), "0.01").toDecimalPlaces(
        2,
        Decimal.ROUND_CEIL,
      );
    };
    const minimum = limit(parameters.minMargin),
      desired = limit(parameters.desiredMargin);
    minPrice = minimum ? money(minimum) : null;
    desiredPrice = desired ? money(desired) : null;
    const targetDenominator = d(1).sub(rate).sub(d(salesMarginTarget).div(100));
    if (targetDenominator.gt(0)) {
      // Strictly above the target, including when the boundary is an exact cent.
      salesTargetPrice = money(
        Decimal.max(
          fixed
            .div(targetDenominator)
            .toDecimalPlaces(2, Decimal.ROUND_FLOOR)
            .add("0.01"),
          "0.01",
        ),
      );
    } else warnings.push("Meta sobre a venda inviável com as taxas informadas");
    if (!salesMarginMet)
      warnings.push(
        `Margem sobre a venda deve ser maior que ${salesMarginTarget}%`,
      );
    if (minimum && currentPrice != null && d(currentPrice).gt(0)) {
      if (minimum.gt(currentPrice))
        warnings.push(
          "Preço atual abaixo do mínimo estimado; nenhum desconto viável",
        );
      else
        maxDiscount = d(1)
          .sub(minimum.div(currentPrice))
          .mul(100)
          .toFixed(4, Decimal.ROUND_FLOOR);
    }
    if (minPrice)
      warnings.push(
        "Limites estimados com custos constantes e sem subsídio promocional; revalidar tarifa e frete",
      );
    if (m.lt(0))
      warnings.push("Esta condição tem contribuição negativa por venda");
    if (minimum && price.lt(minimum))
      warnings.push("Preço simulado abaixo do mínimo estimado");
    const policyFloor =
      parameters.enforceSalesMargin !== false
        ? salesTargetPrice == null
          ? null
          : Decimal.max(salesTargetPrice, minimum ?? 0)
        : minimum;
    policyMinPrice = policyFloor ? money(policyFloor) : null;
    if (policyFloor && currentPrice != null && policyFloor.lte(currentPrice))
      policyMaxDiscount = d(1)
        .sub(policyFloor.div(currentPrice))
        .mul(100)
        .toFixed(4, Decimal.ROUND_FLOOR);
  }
  return {
    price: price && price.gt(0) ? money(price) : null,
    revenue: revenue ? money(revenue) : null,
    mlContribution: money(contribution),
    discount:
      price && currentPrice && d(currentPrice).gt(0)
        ? pct(d(1).sub(price.div(currentPrice)).mul(100))
        : null,
    breakdown,
    total,
    margin,
    marginPercent,
    saleMarginPercent,
    salesMarginTarget,
    salesMarginMet,
    salesTargetPrice,
    policyMinPrice,
    policyMaxDiscount,
    enforceSalesMargin: parameters.enforceSalesMargin !== false,
    minPrice,
    maxDiscount,
    desiredPrice,
    pending,
    warnings: [...new Set(warnings)],
    minMargin: parameters.minMargin,
    desiredMargin: parameters.desiredMargin,
    bases: { tax: c.taxBase, management: c.managementBase },
    conditionsVerified: input?.conditionsVerified ?? false,
  };
}
