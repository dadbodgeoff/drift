// The open repository and the recent list.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type RepoRef, useApi } from "@/shared/api";
import { log } from "@/shared/lib/log";

interface RepoState {
  repo: RepoRef | null;
  recent: RepoRef[];
  open(): Promise<void>;
  select(r: RepoRef): void;
  forget(r: RepoRef): Promise<void>;
}

const Ctx = createContext<RepoState | null>(null);
const LAST = "drift-studio:last-repo";

export function RepoProvider({ children, initial }: { children: ReactNode; initial?: string | null }) {
  const api = useApi();
  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [recent, setRecent] = useState<RepoRef[]>([]);
  useEffect(() => {
    let alive = true;
    api.recentRepos().then((list) => {
      if (!alive) return;
      setRecent(list);
      let last: string | null = initial ?? null;
      try {
        last ??= localStorage.getItem(LAST);
      } catch {
        // no storage
      }
      setRepo(list.find((r) => r.path === last) ?? list[0] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [api, initial]);
  const select = useCallback((r: RepoRef) => {
    setRepo(r);
    log("info", "repository selected", { repo: r.name });
    try {
      localStorage.setItem(LAST, r.path);
    } catch {
      // no storage
    }
  }, []);
  const open = useCallback(async () => {
    const r = await api.openRepo();
    if (!r) return;
    setRecent(await api.recentRepos());
    select(r);
  }, [api, select]);
  const forget = useCallback(
    async (r: RepoRef) => {
      setRecent(await api.forgetRepo(r));
    },
    [api],
  );
  const value = useMemo(() => ({ repo, recent, open, select, forget }), [repo, recent, open, select, forget]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRepo(): RepoState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRepo needs a <RepoProvider>");
  return v;
}
