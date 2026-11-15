// Structured local logs: drift invocations and their timings from the main
// process, and the renderer's own events. Nothing here leaves the machine.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button, type Column, DataTable, SearchInput, SegmentedControl, StateLabel } from "@drift/ui";
import { type LogEntry, useApi } from "@/shared/api";
import { clock } from "@/shared/lib/format";
import { onLog, rendererLogs } from "@/shared/lib/log";

type Level = "all" | "info" | "warn" | "error";

export function LogsView() {
  const api = useApi();
  const main = useQuery({ queryKey: ["logs"], queryFn: () => api.logs(), refetchInterval: 4000 });
  const [tick, setTick] = useState(0);
  useEffect(() => onLog(() => setTick((x) => x + 1)), []);
  const [level, setLevel] = useState<Level>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const all = [...(api.mode === "electron" ? (main.data ?? []) : []), ...rendererLogs()]
      .filter((e) => {
        const k = `${e.at}|${e.source}|${e.message}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.at - a.at);
    const rank = { debug: 0, info: 1, warn: 2, error: 3 };
    const needle = q.toLowerCase();
    return all.filter((e) => (level === "all" || rank[e.level] >= rank[level]) && (!needle || e.message.toLowerCase().includes(needle) || JSON.stringify(e.data ?? {}).toLowerCase().includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main.data, level, q, tick, api.mode]);
  const tone = (l: LogEntry["level"]) => (l === "error" ? "danger" : l === "warn" ? "warning" : l === "info" ? "info" : "neutral");
  const columns: Column<LogEntry>[] = [
    { id: "at", header: "Time", width: 96, mono: true, sortValue: (e) => e.at, render: (e) => clock(e.at) },
    { id: "level", header: "Level", width: 86, sortValue: (e) => e.level, render: (e) => <StateLabel tone={tone(e.level)}>{e.level}</StateLabel> },
    { id: "source", header: "Source", width: 90, render: (e) => <span className="t-muted">{e.source}</span> },
    { id: "message", header: "Message", width: 320, render: (e) => e.message, text: (e) => e.message },
    { id: "data", header: "Data", flex: true, mono: true, render: (e) => (e.data ? JSON.stringify(e.data) : ""), text: (e) => (e.data ? JSON.stringify(e.data) : "") },
  ];
  return (
    <div className="st-page st-page--fill">
      <div className="st-toolbar">
        <SegmentedControl<Level>
          label="Level"
          value={level}
          onValueChange={setLevel}
          items={[
            { value: "all", label: "All" },
            { value: "info", label: "Info+" },
            { value: "warn", label: "Warnings+" },
            { value: "error", label: "Errors" },
          ]}
        />
        <SearchInput value={q} onValueChange={setQ} placeholder="Filter logs" label="Filter logs" />
        <span className="st-grow" />
        <span className="t-caption t-muted">Kept on this machine only{api.mode === "electron" ? "; the main process also writes them to its log file" : ""}.</span>
        <Button variant="ghost" icon="copy" onClick={() => void navigator.clipboard?.writeText(rows.map((r) => JSON.stringify(r)).join("\n"))}>
          Copy as JSON lines
        </Button>
      </div>
      <div className="st-fill st-panelish">
        <DataTable label="Logs" rows={rows} columns={columns} rowKey={(e) => `${e.at}|${e.source}|${e.message}|${JSON.stringify(e.data ?? "")}`} storageKey="logs" empty="No log entries yet" rowHeight={28} />
      </div>
    </div>
  );
}
