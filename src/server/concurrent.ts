// Workers share a bounded queue; results retain input order and every started
// task is awaited before the caller releases its lease or request context.
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = await Promise.allSettled(
    Array.from(
      { length: Math.min(items.length, Math.max(1, Math.floor(limit))) },
      async () => {
        while (next < items.length) {
          const index = next++;
          results[index] = await run(items[index], index);
        }
      },
    ),
  );
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return results;
}
