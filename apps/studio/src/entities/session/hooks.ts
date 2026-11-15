import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type RepoRef, useApi } from "@/shared/api";
import { keys } from "@/entities/drift";
import { redact } from "@/shared/lib/redact";
import { parseTranscript } from "./transcript";

export function useSessions(repo: RepoRef | null, all: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: repo ? keys.sessions(repo, all) : ["sessions", "none"],
    enabled: !!repo,
    staleTime: 30_000,
    queryFn: () => api.listSessions(repo!, { all }),
    // A title is the first prompt: redact it once here, for every place that lists sessions.
    select: (list) => list.map((s) => ({ ...s, title: s.title === null ? null : redact(s.title).text })),
  });
}

export function useTranscript(repo: RepoRef | null, id: string | null) {
  const api = useApi();
  const q = useQuery({ queryKey: repo && id ? keys.transcript(repo, id) : ["transcript", "none"], enabled: !!repo && !!id, staleTime: 30_000, queryFn: () => api.readTranscript(repo!, id!) });
  const parsed = useMemo(() => (q.data ? parseTranscript(q.data) : null), [q.data]);
  return { ...q, transcript: parsed };
}

export function useSessionState(repo: RepoRef | null, id: string | null) {
  const api = useApi();
  return useQuery({ queryKey: repo && id ? keys.sessionState(repo, id) : ["sessionState", "none"], enabled: !!repo && !!id, staleTime: 30_000, queryFn: () => api.readSessionState(repo!, id!) });
}
