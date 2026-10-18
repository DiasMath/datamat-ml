"use client";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { jsonRequest } from "./ui";
import { useToast } from "./toasts";
export default function useCatalogPolling({
  store,
  offerId,
  enabled,
  blocked,
  onReload,
}: {
  store: string;
  offerId?: string;
  enabled: boolean;
  blocked: boolean;
  onReload: Dispatch<SetStateAction<number>>;
}) {
  const { notify } = useToast(),
    lastError = useRef("");
  useEffect(() => {
    if (!enabled || blocked || store === "all") return;
    let active = true,
      running = false,
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
          Math.max(1000, lastAttempt + 60000 - Date.now()),
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
      try {
        const deadline = Date.now() + 180000;
        let changes = 0;
        for (
          let step = 0;
          step < 100 && safe() && Date.now() < deadline;
          step++
        ) {
          const result = await jsonRequest(
            "/api/catalog/refresh?" + new URLSearchParams({ store }),
            offerId ? { offerId } : {},
            "POST",
            controller.signal,
            "background",
            Math.min(65000, Math.max(1, deadline - Date.now())),
          );
          if (safe()) {
            onReload((n) => n + 1);
            lastError.current = "";
            changes +=
              result.results?.reduce(
                (sum: number, r: any) => sum + (r.updated || 0),
                0,
              ) || 0;
          }
          if (!result.partial) {
            if (safe() && changes > 0)
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
      } catch (e) {
        if (active && !controller.signal.aborted) {
          if (safe()) onReload((n) => n + 1);
          lastAttempt = Date.now();
          const message = (e as Error).message;
          if (lastError.current !== message) {
            lastError.current = message;
            notify("Atualização do ML pendente: " + message, "warning");
          }
        }
      } finally {
        running = false;
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
