"use client";
import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "./ui";
type Result = { connected: boolean; message?: string };
export default function useMlAuthorization(options: {
  disabled: boolean;
  returnTo: string;
  onWorking: (working: boolean) => void;
  onResult: (result: Result) => void;
}) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const cleanup = useRef<(() => void) | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  useEffect(
    () => () => {
      cleanup.current?.();
    },
    [],
  );
  async function authorize(id: string) {
    if (callbacks.current.disabled || cleanup.current) return;
    const channelKey = crypto.randomUUID();
    const popup = window.open(
      "",
      "ml-authorization-" + channelKey,
      "popup,width=640,height=760",
    );
    if (!popup) {
      callbacks.current.onResult({
        connected: false,
        message:
          "Permita a janela de autorização do Mercado Livre no navegador e tente novamente.",
      });
      return;
    }
    popup.document.title = "Conectar Mercado Livre";
    popup.document.body.textContent = "Abrindo autorização do Mercado Livre…";
    setConnectionId(id);
    callbacks.current.onWorking(true);
    let done = false;
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("datamat-ml-oauth-" + channelKey)
        : null;
    let closedAt = 0;
    const finish = (result: Result) => {
      if (done) return;
      done = true;
      cleanup.current?.();
      cleanup.current = null;
      cancel.current = null;
      setConnectionId(null);
      callbacks.current.onWorking(false);
      callbacks.current.onResult(result);
    };
    const receive = (data: any) => {
      if (
        data?.type !== "datamat-ml-authorization" ||
        data.channel !== channelKey ||
        !["connected", "failed"].includes(data.result)
      )
        return;
      finish({
        connected: data.result === "connected",
        message: typeof data.message === "string" ? data.message : undefined,
      });
    };
    const message = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === popup)
        receive(event.data);
    };
    window.addEventListener("message", message);
    if (channel) channel.onmessage = (event) => receive(event.data);
    const timer = setInterval(() => {
      if (!popup.closed) {
        closedAt = 0;
        return;
      }
      closedAt ||= Date.now();
      // Allow the callback's cross-window notification to arrive first.
      // A provider's COOP policy can detach the opener while consent is still
      // open. BroadcastChannel remains valid; the UI offers explicit cancel.
      if (!channel && Date.now() - closedAt > 2000)
        finish({
          connected: false,
          message:
            "Janela de autorização fechada. A loja e os filtros foram preservados; conecte novamente se necessário.",
        });
    }, 500);
    const timeout = setTimeout(
      () =>
        finish({
          connected: false,
          message:
            "A autorização expirou. Inicie uma nova conexão com o Mercado Livre.",
        }),
      600000,
    );
    cleanup.current = () => {
      clearInterval(timer);
      clearTimeout(timeout);
      window.removeEventListener("message", message);
      channel?.close();
    };
    cancel.current = () => {
      popup.close();
      finish({
        connected: false,
        message:
          "Autorização cancelada; a loja e os filtros foram preservados.",
      });
    };
    try {
      const result = await jsonRequest(`/api/connections/${id}/authorize`, {
        returnTo: callbacks.current.returnTo,
        popupChannel: channelKey,
      });
      if (!done && !popup.closed) popup.location.href = result.url;
    } catch (error) {
      popup.close();
      finish({ connected: false, message: (error as Error).message });
    }
  }
  return { authorize, connectionId, cancel: () => cancel.current?.() };
}
