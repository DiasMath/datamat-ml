"use client";
import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { Activity, Pause, Play, RefreshCw } from "lucide-react";
import type { routineReport } from "@/server/routine";
import { money, jsonRequest } from "./ui";
import Skeleton from "./skeleton";
import Collection from "./collection";
import { useToast, useToastMessage } from "./toasts";

type Report = Awaited<ReturnType<typeof routineReport>>;
export default function RoutineToday({
  store,
  canRefresh,
  onOpen,
  navigate,
  onCreated,
}: {
  store: string;
  canRefresh: boolean;
  onOpen: (id: string) => void;
  navigate: (path: string, params?: URLSearchParams) => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const [working, setWorking] = useState(false);
  async function task(storeId: string, kind: string, reference: string) {
    setWorking(true);
    try {
      await jsonRequest("/api/routine/task", { storeId, kind, reference });
      notify("Tarefa criada ou recuperada em Ações.");
      onCreated();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setWorking(false);
    }
  }
  const [data, setData] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(false);
  const trigger = useRef<() => void>(() => {});
  const loadedStore = useRef("");
  useToastMessage(error);
  useToastMessage(
    data?.updates
      .filter((u) => u.error)
      .map((u) => `${u.storeName}: ${u.error}`)
      .join(" · "),
    "warning",
  );
  useEffect(() => {
    let disposed = false,
      running = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    if (loadedStore.current !== store) {
      setData(null);
      loadedStore.current = store;
    }
    setLoading(true);
    setError("");
    async function load(refresh: boolean) {
      if (disposed || running || (refresh && document.hidden)) return;
      running = true;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/routine${refresh ? "/refresh" : ""}?` +
            new URLSearchParams({ store }),
          {
            method: refresh ? "POST" : "GET",
            headers: refresh
              ? { "Content-Type": "application/json" }
              : undefined,
            body: refresh ? "{}" : undefined,
            signal: controller.signal,
            cache: "no-store",
          },
        );
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error || "Não foi possível atualizar a rotina");
        if (!disposed) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (!disposed && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        running = false;
        if (!disposed) {
          setLoading(false);
          if (canRefresh && !paused && !document.hidden)
            timer = setTimeout(() => load(true), 60000);
        }
      }
    }
    const refresh = () => {
      if (timer) clearTimeout(timer);
      void load(true);
    };
    trigger.current = refresh;
    const visibility = () => {
      if (timer) clearTimeout(timer);
      if (!document.hidden && !paused && canRefresh) refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    void load(false).then(() => {
      if (!disposed && canRefresh && !paused) {
        if (timer) clearTimeout(timer);
        void load(true);
      }
    });
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [store, canRefresh, paused]);
  const observed = data?.report.stores
    .filter((s) => s.observedAt)
    .map((s) => s.observedAt!)
    .sort()[0];
  const covered = data?.sales.filter((s) => s.observed !== null) || [];
  const contribution = covered.reduce(
    (n, s) => n.plus(s.observed!),
    new Decimal(0),
  );
  const coveredRevenue = covered.reduce(
    (n, s) => n.plus(s.revenue),
    new Decimal(0),
  );
  const revenue = new Decimal(data?.report.current.revenue || "0");
  const coverage = revenue.gt(0)
    ? coveredRevenue.div(revenue).mul(100).toFixed(1)
    : null;
  const low = data?.sales.filter((s) => s.lowMargin).length || 0;
  const questions = data?.report.stores
    .filter((s) => s.unanswered != null)
    .reduce((n, s) => n + s.unanswered!, 0);
  const shipments =
    data?.report.stores.flatMap((s) =>
      (s.shipping?.entries || []).map((e) => ({
        ...e,
        storeName: s.storeName,
      })),
    ) || [];
  return (
    <section className="routine-today panel">
      <div className="panel-heading">
        <div>
          <h2>Vendas de hoje</h2>
          <small className="muted">
            {observed
              ? `${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(observed))} · Brasília · ${data?.report.complete ? "período completo" : "dados parciais"}`
              : "Aguardando consulta da loja"}
          </small>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button"
            aria-label={
              paused
                ? "Retomar atualização automática"
                : "Pausar atualização automática"
            }
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            className="button"
            disabled={!canRefresh || loading}
            onClick={() => trigger.current()}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            Atualizar ML
          </button>
          <button
            className="button"
            onClick={() =>
              navigate("analises/ao-vivo", new URLSearchParams({ store }))
            }
          >
            <Activity size={15} />
            Análise ao vivo
          </button>
        </div>
      </div>
      <div aria-busy={loading}>
        {loading && (!data || !data.report.available) ? (
          <Skeleton variant="analytics" label="Carregando vendas de hoje" />
        ) : data ? (
          <>
            <div className="analytics-kpis">
              {[
                [
                  "Receita de produtos",
                  data.report.available
                    ? money(data.report.current.revenue)
                    : "—",
                ],
                [
                  "Pedidos pagos",
                  data.report.available ? data.report.current.paidOrders : "—",
                ],
                [
                  "Contribuição estimada",
                  covered.length ? money(contribution.toFixed(2)) : "—",
                ],
                ["Vendas abaixo da margem", data.report.available ? low : "—"],
              ].map(([label, value]) => (
                <div className="analytics-metric" key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="small muted">
              Tarifa registrada no pedido + demais custos estimados do cadastro.
              Cobertura:{" "}
              {coverage === null ? "indisponível" : `${coverage}% da receita`}.{" "}
              {paused
                ? "Atualização automática pausada."
                : "Atualiza a cada 60 s enquanto esta tela estiver aberta."}
            </p>
            <div className="routine-signals">
              {data.report.stores.some((s) => s.unanswered != null) && (
                <span>{questions} pergunta(s) sem resposta</span>
              )}
              {shipments.some((s) => s.late) && (
                <span className="negative">
                  {shipments.filter((s) => s.late).length} envio(s) com prazo de
                  despacho vencido
                </span>
              )}
              {shipments.some((s) => s.status === "ready_to_ship") && (
                <span>
                  {shipments.filter((s) => s.status === "ready_to_ship").length}{" "}
                  envio(s) pronto(s) para despachar
                </span>
              )}
              <button
                className="text-link"
                onClick={() =>
                  navigate("analises", new URLSearchParams({ store }))
                }
              >
                Ver operação e indicadores
              </button>
            </div>
            <details className="routine-details">
              <summary>Pendências da operação</summary>
              <div className="bounded-list">
                {data.report.stores
                  .filter((s) => s.unanswered && s.unanswered > 0)
                  .map((s) => (
                    <div className="list-item" key={s.storeId}>
                      <div>
                        <strong>{s.unanswered} perguntas sem resposta</strong>
                        <small>{s.storeName}</small>
                      </div>
                      {canRefresh && (
                        <button
                          className="button compact"
                          disabled={working}
                          onClick={() =>
                            task(s.storeId, "question", "unanswered")
                          }
                        >
                          Criar tarefa
                        </button>
                      )}
                    </div>
                  ))}
                {data.report.stores.flatMap((s) =>
                  (s.shipping?.entries || [])
                    .filter((e) => e.late || e.status === "ready_to_ship")
                    .map((e) => (
                      <div className="list-item" key={s.storeId + e.id}>
                        <div>
                          <strong>
                            Envio {e.id} ·{" "}
                            {e.late
                              ? "prazo de despacho vencido"
                              : "pronto para despachar"}
                          </strong>
                          <small>
                            {s.storeName} · amostra de envios recentes
                          </small>
                        </div>
                        {canRefresh && (
                          <button
                            className="button compact"
                            disabled={working}
                            onClick={() => task(s.storeId, "shipment", e.id)}
                          >
                            Criar tarefa
                          </button>
                        )}
                      </div>
                    )),
                )}
                {!questions &&
                  !shipments.some(
                    (s) => s.late || s.status === "ready_to_ship",
                  ) && (
                    <p className="muted">
                      Nenhuma pendência identificada nos dados disponíveis.
                    </p>
                  )}
              </div>
            </details>
            <details className="routine-details">
              <summary>
                Vendas e margem{" "}
                <span className="count-pill">{data.sales.length}</span>
              </summary>
              <Collection
                id="routineSales"
                rows={data.sales}
                label="Vendas e margem"
              >
                {(rows) => (
                  <table>
                    <thead>
                      <tr>
                        <th>Pedido / produto</th>
                        <th>Receita</th>
                        <th>Contribuição prevista</th>
                        <th>Contribuição ajustada*</th>
                        <th>Diferença</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr key={s.storeId + s.id}>
                          <td>
                            <strong>#{s.id}</strong>
                            <br />
                            {s.offerId ? (
                              <button
                                className="text-link"
                                onClick={() => onOpen(s.offerId!)}
                              >
                                {s.title}
                              </button>
                            ) : (
                              s.title
                            )}
                          </td>
                          <td>{money(s.revenue)}</td>
                          <td>{money(s.expected)}</td>
                          <td className={s.lowMargin ? "negative" : ""}>
                            {money(s.observed)}
                            {s.lowMargin && canRefresh && (
                              <button
                                className="text-link"
                                disabled={working}
                                onClick={() => task(s.storeId, "sale", s.id)}
                              >
                                Criar tarefa
                              </button>
                            )}
                            {s.lowMargin && <small> · abaixo da margem</small>}
                          </td>
                          <td>{money(s.difference)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Collection>
              {!data.sales.length && (
                <p className="muted">Nenhuma venda paga disponível hoje.</p>
              )}
              <p className="small muted">
                * Contribuição estimada usando a tarifa efetiva do item. Não
                representa lucro conciliado; frete, impostos, publicidade e
                mercadoria usam custos atuais. Pedidos com dados incompletos
                permanecem indisponíveis.
              </p>
            </details>
            <details className="routine-details">
              <summary>
                Reposição de estoque{" "}
                <span className="count-pill">
                  {data.stock.filter((s) => s.urgency !== "normal").length}
                </span>
              </summary>
              <Collection
                id="routineStock"
                rows={data.stock}
                label="Cobertura de estoque"
              >
                {(rows) => (
                  <table>
                    <thead>
                      <tr>
                        <th>Anúncio</th>
                        <th>Estoque</th>
                        <th>Vendidos / 7 dias</th>
                        <th>Cobertura</th>
                        <th>Leitura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <tr key={s.offerId}>
                          <td>
                            <button
                              className="text-link"
                              onClick={() => onOpen(s.offerId)}
                            >
                              {s.title}
                            </button>
                          </td>
                          <td>{s.quantity ?? "—"}</td>
                          <td>{s.units ?? "—"}</td>
                          <td>
                            {s.coverage == null ? "—" : `${s.coverage} dias`}
                          </td>
                          <td>
                            {s.urgency !== "normal" && canRefresh && (
                              <button
                                className="text-link"
                                disabled={working}
                                onClick={() =>
                                  task(s.storeId, "stock", s.offerId)
                                }
                              >
                                Criar tarefa
                              </button>
                            )}
                            {s.urgency === "empty"
                              ? "Sem estoque"
                              : s.urgency === "replenish"
                                ? "Priorizar reposição"
                                : s.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Collection>
              <p className="small muted">
                Média dos últimos 7 dias completos. Estoque por anúncio; kits,
                variações e anúncios que compartilham mercadoria exigem revisão.
                Estoque com mais de 30 minutos e vendas parciais não geram
                previsão.
              </p>
            </details>
          </>
        ) : (
          <p className="muted">
            Não foi possível carregar. Use Atualizar ML para tentar novamente.
          </p>
        )}
      </div>
    </section>
  );
}
