"use client";
import {
  runCatalogSync,
  type CatalogProgress,
  type CatalogReply,
} from "../domain/catalog-sync";
import { jsonRequest } from "./ui";
export function synchronizeCatalog(
  store: string,
  signal: AbortSignal,
  onProgress: (progress: CatalogProgress) => void = () => {},
  options: {
    restart?: boolean;
    automatic?: boolean;
    offerId?: string;
    activity?: "foreground" | "background";
  } = {},
) {
  let restart = options.restart === true;
  return runCatalogSync(
    store,
    () => {
      const body = {
        ...(restart ? { restart: true } : {}),
        ...(options.automatic ? { automatic: true } : {}),
        ...(options.offerId ? { offerId: options.offerId } : {}),
      };
      restart = false;
      return jsonRequest<CatalogReply>(
        "/api/catalog/refresh?" + new URLSearchParams({ store }),
        body,
        "POST",
        signal,
        options.activity || "foreground",
        65000,
      );
    },
    onProgress,
    { signal },
  );
}
