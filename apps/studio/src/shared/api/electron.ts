// StudioApi over the preload bridge. Every response is validated against the
// IPC contract before it reaches a view; cancellation aborts the drift process.
import type { Census, CensusWhy, CheckReport, Inventory, MapPackage, PracticesReport, PromoteList, PromoteOutcome, RepoFacts, ReviewQuestions, SecurityDiff, SessionState } from "@/shared/contract/drift";
import { type Bridge, type Channel, IPC_VERSION, IpcError, type Res, RepoChange, channels } from "@/shared/ipc/contract";
import type { Answer, Decision, Loaded, PromoteRequest, RepoRef, StudiesData, StudioApi } from "./types";
import type { FeedbackMarks, UpgradeOutcome } from "@/shared/contract/screens";
import type { Verdict } from "@/shared/ipc/contract";

let seq = 0;

export class ElectronApi implements StudioApi {
  readonly mode = "electron" as const;
  constructor(private readonly bridge: Bridge) {
    if (bridge.ipc !== IPC_VERSION) throw new IpcError(`This window speaks IPC v${IPC_VERSION} but the app's main process speaks v${bridge.ipc}. Restart Drift Studio.`, "unavailable");
  }

  private async call<C extends Channel>(channel: C, args: unknown[], signal?: AbortSignal): Promise<Res<C>> {
    const id = `r${++seq}`;
    const onAbort = () => void this.bridge.invoke("cancel", [id]).catch(() => undefined);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const raw = await this.bridge.invoke(channel, args, id);
      const parsed = channels[channel].res.safeParse(raw);
      if (!parsed.success) throw new IpcError(`Unexpected response from ${channel}: ${parsed.error.issues[0]?.message ?? "invalid"}`, "invalid");
      return parsed.data as Res<C>;
    } catch (e) {
      if (signal?.aborted) throw new IpcError("Cancelled", "cancelled");
      // Electron prefixes remote errors; keep only the message the main process wrote.
      const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);
      throw e instanceof IpcError ? e : new IpcError(msg, "drift");
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  handshake() {
    return this.call("handshake", []);
  }
  recentRepos() {
    return this.call("recentRepos", []);
  }
  openRepo() {
    return this.call("openRepo", []);
  }
  forgetRepo(repo: RepoRef) {
    return this.call("forgetRepo", [repo]);
  }
  driftInfo() {
    return this.call("driftInfo", []);
  }
  chooseDrift(reset: boolean) {
    return this.call("chooseDrift", [reset]);
  }
  async facts(repo: RepoRef, opts: { refresh: boolean; signal?: AbortSignal }) {
    return (await this.call("facts", [repo, { refresh: opts.refresh }], opts.signal)) as unknown as Loaded<RepoFacts>;
  }
  async census(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("census", [repo], opts?.signal)) as unknown as Loaded<Census>;
  }
  async check(repo: RepoRef, opts?: { signal?: AbortSignal; base?: string | null }) {
    return (await this.call("check", opts?.base ? [repo, { base: opts.base }] : [repo], opts?.signal)) as unknown as Loaded<CheckReport>;
  }
  async security(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("security", [repo], opts?.signal)) as unknown as Loaded<Inventory>;
  }
  async securityDiff(repo: RepoRef, opts: { signal?: AbortSignal; base: string }) {
    return (await this.call("security", [repo, { base: opts.base }], opts.signal)) as unknown as Loaded<SecurityDiff>;
  }
  async practices(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("practices", [repo], opts?.signal)) as unknown as Loaded<PracticesReport>;
  }
  async map(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("map", [repo], opts?.signal)) as unknown as Loaded<{ schema: number; packages: MapPackage[] }>;
  }
  async securityTop(repo: RepoRef, n: number, opts?: { signal?: AbortSignal }) {
    return (await this.call("securityTop", [repo, n], opts?.signal)) as unknown as Loaded<Inventory>;
  }
  securityBaseline(repo: RepoRef) {
    return this.call("securityBaseline", [repo]);
  }
  async funnel(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("funnel", [repo], opts?.signal)) as unknown as Loaded<CensusWhy>;
  }
  async promoteList(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("promoteList", [repo], opts?.signal)) as unknown as Loaded<PromoteList>;
  }
  async fromMap(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("fromMap", [repo], opts?.signal)) as unknown as Loaded<Census>;
  }
  async upgrade(repo: RepoRef, opts?: { signal?: AbortSignal }) {
    return (await this.call("upgrade", [repo], opts?.signal)) as unknown as Loaded<UpgradeOutcome>;
  }
  async upgradeApply(repo: RepoRef, opts: { securityBaseline: boolean }) {
    return (await this.call("upgradeApply", [repo, { securityBaseline: opts.securityBaseline }])) as unknown as UpgradeOutcome;
  }
  feedbackMark(repo: RepoRef, id: string, member: string, verdict: Verdict, why: string | null) {
    return this.call("feedbackMark", [repo, id, member, verdict, why]);
  }
  async feedbackMarks(repo: RepoRef) {
    return (await this.call("feedbackMarks", [repo])) as unknown as FeedbackMarks | null;
  }
  policy(repo: RepoRef) {
    return this.call("policy", [repo]);
  }
  review(repo: RepoRef, decision: Decision, ids: string[]) {
    return this.call("review", [repo, decision, ids]);
  }
  exempt(repo: RepoRef, id: string, member: string, reason: string | null) {
    return this.call("exempt", [repo, id, member, reason]);
  }
  setReviewLog(repo: RepoRef, on: boolean) {
    return this.call("setReviewLog", [repo, on]);
  }
  exportReviewLog(repo: RepoRef, opts: { includePaths: boolean }) {
    return this.call("exportReviewLog", [repo, opts]);
  }
  reviewShown(repo: RepoRef, ids: string[]) {
    return this.call("reviewShown", [repo, ids]);
  }
  reviewLogExport(repo: RepoRef) {
    return this.call("reviewLogExport", [repo]);
  }
  async reviewQuestions(repo: RepoRef) {
    return (await this.call("reviewQuestions", [repo])) as unknown as ReviewQuestions;
  }
  answer(repo: RepoRef, id: string, answer: Answer, setApart: string[], confirmEntry: string[]) {
    return this.call("answer", [repo, id, answer, setApart, confirmEntry]);
  }
  init(repo: RepoRef) {
    return this.call("init", [repo]);
  }
  async promotePreview(repo: RepoRef, req: PromoteRequest, opts?: { signal?: AbortSignal }) {
    return (await this.call("promotePreview", [repo, req], opts?.signal)) as unknown as PromoteOutcome;
  }
  async promote(repo: RepoRef, req: PromoteRequest) {
    return (await this.call("promote", [repo, req])) as unknown as PromoteOutcome;
  }
  readSource(repo: RepoRef, path: string) {
    return this.call("readSource", [repo, path]);
  }
  listSessions(repo: RepoRef, opts: { all: boolean }) {
    return this.call("listSessions", [repo, opts]);
  }
  readTranscript(repo: RepoRef, id: string) {
    return this.call("readTranscript", [repo, id]);
  }
  async readSessionState(repo: RepoRef, id: string) {
    return (await this.call("readSessionState", [repo, id])) as SessionState | null;
  }
  async loadStudies(opts: { choose: boolean }) {
    const r = await this.call("loadStudies", [opts]);
    return r as unknown as StudiesData | null;
  }
  history(repo: RepoRef) {
    return this.call("history", [repo]);
  }
  recordSnapshot(repo: RepoRef, s: Parameters<StudioApi["recordSnapshot"]>[1]) {
    return this.call("recordSnapshot", [repo, s]);
  }
  clearHistory(repo: RepoRef) {
    return this.call("clearHistory", [repo]);
  }
  logs() {
    return this.call("logs", []);
  }
  async log(e: Parameters<StudioApi["log"]>[0]) {
    await this.call("log", [e]);
  }
  saveText(name: string, text: string) {
    return this.call("saveText", [name, text]);
  }
  onRepoChanged(cb: (c: RepoChange) => void) {
    return this.bridge.on("repoChanged", (p) => {
      const r = RepoChange.safeParse(p);
      if (r.success) cb(r.data);
    });
  }
}


