import Decimal from "decimal.js";
import { z } from "zod";

const money = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/)
  .transform((v) => new Decimal(v).toFixed(2));
const rate = z
  .string()
  .regex(/^-?\d{1,3}(\.\d{1,2})?$/)
  .refine((v) => new Decimal(v).gte(-100) && new Decimal(v).lte(100));
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
export const campaignSchema = z
  .object({
    storeId: z.string().min(1).max(200),
    campaignKey: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    from: day,
    to: day,
    status: z.enum(["active", "paused", "unknown"]).default("unknown"),
    spend: money,
    attributedRevenue: money.nullable(),
    impressions: z.number().int().min(0).max(1e12).nullable(),
    clicks: z.number().int().min(0).max(1e12).nullable(),
    orders: z.number().int().min(0).max(1e12).nullable(),
    marginBeforeAds: rate.nullable(),
    targetAcos: rate.refine((v) => new Decimal(v).gte(0)).nullable(),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (p) =>
      p.from <= p.to && Date.parse(p.to) - Date.parse(p.from) <= 365 * 86400000,
    "Use um período de até 366 dias",
  )
  .refine(
    (p) =>
      p.clicks === null || p.impressions === null || p.clicks <= p.impressions,
    "Cliques não podem exceder impressões",
  );
export type Campaign = z.infer<typeof campaignSchema>;
export function campaignIndicators(
  row: Pick<
    Campaign,
    | "spend"
    | "attributedRevenue"
    | "impressions"
    | "clicks"
    | "orders"
    | "marginBeforeAds"
    | "targetAcos"
  >,
) {
  const ratio = (
    a: string | number | null,
    b: string | number | null,
    multiplier = 1,
  ) =>
    a !== null && b !== null && new Decimal(b).gt(0)
      ? new Decimal(a).div(b).mul(multiplier).toFixed(2)
      : null;
  const profit =
    row.attributedRevenue !== null && row.marginBeforeAds !== null
      ? new Decimal(row.attributedRevenue)
          .mul(row.marginBeforeAds)
          .div(100)
          .minus(row.spend)
          .toFixed(2)
      : null;
  const acos = ratio(row.spend, row.attributedRevenue, 100),
    ctr = ratio(row.clicks, row.impressions, 100);
  const insights: Array<{ key: string; title: string; action: string }> = [];
  if (new Decimal(row.spend).gt(0) && row.attributedRevenue === "0.00")
    insights.push({
      key: "no-revenue",
      title: "Investimento sem receita atribuída",
      action:
        "Conferir a janela de atribuição, estoque e relevância dos anúncios antes de alterar o orçamento.",
    });
  if (profit !== null && new Decimal(profit).lt(0))
    insights.push({
      key: "loss",
      title: "Contribuição estimada negativa após Ads",
      action:
        "Revisar margem, ACOS e produtos anunciados. A estimativa usa a margem informada antes da publicidade.",
    });
  if (
    acos !== null &&
    row.targetAcos !== null &&
    new Decimal(acos).gt(row.targetAcos)
  )
    insights.push({
      key: "target",
      title: "ACOS acima da meta",
      action:
        "Investigar produtos e termos com gasto elevado antes de reduzir investimento.",
    });
  if (
    ctr !== null &&
    (row.impressions || 0) >= 1000 &&
    new Decimal(ctr).lt("0.5")
  )
    insights.push({
      key: "ctr",
      title: "CTR abaixo de 0,5% na amostra",
      action:
        "Revisar imagem principal, título e pertinência do anúncio. Limiar de triagem, não uma meta oficial do ML.",
    });
  if ((row.clicks || 0) >= 30 && row.orders === 0)
    insights.push({
      key: "conversion",
      title: "Cliques sem pedidos atribuídos",
      action:
        "Conferir preço, frete, prazo e ficha técnica; considerar o atraso de atribuição.",
    });
  return {
    roas: ratio(row.attributedRevenue, row.spend),
    acos,
    ctr,
    cpc: ratio(row.spend, row.clicks),
    cpo: ratio(row.spend, row.orders),
    orderClickRate: ratio(row.orders, row.clicks, 100),
    profit,
    breakEvenAcos: row.marginBeforeAds,
    state:
      profit !== null && new Decimal(profit).lt(0)
        ? "loss"
        : insights.length
          ? "attention"
          : profit !== null && new Decimal(profit).gt(0)
            ? "positive"
            : "unknown",
    insights,
  };
}
export const campaignColumns = [
  "storeId",
  "campaignKey",
  "name",
  "from",
  "to",
  "status",
  "spend",
  "attributedRevenue",
  "impressions",
  "clicks",
  "orders",
  "marginBeforeAds",
  "targetAcos",
  "version",
] as const;
export function campaignImport(
  headers: string[],
  rows: string[][],
  defaults: { storeId: string; from: string; to: string },
): Campaign[] {
  const aliases: Record<string, string> = {
    loja: "storeId",
    campanha: "name",
    nomedacampanha: "name",
    iddacampanha: "campaignKey",
    idcampanha: "campaignKey",
    inicio: "from",
    fim: "to",
    investimento: "spend",
    custo: "spend",
    receitaatribuida: "attributedRevenue",
    receita: "attributedRevenue",
    impressoes: "impressions",
    cliques: "clicks",
    pedidos: "orders",
    margemantesads: "marginBeforeAds",
    metaacos: "targetAcos",
    versao: "version",
    situacao: "status",
  };
  const normalize = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const fields = headers.map(
    (h) =>
      campaignColumns.find((c) => normalize(c) === normalize(h)) ||
      aliases[normalize(h)],
  );
  if (!fields.includes("name") || !fields.includes("spend"))
    throw new Error(
      "Inclua as colunas name/campanha e spend/investimento. Baixe o modelo para conferir os campos.",
    );
  if (new Set(fields.filter(Boolean)).size !== fields.filter(Boolean).length)
    throw new Error("Há colunas mapeadas para o mesmo campo");
  return rows.map((cells, index) => {
    const raw: Record<string, any> = {
      ...defaults,
      status: "unknown",
      attributedRevenue: null,
      impressions: null,
      clicks: null,
      orders: null,
      marginBeforeAds: null,
      targetAcos: null,
      version: 0,
    };
    fields.forEach((field, i) => {
      if (field && cells[i]?.trim()) raw[field] = cells[i].trim();
    });
    raw.campaignKey ||= raw.name;
    for (const f of [
      "spend",
      "attributedRevenue",
      "marginBeforeAds",
      "targetAcos",
    ])
      if (raw[f] !== null && raw[f] !== undefined) {
        const v = String(raw[f])
          .replace(/^R\$\s*/, "")
          .replace(/\s/g, "");
        raw[f] = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
      }
    for (const f of ["impressions", "clicks", "orders", "version"])
      if (raw[f] !== null) raw[f] = Number(raw[f]);
    const parsed = campaignSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(`Linha ${index + 2}: ${parsed.error.issues[0].message}`);
    return parsed.data;
  });
}
