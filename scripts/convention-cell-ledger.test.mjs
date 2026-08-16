// Tests for the canary ledger checker (TDD §4.2).
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

function run({ ledgerPath = REAL_LEDGER, branch = "remediation/gt-track-c", args = [] } = {}) {
  // spawnSync rather than execFileSync: execFileSync only surfaces stderr when the process exits
  // non-zero, and the track-branch case is precisely "exits 0 AND explains itself on stderr".
  const result = spawnSync("node", [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DRIFT_LEDGER_PATH: ledgerPath,
      DRIFT_LEDGER_BRANCH: branch,
      DRIFT_LEDGER_ENFORCE: ""
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

  it("--report never fails, so the table can be printed anywhere", () => {
    const ledgerPath = withLedger((ledger) => {
      ledger.cells = [];
    });
    const result = run({ ledgerPath, branch: "main", args: ["--report"] });
    expect(result.code).toBe(0);
  });
});
