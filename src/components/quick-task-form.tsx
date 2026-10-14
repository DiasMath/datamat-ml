"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { TaskForm } from "./forms";
import { jsonRequest } from "./ui";
import { useToast } from "./toasts";
type Row = Record<string, any>;
export default function QuickTaskForm({
  data,
  initial,
  busy,
  onSave,
  onDirty,
}: {
  data: Row;
  initial?: Row;
  busy: boolean;
  onSave: (payload: Row) => void;
  onDirty: () => void;
}) {
  const [store, setStore] = useState(
    initial?.store_id || data.selectedStore || data.stores[0]?.id || "",
  );
  const [options, setOptions] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  const { notify } = useToast();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setOptions(null);
    jsonRequest(
      "/api/task-options?" + new URLSearchParams({ store }),
      undefined,
      "GET",
      controller.signal,
      "background",
    )
      .then((result) => {
        if (!controller.signal.aborted) setOptions(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(true);
          notify(e.message, "error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [store, retry, notify]);
  return (
    <>
      <TaskForm
        data={{
          ...data,
          offerChoices: options?.offerChoices || [],
          tasks: options?.tasks || data.tasks || [],
        }}
        initial={initial}
        busy={busy}
        onSave={onSave}
        onDirty={onDirty}
        choicesLoading={loading}
        onStoreChange={setStore}
      />
      {error && (
        <button className="text-link" onClick={() => setRetry((n) => n + 1)}>
          <RefreshCw size={13} /> Recarregar anúncios e sugestões
        </button>
      )}
      {options?.truncated && (
        <small className="muted">
          Lista de vínculos limitada. As ações gerais da loja continuam
          disponíveis.
        </small>
      )}
    </>
  );
}
