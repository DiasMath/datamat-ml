"use client";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { jsonRequest, ApiRequestError } from "./ui";
import { useToast } from "./toasts";
export default function useCatalogPolling({
  store,
  offerId,
  revision,
  enabled,
  blocked,
  onReload,
}: {
  store: string;
  offerId?: string;
  revision?: string;
  enabled: boolean;
  blocked: boolean;
  onReload: Dispatch<SetStateAction<number>>;
}) {
  const { notify } = useToast();
  const lastError = useRef("");
  const displayed = useRef(revision);
  displayed.current = revision;
  useEffect(() => {
    if (!enabled || blocked || store === "all") return;
    let active = true,
      running = false,
      retryIn = 60000,
      timer: ReturnType<typeof setTimeout> | undefined,
      lastAttempt = Date.now();
    const controller = new AbortController();
    const safe = () =>
      active && !document.hidden && !document.querySelector("dialog[open]");
    const schedule = () => {
      clearTimeout(timer);
      if (active && !document.hidden && !running)
        timer = setTimeout(
          run,
          Math.max(1000, lastAttempt + retryIn - Date.now()),
        );
    };
    async function run() {
      if (!safe()) {
        lastAttempt = Date.now();
        schedule();
        return;
      }
      running = true;
      lastAttempt = Date.now();
      let reload = false;
      try {
        const params = new URLSearchParams({
          store,
          ...(offerId ? { offerId } : {}),
        });
        const state = await jsonRequest<{
          revision: string;
          refreshDue: boolean;
        }>(
          "/api/catalog/revision?" + params,
          undefined,
          "GET",
          controller.signal,
          "background",
          25000,
        );
        reload = state.revision !== displayed.current;
        if (state.refreshDue) {
          const deadline = Date.now() + 180000;
          let changes = 0;
          for (
            let step = 0;
            step < 100 && safe() && Date.now() < deadline;
            step++
          ) {
            const result = await jsonRequest(
              "/api/catalog/refresh?" + new URLSearchParams({ store }),
              { automatic: true, ...(offerId ? { offerId } : {}) },
              "POST",
              controller.signal,
              "background",
              Math.min(65000, Math.max(1, deadline - Date.now())),
            );
            reload ||=
              result.results?.some(
                (r: any) => !r.skipped && r.status === "confirmed",
              ) || false;
            changes +=
              result.results?.reduce(
                (sum: number, r: any) => sum + (r.updated || 0),
                0,
              ) || 0;
            if (!result.partial) {
              if (safe() && changes)
                notify("Alterações do ML atualizadas no cadastro.", "success");
              break;
            }
            if (
              !result.results?.length ||
              result.results.some((r: any) => r.status === "running") ||
              result.results.every((r: any) => !r.processed)
            )
              break;
          }
        }
        retryIn = 60000;
        lastError.current = "";
      } catch (e) {
        if (active && !controller.signal.aborted) {
          retryIn =
            e instanceof ApiRequestError &&
            e.code === "FIRESTORE_QUOTA_EXCEEDED"
              ? 15 * 60000
              : Math.min(15 * 60000, retryIn * 2);
          const message = (e as Error).message;
          if (lastError.current !== message) {
            lastError.current = message;
            notify("Atualização do ML pendente: " + message, "warning");
          }
        }
      } finally {
        if (reload && safe()) onReload((n) => n + 1);
        running = false;
        lastAttempt = Date.now();
        schedule();
      }
    }
    const visible = () => {
      if (document.hidden) clearTimeout(timer);
      else schedule();
    };
    document.addEventListener("visibilitychange", visible);
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [store, offerId, enabled, blocked, onReload, notify]);
}
