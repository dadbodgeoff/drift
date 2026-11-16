// Every form of `drift practices promote` the Studio offers (crates/drift-cli/src/promote.rs): the command the dialog
// builds from typed choices, the refusals the command line makes before it reads anything (disabled with its own
// sentence), the fields of what Drift answers, and the recorded runs fixture mode serves. Drift's sources are read
// (no build needed), so a flag, a refusal code or a JSON field Drift adds or renames fails here until the Studio
// knows it.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PromoteAnswer,
  type PromoteChoice,
  blockOffer,
  choiceFromCandidate,
  choiceFromVariant,
  choiceRefusal,
  forceOffer,
  forceText,
  mechanismOptions,
  refusedReplay,
  replacesText,
  requestOf,
  switchPlaceKind,
  toggleMechanism,
  wayOptions,
} from "@/features/practices";
import type { CensusWhy, PracticeConcern, PromoteList, PromoteRefused, PromoteResult, PromoteUsageRefusal } from "@/shared/contract/drift";
import { PromoteRequest } from "@/shared/ipc/contract";
import type { PromoteRequest as PromoteRequestT } from "@/shared/api";
import { BLOCK_FORCED, ENFORCING_CONCERNS, PLAIN_CONCERN, REPLAY_UNITS, cannotBlock, cliRefusal, noEnforcingMessage, placeArg, placeChoiceFromArg, placeChoiceOf, placeProblem, promoteCommand, promoteFlags, shellWord } from "@/shared/lib/promote-args";
import { type RecordedRun, isRefused, recordedRun } from "@/shared/lib/promote";
import { InvalidArgument, driftArgs, promoteFlags as mainFlags } from "../../electron/ops";
import { FixtureApi } from "@/shared/api/fixture";
import { json, text } from "./helpers";

const src = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");
const cli = () => src("crates/drift-cli/src/promote.rs");
const engine = () => src("crates/drift-mine/src/practices/promote.rs");
/** The keys of the first `json!({ ... })` after `marker` in `text`, at its top level. */
function jsonKeys(text: string, marker: string): string[] {
  const at = text.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const start = text.indexOf("json!({", at) + "json!({".length;
  let depth = 1;
  let i = start;
  for (; i < text.length && depth > 0; i++) depth += text[i] === "{" || text[i] === "[" || text[i] === "(" ? 1 : text[i] === "}" || text[i] === "]" || text[i] === ")" ? -1 : 0;
  const body = text.slice(start, i - 1);
  const keys: string[] = [];
  let d = 0;
  for (const m of body.matchAll(/[{}[\]()]|"(\w+)":/g)) {
    if (m[0] === "{" || m[0] === "[" || m[0] === "(") d++;
    else if (m[0] === "}" || m[0] === "]" || m[0] === ")") d--;
    else if (d === 0 && m[1]) keys.push(m[1]);
  }
  return keys.sort();
}

const base: PromoteChoice = { concern: "authn", ways: ["P-0f0acb"], mechanisms: [], anyEnforcing: false, place: { kind: "dir", path: "app/api" }, block: false, force: false };
const flags = (ch: Partial<PromoteChoice>, dry = false) => promoteFlags(requestOf({ ...base, ...ch })!, dry);

describe("the command the dialog builds, form by form and place by place", () => {
  it("names a variant first, or --concern when it names none, then the place, the other ways, mechanisms and any enforcing way, as Drift prints a command", () => {
    expect(flags({})).toEqual(["P-0f0acb", "--in", "app/api", "--json"]);
    // Additive: more ways, mechanisms whole and any enforcing way add up.
    expect(flags({ ways: ["P-0f0acb", "P-111111"], mechanisms: ["wrap", "decorator"], anyEnforcing: true })).toEqual(["P-0f0acb", "--in", "app/api", "--with", "P-111111", "--mechanism", "decorator", "--mechanism", "wrap", "--any-enforcing", "--json"]);
    // By concern: a mechanism whole, any enforcing way.
    expect(flags({ ways: [], mechanisms: ["membership_guard"] })).toEqual(["--concern", "authn", "--in", "app/api", "--mechanism", "membership_guard", "--json"]);
    expect(flags({ ways: [], anyEnforcing: true })).toEqual(["--concern", "authn", "--in", "app/api", "--any-enforcing", "--json"]);
    // The mode and the preview.
    expect(flags({ block: true }, true)).toEqual(["P-0f0acb", "--in", "app/api", "--block", "--dry-run", "--json"]);
    expect(flags({ force: true })).toEqual(["P-0f0acb", "--in", "app/api", "--force", "--json"]);
    // Places: the root package, a directory, one file, a route prefix of a package or of the root package.
    expect(flags({ place: { kind: "dir", path: "." } })).toEqual(["P-0f0acb", "--in", ".", "--json"]);
    expect(flags({ place: { kind: "file", path: "app/api/admin/route.ts" } }).slice(1, 3)).toEqual(["--in", "app/api/admin/route.ts"]);
    expect(flags({ place: { kind: "route", path: "apps/web", prefix: "/api/workspaces/[id]/" } }).slice(1, 3)).toEqual(["--in", "apps/web:/api/workspaces/[id]"]);
    expect(flags({ place: { kind: "route", path: ".", prefix: "/api" } }).slice(1, 3)).toEqual(["--in", ".:/api"]);
    // Once each, in the order ticked.
    expect(flags({ ways: ["P-0f0acb", "P-111111", "P-0f0acb", "P-222222"] })).toEqual(["P-0f0acb", "--in", "app/api", "--with", "P-111111", "--with", "P-222222", "--json"]);
  });

  it("shows the command as a shell reads it, each word quoted where Drift quotes it (report.rs shell_word)", () => {
    expect(shellWord("apps/web/app/api/workspaces/[id]")).toBe("'apps/web/app/api/workspaces/[id]'");
    expect(shellWord("app/(auth)/api")).toBe("'app/(auth)/api'");
    expect(shellWord("it's")).toBe("'it'\\''s'");
    expect(shellWord("apps/web:/api")).toBe("apps/web:/api");
    expect(promoteCommand("/work/acme", requestOf({ ...base, ways: [], anyEnforcing: true, place: { kind: "dir", path: "apps/web/app/api/workspaces/[id]" } })!, false)).toBe("drift --root /work/acme practices promote --concern authn --in 'apps/web/app/api/workspaces/[id]' --any-enforcing --json");
  });

  it("builds exactly the command Drift prints for every candidate it lists, from the candidate's form and place", () => {
    const list = json<PromoteList>("acme/promote-list.json");
    const items = [...list.candidates, ...(list.passive ?? [])];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const req = requestOf(choiceFromCandidate(item))!;
      expect(["drift practices promote", ...promoteFlags(req, false).slice(0, -1).map(shellWord)].join(" "), item.command).toBe(item.command);
    }
  });

  it("reads every place Drift prints back as the same --in", () => {
    expect(placeChoiceOf({ package: "", dir: "" })).toEqual({ kind: "dir", path: "." });
    expect(placeChoiceOf({ package: "apps/web", dir: "app/api" })).toEqual({ kind: "dir", path: "apps/web/app/api" });
    expect(placeChoiceOf({ package: "apps/web", dir: "app/api", file: "apps/web/app/api/x.ts" })).toEqual({ kind: "file", path: "apps/web/app/api/x.ts" });
    expect(placeChoiceOf({ package: "", dir: "", route: "/api/[*]" })).toEqual({ kind: "route", path: ".", prefix: "/api/[*]" });
    expect(placeArg(placeChoiceOf({ package: "apps/api", dir: "", route: "/v2" }))).toBe("apps/api:/v2");
    expect(placeChoiceFromArg(".:/api")).toEqual({ kind: "route", path: ".", prefix: "/api" });
    expect(placeChoiceFromArg("apps/web")).toEqual({ kind: "dir", path: "apps/web" });
    expect(switchPlaceKind({ kind: "file", path: "apps/web/lib/a.ts" }, "dir", { files: [], packages: [] })).toEqual({ kind: "dir", path: "apps/web/lib" });
    expect(switchPlaceKind({ kind: "dir", path: "apps/web" }, "route", { files: [], packages: ["apps/api", "apps/web"] })).toEqual({ kind: "route", path: "apps/web", prefix: "/api" });
    expect(switchPlaceKind({ kind: "dir", path: "apps/web" }, "file", { files: ["apps/api/a.ts", "apps/web/b.ts"], packages: [] })).toEqual({ kind: "file", path: "apps/web/b.ts" });
  });

  it("does not pass a place --in cannot take, and says why", () => {
    for (const path of ["", "/etc", "../x", "a/../b", "a//b", "-x", "a\\b", "a\nb"]) expect(placeProblem({ kind: "dir", path }), path).not.toBeNull();
    expect(placeProblem({ kind: "file", path: "." })).toMatch(/a file/);
    for (const prefix of ["", "api", "/", "/a b", "/a//b", "/../x"]) expect(placeProblem({ kind: "route", path: "apps/web", prefix }), prefix).not.toBeNull();
    expect(placeProblem({ kind: "route", path: "apps/web", prefix: "/api/[id]" })).toBeNull();
    expect(requestOf({ ...base, place: { kind: "dir", path: "../x" } })).toBeNull();
    // The channel schema and the main process agree.
    for (const place of ["apps/web:/api/x", ".:/api", "apps/web/x.ts", "."]) {
      expect(PromoteRequest.safeParse({ id: "P-0f0acb", place, with: [], block: false }).success, place).toBe(true);
      expect(() => driftArgs("/r", { op: "promotePreview", promote: { id: "P-0f0acb", place, with: [], block: false } })).not.toThrow();
    }
    for (const place of ["apps/web:/", "apps/web:/a//b", "../x:/api", "-x:/api", "apps/web:/a b"]) {
      expect(PromoteRequest.safeParse({ id: "P-0f0acb", place, with: [], block: false }).success, place).toBe(false);
      expect(() => driftArgs("/r", { op: "promotePreview", promote: { id: "P-0f0acb", place, with: [], block: false } }), place).toThrow(InvalidArgument);
    }
  });

  it("runs in the main process exactly what it shows, for every form", () => {
    const forms = [{}, { ways: [], mechanisms: ["wrap"] }, { ways: [], anyEnforcing: true }, { ways: ["P-0f0acb", "P-111111"], mechanisms: ["a_b"], anyEnforcing: true, block: true }, { force: true }, { place: { kind: "route" as const, path: ".", prefix: "/x" } }];
    for (const f of forms) for (const dry of [true, false]) expect(mainFlags(requestOf({ ...base, ...f })!, dry)).toEqual(flags(f, dry));
    for (const bad of [{ concern: "Auth" }, { mechanisms: ["--force"] }, { with: ["D-000000"] }, { force: "yes" }, { any_enforcing: 1 }])
      expect(() => mainFlags({ id: "P-0f0acb", place: "app", with: [], block: false, ...bad } as never, true), JSON.stringify(bad)).toThrow(InvalidArgument);
    expect(() => mainFlags({ place: "app", with: [], block: false }, true)).toThrow(/names a variant or a concern/);
  });
});

describe("what the command line refuses before it reads anything, in its own words", () => {
  const rs = cli();
  it("refuses a request that names no way and no concern, --block with --force, nothing to accept, and any enforcing way of a concern with no reading of it", () => {
    const r = (x: Partial<ReturnType<typeof requestOf> & object>) => cliRefusal({ place: "app", with: [], block: false, ...x });
    expect(r({})?.code).toBe("no_variant");
    expect(r({ mechanisms: ["wrap"] })?.code).toBe("no_concern");
    expect(r({ any_enforcing: true })?.code).toBe("no_concern");
    expect(r({ id: "P-0f0acb", block: true, force: true })?.code).toBe("block_forced");
    expect(r({ concern: "authn" })?.code).toBe("nothing_accepted");
    expect(r({ concern: "logging", any_enforcing: true })?.code).toBe("no_enforcing");
    expect(r({ concern: "authn", any_enforcing: true })).toBeNull();
    expect(r({ concern: "authz", any_enforcing: true })).toBeNull();
    expect(r({ id: "P-0f0acb" })).toBeNull();
    expect(choiceRefusal({ ...base, ways: [] })?.code).toBe("nothing_accepted");
    expect(choiceRefusal({ ...base, block: true, force: true })?.message).toBe(BLOCK_FORCED);
  });

  it("says each sentence as promote.rs prints it", () => {
    for (const x of [{}, { mechanisms: ["wrap"] }, { id: "P-0f0acb", block: true, force: true }]) {
      const m = cliRefusal({ place: "app", with: [], block: false, ...x })!.message;
      expect(rs, m).toContain(m);
    }
    // nothing_accepted: the engine's sentence and the CLI's forms.
    const nothing = cliRefusal({ concern: "authn", place: "app", with: [], block: false })!.message;
    expect(engine()).toContain('"Nothing to promote: name a way (a variant id), a mechanism, or any way that enforces the concern."');
    expect(rs).toContain(nothing.slice(nothing.indexOf(" The forms:") + 1).replace(/^/, ""));
    // no_enforcing: the engine's sentence, the concerns with the reading, what to name instead.
    expect(noEnforcingMessage("logging")).toBe("Drift has no reading of which ways enforce logging: name its ways instead. Drift has that reading for authn, authz (`--concern <id> --any-enforcing`). For this one, name its ways (`drift practices --concern logging --all` lists them) or a mechanism (`--mechanism <name>`).");
    expect(engine()).toContain('"Drift has no reading of which ways enforce {}: name its ways instead."');
    expect(rs).toContain('" Drift has that reading for {} (`--concern <id> --any-enforcing`)."');
    expect(rs).toContain('"{base}{others} For this one, name its ways (`drift practices --concern {} --all` lists them) or a mechanism (`--mechanism <name>`)."');
  });

  it("knows which concerns have a reading of what enforces them, how Drift names each concern, and how many units a replay reads", () => {
    const practices = "crates/drift-mine/src/practices";
    const withReading = ["authn", "authz", "errors", "api", "validation", "config", "data_access", "logging", "testing"].filter((id) => {
      try {
        return /fn enforces\(&self, uses: &\[Use\]\) -> Option<bool>/.test(src(`${practices}/${id}.rs`));
      } catch {
        return false;
      }
    });
    expect(withReading).toEqual([...ENFORCING_CONCERNS]);
    const render = src(`${practices}/render.rs`);
    for (const [id, words] of Object.entries(PLAIN_CONCERN)) expect(render, id).toContain(`${id.toUpperCase()} => "${words}"`);
    expect(engine()).toContain("pub const REPLAY_UNITS: usize = crate::mine::MIN_BLOCK_ROLE_SIZE;");
    expect(src("crates/drift-mine/src/mine.rs")).toContain(`pub const MIN_BLOCK_ROLE_SIZE: usize = ${REPLAY_UNITS};`);
    expect(cannotBlock({ follows: 9, exceptions: [1, 2], unit: "entry_point" })).toBe("It cannot block: blocking needs a replay of the 15 entry points added here most recently, and Drift can read only 11 here");
    expect(engine()).toContain('"It cannot block: blocking needs a replay of the {REPLAY_UNITS} {} added here most recently, and Drift can read only {readable} here"');
    expect(cannotBlock({ follows: 15, exceptions: [], unit: "entry_point" })).toBeNull();
  });

  it("has every flag the command has, by the names the Studio passes", () => {
    const args = rs.slice(rs.indexOf("pub struct PromoteArgs {"), rs.indexOf("\n}\n", rs.indexOf("pub struct PromoteArgs {")));
    const named = [...args.matchAll(/#\[arg\(long(?: = "([\w-]+)")?[^\n]*\)\]\n\s+pub (\w+):/g)].map((m) => m[1] ?? m[2]!.replace(/_/g, "-")).sort();
    expect(named).toEqual(["any-enforcing", "block", "concern", "dry-run", "force", "in", "json", "list", "mechanism", "with"]);
  });
});

describe("what Drift answers, as the contract types it", () => {
  const rs = cli();
  it("types every field of a promotion's JSON, of the list's, of a refusal of the command line's own and of the funnel", () => {
    const result: Required<PromoteResult> = {
      written: false,
      place: "",
      convention: { id: "", summary: "", status: "accepted", mode: "advise", promoted_from_practice: null },
      candidate: { concern: "", unit: "", place: { package: "", dir: "" }, ways: [], other_ways: [], follows: 0, exceptions: [], unknown: 0, total: 0, example: null, forced: false },
      baselined: 0,
      replay: null,
      block_dropped: null,
      same_way: [],
      replaces: [{ id: "", summary: "", narrowed: [] }],
      preview: "",
      probation: { on_probation: false, why: null, written: false, count: null },
    };
    // `probation` is written after the object is made, and only with the experimental `probation` and `--block`.
    expect(jsonKeys(rs, 'let out = json!({\n            "written"')).toEqual(Object.keys(result).filter((k) => k !== "probation").sort());
    expect(jsonKeys(rs, 'out["probation"] = json!({')).toEqual(Object.keys(result.probation).sort());
    expect(jsonKeys(rs.slice(rs.indexOf("fn json(&self) -> Value")), "fn json(&self) -> Value")).toEqual(Object.keys(result.replaces[0]!).sort());
    expect(jsonKeys(rs, 'json!({ "id": self.id').length).toBe(3);
    expect(jsonKeys(rs.slice(rs.indexOf("fn list_of(")), 'let mut out = json!({\n            "candidates"')).toEqual(["candidates", "declined", "passive", "promoted"]);
    expect(jsonKeys(rs.slice(rs.indexOf("fn list_of(")), "let entry = |r: &RankedCandidate|")).toEqual(["candidate", "command", "departures", "place"]);
    // The command line's own refusal codes (`usage(json, "<code>", ...)`) and the block gate's.
    const usage = [...new Set([...rs.matchAll(/(?:usage\(\s*args\.json,|return Err\(\()\s*"(\w+)"/g)].map((m) => m[1]))].sort();
    const typed: PromoteUsageRefusal["code"][] = ["block_forced", "covered", "no_concern", "no_policy", "no_variant"];
    expect(usage).toEqual(typed.sort());
    expect(rs).toContain('"refused": { "code": "block_refused", "id": c.id, "replay": replay }');
    const blockRefused: Extract<PromoteUsageRefusal, { code: "block_refused" }> = { code: "block_refused", id: "", replay: null };
    expect(Object.keys(blockRefused).sort()).toEqual(["code", "id", "replay"]);
    // The funnel: every key why_json writes, and the cap note census adds.
    const funnel = src("crates/drift-mine/src/funnel.rs");
    const why: Required<CensusWhy> = { schema: 1, observation_only: true, gate: null, reached: {}, gates: [], dropped: [], cap_note: null };
    expect([...jsonKeys(funnel.slice(funnel.indexOf("pub fn why_json(")), 'serde_json::json!({\n        "schema"'), "cap_note"].sort()).toEqual(Object.keys(why).sort());
    expect(src("crates/drift-cli/src/main.rs")).toContain('v["cap_note"] = serde_json::json!(cap_note);');
  });
});

describe("the dialog's choices and what it shows of an answer", () => {
  const concern = { id: "authn", variants: [
    { id: "P-0f0acb", kind: "known", label: "wrap withAuth", mechanisms: ["wrap"] },
    { id: "P-111111", kind: "known", label: "decorator Guard", mechanisms: ["decorator"] },
    { id: "P-222222", kind: "none", label: "no guard", mechanisms: [] },
  ] } as unknown as PracticeConcern;

  it("opens on a variant in its place, or on a candidate's own form and place", () => {
    expect(choiceFromVariant(concern, { id: "P-0f0acb" }, "apps/web:/api")).toMatchObject({ ways: ["P-0f0acb"], place: { kind: "route", path: "apps/web", prefix: "/api" } });
    const list = json<PromoteList>("acme/promote-list.json");
    const item = list.candidates[0]!;
    expect(requestOf(choiceFromCandidate(item))!.place).toBe(item.place);
  });

  it("offers the mechanisms the map's known ways use, and the ways Drift counted in the place", () => {
    expect(mechanismOptions(concern, [])).toEqual(["decorator", "wrap"]);
    expect(mechanismOptions(null, ["x"])).toEqual(["x"]);
    expect(toggleMechanism(["wrap"], "decorator", true)).toEqual(["decorator", "wrap"]);
    expect(wayOptions(null, concern, ["P-0f0acb"]).map((w) => w.id)).toEqual(["P-0f0acb", "P-111111"]);
    const res = { candidate: { ways: [{ id: "P-0f0acb", label: "wrap withAuth", members: 3 }], other_ways: [{ id: "P-111111", label: "decorator Guard", members: 9 }] } } as unknown as PromoteResult;
    expect(wayOptions(res, concern, ["P-0f0acb", "P-333333"], { "P-333333": "body call x" })).toEqual([
      { id: "P-111111", label: "decorator Guard", members: 9 },
      { id: "P-0f0acb", label: "wrap withAuth", members: 3 },
      { id: "P-333333", label: "body call x", members: null },
    ]);
  });

  it("offers block only where the replay can run, and --force only where Drift refused below the share, saying what it overrides", () => {
    const small = { candidate: { follows: 9, exceptions: [], unit: "entry_point" } } as unknown as PromoteResult;
    expect(blockOffer(base, small)).toEqual({ can: false, why: "It cannot block: blocking needs a replay of the 15 entry points added here most recently, and Drift can read only 9 here." });
    expect(blockOffer({ ...base, force: true }, null)).toEqual({ can: false, why: BLOCK_FORCED });
    expect(blockOffer(base, null)).toEqual({ can: true, why: null });
    const below: PromoteRefused = { refused: { code: "below_share", place: "apps/web", follows: 36, read: 63 }, message: "x" };
    expect(forceOffer(below)).toEqual({ place: "apps/web", follows: 36, read: 63 });
    expect(forceOffer({ refused: { code: "too_unknown", place: "x", unknown: 9, total: 20 }, message: "x" })).toBeNull();
    expect(forceOffer(null)).toBeNull();
    expect(forceText(forceOffer(below)!, "symbol")).toBe("In apps/web, 36 of the 63 symbols Drift could read do it the accepted ways (57%), below the 80% a practice needs. Promoting on your word overrides that: it advises only, and never blocks.");
    expect(refusedReplay({ refused: { code: "block_refused", id: "D-000001", replay: { recent: 15, followed: 9 } }, message: "" } as PromoteRefused)).toEqual({ recent: 15, followed: 9 });
    expect(refusedReplay({ refused: { code: "block_refused", id: "D-000001", replay: null }, message: "" } as PromoteRefused)).toBeNull();
  });

  it("shows what a promotion replaces and the replay, as Drift answered them", () => {
    const runs = json<{ runs: RecordedRun[] }>("acme/promote-runs.json").runs;
    const replacing = runs.map((r) => r.out as PromoteResult).find((o) => !("refused" in o) && "replaces" in o && (o.replaces ?? []).length > 0);
    expect(replacing, "a recorded promotion that replaces another form").toBeTruthy();
    const text = replacesText(replacing!);
    expect(text[0]).toMatch(/^Would replace D-[0-9a-f]{6} \(.+\), the practice of another form in the same place: two in one place would report the same units\./);
    expect(cli()).toContain('"This {verb} {} ({}), the practice of another form in the same place: two in one place would report the same units."');
    const html = renderToStaticMarkup(createElement(PromoteAnswer, { res: replacing! }));
    expect(html).toContain(replacing!.replaces![0]!.id);
    expect(html).toContain("pr-promote__replaces");
    const blocking = runs.map((r) => r.out as PromoteResult).find((o) => !("refused" in o) && "replay" in o && o.replay);
    expect(renderToStaticMarkup(createElement(PromoteAnswer, { res: blocking! }))).toMatch(/Of the 15 entry points most recently added here, 1[45] follow it as they stand\./);
  });
});

describe("fixture mode: the runs the real binary answered", () => {
  const runs = json<{ runs: RecordedRun[] }>("acme/promote-runs.json").runs;
  it("holds every list candidate's dry run, a write and what Drift says after it (the list, a replacement, an overlap refused)", () => {
    const list = json<PromoteList>("acme/promote-list.json");
    for (const item of [...list.candidates, ...(list.passive ?? [])]) {
      const out = recordedRun(runs, [], promoteFlags(requestOf(choiceFromCandidate(item))!, true)) as PromoteResult | null;
      expect(out, item.command).not.toBeNull();
      expect(isRefused(out!)).toBe(false);
    }
    const write = runs.find((r) => r.after.length === 0 && !r.args.includes("--dry-run"))!;
    expect(write.args.at(-1)).toBe("--json");
    expect(recordedRun(runs, [write.args], ["--list", "--json"])).not.toBeNull();
    const after = runs.filter((r) => r.after.length === 1);
    expect(after.some((r) => !isRefused(r.out as PromoteResult) && ((r.out as PromoteResult).replaces ?? []).length > 0)).toBe(true);
    expect(after.some((r) => isRefused(r.out as PromoteRefused) && (r.out as PromoteRefused).refused.code === "covered")).toBe(true);
    // Refusals of every kind fixture mode can show, as Drift worded them.
    const codes = new Set(runs.filter((r) => isRefused(r.out as PromoteRefused)).map((r) => (r.out as PromoteRefused).refused.code));
    for (const c of ["below_share", "too_small", "too_unknown", "not_a_way", "no_enforcing", "other_concern", "block_forced", "covered"]) expect(codes.has(c), c).toBe(true);
    // Each was run with the argv the Studio builds: a request read back from it gives the same argv.
    for (const r of runs.filter((x) => x.args[0] !== "--list")) {
      expect(r.args.at(-1)).toBe("--json");
      expect(r.exit === 0 || r.exit === 2).toBe(true);
    }
  });
});

describe("fixture mode serves those runs, before and after a write in the tab", () => {
  it("answers a recorded form as Drift did, writes it, then serves the list, a replacement and an overlap as Drift answered them after that write", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      try {
        return new Response(text(String(u).replace(/^\//, "")), { status: 200, headers: { "content-type": "text/plain" } });
      } catch {
        return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
      }
    }) as typeof fetch;
    try {
      const api = new FixtureApi("/", 0);
      const repo = { path: "/work/acme", name: "acme" };
      const at = (id: string | undefined, place: string, x: Partial<PromoteRequestT> = {}): PromoteRequestT => ({ ...(id ? { id } : {}), concern: "authn", place, with: [], block: false, ...x });
      // Before: recorded answers of every kind.
      const below = (await api.promotePreview(repo, at("P-9ece30", "apps/api"))) as PromoteRefused;
      expect(below.refused.code).toBe("below_share");
      expect(forceOffer(below)).toEqual({ place: "apps/api", follows: 0, read: 49 });
      expect(isRefused(await api.promotePreview(repo, at("P-9ece30", "apps/api", { force: true })))).toBe(false);
      const route = (await api.promotePreview(repo, at("P-9ece30", "apps/web:/api", { block: true }))) as PromoteResult;
      expect(route.replay).toMatchObject({ recent: 15, followed: 14 });
      expect(((await api.promotePreview(repo, at(undefined, "apps/web", { any_enforcing: true }))) as PromoteResult).replaces).toEqual([]);
      // A form fixture mode has no answer for, of an id the map does not hold: said so, not made up.
      expect(((await api.promotePreview(repo, at(undefined, "apps/web", { mechanisms: ["opens", "wrap"] }))) as PromoteRefused).refused.code).toBe("not_recorded");
      // The write.
      const out = (await api.promote(repo, at("P-9ece30", "apps/web"))) as PromoteResult;
      expect(out.written).toBe(true);
      expect(out.convention.id).toBe("D-234880");
      // After it: Drift's list, the form that replaces it, and the overlap it refuses.
      const listed = (await api.promoteList(repo)).data;
      expect(listed.promoted).toEqual(["D-234880"]);
      expect(listed.candidates.map((x) => x.command)).not.toContain("drift practices promote P-9ece30 --in apps/web");
      const replacing = (await api.promotePreview(repo, at(undefined, "apps/web", { any_enforcing: true }))) as PromoteResult;
      expect(replacing.replaces?.map((r) => r.id)).toEqual(["D-234880"]);
      const covered = (await api.promotePreview(repo, at("P-9ece30", "apps/web:/api"))) as PromoteRefused;
      expect(covered.refused.code).toBe("covered");
      expect(covered.message).toContain("D-234880 already holds sign-in to a practice in a place that overlaps apps/web:/api");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

