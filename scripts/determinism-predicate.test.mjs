import { describe, expect, it } from "vitest";

import {
  REBASELINE_COMMAND,
  digestArtifact,
  digestRegressions
} from "./determinism-predicate.mjs";

/**
 * The determinism digest baseline.
 *
 * `determinism.mjs` computed a per-repo digest over every finding fingerprint at `--scope full`,
 * across the whole corpus, and discarded it - so the harness could print "7/7 repo(s) deterministic"
 * for a build in which every check had stopped firing. Three identical runs of nothing are three
 * identical runs. Ten baseline files sat in this directory and none of them was this one.
 *
 * These cases are synthetic on purpose. The corpus lives outside the repo and needs a release
 * engine, so the mechanism has to be falsifiable without it, or the gate is one nobody can trust
 * until the day it matters.
 */

const clean = [
  { repo: "taxonomy", digest: "aaaa000000000000", findings_count: 3, fingerprints: ["f1", "f2", "f3"] },
  { repo: "dub", digest: "bbbb000000000000", findings_count: 2, fingerprints: ["g1", "g2"] }
];

describe("determinism digest baseline", () => {
  it("passes an identical artifact", () => {
    expect(digestRegressions(clean, clean)).toEqual([]);
  });

  it("fails a dropped fingerprint, and names the fingerprint", () => {
    const dropped = [
      { ...clean[0], findings_count: 2, fingerprints: ["f1", "f3"] },
      clean[1]
    ];
    const failures = digestRegressions(dropped, clean);

    expect(failures.length).toBeGreaterThan(0);
    expect(
      failures.join(" "),
      "a drop is the whole point; naming which fingerprint went missing is what makes it actionable"
    ).toContain("f2");
    expect(failures.join(" ")).toMatch(/DROP/);
  });

  it("fails a findings-count drop even when no fingerprint can be named", () => {
    // The case the old harness was blindest to: a check that stops firing entirely.
    const silent = [
      { ...clean[0], findings_count: 0, fingerprints: [] },
      { ...clean[1], findings_count: 0, fingerprints: [] }
    ];
    const failures = digestRegressions(silent, clean);

    expect(failures.filter((line) => line.includes("DROP")).length).toBe(4);
    expect(failures.join(" ")).toContain("3 -> 0");
    expect(
      failures.join(" "),
      "silence must not be reported as an improvement"
    ).toMatch(/not an improvement/);
  });

  it("fails a rise and demands an explicit re-baseline rather than updating itself", () => {
    const risen = [
      { ...clean[0], findings_count: 4, fingerprints: ["f1", "f2", "f3", "f4"] },
      clean[1]
    ];
    const failures = digestRegressions(risen, clean);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/RISE/);
    expect(failures[0]).toContain("f4");
    expect(
      failures[0],
      "a gate that rewrites its own baseline on disagreement reports whatever it just measured"
    ).toContain(REBASELINE_COMMAND);
  });

  it("fails a repo that vanished from the run entirely", () => {
    const failures = digestRegressions([clean[0]], clean);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("dub");
    expect(failures[0]).toMatch(/absent from this run/);
  });

  it("fails a repo with no baseline row rather than letting it join and assert nothing", () => {
    const extra = [...clean, { repo: "calcom", digest: "cccc", findings_count: 9, fingerprints: ["h1"] }];
    const failures = digestRegressions(extra, clean);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("calcom");
    expect(failures[0]).toMatch(/no baseline row/);
  });

  it("reports every repo's failure in one run rather than stopping at the first", () => {
    const worse = [
      { ...clean[0], findings_count: 1, fingerprints: ["f1"] },
      { ...clean[1], findings_count: 1, fingerprints: ["g1"] }
    ];
    expect(digestRegressions(worse, clean).length).toBe(4);
  });

  describe("digestArtifact", () => {
    it("keeps a deterministic repo's fingerprints, sorted so run order cannot fake a diff", () => {
      const artifact = digestArtifact([
        {
          repo: "taxonomy",
          status: "DETERMINISTIC",
          digest: "aaaa",
          observable: { findings_count: 2, findings: [{ fingerprint: "z" }, { fingerprint: "a" }] }
        }
      ]);

      expect(artifact).toEqual([
        { repo: "taxonomy", digest: "aaaa", findings_count: 2, fingerprints: ["a", "z"] }
      ]);
    });

    it("contributes no row for a repo that flapped or never ran", () => {
      // A zeroed row for an unmeasured repo is indistinguishable from the drop this exists to
      // catch, and both statuses have already failed the run on their own terms.
      const artifact = digestArtifact([
        { repo: "calcom", status: "FLAPPED", digest: "x" },
        { repo: "midday", status: "MISSING_REPO" },
        { repo: "dub", status: "CONTAMINATED_WORKTREE" }
      ]);

      expect(artifact).toEqual([]);
    });

    it("makes a vanished repo visible as a failure rather than as an empty artifact", () => {
      // The pairing that matters: digestArtifact drops the flapped repo, and digestRegressions
      // then reports it as absent. Silence at both ends is how a corpus shrinks unnoticed.
      const artifact = digestArtifact([{ repo: "taxonomy", status: "FLAPPED", digest: "x" }]);

      expect(digestRegressions(artifact, clean).length).toBe(2);
    });
  });
});
