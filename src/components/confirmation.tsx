"use client";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
type Options = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
const DirtyContext = createContext<{
  register: (id: string, dirty: boolean, discard?: () => void) => void;
  hasUnsaved: () => boolean;
}>({ register: () => {}, hasUnsaved: () => false });
export const useUnsavedRegistry = () => useContext(DirtyContext);
export function useUnsavedChanges(dirty: boolean, onDiscard?: () => void) {
  const callback = useRef(onDiscard);
  callback.current = onDiscard;
  const id = useId(),
    { register } = useUnsavedRegistry();
  useLayoutEffect(() => {
    register(id, dirty, () => callback.current?.());
    return () => register(id, false);
  }, [id, dirty, register]);
}
const Context = createContext<(options: Options) => Promise<boolean>>(() =>
  Promise.resolve(false),
);
export const useConfirm = () => useContext(Context);
export const discardChanges: Options = {
  title: "Descartar alterações?",
  description:
    "Você tem alterações que ainda não foram salvas. Ao continuar, elas serão perdidas.",
  confirmLabel: "Descartar e continuar",
  cancelLabel: "Continuar editando",
  danger: true,
};
export function ConfirmationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const locationSnapshot = useRef<{ url: string; state: unknown } | null>(null);
  const unsaved = useRef(new Map<string, (() => void) | undefined>());
  const register = useCallback(
    (id: string, dirty: boolean, discard?: () => void) => {
      if (dirty) {
        unsaved.current.set(id, discard);
        locationSnapshot.current = {
          url: window.location.href,
          state: window.history.state,
        };
      } else unsaved.current.delete(id);
    },
    [],
  );
  const hasUnsaved = useCallback(() => unsaved.current.size > 0, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (unsaved.current.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const [options, setOptions] = useState<Options | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirm = useCallback((next: Options) => {
    // Keep the first decision open; repeated clicks must not replace its action.
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setOptions(next);
    });
  }, []);
  useEffect(() => {
    const handleBack = (event: PopStateEvent) => {
      if (!unsaved.current.size || !locationSnapshot.current) return;
      const target = window.location.href;
      event.stopImmediatePropagation();
      window.history.pushState(
        locationSnapshot.current.state,
        "",
        locationSnapshot.current.url,
      );
      void confirm(discardChanges).then((accepted) => {
        if (!accepted) return;
        const callbacks = [...unsaved.current.values()];
        unsaved.current.clear();
        callbacks.forEach((discard) => discard?.());
        router.replace(target);
      });
    };
    window.addEventListener("popstate", handleBack, true);
    return () => window.removeEventListener("popstate", handleBack, true);
  }, [confirm, router]);
  function finish(value: boolean) {
    dialog.current?.close();
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(value);
  }
  useEffect(() => {
    if (options) dialog.current?.showModal();
  }, [options]);
  useEffect(
    () => () => {
      pending.current?.(false);
    },
    [],
  );
  return (
    <DirtyContext.Provider value={{ register, hasUnsaved }}>
      <Context.Provider value={confirm}>
        {children}
        {options && (
          <dialog
            ref={dialog}
            className="modal confirmation-modal"
            aria-labelledby={titleId}
            aria-describedby={titleId + "-description"}
            onCancel={(e) => {
              e.preventDefault();
              finish(false);
            }}
          >
            <div
              className={
                "confirmation-icon " + (options.danger ? "danger-text" : "")
              }
            >
              {options.danger ? (
                <Trash2 size={23} />
              ) : (
                <AlertTriangle size={23} />
              )}
            </div>
            <h2 id={titleId}>{options.title}</h2>
            <p id={titleId + "-description"}>{options.description}</p>
            <div className="confirmation-actions">
              <button
                autoFocus
                className="button"
                onClick={() => finish(false)}
              >
                {options.cancelLabel || "Cancelar"}
              </button>
              <button
                className={"button " + (options.danger ? "danger" : "primary")}
                onClick={() => finish(true)}
              >
                {options.confirmLabel || "Confirmar"}
              </button>
            </div>
          </dialog>
        )}
      </Context.Provider>
    </DirtyContext.Provider>
  );
}
