import { waitForSync } from "./catalog-sync";
type Result = { id: string; deferred?: boolean; retryAfterMs?: number };
export const LISTING_INDICATOR_BATCH_SIZE = 10;
// Each completed ID leaves the queue exactly once. A deferred or missing result
// remains pending; a request that makes no progress stops rather than looping.
export async function runListingBatches<T extends Result>(
  ids: string[],
  send: (ids: string[]) => Promise<T[]>,
  succeeded: (result: T) => boolean,
  onProgress: (done: number, total: number) => void,
  onBatch: (pending: string[]) => void = () => {},
  options: {
    maxDurationMs?: number;
    clock?: () => number;
    batchSize?: number;
    signal?: AbortSignal;
    retryDeferred?: boolean;
    batchDelayMs?: number;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onWait?: (ms: number) => void;
  } = {},
) {
  const clock = options.clock || Date.now;
  const wait = options.wait || waitForSync;
  const deadline = clock() + (options.maxDurationMs ?? Infinity);
  const batchSize = Math.max(
    1,
    Math.min(10, Math.floor(options.batchSize || 5)),
  );
  let pendingIds = [...new Set(ids)];
  const total = pendingIds.length;
  let successful = 0,
    failed = 0,
    error: string | null = null;
  let retries = 0,
    stalls = 0;
  while (pendingIds.length) {
    options.signal?.throwIfAborted();
    if (clock() >= deadline) {
      error =
        "A consulta foi dividida em etapas. Continue para atualizar os anúncios pendentes.";
      break;
    }
    const batch = pendingIds.slice(0, batchSize);
    onProgress(total - pendingIds.length, total);
    let results: T[];
    try {
      results = await send(batch);
      if (!Array.isArray(results))
        throw new Error("A consulta retornou um lote incompleto.");
    } catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError")
        throw failure;
      const transient = failure as { status?: number; retryAfterMs?: number };
      if (options.retryDeferred && transient.status === 429 && retries++ < 6) {
        options.onWait?.(Math.max(1000, transient.retryAfterMs || 60000));
        await wait(
          Math.max(1000, transient.retryAfterMs || 60000),
          options.signal,
        );
        continue;
      }
      error =
        failure instanceof Error
          ? failure.message
          : "Não foi possível concluir a consulta.";
      break;
    }
    const byId = new Map(results.map((result) => [result.id, result]));
    const completed = new Set<string>();
    for (const id of batch) {
      const result = byId.get(id);
      if (
        !result ||
        result.deferred ||
        (options.retryDeferred && result.retryAfterMs != null && retries < 6)
      )
        continue;
      completed.add(id);
      if (succeeded(result)) successful++;
      else failed++;
    }
    pendingIds = pendingIds.filter((id) => !completed.has(id));
    onProgress(total - pendingIds.length, total);
    onBatch([...pendingIds]);
    const retryWait = Math.max(0, ...results.map((r) => r.retryAfterMs || 0));
    if (options.retryDeferred && retryWait && retries++ < 6) {
      options.onWait?.(Math.max(1000, retryWait));
      await wait(Math.max(1000, retryWait), options.signal);
      continue;
    }
    if (!completed.size) {
      if (
        options.retryDeferred &&
        results.some((r) => r.deferred) &&
        ++stalls <= 60
      ) {
        options.onWait?.(5000);
        await wait(5000, options.signal);
        continue;
      }
      break;
    }
    retries = 0;
    stalls = 0;
    if (pendingIds.length && options.batchDelayMs)
      await wait(options.batchDelayMs, options.signal);
  }
  return { successful, failed, pendingIds, error };
}
