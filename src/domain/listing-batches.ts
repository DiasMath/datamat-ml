type Result = { id: string; deferred?: boolean };
// Each completed ID leaves the queue exactly once. A deferred or missing result
// remains pending; a request that makes no progress stops rather than looping.
export async function runListingBatches<T extends Result>(
  ids: string[],
  send: (ids: string[]) => Promise<T[]>,
  succeeded: (result: T) => boolean,
  onProgress: (done: number, total: number) => void,
  onBatch: () => void = () => {},
) {
  let pendingIds = [...new Set(ids)];
  const total = pendingIds.length;
  let successful = 0,
    failed = 0,
    error: string | null = null;
  while (pendingIds.length) {
    const batch = pendingIds.slice(0, 5);
    onProgress(total - pendingIds.length, total);
    let results: T[];
    try {
      results = await send(batch);
      if (!Array.isArray(results))
        throw new Error("A consulta retornou um lote incompleto.");
    } catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError")
        throw failure;
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
      if (!result || result.deferred) continue;
      completed.add(id);
      if (succeeded(result)) successful++;
      else failed++;
    }
    pendingIds = pendingIds.filter((id) => !completed.has(id));
    onBatch();
    if (!completed.size) break;
  }
  return { successful, failed, pendingIds, error };
}
