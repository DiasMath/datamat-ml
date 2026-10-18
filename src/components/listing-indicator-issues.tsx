"use client";
import { useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Modal } from "./ui";
export type IndicatorIssue = {
  id: string;
  metrics: boolean;
  fees: boolean;
  error?: string;
};
export default function ListingIndicatorIssues({
  issues,
  choices,
  busy,
  onRetry,
}: {
  issues: IndicatorIssue[];
  choices: Record<string, any>[];
  busy: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!issues.length) return null;
  return (
    <>
      <button
        className="button compact listing-indicator-issues-button"
        aria-label="Ver pendências da última consulta ML"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        <AlertCircle size={14} />
        {issues.length}
      </button>
      {open && (
        <Modal
          title="Pendências da última consulta ML"
          subtitle="A reconsulta solicita apenas os dados que não foram concluídos nesta loja."
          protectChanges={false}
          onClose={() => setOpen(false)}
        >
          <ul className="listing-indicator-issues-list">
            {issues.map((issue) => {
              const offer = choices.find((o) => o.id === issue.id);
              return (
                <li key={issue.id}>
                  <strong>{offer?.title || "Anúncio da loja"}</strong>
                  <span>
                    {[
                      !issue.metrics && "Métricas de 7 dias",
                      !issue.fees && "Tarifas e frete",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {issue.error && <small>{issue.error}</small>}
                </li>
              );
            })}
          </ul>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onRetry();
            }}
          >
            <RefreshCw size={15} />
            Reconsultar dados pendentes
          </button>
        </Modal>
      )}
    </>
  );
}
