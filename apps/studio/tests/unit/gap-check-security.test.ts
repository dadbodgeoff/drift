// The Check view's "What each rule rests on" (`standing[]`), security advice (`security_advice[]`) and promote hint
// (`practices.departures[].promote`); the Security view's "Look at these first" (`--top`), "Nothing reaches"
// (`unreached[]`), the entry points a change adds whose guard is unknown (`guard_unknown[]`) and the baseline write
// (`--write-baseline`). Read from fixtures/harbor, which the real drift wrote (scripts/make-harbor-fixtures.mjs).
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_TOP, StudioMain } from "../../electron/handlers";
import { InvalidArgument, acceptableExit, driftArgs, writesRepository } from "../../electron/ops";
import { Store } from "../../electron/store";
import { ADVICE_GROUPS, ADVICE_HEADING, ADVICE_SETTLE, CALLER_TEXT, TOP_HEADING, UNREACHED_NOT_COUNTED, UNREACHED_WHY, addedHas, adviceGroups, diffCounts, moreRankedText, notRankedParts, rankedLines, sinkAt, splitAt, validationText } from "@/entities/security";
import { baselineKeys, keys } from "@/entities/drift";
import { PromoteHint, SecurityAdviceSection, StandingSection } from "@/features/check/Basis";
import { breaks, notCheckedWhy, standingCounts, standingState } from "@/features/check/standing";
import { Changes } from "@/features/security/SecurityChanges";
import { TopList, Unreached } from "@/features/security/SecurityFindings";
import { FixtureApi } from "@/shared/api/fixture";
import { COMMANDS } from "@/shared/contract/coverage";
import type { CheckReport, CheckStanding, Inventory, SecurityAdvice, SecurityDiff, SecurityRanked, SecurityTop } from "@/shared/contract/drift";
import { AuditEntry, PolicyFiles, channels } from "@/shared/ipc/contract";
import { CHANNEL_NAMES } from "@/shared/ipc/names";
import { SECURITY_LOCK, baselineCommand, readSecurityLock } from "@/shared/lib/baseline";
import { json, text } from "./helpers";

const rs = (p: string) => readFileSync(new URL(`../../../../crates/${p}`, import.meta.url), "utf8");
/** The serialised fields of a Rust struct (`#[serde(skip)]` ones and private ones are never written). */
function fields(file: string, name: string): string[] {
  const src = rs(file);
  const start = src.indexOf(`pub struct ${name} {`);
  expect(start, `struct ${name}`).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n}\n", start)).replace(/^ {4}#\[serde\(skip\)\]\n {4}pub \w+:.*$/gm, "");
  return [...body.matchAll(/^ {4}pub (\w+):/gm)].map((m) => m[1]).sort();
}
const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<");

const check = () => json<CheckReport>("harbor/check.json");
const checkDiff = () => json<CheckReport>("harbor/check-diff.json");
const top = () => json<Inventory>("harbor/security-top.json").top!;
const diff = () => json<SecurityDiff>("harbor/security-diff.json");
const byId = (id: string) => check().standing!.find((s) => s.id === id)!;

describe("the contract matches what Drift serialises", () => {
  it("Standing, Advice, Top, Ranked, Place, NotRanked and UnreachedFile have the fields the Studio types", () => {
    const standing: Required<CheckStanding> = { id: "", whole: true, role: 0, members: 0, holders: 0, not_checked: 0, not_checked_why: {}, stale: "", mode: "advise", mode_note: "" };
    const advice: Required<SecurityAdvice> = { kind: "", key: "", at: "", read: "", reaches: [] };
    const place: Required<SecurityRanked["places"][number]> = { path: "", line: 0, method: null, route: null, symbol: "", exposure: "unknown", guard: "", guard_not_read: 0, schema_in_body: false, via: [] };
    const ranked: Required<SecurityRanked> = { kind: "", sink: "", sink_line: 0, caller: "anyone", validation: "found", places: [] };
    const notRanked: SecurityTop["not_ranked"] = { no_remote_caller: 0, no_caller: 0, test_or_example: 0, settings: 0, not_fed: 0, guard_unknown: 0 };
    const t: SecurityTop = { shown: [], more: 0, not_ranked: notRanked };
    const unreached: Required<NonNullable<Inventory["unreached"]>[number]> = { path: "", parsed: true, sinks: [], unlisted: [] };
    expect(fields("drift-mine/src/check.rs", "Standing")).toEqual(Object.keys(standing).sort());
    expect(fields("drift-mine/src/ratchet.rs", "Advice")).toEqual(Object.keys(advice).sort());
    expect(fields("drift-mine/src/security_summary.rs", "Place")).toEqual(Object.keys(place).sort());
    expect(fields("drift-mine/src/security_summary.rs", "Ranked")).toEqual(Object.keys(ranked).sort());
    expect(fields("drift-mine/src/security_summary.rs", "NotRanked")).toEqual(Object.keys(notRanked).sort());
    expect(fields("drift-mine/src/security_summary.rs", "Top")).toEqual(Object.keys(t).sort());
    expect(fields("drift-mine/src/security.rs", "UnreachedFile")).toEqual(Object.keys(unreached).sort());
  });

  it("the words are Drift's own: headings, caller words, not-ranked parts, advice groups", () => {
    const summary = rs("drift-mine/src/security_summary.rs");
    expect(summary).toContain(`pub const HEADING: &str = "${TOP_HEADING}";`);
    for (const w of Object.values(CALLER_TEXT)) expect(summary, w).toContain(`"${w}"`);
    for (const c of ["Anyone", "HookNotRead", "PassesGuard", "Service", "Unread"]) expect(summary).toContain(`Caller::${c} =>`);
    for (const p of notRankedParts({ no_remote_caller: 1, no_caller: 1, test_or_example: 1, settings: 1, not_fed: 1, guard_unknown: 1 })) expect(summary.replace(/\s+/g, " "), p).toContain(`"${p.slice(2)}"`);
    expect(summary).toContain("more ranked: `drift security --top {}` lists them all; `drift security` lists every entry point and what it reaches.");
    const ratchet = rs("drift-mine/src/ratchet.rs");
    expect(ratchet.replace(/\s+/g, " ")).toContain(`pub const ADVICE_HEADING: &str = "${ADVICE_HEADING}";`);
    for (const g of ADVICE_GROUPS) expect(ratchet.replace(/\s+/g, " "), g.kind).toContain(`"${g.kind}", "${g.heading}",`);
    expect(ratchet).toContain(ADVICE_SETTLE.replace(".drift/security.lock", "{SECURITY_LOCK}"));
    expect(ratchet).toContain(`pub const SECURITY_LOCK: &str = "${SECURITY_LOCK}";`);
    const security = rs("drift-mine/src/security.rs");
    expect(security).toContain(UNREACHED_WHY);
    expect(security).toContain("route-like registration(s) are not counted as production code");
    expect(UNREACHED_NOT_COUNTED).toContain("not counted as production code");
    const main = rs("drift-cli/src/main.rs");
    expect(main).toContain("member(s) not checked: Drift could not read what decides the rule for them, and never reports what it cannot read ({} follow it)");
    expect(main).toContain("mined rule is stale: {stale}, so its violations in drift.lock advise until a person looks (a violation not in drift.lock is checked as before)");
  });
});

describe("check: what each rule rests on (standing[])", () => {
  it("says each rule's state from its counts: stale first, then breaks, then cannot tell", () => {
    expect(standingState(byId("D-6ff644"))).toBe("stale");
    expect(standingState(byId("D-0f9742"))).toBe("breaks");
    expect(breaks(byId("D-0f9742"))).toBe(1);
    // D-b941d4: 24 members, 20 follow it, 1 not checked, so 3 break it.
    expect(breaks(byId("D-b941d4"))).toBe(3);
    expect(notCheckedWhy(byId("D-b941d4"))).toEqual([{ reason: "it is wrapped in withTeam, which does not resolve to code Drift read", n: 1 }]);
    const s: CheckStanding = { id: "D-1", whole: true, role: 9, members: 9, holders: 8, not_checked: 1, mode: "advise" };
    expect(standingState(s)).toBe("cannot-tell");
    expect(standingState({ ...s, holders: 9, not_checked: 0 })).toBe("holds");
    expect(standingState({ ...s, members: 0, holders: 0, not_checked: 0 })).toBe("empty");
    expect(standingCounts(check().standing!)).toEqual({ stale: 1, breaks: 2, "cannot-tell": 0, holds: 0, empty: 0 });
    expect(notCheckedWhy({ not_checked_why: { b: 1, a: 1, c: 4 } }).map((w) => w.reason)).toEqual(["c", "a", "b"]);
  });

  it("renders counts, the reason a member was not checked, the stale reason and the reviews that settle it", () => {
    const report = check();
    const html = plain(renderToStaticMarkup(createElement(StandingSection, { rows: report.standing!, summaries: new Map(report.violations.map((v) => [v.id, v.summary])), onConvention: () => {} })));
    expect(html).toContain("What each rule rests on");
    expect(html).toContain("1 stale, 2 some members break it");
    expect(html).toContain("1 of 24 member(s) not checked: Drift could not read what decides the rule for them");
    expect(html).toContain("it is wrapped in withTeam, which does not resolve to code Drift read (1)");
    expect(html).toContain("mined rule is stale: its role has 7 member(s) now, under the 8 a mined rule needs");
    expect(html).toContain("drift review --advise D-6ff644");
    expect(html).toContain("HTTP handlers in app/** (route files) are wrapped in withSession()");
    // Ids in order, as Drift lists them.
    expect(html.indexOf("D-0f9742")).toBeLessThan(html.indexOf("D-6ff644"));
    expect(html.indexOf("D-6ff644")).toBeLessThan(html.indexOf("D-b941d4"));
    expect(html).not.toContain("violation of");
  });

  it("says what it means when there is no accepted mined rule", () => {
    const html = plain(renderToStaticMarkup(createElement(StandingSection, { rows: [], summaries: new Map(), onConvention: () => {} })));
    expect(html).toContain("No accepted mined convention, so nothing here rests on what Drift mined.");
  });
});

describe("check: the promote hint (practices.departures[].promote)", () => {
  it("is the command Drift printed, shown whole and copied as it is", () => {
    const d = check().practices!.departures.find((x) => x.promote)!;
    expect(d.promote).toBe("drift practices promote P-7f5143 --in app/api");
    let copied = "";
    const html = renderToStaticMarkup(createElement(PromoteHint, { command: d.promote!, onCopy: (c: string) => (copied = c) }));
    expect(html).toContain(`<code class="st-cmd ck-promote__cmd">${d.promote}</code>`);
    expect(html).toContain(`aria-label="Copy ${d.promote}"`);
    expect(copied).toBe("");
  });
});

describe("check --diff-base: security advice (security_advice[])", () => {
  it("groups the advice under Drift's headings and splits where it is", () => {
    const advice = checkDiff().security_advice!;
    expect(advice).toHaveLength(1);
    const g = adviceGroups(advice);
    expect(g.map((x) => x.kind)).toEqual(["unguarded-reaching"]);
    expect(adviceGroups([...advice, { kind: "brand-new", key: "k", at: "a.ts:1", read: "r" }]).map((x) => x.kind)).toEqual(["unguarded-reaching", "brand-new"]);
    expect(splitAt("app/api/refunds/route.ts:3")).toEqual({ path: "app/api/refunds/route.ts", line: 3 });
    expect(splitAt("a:b")).toEqual({ path: "a:b", line: null });
  });

  it("renders the finding, what it reaches and how to settle it; never as a failure", () => {
    const html = plain(renderToStaticMarkup(createElement(SecurityAdviceSection, { advice: checkDiff().security_advice!, ratchet: undefined, onOpen: () => {}, onSecurity: () => {} })));
    expect(html).toContain("New entry points where Drift found no guard, reaching an operation fed by the request (1)");
    expect(html).toContain("app/api/refunds/route.ts:3");
    expect(html).toContain("app/api/refunds/route.ts#GET GET /api/refunds");
    expect(html).toContain("no guard found in what Drift read; reaches SQL built by interpolation (fed by the request)");
    expect(html).toContain("this does not fail the check");
    expect(html).toContain("drift security --write-baseline");
  });

  it("says what nothing means, with and without a baseline", () => {
    const none = plain(renderToStaticMarkup(createElement(SecurityAdviceSection, { advice: [], ratchet: undefined, onOpen: () => {}, onSecurity: () => {} })));
    expect(none).toContain("This change adds no entry point where Drift found no guard");
    expect(none).toContain("it fails nothing");
    const kept = plain(renderToStaticMarkup(createElement(SecurityAdviceSection, { advice: [], ratchet: { added: {}, gone: [], kept: 4 }, onOpen: () => {}, onSecurity: () => {} })));
    expect(kept).toContain("Checked against the repository's security baseline: 0 findings not in it, 0 findings in it no longer found, 4 still found.");
    const added = plain(renderToStaticMarkup(createElement(SecurityAdviceSection, { advice: [], ratchet: { added: { "no-guard": [{ key: "a.ts#f GET /a", at: "a.ts:3" }] }, gone: [], kept: 0 }, onOpen: () => {}, onSecurity: () => {} })));
    expect(added).toContain("1 finding not in it");
    expect(added).toContain("a.ts#f GET /a");
    // Where the lock opts in, a finding the change baselines itself fails, and is shown so.
    const own = plain(renderToStaticMarkup(createElement(SecurityAdviceSection, { advice: [], ratchet: { added: {}, gone: [], kept: 2, self_baselined: { risky: [{ key: "eval in a.py#f", at: "a.py:4" }] } }, onOpen: () => {}, onSecurity: () => {} })));
    expect(own).toContain("0 findings not in it");
    expect(own).toContain("1 finding this change adds and writes into .drift/security.lock itself, which the baseline sets to fail.");
    expect(own).toContain("eval in a.py#f");
    expect(rs("drift-mine/src/ratchet.rs")).toContain("pub self_baselined: BTreeMap<String, Vec<Added>>");
  });
});

describe("security --top: look at these first", () => {
  it("words each ranked finding as Drift does, and says why the others are not ranked", () => {
    const t = top();
    expect(t.shown.map((r) => r.caller)).toEqual(["anyone", "passes_guard"]);
    const first = rankedLines(t.shown[0])!;
    expect(first.head).toBe("A caller Drift found no guard for can send a value that is written into the text of an SQL query (sql_string_interpolation): GET /api/refunds (app/api/refunds/route.ts:3); the operation is in lib/db.ts:5 (find).");
    expect(first.read).toBe("Read: no guard found in what Drift read; a value the request sent reaches the operation through find; no input validation found.");
    expect(first.notRead).toBe("Not read: whether the value is checked before the operation; where the entry point can be reached from.");
    const second = rankedLines(t.shown[1])!;
    expect(second.head).toMatch(/^A caller who passes its guard can send .* at 20 entry points through lib\/db\.ts:5 \(find\): GET \/api\/accounts \(app\/api\/accounts\/route\.ts:4\); .*, and 17 more\.$/);
    expect(second.read.startsWith("Read: behind withSession;")).toBe(true);
    expect(notRankedParts(t.not_ranked)).toEqual(["1 where Drift could not read the guard"]);
    expect(sinkAt({ sink: "lib/db.ts#find" })).toBe("lib/db.ts#find");
    expect(moreRankedText(3, 5)).toBe("3 more ranked: `drift security --top 5` lists them all; `drift security` lists every entry point and what it reaches.");
  });

  it("says validation as it was read", () => {
    const p = top().shown[0].places[0];
    expect(validationText({ validation: "not_read", places: [p] })).toBeNull();
    expect(validationText({ validation: "found", places: [{ ...p, schema_in_body: true }] })).toBe("a schema is read in the body");
    expect(validationText({ validation: "found", places: [{ ...p, schema_in_body: true }, p] })).toBe("the input is validated on the way, or a schema is read in the body");
    expect(validationText({ validation: "found", places: [p] })).toBe("the input is validated on the way");
  });

  it("renders the ranking, the unread guard as not ranked (never as unguarded), and offers all when more are ranked", () => {
    const t = top();
    const html = plain(renderToStaticMarkup(createElement(TopList, { top: t, onOpen: () => {} })));
    expect(html).toContain(TOP_HEADING);
    expect(html).toContain("Not ranked: 1 where Drift could not read the guard.");
    expect(html).toContain("its guard is unknown");
    const cut = plain(renderToStaticMarkup(createElement(TopList, { top: { ...t, shown: t.shown.slice(0, 1), more: 1 }, onOpen: () => {}, onAll: () => {} })));
    expect(cut).toContain("1 more ranked: `drift security --top 2` lists them all");
    expect(cut).toContain("Show all 2");
    const none = plain(renderToStaticMarkup(createElement(TopList, { top: { ...t, shown: [], more: 0 }, onOpen: () => {} })));
    expect(none).toContain("Nothing ranks");
    expect(none).toContain("1 where Drift could not read the guard");
  });
});

describe("security: files nothing reaches (unreached[])", () => {
  it("lists each with what it holds, and says what it means when there is none", () => {
    const inv = json<Inventory>("harbor/security.json");
    const html = plain(renderToStaticMarkup(createElement(Unreached, { inv, onOpen: () => {} })));
    expect(html).toContain("1 production file not reached by anything Drift read");
    expect(html).toContain("tools/sweep/sweep.ts");
    expect(html).toContain("eval()");
    expect(html).toContain("1 kind(s) of risky operation");
    const odd = plain(renderToStaticMarkup(createElement(Unreached, { inv: { unreached: [{ path: "x.ts", parsed: false, unlisted: [4, 9] }] }, onOpen: () => {} })));
    expect(odd).toContain("did not parse");
    expect(odd).toContain("2 route-like registration(s), line 4, 9");
    const none = plain(renderToStaticMarkup(createElement(Unreached, { inv: {}, onOpen: () => {} })));
    expect(none).toContain("Every production file is reached");
  });
});

describe("security --diff-base: what a change adds, and whose guard is unknown", () => {
  it("counts unknown apart from the facts, and says unknown, never no guard", () => {
    const d = diff();
    expect(diffCounts(d)).toMatchObject({ addedWithoutGuard: 0, guardUnknown: 2 });
    expect(diffCounts(d).total).toBe(diffCounts({ ...d, guard_unknown: [] }).total);
    const payouts = d.guard_unknown!.find((e) => e.path === "app/api/payouts/route.ts")!;
    expect(addedHas(payouts)).toBe("guard unknown, Drift cannot tell whether it requires sign-in (it could not read: requireMember)");
    const html = plain(renderToStaticMarkup(createElement(Changes, { d, scopeBar: null })));
    expect(html).toContain("New entry points whose guard is unknown (2)");
    expect(html).toContain("New entry points where Drift found no guard (0)");
    expect(html).toContain("it could not read: withTeam");
    expect(html).toContain("app/api/payouts/route.ts");
    const section = html.slice(html.indexOf("New entry points whose guard is unknown"));
    expect(section).not.toContain("no guard found");
    // A change that adds only entry points whose guard is unknown introduces no fact, and says why the list is there.
    const onlyUnknown = plain(renderToStaticMarkup(createElement(Changes, { d: { ...d, unguarded_reaching: [], sinks: [], guard_gaps: [], leaks: [], now_public: [] }, scopeBar: null })));
    expect(onlyUnknown).toContain("This change introduces none of the six");
    expect(onlyUnknown).toContain("2 new entry points whose guard is unknown are listed below: unknown, not a finding.");
  });
});

describe("the security baseline: reading it, writing it", () => {
  it("reads a lock as Drift does: distinct rows, the union of fail kinds, the newest inventory", () => {
    const lock = json<{ stdout: string; lock: string }>("harbor/security-baseline.json");
    const r = readSecurityLock(lock.lock)!;
    expect(r.findings).toBe(lock.lock.split("\n").filter((l) => l && !l.startsWith("#")).length);
    expect(r.findings).toBeGreaterThan(0);
    expect(r.inventory).not.toBeNull();
    expect(lock.stdout).toContain(`Wrote ${SECURITY_LOCK} (${r.findings} finding(s))`);
    const merged = readSecurityLock("﻿# inventory: 2\r\n# fail: b,a\n# inventory: 3\n# fail: c\nno-guard\tk1\nno-guard\tk1\nrisky\tk2\nnot a row\n")!;
    expect(merged).toEqual({ findings: 2, byKind: { "no-guard": 1, risky: 1 }, inventory: 3, fail: ["a", "b", "c"] });
    expect(readSecurityLock("no-guard\tk\n")).toEqual({ findings: 1, byKind: { "no-guard": 1 }, inventory: null, fail: null });
    expect(readSecurityLock(null)).toBeNull();
    expect(readSecurityLock(undefined)).toBeNull();
  });

  it("runs exactly the command the confirmation shows, as a write; --top only as a bounded number", () => {
    expect(driftArgs("/r", { op: "securityBaseline" })).toEqual(["--root", "/r", "security", "--write-baseline"]);
    expect(["drift", ...driftArgs("/r", { op: "securityBaseline" })].join(" ")).toBe(baselineCommand("/r"));
    expect(driftArgs("/r", { op: "securityTop", n: 10 })).toEqual(["--root", "/r", "security", "--top", "10", "--json"]);
    expect(driftArgs("/r", { op: "securityTop", n: 0 })).toEqual(["--root", "/r", "security", "--top", "0", "--json"]);
    for (const n of [-1, 1.5, 1001, Number.NaN]) expect(() => driftArgs("/r", { op: "securityTop", n }), String(n)).toThrow(InvalidArgument);
    expect(writesRepository("securityBaseline")).toBe(true);
    expect(writesRepository("securityTop")).toBe(false);
    expect(acceptableExit("securityBaseline", 1)).toBe(false);
    expect(acceptableExit("securityTop", 1)).toBe(false);
  });

  it("has two channels, validated both ways, and an audit decision of its own", () => {
    expect(CHANNEL_NAMES).toContain("securityTop");
    expect(CHANNEL_NAMES).toContain("securityBaseline");
    const repo = { path: "/r", name: "r" };
    expect(channels.securityTop.req.safeParse([repo, 10]).success).toBe(true);
    for (const n of [-1, 2.5, 5000, "10"]) expect(channels.securityTop.req.safeParse([repo, n]).success, String(n)).toBe(false);
    expect(channels.securityBaseline.req.safeParse([repo]).success).toBe(true);
    expect(channels.securityBaseline.req.safeParse([repo, "--force"]).success).toBe(false);
    expect(AuditEntry.safeParse({ at: 1, user: "u", decision: "security-baseline", ids: [], command: baselineCommand("/r"), ok: true, output: "" }).success).toBe(true);
    expect(PolicyFiles.shape.securityLock.safeParse(undefined).success).toBe(true);
    // Writing it refetches what it changes: the policy (the lock is one), check, every security run, the history.
    expect(baselineKeys(repo)).toEqual([keys.policy(repo), keys.check(repo), keys.security(repo), keys.history(repo)]);
    expect(keys.securityTop(repo, 10).slice(0, 2)).toEqual(keys.security(repo));
    expect(JSON.stringify(COMMANDS.security)).toContain("--write-baseline");
    expect(JSON.stringify(COMMANDS.security)).toContain("--top N");
    expect(JSON.stringify(COMMANDS.check)).toContain("standing[]");
  });

  it("in fixture mode: --top takes the first N of every ranked finding, and the write is recorded in the tab only", async () => {
    const api = new FixtureApi("/", 0);
    const files = new Map<string, string>([
      ["/index.json", text("index.json")],
      ["/harbor/security-top.json", text("harbor/security-top.json")],
      ["/harbor/security-baseline.json", text("harbor/security-baseline.json")],
      ["/harbor/conventions.yaml", text("harbor/conventions.yaml")],
      ["/harbor/drift.lock", text("harbor/drift.lock")],
      ["/harbor/history.json", text("harbor/history.json")],
    ]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(files.get(String(u)) ?? "", { status: files.has(String(u)) ? 200 : 404, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const harbor = { path: "/work/harbor", name: "harbor" };
      const one = (await api.securityTop(harbor, 1)).data.top!;
      expect([one.shown.length, one.more]).toEqual([1, 1]);
      const all = (await api.securityTop(harbor, 0)).data.top!;
      expect([all.shown.length, all.more]).toEqual([2, 0]);
      await expect(api.securityTop({ path: "/work/acme", name: "acme" }, 10)).rejects.toThrow("drift security --top failed: fixture mode has no security-top.json for acme");
      expect((await api.policy(harbor)).securityLock ?? null).toBeNull();
      const entry = await api.securityBaseline(harbor);
      expect(entry).toMatchObject({ decision: "security-baseline", ids: [], command: baselineCommand("/work/harbor"), ok: true });
      expect(entry.output).toContain("Wrote .drift/security.lock");
      expect(entry.output).toContain("no file was written");
      expect(readSecurityLock((await api.policy(harbor)).securityLock)!.findings).toBeGreaterThan(0);
      await expect(api.securityBaseline({ path: "/work/acme", name: "acme" })).rejects.toThrow("fixture mode has no security-baseline.json for acme");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the main process", () => {
  function setup(script: string) {
    const tmp = mkdtempSync(join(tmpdir(), "studio-security-"));
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    const bin = join(tmp, "drift");
    writeFileSync(bin, `#!/bin/sh\ncase "$*" in\n  --version) echo "drift 0.1.0-test" ;;\n  "census --help") echo "--json" ;;\n${script}\n  *) exit 3 ;;\nesac\n`);
    chmodSync(bin, 0o755);
    const store = new Store(join(tmp, "data"));
    store.update({ driftPath: bin });
    const main = new StudioMain({ store, projectsDir: join(tmp, "projects"), user: "tester", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => repo, chooseFile: async () => null, chooseSavePath: async () => null } });
    return { tmp, repo, store, main, ref: { path: repo, name: "repo" } };
  }

  it("reads security --top, and says plainly when the binary predates it", async () => {
    const ok = setup(`  *"security --top 10 --json"*) echo '{"entry_points":[],"sinks":[],"client_leaks":[],"env":{},"top":{"shown":[],"more":0,"not_ranked":{"no_remote_caller":0,"no_caller":0,"test_or_example":0,"settings":0,"not_fed":0,"guard_unknown":0}}}' ;;`);
    await ok.main.openRepo();
    const r = await ok.main.securityTop(ok.ref, 10);
    expect((r.data as Inventory).top?.more).toBe(0);
    expect(channels.securityTop.res.safeParse(r).success).toBe(true);
    const old = setup(`  *"security --top"*) echo "error: unexpected argument '--top' found" >&2; exit 2 ;;`);
    await old.main.openRepo();
    await expect(old.main.securityTop(old.ref, 10)).rejects.toThrow(NO_TOP);
  });

  it("writes the baseline, records it in the audit trail, and reads the lock back with the policy", async () => {
    const m = setup(`  *"security --write-baseline"*) mkdir -p "$2/.drift"; printf '# inventory: 2\\nno-guard\\tk\\n' > "$2/.drift/security.lock"; echo "Wrote .drift/security.lock (1 finding(s)): no-guard 1" ;;`);
    await m.main.openRepo();
    const entry = await m.main.securityBaseline(m.ref);
    expect(entry).toMatchObject({ decision: "security-baseline", ids: [], user: "tester", ok: true, command: `drift --root ${m.repo} security --write-baseline` });
    expect(entry.output).toBe("Wrote .drift/security.lock (1 finding(s)): no-guard 1");
    expect(m.main.history(m.ref).audit.at(-1)).toEqual(entry);
    expect(readSecurityLock((await m.main.policy(m.ref)).securityLock)).toEqual({ findings: 1, byKind: { "no-guard": 1 }, inventory: 2, fail: null });
    const bad = setup(`  *"security --write-baseline"*) echo "boom" >&2; exit 2 ;;`);
    await bad.main.openRepo();
    const failed = await bad.main.securityBaseline(bad.ref);
    expect(failed.ok).toBe(false);
    expect(bad.main.history(bad.ref).audit).toHaveLength(1);
  });
});
