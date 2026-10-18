"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  runListingBatches,
  LISTING_INDICATOR_BATCH_SIZE,
} from "../domain/listing-batches";
import { jsonRequest } from "./ui";
import { useToast } from "./toasts";
import type { IndicatorIssue } from "./listing-indicator-issues";

type Result = {
  id: string;
  deferred?: boolean;
  metrics: boolean;
  fees: boolean;
  errors?: string[];
};
export default function useListingIndicators({
  scope,
  store,
  syncCatalog,
  onWorking,
  onChanged,
}: {
  scope: string;
  store: string;
  syncCatalog: boolean;
  onWorking: (working: boolean) => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    phase?: "catalog" | "indicators";
  } | null>(null);
  const [issues, setIssues] = useState<IndicatorIssue[]>([]);
  const status = useRef(new Map<string, IndicatorIssue>());
  const catalogComplete = useRef(false);
  const request = useRef<AbortController | null>(null);
  const resume = useRef<{ key: string; ids: string[] } | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(
    () => () => {
      const active = request.current;
      request.current = null;
      if (active) {
        active.abort();
        onWorking(false);
      }
      setProgress(null);
      status.current.clear();
      catalogComplete.current = false;
      setIssues([]);
    },
    [scope, onWorking],
  );
  const cancel = useCallback(() => request.current?.abort(), []);
  const start = async (ids: string[], retry = false) => {
    if (request.current || store === "all") return;
    const controller = new AbortController();
    request.current = controller;
    const key = scope + ":" + [...new Set(ids)].sort().join(",");
    const continuing = retry || resume.current?.key === key;
    const pending =
      continuing && status.current.size
        ? [...status.current.values()]
            .filter((row) => !row.metrics || !row.fees)
            .map((row) => row.id)
        : [...new Set(ids)];
    if (!continuing) {
      status.current.clear();
      catalogComplete.current = false;
    }
    for (const id of pending)
      if (!status.current.has(id))
        status.current.set(id, { id, metrics: false, fees: false });
    resume.current = { key, ids: pending };
    setIssues([]);
    const needsCatalog = syncCatalog && !catalogComplete.current;
    onWorking(true);
    setProgress({
      done: 0,
      total: pending.length,
      phase: needsCatalog ? "catalog" : "indicators",
    });
    const deadline = Date.now() + 180000;
    let catalogSynced = false;
    try {
      if (needsCatalog) {
        let complete = false,
          consulted = 0;
        for (let step = 0; step < 100 && Date.now() < deadline; step++) {
          const catalog = await jsonRequest<{
            partial: boolean;
            results: {
              storeId: string;
              status: string;
              processed?: number;
              has_more?: boolean;
            }[];
          }>(
            "/api/catalog/refresh?" + new URLSearchParams({ store }),
            {},
            "POST",
            controller.signal,
            "foreground",
            Math.min(65000, Math.max(1, deadline - Date.now())),
          );
          if (request.current !== controller) return;
          if (
            !Array.isArray(catalog.results) ||
            !catalog.results.length ||
            catalog.results.some((r) => r.storeId !== store)
          )
            throw new Error(
              "O catálogo da loja não foi consultado. Confira a conexão do ML.",
            );
          if (catalog.results.some((r) => r.status === "running"))
            throw new Error(
              "Esta loja já está sincronizando. Aguarde a conclusão antes de atualizar novamente.",
            );
          if (catalog.results.some((r) => r.status !== "confirmed"))
            throw new Error(
              "O ML não confirmou a consulta do catálogo. Tente novamente.",
            );
          consulted += catalog.results.reduce(
            (sum, r) => sum + (r.processed || 0),
            0,
          );
          setProgress({ done: consulted, total: 0, phase: "catalog" });
          if (!catalog.partial && catalog.results.every((r) => !r.has_more)) {
            complete = true;
            break;
          }
          if (catalog.results.every((r) => !r.processed)) break;
        }
        if (!complete)
          throw new Error(
            "Catálogo parcialmente atualizado. Clique novamente para continuar as páginas pendentes.",
          );
      }
      if (needsCatalog) catalogComplete.current = true;
      catalogSynced = needsCatalog;
      if (Date.now() >= deadline)
        throw new Error(
          "Catálogo atualizado. Consulte novamente para concluir os indicadores pendentes.",
        );
      setProgress({ done: 0, total: pending.length, phase: "indicators" });
      const outcome = await runListingBatches<Result>(
        pending,
        async (batch) => {
          const result = await jsonRequest<{ results: Result[] }>(
            "/api/catalog/indicators?" + new URLSearchParams({ store }),
            {
              ids: batch,
              parts: Object.fromEntries(
                batch.map((id) => {
                  const current = status.current.get(id)!;
                  return [
                    id,
                    [
                      !current.metrics && "metrics",
                      !current.fees && "fees",
                    ].filter(Boolean),
                  ];
                }),
              ),
            },
            "POST",
            controller.signal,
            "foreground",
            Math.min(65000, Math.max(1, deadline - Date.now())),
          );
          return result.results.map((row) => {
            const current = status.current.get(row.id);
            if (!current || !batch.includes(row.id)) return row;
            const merged = {
              id: row.id,
              metrics: current.metrics || row.metrics,
              fees: current.fees || row.fees,
              error: row.errors?.join(" · "),
            };
            status.current.set(row.id, merged);
            return { ...row, metrics: merged.metrics, fees: merged.fees };
          });
        },
        (r) => r.metrics && r.fees,
        (done, total) => {
          if (request.current === controller) setProgress({ done, total });
        },
        (remaining) => {
          resume.current = remaining.length ? { key, ids: remaining } : null;
        },
        {
          maxDurationMs: Math.max(1, deadline - Date.now()),
          batchSize: LISTING_INDICATOR_BATCH_SIZE,
        },
      );
      if (request.current !== controller) return;
      const remaining = [...status.current.values()].filter(
        (row) => !row.metrics || !row.fees,
      );
      resume.current = remaining.length
        ? { key, ids: remaining.map((row) => row.id) }
        : null;
      for (const row of remaining)
        if (!row.error && outcome.error) row.error = outcome.error;
      notify(
        `${catalogSynced ? "Catálogo da loja sincronizado. " : ""}${outcome.successful} anúncios com indicadores consultados.${remaining.length ? ` ${remaining.length} pendentes; abra as pendências para reconsultar apenas os dados que faltam.` : ""}${outcome.error ? ` ${outcome.error}` : ""}`,
        remaining.length || outcome.error ? "warning" : "success",
      );
    } catch (error) {
      if (request.current !== controller) return;
      notify(
        controller.signal.aborted
          ? "Consulta interrompida. Os dados já atualizados foram mantidos; clique novamente para continuar os pendentes."
          : (error as Error).message,
        controller.signal.aborted ? "info" : "error",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setProgress(null);
        setIssues(
          [...status.current.values()].filter(
            (row) => !row.metrics || !row.fees,
          ),
        );
        onWorking(false);
        changed.current();
      }
    }
  };
  return {
    start,
    cancel,
    progress,
    issues,
    retry: () => start([...status.current.keys()], true),
  };
}
