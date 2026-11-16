// S16: what the new views render from Drift's JSON, from props only: a convention proposed from the map, the
// practices that may be promoted (named ways, a mechanism whole, any enforcing way, passive apart, not checked, the
// shared unknown cause) and what mining dropped, gate by gate.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FromMapBadge, FromMapNote, fromMapText } from "@/features/conventions";
import { CandidateList, acceptsText, candidateKind, causeReason, commandShown, jobsLine, notCheckedLine, refusalCause, splitPassive, unknownCauseText } from "@/features/practices";
import { Funnel, droppedFacts, fromStudy, originKind, originText, selectedGate, splitGates, stageRows, targetText } from "@/features/funnel";
import type { CensusWhy, PromoteList, PromoteListItem } from "@/shared/contract/drift";
import { readCensusWhy, readPromoteList } from "@/shared/contract/read";
import { json } from "./helpers";

/** The text a person reads: tags dropped, entities decoded, spaces collapsed. */
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

const list = (): PromoteList => readPromoteList(json("acme/promote-list.json"));
const funnel = (): CensusWhy => readCensusWhy(json("acme/funnel.json"));
const TITLES: Record<string, string> = { authn: "Authentication", errors: "Error handling", data_access: "Data access", api: "API design", validation: "Input validation" };
const titleOf = (id: string) => TITLES[id] ?? id;

describe("a convention proposed from Drift's map of the code", () => {
  it("says in one sentence where it comes from and that it did not pass through the miner's measured gates", () => {
    expect(fromMapText("layering")).toBe("Proposed from Drift's map of the code (the layers of the structure map), not mined: it did not pass through the miner's measured gates.");
    expect(fromMapText("manifest")).toContain("(the package manifests)");
    expect(fromMapText("practice")).toContain("(the practice map)");
    const note = renderToStaticMarkup(createElement(FromMapNote, { fromMap: "layering" }));
    expect(note).toContain('role="note"');
    expect(plain(note)).toBe(fromMapText("layering"));
    const badge = renderToStaticMarkup(createElement(FromMapBadge, { fromMap: "layering" }));
    expect(plain(badge)).toBe("from the map · layering");
    expect(badge).toContain("cv-frommap");
  });
});

describe("the practices that may be promoted", () => {
  // acme's list as the real binary printed it names ways only; a mechanism and any enforcing way are worded from the
  // same candidate with Drift's fields for those forms set (promote.rs `Candidate`), not from a hand-written fixture.
  const first = () => list().candidates[0]!;
  const mechanism = (): PromoteListItem => ({ ...first(), command: "drift practices promote --concern authn --in apps/web --mechanism wrap", candidate: { ...first().candidate, ways: [], mechanisms: ["wrap"] } });
  const enforcing = (): PromoteListItem => ({ ...first(), command: "drift practices promote --concern authn --in 'apps/web/app/api/workspaces/[id]' --any-enforcing", candidate: { ...first().candidate, ways: [], any_enforcing: true } });

  it("words each kind of candidate on its own", () => {
    const xs = list().candidates;
    expect(candidateKind(xs[1]!.candidate)).toBe("ways");
    expect(acceptsText(xs[1]!.candidate)).toBe("Accepts decorator AuthGuard.");
    expect(candidateKind(mechanism().candidate)).toBe("mechanism");
    expect(acceptsText(mechanism().candidate)).toBe("Accepts mechanism wrap whole: any entry point here that does it by wrap follows, whichever instrument it names.");
    expect(candidateKind(enforcing().candidate)).toBe("enforcing");
    expect(acceptsText(enforcing().candidate)).toMatch(/^Accepts any way that enforces it: any entry point here that enforces it follows, however it does\. A way that opens a route on purpose is accepted only when a person names it\.$/);
  });

  it("calls what Drift could not read not checked, never a departure, and names the shared cause with its config line", () => {
    const c = first().candidate;
    expect(notCheckedLine(c)).toBe("18 entry points not checked: Drift could not read them, so they are never reported.");
    expect(notCheckedLine({ unit: "entry_point", unknown: 0 })).toBe("Drift could read every entry point here.");
    expect(notCheckedLine({ unit: "entry_point", unknown: 1 })).toBe("1 entry point not checked: Drift could not read it, so it is never reported.");
    const cause = unknownCauseText(c.unknown_cause!);
    expect(cause.what).toBe(`All 18 not checked share one cause outside them: ${causeReason("unresolved")} (apps/web/lib/actions/safe-action.ts#authActionClient.inputSchema().action).`);
    expect(cause.after).toBe("This line in .drift/config.yaml would let Drift read it:");
    expect(cause.hint).toBe('practices: {authn: {"apps/web/lib/actions/safe-action.ts#authActionClient.inputSchema().action": "authActionClient.inputSchema().action"}}');
    expect(unknownCauseText({ reason: "opaque_wrapper", instrument: "withX", units: 3 })).toEqual({ what: "All 3 not checked share one cause outside them: a wrapper Drift cannot see into (withX).", hint: null, after: "No .drift/config.yaml line names it: once Drift reads that call, they can be told." });
    expect(causeReason("dynamic")).toBe("code Drift could not read");
    expect(jobsLine({ jobs: 3 })).toBe("3 background jobs not counted: they take no request.");
    expect(jobsLine({ jobs: 1 })).toBe("1 background job not counted: it takes no request.");
    expect(jobsLine({})).toBeNull();
  });

  it("reads the cause a refusal for unread units names, and nothing from another refusal or an older Drift", () => {
    const cause = { reason: "unresolved" as const, instrument: "requireUser", units: 9, hint: "x" };
    expect(refusalCause({ code: "too_unknown", place: "app", unknown: 9, total: 20, cause })).toEqual(cause);
    expect(refusalCause({ code: "too_unknown", place: "app", unknown: 9, total: 20 })).toBeNull();
    expect(refusalCause({ code: "too_small", place: "app", units: 3, min: 8 })).toBeNull();
    expect(refusalCause({ code: "no_enforcing", concern: "logging" })).toBeNull();
  });

  it("shows the command Drift prints, and none where an older Drift printed one with no id", () => {
    const xs = list().candidates;
    expect(commandShown(xs[1]!)).toBe("drift practices promote P-5c347c --in apps/api");
    // A candidate of no named way: `--concern` in place of a variant id (drift-cli promote.rs `command`).
    expect(commandShown(enforcing())).toBe("drift practices promote --concern authn --in 'apps/web/app/api/workspaces/[id]' --any-enforcing");
    expect(commandShown(mechanism())).toBe("drift practices promote --concern authn --in apps/web --mechanism wrap");
    expect(commandShown({ command: "drift practices promote  --in apps/web" })).toBeNull();
    expect(commandShown({ command: "" })).toBeNull();
  });

  it("lists passive candidates apart and after the others, and says so", () => {
    const { active, passive } = splitPassive(list().candidates);
    expect(passive.map((x) => `${x.candidate.concern} ${x.place}`)).toEqual(["errors apps/web", "errors apps/api"]);
    expect(active).toHaveLength(6);
    const html = renderToStaticMarkup(createElement(CandidateList, { list: list(), pkg: null, titleOf }));
    const text = plain(html);
    expect(html.indexOf('data-testid="candidates-active"')).toBeLessThan(html.indexOf('data-testid="candidates-passive"'));
    expect(text.indexOf("Error handling in apps/api")).toBeGreaterThan(text.indexOf("Followed by doing nothing"));
    expect(text.indexOf("Authentication in apps/api")).toBeLessThan(text.indexOf("Followed by doing nothing"));
    expect(text).toContain("47 of the 49 entry points in apps/api follow it.");
    expect(text).toContain("18 entry points not checked");
    expect(text).toContain("drift practices promote P-9ece30 --in apps/web");
    expect(text).not.toContain("prints no command for this one");
    expect(text).not.toContain("declined earlier in drift review");
    const declined = plain(renderToStaticMarkup(createElement(CandidateList, { list: { ...list(), declined: 1 }, pkg: null, titleOf })));
    expect(declined).toContain("1 declined earlier in drift review");
    expect(html.match(/data-kind="ways"/g)).toHaveLength(8);
    const kinds = renderToStaticMarkup(createElement(CandidateList, { list: { ...list(), candidates: [mechanism(), enforcing()] }, pkg: null, titleOf }));
    expect(kinds.match(/data-kind="mechanism"/g)).toHaveLength(1);
    expect(kinds.match(/data-kind="enforcing"/g)).toHaveLength(1);
    // No button without onPromote (the tab passes it); opening an example needs onOpen.
    expect(html).not.toContain("<button");
  });

  it("offers each candidate Drift printed a command for to the promote dialog, a passive one too, and none printed with no id", () => {
    const onPromote = () => {};
    const html = renderToStaticMarkup(createElement(CandidateList, { list: list(), pkg: null, titleOf, onPromote }));
    expect(html.match(/class="[^"]*pr-cand__action[^"]*"/g)).toHaveLength(8);
    expect(html).toContain('aria-label="Promote… Authentication in apps/web"');
    const old = renderToStaticMarkup(createElement(CandidateList, { list: { ...list(), candidates: [{ ...first(), command: "drift practices promote  --in apps/web" }] }, pkg: null, titleOf, onPromote }));
    expect(old).not.toContain("pr-cand__action");
  });

  it("narrows to one package, says when nothing may be promoted, and never puts a passive one first", () => {
    const api = plain(renderToStaticMarkup(createElement(CandidateList, { list: list(), pkg: "apps/api", titleOf })));
    expect(api).toContain("Authentication in apps/api");
    expect(api).not.toContain("apps/web");
    const onlyPassive = { ...list(), candidates: list().candidates.filter((x) => x.candidate.passive) };
    const p = plain(renderToStaticMarkup(createElement(CandidateList, { list: onlyPassive, pkg: null, titleOf })));
    expect(p.indexOf("No candidate that holds code to more than doing nothing.")).toBeLessThan(p.indexOf("Error handling in apps/api"));
    const none = plain(renderToStaticMarkup(createElement(CandidateList, { list: { candidates: [], declined: 0, promoted: ["D-111111"] }, pkg: null, titleOf })));
    expect(none).toContain("No practice may be promoted now");
    expect(none).toContain("Already promoted, not listed again: D-111111.");
    expect(plain(renderToStaticMarkup(createElement(CandidateList, { list: { candidates: [], declined: 0, promoted: [] }, pkg: "packages/db", titleOf })))).toContain("No practice may be promoted in packages/db now");
  });
});

describe("what mining dropped (the Funnel view)", () => {
  it("says where each gate's threshold comes from, and whether that is the study", () => {
    expect(originKind("study")).toBe("study");
    expect(fromStudy("study")).toBe(true);
    expect(fromStudy("pre-registered")).toBe(true);
    expect(fromStudy("engineering, no study")).toBe(false);
    expect(fromStudy("engineering, rationale written but not measured")).toBe(false);
    expect(originText("engineering, rationale written but not measured")).toBe("engineering choice, reason written down but not measured");
    expect(originText("a hunch")).toBe("not from a study: a hunch");
    expect(fromStudy("a hunch")).toBe(false);
    expect(targetText("built_in")).toBe("target is a built-in");
    expect(targetText("none")).toBe("");
    const d = funnel().dropped.find((x) => x.id === "D-a85cd1")!;
    expect(droppedFacts(d)).toEqual(["lower bound 0.63 under 0.75", "target defined in the repository", "default tier"]);
    expect(droppedFacts({ ...d, lang: "py", default_tier: false, target: "none", detail: "" })).toEqual(["Python"]);
  });

  it("orders stages and gates as Drift does, and selects the gate asked for or the first that dropped", () => {
    const doc = funnel();
    expect(stageRows(doc).map((s) => `${s.n} ${s.label}`)).toEqual(["368 roles", "48 roles with enough members to mine", "321 candidate rules observed", "45 drafted", "14 mined", "12 proposed"]);
    expect(stageRows({ reached: {} })).toEqual([]);
    expect(splitGates(doc.gates).dropping.map((g) => g.name)).toEqual(["universal", "wilson", "lift", "mandated", "tautology", "call_family_hidden", "duplicate", "not_admitted"]);
    expect(splitGates(doc.gates).quiet).toHaveLength(24);
    expect(selectedGate(doc, null)?.name).toBe("universal");
    expect(selectedGate(doc, "lift")?.name).toBe("lift");
    expect(selectedGate(doc, "no_such_gate")?.name).toBe("universal");
    expect(selectedGate({ gates: [] }, "lift")).toBeNull();
  });

  it("renders the stages, the gates with their origin, and the selected gate's dropped candidates", () => {
    const html = renderToStaticMarkup(createElement(Funnel, { doc: funnel(), gate: "wilson" }));
    const text = plain(html);
    expect(text).toContain("Observation only: nothing listed here is proposed, checked or shown to agents, and the proposals are exactly those of drift census.");
    expect(text).toContain("368 roles");
    expect(text).toContain("Dropped at wilson (274)");
    expect(text).toContain("12 of 13 apps/web: components in components/**: call useState()");
    expect(text).toContain("70 of 97 apps/web: HTTP handlers in app/** (route files): are wrapped in withWorkspace()");
    expect(text).not.toContain("holds for all 74 of 74");
    expect(text).toContain("MIN_LOWER_BOUND = 0.75");
    expect(text).toContain("not from the study");
    expect(text).toContain("Gates that dropped nothing (24)");
    expect(html.match(/class="is-selected" data-gate="wilson"/g)).toHaveLength(1);
    expect(html.match(/class="is-selected"/g)).toHaveLength(1);
    // Without a handler (a static render) the gates are names, not buttons.
    expect(html).not.toContain("<button");
  });

  it("says when mining dropped nothing, and when this drift counted no stage", () => {
    const quiet = readCensusWhy(json("quiet/funnel.json"));
    const text = plain(renderToStaticMarkup(createElement(Funnel, { doc: quiet, gate: null })));
    expect(text).toContain("No candidate was dropped");
    expect(text).toContain("Gates that dropped nothing (32)");
    const bare = plain(renderToStaticMarkup(createElement(Funnel, { doc: { ...quiet, reached: {} }, gate: null })));
    expect(bare).toContain("This drift did not count how far candidates got.");
  });
});
