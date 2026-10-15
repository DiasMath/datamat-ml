"use client";
import { Truck, BadgePercent, Clock } from "lucide-react";
import { money } from "./ui";
type Row = Record<string, any>;
export default function MlFinancialConditions({
  financial,
}: {
  financial?: Row | null;
}) {
  if (!financial) return null;
  const expired = financial.expires_at <= Date.now();
  const shipping = financial.shipping;
  const promotions = financial.promotions;
  return (
    <details className="ml-financial-conditions">
      <summary>
        Frete e promoções do ML {expired ? "· atualizar consulta" : ""}
      </summary>
      <div className="ml-condition-row">
        <Truck size={14} />
        <span>Frete da loja</span>
        <strong>
          {!expired && shipping?.amount != null
            ? money(shipping.amount) + " · estimado"
            : "A conferir"}
        </strong>
      </div>
      <div className="ml-condition-row">
        <BadgePercent size={14} />
        <span>Promoções</span>
        <strong>
          {expired || promotions?.active == null
            ? "Não confirmadas"
            : promotions.active
              ? "Em andamento"
              : "Nenhuma ativa na consulta"}
        </strong>
      </div>
      {promotions?.salePrice && !expired && (
        <p className="small muted">
          Preço vigente: {money(promotions.salePrice.amount)}
          {promotions.salePrice.regularAmount != null
            ? ` · regular ${money(promotions.salePrice.regularAmount)}`
            : ""}
        </p>
      )}
      {promotions?.campaigns?.slice(0, 3).map((p: Row) => (
        <p className="small muted" key={p.id}>
          {p.name} ·{" "}
          {p.status === "started"
            ? "Ativa"
            : p.status === "candidate"
              ? "Elegível, sem adesão automática"
              : p.status}
          {p.mlPercent != null ? ` · ML ${p.mlPercent}%` : ""}
          {p.sellerPercent != null ? ` · loja ${p.sellerPercent}%` : ""}
        </p>
      ))}
      {promotions?.active && (
        <p className="small muted">
          Participação do ML não equivale a subsídio confirmado por venda.
          Confira as condições antes de alterar o preço.
        </p>
      )}
      {financial.warnings?.map((warning: string) => (
        <p className="small muted" key={warning}>
          {warning}
        </p>
      ))}
      {financial.last_error && (
        <p className="small muted">
          Última atualização pendente: {financial.last_error}
        </p>
      )}
      {financial.quoted_at && (
        <small className="ml-cost-source">
          <Clock size={11} /> Consulta{" "}
          {new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          }).format(new Date(financial.quoted_at))}
        </small>
      )}
    </details>
  );
}
