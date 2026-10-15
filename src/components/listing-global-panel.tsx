"use client";
import { useEffect, useRef, useState } from "react";
import { Clock, Layers, LoaderCircle, RefreshCw } from "lucide-react";
import { Modal, jsonRequest, money } from "./ui";
import { ListingHint } from "./listing-information";
type Row = Record<string, any>;
export const listingDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Não consultado";
const names: Row = {
  winning: "Ganhando",
  losing: "Perdendo",
  sharing_first_place: "Compartilhando",
  listed: "Listado",
  not_listed: "Fora da disputa",
  challenging: "Disputando",
};
export default function ListingGlobalPanel({
  overview,
  store,
  canWrite,
  canSync,
  onChanged,
  onPreview,
}: {
  overview: Row;
  store: string;
  canWrite: boolean;
  canSync: boolean;
  onChanged: () => void;
  onPreview: (id: string, tab?: string) => void;
}) {
  const [view, setView] = useState<"competition" | "sync" | null>(null);
  const [running, setRunning] = useState<"competition" | "sync" | null>(null);
  const [progress, setProgress] = useState("");
  const [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const competition = overview?.competition || {
    rows: [],
    total: 0,
    available: 0,
    unavailable: 0,
  };
  const sync: Row[] = overview?.sync || [];
  const connected = sync.filter((s) => s.status === "connected");
  const complete =
    sync.length > 0 &&
    sync.every(
      (s) =>
        s.status === "connected" &&
        s.lastCatalogSync &&
        !s.partial &&
        !s.error &&
        !s.running,
    );
  const oldest = complete
    ? [...sync].map((s) => s.lastCatalogSync).sort()[0]
    : null;
  const age = oldest ? Date.now() - Date.parse(oldest) : Infinity;
  const fresh = age >= 0 && age <= 15 * 60000;
  const selected = competition.rows.filter(
    (r: Row) =>
      filter === "all" ||
      (filter === "unknown" ? !r.available : r.status === filter),
  );
  const pages = Math.max(1, Math.ceil(selected.length / 20));
  const current = Math.min(page, pages);
  async function refresh(kind: "competition" | "sync") {
    if (running) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(kind);
    setProgress("Iniciando consulta…");
    let updated = 0,
      failed = 0;
    try {
      if (kind === "competition") {
        const ids = competition.rows
          .filter((r: Row) => connected.some((s) => s.storeId === r.storeId))
          .map((r: Row) => r.id);
        for (let i = 0; i < ids.length; i += 5) {
          setProgress(
            `Consultando catálogo: ${i + 1}–${Math.min(i + 5, ids.length)} de ${ids.length}…`,
          );
          const result = await jsonRequest(
            "/api/catalog/competition",
            { ids: ids.slice(i, i + 5) },
            "POST",
            controller.signal,
          );
          updated += result.results.filter((r: Row) => r.updated).length;
          failed += result.results.filter((r: Row) => !r.updated).length;
          onChanged();
          if (result.results.some((r: Row) => r.deferred)) break;
        }
        setProgress(
          `${updated} consultas concluídas${failed ? ` · ${failed} indisponíveis; confira a autorização e a disponibilidade do recurso no ML` : ""}.`,
        );
      } else {
        for (let step = 0; step < 20; step++) {
          setProgress(
            `Atualizando o catálogo das lojas selecionadas · etapa ${step + 1}…`,
          );
          const result = await jsonRequest(
            "/api/catalog/refresh?store=" + encodeURIComponent(store),
            {},
            "POST",
            controller.signal,
          );
          onChanged();
          if (result.results.some((r: Row) => r.status === "running")) {
            setProgress(
              "Já existe uma sincronização em andamento. Os dados serão atualizados ao concluir.",
            );
            break;
          }
          if (!result.partial) {
            setProgress(
              result.results.length
                ? "Consulta do catálogo concluída. Tarifas e métricas possuem consultas próprias."
                : "Nenhuma loja conectada para consultar.",
            );
            break;
          }
          if (step === 19)
            setProgress(
              "Consulta parcial. Continue a atualização para concluir as próximas páginas.",
            );
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setProgress((error as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        setRunning(null);
        onChanged();
      }
      request.current = null;
    }
  }
  return (
    <>
      <ListingHint
        content={{
          title: "Competitividade do catálogo",
          rows: [
            {
              label: "Catálogo das lojas selecionadas",
              value: competition.total,
            },
            {
              label: "Consultas válidas",
              value: `${competition.available} de ${competition.total}`,
            },
          ],
          notes: [
            "Visão geral, incluindo anúncios fora dos filtros da tabela. Dados vencidos ou não fornecidos pelo ML ficam separados.",
          ],
          action: {
            label: "Abrir visão geral",
            run: () => setView("competition"),
          },
        }}
      >
        <button
          className="button compact offers-global-button"
          aria-label="Competitividade do catálogo"
          onClick={() => {
            setProgress("");
            setView("competition");
          }}
        >
          <Layers size={15} />
          {running === "competition" && (
            <LoaderCircle className="spin" size={12} />
          )}
        </button>
      </ListingHint>
      <ListingHint
        content={{
          title: "Sincronização da tela com o ML",
          rows: [
            {
              label: "Lojas conectadas",
              value: `${connected.length} de ${sync.length}`,
            },
            {
              label: "Catálogo completo mais antigo",
              value: listingDateTime(oldest),
            },
          ],
          notes: [
            "Abrange todas as lojas selecionadas. Uma consulta isolada de anúncio não é uma sincronização completa do catálogo.",
          ],
          action: { label: "Ver sincronização", run: () => setView("sync") },
        }}
      >
        <button
          className="button compact offers-global-button"
          aria-label="Sincronização da tela com o ML"
          onClick={() => {
            setProgress("");
            setView("sync");
          }}
        >
          {running === "sync" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Clock size={15} />
          )}
          <span className={fresh ? "green" : "orange"}>ML</span>
          {oldest && (
            <time>
              {new Date(oldest).toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
        </button>
      </ListingHint>
      {view && (
        <Modal
          title={
            view === "competition"
              ? "Competitividade do catálogo"
              : "Sincronização da tela com o ML"
          }
          subtitle="Visão geral das lojas selecionadas, incluindo anúncios fora dos filtros da tabela."
          protectChanges={false}
          onClose={() => setView(null)}
        >
          <div className="listing-global-content">
            {view === "competition" ? (
              <>
                <div className="listing-global-stats">
                  {[
                    ["Ganhando", competition.winning],
                    ["Perdendo", competition.losing],
                    ["Compartilhando", competition.sharing],
                    ["Sem consulta válida", competition.unavailable],
                  ].map(([label, number]) => (
                    <div key={label as string}>
                      <span>{label}</span>
                      <strong>
                        {label === "Sem consulta válida" ||
                        competition.available
                          ? number
                          : "—"}
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="small muted">
                  {competition.available} de {competition.total} anúncios de
                  catálogo com consulta válida nos últimos 15 minutos. Outros
                  estados oficiais: {competition.other || 0}. Preço para
                  competir é indicativo, sem garantia de posição.
                </p>
                <div className="listing-global-actions">
                  <select
                    aria-label="Filtrar competitividade"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">Todo o catálogo</option>
                    <option value="losing">Perdendo</option>
                    <option value="winning">Ganhando</option>
                    <option value="unknown">Sem consulta válida</option>
                  </select>
                  {canWrite && (
                    <button
                      className="button compact"
                      disabled={
                        !!running || !competition.total || !connected.length
                      }
                      onClick={() => void refresh("competition")}
                    >
                      {running === "competition" ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <RefreshCw size={15} />
                      )}
                      Consultar catálogo no ML
                    </button>
                  )}
                </div>
                <div
                  className="listing-global-scroll"
                  role="region"
                  aria-label="Competitividade das lojas"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Anúncio</th>
                        <th>Situação oficial</th>
                        <th>Preço para competir</th>
                        <th>Consultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected
                        .slice((current - 1) * 20, current * 20)
                        .map((r: Row) => (
                          <tr key={r.id}>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => {
                                  setView(null);
                                  onPreview(r.id, "costs");
                                }}
                              >
                                {r.title}
                              </button>
                              <small>
                                {r.storeName} · {r.mlId}
                              </small>
                            </td>
                            <td>
                              {r.available
                                ? names[r.status]
                                : "Sem consulta válida"}
                              {r.reason && <small>{r.reason}</small>}
                            </td>
                            <td>
                              {r.available ? money(r.priceToWin) : "—"}
                              {r.belowFloor && (
                                <small className="orange">
                                  Abaixo do piso estimado
                                </small>
                              )}
                              {r.available && r.minPrice == null && (
                                <small>Piso indisponível</small>
                              )}
                            </td>
                            <td>{listingDateTime(r.observedAt)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!selected.length && (
                    <p className="muted">Nenhum anúncio neste grupo.</p>
                  )}
                </div>
                {pages > 1 && (
                  <div className="listing-global-pagination">
                    <button
                      className="button compact"
                      disabled={current <= 1}
                      onClick={() => setPage(current - 1)}
                    >
                      Anterior
                    </button>
                    <span>
                      {current} / {pages}
                    </span>
                    <button
                      className="button compact"
                      disabled={current >= pages}
                      onClick={() => setPage(current + 1)}
                    >
                      Próxima
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="listing-global-stats">
                  <div>
                    <span>Lojas conectadas</span>
                    <strong>
                      {connected.length} / {sync.length}
                    </strong>
                  </div>
                  <div>
                    <span>Catálogo completo mais antigo</span>
                    <strong className="small">{listingDateTime(oldest)}</strong>
                  </div>
                </div>
                <p className="small muted">
                  Catálogo, tarifas, competitividade e métricas possuem
                  consultas distintas. Uma data recente de anúncio isolado não
                  confirma que todas as páginas do catálogo foram concluídas.
                </p>
                <div className="listing-sync-stores">
                  {sync.map((s) => (
                    <article key={s.storeId}>
                      <header>
                        <strong>{s.storeName}</strong>
                        <span
                          className={
                            s.status === "connected" ? "green" : "orange"
                          }
                        >
                          {s.status === "connected"
                            ? "Conectado"
                            : "Conexão pendente"}
                        </span>
                      </header>
                      <dl>
                        <div>
                          <dt>Catálogo completo</dt>
                          <dd>{listingDateTime(s.lastCatalogSync)}</dd>
                        </div>
                        <div>
                          <dt>Última consulta de anúncios</dt>
                          <dd>{listingDateTime(s.lastItemSync)}</dd>
                        </div>
                        <div>
                          <dt>Última notificação ML</dt>
                          <dd>{listingDateTime(s.lastNotification)}</dd>
                        </div>
                        <div>
                          <dt>Registros importados</dt>
                          <dd>
                            {s.imported}
                            {s.catalogTotal != null
                              ? ` · ${s.catalogTotal} IDs informados pelo ML`
                              : ""}
                          </dd>
                        </div>
                      </dl>
                      <p className="small muted">
                        {s.running
                          ? "Sincronização em andamento"
                          : s.partial
                            ? "Importação parcial; há páginas pendentes"
                            : s.lastCatalogSync
                              ? "Última passagem pelo catálogo concluída"
                              : "Catálogo ainda não concluído"}
                        {s.error ? ` · ${s.error}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
                {canSync && (
                  <button
                    className="button compact"
                    disabled={!!running || !connected.length}
                    onClick={() => void refresh("sync")}
                  >
                    {running === "sync" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    Atualizar catálogo das lojas
                  </button>
                )}
              </>
            )}
            <p className="listing-global-progress small" role="status">
              {running && <LoaderCircle className="spin" size={14} />}
              {progress}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
