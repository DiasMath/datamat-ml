"use client";
import {
  useEffect,
  useState,
  useRef,
  useId,
  Children,
  isValidElement,
  cloneElement,
  useSyncExternalStore,
} from "react";
import { X, ArrowUpRight, Inbox, LoaderCircle } from "lucide-react";
import { displayDate } from "../domain/dates";
import { useConfirm, discardChanges, useUnsavedChanges } from "./confirmation";
import { useToast } from "./toasts";
import useDialogDismiss from "./use-dialog-dismiss";

export const money = (value: unknown) =>
  value === null || value === undefined
    ? "Indisponível"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(Number(value));
export const percent = (value: unknown, maximumFractionDigits = 2) =>
  value == null
    ? "Indisponível"
    : new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(
        Number(value),
      ) + "%";
export const date = displayDate;
export const labels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
  unit: "Unidade",
  kit: "Kit",
  variation: "Variação",
  review: "Em revisão",
  approved: "Aprovada",
  pending_application: "Aplicação pendente",
  applied_manual: "Aplicada • manual",
  applied_ml: "Aplicada • Mercado Livre",
  applying_ml: "Aplicando no ML",
  application_uncertain: "Conferência necessária",
  failed: "Falha",
  rejected: "Rejeitada",
  deleted: "Excluído",
  confirmed: "Registrado",
  todo: "A fazer",
  doing: "Em andamento",
  done: "Concluída",
  cancelled: "Cancelada",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
  question: "Dúvida",
  study: "Estudo",
  learning: "Aprendizado",
  idea: "Ideia",
  insight: "Insight",
  unconfigured: "Sem configuração",
  unauthorized: "Sem autorização",
  connected: "Conectado",
  running: "Em andamento",
  admin: "Administrador",
  approver: "Aprovador",
  manager: "Gestor",
  viewer: "Consulta",
  manual: "Manual",
  import: "Importação",
  reference: "Referência",
  mercadolivre: "Mercado Livre",
  bling: "Bling",
  ai: "IA",
};
export function Badge({
  value,
  children,
}: {
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={`badge ${value || ""}`}>
      <span className="dot" />
      {children || labels[value || ""] || value}
    </span>
  );
}
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={25} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const key = useId();
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span id={key}>{label}</span>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        ["input", "textarea", "select"].includes(String(child.type))
          ? cloneElement(child as React.ReactElement<Record<string, unknown>>, {
              "aria-labelledby": key,
              "aria-describedby": hint ? key + "-hint" : undefined,
            })
          : child,
      )}
      {hint && <small id={key + "-hint"}>{hint}</small>}
    </label>
  );
}
export function Submit({
  busy,
  label = "Salvar",
}: {
  busy: boolean;
  label?: string;
}) {
  return (
    <button className="button primary" disabled={busy} type="submit">
      {busy ? <LoaderCircle className="spin" size={16} /> : null}
      {busy ? "Salvando…" : label}
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  protectChanges = true,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  protectChanges?: boolean;
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const confirm = useConfirm();
  const [changed, setChanged] = useState(false);
  useUnsavedChanges(changed && protectChanges, () => {
    setChanged(false);
    onClose();
  });
  async function close() {
    if (busy) return;
    if (protectChanges && changed && !(await confirm(discardChanges))) return;
    setChanged(false);
    onClose();
  }
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dismiss = useDialogDismiss(() => void close());
  const { setHost } = useToast();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? titleId + "-subtitle" : undefined}
      className="modal"
      {...dismiss}
      onChangeCapture={() => setChanged(true)}
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={titleId + "-subtitle"}>{subtitle}</p>}
        </div>
        <button
          aria-label="Fechar"
          className="icon-button"
          onClick={close}
          disabled={busy}
        >
          <X size={20} />
        </button>
      </div>
      {children}
      <div ref={setHost} className="toast-dialog-host" />
    </dialog>
  );
}
export function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return /^https?:\/\//i.test(href) ? (
    <a
      className="text-link"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
      <ArrowUpRight size={14} />
    </a>
  ) : (
    <span>{children}</span>
  );
}
export const nullable = (value: FormDataEntryValue | null) =>
  value === null || String(value).trim() === ""
    ? null
    : String(value).trim().replace(",", ".");
export const string = (form: FormData, key: string) =>
  String(form.get(key) || "").trim();
let requests = 0;
const activitySubscribers = new Set<() => void>();
function activityChange(change: number) {
  requests = Math.max(0, requests + change);
  activitySubscribers.forEach((listener) => listener());
}
export async function trackedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  activity: "foreground" | "background" = "foreground",
) {
  if (activity === "foreground") activityChange(1);
  try {
    return await fetch(input, init);
  } finally {
    if (activity === "foreground") activityChange(-1);
  }
}
export function RequestLoading({
  busy = false,
  label = "Processando…",
}: {
  busy?: boolean;
  label?: string;
}) {
  const count = useSyncExternalStore(
    (listener) => {
      activitySubscribers.add(listener);
      return () => {
        activitySubscribers.delete(listener);
      };
    },
    () => requests,
    () => 0,
  );
  const active = busy || count > 0;
  return (
    <div
      className="request-loading"
      role={active ? "progressbar" : undefined}
      aria-label={active ? "Operação em andamento" : undefined}
      aria-valuetext={active ? label : undefined}
      title={active ? label : undefined}
    >
      {active && <LoaderCircle size={18} className="spin" aria-hidden="true" />}
    </div>
  );
}
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export const jsonRequest = async <T = any,>(
  url: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
  activity: "foreground" | "background" = "foreground",
  timeoutMs?: number,
): Promise<T> => {
  const controller = timeoutMs ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const activeSignal = controller
    ? signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    : signal;
  const execute = async () => {
    const res = await trackedFetch(
      url,
      body === undefined
        ? { cache: "no-store", signal: activeSignal }
        : {
            method,
            signal: activeSignal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
      activity,
    );
    const data = await res.json();
    if (!res.ok) {
      throw new ApiRequestError(
        data.error || "Não foi possível concluir a operação",
        res.status,
        typeof data.code === "string" ? data.code : undefined,
      );
    }
    return data;
  };
  if (!timeoutMs) return execute();
  const stopped = new Promise<never>((_, reject) => {
    stop = () =>
      reject(new DOMException("Consulta interrompida", "AbortError"));
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    timer = setTimeout(() => {
      reject(
        new Error(
          "A consulta demorou além do esperado. Os dados já atualizados foram preservados; continue a consulta para retomar os pendentes.",
        ),
      );
      controller?.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([execute(), stopped]);
  } finally {
    clearTimeout(timer);
    if (stop) signal?.removeEventListener("abort", stop);
  }
};
