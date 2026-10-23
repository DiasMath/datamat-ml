"use client";
import MoneyInput from "./money-input";
import { useEffect, useRef, useState } from "react";
import { Target, Pencil, Plus, LoaderCircle, RefreshCw } from "lucide-react";
import { Field, Modal, money, percent, jsonRequest, Submit } from "./ui";
import { useToast } from "./toasts";
import { useConfirm } from "./confirmation";
type Row = Record<string, any>;
export default function MonthlyGoal({
  data,
  store,
  blocked,
  onUpdated,
}: {
  data: Row;
  store: string;
  blocked: boolean;
  onUpdated: (next: Row) => void;
}) {
  const report = data.monthlyGoal;
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(
    store === "all" ? data.stores[0]?.id || "" : store,
  );
  const { notify } = useToast(),
    confirm = useConfirm();
  const initialRequest = useRef("");
  const canWrite = data.user.role !== "viewer";
  const connected = report.goals.some((g: Row) =>
    data.connections.some(
      (c: Row) =>
        c.store_id === g.storeId &&
        c.provider === "mercadolivre" &&
        c.status === "connected",
    ),
  );
  const latest = useRef(onUpdated);
  latest.current = onUpdated;
  const requestKey =
    store +
    ":" +
    report.month +
    ":" +
    report.goals.map((g: Row) => g.storeId + ":" + g.version).join(",");
  async function refresh(manual = true) {
    if (refreshing || blocked || open || !canWrite || !connected) return;
    setRefreshing(true);
    try {
      const next = await jsonRequest(
        "/api/today/monthly-refresh?" + new URLSearchParams({ store }),
        { force: manual },
        "POST",
        undefined,
        manual ? "foreground" : "background",
      );
      latest.current(next);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (
      !blocked &&
      !open &&
      connected &&
      canWrite &&
      report.configured &&
      !report.observedAt &&
      initialRequest.current !== requestKey
    ) {
      initialRequest.current = requestKey;
      void refresh(false);
    }
  }, [requestKey, blocked, open, connected, canWrite, report.observedAt]);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(report.month + "-01T12:00:00Z"));
  const goal = report.goals.find((g: Row) => g.storeId === selected);
  async function reload() {
    const next = await jsonRequest(
      "/api/today?" + new URLSearchParams({ store }),
      undefined,
      "GET",
    );
    onUpdated(next);
  }
  return (
    <section
      className="panel today-monthly-goal"
      aria-label="Meta mensal"
      aria-busy={refreshing}
    >
      <header>
        <h3>
          <Target size={15} /> Meta mensal <small>{monthLabel}</small>
        </h3>
        {canWrite && (
          <button
            className="icon-button"
            aria-label={
              report.configured ? "Editar meta mensal" : "Definir meta mensal"
            }
            disabled={refreshing || blocked}
            onClick={() => {
              setSelected(store === "all" ? data.stores[0]?.id || "" : store);
              setOpen(true);
            }}
          >
            {report.configured ? <Pencil size={14} /> : <Plus size={15} />}
          </button>
        )}
      </header>
      {report.configured ? (
        <>
          <div className="monthly-goal-values">
            <strong>{report.available ? money(report.revenue) : "—"}</strong>
            <span>de {money(report.target)}</span>
            {report.complete && <b>{percent(report.percent)}</b>}
          </div>
          {report.complete && (
            <meter
              min={0}
              max={100}
              value={Math.min(100, Number(report.percent))}
              aria-label="Progresso da meta mensal"
            />
          )}
          <div className="monthly-goal-caption">
            <span>
              {report.complete
                ? Number(report.remaining) > 0
                  ? `${money(report.perDay)} por dia para alcançar a meta`
                  : "Meta do mês alcançada"
                : report.available
                  ? "Vendas parciais; progresso ainda não confirmado"
                  : "Aguardando consulta de vendas do mês"}
            </span>
            {canWrite && connected && (
              <button
                className="icon-button"
                disabled={refreshing || blocked || open}
                aria-label="Atualizar vendas do mês"
                onClick={() => void refresh()}
              >
                {refreshing ? (
                  <LoaderCircle size={13} className="spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
              </button>
            )}
          </div>
          {report.observedAt && (
            <small className="muted monthly-goal-time">
              Consultado às{" "}
              {new Intl.DateTimeFormat("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Sao_Paulo",
              }).format(new Date(report.observedAt))}
            </small>
          )}
          {store === "all" && (
            <small className="muted">
              Meta e vendas de {report.configured}/{report.totalStores} lojas
              com meta definida.
            </small>
          )}
        </>
      ) : (
        <p className="small muted">
          Defina o faturamento esperado para acompanhar o mês.
        </p>
      )}
      {open && (
        <Modal
          title="Meta mensal de faturamento"
          subtitle={monthLabel}
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await jsonRequest("/api/today/goal", {
                  storeId: selected,
                  month: report.month,
                  target: String(form.get("target") || ""),
                  version: goal?.version || 0,
                });
                setOpen(false);
                notify("Meta mensal salva.");
                await reload();
              } catch (error) {
                notify((error as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset className="goal-fields" disabled={busy}>
              <Field label="Loja da meta *">
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  required
                >
                  {data.stores
                    .filter((s: Row) => store === "all" || s.id === store)
                    .map((s: Row) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label="Meta de faturamento (R$) *"
                hint="Considera vendas pagas do Mercado Livre, antes de custos e despesas."
              >
                <MoneyInput
                  key={selected}
                  name="target"
                  required
                  defaultValue={goal?.target || ""}
                  autoFocus
                  maxAmount="999999999999"
                />
              </Field>
            </fieldset>
            <div className="form-footer">
              {goal && (
                <button
                  type="button"
                  className="text-link danger-text"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: "Remover meta mensal?",
                        description:
                          "As vendas permanecem disponíveis. A meta desta loja e mês será removida.",
                        confirmLabel: "Remover meta",
                        danger: true,
                      }))
                    )
                      return;
                    setBusy(true);
                    try {
                      await jsonRequest(
                        "/api/today/goal",
                        {
                          storeId: selected,
                          month: report.month,
                          version: goal.version,
                        },
                        "DELETE",
                      );
                      setOpen(false);
                      notify("Meta mensal removida.");
                      await reload();
                    } catch (e) {
                      notify((e as Error).message, "error");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remover meta
                </button>
              )}
              <Submit busy={busy} label="Salvar meta mensal" />
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
