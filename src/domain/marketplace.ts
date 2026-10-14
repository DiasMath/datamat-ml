import Decimal from "decimal.js";
import { z } from "zod";

// A tariff quote is usable only when its decomposition matches the total.
export function normalizeTariff(
  data: unknown,
  listingType: string,
  price: string,
) {
  const amount = z.number().finite().nonnegative();
  const tariff = z.object({
    listing_type_id: z.string(),
    sale_fee_amount: amount,
    sale_fee_details: z.object({
      percentage_fee: amount.max(100),
      fixed_fee: amount,
    }),
  });
  // listing_type_id can make the API return a single tariff rather than an array.
  const result = z.union([tariff, z.array(tariff)]).parse(data);
  const rows = Array.isArray(result) ? result : [result];
  const row = rows.find((r) => r.listing_type_id === listingType);
  if (!row) throw new Error("A API não retornou a modalidade deste anúncio");
  const total = new Decimal(price)
    .mul(row.sale_fee_details.percentage_fee)
    .div(100)
    .plus(row.sale_fee_details.fixed_fee);
  if (total.minus(row.sale_fee_amount).abs().gt("0.02"))
    throw new Error(
      "A tarifa retornada possui componentes adicionais; confira no Mercado Livre",
    );
  return {
    mlPercent: String(row.sale_fee_details.percentage_fee),
    mlFixed: String(row.sale_fee_details.fixed_fee),
    total: new Decimal(row.sale_fee_amount).toFixed(2),
  };
}

export type QualityIssue = {
  key: string;
  title: string;
  priority: "high" | "medium";
  action: string;
};
export function listingQuality(offer: Record<string, any>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const add = (
    key: string,
    title: string,
    action: string,
    priority: "high" | "medium" = "medium",
  ) => issues.push({ key, title, action, priority });
  if (!offer.sku)
    add("sku", "SKU não informado", "Conferir o vínculo com o produto no ERP.");
  if (!offer.brand)
    add(
      "brand",
      "Marca não informada",
      "Preencher a marca confirmada do produto.",
    );
  if (!offer.description?.trim())
    add(
      "description",
      "Descrição não disponível no cadastro",
      "Conferir e registrar características e conteúdo da oferta.",
    );
  const ml = offer.ml;
  if (ml) {
    if (ml.photoCount === 0)
      add(
        "photos",
        "Anúncio sem fotos",
        "Adicionar fotos do produto no Mercado Livre.",
        "high",
      );
    if (ml.availableQuantity === 0 && offer.status === "active")
      add(
        "stock",
        "Anúncio ativo sem estoque disponível",
        "Conferir saldo e vínculo no ERP antes de repor.",
        "high",
      );
    for (const a of ml.missingRequiredAttributes || [])
      add(
        "attribute:" + a.id,
        "Atributo obrigatório: " + a.name,
        "Conferir a ficha técnica e preencher no Mercado Livre.",
      );
    if (ml.variablePrices)
      add(
        "variations",
        "Variações com preços diferentes",
        "Precificar cada variação separadamente.",
        "high",
      );
    if (ml.currencyId !== "BRL")
      add(
        "currency",
        "Moeda diferente de BRL",
        "Conferir a moeda; a precificação atual utiliza reais.",
        "high",
      );
  }
  return issues;
}

export function advertisingIndicators(
  spend: string | null,
  attributedRevenue: string | null,
  totalRevenue: string | null,
) {
  const valid = (v: string | null) =>
    v !== null && /^\d+(\.\d+)?$/.test(v) ? new Decimal(v) : null;
  const s = valid(spend),
    a = valid(attributedRevenue),
    t = valid(totalRevenue);
  return {
    roas: s?.gt(0) && a ? a.div(s).toFixed(2) : null,
    acos: a?.gt(0) && s ? s.div(a).mul(100).toFixed(2) : null,
    tacos: t?.gt(0) && s ? s.div(t).mul(100).toFixed(2) : null,
  };
}

export function operationalAttention(offer: Record<string, any>) {
  const reasons: string[] = [];
  let priority = 0;
  if (
    offer.calculation?.margin != null &&
    new Decimal(offer.calculation.margin).lt(0)
  ) {
    reasons.push("Margem de contribuição negativa");
    priority = 100;
  }
  for (const issue of offer.quality || [])
    if (issue.priority === "high") {
      reasons.push(issue.title);
      priority = Math.max(priority, 80);
    }
  if (offer.costs_stale) {
    reasons.push("Revisar custos");
    priority = Math.max(priority, 40);
  }
  if (offer.pending?.length) {
    reasons.push(...offer.pending);
    priority = Math.max(priority, 20);
  }
  return { priority, reasons: [...new Set(reasons)] };
}
