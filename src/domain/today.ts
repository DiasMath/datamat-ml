import Decimal from "decimal.js";
import {
  analysisRange,
  businessDay,
  changeRate,
  type AnalyticsReport,
} from "./analytics";
type Row = Record<string, any>;
export type TodayFocus = "urgent" | "review" | "prepare";
export type TodayItem = {
  id: string;
  title: string;
  storeId: string;
  storeName: string;
  thumbnail: string | null;
  severity: TodayFocus;
  reason: string;
  evidence: string;
  action: string;
  tab: string;
  reasons: string[];
  proposalId: string | null;
  decisionAction: string | null;
  decisionReason: string | null;
  decisionEvidence: string | null;
  impact: string;
  price: string | null;
  margin: string | null;
  marginPercent: string | null;
  minPrice: string | null;
  stock: number | null;
  status: string;
  mlId: string | null;
  pending: string[];
};
export const pendingDecisions = new Set([
  "review",
  "approved",
  "pending_application",
  "application_uncertain",
  "applying_ml",
  "failed",
]);
const recent = (value: unknown, age: number, clock: number) =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  clock - Date.parse(value) >= 0 &&
  clock - Date.parse(value) <= age;
const severityOrder: Record<TodayFocus, number> = {
  urgent: 0,
  review: 1,
  prepare: 2,
};
export function todayQueue(
  offers: Row[],
  proposals: Row[],
  weekly: AnalyticsReport,
  clock = Date.now(),
) {
  const current = new Map(
    weekly.current.products.map((p) => [p.storeId + ":" + p.id, p]),
  );
  const previous = new Map(
    weekly.previous.products.map((p) => [p.storeId + ":" + p.id, p]),
  );
  const rows: TodayItem[] = [];
  for (const offer of offers.filter(
    (o) =>
      o.origin !== "reference" &&
      (o.status !== "closed" ||
        proposals.some(
          (p) =>
            p.offer_id === o.id &&
            p.store_id === o.store_id &&
            pendingDecisions.has(p.status),
        )),
  )) {
    const source = weekly.stores.find((s) => s.storeId === offer.store_id);
    const weeklyValid =
      weekly.complete &&
      source?.sellerId === offer.ml?.sellerId &&
      source?.authVersion === offer.ml?.authVersion &&
      recent(source?.observedAt, 6 * 3600000, clock);
    const c = weeklyValid
      ? current.get(offer.store_id + ":" + offer.ml_id)
      : null;
    const p = weeklyValid
      ? previous.get(offer.store_id + ":" + offer.ml_id)
      : null;
    const signals: {
      severity: TodayFocus;
      reason: string;
      evidence: string;
      action: string;
      tab: string;
      proposalId?: string;
    }[] = [];
    const fresh =
      offer.matched && recent(offer.ml?.observedAt, 15 * 60000, clock);
    const costs = offer.calculation;
    const ownDecisions = proposals.filter(
      (p) =>
        p.offer_id === offer.id &&
        p.store_id === offer.store_id &&
        pendingDecisions.has(p.status),
    );
    for (const decision of ownDecisions) {
      const uncertain = ["application_uncertain", "applying_ml"].includes(
        decision.status,
      );
      const approved = ["approved", "pending_application"].includes(
        decision.status,
      );
      signals.push({
        severity: uncertain ? "urgent" : "review",
        reason: uncertain
          ? "Aplicação precisa de conferência"
          : approved
            ? "Proposta pronta para aplicação"
            : decision.status === "failed"
              ? "Aplicação não concluída"
              : "Proposta aguardando revisão",
        evidence: uncertain
          ? "Confira o preço no ML antes de repetir a operação."
          : approved
            ? "A proposta foi aprovada; a aplicação ainda precisa ser confirmada."
            : "Abra a proposta para conferir valores e próximo passo.",
        action: uncertain
          ? "Conferir aplicação"
          : approved
            ? "Abrir proposta"
            : "Revisar proposta",
        tab: "proposals",
        proposalId: decision.id,
      });
    }
    if (
      offer.status === "active" &&
      fresh &&
      !offer.costs_stale &&
      costs?.margin != null
    ) {
      const margin = new Decimal(costs.margin);
      if (margin.lt(0))
        signals.push({
          severity: "urgent",
          reason: "Contribuição estimada negativa",
          evidence: `Estimativa de R$ ${margin.toFixed(2).replace(".", ",")} por unidade com os custos cadastrados.`,
          action: "Revisar preço",
          tab: "costs",
        });
      else if (
        costs.marginPercent != null &&
        costs.minMargin != null &&
        new Decimal(costs.marginPercent).lt(costs.minMargin)
      )
        signals.push({
          severity: "review",
          reason: "Margem abaixo do mínimo",
          evidence: `Margem estimada ${costs.marginPercent}% · mínimo definido ${costs.minMargin}%.`,
          action: "Revisar preço",
          tab: "costs",
        });
    }
    if (fresh && offer.status === "active" && offer.ml?.availableQuantity === 0)
      signals.push({
        severity: "urgent",
        reason: "Anúncio ativo sem estoque",
        evidence: "O estoque publicado consultado no ML está zerado.",
        action: "Conferir anúncio",
        tab: "overview",
      });
    const competition = offer.competition;
    if (
      fresh &&
      offer.status === "active" &&
      competition &&
      competition.offer_version === offer.version &&
      competition.seller_id === offer.ml.sellerId &&
      competition.auth_version === offer.ml.authVersion &&
      competition.consistent !== false &&
      recent(competition.observed_at, 15 * 60000, clock) &&
      competition.status === "losing"
    )
      signals.push({
        severity: "review",
        reason: "Competição de catálogo a revisar",
        evidence: "Situação consultada no recurso oficial de competição do ML.",
        action: "Ver competição",
        tab: "overview",
      });
    if (
      offer.status === "active" &&
      fresh &&
      p &&
      p.orders >= 3 &&
      (c?.orders || 0) + p.orders >= 5
    ) {
      const change = changeRate(c?.revenue || "0", p.revenue);
      if (change !== null && new Decimal(change).lte(-30))
        signals.push({
          severity: "review",
          reason: "Receita do anúncio em queda",
          evidence: `${change}% nos 7 dias completos contra os 7 anteriores; a comparação não identifica a causa.`,
          action: "Analisar anúncio",
          tab: "overview",
        });
    }
    if (offer.ml_status_uncertain)
      signals.push({
        severity: "urgent",
        reason: "Situação no ML não confirmada",
        evidence:
          "Uma operação ficou sem confirmação; confira antes de reenviar.",
        action: "Conferir situação",
        tab: "overview",
      });
    if (offer.status === "active" && fresh && offer.ml?.photoCount === 0)
      signals.push({
        severity: "review",
        reason: "Anúncio publicado sem fotos",
        evidence: "A última consulta do ML não retornou fotografias.",
        action: "Ver fotos",
        tab: "media",
      });
    if (offer.calculation.pending.length || offer.costs_stale)
      signals.push({
        severity: "prepare",
        reason: offer.calculation.pending.length
          ? "Dados financeiros a completar"
          : "Custos precisam de revisão",
        evidence: offer.calculation.pending.length
          ? `Preencha ${offer.calculation.pending.slice(0, 2).join(" e ")}${offer.calculation.pending.length > 2 ? ` e mais ${offer.calculation.pending.length - 2} campos` : ""}.`
          : "O prazo de revisão dos custos desta loja venceu.",
        action: "Completar custos",
        tab: "costs",
      });
    signals.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
    );
    if (!signals.length) continue;
    const first = signals[0];
    rows.push({
      id: offer.id,
      title: offer.title,
      storeId: offer.store_id,
      storeName: offer.store_name,
      thumbnail: offer.thumbnail,
      ...first,
      reasons: [...new Set(signals.map((s) => s.reason))],
      proposalId: first.proposalId || ownDecisions[0]?.id || null,
      decisionAction: signals.find((s) => s.proposalId)?.action || null,
      decisionReason: signals.find((s) => s.proposalId)?.reason || null,
      decisionEvidence: signals.find((s) => s.proposalId)?.evidence || null,
      impact: c?.revenue || "0",
      price: offer.ml?.variablePrices ? null : (offer.price ?? null),
      margin: !offer.costs_stale ? (costs?.margin ?? null) : null,
      marginPercent: !offer.costs_stale ? (costs?.marginPercent ?? null) : null,
      minPrice: !offer.costs_stale ? (costs?.minPrice ?? null) : null,
      stock: fresh ? (offer.ml?.availableQuantity ?? null) : null,
      status: offer.status,
      mlId: offer.ml_id || null,
      pending: costs?.pending || [],
    });
  }
  return rows.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      new Decimal(b.impact).comparedTo(a.impact) ||
      a.title.localeCompare(b.title, "pt-BR") ||
      a.id.localeCompare(b.id),
  );
}
export function todayHours(report: AnalyticsReport, clock: Date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(clock),
  );
  return report.current.hourly
    .filter((h) => h.hour <= hour)
    .map((h) => ({
      hour: h.hour,
      revenue: report.available ? h.revenue : null,
      previous: report.complete
        ? report.previous.hourly[h.hour]?.revenue || "0"
        : null,
    }));
}
export function todayWindow(clock = new Date()) {
  const day = businessDay(clock);
  return analysisRange(day, day, clock);
}
