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
  catalogRefreshing = false,
}: {
  data: Row;
  section: string;
  error?: string;
  analysis?: AnalysisFreshness;
  catalogRefreshing?: boolean;
}) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const report = analysis?.report;
  const sources = data.listingOverview?.sync || [];
  const catalogue = ["anuncios", "precificacao", "concorrencia"].includes(
    section,
  );
  const catalogError = sources.some((s: Row) => !!s.error);
  const catalogUpdating =
    catalogRefreshing || sources.some((s: Row) => s.running);
  const catalogMissing =
    !sources.length ||
    sources.some((s: Row) => !s.lastCatalogSync || s.status !== "connected");
  const partial =
    catalogue &&
    sources.some(
      (s: Row) => s.partial || s.error || s.running || !s.lastCatalogSync,
    );
  const failure = error || analysis?.error;
  const observedAt =
    section === "analises"
      ? report?.stores
          .map((s) => s.observedAt)
          .filter(Boolean)
          .sort()[0]
      : catalogue
        ? data.listingOverview?.generatedAt
        : data.sales?.observedAt || data.listingOverview?.generatedAt;
  const complete =
    !failure &&
    (section === "analises"
      ? report?.complete
      : !(partial || (catalogue && (catalogMissing || catalogUpdating))));
  const status = failure
    ? "Atualização pendente"
    : catalogue
      ? catalogError
        ? "Atualização pendente"
        : catalogUpdating
          ? "Catálogo em atualização"
          : partial && sources.some((s: Row) => s.partial)
            ? "Catálogo parcial"
            : catalogMissing
              ? "Catálogo não sincronizado"
              : "Catálogo sincronizado"
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
            : catalogue
              ? "O horário indica quando esta tela leu o cadastro salvo. Abaixo aparece a última sincronização completa do catálogo no ML. Tarifas e indicadores têm datas de consulta próprias em cada anúncio."
              : "O horário corresponde à leitura dos dados salvos no sistema."}
        </p>
        {failure && <p>{failure}</p>}
        {catalogue && sources.length > 0 && (
          <ul>
            {sources.map((s: Row) => (
              <li key={s.storeId}>
                <strong>{s.storeName}</strong>
                <span>
                  {s.error ||
                    (s.status !== "connected"
                      ? "Conta ML não conectada; sincronizações anteriores foram preservadas."
                      : s.running || catalogRefreshing
                        ? "Consulta do catálogo em andamento."
                        : s.partial
                          ? s.lastCatalogSync
                            ? "Atualização parcial; há páginas pendentes. A última sincronização completa continua disponível."
                            : "Importação do catálogo incompleta."
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
