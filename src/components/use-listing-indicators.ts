"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { runListingBatches } from "../domain/listing-batches";
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
  onWorking,
  onChanged,
}: {
  scope: string;
  onWorking: (working: boolean) => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
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
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const key = scope + ":" + [...new Set(ids)].sort().join(",");
    const pending =
      resume.current?.key === key ? resume.current.ids : [...new Set(ids)];
    resume.current = { key, ids: pending };
    onWorking(true);
    setProgress({ done: 0, total: pending.length });
    let issues = 0;
    try {
      const outcome = await runListingBatches<Result>(
        pending,
        async (batch) => {
          const result = await jsonRequest<{ results: Result[] }>(
            "/api/catalog/indicators",
            { ids: batch },
            "POST",
            controller.signal,
            "foreground",
            65000,
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
        { maxDurationMs: 180000 },
      );
      if (request.current !== controller) return;
      resume.current = outcome.pendingIds.length
        ? { key, ids: outcome.pendingIds }
        : null;
      const warnings = issues + outcome.failed;
      notify(
        `${outcome.successful} anúncios consultados.${warnings ? ` ${warnings} com dados indisponíveis ou parciais.` : ""}${outcome.pendingIds.length ? ` ${outcome.pendingIds.length} pendentes; clique novamente para continuar.` : ""}${outcome.error ? ` ${outcome.error}` : ""}`,
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
