import { useCallback, useEffect, useState } from "react";
import { SEED } from "@/data/seed";
import type { DataSet } from "@/data/types";

/**
 * V1 persistence: seeded dataset + local overlay (browser storage).
 * Historical rows are never destroyed by the app — `reset` restores the seed
 * only when the operator explicitly asks for it.
 * Later: swap this module for Lovable Cloud tables without touching the pages.
 */

const KEY = "boltz-seo-geo-ops:v1";

function load(): DataSet {
  if (typeof window === "undefined") return SEED;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw) as Partial<DataSet>;
    return { ...SEED, ...parsed };
  } catch {
    return SEED;
  }
}

function save(data: DataSet) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — session-only */
  }
}

export function useDataSet() {
  const [data, setData] = useState<DataSet>(SEED);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setData(load());
    setHydrated(true);
  }, []);

  const update = useCallback(<K extends keyof DataSet>(key: K, rows: DataSet[K]) => {
    setData((prev) => {
      const next = { ...prev, [key]: rows };
      save(next);
      return next;
    });
  }, []);

  const append = useCallback(<K extends keyof DataSet>(key: K, row: DataSet[K][number]) => {
    setData((prev) => {
      const next = { ...prev, [key]: [...prev[key], row] as DataSet[K] };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setData(SEED);
    save(SEED);
  }, []);

  return { data, hydrated, update, append, reset };
}

export function nextId(prefix: string, existing: { id: string }[]) {
  const n = existing.length + 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export function exportJson(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
