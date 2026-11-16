// `drift census --from-map --json`, run when the Proposals from the map view asks for it. The key sits under census's
// (`["census", path]`), so whatever makes census stale (a rescan, drift init) makes this stale too.
import { useQuery } from "@tanstack/react-query";
import { type RepoRef, useApi } from "@/shared/api";
import { log } from "@/shared/lib/log";
import { readFromMap } from "./fromMap";

export const fromMapKey = (r: RepoRef) => ["census", r.path, "from-map"] as const;

export function useFromMap(repo: RepoRef | null) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? fromMapKey(repo) : ["census", "none", "from-map"],
    enabled: !!repo,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const t0 = performance.now();
      try {
        const r = await api.fromMap(repo!, { signal });
        log("info", "census --from-map loaded", { ms: Math.round(performance.now() - t0) });
        return { ...r, data: readFromMap(r.data) };
      } catch (e) {
        log("error", "census --from-map failed", { error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
  });
}
