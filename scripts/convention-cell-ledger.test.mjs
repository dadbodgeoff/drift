// Tests for the canary ledger checker (TDD §4.2).
//
// RUN ORDER MATTERS, and `pnpm test:harness` passes `--no-file-parallelism` because of it.
// `scripts/vocabulary-parity.test.mjs` proves its gate fires by writing broken content into the
// REAL `vocabulary/vocabulary.json`, `crates/drift-engine/src/vocabulary.rs` and
// `packages/vocabulary/src/index.ts`, restoring them in `afterEach`. Every test here derives its
// cell set from that same manifest, so running the two files concurrently makes these assertions
// read a deliberately-corrupted vocabulary and fail for a reason that has nothing to do with the
// ledger. Observed as an intermittent red on `passes the committed ledger with strict needs-review
// OFF`. The mutation is the hazard and the serialisation is the containment; a test that scribbles
// on checked-in sources is worth fixing properly, and that is a change for the file that does it.
//
// The checker is the "an undeclared cell fails CI" mechanism. A guard nobody has watched fail is a
// guard nobody knows works, so these drive it against deliberately broken ledgers and assert it
// fails for the stated reason — and, just as importantly, that it does NOT fail on a track branch,
// because enforcing there would break the zero-file-overlap property (§4.2).

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCRIPT = join(HERE, "convention-cell-ledger.mjs");
const REAL_LEDGER = join(ROOT, "test/canary/convention-cell-ledger.json");

const tempDirs = [];
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function withLedger(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "drift-ledger-"));
  tempDirs.push(dir);
  const ledger = JSON.parse(readFileSync(REAL_LEDGER, "utf8"));
  mutate(ledger);
  const path = join(dir, "ledger.json");
  writeFileSync(path, JSON.stringify(ledger, null, 2));
  return path;
}

function run({ ledgerPath = REAL_LEDGER, branch = "remediation/gt-track-c", args = [], strict = false } = {}) {
  // spawnSync rather than execFileSync: execFileSync only surfaces stderr when the process exits
  // non-zero, and the track-branch case is precisely "exits 0 AND explains itself on stderr".
  const result = spawnSync("node", [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DRIFT_LEDGER_PATH: ledgerPath,
      DRIFT_LEDGER_BRANCH: branch,
      DRIFT_LEDGER_ENFORCE: "",
      // Explicitly cleared unless a test asks for it, so the suite's verdicts never depend on the
      // developer's own shell. A gate whose result changes with an ambient env var is not a gate.
      DRIFT_LEDGER_STRICT_NEEDS_REVIEW: strict ? "1" : ""
    }
  });
  return { code: result.status ?? 1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

describe("convention cell ledger checker", () => {
  it("passes on the committed ledger", () => {
    const result = run({ branch: "main" });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("every derived cell is declared");
  });

  it("derives 18 cells and reports the state histogram", () => {
    const result = run();
    expect(result.out).toMatch(/convention cell ledger: 18 cells/);
    for (const state of ["firing", "quarantined", "unimplemented", "needs-review"]) {
      expect(result.out).toContain(state);
    }
  });

  it("fails on an enforcing branch when a derived cell is undeclared", () => {
    const ledgerPath = withLedger((ledger) => {
      ledger.cells = ledger.cells.filter(
        (cell) => cell.id !== "api_route_requires_auth_helper::presence_findings"
      );
    });
    const result = run({ ledgerPath, branch: "main" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("UNDECLARED CELL: api_route_requires_auth_helper::presence_findings");
  });

  it("does NOT fail on a track branch — enforcement is integration-branch only", () => {
    // §4.2: Track A's D1 work earns the sensitive-fields transition, but the ledger is Track C's
    // file on a branch forked before C merged. Enforcing on track branches would force one track to
    // edit another's file.
    const ledgerPath = withLedger((ledger) => {
      ledger.cells = ledger.cells.filter(
        (cell) => cell.id !== "api_route_requires_auth_helper::presence_findings"
      );
    });
    const result = run({ ledgerPath, branch: "remediation/gt-track-a" });
    expect(result.code).toBe(0);
    expect(result.err).toContain("NOT FAILING: enforcement is integration-branch only");
  });

  it("rejects `quarantined` without a located citation", () => {
    const ledgerPath = withLedger((ledger) => {
      const cell = ledger.cells.find((entry) => entry.state === "quarantined");
      cell.citation = null;
    });
    const result = run({ ledgerPath, branch: "main" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("QUARANTINED WITHOUT CITATION");
  });

  it("rejects a needs-review cell that records no missing evidence", () => {
    const ledgerPath = withLedger((ledger) => {
      const cell = ledger.cells.find((entry) => entry.state === "needs-review");
      cell.missing_evidence = null;
    });
    const result = run({ ledgerPath, branch: "main" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("NEEDS-REVIEW WITHOUT A WORKLIST ENTRY");
  });

  it("rejects an unknown state", () => {
    const ledgerPath = withLedger((ledger) => {
      ledger.cells[0].state = "probably-fine";
    });
    const result = run({ ledgerPath, branch: "main" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("INVALID STATE");
  });

  it("rejects `firing` with no named canary", () => {
    const ledgerPath = withLedger((ledger) => {
      const cell = ledger.cells.find((entry) => entry.state === "firing");
      cell.canary = null;
    });
    const result = run({ ledgerPath, branch: "main" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("STATE WITHOUT A CANARY");
  });

  it("rejects a needs-review cell that records no receipt evidence", () => {
    // Required unconditionally, not only under strict mode. The strict flip is a decision someone
    // has to make, and it cannot be made on data that does not exist yet - so the evidence is
    // collected while the state is still passing.
    const ledgerPath = withLedger((ledger) => {
      const cell = ledger.cells.find((entry) => entry.state === "needs-review");
      delete cell.receipt_evidence;
    });
    const result = run({ ledgerPath, branch: "main" });
    expect(result.code).toBe(1);
    expect(result.err).toContain("NEEDS-REVIEW WITHOUT RECEIPT EVIDENCE");
  });

  it("passes the committed ledger with strict needs-review OFF, and fails it with strict ON", () => {
    // The tightening, exercised in both positions on the REAL ledger. Default-off is the shipped
    // state and is asserted first, because a flag that silently defaults on would red the gate for
    // everyone. Then the same file under the flag, which must fail - if it passed, the mechanism
    // would be inert and the decision doc would be describing something that does not happen.
    //
    // All six of today's needs-review cells fail it. That is the finding, not a bug in the flag:
    // docs/decisions/ledger-needs-review.md.
    expect(run({ branch: "main" }).code).toBe(0);

    const strictResult = run({ branch: "main", strict: true });
    expect(strictResult.code).toBe(1);
    expect(strictResult.err).toContain("UNEVALUATED CELL (strict)");
    expect(strictResult.err).toContain("DRIFT_LEDGER_STRICT_NEEDS_REVIEW=1");
    // Names the remedy that is not "edit the evidence", because the one thing this flag must not
    // teach is that a red cell is fixed by rewriting its record.
    expect(strictResult.err).toContain("not by editing the evidence");
  });

  it("passes a needs-review cell under strict mode once its receipts show an evaluator ran", () => {
    // The other direction, so the flag is not simply "fail every needs-review cell". A cell whose
    // kind IS evaluated on the corpus - reviewed for some other reason, a missing conformance half,
    // an unverified message - stays passing under strict mode, because the thing strict mode
    // objects to is being unmeasured, not being unfinished.
    const ledgerPath = withLedger((ledger) => {
      for (const cell of ledger.cells) {
        if (cell.state === "needs-review") {
          cell.receipt_evidence = { reached: true, source: "test", note: "evaluated on the corpus" };
        }
      }
    });
    expect(run({ ledgerPath, branch: "main", strict: true }).code).toBe(0);
  });

  it("--report never fails, so the table can be printed anywhere", () => {
    const ledgerPath = withLedger((ledger) => {
      ledger.cells = [];
    });
    const result = run({ ledgerPath, branch: "main", args: ["--report"] });
    expect(result.code).toBe(0);
  });
});
