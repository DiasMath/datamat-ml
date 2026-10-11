"use client";
import { useRef, useState } from "react";
import { Upload, Check, ArrowRight } from "lucide-react";
import { parseCsv } from "@/domain/csv";
import {
  assertWorkbookSize,
  spreadsheetTable,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportTable,
} from "@/domain/spreadsheet";
import { Field, Submit, jsonRequest, money } from "./ui";
import Collection from "./collection";
type Row = Record<string, any>;
const fields: Record<string, string> = {
  name: "Produto *",
  title: "Título *",
  sku: "SKU",
  mlId: "Código ML",
  brand: "Marca",
  category: "Categoria",
  model: "Modelo",
  price: "Preço",
  type: "Tipo",
  status: "Situação",
  description: "Descrição",
  origin: "Procedência",
  referenceAccount: "Conta de origem",
  id: "ID interno",
  version: "Versão",
  storeId: "Loja original",
};
const aliases: Record<string, string[]> = {
  name: ["name", "produto", "nome"],
  title: ["title", "titulo", "anuncio"],
  mlId: ["mlid", "codigoml", "mlb"],
  price: ["price", "preco"],
  brand: ["brand", "marca"],
  category: ["category", "categoria"],
  status: ["status", "situacao"],
  type: ["type", "tipo"],
  description: ["description", "descricao"],
  origin: ["origin", "origem"],
  referenceAccount: ["referenceaccount", "contadeorigem"],
  id: ["id", "idinterno"],
  version: ["version", "versao"],
  storeId: ["storeid", "lojaoriginal"],
};
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
export default function Importer({
  stores,
  selected,
  busy,
  onDone,
  onDirty,
  onWorking,
}: {
  stores: Row[];
  selected: string;
  busy: boolean;
  onDone: (count: number) => void;
  onDirty: () => void;
  onWorking: (working: boolean) => void;
}) {
  const [table, setTable] = useState<ImportTable | null>(null),
    [sheets, setSheets] = useState<{ sheet: string; data: unknown[][] }[]>([]),
    [sheetIndex, setSheetIndex] = useState(0),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [store, setStore] = useState(selected === "all" ? stores[0]?.id : selected),
    [mode, setMode] = useState("create"),
    [preview, setPreview] = useState<Row | null>(null),
    [loading, setLoading] = useState(false),
    [body, setBody] = useState<Row | null>(null),
    [completed, setCompleted] = useState(0),
    [error, setError] = useState("");
  const position = useRef(0),
    keys = useRef<string[]>([]);
  function reset() {
    setPreview(null);
    setBody(null);
    setCompleted(0);
    position.current = 0;
    setError("");
  }
  function choose(data: ImportTable) {
    setTable(data);
    const m: Record<string, string> = {};
    for (const key of Object.keys(fields))
      m[key] =
        data.headers.find((h) =>
          (aliases[key] || [key]).includes(normalize(h)),
        ) || "";
    setMapping(m);
    reset();
    onDirty();
  }
  async function load(file: File | undefined) {
    if (!file) return;
    setLoading(true);
    setTable(null);
    setSheets([]);
    reset();
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Arquivo deve ter até 2 MB");
      if (/\.xlsx$/i.test(file.name)) {
        assertWorkbookSize(await file.arrayBuffer());
        const { default: readXlsxFile } =
          await import("read-excel-file/browser");
        const found = await readXlsxFile(file);
        if (!found.length) throw new Error("Planilha sem abas");
        setSheets(found);
        setSheetIndex(0);
        choose(spreadsheetTable(found[0].data));
      } else if (/\.csv$/i.test(file.name)) choose(parseCsv(await file.text()));
      else
        throw new Error(
          "Selecione Excel .xlsx ou CSV. Para .xls, salve como .xlsx no Excel",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function check(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const rows = table!.rows.map((values) => {
        const result: Row = {};
        for (const [key, column] of Object.entries(mapping))
          if (column)
            result[key] = values[table!.headers.indexOf(column)].trim();
        result.name ||= "";
        result.title ||= "";
        result.type ||= "unit";
        result.status ||= "draft";
        result.origin = result.origin === "reference" ? "reference" : "import";
        const price = result.price;
        result.price = price
          ? price.includes(",")
            ? price.replaceAll(".", "").replace(",", ".")
            : price
          : null;
        if (result.version) result.version = Number(result.version);
        else delete result.version;
        return result;
      });
      const b = { storeId: store, mode, rows };
      setPreview(await jsonRequest("/api/imports/preview", b));
      setBody(b);
      position.current = 0;
      setCompleted(0);
      keys.current = Array.from({ length: Math.ceil(rows.length / 40) }, () =>
        crypto.randomUUID(),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function confirm() {
    if (!body || busy || loading) return;
    setLoading(true);
    onWorking(true);
    setError("");
    try {
      for (; position.current < keys.current.length; position.current++) {
        const start = position.current * 40;
        await jsonRequest("/api/imports/confirm", {
          ...body,
          rows: body.rows.slice(start, start + 40),
          requestId: keys.current[position.current],
        });
        setCompleted(Math.min(start + 40, body.rows.length));
      }
      onDone(body.rows.length);
    } catch (e) {
      const message =
        (e as Error).message +
        (position.current
          ? " Os registros concluídos foram preservados. Retome a importação para continuar."
          : "");
      setError(message);
    } finally {
      setLoading(false);
      onWorking(false);
    }
  }
  const locked = busy || loading || completed > 0;
  return (
    <div>
      <div className="alert">
        Excel .xlsx ou CSV, até {MAX_IMPORT_ROWS} linhas e 2 MB. Confira a
        prévia antes de confirmar. Kits e variações são editados pela ficha.
      </div>
      {error && (
        <div role="alert" className="alert danger-text">
          {error}
        </div>
      )}
      <form onSubmit={check} className="stack">
        <div className="form-grid">
          <Field label="Loja de destino">
            <select
              disabled={locked}
              value={store}
              onChange={(e) => {
                setStore(e.target.value);
                reset();
                onDirty();
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Operação">
            <select
              disabled={locked}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                reset();
                onDirty();
              }}
            >
              <option value="create">Cadastrar novos anúncios</option>
              <option value="update">Atualizar anúncios exportados</option>
            </select>
          </Field>
        </div>
        {mode === "update" && (
          <p className="small muted">
            Use ID e versão da exportação. Título, descrição, SKU, código ML e
            situação podem ser atualizados. Produtos compartilhados e preços são
            alterados pela ficha.
          </p>
        )}
        <label className="upload-zone">
          <Upload size={26} />
          <strong>Selecionar arquivo Excel ou CSV</strong>
          <span>
            {loading
              ? "Processando…"
              : "Excel .xlsx · CSV separado por vírgula ou ponto e vírgula"}
          </span>
          <input
            disabled={locked}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => load(e.target.files?.[0])}
          />
        </label>
        <a href="/api/export/template" download className="text-link">
          Baixar modelo Excel <ArrowRight size={13} />
        </a>
        {sheets.length > 1 && (
          <Field label="Aba da planilha">
            <select
              disabled={locked}
              value={sheetIndex}
              onChange={(e) => {
                try {
                  const i = Number(e.target.value);
                  setSheetIndex(i);
                  choose(spreadsheetTable(sheets[i].data));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {sheets.map((s, i) => (
                <option key={i} value={i}>
                  {s.sheet}
                </option>
              ))}
            </select>
          </Field>
        )}
        {table && (
          <>
            <h3>Mapeamento de colunas · {table.rows.length} linhas</h3>
            <details
              className="expand"
              open={
                !mapping.name ||
                !mapping.title ||
                (mode === "update" && (!mapping.id || !mapping.version))
              }
            >
              <summary>Conferir mapeamento das colunas</summary>
              <div className="form-grid">
                {Object.entries(fields).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <select
                      disabled={locked}
                      value={mapping[key] || ""}
                      required={[
                        "name",
                        "title",
                        ...(mode === "update" ? ["id", "version"] : []),
                      ].includes(key)}
                      onChange={(e) => {
                        setMapping({ ...mapping, [key]: e.target.value });
                        reset();
                      }}
                    >
                      <option value="">Não importar / padrão</option>
                      {table.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </details>
            <Submit
              busy={loading || busy || completed > 0}
              label="Validar e visualizar prévia"
            />
          </>
        )}
      </form>
      {preview && (
        <section className="import-preview">
          <div className="panel-heading">
            <h3>
              {preview.valid && <Check size={16} />}Prévia · {preview.total}{" "}
              registros
            </h3>
            <span>{preview.pending} com pendências</span>
          </div>
          <p className="small muted">
            Destino: {stores.find((s) => s.id === store)?.name}.{" "}
            {mode === "update"
              ? "Atualização dos registros identificados; custos e histórico preservados."
              : "Novos registros, sem substituir ofertas existentes."}
          </p>
          <Collection
            id="import"
            rows={preview.rows as Row[]}
            label="Prévia da importação"
          >
            {(rows) => (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Produto / anúncio</th>
                      <th>Preço</th>
                      <th>Validação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line}>
                        <td>{r.line}</td>
                        <td>
                          {r.data.title}
                          <small>{r.data.sku || "Sem SKU"}</small>
                        </td>
                        <td>{money(r.data.price)}</td>
                        <td>
                          {r.errors.length ? (
                            <span className="danger-text">
                              {r.errors.join("; ")}
                            </span>
                          ) : r.pending.length ? (
                            <span className="orange">
                              {r.pending.join(", ")}
                            </span>
                          ) : (
                            <span className="green">Válido</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Collection>
          {(loading || completed > 0) && (
            <p role="status">
              {completed} de {preview.total} registros concluídos
            </p>
          )}
          <button
            className="button primary"
            disabled={!preview.valid || busy || loading}
            onClick={confirm}
          >
            {loading
              ? "Importando…"
              : completed
                ? "Retomar importação"
                : `Confirmar importação de ${preview.total} anúncios`}
          </button>
        </section>
      )}
    </div>
  );
}
