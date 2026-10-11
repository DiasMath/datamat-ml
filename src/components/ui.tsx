"use client";
import {
  useEffect,
  useRef,
  useId,
  Children,
  isValidElement,
  cloneElement,
} from "react";
import { X, ArrowUpRight, Inbox, LoaderCircle } from "lucide-react";
import { displayDate } from "../domain/dates";

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
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? titleId + "-subtitle" : undefined}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={titleId + "-subtitle"}>{subtitle}</p>}
        </div>
        <button aria-label="Fechar" className="icon-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
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
export const jsonRequest = async <T = any,>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> => {
  const res = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Não foi possível concluir a operação");
  }
  return data;
};
