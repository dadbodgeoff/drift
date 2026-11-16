// The screens for proposals from the map (`drift census --from-map --json`), `drift upgrade` and `drift feedback`:
// the contract against the Rust structs Drift serialises, the readers and the pages on fixtures the real binary wrote
// (scripts/make-screens-fixtures.mjs), and the main process's argv, exit codes and file reads for each channel.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_FEEDBACK, NO_FROM_MAP, NO_UPGRADE, StudioMain } from "../../electron/handlers";
import { InvalidArgument, acceptableExit, driftArgs, writesRepository } from "../../electron/ops";
import { assertWhy, markFlags as runFlags } from "../../electron/screens-ops";
import { Store } from "../../electron/store";
import { markCommand, markFlags, markOf, readMarks, tally } from "@/entities/feedback";
import { parseConventions } from "@/entities/convention";
import { Feedback } from "@/features/feedback";
import { FromMap, countsText, heldByReason, policyState, readFromMap } from "@/features/from-map";
import { Upgrade, applyCommand, applyWork, canApply, fileLine, leftBy, readUpgrade, splitConventions } from "@/features/upgrade";
import type { UpgradeConvention, UpgradeFile, UpgradeIntegration, UpgradeNow, UpgradeReport, UpgradeSecurity, UpgradeTodo, UpgradeViolation, UpgradeViolations, FeedbackMark, FeedbackMarks } from "@/shared/contract/screens";
import { isUpgradeRefusal } from "@/shared/contract/screens";
import { COMMANDS } from "@/shared/contract/coverage";
import { channels } from "@/shared/ipc/contract";
import { json, text } from "./helpers";

const src = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The serialised fields of a Rust struct (`#[serde(skip)]` ones left out). */
function fields(rs: string, name: string): string[] {
  const start = rs.indexOf(`struct ${name} {`);
  expect(start, `struct ${name}`).toBeGreaterThan(-1);
  const body = rs.slice(start, rs.indexOf("\n}\n", start)).replace(/^ {4}#\[serde\(skip\)\]\n {4}(pub )?\w+:.*$/gm, "");
  return [...body.matchAll(/^ {4}(?:pub )?(\w+):/gm)].map((m) => m[1]).sort();
}

const up = () => readUpgrade(json("screens/acme/upgrade.json")) as UpgradeReport;
const fromMap = () => readFromMap(json("screens/acme/from-map.json"));

describe("the contract is what Drift serialises", () => {
  it("drift upgrade --json: every field of every struct of the report is typed (upgrade.rs)", () => {
    const rs = src("crates/drift-cli/src/upgrade.rs");
    // Object literals of the TypeScript types: the compiler rejects a field the type lacks.
    const file: Required<UpgradeFile> = { path: "", present: true, records: "", written_by: "", format: "", this_drift: "", notes: [] };
    const now: Required<UpgradeNow> = { role: 0, members: 0, holders: 0, not_checked: 0, stale: "", mode: "", unchecked: "" };
    const conv: Required<UpgradeConvention> = { id: "", summary: "", rule: "", accepted: null, now, classes: [], reading_only: 0, changed_code: 0, cannot_tell: 0 };
    const row: Required<UpgradeViolation> = { id: "", member: "", line: 0, base: "", why: "" };
    const violations: Required<UpgradeViolations> = { reading_only: [], changed_code: [], cannot_tell: [] };
    const security: Required<UpgradeSecurity> = { present: true, inventory: 1, stamped: true, this_inventory: 2, new_in_drift: {}, new_in_drift_total: 0, failing_not_in_baseline: 0 };
    const integration: Required<UpgradeIntegration> = { path: "", kind: "", state: "older", note: "" };
    const todo: Required<UpgradeTodo> = { what: "", command: "", by: "apply" };
    const report: Required<UpgradeReport> = { schema: "", version: 1, drift: "", apply: false, files: [], conventions: [], violations, security, integrations: [], done: [], failed: "", left: [], pending: false };
    for (const [name, v] of [
      ["FileRow", file],
      ["Now", now],
      ["ConventionRow", conv],
      ["Row", row],
      ["Violations", violations],
      ["Security", security],
      ["Integration", integration],
      ["Todo", todo],
      ["Report", report],
    ] as const)
      expect(Object.keys(v).sort(), name).toEqual(fields(rs, name));
    // The `by` values and the exit codes the Studio relies on.
    expect(rs).toContain('by: "apply"');
    expect(rs).toContain('by: "security_baseline"');
    expect(rs).toContain('by: "person"');
    expect(rs).toContain("pub const EXIT_PENDING: u8 = 3;");
    expect(rs).toContain('pub const SCHEMA: &str = "drift-upgrade";');
    expect(rs).toContain("pub const VERSION: u32 = 1;");
    expect(rs).toMatch(/"refused": true,\s*"newer": newer,\s*"unreadable": unreadable,/);
  });

  it("the marks file: every field of a mark is typed (feedback.rs Mark, MarksFile)", () => {
    const rs = src("crates/drift-cli/src/feedback.rs");
    const mark: Required<FeedbackMark> = { report: "", id: "", member: "", verdict: "true", why: "", kind: "", tier: "", baselined: false, day: "" };
    const file: Required<FeedbackMarks> = { schema: "", version: 1, marks: [] };
    expect(Object.keys(mark).sort()).toEqual(fields(rs, "Mark"));
    expect(Object.keys(file).sort()).toEqual(fields(rs, "MarksFile"));
    expect(rs).toContain('pub const MARKS_SCHEMA: &str = "drift-feedback-marks";');
    expect(rs).toContain("pub const MAX_WHY: usize = 300;");
  });

  it("census --from-map --json: the keys of each kind of entry are the ones the reader reads (from_map_cli.rs census_json)", () => {
    const rs = src("crates/drift-cli/src/from_map_cli.rs");
    const body = rs.slice(rs.indexOf("pub fn census_json"), rs.indexOf("\n}\n", rs.indexOf("pub fn census_json")));
    for (const k of ['"proposed": true', '"same_rule"', 'v["candidate"]', 'v["settles"]', 'v["follows"]', 'v["differ"]', 'v["unknown"]', 'v["layering"]', 'v["declared"]', '"proposed": false', '"reason": h.reason.code()', '"why": h.reason.words()']) expect(body, k).toContain(k);
  });

  it("coverage says the Studio shows census --from-map, upgrade and feedback", () => {
    for (const c of ["census", "upgrade", "feedback"]) expect("studio" in COMMANDS[c], c).toBe(true);
    expect((COMMANDS.census as { studio: string }).studio).toContain("census --from-map --json");
    expect((COMMANDS.upgrade as { studio: string }).studio).toContain("--apply");
    expect((COMMANDS.feedback as { studio: string }).studio).toContain("nothing is sent");
  });
});

describe("proposals from the map (census --from-map --json, acme)", () => {
  it("reads proposals, those not proposed and the notes apart, in Drift's order, with Drift's counts", () => {
    const d = fromMap();
    const raw = (json("screens/acme/from-map.json") as { from_map: { proposed: boolean; id?: string; note?: string }[] }).from_map;
    expect(d.proposals.map((p) => p.id)).toEqual(raw.filter((e) => e.proposed && !e.note).map((e) => e.id));
    expect(d.held.map((h) => h.id)).toEqual(raw.filter((e) => !e.proposed && !e.note).map((e) => e.id));
    expect(d.notes.length).toBe(raw.filter((e) => e.note).length);
    expect(d.unreadable).toBe(0);
    expect(d.proposals.length).toBeGreaterThan(0);
    const signIn = d.proposals.find((p) => p.id === "D-234880")!;
    // The same sentence `drift census --from-map` prints for it.
    expect(countsText(signIn)).toBe("89 of the 98 entry points Drift could read here follow it, 9 differ (8 named as departures today); 18 could not be read (never reported)");
    expect(signIn.sameRule.map((t) => t.id)).toEqual(["D-b0d245", "D-ed1ec0"]);
    expect(signIn.place).toBe("apps/web");
    expect(signIn.mode).toBe("advise");
    // Those not proposed, grouped by Drift's own words.
    const groups = heldByReason(d.held);
    expect(groups.map((g) => g.reason)).toEqual(["preview_concern", "passive"]);
    expect(groups[1].why).toBe("it accepts what code does by doing nothing, so new code would follow it without trying");
    expect(d.notes.every((n) => n.note === "wiring" && n.text.includes("cannot be checked yet"))).toBe(true);
  });

  it("says where each one stands in the conventions file as it is, and links only what is there", () => {
    const policy = parseConventions(text("acme/conventions.yaml"));
    expect(policyState("D-234880", policy)).toBe("absent");
    expect(policyState("D-b0d245", policy)).toBe("accepted");
    expect(policyState("D-234880", null)).toBe("unknown");
    const page = plain(renderToStaticMarkup(createElement(FromMap, { doc: fromMap(), policy, onOpen: () => undefined })));
    expect(page).toContain("Proposed (5)");
    expect(page).toContain("not in .drift/conventions.yaml yet: drift init writes it as a proposal");
    expect(page).toContain("Not proposed (3)");
    expect(page).toContain("a concern the map only previews");
    expect(page).toContain("From the map, for information (2)");
    expect(page).toContain("Read-only");
    // A proposal written in the file links to Conventions.
    const written = { conventions: [...policy.conventions, { ...policy.conventions[0], id: "D-234880", status: "proposed" as const }] };
    const html = renderToStaticMarkup(createElement(FromMap, { doc: fromMap(), policy: written, onOpen: () => undefined }));
    expect(plain(html)).toContain("Open D-234880 in Conventions");
    expect(plain(html)).toContain("undecided in .drift/conventions.yaml");
  });

  it("an empty from_map (quiet) says nothing qualified", () => {
    const quiet = readFromMap(json("screens/quiet/from-map.json"));
    expect(quiet.proposals.length + quiet.held.length + quiet.notes.length).toBe(0);
    expect(plain(renderToStaticMarkup(createElement(FromMap, { doc: quiet, policy: null })))).toContain("Nothing from the map");
  });

  it("an entry of a shape it does not know is counted, not dropped silently", () => {
    const d = readFromMap({ from_map: [{ proposed: "maybe" }, 3, { proposed: false, note: "new_kind", kind: "x" }] });
    expect(d.unreadable).toBe(2);
    expect(d.notes[0].text).toContain("a note of a kind this Studio does not know (new_kind)");
  });
});

describe("drift upgrade (acme, files an older Drift wrote)", () => {
  it("reads what is left and who does it; apply is offered only for Drift's own work", () => {
    const r = up();
    expect(r.pending).toBe(true);
    const by = leftBy(r);
    expect(by.apply.map((t) => t.command)).toEqual(["drift upgrade --apply"]);
    expect(by.apply[0].what).toContain(".claude/settings.json");
    expect(by.security_baseline.map((t) => t.command)).toEqual(["drift upgrade --apply --security-baseline"]);
    expect(by.person.map((t) => t.command)).toEqual(["drift check"]);
    expect(canApply(r)).toEqual({ apply: true, securityBaseline: true });
    expect(applyWork(r, false).map((t) => t.by)).toEqual(["apply"]);
    expect(applyWork(r, true).map((t) => t.by)).toEqual(["apply", "security_baseline"]);
    expect(applyCommand(true)).toBe("drift upgrade --apply --security-baseline");
    expect(fileLine(r.files.find((f) => f.path === ".drift/conventions.yaml")!)).toBe("drift 0.1.0-dev, format 1 (this Drift: reads formats up to 3; would write this file as format 1)");
    expect(fileLine(r.files.find((f) => f.path === ".drift/config.yaml")!)).toBe("not there");
    const { changed, unchanged } = splitConventions(r.conventions);
    expect(changed.map((c) => c.id)).toEqual(["D-b0d245", "D-ed1ec0"]);
    expect(changed.length + unchanged.length).toBe(r.conventions.length);
  });

  it("after --apply, what Drift did is said and only what is left stays offered", () => {
    const applied = readUpgrade(json("screens/acme/upgrade-apply.json")) as UpgradeReport;
    expect(applied.apply).toBe(true);
    expect(applied.done.join("\n")).toContain("refreshed .claude/settings.json");
    expect(leftBy(applied).apply).toEqual([]);
    expect(canApply(applied)).toEqual({ apply: true, securityBaseline: true });
    const both = readUpgrade(json("screens/acme/upgrade-apply-security.json")) as UpgradeReport;
    expect(both.done.some((d) => d.includes(".drift/security.lock"))).toBe(true);
    expect(canApply(both)).toEqual({ apply: false, securityBaseline: false });
    expect(both.pending).toBe(true);
    // A failed write: never offered again; the report says what was written.
    expect(canApply({ ...up(), failed: "writing drift.lock: denied" })).toEqual({ apply: false, securityBaseline: false });
  });

  it("nothing to do (quiet), a refusal, and a schema it does not read", () => {
    const quiet = readUpgrade(json("screens/quiet/upgrade.json")) as UpgradeReport;
    expect(quiet.pending).toBe(false);
    expect(canApply(quiet).apply).toBe(false);
    expect(plain(renderToStaticMarkup(createElement(Upgrade, { doc: quiet })))).toContain("Nothing to do");
    const refused = readUpgrade({ schema: "drift-upgrade", version: 1, drift: "0.1.0", refused: true, newer: [".drift/conventions.yaml is version 9"], unreadable: [] });
    expect(isUpgradeRefusal(refused)).toBe(true);
    expect(plain(renderToStaticMarkup(createElement(Upgrade, { doc: refused })))).toContain("Nothing was read further and nothing was changed.");
    expect(() => readUpgrade({ schema: "drift-upgrade", version: 2 })).toThrow(/version 2/);
    expect(() => readUpgrade({ schema: "other", version: 1 })).toThrow(/another schema/);
  });

  it("the page shows the work, who does it, and offers Apply only with a handler", () => {
    const page = renderToStaticMarkup(createElement(Upgrade, { doc: up(), onApply: async () => undefined }));
    expect(plain(page)).toContain("Left to do (3)");
    expect(plain(page)).toContain("drift upgrade --apply does it");
    expect(plain(page)).toContain("for a person");
    expect(plain(page)).toContain("Apply…");
    expect(plain(page)).toContain("no inventory stamp (read as inventory 1)");
    expect(plain(renderToStaticMarkup(createElement(Upgrade, { doc: up() })))).not.toContain("Apply…");
  });
});

describe("feedback marks", () => {
  it("reads the marks file drift feedback mark wrote, one per report", () => {
    const m = readMarks(json("screens/acme/feedback-marks.json"))!;
    expect(m.marks.length).toBe(2);
    expect(tally(m.marks)).toEqual({ true: 1, wrong: 1 });
    const wrong = markOf(m, "D-288d8d", "apps/web/app/api/admin/health/route.ts#GET")!;
    expect([wrong.verdict, wrong.why, wrong.baselined]).toEqual(["wrong", "health check, public by design", true]);
    expect(markOf(m, "D-288d8d", "apps/web/x.ts#GET")).toBeNull();
    expect(readMarks(null)).toBeNull();
    expect(() => readMarks({ schema: "drift-feedback-marks", version: 2, marks: [] })).toThrow(/version 2/);
    const page = plain(renderToStaticMarkup(createElement(Feedback, { marks: m.marks })));
    expect(page).toContain("Marks (2): 1 true, 1 wrong");
    expect(page).toContain("nothing is sent anywhere");
    expect(page).toContain("drift feedback export --dry-run");
    expect(plain(renderToStaticMarkup(createElement(Feedback, { marks: [] })))).toContain("No marks yet");
  });

  it("shows exactly the argv it runs, every value one shell word", () => {
    for (const [id, member, verdict, why] of [
      ["D-b0d245", "apps/web/app/api/workspaces/[id]/archive-all/route.ts#GET", "true", null],
      ["D-288d8d", "apps/web/app/api/admin/health/route.ts#GET", "wrong", "  health   check, public by design "],
      ["D-288d8d", "-x/a.ts#GET", "wrong", "--true"],
    ] as const)
      expect(markFlags(id, member, verdict, why)).toEqual(runFlags(id, member, verdict, why));
    expect(markCommand("D-288d8d", "apps/web/app/api/admin/health/route.ts#GET", "wrong", "health check, it's public")).toBe("drift feedback mark --wrong '--why=health check, it'\\''s public' -- D-288d8d apps/web/app/api/admin/health/route.ts#GET");
  });
});

describe("main process: argv, exit codes and writes for the new channels", () => {
  it("builds fixed argv, `--` before the id and member, and the reason attached with =", () => {
    expect(driftArgs("/r", { op: "fromMap" })).toEqual(["--root", "/r", "census", "--from-map", "--json"]);
    expect(driftArgs("/r", { op: "upgrade" })).toEqual(["--root", "/r", "upgrade", "--json"]);
    expect(driftArgs("/r", { op: "upgradeApply", securityBaseline: false })).toEqual(["--root", "/r", "upgrade", "--apply", "--json"]);
    expect(driftArgs("/r", { op: "upgradeApply", securityBaseline: true })).toEqual(["--root", "/r", "upgrade", "--apply", "--security-baseline", "--json"]);
    expect(driftArgs("/r", { op: "feedbackMark", id: "D-abcdef", member: "-x/a.ts#b", verdict: "wrong", why: "--true" })).toEqual(["--root", "/r", "feedback", "mark", "--wrong", "--why=--true", "--", "D-abcdef", "-x/a.ts#b"]);
    for (const bad of [
      { id: "D-abcdef;x", member: "a.ts#b", verdict: "true", why: null },
      { id: "D-abcdef", member: "../a.ts#b", verdict: "true", why: null },
      { id: "D-abcdef", member: "a.ts#b", verdict: "maybe", why: null },
      { id: "D-abcdef", member: "a.ts#b", verdict: "true", why: "a\u0007b" },
      { id: "D-abcdef", member: "a.ts#b", verdict: "true", why: "x".repeat(301) },
      { id: "D-abcdef", member: "a.ts#b", verdict: "true", why: "   " },
    ])
      expect(() => driftArgs("/r", { op: "feedbackMark", ...bad } as never), JSON.stringify(bad)).toThrow(InvalidArgument);
    expect(() => driftArgs("/r", { op: "upgradeApply", securityBaseline: "yes" } as never)).toThrow(InvalidArgument);
    expect(assertWhy("  two\twords ")).toBe("two words");
  });

  it("knows which ops write, and which exit codes still carry the report", () => {
    expect(writesRepository("fromMap")).toBe(false);
    expect(writesRepository("upgrade")).toBe(false);
    expect(writesRepository("upgradeApply")).toBe(true);
    expect(writesRepository("feedbackMark")).toBe(true);
    expect([0, 1, 2, 3].map((c) => acceptableExit("upgrade", c))).toEqual([true, false, true, true]);
    expect([0, 1, 2, 3, 4].map((c) => acceptableExit("upgradeApply", c))).toEqual([true, true, true, true, false]);
    expect([0, 1, 2].map((c) => acceptableExit("fromMap", c))).toEqual([true, false, false]);
    expect([0, 1, 2].map((c) => acceptableExit("feedbackMark", c))).toEqual([true, false, false]);
  });

  it("the channel schemas refuse a bad verdict, reason or member before the main process runs", () => {
    const repo = { path: "/r", name: "r" };
    expect(channels.feedbackMark.req.safeParse([repo, "D-abcdef", "a.ts#b", "true", null]).success).toBe(true);
    expect(channels.feedbackMark.req.safeParse([repo, "D-abcdef", "a.ts#b", "wrong", "fine"]).success).toBe(true);
    for (const bad of [
      [repo, "D-abcdef", "a.ts#b", "yes", null],
      [repo, "D-abcdef", "a.ts", "true", null],
      [repo, "X", "a.ts#b", "true", null],
      [repo, "D-abcdef", "a.ts#b", "true", "x".repeat(301)],
      [repo, "D-abcdef", "a.ts#b", "true", "a\u0000b"],
    ])
      expect(channels.feedbackMark.req.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(channels.upgradeApply.req.safeParse([repo, { securityBaseline: true }]).success).toBe(true);
    expect(channels.upgradeApply.req.safeParse([repo, {}]).success).toBe(false);
    expect(channels.upgrade.res.safeParse({ data: json("screens/acme/upgrade.json"), at: 1, cached: false, provenance: { commit: null, branch: null, driftVersion: null } }).success).toBe(true);
    expect(channels.fromMap.res.safeParse({ data: json("screens/acme/from-map.json"), at: 1, cached: false, provenance: { commit: null, branch: null, driftVersion: null } }).success).toBe(true);
    expect(channels.feedbackMarks.res.safeParse(json("screens/acme/feedback-marks.json")).success).toBe(true);
    expect(channels.feedbackMarks.res.safeParse(null).success).toBe(true);
  });

  // A stand-in drift: `--version` and `census --help` answer; every other argv is appended to argv.log and answered
  // by the script's `body`.
  function setup(body: string) {
    const tmp = mkdtempSync(join(tmpdir(), "studio-screens-"));
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    const bin = join(tmp, "drift");
    writeFileSync(
      bin,
      `#!/bin/sh
case "$*" in
  --version) echo "drift 0.1.0-test" ;;
  "census --help") echo "--json" ;;
  *) echo "$*" >> "${join(tmp, "argv.log")}"; ${body} ;;
esac
`,
    );
    chmodSync(bin, 0o755);
    const store = new Store(join(tmp, "data"));
    store.update({ driftPath: bin });
    const main = new StudioMain({ store, projectsDir: join(tmp, "projects"), user: "tester", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => repo, chooseFile: async () => null, chooseSavePath: async () => null } });
    const argv = () => readFileSync(join(tmp, "argv.log"), "utf8").trim().split("\n").map((l) => l.split(" ").slice(2).join(" "));
    return { tmp, repo, main, ref: { path: repo, name: "repo" }, argv };
  }
  const REPORT = JSON.stringify({ schema: "drift-upgrade", version: 1, drift: "0.1.0", apply: false, files: [], conventions: [], violations: { reading_only: [], changed_code: [], cannot_tell: [] }, security: { present: false, stamped: false, this_inventory: 2, new_in_drift: {}, new_in_drift_total: 0, failing_not_in_baseline: 0 }, integrations: [], done: [], left: [{ what: "x", command: "drift check", by: "person" }], pending: true });

  it("reads drift upgrade at exit 3 and a refusal at exit 2; says plainly when the binary predates it", async () => {
    const pending = setup(`echo '${REPORT}'; exit 3`);
    await pending.main.openRepo();
    const r = await pending.main.upgrade(pending.ref);
    expect((r.data as { pending: boolean }).pending).toBe(true);
    expect(pending.argv()).toEqual(["upgrade --json"]);
    const refused = setup(`echo '{"schema":"drift-upgrade","version":1,"drift":"0.1.0","refused":true,"newer":["n"],"unreadable":[]}'; exit 2`);
    await refused.main.openRepo();
    expect((await refused.main.upgrade(refused.ref)).data).toMatchObject({ refused: true });
    const old = setup(`echo "error: unrecognized subcommand 'upgrade'" >&2; exit 2`);
    await old.main.openRepo();
    await expect(old.main.upgrade(old.ref)).rejects.toThrow(NO_UPGRADE);
    await expect(old.main.upgradeApply(old.ref, { securityBaseline: false })).rejects.toThrow(NO_UPGRADE);
    const oldMap = setup(`echo "error: unexpected argument '--from-map' found" >&2; exit 2`);
    await oldMap.main.openRepo();
    await expect(oldMap.main.fromMap(oldMap.ref)).rejects.toThrow(NO_FROM_MAP);
  });

  it("returns --apply's report at exit 1 (a failed write), and throws Drift's error when it printed none", async () => {
    const failed = setup(`echo '${REPORT.replace('"done":[]', '"done":["refreshed x"],"failed":"writing drift.lock: denied"')}'; exit 1`);
    await failed.main.openRepo();
    const out = (await failed.main.upgradeApply(failed.ref, { securityBaseline: true })) as { failed: string };
    expect(out.failed).toContain("denied");
    expect(failed.argv()).toEqual(["upgrade --apply --security-baseline --json"]);
    const broken = setup(`echo "drift: reading drift.lock: permission denied" >&2; exit 1`);
    await broken.main.openRepo();
    await expect(broken.main.upgradeApply(broken.ref, { securityBaseline: false })).rejects.toThrow("drift upgrade --apply failed: reading drift.lock: permission denied");
  });

  it("marks with the argv it shows, and reads the marks file only as Drift reads it", async () => {
    const ok = setup(`echo "Marked: it is wrong. Kept in .drift/feedback/marks.json, on this machine only."`);
    await ok.main.openRepo();
    expect(await ok.main.feedbackMark(ok.ref, "D-288d8d", "apps/web/route.ts#GET", "wrong", "public by design")).toContain("on this machine only");
    expect(ok.argv()).toEqual(["feedback mark --wrong --why=public by design -- D-288d8d apps/web/route.ts#GET"]);
    await expect(ok.main.feedbackMark(ok.ref, "D-288d8d", "apps/web/route.ts#GET", "maybe", null)).rejects.toThrow(InvalidArgument);
    // No file: null. The file Drift wrote: as written.
    expect(ok.main.feedbackMarks(ok.ref)).toBeNull();
    mkdirSync(join(ok.repo, ".drift", "feedback"), { recursive: true });
    writeFileSync(join(ok.repo, ".drift", "feedback", "marks.json"), text("screens/acme/feedback-marks.json"));
    expect((ok.main.feedbackMarks(ok.ref) as FeedbackMarks).marks.length).toBe(2);
    // A `.drift` that is a link is never followed.
    const linked = setup("exit 0");
    await linked.main.openRepo();
    symlinkSync(join(ok.repo, ".drift"), join(linked.repo, ".drift"));
    expect(() => linked.main.feedbackMarks(linked.ref)).toThrow(/symbolic link/);
    const old = setup(`echo "error: unrecognized subcommand 'feedback'" >&2; exit 2`);
    await old.main.openRepo();
    await expect(old.main.feedbackMark(old.ref, "D-288d8d", "a.ts#b", "true", null)).rejects.toThrow(NO_FEEDBACK);
  });
});
