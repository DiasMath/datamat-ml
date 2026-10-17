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
    if (!enabled || blocked) return;
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
        const result = await jsonRequest(
          "/api/catalog/refresh?" + new URLSearchParams({ store }),
          offerId ? { offerId } : {},
          "POST",
          controller.signal,
          "background",
          65000,
        );
        if (safe()) {
          onReload((n) => n + 1);
          lastError.current = "";
          if (result.results?.some((r: any) => r.updated > 0))
            notify("Alterações do ML atualizadas no cadastro.", "success");
        }
      } catch (e) {
        if (active && !controller.signal.aborted) {
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
