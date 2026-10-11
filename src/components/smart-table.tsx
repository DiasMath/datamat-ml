"use client";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Decimal from "decimal.js";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type TableColumn<T> = {
  id: string;
  label: string;
  width: number;
  value?: (row: T) => string | number | null | undefined;
  kind?: "number" | "date";
  header?: ReactNode;
  fixed?: boolean;
  className?: string;
};
export type TableSort = { id: string; direction: "asc" | "desc" } | null;
const collator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});
const clamp = (value: number) => Math.max(80, Math.min(800, Math.round(value)));

export function useSmartTable<T>(
  id: string,
  data: T[],
  columns: TableColumn<T>[],
  options: {
    sort?: TableSort;
    onSort?: (sort: NonNullable<TableSort>) => void;
    pageId?: string;
  } = {},
) {
  const [localSort, setSort] = useState<TableSort>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const router = useRouter(),
    search = useSearchParams();
  const defaults = JSON.stringify(columns.map((c) => [c.id, c.width]));
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("datamat.columns." + id) || "{}",
      );
      const next: Record<string, number> = {};
      for (const [key] of JSON.parse(defaults))
        if (Number.isFinite(saved[key])) next[key] = clamp(saved[key]);
      setWidths(next);
    } catch {
      setWidths({});
    }
  }, [id, defaults]);
  const width = (column: TableColumn<T>) => widths[column.id] ?? column.width;
  function resize(column: TableColumn<T>, value: number) {
    setWidths((previous) => {
      const next = { ...previous, [column.id]: clamp(value) };
      try {
        localStorage.setItem("datamat.columns." + id, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const sort = options.sort === undefined ? localSort : options.sort;
  const sortKey = sort ? sort.id + ":" + sort.direction : "";
  const previousSort = useRef(sortKey);
  useEffect(() => {
    if (
      previousSort.current !== sortKey &&
      (options.pageId || !options.onSort)
    ) {
      const page = options.pageId || id;
      if (search.has(page + "Page")) {
        const params = new URLSearchParams(search.toString());
        params.delete(page + "Page");
        router.replace("?" + params, { scroll: false });
      }
    }
    previousSort.current = sortKey;
  }, [sortKey, id, options.pageId, search, router]);
  const column = columns.find((c) => c.id === sort?.id && c.value);
  const rows =
    column && sort
      ? [...data].sort((a, b) => {
          let av = column.value!(a),
            bv = column.value!(b);
          if (column.kind === "date") {
            av = av == null ? null : Date.parse(String(av));
            bv = bv == null ? null : Date.parse(String(bv));
            if (!Number.isFinite(av)) av = null;
            if (!Number.isFinite(bv)) bv = null;
          }
          if (av == null || av === "") return bv == null || bv === "" ? 0 : 1;
          if (bv == null || bv === "") return -1;
          const order =
            column.kind === "number"
              ? new Decimal(av).comparedTo(bv)
              : column.kind === "date"
                ? Number(av) - Number(bv)
                : collator.compare(String(av), String(bv));
          return sort.direction === "asc" ? order : -order;
        })
      : data;
  function order(next: TableColumn<T>) {
    const value: NonNullable<TableSort> = {
      id: next.id,
      direction:
        sort?.id === next.id && sort.direction === "asc" ? "desc" : "asc",
    };
    if (options.onSort) options.onSort(value);
    else setSort(value);
  }
  const total = columns.reduce((n, c) => n + width(c), 0);
  const header = (overrides: Record<string, ReactNode> = {}) => (
    <>
      <colgroup>
        {columns.map((c) => (
          <col key={c.id} style={{ width: width(c) }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.id}
              scope="col"
              className={c.className}
              aria-sort={
                !c.value
                  ? undefined
                  : sort?.id !== c.id
                    ? "none"
                    : sort.direction === "asc"
                      ? "ascending"
                      : "descending"
              }
            >
              {overrides[c.id] ??
                c.header ??
                (c.value ? (
                  <button
                    type="button"
                    className="column-sort"
                    aria-label={"Ordenar por: " + c.label}
                    onClick={() => order(c)}
                  >
                    <span>{c.label}</span>
                    {sort?.id === c.id ? (
                      sort.direction === "asc" ? (
                        <ArrowUp size={13} />
                      ) : (
                        <ArrowDown size={13} />
                      )
                    ) : (
                      <ArrowUpDown size={13} />
                    )}
                  </button>
                ) : (
                  c.label
                ))}
              {!c.fixed && (
                <span
                  className="column-resize"
                  role="separator"
                  aria-orientation="vertical"
                  tabIndex={0}
                  aria-label={"Largura da coluna: " + c.label}
                  aria-valuemin={80}
                  aria-valuemax={800}
                  aria-valuenow={width(c)}
                  title="Arraste para ajustar. Clique duas vezes para restaurar."
                  onDoubleClick={() => resize(c, c.width)}
                  onKeyDown={(e) => {
                    if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
                      e.preventDefault();
                      resize(
                        c,
                        e.key === "Home"
                          ? c.width
                          : width(c) +
                              (e.key === "ArrowRight" ? 1 : -1) *
                                (e.shiftKey ? 50 : 10),
                      );
                    }
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const target = e.currentTarget,
                      start = e.clientX,
                      initial = width(c);
                    target.setPointerCapture(e.pointerId);
                    const move = (event: PointerEvent) =>
                      resize(c, initial + event.clientX - start);
                    const done = () => {
                      target.removeEventListener("pointermove", move);
                      target.removeEventListener("lostpointercapture", done);
                    };
                    target.addEventListener("pointermove", move);
                    target.addEventListener("lostpointercapture", done);
                  }}
                />
              )}{" "}
            </th>
          ))}
        </tr>
      </thead>
    </>
  );
  return {
    rows,
    header,
    sortKey,
    props: {
      style: { tableLayout: "fixed" as const, width: total, minWidth: total },
    },
  };
}
