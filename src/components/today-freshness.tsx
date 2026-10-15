"use client";
import { useId, useRef } from "react";
import { ArrowUpRight, Info } from "lucide-react";
type Row = Record<string, any>;
export default function TodayFreshness({
  sales,
  store,
  navigate,
}: {
  sales: Row;
  store: string;
  navigate: (path: string, query?: URLSearchParams) => void;
}) {
  const coverageId = useId();
  const coverageRef = useRef<HTMLDivElement>(null);
  const dateTime = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(v));
  const availableStores = sales.stores.filter(
    (s: Row) => s.connected && s.observedAt,
  );
  const missingStores = availableStores.length < sales.stores.length;
  const status = sales.stores.some((s: Row) => s.error)
    ? "Atualização pendente"
    : sales.available
      ? sales.complete
        ? "Dados completos"
        : missingStores
          ? `Vendas de ${availableStores.length}/${sales.stores.length} lojas`
          : "Dados parciais"
      : "Sem consulta de vendas";
  return (
    <div className="today-freshness">
      <span className={"dot " + (sales.complete ? "is-current" : "")} />
      {sales.observedAt ? `Consultado às ${dateTime(sales.observedAt)} · ` : ""}
      {status}
      {!sales.complete && (
        <>
          <button
            className="icon-button today-coverage-help"
            aria-label="Ver cobertura das consultas de vendas"
            popoverTarget={coverageId}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (coverageRef.current) {
                const width = Math.min(340, window.innerWidth - 24);
                coverageRef.current.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
                coverageRef.current.style.top = `${Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight / 2))}px`;
              }
            }}
          >
            <Info size={14} aria-hidden="true" />
          </button>
          <div
            className="today-coverage-popover"
            id={coverageId}
            popover="auto"
            ref={coverageRef}
          >
            <h3>Consultas de vendas</h3>
            <p>
              Os totais usam as consultas disponíveis das lojas selecionadas. Os
              indicadores mensais exigem uma consulta completa de todas elas
              para confirmar a cobertura.
            </p>
            <ul>
              {sales.stores.map((source: Row) => (
                <li key={source.id}>
                  <strong>{source.name}</strong>
                  <span>
                    {!source.connected
                      ? "Conta ML não conectada."
                      : source.error
                        ? source.error
                        : !source.observedAt
                          ? "A primeira consulta de vendas ainda não foi concluída."
                          : source.complete === false
                            ? "A consulta do ML retornou somente parte dos pedidos."
                            : "Consulta disponível."}
                  </span>
                  {source.connected &&
                    !source.error &&
                    source.complete === false &&
                    source.warnings?.map((warning: string) => (
                      <small key={warning}>{warning}</small>
                    ))}
                </li>
              ))}
            </ul>
            <button
              className="text-link"
              popoverTarget={coverageId}
              popoverTargetAction="hide"
              onClick={() =>
                navigate(
                  "configuracoes",
                  new URLSearchParams({ store, configTab: "integrations" }),
                )
              }
            >
              Conferir integrações
              <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
