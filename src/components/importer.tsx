"use client";
import { useRef, useState } from "react";
import { Upload, Check, ArrowRight, LoaderCircle } from "lucide-react";
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
import { useToastMessage } from "./toasts";
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
  purchaseCost: "Custo de compra (R$)",
  productId: "ID do produto",
  productVersion: "Versão do produto",
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
  purchaseCost: [
    "purchasecost",
    "custodecompra",
    "precocusto",
    "custofornecedor",
  ],
  productId: ["productid", "iddoproduto"],
  productVersion: ["productversion", "versaodoproduto"],
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
  onDone: (count: number, kind: string) => void;
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
  useToastMessage(error);
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
        for (const key of ["price", "purchaseCost"]) {
          if (key === "purchaseCost" && !mapping.purchaseCost) continue;
          const price = result[key];
          result[key] = price
            ? price.includes(",")
              ? price.replaceAll(".", "").replace(",", ".")
              : price
            : null;
        }
        if (result.version) result.version = Number(result.version);
        else delete result.version;
        if (result.productVersion)
          result.productVersion = Number(result.productVersion);
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
      onDone(body.rows.length, mode === "costs" ? "produtos" : "anúncios");
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
  const requiredFields =
    mode === "costs"
      ? ["productId", "productVersion", "purchaseCost"]
      : ["name", "title", ...(mode === "update" ? ["id", "version"] : [])];
  return (
    <div>
      <div className="alert">
        Excel .xlsx ou CSV, até {MAX_IMPORT_ROWS} linhas e 2 MB. Confira a
        prévia antes de confirmar. Kits e variações são editados pela ficha.
      </div>
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
              <option value="costs">Atualizar custos de produtos</option>
            </select>
          </Field>
        </div>
        {mode === "update" && (
          <p className="small muted">
            Use ID e versão da exportação. Título, descrição, SKU, código ML e
            situação podem ser atualizados. Para custos compartilhados,
            selecione a operação Atualizar custos de produtos e a aba Produtos
            da exportação.
          </p>
        )}
        {mode === "costs" && (
          <p className="small muted">
            Use a aba Produtos da exportação, com ID e versão do produto. O
            custo vale para todos os anúncios vinculados, incluindo kits. Custos
            específicos dos anúncios são preservados. Uma célula vazia remove o
            custo compartilhado e deixa a informação pendente.
          </p>
        )}
        <label className="upload-zone">
          {loading ? (
            <LoaderCircle size={26} className="spin" />
          ) : (
            <Upload size={26} />
          )}
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
              open={requiredFields.some((key) => !mapping[key])}
            >
              <summary>Conferir mapeamento das colunas</summary>
              <div className="form-grid">
                {Object.entries(fields)
                  .filter(
                    ([key]) =>
                      mode !== "costs" ||
                      ["productId", "productVersion", "purchaseCost"].includes(
                        key,
                      ),
                  )
                  .map(([key, label]) => (
                    <Field key={key} label={label}>
                      <select
                        disabled={locked}
                        value={mapping[key] || ""}
                        required={requiredFields.includes(key)}
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
            {mode === "costs"
              ? "Atualiza o custo compartilhado e exige revisão das propostas afetadas; o histórico é preservado."
              : mode === "update"
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
                      <th>{mode === "costs" ? "Custo de compra" : "Preço"}</th>
                      <th>Validação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line}>
                        <td>{r.line}</td>
                        <td>
                          {r.data.title}
                          <small>
                            {mode === "costs"
                              ? r.data.productId
                              : r.data.sku || "Sem SKU"}
                          </small>
                        </td>
                        <td>
                          {money(
                            mode === "costs"
                              ? r.data.purchaseCost
                              : r.data.price,
                          )}
                        </td>
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
            {loading && <LoaderCircle size={16} className="spin" />}
            {loading
              ? "Importando…"
              : completed
                ? "Retomar importação"
                : `Confirmar importação de ${preview.total} ${mode === "costs" ? "produtos" : "anúncios"}`}
          </button>
        </section>
      )}
    </div>
  );
}
