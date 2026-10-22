export type CatalogReply = {
  partial: boolean;
  results: {
    storeId: string;
    status: string;
    processed?: number;
    has_more?: boolean;
    message?: string;
  }[];
};
export type CatalogProgress = {
  processed: number;
  pages: number;
  waitingMs?: number;
};
export function waitForSync(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new DOMException("Consulta interrompida", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
export async function runCatalogSync(
  store: string,
  send: () => Promise<CatalogReply>,
  onProgress: (progress: CatalogProgress) => void = () => {},
  options: {
    signal?: AbortSignal;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
) {
  const wait = options.wait || waitForSync;
  let processed = 0,
    pages = 0,
    retries = 0,
    stalled = 0;
  while (pages < 10000) {
    options.signal?.throwIfAborted();
    let reply: CatalogReply;
    try {
      reply = await send();
    } catch (error) {
      const failure = error as {
        status?: number;
        code?: string;
        retryAfterMs?: number;
      };
      if (
        failure.code === "FIRESTORE_QUOTA_EXCEEDED" ||
        ![429, 502, 503, 504].includes(failure.status || 0) ||
        retries >= (failure.status === 429 ? 6 : 3)
      )
        throw error;
      const waitingMs = Math.max(
        failure.retryAfterMs || 0,
        failure.status === 429 ? 1000 : 500,
        Math.min(30000, 500 * 2 ** retries++),
      );
      onProgress({ processed, pages, waitingMs });
      await wait(waitingMs, options.signal);
      continue;
    }
    if (
      !reply.results?.length ||
      reply.results.some((r) => r.storeId !== store)
    )
      throw new Error("O catálogo não confirmou a loja selecionada.");
    if (reply.results.some((r) => !["confirmed", "running"].includes(r.status)))
      throw new Error(
        reply.results.find((r) => r.message)?.message ||
          "O ML não confirmou a consulta do catálogo.",
      );
    const running = reply.results.some((r) => r.status === "running");
    const count = reply.results.reduce((sum, r) => sum + (r.processed || 0), 0);
    processed += count;
    if (!running) pages++;
    onProgress({ processed, pages });
    if (
      !reply.partial &&
      reply.results.every((r) => !r.has_more && r.status === "confirmed")
    )
      return { processed, pages };
    if (!count) {
      if (++stalled > 60)
        throw new Error(
          "A sincronização não avançou. Os dados consultados foram preservados; confira a conexão da loja.",
        );
    } else {
      stalled = 0;
      retries = 0;
    }
    const waitingMs = running || !count ? 5000 : 500;
    if (running || !count) onProgress({ processed, pages, waitingMs });
    await wait(waitingMs, options.signal);
  }
  throw new Error(
    "O catálogo excedeu o limite de segurança desta execução; os dados consultados foram preservados.",
  );
}
