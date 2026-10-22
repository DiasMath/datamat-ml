import Decimal from "decimal.js";
import type { AnalyticsReport } from "./analytics";
type Row = Record<string, any>;
const stop = new Set(
  "a as o os um uma uns umas de da das do dos e em no na nos nas por para com sem ao aos que kit produto original novo nova ml mercado livre".split(
    " ",
  ),
);
export function titleTerms(titles: string[]) {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const words = new Set(
      title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .match(/[a-z0-9]{2,}/g) || [],
    );
    for (const word of words)
      if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "pt-BR"))
    .slice(0, 30);
}
export function titleChecks(title: string) {
  const words = titleTerms([title]);
  return [
    ...(title.trim().length < 15
      ? [
          "Título curto: confira se identifica produto, marca/modelo e característica relevante.",
        ]
      : []),
    ...(title.length > 60
      ? [
          "Título acima de 60 caracteres: confira o limite e as exigências da categoria no ML.",
        ]
      : []),
    ...(/\b(frete gr[aá]tis|promo[cç][aã]o|imperd[ií]vel)\b/i.test(title)
      ? ["Há texto promocional: priorize informações verificáveis do produto."]
      : []),
    ...(!words.length ? ["Informe termos que identifiquem o produto."] : []),
  ];
}
export function listingDiagnostics(
  offers: Row[],
  report: AnalyticsReport | null,
  clock = Date.now(),
) {
  const productKey = (r: Row) => r.storeId + ":" + r.id;
  const current = new Map(
    (report?.current.products || []).map((r) => [productKey(r), r]),
  );
  const previous = new Map(
    (report?.previous.products || []).map((r) => [productKey(r), r]),
  );
  return offers
    .filter((o) => o.origin !== "reference")
    .map((o) => {
      const source = report?.stores.find((s) => s.storeId === o.store_id),
        matched =
          source?.connected &&
          source.sellerId === o.ml?.sellerId &&
          source.authVersion === o.ml?.authVersion;
      const available = !!(report?.complete && matched),
        c = current.get(o.store_id + ":" + o.ml_id),
        p = previous.get(o.store_id + ":" + o.ml_id);
      const sufficient = available && (c?.orders || 0) + (p?.orders || 0) >= 5;
      const delta =
        sufficient && p && new Decimal(p.revenue).gt(0)
          ? new Decimal(c?.revenue || 0)
              .minus(p.revenue)
              .div(p.revenue)
              .mul(100)
              .toFixed(2)
          : null;
      const trend =
        delta === null
          ? "unknown"
          : new Decimal(delta).gte(15)
            ? "up"
            : new Decimal(delta).lte(-15)
              ? "down"
              : "stable";
      const age = o.ml?.observedAt
          ? clock - Date.parse(o.ml.observedAt)
          : Infinity,
        stale =
          !matched || !Number.isFinite(age) || age < 0 || age > 15 * 60000;
      const issues: Array<{ title: string; action: string }> = [];
      const margin = o.calculation?.margin;
      if (margin != null && new Decimal(margin).lt(0))
        issues.push({
          title: "Margem de contribuição negativa",
          action:
            "Revisar custos e preço; crescimento das vendas não garante rentabilidade.",
        });
      if (trend === "down")
        issues.push({
          title: "Receita em queda no comparativo",
          action:
            "Conferir preço, frete, prazo, estoque, visitas e alterações recentes. Comparação não identifica a causa.",
        });
      if (!stale && o.ml?.availableQuantity === 0 && o.status === "active")
        issues.push({
          title: "Estoque publicado zerado",
          action: "Conferir saldo e reposição antes de investir no anúncio.",
        });
      for (const q of o.quality || [])
        issues.push({ title: q.title, action: q.action });
      if (stale && o.ml_id)
        issues.push({
          title: "Retrato do ML precisa de atualização",
          action:
            "Consultar o anúncio antes de tomar uma decisão sobre conteúdo ou estoque.",
        });
      return {
        id: o.id,
        title: o.title,
        storeId: o.store_id,
        status: o.status,
        trend,
        delta,
        revenue: available ? c?.revenue || "0.00" : null,
        previousRevenue: available ? p?.revenue || "0.00" : null,
        orders: available ? c?.orders || 0 : null,
        previousOrders: available ? p?.orders || 0 : null,
        margin: o.calculation?.marginPercent ?? null,
        health:
          o.ml?.health == null
            ? null
            : new Decimal(o.ml.health).mul(100).toFixed(0),
        observedAt: o.ml?.observedAt || null,
        stale,
        issues,
      };
    })
    .sort(
      (a, b) =>
        b.issues.length - a.issues.length ||
        a.title.localeCompare(b.title, "pt-BR"),
    );
}
