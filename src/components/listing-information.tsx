"use client";
import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
export type ListingInformation = {
  title: string;
  subtitle?: string;
  rows?: Array<{ label: string; value: ReactNode }>;
  notes?: string[];
  action?: { label: string; run: () => void };
};
type Active = {
  content: ListingInformation;
  anchor: HTMLElement;
  pinned: boolean;
};
const Context = createContext<{
  show: (
    content: ListingInformation,
    anchor: HTMLElement,
    pinned?: boolean,
    delay?: number,
  ) => void;
  leave: () => void;
  close: () => void;
} | null>(null);
export function ListingInformationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [active, setActive] = useState<Active | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const heading = useId();
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const close = useCallback(() => {
    clear();
    activeRef.current = null;
    setActive(null);
  }, [clear]);
  const show = useCallback(
    (
      content: ListingInformation,
      anchor: HTMLElement,
      pinned = false,
      delay = 0,
    ) => {
      clear();
      if (activeRef.current?.pinned && delay) return;
      const reveal = () => {
        const next = { content, anchor, pinned };
        activeRef.current = next;
        setActive(next);
      };
      if (delay) timer.current = setTimeout(reveal, delay);
      else reveal();
    },
    [clear],
  );
  const leave = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      if (!activeRef.current?.pinned) setActive(null);
    }, 160);
  }, [clear]);
  useLayoutEffect(() => {
    if (!active || !panel.current) return;
    const anchor = active.anchor.getBoundingClientRect(),
      box = panel.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8));
    const below = anchor.bottom + 8;
    const top =
      below + box.height <= innerHeight - 8
        ? below
        : Math.max(8, anchor.top - box.height - 8);
    setPosition({ left, top });
  }, [active]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !activeRef.current?.anchor.contains(event.target as Node)
      )
        close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      const current = activeRef.current;
      if (current?.pinned) {
        const box = current.anchor.getBoundingClientRect();
        if (
          box.bottom >= 0 &&
          box.top <= innerHeight &&
          box.right >= 0 &&
          box.left <= innerWidth
        ) {
          setActive({ ...current });
          return;
        }
      }
      close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      clear();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, [close, clear]);
  const value = useMemo(() => ({ show, leave, close }), [show, leave, close]);
  return (
    <Context.Provider value={value}>
      {children}
      {active &&
        createPortal(
          <div
            className="listing-information"
            role="dialog"
            aria-modal="false"
            aria-labelledby={heading}
            ref={panel}
            style={position}
            onPointerEnter={clear}
            onPointerLeave={leave}
            onFocusCapture={clear}
            onBlurCapture={leave}
          >
            <header>
              <Info size={17} />
              <div>
                <h3 id={heading}>{active.content.title}</h3>
                {active.content.subtitle && <p>{active.content.subtitle}</p>}
              </div>
              <button
                className="icon-button"
                aria-label="Fechar informações"
                onClick={close}
              >
                <X size={16} />
              </button>
            </header>
            {!!active.content.rows?.length && (
              <dl>
                {active.content.rows.map((row, i) => (
                  <div key={i}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {active.content.notes?.map((note, i) => (
              <p className="information-note" key={i}>
                {note}
              </p>
            ))}
            {active.content.action && (
              <button
                className="button compact"
                onClick={() => {
                  active.content.action!.run();
                  close();
                }}
              >
                {active.content.action.label}
              </button>
            )}
          </div>,
          document.body,
        )}
    </Context.Provider>
  );
}
export function ListingHint({
  content,
  children,
}: {
  content: ListingInformation | (() => ListingInformation);
  children: ReactElement<any>;
}) {
  const context = useContext(Context);
  if (!context) return children;
  const original = children.props;
  const readonly = !original.onClick;
  const resolve = () => (typeof content === "function" ? content() : content);
  return cloneElement(children, {
    title: undefined,
    "data-listing-information": true,
    ...(readonly
      ? {
          tabIndex: original.tabIndex ?? 0,
          role: original.role ?? "button",
          "aria-haspopup": "dialog",
        }
      : {}),
    onPointerEnter: (event: any) => {
      if (event.pointerType === "mouse")
        context.show(resolve(), event.currentTarget, false, 280);
    },
    onPointerLeave: context.leave,
    onFocus: (event: any) => context.show(resolve(), event.currentTarget),
    onBlur: context.leave,
    onClick: (event: any) => {
      if (original.onClick) {
        context.close();
        original.onClick(event);
      } else context.show(resolve(), event.currentTarget, true);
    },
    onKeyDown: (event: any) => {
      if (readonly && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        context.show(resolve(), event.currentTarget, true);
      }
      original.onKeyDown?.(event);
    },
  });
}
