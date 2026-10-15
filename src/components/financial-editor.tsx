"use client";
import { useState, useCallback } from "react";
import { type Costs } from "@/domain/finance";
import { CostsForm } from "./forms";
import Pricing from "./pricing";
type Row = Record<string, any>;
export default function FinancialEditor({
  detail,
  busy,
  onDirty,
  onSaveCosts,
  onSaveCostsAndNext,
  onProposal,
  onProposalAndNext,
}: {
  detail: Row;
  busy: boolean;
  onDirty: () => void;
  onSaveCosts: (data: Row) => void;
  onSaveCostsAndNext?: (data: Row) => void;
  onProposal: (data: Row) => Promise<boolean>;
  onProposalAndNext?: (data: Row) => Promise<boolean>;
}) {
  const [draftCosts, setDraftCosts] = useState<Costs | null>(detail.costs);
  const [liveFinancial, setLiveFinancial] = useState<Row | null>(null);
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
    <Pricing
      offer={offer}
      onQuote={onQuote}
      costs={detail.costs}
      parameters={detail.parameters}
      parametersRevision={detail.parametersRevision}
      draftCosts={draftCosts}
      mlConnection={detail.mlConnection}
      busy={busy}
      onDirty={onDirty}
      onProposal={onProposal}
      onProposalAndNext={onProposalAndNext}
      costEditor={
        <details className="expand pricing-cost-editor" open>
          <summary>Custos da oferta</summary>
          <CostsForm
            initial={detail.costs}
            offer={offer}
            parameters={detail.parameters}
            price={detail.offer.price}
            busy={busy}
            onDirty={onDirty}
            onDraft={setDraftCosts}
            onSave={onSaveCosts}
            onSaveAndNext={onSaveCostsAndNext}
          />
        </details>
      }
    />
  );
}
