// The one question a block candidate asks (round 11, WS-K): the plan an answer sends, the argv the main process
// builds for it (equal to the command the view shows), and the fixture questions read off a census.
import { describe, expect, it } from "vitest";
import { InvalidArgument, answerFlags, driftArgs } from "../../electron/ops";
import { QUESTION, answerPlan, authOrValidationKind, logCalibration, needsTick } from "@/entities/convention";
import type { ReviewQuestion, ReviewQuestions } from "@/shared/contract/drift";
import { channels } from "@/shared/ipc/contract";
import { FixtureApi } from "@/shared/api/fixture";
import { parseConventions } from "@/entities/convention";
import { json, text } from "./helpers";
import { answerCommand, answerFlags as shownFlags } from "@/shared/lib/review";

const q: Pick<ReviewQuestion, "flagged"> = {
  flagged: [
    { path: "app/api/health/route.ts", members: [{ symbol: "GET", line: 1, needs_confirmation: true, legacy: true }] },
    {
      path: "lib/seed.ts",
      members: [
        { symbol: "seed", line: 3, needs_confirmation: false, legacy: true },
        { symbol: "handler", line: 9, needs_confirmation: true, legacy: false },
      ],
    },
  ],
};

describe("an answer of \"No, these are different\"", () => {
  it("covers the files picked; an entry point only with its own tick [STRICT]", () => {
    expect(answerPlan(q, new Set(), new Set())).toEqual({ setApart: [], confirmEntry: [], kept: [], covered: 0 });
    // Picked without the tick: the entry point stays flagged, and a file that covers nothing is not sent.
    expect(answerPlan(q, new Set(["app/api/health/route.ts", "lib/seed.ts"]), new Set())).toEqual({
      setApart: ["lib/seed.ts"],
      confirmEntry: [],
      kept: ["app/api/health/route.ts#GET", "lib/seed.ts#handler"],
      covered: 1,
    });
    // A tick in a file not picked does nothing.
    expect(answerPlan(q, new Set(["lib/seed.ts"]), new Set(["app/api/health/route.ts#GET"])).confirmEntry).toEqual([]);
    expect(answerPlan(q, new Set(["app/api/health/route.ts"]), new Set(["app/api/health/route.ts#GET"]))).toEqual({
      setApart: ["app/api/health/route.ts"],
      confirmEntry: ["app/api/health/route.ts#GET"],
      kept: [],
      covered: 1,
    });
    expect(needsTick(q.flagged[1])).toEqual(["lib/seed.ts#handler"]);
  });

  it("runs the drift review command the view shows", () => {
    const cases: [Parameters<typeof answerFlags>[1], string[], string[]][] = [
      ["same", [], []],
      ["not-a-convention", [], []],
      ["different", ["lib/seed.ts"], []],
      ["different", ["a b/x.ts", "lib/seed.ts"], ["a b/x.ts#GET"]],
    ];
    for (const [a, files, confirm] of cases) {
      expect(answerFlags("D-abcdef", a, files, confirm)).toEqual(shownFlags("D-abcdef", a as never, files, confirm));
      expect(driftArgs("/r", { op: "answer", id: "D-abcdef", answer: a as never, setApart: files, confirmEntry: confirm })).toEqual(["--root", "/r", "review", ...shownFlags("D-abcdef", a as never, files, confirm)]);
    }
    expect(answerCommand("/r", "D-abcdef", "different", ["a b/x.ts"], ["a b/x.ts#GET"])).toBe('drift --root /r review --answer=D-abcdef=different "--set-apart=a b/x.ts" "--confirm-entry=a b/x.ts#GET"');
    expect(driftArgs("/r", { op: "questions" })).toEqual(["--root", "/r", "review", "--json"]);
  });

  it("refuses what Drift would refuse, before running it", () => {
    const bad: [string, unknown, unknown, unknown][] = [
      ["D-zzzzzz", "same", [], []],
      ["D-abcdef", "maybe", [], []],
      ["D-abcdef", "different", [], []],
      ["D-abcdef", "same", ["lib/seed.ts"], []],
      ["D-abcdef", "different", ["../x.ts"], []],
      ["D-abcdef", "different", ["/etc/passwd"], []],
      ["D-abcdef", "different", ["a#b.ts"], []],
      ["D-abcdef", "different", ["lib/seed.ts"], ["other.ts#GET"]],
      ["D-abcdef", "different", "lib/seed.ts", []],
    ];
    for (const [id, a, files, confirm] of bad) expect(() => answerFlags(id, a, files, confirm), JSON.stringify([id, a, files, confirm])).toThrow(InvalidArgument);
    const repo = { path: "/r", name: "r" };
    expect(channels.answer.req.safeParse([repo, "D-abcdef", "different", ["lib/seed.ts"], ["lib/seed.ts#x"]]).success).toBe(true);
    expect(channels.answer.req.safeParse([repo, "D-abcdef", "yes", [], []]).success).toBe(false);
    expect(channels.answer.req.safeParse([repo, "D-abcdef", "different", ["../x"], []]).success).toBe(false);
  });
});

describe("questions", () => {
  it("auth or validation by rule kind, every wrapper included; layering is not", () => {
    for (const k of ["wrapped_by:call", "wrapped_by:jsx", "calls", "passes_key", "control", "before", null]) expect(authOrValidationKind(k), String(k)).toBe(true);
    for (const k of ["avoids:import", "named", "has_test", "imports_from"]) expect(authOrValidationKind(k), k).toBe(false);
    expect(QUESTION).toBe("Are these the same kind of thing?");
  });

  it("in fixture mode are drift review --json's own output (F11): acme's one unanswered candidate, beacon's four before any answer", () => {
    const acme = json<ReviewQuestions>("acme/review-questions.json");
    expect(acme).toMatchObject({ schema: "drift-review-questions", schema_version: 1, question: QUESTION });
    expect(Object.keys(acme.answers)).toEqual(["same", "different", "not-a-convention"]);
    // Only the proposed default-tier card: accepted ones are no longer candidates, whatever census's record says.
    const conv = parseConventions(text("acme/conventions.yaml")).conventions;
    expect(acme.candidates.map((c) => conv.find((x) => x.id === c.id)?.status)).toEqual(["proposed"]);
    const [q] = acme.candidates;
    expect(q.auth_or_validation).toBe(true);
    expect(q.holders.length).toBeGreaterThanOrEqual(2);
    expect(q.flagged.flatMap((f) => f.members).every((m) => m.needs_confirmation)).toBe(true);
    const before = json<ReviewQuestions>("beacon/review-questions-before.json");
    expect(before.candidates.map((c) => c.rule_kind).sort()).toEqual(["avoids:import", "avoids:import", "avoids:import", "wrapped_by:call"]);
    // Layering flags no entry point; the route wrapper's outliers are entry points, each needing its own tick.
    for (const c of before.candidates) expect(c.flagged.flatMap((f) => f.members).every((m) => m.needs_confirmation === c.auth_or_validation), c.id).toBe(true);
    // Answered, a candidate is asked no more.
    expect(json<ReviewQuestions>("beacon/review-questions.json").candidates).toEqual([]);
  });
});

/** A fetch over the committed fixtures, for the fixture API. */
function serveFixtures(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    try {
      return new Response(text(String(u).replace(/^\//, "")), { status: 200, headers: { "content-type": "text/plain" } });
    } catch {
      return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
    }
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

describe("fixture mode", () => {
  it("asks what drift review --json asked, and applies an answer the way drift review writes it", async () => {
    const api = new FixtureApi("/", 0);
    const restore = serveFixtures();
    try {
      const repo = { path: "/work/acme", name: "acme" };
      const qs = await api.reviewQuestions(repo);
      expect(qs).toEqual(json("acme/review-questions.json"));
      const [q] = qs.candidates;
      const file = q.flagged[0];
      const entry = `${file.path}#${file.members[0].symbol}`;
      // Picked without the entry point's tick: the card is accepted, the file is not written (it covers nothing) [STRICT].
      const e = await api.answer(repo, q.id, "different", [file.path], []);
      expect(e).toMatchObject({ decision: "different", ok: true, command: `drift --root /work/acme review --answer=${q.id}=different --set-apart=${file.path}` });
      let c = parseConventions((await api.policy(repo)).conventions!).conventions.find((x) => x.id === q.id)!;
      expect(c.status).toBe("accepted");
      expect(c.different_kind).toBeUndefined();
      expect((await api.reviewQuestions(repo)).candidates).toEqual([]);
      // With the tick, in a fresh tab: written with the entry point confirmed.
      const api2 = new FixtureApi("/", 0);
      await api2.answer(repo, q.id, "different", [file.path], [entry]);
      c = parseConventions((await api2.policy(repo)).conventions!).conventions.find((x) => x.id === q.id)!;
      expect(c.different_kind).toEqual([{ path: file.path, entry_points: [file.members[0].symbol] }]);
      const api3 = new FixtureApi("/", 0);
      await api3.answer(repo, q.id, "not-a-convention", [], []);
      expect(parseConventions((await api3.policy(repo)).conventions!).conventions.find((x) => x.id === q.id)!.status).toBe("rejected");
      // "different" for a card that is not a candidate is refused, as Drift refuses it.
      await expect(api3.answer(repo, "D-ed1ec0", "different", ["a.ts"], [])).rejects.toThrow(/not a block candidate/);
    } finally {
      restore();
    }
  });

  it("throws what Drift printed when it refused a policy (broken), and serves the review log beacon recorded", async () => {
    const api = new FixtureApi("/", 0);
    const restore = serveFixtures();
    try {
      const errors = json<Record<string, { exit: number; message: string }>>("broken/errors.json");
      expect(errors.check.exit).toBe(2);
      // The line that starts Drift's error, not the caret line under the quoted YAML.
      expect(errors.check.message).toMatch(/^parsing .*conventions\.yaml: .*line \d+ column \d+/);
      await expect(api.check({ path: "/work/broken", name: "broken" })).rejects.toThrow(`drift check failed: ${errors.check.message}`);
      await expect(api.reviewQuestions({ path: "/work/broken", name: "broken" })).rejects.toThrow(`drift questions failed: ${errors.questions.message}`);
      expect(await api.reviewLogExport({ path: "/work/acme", name: "acme" })).toBeNull();
      expect(logCalibration(await api.reviewLogExport({ path: "/work/beacon", name: "beacon" }))).not.toBeNull();
      expect((await api.check({ path: "/work/beacon", name: "beacon" })).provenance.neighbourGate).toBe("on");
      expect((await api.check({ path: "/work/acme", name: "acme" })).provenance.neighbourGate).toBe("off");
    } finally {
      restore();
    }
  });
});

describe("the review log's answers (maintainer-log.mjs calibration)", () => {
  it("counts beacon's four answers and the flags judged, as Drift logged them (F11)", () => {
    const c = logCalibration(json("beacon/review-log.json"))!;
    expect(c.answered).toBe(4);
    expect(c.byAnswer).toEqual({ same: 1, different: 2, "not-a-convention": 1 });
    // Route wrapper: 2 flagged, 1 set apart (confirmed), 1 kept flagged; core layering: 3 flagged, 2 set apart; ui: 1 flagged, same.
    expect(c).toMatchObject({ flagsJudged: 6, setApart: 3, keptFlagged: 1, sameKind: 2 });
  });

  it("counts the last decision per card: a later plain accept or reject clears the answer", () => {
    const ev = (id: string, decision: string, question?: object) => ({ id, decision, ts: "2026-11-08T00:00:00Z", ...(question ? { question } : {}) });
    const log = {
      schema: "drift-review-log",
      events: [
        ev("a", "accept", { answer: "same", flagged: 2, set_apart: 0, kept_flagged: 0 }),
        ev("b", "accept", { answer: "different", flagged: 3, set_apart: 1, kept_flagged: 1 }),
        ev("b", "reject"),
        ev("c", "shown"),
        ev("d", "reject", { answer: "not-a-convention", flagged: 4, set_apart: 0, kept_flagged: 0 }),
      ],
    };
    expect(logCalibration(log)).toEqual({ answered: 2, byAnswer: { same: 1, different: 0, "not-a-convention": 1 }, flagsJudged: 2, setApart: 0, keptFlagged: 0, sameKind: 2 });
    expect(logCalibration({ schema: "other", events: [] })).toBeNull();
    expect(logCalibration(null)).toBeNull();
  });
});
