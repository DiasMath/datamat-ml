import Decimal from "decimal.js";
import { listingType } from "../domain/listing-table";
import { money, percent, labels } from "./ui";
import { listingDateTime } from "./listing-global-panel";
import type { ListingInformation } from "./listing-information";
type Row = Record<string, any>;
export const listingDiscountLimit = (value: unknown) =>
  value == null
    ? "Indisponível"
    : percent(
        new Decimal(String(value))
          .toDecimalPlaces(2, Decimal.ROUND_FLOOR)
          .toString(),
        2,
      );
export function listingRowInformation(
  o: Row,
  kind: string,
  onPreview: (id: string, tab?: string) => void,
): ListingInformation {
  const financial = o.financialStatus;
  const action = {
    label: "Conferir custos e precificação",
    run: () => onPreview(o.id, "costs"),
  };
  const subtitle = o.title;
  if (kind === "product")
    return {
      title: "Anúncio e produto",
      rows: [
        { label: "Título completo", value: o.title },
        { label: "Produto", value: o.product_name },
        { label: "Loja", value: o.store_name },
        { label: "Código ML", value: o.ml_id || "Não informado" },
        { label: "SKU", value: o.sku || "Não informado" },
        { label: "Situação", value: labels[o.status] || o.status },
      ],
      action: { label: "Abrir prévia lateral", run: () => onPreview(o.id) },
    };
  if (kind === "stock")
    return {
      title: "Estoque publicado",
      subtitle,
      rows: [
        {
          label: "Quantidade no ML",
          value:
            o.ml?.availableQuantity == null
              ? "Não informada"
              : `${o.ml.availableQuantity} un.`,
        },
        {
          label: "Consulta do anúncio",
          value: listingDateTime(o.ml?.observedAt),
        },
      ],
      notes: [
        "Saldo publicado neste anúncio. Não representa um estoque físico consolidado: publicações podem compartilhar o mesmo produto.",
      ],
      action: { label: "Conferir anúncio", run: () => onPreview(o.id) },
    };
  if (kind === "tariff" || kind === "shipping")
    return {
      title: kind === "tariff" ? "Tarifa e condições ML" : "Frete da loja",
      subtitle,
      rows: [
        { label: "Modalidade", value: listingType(o.ml?.listingTypeId) },
        {
          label: "Tarifa total usada",
          value: money(financial?.tariff?.amount),
        },
        { label: "Percentual", value: percent(financial?.tariff?.percent) },
        { label: "Cobrança fixa", value: money(financial?.tariff?.fixed) },
        {
          label: "Origem da tarifa",
          value:
            (
              {
                ml: "API do Mercado Livre",
                manual: "Exceção manual",
                mixed: "ML + exceção manual",
              } as Row
            )[financial?.tariff?.source] || "Consulta pendente",
        },
        {
          label: "Frete do vendedor",
          value: money(financial?.shipping?.amount),
        },
        {
          label: "Origem do frete",
          value:
            financial?.shipping?.source === "ml"
              ? "ML · estimativa"
              : financial?.shipping
                ? "Valor manual"
                : "A conferir",
        },
      ],
      notes: [
        "A cotação de frete é estimada. O custo efetivo depende do envio. Frete pago pelo comprador não comprova custo zero para a loja.",
        "Valores manuais, inclusive zero, têm prioridade sobre as condições automáticas.",
      ],
      action,
    };
  if (kind === "metrics")
    return {
      title: "Desempenho dos últimos 7 dias",
      subtitle,
      rows: [
        {
          label: "Período",
          value: o.metrics7d
            ? `${listingDateTime(o.metrics7d.from)} a ${listingDateTime(o.metrics7d.to)}`
            : "Não consultado",
        },
        { label: "Visitas", value: o.metrics7d?.visits ?? "Indisponível" },
        {
          label: "Pedidos pagos",
          value: o.metrics7d?.paidOrders ?? "Indisponível",
        },
        {
          label: "Unidades vendidas",
          value: o.metrics7d?.units ?? "Indisponível",
        },
        {
          label: "Pedidos / visitas",
          value: percent(o.metrics7d?.orderVisitRate),
        },
        { label: "Consulta", value: listingDateTime(o.metrics7d?.observedAt) },
      ],
      notes: [
        "Pedidos pagos e unidades são medidas distintas. Ausência de consulta não significa zero vendas.",
      ],
    };
  if (kind === "quality")
    return {
      title: "Qualidade e checklist",
      subtitle,
      rows: [
        {
          label: "Qualidade informada pelo ML",
          value:
            o.ml?.health == null
              ? "Não fornecida"
              : `${Math.round(o.ml.health * 100)} / 100`,
        },
        ...(o.quality || []).map((q: Row) => ({
          label: q.title,
          value: q.action,
        })),
      ],
      notes: [
        "O checklist é uma análise própria de campos e mídia. Não representa experiência de compra, posição ou ranking oficial do ML.",
      ],
      action: { label: "Conferir anúncio", run: () => onPreview(o.id) },
    };
  if (kind === "pending")
    return {
      title: "Pendências do anúncio",
      subtitle,
      rows: o.pending.map((label: string) => ({ label, value: "A conferir" })),
      notes: o.pending.length
        ? undefined
        : ["Nenhuma pendência nas verificações disponíveis."],
      action,
    };
  if (kind === "updated")
    return {
      title: "Edição local",
      subtitle,
      rows: [
        {
          label: "Última alteração no sistema",
          value: listingDateTime(o.updated_at),
        },
      ],
      notes: [
        "Esta data é de edição local. A sincronização de toda a tela está no botão ML da barra de controles.",
      ],
    };
  return {
    title:
      kind === "settlement"
        ? "Recebimento estimado"
        : "Margem e limites de preço",
    subtitle,
    rows: [
      { label: "Preço atual", value: money(o.price) },
      {
        label: "Após tarifa e frete",
        value: money(o.settlementEstimate?.amount),
      },
      {
        label: "Margem de contribuição",
        value: financial?.ready
          ? `${money(o.calculation.margin)} · ${percent(o.calculation.marginPercent)}`
          : "Complete os custos para calcular",
      },
      { label: "Preço mínimo estimado", value: money(o.calculation.minPrice) },
      {
        label: "Desconto máximo estimado",
        value: listingDiscountLimit(o.calculation.maxDiscount),
      },
      ...(o.calculation.pending || []).map((label: string) => ({
        label,
        value: "Pendente",
      })),
    ],
    notes: [
      "Recebimento após tarifa e frete ainda não desconta custos próprios, impostos ou ajustes efetivos da venda.",
      "Piso e desconto usam os custos atuais e a margem mínima configurada. Revalide tarifa, frete e campanhas para um novo preço; não são garantia de lucro nem autorização para alterar o ML.",
    ],
    action,
  };
}
