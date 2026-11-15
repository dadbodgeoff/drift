// Round 9, workstream F: the human review surface. A reviewer's exceptions ("fine because…") as Drift writes
// them, outliers split by them, the suggestion-tier record behind "Block anyway", and one review count.
import { describe, expect, it } from "vitest";
import { conventionRows, forceBlockIsDanger, memberKey, parseConventions, reviewCounts, splitOutliers, suggestionRecord, trackRecord } from "@/entities/convention";
import { FixtureApi } from "@/shared/api/fixture";
import { census, check, text } from "./helpers";

const policy = parseConventions(text("acme/conventions.yaml"));
const rows = conventionRows(policy, census(), check());
const row = (id: string) => rows.find((r) => r.id === id)!;

describe("a reviewer's exceptions (conventions.yaml `exceptions`)", () => {
  it("reads them sorted by member, one per member, and ignores malformed entries", () => {
    const yaml = text("acme/conventions.yaml").replace(
      "  exceptions:\n",
      "  exceptions:\n  - member: z.ts#b\n    reason: later\n  - member: no-hash\n    reason: dropped\n  - member: a.ts#a\n    reason: 7\n  - member: z.ts#b\n    reason: duplicate\n",
    );
    const c = parseConventions(yaml).conventions.find((x) => x.id === "D-b0d245")!;
    expect(c.exceptions!.map((e) => e.member)).toEqual(["apps/web/app/api/oauth/callback/route.ts#GET", "z.ts#b"]);
    expect(c.exceptions!.find((e) => e.member === "z.ts#b")!.reason).toBe("later");
    // A convention without the field has none (the file is as before).
    expect(parseConventions(text("acme/conventions.yaml")).conventions.filter((x) => x.exceptions === undefined).length).toBe(policy.conventions.length - 1);
  });

  it("splits a card's outliers into those to look at and those marked fine, one number each", () => {
    const r = row("D-b0d245");
    const { open, fine } = splitOutliers(r);
    expect(fine).toEqual([{ member: "apps/web/app/api/oauth/callback/route.ts#GET", path: "apps/web/app/api/oauth/callback/route.ts", symbol: "GET", line: expect.any(Number), reason: "the OAuth callback runs before any session exists" }]);
    expect(open.some((o) => memberKey(o) === fine[0].member)).toBe(false);
    expect(open.length + fine.length).toBe(r.outliers!.length);
    // A member no longer listed anywhere keeps its exception, without a line.
    const stale = splitOutliers({ ...r, exceptions: [{ member: "gone.ts#x", reason: "old" }] });
    expect(stale.fine).toEqual([{ member: "gone.ts#x", path: "gone.ts", symbol: "x", line: null, reason: "old" }]);
    expect(stale.open.length).toBe(r.outliers!.length);
  });

  it("applies this tab's exceptions in fixture mode the way drift review writes them, and removes the field with the last", async () => {
    const api = new FixtureApi("/", 0);
    const files = new Map<string, string>([["/acme/conventions.yaml", text("acme/conventions.yaml")], ["/acme/drift.lock", text("acme/drift.lock")], ["/index.json", text("index.json")]]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(files.get(String(u)) ?? "", { status: files.has(String(u)) ? 200 : 404, headers: { "content-type": "text/plain" } })) as typeof fetch;
    try {
      const repo = { id: "acme", path: "/work/acme", name: "acme" };
      const e = await api.exempt(repo, "D-b0d245", "apps/web/app/api/admin/health/route.ts#GET", "  a health   check ");
      expect(e).toMatchObject({ decision: "exempt", ok: true, command: 'drift --root /work/acme review --exempt=D-b0d245 --member=apps/web/app/api/admin/health/route.ts#GET "--reason=a health check"' });
      let c = parseConventions((await api.policy(repo)).conventions!).conventions.find((x) => x.id === "D-b0d245")!;
      expect(c.exceptions!.map((x) => [x.member, x.reason])).toEqual([
        ["apps/web/app/api/admin/health/route.ts#GET", "a health check"],
        ["apps/web/app/api/oauth/callback/route.ts#GET", "the OAuth callback runs before any session exists"],
      ]);
      await api.exempt(repo, "D-b0d245", "apps/web/app/api/admin/health/route.ts#GET", null);
      await api.exempt(repo, "D-b0d245", "apps/web/app/api/oauth/callback/route.ts#GET", null);
      const yaml = (await api.policy(repo)).conventions!;
      c = parseConventions(yaml).conventions.find((x) => x.id === "D-b0d245")!;
      expect(c.exceptions).toBeUndefined();
      expect(yaml).not.toContain("exceptions");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the suggestion-tier record behind Block anyway (W0's family-admission.json, via agents)", () => {
  it("is the red action only on a known record of at least half (at least 10 labelled)", () => {
    // passes_key: 6 of 12 (50%); decorators: 7 of 17 (41%); renders: 4 of 10 (40%); layout wrappers: 2 of 2.
    // (The decorator card is the blocked UseGuards one: since the show policy, acme's other decorator card is not proposed.)
    expect(suggestionRecord(row("D-d779d0"))).toEqual({ accepted: 6, n: 12, rate: 0.5 });
    expect(forceBlockIsDanger(row("D-d779d0"))).toBe(true);
    expect(forceBlockIsDanger(row("D-ccf957"))).toBe(false);
    expect(forceBlockIsDanger(row("D-da92a0"))).toBe(false);
    // 100% of 2: too few labelled to call it good [STRICT].
    expect(suggestionRecord(row("D-69e735"))).toMatchObject({ n: 2, rate: 1 });
    expect(forceBlockIsDanger(row("D-69e735"))).toBe(false);
    // No record (older drift, or no family): not red. The default tier has no suggestion record.
    expect(forceBlockIsDanger({ ...row("D-d779d0"), agents: null })).toBe(false);
    expect(suggestionRecord(row("D-ed1ec0"))).toBeNull();
  });

  it("is the record the queue chip and the track record show for a suggestion, so a card states one rate", () => {
    // Base classes: 11 of 18.
    const r = row("D-df89fd");
    expect(trackRecord(r)).toMatchObject({ scope: "suggestion", n: 18, rate: 11 / 18 });
    expect(r.agents!.text).toContain(`${Math.floor((11 / 18) * 100)}% of 18`);
    // Under 5 labelled: no figure at all (as the study's own hint).
    expect(trackRecord(row("D-69e735"))).toBeNull();
    // The default tier keeps the study's pooled family hint.
    expect(trackRecord(row("D-ed1ec0"))).toMatchObject({ scope: "pooled" });
  });
});

describe("one review count", () => {
  it("progress, To review and the navigation badge read the same set", () => {
    const c = reviewCounts(rows);
    // With check: the two proposals the show policy hides are not rows; the block candidate is the one to review.
    expect(c).toEqual({ done: 13, toReview: 1, total: 14, notInPolicy: 0 });
    // A census proposal not yet in the policy is to review, and counted in the total ("2 of 3", never "2 of 2" beside "To review 1").
    const extra = conventionRows(parseConventions(text("acme/conventions.yaml").replace("- id: D-d779d0", "- id: D-d779d1")), census(), check());
    const e = reviewCounts(extra);
    expect(e.notInPolicy).toBe(1);
    expect(e.total - e.done).toBe(e.toReview);
  });
});
