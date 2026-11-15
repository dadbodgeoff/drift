// UI strings. English only for now; every user-facing string in the shell and
// views comes from this catalogue so a translation is one file. Values are
// templates with `{name}` placeholders; plural forms are `one|other`.

const en = {
  app: { name: "Drift Studio", fixtureMode: "Fixture data", noTelemetry: "Local only: nothing leaves this machine" },
  nav: {
    attention: "Attention",
    review: "Review",
    conventions: "Conventions",
    investigate: "Investigate",
    check: "Check",
    sessions: "Sessions",
    understand: "Understand",
    map: "Map",
    security: "Security",
    practices: "Practices",
    evidence: "Evidence",
    studies: "Studies",
    logs: "Logs",
    settings: "Settings",
    gallery: "Components",
  },
  shell: {
    openRepo: "Open repository…",
    switchRepo: "Switch repository",
    recent: "Recent repositories",
    noRepo: "No repository open",
    noRepoBody: "Open a repository that Drift can scan. The Studio runs the drift binary on it and shows what Drift learned.",
    palette: "Search or jump to…",
    rescan: "Rescan",
    scanning: "Scanning",
    stale: "stale",
    staleBody: "{n} file|files changed since this scan",
    scanned: "scanned {when}",
    at: "at {commit}",
    theme: "Theme",
    density: "Density",
    highContrast: "High contrast",
    drift: "drift",
    driftMissing: "drift binary not found",
    schemaMismatch: "Drift {version} output; this Studio understands {what} schema {want}",
  },
  steps: { scan: "Scanning files", census: "Learning conventions", check: "Checking", security: "Security inventory" },
  attention: {
    title: "Attention",
    subtitle: "What needs a person now",
    allClear: "Nothing needs your attention.",
    allClearBody: "Every proposal is reviewed, there are no new violations, and no session was blocked.",
    pending: "Proposals to review",
    pendingHint: "{n} of {total} reviewed",
    newViolations: "New violations",
    newSince: "{n} since the last scan",
    sessions: "Sessions where Drift spoke",
    security: "Security changes",
    securitySince: "since the previous scan",
    firstScan: "first scan: nothing to compare yet",
    vitals: "Repository",
  },
  conventions: {
    title: "Conventions",
    queue: "Review queue",
    progress: "{done} of {total} reviewed",
    target: "Target: 15 proposals in under 5 minutes",
    accept: "Accept",
    reject: "Reject",
    block: "Block",
    undo: "Undo",
    willRun: "Runs",
    pendingRun: "Running in {s} s",
    blockTitle: "Accept {id} in block mode?",
    blockBody: "New violations will fail drift check and stop the agent's turn.",
    blockSmall: "Its role has {n} members; blocking needs 15, so Drift accepts it as advise.",
    noPolicy: "No conventions yet",
    noPolicyBody: "Drift has not learned this repository. drift init writes its proposals to .drift/conventions.yaml and baselines legacy outliers in drift.lock, both yours to review and commit: nothing is checked, and nothing reaches an agent, until you accept it.",
    runInit: "Run drift init",
    noCensus: "This drift binary has no census --json, so outliers are not shown. Build Drift from main or newer.",
    audit: "Decisions",
    noAudit: "No decisions made in the Studio yet.",
    example: "Example",
    outliers: "Outliers",
    noOutliers: "No outliers: every member follows it.",
    role: "Role",
    rule: "Rule",
    evidence: "Evidence",
    split: "Variants",
  },
  check: {
    title: "Check",
    byConvention: "By convention",
    byFile: "By file",
    new: "New",
    baselined: "Baselined",
    suppressed: "Suppressed",
    blocking: "Blocking",
    clean: "No new violations",
    cleanBody: "Legacy violations are baselined in drift.lock and never fail.",
    fixed: "{n} lock entry|entries fixed: safe to remove from drift.lock",
  },
  map: { title: "Map", legend: "Legend" },
  security: { title: "Security" },
  sessions: { title: "Sessions", none: "No agent sessions for this repository", noneBody: "Claude Code keeps transcripts in ~/.claude/projects. Sessions that ran in this repository appear here." },
  studies: { title: "Studies" },
  common: { loading: "Loading", retry: "Try again", copy: "Copy", copied: "Copied", exportMd: "Copy as Markdown", openCode: "Open code", close: "Close", all: "All", none: "None" },
} as const;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const raw = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
  if (typeof raw !== "string") return key;
  return raw.replace(/\{(\w+)\}( ?)([^\s|{}]+)\|([^\s{}]+)/g, (_, k: string, sp: string, one: string, many: string) => `{${k}}${sp}${Number(vars[k]) === 1 ? one : many}`).replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(typeof vars[k] === "number" ? (vars[k] as number).toLocaleString("en-US") : vars[k]) : `{${k}}`));
}
