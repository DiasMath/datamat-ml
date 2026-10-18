"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  runListingBatches,
  LISTING_INDICATOR_BATCH_SIZE,
} from "../domain/listing-batches";
import { jsonRequest } from "./ui";
import { useToast } from "./toasts";

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
    },
    [scope, onWorking],
  );
  const cancel = useCallback(() => request.current?.abort(), []);
  const start = async (ids: string[]) => {
    if (request.current || store === "all") return;
    const controller = new AbortController();
    request.current = controller;
    const key = scope + ":" + [...new Set(ids)].sort().join(",");
    const pending =
      resume.current?.key === key ? resume.current.ids : [...new Set(ids)];
    resume.current = { key, ids: pending };
    onWorking(true);
    setProgress({
      done: 0,
      total: pending.length,
      phase: syncCatalog ? "catalog" : "indicators",
    });
    const deadline = Date.now() + 180000;
    let issues = 0;
    try {
      if (syncCatalog) {
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
            { ids: batch },
            "POST",
            controller.signal,
            "foreground",
            Math.min(65000, Math.max(1, deadline - Date.now())),
          );
          issues += result.results.filter(
            (r) => !r.deferred && r.errors?.length && (r.metrics || r.fees),
          ).length;
          return result.results;
        },
        (r) => r.metrics || r.fees,
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
      resume.current = outcome.pendingIds.length
        ? { key, ids: outcome.pendingIds }
        : null;
      const warnings = issues + outcome.failed;
      notify(
        `${syncCatalog ? "Catálogo da loja sincronizado. " : ""}${outcome.successful} anúncios com indicadores consultados.${warnings ? ` ${warnings} com dados indisponíveis ou parciais.` : ""}${outcome.pendingIds.length ? ` ${outcome.pendingIds.length} pendentes; clique novamente para continuar.` : ""}${outcome.error ? ` ${outcome.error}` : ""}`,
        warnings || outcome.pendingIds.length || outcome.error
          ? "warning"
          : "success",
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
        onWorking(false);
        changed.current();
      }
    }
  };
  return { start, cancel, progress };
}
