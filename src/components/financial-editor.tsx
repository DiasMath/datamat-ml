"use client";
import { useState, useCallback } from "react";
import { type Costs } from "@/domain/finance";
import { CostsForm } from "./forms";
import Pricing from "./pricing";
import ProductRegistration from "./product-registration";
type Row = Record<string, any>;
export default function FinancialEditor({
  detail,
  busy,
  onDirty,
  onSaveCosts,
  onSaveCostsAndNext,
  onProposal,
  onProposalAndNext,
  onProductSaved,
}: {
  detail: Row;
  busy: boolean;
  onDirty: () => void;
  onSaveCosts: (data: Row) => void;
  onSaveCostsAndNext?: (data: Row) => void;
  onProposal: (data: Row) => Promise<boolean>;
  onProposalAndNext?: (data: Row) => Promise<boolean>;
  onProductSaved: () => void;
}) {
  const [draftCosts, setDraftCosts] = useState<Costs | null>(detail.costs);
  const [liveFinancial, setLiveFinancial] = useState<Row | null>(null);
  const [changed, setChanged] = useState(false);
  const dirty = () => {
    setChanged(true);
    onDirty();
  };
  const onQuote = useCallback(
    (quote: Row | null) => {
      if (quote && Number(quote.price) === Number(detail.offer.price))
        setLiveFinancial(quote);
    },
    [detail.offer.price],
  );
  const offer = {
    ...detail.offer,
    mlFinancial: liveFinancial || detail.offer.mlFinancial,
  };
  return (
    <>
      <ProductRegistration
        offer={offer}
        canEdit
        disabled={busy || changed}
        onSaved={onProductSaved}
      />
      <Pricing
        offer={offer}
        onQuote={onQuote}
        costs={detail.costs}
        parameters={detail.parameters}
        parametersRevision={detail.parametersRevision}
        draftCosts={draftCosts}
        mlConnection={detail.mlConnection}
        busy={busy}
        onDirty={dirty}
        onProposal={onProposal}
        onProposalAndNext={onProposalAndNext}
        costEditor={
          <details className="expand pricing-cost-editor" open>
            <summary>Custos do anúncio</summary>
            <CostsForm
              initial={detail.costs}
              offer={offer}
              parameters={detail.parameters}
              price={detail.offer.price}
              busy={busy}
              onDirty={dirty}
              onDraft={setDraftCosts}
              onSave={onSaveCosts}
              onSaveAndNext={onSaveCostsAndNext}
            />
          </details>
        }
      />
    </>
  );
}
