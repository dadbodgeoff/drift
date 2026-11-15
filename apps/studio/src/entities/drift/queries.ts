// Data from the CLI, cached and refreshed with TanStack Query. Facts show the
// last cached scan immediately and refresh in the background; census, check
// and security run in parallel; everything is cancellable.
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type RepoRef, useApi } from "@/shared/api";
import { log } from "@/shared/lib/log";
import { checkCensus, checkFacts, checkPractices } from "./schema";

export const keys = {
  info: ["driftInfo"] as const,
  facts: (r: RepoRef) => ["facts", r.path] as const,
  census: (r: RepoRef) => ["census", r.path] as const,
  /** Without `base`, a prefix that also matches every diff-scoped check of the repository. */
  check: (r: RepoRef, base?: string | null) => (base === undefined ? (["check", r.path] as const) : (["check", r.path, base] as const)),
  /** Without `base`, a prefix that also matches every diff-scoped security run of the repository. */
  security: (r: RepoRef, base?: string) => (base === undefined ? (["security", r.path] as const) : (["security", r.path, "diff", base] as const)),
  practices: (r: RepoRef) => ["practices", r.path] as const,
  map: (r: RepoRef) => ["map", r.path] as const,
  policy: (r: RepoRef) => ["policy", r.path] as const,
  questions: (r: RepoRef) => ["questions", r.path] as const,
  reviewLog: (r: RepoRef) => ["reviewLog", r.path] as const,
  history: (r: RepoRef) => ["history", r.path] as const,
  sessions: (r: RepoRef, all: boolean) => ["sessions", r.path, all] as const,
  transcript: (r: RepoRef, id: string) => ["transcript", r.path, id] as const,
  sessionState: (r: RepoRef, id: string) => ["sessionState", r.path, id] as const,
  studies: ["studies"] as const,
};

export function useDriftInfo() {
  const api = useApi();
  return useQuery({ queryKey: keys.info, queryFn: () => api.driftInfo(), staleTime: Infinity });
}

function timed<T>(name: string, p: Promise<T>): Promise<T> {
  const t0 = performance.now();
  return p.then(
    (v) => {
      log("info", `${name} loaded`, { ms: Math.round(performance.now() - t0) });
      return v;
    },
    (e: unknown) => {
      log("error", `${name} failed`, { error: e instanceof Error ? e.message : String(e) });
      throw e;
    },
  );
}

/** Facts: cached first, then a fresh scan in the background. */
export function useFacts(repo: RepoRef | null) {
  const api = useApi();
  const qc = useQueryClient();
  const info = useDriftInfo();
  const version = info.data?.version ?? null;
  const q = useQuery({
    queryKey: repo ? keys.facts(repo) : ["facts", "none"],
    enabled: !!repo,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const r = await timed("facts", api.facts(repo!, { refresh: false, signal }));
      return { ...r, data: checkFacts(r.data, version) };
    },
  });
  const [refreshing, setRefreshing] = useState(false);
  const refreshedFor = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (!repo) return;
    setRefreshing(true);
    try {
      const r = await timed("scan", api.facts(repo, { refresh: true }));
      qc.setQueryData(keys.facts(repo), { ...r, data: checkFacts(r.data, version) });
    } catch (e) {
      log("warn", "background scan failed; showing the cached scan", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRefreshing(false);
    }
  }, [api, repo, qc, version]);
  useEffect(() => {
    if (!repo || !q.data || !q.data.cached || refreshedFor.current === repo.path) return;
    refreshedFor.current = repo.path;
    void refresh();
  }, [repo, q.data, refresh]);
  return { ...q, refreshing, refresh };
}

export function useCensus(repo: RepoRef | null) {
  const api = useApi();
  const info = useDriftInfo();
  return useQuery({
    queryKey: repo ? keys.census(repo) : ["census", "none"],
    enabled: !!repo && !!info.data,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      if (info.data && !info.data.censusJson) return null;
      const r = await timed("census", api.census(repo!, { signal }));
      return { ...r, data: checkCensus(r.data, info.data?.version ?? null) };
    },
  });
}

/** `drift check`; with `base`, only what the change since the merge base with it introduces (`--diff-base`). */
export function useCheck(repo: RepoRef | null, enabled = true, base: string | null = null) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? keys.check(repo, base) : ["check", "none"],
    enabled: !!repo && enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: ({ signal }) => timed(base ? "check --diff-base" : "check", api.check(repo!, { signal, base })),
  });
}

export function useSecurity(repo: RepoRef | null) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? keys.security(repo) : ["security", "none"],
    enabled: !!repo,
    staleTime: Infinity,
    retry: false,
    queryFn: ({ signal }) => timed("security", api.security(repo!, { signal })),
  });
}

/** `drift security --diff-base <base>`: what the change since the merge base introduces; idle without a base. */
export function useSecurityDiff(repo: RepoRef | null, base: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: repo && base ? keys.security(repo, base) : ["security", "none", "diff"],
    enabled: !!repo && !!base,
    staleTime: Infinity,
    retry: false,
    queryFn: ({ signal }) => timed("security --diff-base", api.securityDiff(repo!, { signal, base: base! })),
  });
}

/** `drift practices --json`: the practice map (facts, not rules). Run when the Practices view asks for it. */
export function usePractices(repo: RepoRef | null) {
  const api = useApi();
  const info = useDriftInfo();
  return useQuery({
    queryKey: repo ? keys.practices(repo) : ["practices", "none"],
    enabled: !!repo,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const r = await timed("practices", api.practices(repo!, { signal }));
      return { ...r, data: checkPractices(r.data, info.data?.version ?? null) };
    },
  });
}

/** `drift map --json`: each package's production and test dependencies (the Map view's package panel). */
export function useDriftMap(repo: RepoRef | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? keys.map(repo) : ["map", "none"],
    enabled: !!repo && enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: ({ signal }) => timed("map", api.map(repo!, { signal })),
  });
}

export function usePolicyFiles(repo: RepoRef | null) {
  const api = useApi();
  return useQuery({ queryKey: repo ? keys.policy(repo) : ["policy", "none"], enabled: !!repo, staleTime: Infinity, queryFn: () => api.policy(repo!) });
}

/** Steps running now, for the progress indicator. */
export function useRunState(repo: RepoRef | null, refreshing: boolean) {
  const path = repo?.path ?? "none";
  const census = useIsFetching({ queryKey: ["census", path] });
  const check = useIsFetching({ queryKey: ["check", path] });
  const security = useIsFetching({ queryKey: ["security", path] });
  const facts = useIsFetching({ queryKey: ["facts", path] });
  return useMemo(() => {
    const steps: ("scan" | "census" | "check" | "security")[] = [];
    if (refreshing || facts) steps.push("scan");
    if (census) steps.push("census");
    if (check) steps.push("check");
    if (security) steps.push("security");
    return steps;
  }, [refreshing, facts, census, check, security]);
}

/** Re-run everything (scan, census, check, security, practices, policy). */
export function useRescan(repo: RepoRef | null, refreshFacts: () => Promise<void>) {
  const qc = useQueryClient();
  return useCallback(async () => {
    if (!repo) return;
    log("info", "rescan requested", { repo: repo.name });
    await Promise.all([
      refreshFacts(),
      qc.invalidateQueries({ queryKey: keys.census(repo) }),
      qc.invalidateQueries({ queryKey: keys.check(repo) }),
      qc.invalidateQueries({ queryKey: keys.security(repo) }),
      qc.invalidateQueries({ queryKey: keys.practices(repo) }),
      qc.invalidateQueries({ queryKey: keys.map(repo) }),
      qc.invalidateQueries({ queryKey: keys.policy(repo) }),
    ]);
  }, [qc, repo, refreshFacts]);
}

/** `drift review --json`: each block candidate's one question (holders, flagged members by file). */
export function useQuestions(repo: RepoRef | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? keys.questions(repo) : ["questions", "none"],
    enabled: !!repo && enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: () => api.reviewQuestions(repo!),
  });
}

/** The review log's export, read back for what it holds (Settings); null while the log is off or empty. */
export function useReviewLogExport(repo: RepoRef | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? keys.reviewLog(repo) : ["reviewLog", "none"],
    enabled: !!repo && enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: () => api.reviewLogExport(repo!),
  });
}
