"use client";
import { type ReactNode, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function pageSize(value: string | null) {
  return [20, 50, 100].includes(Number(value)) ? Number(value) : 20;
}
export default function Collection<T>({
  id,
  rows,
  label,
  children,
}: {
  id: string;
  rows: T[];
  label: string;
  children: (rows: T[]) => ReactNode;
}) {
  const search = useSearchParams(),
    router = useRouter();
  const size = pageSize(search.get(id + "Size")),
    pages = Math.max(1, Math.ceil(rows.length / size));
  const requested = Number(search.get(id + "Page")) || 1;
  const page = Math.max(
    1,
    Math.min(Number.isFinite(requested) ? Math.floor(requested) : 1, pages),
  );
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [page, size, search.toString()]);
  function change(key: string, value: number) {
    const params = new URLSearchParams(search.toString());
    params.set(key, String(value));
    if (key.endsWith("Size")) params.delete(id + "Page");
    router.replace("?" + params, { scroll: false });
  }
  return (
    <>
      <div
        ref={viewport}
        className="collection-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        {children(rows.slice((page - 1) * size, page * size))}
      </div>
      {(rows.length > 20 || size !== 20) && (
        <div className="pagination collection-pagination">
          <span aria-live="polite">
            {rows.length ? (page - 1) * size + 1 : 0}–
            {Math.min(page * size, rows.length)} de {rows.length}
          </span>
          <label>
            Por página{" "}
            <select
              aria-label={"Registros por página: " + label}
              value={size}
              onChange={(e) => change(id + "Size", Number(e.target.value))}
            >
              {[20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              className="icon-button"
              aria-label={"Página anterior: " + label}
              disabled={page === 1}
              onClick={() => change(id + "Page", page - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {page} / {pages}
            </span>
            <button
              className="icon-button"
              aria-label={"Próxima página: " + label}
              disabled={page === pages}
              onClick={() => change(id + "Page", page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
