"use client";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
export default function ListingUpdateProgress({
  done,
  total,
  onCancel,
}: {
  done: number;
  total: number;
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
          <strong>Atualizando indicadores ML</strong>
          <span role="status">
            {done} de {total} anúncios consultados
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
        value={done}
        max={total || 1}
      />
      <small>Você pode interromper e continuar depois.</small>
    </section>,
    document.body,
  );
}
