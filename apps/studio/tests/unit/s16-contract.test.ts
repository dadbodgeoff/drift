// S16: the new fields of the contract, each read with and without it (an older Drift does not send it), and the
// two read-only channels: `drift census --why --json` (the funnel) and `drift practices promote --list --json`.
import { describe, expect, it } from "vitest";
import { acceptableExit, driftArgs, writesRepository } from "../../electron/ops";
import { NO_FUNNEL, NO_PROMOTE_LIST } from "../../electron/handlers";
import { checkFunnel, SchemaError } from "@/entities/drift";
import { conventionRows, fromMapOf, hasFromMap, hiddenByShowPolicy, mechanismWords, parseConventions, passesSource, practiceText, ruleTargets } from "@/entities/convention";
import { FixtureApi } from "@/shared/api/fixture";
import type { Census, CensusProposal, CheckReport, PracticesReport, Rule } from "@/shared/contract/drift";
import { readCandidate, readCensusWhy, readPromoteList, readUnknownCause } from "@/shared/contract/read";
import { COMMANDS } from "@/shared/contract/coverage";
import { CHANNELS, FunnelEnvelope, PromoteListEnvelope, channels } from "@/shared/ipc/contract";
import { CHANNEL_NAMES } from "@/shared/ipc/names";
import { fixtureListOpen, fixturePromote, isRefused } from "@/shared/lib/promote";
import { census, check, json, text } from "./helpers";

const FROM_MAP_YAML = `
- id: D-5e0a71
  status: proposed
  mode: advise
  summary: Code in packages/ui never imports apps/api (61 files, none do)
  role:
    package: packages/ui
    dir: "**"
    file: "*"
    entry: '-'
    kind: module
  rule:
    type: avoids
    signal: import:apps/api
  evidence:
    holders: 61
    total: 61
    lower_bound: 0.941
    lift: 0.0
  example: packages/ui/src/alert.tsx#(file)
  selector_version: 3
  from_map: layering
`;

/** acme's conventions.yaml with one proposal from Drift's structure map appended, as Drift writes it (policy.rs `from_map`). */
const withFromMap = () => text("acme/conventions.yaml").trimEnd() + FROM_MAP_YAML;

describe("Convention.from_map (policy.rs): a proposal from Drift's map of the code", () => {
  it("is kept when it is one of Drift's three maps, and absent otherwise", () => {
    const c = parseConventions(withFromMap()).conventions.find((x) => x.id === "D-5e0a71")!;
    expect(c.from_map).toBe("layering");
    // Every convention acme had before: none carries it.
    expect(parseConventions(text("acme/conventions.yaml")).conventions.every((x) => !("from_map" in x))).toBe(true);
    for (const v of ["practice", "layering", "manifest"] as const) expect(fromMapOf(v)).toBe(v);
    for (const v of ["mined", "", 1, null, undefined, "LAYERING"]) expect(fromMapOf(v)).toBeNull();
    const odd = parseConventions(withFromMap().replace("from_map: layering", "from_map: telepathy")).conventions.find((x) => x.id === "D-5e0a71")!;
    expect("from_map" in odd).toBe(false);
  });

  it("gives the row its source, from the policy or from census, and the show policy never hides it", () => {
    const policy = parseConventions(withFromMap());
    const rows = conventionRows(policy, census(), check());
    const row = rows.find((r) => r.id === "D-5e0a71");
    // check.json predates the proposal: without the exemption the show policy would drop it as a card nobody shows.
    expect(row?.fromMap).toBe("layering");
    expect(hiddenByShowPolicy(policy.conventions.find((x) => x.id === "D-5e0a71")!, census(), check())).toBe(false);
    expect(rows.filter((r) => r.id !== "D-5e0a71").every((r) => r.fromMap === null)).toBe(true);
    // A census proposal from the map, not yet in the policy (newer drift): its row says so too.
    const c = census();
    const p: CensusProposal = { ...c.proposals[0]!, id: "D-0a0a0a", from_map: "manifest" };
    const fromCensus = conventionRows(null, { ...c, proposals: [...c.proposals, p] }).find((r) => r.id === "D-0a0a0a");
    expect(fromCensus?.fromMap).toBe("manifest");
    expect(conventionRows(null, c).every((r) => r.fromMap === null)).toBe(true);
  });

  it("filters mined from from-the-map rows, and offers the filter only when there is one", () => {
    const rows = conventionRows(parseConventions(withFromMap()), census(), check());
    expect(rows.filter((r) => passesSource(r, "map")).map((r) => r.id)).toEqual(["D-5e0a71"]);
    expect(rows.filter((r) => passesSource(r, "mined")).length).toBe(rows.length - 1);
    expect(rows.filter((r) => passesSource(r, "all")).length).toBe(rows.length);
    expect(hasFromMap(rows)).toBe(true);
    expect(hasFromMap(conventionRows(parseConventions(text("acme/conventions.yaml")), census(), check()))).toBe(false);
  });
});

describe("Rule::Practice any_mechanism and any_enforcing (mine.rs)", () => {
  const base: Extract<Rule, { type: "practice" }> = { type: "practice", concern: "authn", any_of: ["wrap:lib/auth.ts#withAuth"] };

  it("reads a rule of named ways as before when neither field is there", () => {
    expect(practiceText(base)).toBe("authn done one of 1 accepted way");
    expect(practiceText({ ...base, any_of: ["a", "b"] })).toBe("authn done one of 2 accepted ways");
    expect(practiceText({ ...base, any_of: [] })).toBe("authn done one of 0 accepted ways");
    expect(practiceText({ type: "has_test" })).toBeNull();
  });

  it("says a mechanism accepted whole, and any way that enforces it, in plain words", () => {
    expect(practiceText({ ...base, any_of: [], any_mechanism: ["role_guard"] })).toBe("authn done by mechanism role guard, whichever instrument it names");
    expect(practiceText({ ...base, any_of: [], any_mechanism: ["decorator", "wrap"] })).toBe("authn done by mechanism decorator or wrap, whichever instrument it names");
    expect(practiceText({ ...base, any_of: [], any_enforcing: true })).toBe("authn done any way that enforces it");
    expect(practiceText({ ...base, any_mechanism: ["wrap"], any_enforcing: true })).toBe("authn done one of 1 accepted way, or by mechanism wrap, whichever instrument it names, or any way that enforces it");
    // Absent when not set, as Drift omits it: `false` and `[]` read as absent.
    expect(practiceText({ ...base, any_mechanism: [], any_enforcing: false })).toBe("authn done one of 1 accepted way");
    expect(mechanismWords("tenancy_filter")).toBe("tenancy filter");
    const rule: Rule = { ...base, any_of: [], any_enforcing: true };
    expect(ruleTargets(rule)).toEqual(["authn done any way that enforces it"]);
  });
});

describe("drift practices promote --list --json (promote.rs Candidate)", () => {
  const raw = json<unknown>("acme/promote-list.json");
  const list = readPromoteList(raw);

  it("reads every candidate of the fixture, in Drift's order, with the fields a newer Drift adds", () => {
    expect(PromoteListEnvelope.safeParse(raw).success).toBe(true);
    expect(list.candidates.map((x) => `${x.candidate.concern} ${x.place}`)).toEqual([
      "authn apps/api",
      "authn apps/web/app/api/admin",
      "authn apps/web/app/api/workspaces/[id]",
      "authn apps/web/lib/actions",
      "authn apps/web/lib/actions",
      "errors apps/api",
      "data_access apps/web",
    ]);
    const [api, , ws, , mech, errors, data] = list.candidates.map((x) => x.candidate);
    expect(api!.jobs).toBe(3);
    expect(ws!.any_enforcing).toBe(true);
    expect(ws!.ways).toEqual([]);
    expect(mech!.mechanisms).toEqual(["wrap"]);
    expect(errors!.passive).toBe(true);
    expect(data!.unknown_cause).toEqual({ reason: "body_unreadable", instrument: "pkg:@acme/edge-db#connect", units: 2, hint: 'practices: {data_access: {"pkg:@acme/edge-db#connect": "connect"}}' });
    expect(list.declined).toBe(1);
    expect(list.promoted).toEqual([]);
    // total = follows + exceptions + unknown, as Drift counts it.
    for (const { candidate: c } of list.candidates) expect(c.total).toBe(c.follows + c.exceptions.length + c.unknown);
  });

  it("reads a candidate from an older Drift without any of the new fields, and leaves them absent", () => {
    const old = { concern: "authn", unit: "entry_point", place: { package: "", dir: "app/api" }, ways: [{ id: "P-0f0acb", key: "wrap:lib/auth.ts#withAuth", label: "wrap withAuth", members: 38 }], other_ways: [], follows: 38, exceptions: [{ path: "app/api/r38/route.ts", symbol: "GET", line: 1 }], unknown: 0, total: 39, example: null, forced: false };
    const c = readCandidate(old)!;
    expect(c).toEqual(old);
    for (const k of ["mechanisms", "any_enforcing", "passive", "jobs", "unknown_cause"]) expect(k in c, k).toBe(false);
    // Drift omits each when unset; a zero, false or empty value reads as absent too.
    const unset = readCandidate({ ...old, mechanisms: [], any_enforcing: false, passive: false, jobs: 0 })!;
    for (const k of ["mechanisms", "any_enforcing", "passive", "jobs"]) expect(k in unset, k).toBe(false);
    // Each field on its own.
    expect(readCandidate({ ...old, mechanisms: ["wrap", 3] })!.mechanisms).toEqual(["wrap"]);
    expect(readCandidate({ ...old, any_enforcing: true })!.any_enforcing).toBe(true);
    expect(readCandidate({ ...old, passive: true })!.passive).toBe(true);
    expect(readCandidate({ ...old, jobs: 4 })!.jobs).toBe(4);
    expect(readCandidate({ ...old, unknown_cause: { reason: "unparsed", instrument: "lib/x.ts", units: 2 } })!.unknown_cause).toEqual({ reason: "unparsed", instrument: "lib/x.ts", units: 2 });
    expect("unknown_cause" in readCandidate({ ...old, unknown_cause: { reason: "unparsed" } })!).toBe(false);
    expect(readUnknownCause({ reason: "opaque_wrapper", instrument: "withX", units: 1, hint: "practices: {authn: {\"withX\": \"withX\"}}" })?.hint).toContain("withX");
    expect(readUnknownCause(null)).toBeNull();
    // Not a candidate at all.
    expect(readCandidate({ concern: "authn" })).toBeNull();
    expect(readCandidate("x")).toBeNull();
    expect(readPromoteList({})).toEqual({ candidates: [], declined: 0, promoted: [] });
  });

  it("leaves out, in fixture mode, what this tab promoted, and names the convention that covers it", () => {
    expect(fixtureListOpen(list, [])).toEqual(list);
    const out = fixturePromote(json<PracticesReport>("acme/practices.json"), { id: "P-1587e5", place: "apps/web/app/api/admin", with: [], block: false }, true);
    if (isRefused(out)) throw new Error(out.message);
    const open = fixtureListOpen(list, [out.convention.id]);
    expect(open.candidates.map((x) => x.place)).not.toContain("apps/web/app/api/admin");
    expect(open.candidates).toHaveLength(list.candidates.length - 1);
    expect(open.promoted).toEqual([out.convention.id]);
  });
});

describe("drift census --why --json (funnel.rs why_json)", () => {
  const raw = json<unknown>("acme/funnel.json");
  const doc = readCensusWhy(raw);

  it("reads the stages, every gate in the order mining applies them, and the dropped candidates", () => {
    expect(FunnelEnvelope.safeParse(raw).success).toBe(true);
    expect(doc.schema).toBe(1);
    expect(doc.observation_only).toBe(true);
    expect(doc.gate).toBeNull();
    expect(doc.reached).toEqual({ roles: 42, role_mined: 17, observed: 214, drafted: 61, mined: 21, proposed: 14 });
    expect(doc.gates.map((g) => g.name).slice(0, 6)).toEqual(["indirect_base", "refines_base", "optional_key", "universal", "wilson", "lift"]);
    expect(doc.gates).toHaveLength(32);
    expect(doc.gates.find((g) => g.name === "python_family_hidden")!.origin).toBe("study");
    expect(doc.gates.find((g) => g.name === "wilson")!.origin).toBe("engineering, no study");
    // Each gate's count is how many rows it dropped.
    for (const g of doc.gates) expect(g.dropped, g.name).toBe(doc.dropped.filter((d) => d.gate === g.name).length);
    const w = doc.dropped.find((d) => d.id === "D-c4d7a9")!;
    expect(w).toMatchObject({ gate: "wilson", holders: 9, members: 10, value: 0.596, threshold: 0.75, target: "repository", default_tier: true, lang: "ts" });
    expect(checkFunnel(doc, null)).toBe(doc);
  });

  it("reads a document with stages missing, a gate asked for, and rows Drift would not write", () => {
    const partial = readCensusWhy({ schema: 1, observation_only: true, gate: "universal", reached: { roles: 3, observed: "x" }, gates: [{ name: "universal", dropped: 1 }, { dropped: 2 }], dropped: [{ gate: "universal", id: "D-000001", holders: 2, members: 2 }, { gate: "universal" }] });
    expect(partial.gate).toBe("universal");
    expect(partial.reached).toEqual({ roles: 3 });
    expect(partial.gates).toEqual([{ name: "universal", constant: "", passes: "", origin: "", source: "", dropped: 1 }]);
    expect(partial.dropped).toEqual([{ gate: "universal", id: "D-000001", role: "", rule: "", family: "", lang: "ts", holders: 2, members: 2, value: null, threshold: null, detail: "", target: "none", default_tier: false }]);
    // No counts at all (an empty `reached`, as funnel.rs writes when mining counted nothing).
    expect(readCensusWhy({ schema: 1, observation_only: true, gate: null, reached: {}, gates: [], dropped: [] }).reached).toEqual({});
    // Another schema, or none, is refused with the version message.
    expect(() => checkFunnel(readCensusWhy({ ...(raw as object), schema: 2 }), "drift 9.0.0")).toThrow(SchemaError);
    expect(() => checkFunnel(readCensusWhy(null), null)).toThrow(/census --why schema 1/);
  });
});

describe("the two read-only channels", () => {
  it("run fixed argv, write nothing, and accept only exit 0", () => {
    expect(driftArgs("/r", { op: "funnel" })).toEqual(["--root", "/r", "census", "--why", "--json"]);
    expect(driftArgs("/r", { op: "promoteList" })).toEqual(["--root", "/r", "practices", "promote", "--list", "--json"]);
    expect(writesRepository("funnel")).toBe(false);
    expect(writesRepository("promoteList")).toBe(false);
    for (const op of ["funnel", "promoteList"] as const) {
      expect(acceptableExit(op, 0)).toBe(true);
      expect(acceptableExit(op, 1)).toBe(false);
      expect(acceptableExit(op, 2)).toBe(false);
    }
  });

  it("are named in the preload list and the schema table, take a repository only, and say when the binary is too old", () => {
    for (const c of ["funnel", "promoteList"] as const) {
      expect(CHANNEL_NAMES).toContain(c);
      expect(CHANNELS).toContain(c);
    }
    const repo = { path: "/r", name: "r" };
    expect(channels.funnel.req.safeParse([repo]).success).toBe(true);
    expect(channels.funnel.req.safeParse([repo, "wilson"]).success).toBe(false);
    expect(channels.promoteList.req.safeParse([repo]).success).toBe(true);
    const loaded = (data: unknown) => ({ data, at: 1, cached: false, provenance: { commit: null, branch: null, driftVersion: null } });
    expect(channels.funnel.res.safeParse(loaded(json("acme/funnel.json"))).success).toBe(true);
    expect(channels.funnel.res.safeParse(loaded({ schema: 1, gates: [] })).success).toBe(false);
    expect(channels.promoteList.res.safeParse(loaded(json("acme/promote-list.json"))).success).toBe(true);
    expect(channels.promoteList.res.safeParse(loaded({ candidates: [{ place: "x" }], declined: 0, promoted: [] })).success).toBe(false);
    expect(NO_FUNNEL).toContain("census --why");
    expect(NO_PROMOTE_LIST).toContain("practices promote --list");
    expect(JSON.stringify(COMMANDS.census)).toContain("census --why --json");
  });

  it("are served in fixture mode from funnel.json and promote-list.json, and fail as a run would where there is none", async () => {
    const api = new FixtureApi("/", 0);
    const files = new Map<string, string>([
      ["/index.json", text("index.json")],
      ["/acme/funnel.json", text("acme/funnel.json")],
      ["/acme/promote-list.json", text("acme/promote-list.json")],
      ["/quiet/funnel.json", text("quiet/funnel.json")],
    ]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(files.get(String(u)) ?? "", { status: files.has(String(u)) ? 200 : 404, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const acme = { path: "/work/acme", name: "acme" };
      expect(readCensusWhy((await api.funnel(acme)).data).dropped).toHaveLength(5);
      expect((await api.promoteList(acme)).data.candidates).toHaveLength(7);
      expect(readCensusWhy((await api.funnel({ path: "/work/quiet", name: "quiet" })).data).dropped).toEqual([]);
      await expect(api.funnel({ path: "/work/beacon", name: "beacon" })).rejects.toThrow("drift census --why failed: fixture mode has no funnel.json for beacon");
      await expect(api.promoteList({ path: "/work/quiet", name: "quiet" })).rejects.toThrow("drift practices promote --list failed");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("a check report and census as acme's fixtures have them", () => {
  it("still have no from_map anywhere (the fixtures predate it)", () => {
    const c: Census = census();
    const k: CheckReport = check();
    expect(c.proposals.some((p) => "from_map" in p)).toBe(false);
    expect(Array.isArray(k.conventions)).toBe(true);
  });
});
