"use client";
import { useState } from "react";
import { type Costs } from "@/domain/finance";
import { CostsForm } from "./forms";
import Pricing from "./pricing";
type Row = Record<string, any>;
export default function FinancialEditor({
  detail,
  busy,
  onDirty,
  onSaveCosts,
  onProposal,
}: {
  detail: Row;
  busy: boolean;
  onDirty: () => void;
  onSaveCosts: (data: Row) => void;
  onProposal: (data: Row) => Promise<boolean>;
}) {
  const [draftCosts, setDraftCosts] = useState<Costs | null>(detail.costs);
  return (
    <Pricing
      offer={detail.offer}
      costs={detail.costs}
      parameters={detail.parameters}
      parametersRevision={detail.parametersRevision}
      draftCosts={draftCosts}
      mlConnection={detail.mlConnection}
      busy={busy}
      onDirty={onDirty}
      onProposal={onProposal}
      costEditor={
        <details className="expand pricing-cost-editor" open>
          <summary>Custos da oferta</summary>
          <CostsForm
            initial={detail.costs}
            parameters={detail.parameters}
            price={detail.offer.price}
            busy={busy}
            onDirty={onDirty}
            onDraft={setDraftCosts}
            onSave={onSaveCosts}
          />
        </details>
      }
    />
  );
}
