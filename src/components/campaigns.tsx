"use client";
import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import {
  campaignColumns,
  campaignImport,
  campaignIndicators,
  campaignSchema,
  type Campaign,
} from "@/domain/campaigns";
import { parseCsv, csvCell } from "@/domain/csv";
import {
  spreadsheetTable,
  assertWorkbookSize,
  MAX_IMPORT_BYTES,
} from "@/domain/spreadsheet";
import { useSmartTable } from "./smart-table";
import {
  Field,
  Modal,
  Empty,
  Submit,
  money,
  percent,
  jsonRequest,
  date,
} from "./ui";
import { useToast } from "./toasts";
import Skeleton from "./skeleton";
import Collection from "./collection";
type Row = Record<string, any>;
const stateLabels: Record<string, string> = {
  loss: "Contribuição negativa",
  attention: "Revisar",
  positive: "Contribuição positiva",
  unknown: "Sem margem informada",
};
const empty = (store: string, from: string, to: string): Campaign => ({
  storeId: store,
  campaignKey: "",
  name: "",
  from,
  to,
  status: "unknown",
  spend: "0.00",
  attributedRevenue: null,
  impressions: null,
  clicks: null,
  orders: null,
  marginBeforeAds: null,
  targetAcos: null,
  version: 0,
});
function download(headers: readonly string[], rows: unknown[][], name: string) {
  const blob = new Blob(
    [
      "\uFEFF" +
        [headers, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function Campaigns({
  data,
  store,
  from,
  to,
  totalRevenue,
  onChanged,
}: {
  data: Row;
  store: string;
  from: string;
  to: string;
  totalRevenue: string | null;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false),
    [revision, setRevision] = useState(0),
    [excluded, setExcluded] = useState(0),
    [modal, setModal] = useState<Row | null>(null),
    [preview, setPreview] = useState<Campaign[] | null>(null),
    [busy, setBusy] = useState(false),
    [q, setQ] = useState(""),
    [error, setError] = useState("");
  const operation = useRef(crypto.randomUUID()),
    input = useRef<HTMLInputElement>(null),
    lastQuery = useRef(""),
    editingDirty = useRef(false);
  const canWrite = data.user.role !== "viewer",
    query = new URLSearchParams({ store, from, to }).toString();
  useEffect(() => {
    let active = true;
    setLoading(true);
    if (lastQuery.current !== query) {
      setLoaded(false);
      setRows([]);
      lastQuery.current = query;
    }
    setError("");
    jsonRequest("/api/campaigns?" + query)
      .then((result) => {
        if (active) {
          setRows(result.rows);
          setExcluded(result.excluded);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          notify(e.message, "error");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, revision, notify]);
  const filtered = rows.filter((r) =>
    (
      r.name +
      " " +
      r.campaignKey +
      " " +
      (data.stores.find((s: Row) => s.id === r.store_id)?.name || "")
    )
      .toLocaleLowerCase("pt-BR")
      .includes(q.toLocaleLowerCase("pt-BR")),
  );
  const table = useSmartTable<Row>("campaigns", filtered, [
    {
      id: "name",
      label: "Campanha / período",
      width: 250,
      value: (r) => r.name,
    },
    {
      id: "store",
      label: "Loja",
      width: 125,
      value: (r) => data.stores.find((s: Row) => s.id === r.store_id)?.name,
    },
    {
      id: "spend",
      label: "Investimento",
      width: 125,
      value: (r) => r.spend,
      kind: "number",
    },
    {
      id: "revenue",
      label: "Receita atribuída",
      width: 145,
      value: (r) => r.attributedRevenue,
      kind: "number",
    },
    {
      id: "roas",
      label: "ROAS",
      width: 90,
      value: (r) => r.indicators.roas,
      kind: "number",
    },
    {
      id: "acos",
      label: "ACOS",
      width: 95,
      value: (r) => r.indicators.acos,
      kind: "number",
    },
    {
      id: "ctr",
      label: "CTR",
      width: 90,
      value: (r) => r.indicators.ctr,
      kind: "number",
    },
    {
      id: "profit",
      label: "Contribuição após Ads",
      width: 180,
      value: (r) => r.indicators.profit,
      kind: "number",
    },
    {
      id: "state",
      label: "Diagnóstico",
      width: 190,
      value: (r) => stateLabels[r.indicators.state],
    },
  ]);
  const spend = rows.reduce((n, r) => n.plus(r.spend), new Decimal(0)),
    revenue = rows.every((r) => r.attributedRevenue !== null)
      ? rows.reduce((n, r) => n.plus(r.attributedRevenue), new Decimal(0))
      : null;
  // A period-wide TACOS requires a single fully aligned report per campaign.
  const aligned =
    rows.length > 0 && rows.every((r) => r.from === from && r.to === to);
  const tacos =
    aligned && totalRevenue !== null && new Decimal(totalRevenue).gt(0)
      ? spend.div(totalRevenue).mul(100).toFixed(2)
      : null;
  function close() {
    if (
      busy ||
      (editingDirty.current &&
        !confirm("Descartar alterações ainda não salvas no relatório?"))
    )
      return;
    editingDirty.current = false;
    setModal(null);
    setPreview(null);
    operation.current = crypto.randomUUID();
  }
  async function save(values: Campaign[], source: "manual" | "spreadsheet") {
    setBusy(true);
    try {
      await jsonRequest("/api/campaigns", {
        rows: values,
        source,
        requestId: operation.current,
      });
      notify(`${values.length} relatório(s) salvo(s).`);
      editingDirty.current = false;
      setModal(null);
      setPreview(null);
      operation.current = crypto.randomUUID();
      setRevision((n) => n + 1);
      onChanged();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    setBusy(true);
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Use um arquivo de até 2 MB");
      let table;
      if (/\.xlsx$/i.test(file.name)) {
        assertWorkbookSize(await file.arrayBuffer());
        const { default: read } = await import("read-excel-file/browser");
        const sheets = await read(file);
        if (!sheets[0]) throw new Error("A planilha está vazia");
        table = spreadsheetTable(sheets[0].data);
      } else if (/\.csv$/i.test(file.name)) table = parseCsv(await file.text());
      else throw new Error("Use Excel .xlsx ou CSV");
      const found = campaignImport(table.headers, table.rows, {
        storeId: store !== "all" ? store : data.stores[0]?.id || "",
        from,
        to,
      });
      if (found.length > 40)
        throw new Error("Importe até 40 relatórios por confirmação");
      setPreview(found);
      operation.current = crypto.randomUUID();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section className="panel campaign-panel">
      <div className="panel-heading">
        <div>
          <h2>Performance das campanhas</h2>
          <p className="small muted">
            Relatórios de Product Ads por loja e período. Origem manual ou
            planilha; coleta automática da API ainda pendente.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="button compact"
            onClick={() =>
              download(campaignColumns, [], "datamat-campanhas-modelo.csv")
            }
          >
            Modelo
          </button>
          <button
            className="button compact"
            disabled={!rows.length || loading}
            onClick={() =>
              download(
                campaignColumns,
                rows.map((r) => campaignColumns.map((c) => r[c])),
                "datamat-campanhas.csv",
              )
            }
          >
            Exportar campanhas
          </button>
          {canWrite && (
            <>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                aria-label="Importar relatório de campanhas"
                onChange={(e) => {
                  if (e.target.files?.[0]) void importFile(e.target.files[0]);
                }}
              />
              <button
                className="button compact"
                disabled={busy || loading}
                onClick={() => input.current?.click()}
              >
                Importar relatório
              </button>
              <button
                className="button primary compact"
                disabled={busy || loading}
                onClick={() => {
                  editingDirty.current = false;
                  setModal({ create: true });
                }}
              >
                Novo relatório
              </button>
            </>
          )}
        </div>
      </div>
      {loading && !loaded ? (
        <Skeleton variant="analytics" />
      ) : error && !loaded ? (
        <Empty
          title="Não foi possível consultar campanhas"
          body={error}
          action={
            <button
              className="button"
              onClick={() => setRevision((n) => n + 1)}
            >
              Tentar novamente
            </button>
          }
        />
      ) : (
        <>
          {rows.length > 0 && (
            <div className="detail-stats compact-metrics">
              <div>
                <span>Investimento registrado</span>
                <strong>{money(spend.toFixed(2))}</strong>
              </div>
              <div>
                <span>Receita atribuída registrada</span>
                <strong>{money(revenue?.toFixed(2) ?? null)}</strong>
              </div>
              <div>
                <span>ROAS dos relatórios</span>
                <strong>
                  {revenue && spend.gt(0)
                    ? revenue.div(spend).toFixed(2) + "×"
                    : "Indisponível"}
                </strong>
              </div>
              <div>
                <span>TACOS do gasto registrado</span>
                <strong>{percent(tacos)}</strong>
              </div>
            </div>
          )}
          {excluded > 0 && (
            <p className="small muted">
              {excluded} relatório(s) cruza(m) os limites do filtro e não
              foi(ram) somado(s). Selecione o período completo; não rateamos
              resultados.
            </p>
          )}
          {rows.length ? (
            <>
              <Field label="Buscar campanha">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Nome, código ou loja"
                />
              </Field>
              <Collection
                id="campaigns"
                rows={table.rows}
                label="Campanhas"
                sortKey={table.sortKey}
              >
                {(visible) => (
                  <table className="smart-table" {...table.props}>
                    {table.header()}
                    <tbody>
                      {visible.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <button
                              className="text-link"
                              disabled={loading}
                              onClick={() => {
                                editingDirty.current = false;
                                setModal(r);
                              }}
                            >
                              {r.name}
                            </button>
                            <small className="cell-sub">
                              {r.from} a {r.to} ·{" "}
                              {r.status === "active"
                                ? "Ativa"
                                : r.status === "paused"
                                  ? "Pausada"
                                  : "Situação não informada"}
                            </small>
                          </td>
                          <td>
                            {
                              data.stores.find((s: Row) => s.id === r.store_id)
                                ?.name
                            }
                          </td>
                          <td>{money(r.spend)}</td>
                          <td>{money(r.attributedRevenue)}</td>
                          <td>
                            {r.indicators.roas === null
                              ? "—"
                              : r.indicators.roas + "×"}
                          </td>
                          <td>{percent(r.indicators.acos)}</td>
                          <td>{percent(r.indicators.ctr)}</td>
                          <td>{money(r.indicators.profit)}</td>
                          <td>
                            <span
                              className={
                                r.indicators.state === "positive"
                                  ? "green"
                                  : r.indicators.state === "unknown"
                                    ? "muted"
                                    : "orange"
                              }
                            >
                              {stateLabels[r.indicators.state]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Collection>
            </>
          ) : (
            <Empty
              title="Nenhum relatório neste período"
              body="Cadastre ou importe o relatório real do ML para comparar campanhas e identificar o que revisar."
            />
          )}
          <details className="expand">
            <summary>Como interpretar os indicadores</summary>
            <p className="small muted">
              ROAS = receita atribuída / investimento; ACOS = investimento /
              receita atribuída; CTR = cliques / impressões; CPC = investimento
              / cliques; CPO = investimento / pedidos. Contribuição estimada =
              receita atribuída × margem antes de Ads − investimento. Não é
              lucro líquido nem repasse. Não somamos receita atribuída à receita
              de vendas. TACOS usa somente o gasto registrado e só aparece com
              relatórios alinhados e receita completa do filtro; não garante que
              todas as campanhas foram importadas. Janelas de atribuição podem
              diferir das datas dos pedidos. Alertas são triagem para
              investigação, sem alterações automáticas de campanhas.
            </p>
          </details>
        </>
      )}
      {modal && (
        <Modal
          title={modal.create ? "Novo relatório de campanha" : modal.name}
          onClose={close}
        >
          <CampaignForm
            key={modal.id || "new"}
            initial={
              modal.create
                ? empty(
                    store !== "all" ? store : data.stores[0]?.id || "",
                    from,
                    to,
                  )
                : (modal as Campaign)
            }
            data={data}
            busy={busy}
            canWrite={canWrite}
            onChange={() => {
              editingDirty.current = true;
              operation.current = crypto.randomUUID();
            }}
            onSave={(v) => save([v], "manual")}
            onDelete={
              modal.id
                ? async () => {
                    if (
                      !confirm(
                        "Excluir este relatório local? A campanha no ML permanece intacta.",
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await jsonRequest(
                        "/api/campaigns/" + modal.id,
                        { version: modal.version, confirmed: true },
                        "DELETE",
                      );
                      notify("Relatório excluído.");
                      setModal(null);
                      setRevision((n) => n + 1);
                      onChanged();
                    } catch (e) {
                      notify((e as Error).message, "error");
                    } finally {
                      setBusy(false);
                    }
                  }
                : undefined
            }
            onTask={
              modal.id
                ? async () => {
                    try {
                      await jsonRequest(
                        "/api/campaigns/" + modal.id + "/task",
                        {},
                      );
                      notify("Tarefa de revisão criada.");
                      onChanged();
                    } catch (e) {
                      notify((e as Error).message, "error");
                    }
                  }
                : undefined
            }
          />
        </Modal>
      )}
      {preview && (
        <Modal title="Conferir importação de campanhas" onClose={close}>
          <p>
            {preview.length} relatório(s). Cada campanha precisa de um
            identificador estável e períodos sem sobreposição. Atualizações
            exigem a versão exportada.
          </p>
          <div className="bounded-list">
            {preview.map((r, i) => (
              <div className="list-item" key={i}>
                <div>
                  <strong>{r.name}</strong>
                  <small>
                    {data.stores.find((s: Row) => s.id === r.storeId)?.name ||
                      r.storeId}{" "}
                    · {r.from} a {r.to} · {money(r.spend)}
                  </small>
                </div>
              </div>
            ))}
          </div>
          <div className="form-footer">
            <span>Conferência antes de gravar no Firestore.</span>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => save(preview, "spreadsheet")}
            >
              Confirmar importação
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function CampaignForm({
  initial,
  data,
  busy,
  canWrite,
  onSave,
  onChange,
  onDelete,
  onTask,
}: {
  initial: Campaign;
  data: Row;
  busy: boolean;
  canWrite: boolean;
  onSave: (v: Campaign) => Promise<void>;
  onChange: () => void;
  onDelete?: () => Promise<void>;
  onTask?: () => Promise<void>;
}) {
  const { notify } = useToast();
  const [values, setValues] = useState<Record<string, any>>({ ...initial }),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  const parsed = campaignSchema.safeParse({
      ...Object.fromEntries(campaignColumns.map((c) => [c, values[c]])),
      campaignKey: values.campaignKey || values.name || "prévia",
      name: values.name || "prévia",
    }),
    indicators = parsed.success ? campaignIndicators(parsed.data) : null;
  const change = (key: string, v: any) => {
    setValues((s) => ({ ...s, [key]: v }));
    setDirty(true);
    onChange();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const result = campaignSchema.safeParse({
          ...Object.fromEntries(campaignColumns.map((c) => [c, values[c]])),
          campaignKey: values.campaignKey || values.name,
        });
        if (!result.success) {
          notify(result.error.issues[0].message, "error");
          return;
        }
        void onSave(result.data);
      }}
    >
      <fieldset className="bulk-controls" disabled={busy || !canWrite}>
        <div className="form-grid">
          <Field label="Loja da campanha">
            <select
              value={values.storeId}
              disabled={initial.version > 0}
              onChange={(e) => change("storeId", e.target.value)}
            >
              {data.stores.map((s: Row) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nome da campanha">
            <input
              required
              maxLength={200}
              value={values.name}
              onChange={(e) => change("name", e.target.value)}
            />
          </Field>
          <Field label="Início do relatório">
            <input
              type="date"
              required
              disabled={initial.version > 0}
              value={values.from}
              onChange={(e) => change("from", e.target.value)}
            />
          </Field>
          <Field label="Fim do relatório">
            <input
              type="date"
              required
              disabled={initial.version > 0}
              value={values.to}
              onChange={(e) => change("to", e.target.value)}
            />
          </Field>
          {[
            ["spend", "Investimento (R$)"],
            ["attributedRevenue", "Receita atribuída (R$)"],
            ["marginBeforeAds", "Margem antes de Ads (%)"],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                type="number"
                min={k === "marginBeforeAds" ? -100 : 0}
                max={
                  k === "marginBeforeAds" || k === "targetAcos"
                    ? 100
                    : undefined
                }
                step={
                  ["impressions", "clicks", "orders"].includes(k) ? 1 : 0.01
                }
                required={k === "spend"}
                value={values[k] ?? ""}
                onChange={(e) =>
                  change(
                    k,
                    e.target.value === ""
                      ? null
                      : ["impressions", "clicks", "orders"].includes(k)
                        ? Number(e.target.value)
                        : e.target.value,
                  )
                }
              />
            </Field>
          ))}
        </div>
        <details className="expand">
          <summary>Identificador e indicadores adicionais</summary>
          <div className="form-grid">
            <Field
              label="Identificador da campanha"
              hint="Use o ID do ML. Sem ID, o nome será a chave do cadastro."
            >
              <input
                value={values.campaignKey}
                disabled={initial.version > 0}
                maxLength={200}
                onChange={(e) => change("campaignKey", e.target.value)}
              />
            </Field>
            <Field label="Situação no relatório">
              <select
                value={values.status}
                onChange={(e) => change("status", e.target.value)}
              >
                <option value="unknown">Não informada</option>
                <option value="active">Ativa</option>
                <option value="paused">Pausada</option>
              </select>
            </Field>
            {[
              ["impressions", "Impressões"],
              ["clicks", "Cliques"],
              ["orders", "Pedidos atribuídos"],
              ["targetAcos", "Meta de ACOS (%)"],
            ].map(([k, l]) => (
              <Field key={k} label={l}>
                <input
                  type="number"
                  min={k === "marginBeforeAds" ? -100 : 0}
                  max={
                    k === "marginBeforeAds" || k === "targetAcos"
                      ? 100
                      : undefined
                  }
                  step={
                    ["impressions", "clicks", "orders"].includes(k) ? 1 : 0.01
                  }
                  required={k === "spend"}
                  value={values[k] ?? ""}
                  onChange={(e) =>
                    change(
                      k,
                      e.target.value === ""
                        ? null
                        : ["impressions", "clicks", "orders"].includes(k)
                          ? Number(e.target.value)
                          : e.target.value,
                    )
                  }
                />
              </Field>
            ))}
          </div>
        </details>
      </fieldset>
      <div className="detail-stats compact-metrics" aria-live="polite">
        {[
          ["ROAS", indicators?.roas == null ? "—" : indicators.roas + "×"],
          ["ACOS", percent(indicators?.acos)],
          ["CTR", percent(indicators?.ctr)],
          ["CPC", money(indicators?.cpc)],
          ["CPO", money(indicators?.cpo)],
          ["Contribuição estimada após Ads", money(indicators?.profit)],
        ].map(([l, v]) => (
          <div key={l}>
            <span>{l}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <p className="small muted">
        Dados do relatório real; campos vazios permanecem desconhecidos. A
        margem deve excluir publicidade e considerar os demais custos. Registro
        local não altera orçamento ou situação no ML. Consulta registrada:{" "}
        {date((initial as Row).observed_at)}.
      </p>
      {!!indicators?.insights.length && (
        <div className="bounded-list">
          {indicators.insights.map((i) => (
            <div className="list-item" key={i.key}>
              <div>
                <strong>{i.title}</strong>
                <small>{i.action}</small>
              </div>
            </div>
          ))}
        </div>
      )}
      {canWrite && (
        <div className="form-footer">
          <div className="heading-actions">
            {onDelete && (
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                Excluir relatório
              </button>
            )}
            {onTask && !!indicators?.insights.length && (
              <button
                type="button"
                className="button"
                disabled={busy || dirty}
                onClick={() => void onTask()}
              >
                Criar tarefa de revisão
              </button>
            )}
          </div>
          <Submit busy={busy} label="Salvar relatório" />
        </div>
      )}
    </form>
  );
}
