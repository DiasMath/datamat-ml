"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info" | "warning";
type Message = {
  id: number;
  text: string;
  kind: Kind;
  duration: number;
  remaining: { current: number };
};
const Context = createContext<{
  notify: (text: string, kind?: Kind) => void;
  clear: () => void;
  setHost: (host: HTMLDivElement | null) => void;
} | null>(null);
export function useToast() {
  const value = useContext(Context);
  if (!value) throw new Error("ToastProvider ausente");
  return value;
}
// Repeated render/effect executions do not repeat the same notification.
export function useToastMessage(
  text: string | null | undefined,
  kind: Kind = "error",
) {
  const { notify } = useToast();
  const previous = useRef("");
  useEffect(() => {
    if (text && text !== previous.current) notify(text, kind);
    previous.current = text || "";
  }, [text, kind, notify]);
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState<Element | null>(null);
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    setMounted(true);
    const visibility = () => setHidden(document.hidden);
    const screen = () => setFullscreen(document.fullscreenElement);
    visibility();
    screen();
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("fullscreenchange", screen);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("fullscreenchange", screen);
    };
  }, []);
  const notify = useCallback((text: string, kind: Kind = "success") => {
    if (!text.trim()) return;
    const duration = kind === "error" ? 9000 : kind === "success" ? 5000 : 7000;
    const message: Message = {
      id: ++sequence.current,
      text,
      kind,
      duration,
      remaining: { current: duration },
    };
    setMessages((old) =>
      [...old.filter((m) => m.text !== text || m.kind !== kind), message].slice(
        -4,
      ),
    );
  }, []);
  const dismiss = useCallback(
    (id: number) => setMessages((old) => old.filter((m) => m.id !== id)),
    [],
  );
  const clear = useCallback(() => setMessages([]), []);
  return (
    <Context.Provider value={{ notify, clear, setHost }}>
      {children}
      {mounted &&
        createPortal(
          <div className="toast-viewport" aria-label="Avisos da operação">
            {messages.map((message) => (
              <Toast
                key={message.id}
                message={message}
                hidden={hidden}
                dismiss={dismiss}
              />
            ))}
          </div>,
          host || fullscreen || document.body,
        )}
    </Context.Provider>
  );
}
function Toast({
  message,
  hidden,
  dismiss,
}: {
  message: Message;
  hidden: boolean;
  dismiss: (id: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hidden || hovered || focused;
  const elapsed = useRef(message.duration - message.remaining.current);
  useEffect(() => {
    if (paused) return;
    const started = performance.now();
    const timer = setTimeout(
      () => dismiss(message.id),
      message.remaining.current,
    );
    return () => {
      clearTimeout(timer);
      message.remaining.current = Math.max(
        0,
        message.remaining.current - (performance.now() - started),
      );
    };
  }, [message, paused, dismiss]);
  const Icon =
    message.kind === "success"
      ? Check
      : message.kind === "info"
        ? Info
        : AlertCircle;
  return (
    <div
      className={`toast ${message.kind}`}
      data-paused={paused || undefined}
      role={
        message.kind === "error" || message.kind === "warning"
          ? "alert"
          : "status"
      }
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      style={
        {
          "--toast-duration": `${message.duration}ms`,
          "--toast-elapsed": `${-elapsed.current}ms`,
        } as CSSProperties
      }
    >
      <div className="toast-progress" aria-hidden="true" />
      <Icon size={18} aria-hidden="true" />
      <span>{message.text}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Fechar aviso"
        onClick={() => dismiss(message.id)}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
