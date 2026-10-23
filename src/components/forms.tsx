"use client";
import MoneyInput from "./money-input";
import { useState } from "react";
import { automaticMlCosts, effectiveMlCosts } from "../domain/ml-financial";
import AutocompleteInput from "./autocomplete";
import { useToastMessage } from "./toasts";
import { Plus, Trash2, LoaderCircle } from "lucide-react";
import { Field, Submit, labels, string, nullable, money, percent } from "./ui";
import {
  calculate,
  costSchema,
  type Costs,
  type Parameters,
} from "@/domain/finance";
type Row = Record<string, any>;
type Props = {
  data: Row;
  initial?: Row;
  busy: boolean;
  onSave: (data: Row) => void;
  onDirty: () => void;
};
export const costFields: Record<string, string> = {
  goods: "Mercadoria neste anúncio (R$)",
  mlPercent: "Tarifa ML (%)",
  mlFixed: "Cobrança fixa ML (R$)",
  shipping: "Frete da loja (R$)",
  packaging: "Embalagem (R$)",
  advertising: "Publicidade por venda (R$)",
  other: "Outros custos (R$)",
};
export function OfferForm({ data, initial, busy, onSave, onDirty }: Props) {
  const [productId, setProductId] = useState(initial?.product_id || ""),
    [type, setType] = useState(initial?.type || "unit"),
    [editProduct, setEditProduct] = useState(false),
    [components, setComponents] = useState<Row[]>(
      initial?.components?.map((c: Row) => ({
        productId: c.product_id,
        quantity: c.quantity,
        variation: c.variation || "",
      })) || [],
    );
  const product = data.products.find((p: Row) => p.id === productId);
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const purchaseCost = nullable(f.get("purchaseCost"));
    const purchaseChanged =
      !!productId && purchaseCost !== (product?.purchase_cost ?? null);
    onSave({
      storeId: string(f, "storeId"),
      productId: productId || null,
      updateProduct: !!productId && (editProduct || purchaseChanged),
      productVersion: product?.version || 1,
      purchaseCost,
      name: (!editProduct && product?.name) || string(f, "name"),
      model: (!editProduct && product?.model) || string(f, "model") || null,
      brand: (!editProduct && product?.brand) || string(f, "brand") || null,
      category:
        (!editProduct && product?.category) || string(f, "category") || null,
      title: string(f, "title"),
      sku: string(f, "sku") || null,
      mlId: string(f, "mlId") || null,
      type,
      status: string(f, "status"),
      price: initial ? initial.price : nullable(f.get("price")),
      description: string(f, "description"),
      origin: string(f, "origin"),
      referenceAccount: string(f, "referenceAccount") || null,
      components,
      version: initial?.version,
    });
  }
  return (
    <form onSubmit={submit} onChange={onDirty}>
      <div className="form-grid">
        <Field label="Loja *">
          <select
            name="storeId"
            defaultValue={
              initial?.store_id || data.selectedStore || data.stores[0]?.id
            }
            disabled={!!initial}
          >
            {data.stores.map((s: Row) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {initial && (
            <input type="hidden" name="storeId" value={initial.store_id} />
          )}
        </Field>
        <Field
          label="Produto existente"
          hint="Um produto pode ter vários anúncios."
        >
          <select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setEditProduct(false);
            }}
          >
            <option value="">Cadastrar novo produto</option>
            {data.products.map((p: Row) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {productId && (
          <label className="checkbox-line field wide">
            <input
              type="checkbox"
              checked={editProduct}
              onChange={(e) => setEditProduct(e.target.checked)}
            />
            Editar nome, modelo, marca e categoria do produto
          </label>
        )}
        {productId && editProduct && (
          <p className="muted small field wide">
            A correção vale para todos os anúncios deste produto. É preciso ter
            acesso a todas as lojas vinculadas.
          </p>
        )}
        {(!productId || editProduct) && (
          <>
            <Field label="Nome do produto *">
              <AutocompleteInput
                suggestions={data.products.map((p: Row) => p.name)}
                aria-label="Nome do produto *"
                name="name"
                defaultValue={product?.name || initial?.product_name}
                required
              />
            </Field>
            <Field label="Modelo">
              <AutocompleteInput
                suggestions={data.products.map((p: Row) => p.model)}
                aria-label="Modelo"
                name="model"
                defaultValue={product?.model || initial?.model}
              />
            </Field>
            <Field label="Marca">
              <AutocompleteInput
                suggestions={data.products.map((p: Row) => p.brand)}
                aria-label="Marca"
                name="brand"
                defaultValue={product?.brand || initial?.brand}
              />
            </Field>
            <Field label="Categoria">
              <AutocompleteInput
                suggestions={data.products.map((p: Row) => p.category)}
                aria-label="Categoria"
                name="category"
                defaultValue={product?.category || initial?.category}
              />
            </Field>
          </>
        )}
        <Field
          label="Preço de custo (R$)"
          hint="Preço pago ao fornecedor por unidade. Pertence ao produto e vale para todos os anúncios vinculados, independentemente de promoções."
        >
          <MoneyInput
            key={productId || "new"}
            name="purchaseCost"
            aria-label="Preço de custo (R$)"
            defaultValue={product?.purchase_cost ?? ""}
          />
        </Field>
        <Field label="Título do anúncio *" wide>
          <AutocompleteInput
            suggestions={data.offerChoices.map((o: Row) => o.title)}
            aria-label="Título do anúncio *"
            name="title"
            defaultValue={initial?.title}
            required
            maxLength={200}
          />
        </Field>
        <Field label="SKU">
          <AutocompleteInput
            name="sku"
            defaultValue={initial?.sku}
            suggestions={data.offerChoices.map((o: Row) => o.sku)}
            aria-label="SKU"
          />
        </Field>
        <Field label="Código Mercado Livre">
          <input name="mlId" defaultValue={initial?.ml_id} placeholder="MLB…" />
        </Field>
        <Field label="Composição do anúncio">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (e.target.value === "unit") setComponents([]);
            }}
          >
            {["unit", "kit", "variation"].map((v) => (
              <option key={v} value={v}>
                {labels[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Situação">
          <select name="status" defaultValue={initial?.status || "draft"}>
            {["draft", "active", "paused", "closed"].map((v) => (
              <option key={v} value={v}>
                {labels[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Preço atual (R$)"
          hint={
            initial
              ? "Alterações de preço seguem o fluxo de proposta."
              : "Preço informado pelo cliente. Vazio significa pendente."
          }
        >
          <MoneyInput
            name="price"
            defaultValue={initial?.price}
            disabled={!!initial}
          />
        </Field>
        <Field label="Procedência">
          <select name="origin" defaultValue={initial?.origin || "manual"}>
            {["manual", "import", "reference"].map((v) => (
              <option key={v} value={v}>
                {labels[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Conta de origem"
          hint="Obrigatória para referências de outra conta."
        >
          <AutocompleteInput
            suggestions={data.offerChoices.map((o: Row) => o.reference_account)}
            aria-label="Conta de origem"
            name="referenceAccount"
            defaultValue={initial?.reference_account}
          />
        </Field>
        <Field label="Descrição" wide>
          <textarea
            name="description"
            rows={5}
            defaultValue={initial?.description}
          />
        </Field>
      </div>
      {type !== "unit" && (
        <div className="composition">
          <h3>
            {type === "kit"
              ? "Composição do kit"
              : "Produto e atributos da variação"}
          </h3>
          {components.map((c, i) => (
            <div className="composition-row" key={i}>
              <select
                aria-label={`Produto ${i + 1}`}
                required
                value={c.productId}
                onChange={(e) =>
                  setComponents(
                    components.map((x, j) =>
                      j === i ? { ...x, productId: e.target.value } : x,
                    ),
                  )
                }
              >
                <option value="">Selecione o produto</option>
                {data.products.map((p: Row) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Quantidade ${i + 1}`}
                type="number"
                min={1}
                value={c.quantity}
                onChange={(e) =>
                  setComponents(
                    components.map((x, j) =>
                      j === i ? { ...x, quantity: Number(e.target.value) } : x,
                    ),
                  )
                }
              />
              {type === "variation" && (
                <input
                  aria-label={`Atributos ${i + 1}`}
                  placeholder="Cor: preto · Tamanho: M"
                  value={c.variation}
                  required
                  onChange={(e) =>
                    setComponents(
                      components.map((x, j) =>
                        j === i ? { ...x, variation: e.target.value } : x,
                      ),
                    )
                  }
                />
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Remover componente"
                onClick={() =>
                  setComponents(components.filter((_, j) => j !== i))
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button"
            onClick={() => {
              setComponents([
                ...components,
                { productId: "", quantity: 1, variation: "" },
              ]);
              onDirty();
            }}
          >
            <Plus size={14} />
            Adicionar componente
          </button>
          <p className="muted small">
            Cadastre primeiro os produtos dos componentes. O custo de mercadoria
            é o valor de todas as unidades vendidas no anúncio.
          </p>
        </div>
      )}
      <div className="form-footer">
        <span>* Campos obrigatórios</span>
        <Submit
          busy={busy}
          label={initial ? "Salvar cadastro" : "Cadastrar anúncio"}
        />
      </div>
    </form>
  );
}
export function CostsForm({
  initial,
  parameters,
  busy,
  onSave,
  onSaveAndNext,
  onDirty,
  onDraft,
  price,
  offer,
  mode = "registration",
}: {
  initial: Row;
  parameters: Row;
  busy: boolean;
  onSave?: (data: Row) => void | Promise<boolean>;
  onSaveAndNext?: (data: Row) => void;
  onDirty: () => void;
  onDraft: (costs: Costs | null) => void;
  price: string | null;
  offer?: Row;
  mode?: "registration" | "scenario";
}) {
  const [draft, setDraft] = useState<Costs | null>(initial as Costs);
  const [error, setError] = useState("");
  useToastMessage(error);
  function read(form: HTMLFormElement) {
    const f = new FormData(form);
    const result: Row = { otherDescription: string(f, "otherDescription") };
    for (const key of Object.keys(costFields))
      result[key] = nullable(f.get(key));
    for (const key of ["taxRate", "managementRate"])
      if (string(f, key + "Mode") !== "inherit")
        result[key] = nullable(f.get(key));
    for (const key of ["taxBase", "managementBase"])
      if (string(f, key) !== "inherit") result[key] = string(f, key) || null;
    return result;
  }
  const automatic = offer ? automaticMlCosts(offer) : {};
  const result = draft
    ? calculate(
        price,
        offer ? effectiveMlCosts(draft, offer) : draft,
        parameters as Parameters,
      )
    : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next =
          (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
            "data-next",
          ) === "true";
        if (mode === "registration")
          (next && onSaveAndNext ? onSaveAndNext : onSave)?.(
            read(e.currentTarget),
          );
      }}
      onChange={(e) => {
        const parsed = costSchema.safeParse(read(e.currentTarget));
        const costs = parsed.success ? parsed.data : null;
        setDraft(costs);
        onDraft(costs);
        onDirty();
        setError(
          parsed.success
            ? ""
            : parsed.error.issues.map((i) => i.message).join(" · "),
        );
      }}
    >
      <div className="alert">
        Mercadoria vazia herda o custo de compra do produto ou da composição. Um
        valor preenchido é uma exceção deste anúncio. Campos ML vazios usam a
        consulta automática disponível. Nos demais, vazio é informação pendente;
        informe <strong>0</strong> quando não houver custo. Mercadoria
        representa a unidade ou o kit completo.
      </div>
      <div className="form-grid">
        {Object.entries(costFields).map(([key, label]) => (
          <Field
            label={label}
            key={key}
            hint={
              key === "goods"
                ? "Opcional: substitui o custo herdado apenas neste anúncio. O preço de custo do produto está no cadastro acima."
                : undefined
            }
          >
            {key === "mlPercent" ? (
              <input
                name={key}
                aria-label={label}
                type="number"
                min={0}
                max={100}
                step="0.000001"
                defaultValue={initial[key] ?? ""}
                placeholder={
                  automatic.mlPercent != null
                    ? `ML: ${automatic.mlPercent}%`
                    : "Pendente"
                }
              />
            ) : (
              <MoneyInput
                name={key}
                aria-label={label}
                defaultValue={initial[key] ?? ""}
                placeholder={
                  key === "goods" && offer?.purchaseCost?.amount != null
                    ? `Produto: ${money(offer.purchaseCost.amount)}`
                    : automatic[key as keyof Costs] != null
                      ? `ML: ${money(automatic[key as keyof Costs])}`
                      : "Pendente"
                }
              />
            )}
            {key === "goods" && draft?.goods == null && (
              <small className="ml-cost-source">
                {offer?.purchaseCost?.amount != null
                  ? `${offer.purchaseCost.source === "kit" ? "Composição do kit" : "Custo do produto"}: ${money(offer.purchaseCost.amount)}`
                  : offer?.purchaseCost?.reason ||
                    "Cadastre o custo de compra no produto ou informe uma exceção aqui."}
              </small>
            )}
            {automatic[key as keyof Costs] != null &&
              draft?.[key as keyof Costs] == null && (
                <small className="ml-cost-source">
                  ML automático:{" "}
                  {key === "mlPercent"
                    ? `${automatic[key as keyof Costs]}%`
                    : money(automatic[key as keyof Costs])}
                  {key === "shipping" ? " · estimado" : ""}
                </small>
              )}
          </Field>
        ))}
        <Field label="Descrição dos outros custos">
          <input
            name="otherDescription"
            defaultValue={initial.otherDescription}
          />
        </Field>
        {["tax", "management"].map((key) => (
          <Override
            key={key}
            prefix={key}
            initial={initial}
            parameters={parameters}
          />
        ))}
      </div>
      <div
        className="live-cost-summary"
        role="region"
        aria-label="Prévia dos custos ao digitar"
      >
        <span>Ao preço atual · prévia dos custos digitados</span>
        <div>
          <span>Custo total</span>
          <strong>{money(result?.total)}</strong>
        </div>
        <div>
          <span>Contribuição</span>
          <strong>
            {money(result?.margin)} · {percent(result?.saleMarginPercent)} sobre
            a venda
          </strong>
        </div>
        {result?.pending.length ? (
          <p className="small muted">
            Dados pendentes: {result.pending.join(", ")}.
          </p>
        ) : null}
      </div>
      {mode === "registration" ? (
        <div className="form-footer">
          <span>
            Resultados mudam ao digitar. Salvar atualiza os custos cadastrados.
          </span>
          <div className="sequence-save-actions">
            <Submit busy={busy} label="Salvar custos" />
            {onSaveAndNext && (
              <button
                type="submit"
                data-next="true"
                className="button"
                disabled={busy}
              >
                {busy ? "Salvando…" : "Salvar e próximo"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="small muted">
          Hipóteses deste cenário. Os custos cadastrados só mudam após a
          aplicação de uma proposta aprovada.
        </p>
      )}
    </form>
  );
}
function Override({
  prefix,
  initial,
  parameters,
}: {
  prefix: string;
  initial: Row;
  parameters: Row;
}) {
  const [mode, setMode] = useState(
    initial[prefix + "Rate"] === undefined ? "inherit" : "override",
  );
  return (
    <>
      <Field
        label={prefix === "tax" ? "Impostos (%)" : "Comissão de gestão (%)"}
        hint={`Padrão da loja: ${parameters[prefix + "Rate"] ?? "pendente"}%`}
      >
        <select
          name={prefix + "RateMode"}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="inherit">Usar parâmetro da loja</option>
          <option value="override">Substituir neste anúncio</option>
        </select>
        {mode === "override" && (
          <input
            name={prefix + "Rate"}
            type="number"
            min={0}
            max={100}
            step="0.000001"
            defaultValue={initial[prefix + "Rate"] ?? ""}
            placeholder="Pendente"
          />
        )}
      </Field>
      <Field
        label={prefix === "tax" ? "Base dos impostos" : "Base da comissão"}
      >
        <select
          name={prefix + "Base"}
          defaultValue={
            initial[prefix + "Base"] === undefined
              ? "inherit"
              : initial[prefix + "Base"] || ""
          }
        >
          <option value="inherit">Usar parâmetro da loja</option>
          <option value="">Pendente</option>
          <option value="price">Preço pago pelo comprador</option>
          <option value="revenue">Receita com contribuição ML</option>
        </select>
      </Field>
    </>
  );
}
export function TaskForm({
  data,
  initial,
  busy,
  onSave,
  onDirty,
  choicesLoading = false,
  onStoreChange,
}: Props & {
  choicesLoading?: boolean;
  onStoreChange?: (store: string) => void;
}) {
  const [store, setStore] = useState(
    initial?.store_id || data.selectedStore || data.stores[0]?.id,
  );
  const [related, setRelated] = useState(
    initial?.offer_id || data.initialOffer || "",
  );
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSave({
      storeId: store,
      offerId: related || null,
      title: string(f, "title"),
      description: string(f, "description"),
      type: string(f, "type"),
      version: initial?.version || (initial ? 1 : undefined),
      priority: string(f, "priority"),
      status: string(f, "status"),
      assignee: string(f, "assignee"),
      dueDate: string(f, "dueDate") || null,
      reason: string(f, "reason"),
      result: string(f, "result"),
      evidence: string(f, "evidence"),
    });
  }
  return (
    <form onSubmit={submit} onChange={onDirty}>
      <div className="form-grid">
        <Field label="Loja">
          <select
            value={store}
            disabled={!!initial}
            onChange={(e) => {
              setStore(e.target.value);
              setRelated("");
              onStoreChange?.(e.target.value);
            }}
          >
            {data.stores.map((s: Row) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Anúncio relacionado">
          <select
            key={store}
            name="offerId"
            value={related}
            disabled={choicesLoading}
            onChange={(e) => setRelated(e.target.value)}
          >
            <option value="">Tarefa geral da loja</option>
            {related &&
              !data.offerChoices.some((o: Row) => o.id === related) && (
                <option value={related}>Anúncio vinculado</option>
              )}
            {data.offerChoices
              .filter((o: Row) => o.store_id === store)
              .map((o: Row) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
          </select>
          {choicesLoading && (
            <small className="task-options-loading">
              <LoaderCircle
                size={12}
                className="spin"
                aria-label="Carregando anúncios relacionados"
              />{" "}
              Carregando vínculos; você já pode preencher a ação.
            </small>
          )}
        </Field>
        <Field label="Título *" wide>
          <AutocompleteInput
            name="title"
            required
            defaultValue={initial?.title}
            suggestions={data.tasks
              .filter((t: Row) => t.store_id === store)
              .map((t: Row) => t.title)}
            aria-label="Título *"
          />
        </Field>
        <Field label="Tipo">
          <AutocompleteInput
            name="type"
            defaultValue={initial?.type || "melhoria"}
            suggestions={[
              "melhoria",
              "precificação",
              "estoque",
              "conteúdo",
              "concorrência",
              "atendimento",
              ...data.tasks.map((t: Row) => t.type),
            ]}
            aria-label="Tipo"
          />
        </Field>
        <Field label="Prioridade">
          <select name="priority" defaultValue={initial?.priority || "medium"}>
            {["high", "medium", "low"].map((v) => (
              <option key={v} value={v}>
                {labels[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Situação">
          <select name="status" defaultValue={initial?.status || "todo"}>
            {["todo", "doing", "done", "cancelled"].map((v) => (
              <option key={v} value={v}>
                {labels[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Responsável">
          <AutocompleteInput
            suggestions={[
              data.user.name,
              ...data.tasks
                .filter((t: Row) => t.store_id === store)
                .map((t: Row) => t.assignee),
            ]}
            aria-label="Responsável"
            name="assignee"
            defaultValue={initial?.assignee || data.user.name}
          />
        </Field>
        <Field label="Prazo">
          <input type="date" name="dueDate" defaultValue={initial?.due_date} />
        </Field>
        <Field label="Motivo">
          <input name="reason" defaultValue={initial?.reason} />
        </Field>
        <Field label="Descrição" wide>
          <textarea
            rows={3}
            name="description"
            defaultValue={initial?.description}
          />
        </Field>
        <Field label="Resultado" wide>
          <textarea rows={2} name="result" defaultValue={initial?.result} />
        </Field>
        <Field label="Links e evidências" wide>
          <textarea rows={2} name="evidence" defaultValue={initial?.evidence} />
        </Field>
      </div>
      <div className="form-footer">
        <span>A tarefa continuará vinculada à loja indicada.</span>
        <Submit busy={busy} label="Salvar tarefa" />
      </div>
    </form>
  );
}
export function NoteForm({ data, initial, busy, onSave, onDirty }: Props) {
  const [store, setStore] = useState(
    initial?.store_id || data.selectedStore || "",
  );
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSave({
      storeId: store || null,
      offerId: string(f, "offerId") || null,
      kind: string(f, "kind"),
      version: initial?.version || (initial ? 1 : undefined),
      title: string(f, "title"),
      body: string(f, "body"),
      sources: string(f, "sources"),
      practicalUse: string(f, "practicalUse"),
    });
  }
  return (
    <form onSubmit={submit} onChange={onDirty}>
      <div className="form-grid">
        <Field label="Vínculo da nota">
          <select value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">Geral · organização</option>
            {data.stores.map((s: Row) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Anúncio">
          <select
            key={store}
            name="offerId"
            defaultValue={initial?.offer_id || data.initialOffer || ""}
            disabled={!store}
          >
            <option value="">Sem anúncio específico</option>
            {data.offerChoices
              .filter((o: Row) => o.store_id === store)
              .map((o: Row) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Tipo">
          <select name="kind" defaultValue={initial?.kind || "study"}>
            {["question", "study", "learning", "idea", "insight"].map((v) => (
              <option key={v} value={v}>
                {labels[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título *">
          <AutocompleteInput
            name="title"
            required
            defaultValue={initial?.title}
            suggestions={data.notes
              .filter((n: Row) => (n.store_id || "") === store)
              .map((n: Row) => n.title)}
            aria-label="Título *"
          />
        </Field>
        <Field label="Anotação *" wide>
          <textarea
            rows={5}
            name="body"
            required
            defaultValue={initial?.body}
          />
        </Field>
        <Field label="Fontes e links" wide>
          <textarea name="sources" rows={2} defaultValue={initial?.sources} />
        </Field>
        <Field label="Aplicação prática" wide>
          <textarea
            name="practicalUse"
            rows={2}
            defaultValue={initial?.practical_use}
          />
        </Field>
      </div>
      <div className="form-footer">
        <span>Estudos e insights ficam ligados à sua origem.</span>
        <Submit busy={busy} label="Salvar nota" />
      </div>
    </form>
  );
}
export function ParameterForm({
  initial,
  busy,
  onSave,
  onDirty,
}: {
  initial: Row;
  busy: boolean;
  onSave: (data: Row) => void;
  onDirty: () => void;
}) {
  return (
    <form
      onChange={onDirty}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          minMargin: nullable(f.get("minMargin")),
          desiredMargin: nullable(f.get("desiredMargin")),
          taxRate: nullable(f.get("taxRate")),
          managementRate: nullable(f.get("managementRate")),
          taxBase: string(f, "taxBase") || null,
          managementBase: string(f, "managementBase") || null,
          reviewDays: Number(f.get("reviewDays")),
          salesMarginTarget: nullable(f.get("salesMarginTarget")),
          enforceSalesMargin: f.get("enforceSalesMargin") === "on",
        });
      }}
    >
      <div className="form-grid">
        <Field
          label="Meta de margem sobre a venda (%)"
          hint="A margem precisa superar a meta. Exatamente 40% não atende à meta de 40%."
        >
          <input
            name="salesMarginTarget"
            aria-label="Meta de margem sobre a venda (%)"
            type="number"
            min={0}
            max={99.999999}
            step="0.000001"
            required
            defaultValue={initial.salesMarginTarget ?? "40"}
          />
        </Field>
        <label className="checkbox-line field wide">
          <input
            name="enforceSalesMargin"
            type="checkbox"
            defaultChecked={initial.enforceSalesMargin !== false}
          />
          Bloquear aprovação e aplicação abaixo da meta de margem
        </label>
        <p className="small muted field wide">
          Desative para apenas alertar e sugerir o preço. Dados financeiros
          pendentes continuam exigindo conferência antes da aplicação. Esta
          regra vale para esta loja.
        </p>
        {[
          ["minMargin", "Margem mínima (%)"],
          ["desiredMargin", "Margem desejada (%)"],
          ["taxRate", "Impostos (%)"],
          ["managementRate", "Comissão de gestão (%)"],
        ].map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              name={key}
              type="number"
              min={0}
              max={100}
              step="0.000001"
              defaultValue={initial[key] ?? ""}
              placeholder="Pendente"
            />
          </Field>
        ))}
        {["taxBase", "managementBase"].map((key) => (
          <Field
            key={key}
            label={key === "taxBase" ? "Base de impostos" : "Base da comissão"}
          >
            <select name={key} defaultValue={initial[key] || ""}>
              <option value="">Pendente · conferir com o cliente</option>
              <option value="price">Preço pago pelo comprador</option>
              <option value="revenue">Receita com contribuição ML</option>
            </select>
          </Field>
        ))}
        <Field label="Revisar custos a cada (dias)">
          <input
            name="reviewDays"
            type="number"
            min={1}
            max={3650}
            defaultValue={initial.reviewDays}
            required
          />
        </Field>
      </div>
      <div className="form-footer">
        <span>Não recalcula o histórico.</span>
        <Submit busy={busy} />
      </div>
    </form>
  );
}
