// Snapshots ("what did the last scan see") and the decision audit trail, kept
// by the Studio in its own data directory, never in the repository.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type History, type RepoRef, type Snapshot, useApi } from "@/shared/api";

const key = (r: RepoRef) => ["history", r.path] as const;

export function useHistory(repo: RepoRef | null) {
  const api = useApi();
  return useQuery({ queryKey: repo ? key(repo) : ["history", "none"], enabled: !!repo, staleTime: Infinity, queryFn: () => api.history(repo!) });
}

export function useRecordSnapshot(repo: RepoRef | null) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Snapshot) => api.recordSnapshot(repo!, s),
    onSuccess: (h) => repo && qc.setQueryData(key(repo), h),
  });
}

export function useClearHistory(repo: RepoRef | null) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearHistory(repo!),
    onSuccess: (h) => repo && qc.setQueryData(key(repo), h),
  });
}

export * from "./snapshot";
export type { History, Snapshot };
