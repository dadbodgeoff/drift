import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorState, ThemeProvider, ToastProvider } from "@drift/ui";
import { RepoProvider } from "@/entities/repo";
import { ApiProvider, type Handshake, type StudioApi } from "@/shared/api";
import { IPC_VERSION } from "@/shared/ipc/contract";
import { log, setLogSink } from "@/shared/lib/log";
import { Shell } from "./Shell";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, gcTime: 30 * 60_000 } },
});

export function App({ api }: { api: StudioApi }) {
  const [hs, setHs] = useState<Handshake | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    setLogSink((e) => void api.log(e).catch(() => undefined));
    api.handshake().then(
      (h) => {
        if (h.ipc !== IPC_VERSION) throw new Error(`IPC version mismatch: window v${IPC_VERSION}, main v${h.ipc}`);
        log("info", "studio started", { mode: api.mode, platform: h.platform, version: h.appVersion });
        document.documentElement.dataset.platform = h.platform;
        document.documentElement.dataset.mode = api.mode;
        setHs(h);
      },
      (e: unknown) => setErr(e),
    );
  }, [api]);
  if (err) return <ErrorState title="Drift Studio could not start" error={err} />;
  if (!hs) return null;
  const initialRepo = new URLSearchParams(location.search).get("repo");
  return (
    <ApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider storageKey="drift-studio">
          <ToastProvider>
            <RepoProvider initial={initialRepo}>
              <Shell platform={hs.platform} />
            </RepoProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
