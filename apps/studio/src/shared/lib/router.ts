// A tiny hash router: `#/<view>/<param>?<query>`. Hash routing keeps the app a
// set of static files (served from a custom protocol in Electron).
import { useCallback, useEffect, useState } from "react";

export type ViewId = "attention" | "conventions" | "check" | "map" | "security" | "practices" | "sessions" | "studies" | "logs" | "settings" | "gallery";

export const VIEWS: ViewId[] = ["attention", "conventions", "check", "map", "security", "practices", "sessions", "studies", "logs", "settings", "gallery"];

export interface Route {
  view: ViewId;
  param: string | null;
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path, qs = ""] = h.split("?");
  const [view, ...rest] = path.split("/");
  const v = (VIEWS as string[]).includes(view) ? (view as ViewId) : "attention";
  const param = rest.length ? decodeURIComponent(rest.join("/")) : null;
  return { view: v, param, query: new URLSearchParams(qs) };
}

export function href(view: ViewId, param?: string | null, query?: Record<string, string>): string {
  const q = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : "";
  return `#/${view}${param ? `/${encodeURIComponent(param)}` : ""}${q}`;
}

export function navigate(view: ViewId, param?: string | null, query?: Record<string, string>) {
  const next = href(view, param, query);
  if (location.hash !== next) location.hash = next;
}

export function useRoute(): [Route, typeof navigate] {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const nav = useCallback(navigate, []);
  return [route, nav];
}
