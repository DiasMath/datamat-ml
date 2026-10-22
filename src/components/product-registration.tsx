"use client";
import { useState } from "react";
import { Package, Pencil } from "lucide-react";
import {
  Field,
  Modal,
  Submit,
  jsonRequest,
  money,
  nullable,
  string,
} from "./ui";
import { useToast } from "./toasts";
type Row = Record<string, any>;

export default function ProductRegistration({
  offer,
  canEdit,
  disabled = false,
  onSaved,
}: {
  offer: Row;
  canEdit: boolean;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const { notify } = useToast();
  return (
    <section className="product-registration" aria-label="Cadastro do produto">
      <div className="product-registration-identity">
        <Package size={17} />
        <div>
          <strong>{offer.product_name}</strong>
          <span>Cadastro do produto</span>
        </div>
      </div>
      <div className="product-registration-cost">
        <span>Preço de custo do produto</span>
        <strong>
          {offer.product_purchase_cost == null
            ? "Não informado"
            : money(offer.product_purchase_cost)}
        </strong>
        <small>Compra do fornecedor · por unidade</small>
      </div>
      {canEdit && (
        <button
          type="button"
          className="button compact"
          disabled={busy || disabled}
          onClick={() => setOpen(true)}
        >
          <Pencil size={14} />
          Editar produto
        </button>
      )}
      {open && (
        <Modal
          title="Cadastro do produto"
          subtitle="Preço de custo e dados compartilhados pelos anúncios deste produto"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await jsonRequest(`/api/products/${offer.product_id}`, {
                  name: string(f, "name"),
                  model: string(f, "model") || null,
                  brand: string(f, "brand") || null,
                  category: string(f, "category") || null,
                  purchaseCost: nullable(f.get("purchaseCost")),
                  version: offer.product_version,
                });
                setOpen(false);
                notify(
                  "Produto salvo. Preço de custo atualizado nos anúncios vinculados.",
                  "success",
                );
                onSaved();
              } catch (error) {
                notify((error as Error).message, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <Field label="Nome do produto *">
                <input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={offer.product_name}
                />
              </Field>
              <Field
                label="Preço de custo (R$)"
                hint="Valor pago ao fornecedor por uma unidade do produto. Vazio significa pendente."
              >
                <input
                  name="purchaseCost"
                  aria-label="Preço de custo (R$)"
                  type="number"
                  min={0}
                  max={1000000000}
                  step="0.000001"
                  defaultValue={offer.product_purchase_cost ?? ""}
                />
              </Field>
              <Field label="Modelo">
                <input
                  name="model"
                  maxLength={200}
                  defaultValue={offer.model || ""}
                />
              </Field>
              <Field label="Marca">
                <input
                  name="brand"
                  maxLength={200}
                  defaultValue={offer.brand || ""}
                />
              </Field>
              <Field label="Categoria">
                <input
                  name="category"
                  maxLength={200}
                  defaultValue={offer.category || ""}
                />
              </Field>
            </div>
            <p className="small muted">
              Este custo pertence ao produto, independentemente de promoções, da
              modalidade Clássico/Premium ou do frete do anúncio. Alterações
              valem para todos os anúncios vinculados; custos específicos desses
              anúncios são preservados.
            </p>
            <div className="form-footer">
              <span>Dados do produto · sem alterar o preço de venda.</span>
              <Submit busy={busy} label="Salvar produto" />
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
