"use client";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
export default function ListingUpdateProgress({
  done,
  total,
  phase,
  onCancel,
}: {
  done: number;
  total: number;
  phase?: "catalog" | "indicators";
  onCancel: () => void;
}) {
  return createPortal(
    <section
      className="listing-update-progress"
      aria-label="Atualização dos indicadores ML"
    >
      <div>
        <LoaderCircle size={17} className="spin" aria-hidden="true" />
        <div>
          <strong>
            {phase === "catalog"
              ? "Atualizando catálogo da loja"
              : "Atualizando indicadores ML"}
          </strong>
          <span role="status">
            {phase === "catalog"
              ? `${done} anúncios consultados no catálogo`
              : `${done} de ${total} anúncios consultados`}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label="Interromper consulta de indicadores"
          onClick={onCancel}
        >
          <X size={17} />
        </button>
      </div>
      <progress
        aria-label="Anúncios consultados"
        value={phase === "catalog" ? undefined : done}
        max={total || 1}
      />
      <small>Você pode interromper e continuar depois.</small>
    </section>,
    document.body,
  );
}
