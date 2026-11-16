// `drift upgrade --json`, run when the Upgrade view asks for it. The key sits under the policy files' (`["policy",
// path]`): `drift upgrade` reads exactly those files, so a review decision, a promotion or a rescan, which make the
// policy stale, make this stale too.
import { useQuery } from "@tanstack/react-query";
import { type RepoRef, useApi } from "@/shared/api";
import { log } from "@/shared/lib/log";
import { readUpgrade } from "./upgrade";

export const upgradeKey = (r: RepoRef) => ["policy", r.path, "upgrade"] as const;

export function useUpgrade(repo: RepoRef | null) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? upgradeKey(repo) : ["policy", "none", "upgrade"],
    enabled: !!repo,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const t0 = performance.now();
      try {
        const r = await api.upgrade(repo!, { signal });
        log("info", "upgrade loaded", { ms: Math.round(performance.now() - t0) });
        return { ...r, data: readUpgrade(r.data) };
      } catch (e) {
        log("error", "upgrade failed", { error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
  });
}
