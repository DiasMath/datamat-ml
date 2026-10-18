"use client";
import { useEffect, useState } from "react";
import {
  optionalListingColumns,
  type ListingColumnId,
} from "../domain/listing-views";
const storageKey = (store: string, mode: string) =>
  `datamat.listing-layout.${store}.${mode}`;
export default function useListingLayout(
  store: string,
  mode: "operational" | "registry",
) {
  const key = storageKey(store, mode);
  const [layout, setLayout] = useState<{
    key: string;
    hidden: ListingColumnId[];
  } | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width:620px)");
    const changed = () => setCompact(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const load = () => {
      let hidden: ListingColumnId[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(saved))
          hidden = optionalListingColumns.filter((id) => saved.includes(id));
      } catch {}
      setLayout({ key, hidden });
    };
    const storage = (e: StorageEvent) => {
      if (e.key === key || e.key === null) load();
    };
    load();
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, [key]);
  function change(hidden: string[], nextMode = mode) {
    const nextKey = storageKey(store, nextMode);
    const valid = optionalListingColumns.filter((id) => hidden.includes(id));
    try {
      localStorage.setItem(nextKey, JSON.stringify(valid));
    } catch {}
    setLayout({ key: nextKey, hidden: valid });
  }
  return { hidden: layout?.key === key ? layout.hidden : [], change, compact };
}
