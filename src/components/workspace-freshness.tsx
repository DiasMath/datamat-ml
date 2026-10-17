"use client";
import { useId, useRef } from "react";
import { Info } from "lucide-react";
import type { AnalyticsReport } from "../domain/analytics";

type Row = Record<string, any>;
export type AnalysisFreshness = {
  scope: string;
  report: AnalyticsReport | null;
  error?: string;
};

export default function WorkspaceFreshness({
  data,
  section,
  error,
  analysis,
}: {
  data: Row;
  section: string;
  error?: string;
  analysis?: AnalysisFreshness;
}) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const report = analysis?.report;
  const sources = data.listingOverview?.sync || [];
  const catalogue = ["anuncios", "precificacao", "concorrencia"].includes(
    section,
  );
  const partial = catalogue && sources.some((s: Row) => s.partial || s.error);
  const failure = error || analysis?.error;
  const observedAt =
    section === "analises"
      ? report?.stores
          .map((s) => s.observedAt)
          .filter(Boolean)
          .sort()[0]
      : data.sales?.observedAt || data.listingOverview?.generatedAt;
  const complete =
    !failure && (section === "analises" ? report?.complete : !partial);
  const status = failure
    ? "Atualização pendente"
    : section === "analises" && !report?.available
      ? "Sem consulta de vendas"
      : complete
        ? "Dados completos"
        : "Dados parciais";
  const time =
    observedAt && Number.isFinite(Date.parse(observedAt))
      ? new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(observedAt))
      : null;
  return (
    <div className="today-freshness">
      <span
        className={"dot " + (complete ? "is-current" : "")}
        aria-hidden="true"
      />
      <span>
        {time ? `Consultado às ${time} · ` : ""}
        {status}
      </span>
      <button
        className="icon-button today-coverage-help"
        aria-label="Ver origem e atualização dos dados"
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (popover.current) {
            const width = Math.min(340, window.innerWidth - 24);
            popover.current.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
            popover.current.style.top = `${Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight / 2))}px`;
          }
        }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <div
        id={id}
        popover="auto"
        ref={popover}
        className="today-coverage-popover"
      >
        <h3>Atualização dos dados</h3>
        <p>
          {section === "analises"
            ? "O horário corresponde à consulta de vendas mais antiga das lojas selecionadas. A cobertura só fica completa quando todas as lojas retornam os pedidos do período."
            : "O horário corresponde à consulta do cadastro salvo no sistema. Dados completos indica que essa leitura foi concluída; não significa que todos os custos e indicadores do Mercado Livre já foram consultados."}
        </p>
        {failure && <p>{failure}</p>}
        {catalogue && sources.length > 0 && (
          <ul>
            {sources.map((s: Row) => (
              <li key={s.storeId}>
                <strong>{s.storeName}</strong>
                <span>
                  {s.error ||
                    (s.partial
                      ? "Importação do catálogo incompleta."
                      : s.lastCatalogSync
                        ? "Catálogo sincronizado."
                        : "Sem sincronização completa do catálogo ML.")}
                </span>
                {s.lastCatalogSync && (
                  <small>
                    Última sincronização completa:{" "}
                    {new Intl.DateTimeFormat("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(s.lastCatalogSync))}
                  </small>
                )}
              </li>
            ))}
          </ul>
        )}
        {report && (
          <ul>
            {report.stores.map((s) => (
              <li key={s.storeId}>
                <strong>{s.storeName}</strong>
                <span>
                  {s.error ||
                    (!s.connected
                      ? "Conta ML não conectada."
                      : s.complete
                        ? "Consulta disponível."
                        : "Consulta de vendas incompleta.")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
