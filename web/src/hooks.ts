import { useEffect, useState } from "preact/hooks";
import { api } from "./api";

const FILTER_KEYS = ["from", "to", "origin_ids", "group_ids", "user_ids", "status", "campaigns", "campaign", "ad", "form"];

/** Global filters live in the URL query string so views can be shared by link. */
export function useQuery(): URLSearchParams {
  const [search, setSearch] = useState(location.search);
  useEffect(() => {
    const on = () => setSearch(location.search);
    window.addEventListener("af:query", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("af:query", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return new URLSearchParams(search);
}

export function setQuery(patch: Record<string, string | null>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  history.replaceState(null, "", `${location.pathname}${s ? `?${s}` : ""}`);
  window.dispatchEvent(new Event("af:query"));
}

export function filterParams(q: URLSearchParams, extra: Record<string, string> = {}): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = q.get(k);
    if (v) out.set(k, v);
  }
  // Deal status is single-choice and defaults to open deals (FilterBar).
  if (!out.has("status")) out.set("status", "OPEN");
  for (const [k, v] of Object.entries(extra)) out.set(k, v);
  return out;
}

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Fetches `path` whenever `key` changes; optional polling. */
export function useApi<T>(path: string | null, params: URLSearchParams, refreshMs?: number): Loadable<T> {
  const key = `${path}?${params.toString()}`;
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const load = () => {
      setState((s) => ({ ...s, loading: true }));
      api<T>(path, params)
        .then((data) => alive && setState({ data, error: null, loading: false }))
        .catch((e: Error) => alive && setState((s) => ({ data: s.data, error: e.message, loading: false })));
    };
    load();
    const t = refreshMs ? setInterval(load, refreshMs) : undefined;
    window.addEventListener("af:refresh", load);
    return () => {
      alive = false;
      if (t) clearInterval(t);
      window.removeEventListener("af:refresh", load);
    };
  }, [key]);
  return state;
}
