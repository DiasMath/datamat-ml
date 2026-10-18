"use client";
import { useState } from "react";
import { History } from "lucide-react";
import { Modal, labels, money } from "./ui";
import { listingDateTime } from "./listing-global-panel";
import type { ListingChangeDetail } from "../domain/listing-changes";
type Row = Record<string, any>;
function value(
  detail: ListingChangeDetail,
  raw: ListingChangeDetail["before"],
) {
  if (raw == null || raw === "") return "Não informado";
  if (detail.field === "price") return money(raw);
  if (detail.field === "status") return labels[String(raw)] || String(raw);
  if (detail.field === "quality")
    return `${Math.round(Number(raw) * 100)} / 100`;
  if (typeof raw === "boolean") return raw ? "Sim" : "Não";
  return String(raw);
}
export default function ListingChanges({
  offer,
  onHistory,
}: {
  offer: Row;
  onHistory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const change = offer.mlRecentChange;
  if (!change) return null;
  return (
    <>
      <button
        className="listing-change-chip"
        aria-label={"Ver alterações no ML de " + offer.title}
        onClick={() => setOpen(true)}
      >
        <History size={11} />
        <span>Alterado no ML</span>
      </button>
      {open && (
        <Modal
          title="Alterações observadas no ML"
          subtitle={offer.title}
          protectChanges={false}
          onClose={() => setOpen(false)}
        >
          <p className="small muted">
            Detectadas em {listingDateTime(change.at)}. Comparação com o
            cadastro anterior à consulta.
          </p>
          {change.details?.length ? (
            <div className="listing-change-table-wrap">
              <table className="listing-change-table">
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Antes</th>
                    <th>Depois</th>
                  </tr>
                </thead>
                <tbody>
                  {change.details.map((d: ListingChangeDetail) => (
                    <tr key={d.field}>
                      <th scope="row">{d.label}</th>
                      <td>{value(d, d.before)}</td>
                      <td>{value(d, d.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              {change.fields.join(" · ") || "Condições comerciais atualizadas."}
            </p>
          )}
          <p className="small muted">
            O histórico mantém os detalhes de conteúdo e mídia. A data indica
            quando o sistema observou a alteração.
          </p>
          <button
            className="button compact"
            onClick={() => {
              setOpen(false);
              onHistory();
            }}
          >
            <History size={14} />
            Abrir histórico do anúncio
          </button>
        </Modal>
      )}
    </>
  );
}
