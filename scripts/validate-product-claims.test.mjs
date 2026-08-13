import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * EW-10: the claims ledger must cover the prose.
 *
 * The validator already checked the ledger against the runtime capability manifest, and that
 * mechanism was sound. Its *coverage* stopped at the manifest, so the ledger could be immaculate
 * while the README said something else - which is how three weeks produced two overclaims that only
 * an external audit caught. Strangers judge by the README, and for a product whose differentiator is
 * not lying, an overclaimed launch is uniquely self-defeating.
 *
 * A gate is only worth having if it fails when it should, so each test below breaks one rule in a
 * copy of the repo and asserts the validator refuses. Copying rather than mutating in place matters:
 * a test that edited the real README and crashed would leave an overclaim committed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A sandbox the validator can run in, where an edit cannot escape into the real tree.
 *
 * Only what the tests mutate is copied - the README, and `docs/` because the ledger lives inside it.
 * Everything the validator merely reads is symlinked, including `node_modules`: the ledger's
 * claim_support fixtures must resolve on disk, and `packages/core/dist` imports zod at load time, so
 * a sandbox without the real dependency tree fails for a reason that has nothing to do with claims.
 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "drift-claims-"));
  dirs.push(dir);
  cpSync(join(REPO_ROOT, "README.md"), join(dir, "README.md"), { force: true });
  // Copied, because beta-claims.json lives here and the tests rewrite it. Also what the
  // blocked-phrase scan walks.
  cpSync(join(REPO_ROOT, "docs"), join(dir, "docs"), { recursive: true, force: true });
  // Read-only, so symlinked: the validator itself, the fixture paths the ledger cites (several are
  // under scripts/), and the built runtime manifest with its dependency tree.
  for (const relative of ["scripts", "packages", "crates", "test", "node_modules"]) {
    symlinkSync(join(REPO_ROOT, relative), join(dir, relative));
  }
  return dir;
}

function runValidator(dir) {
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, ["scripts/validate-product-claims.mjs"], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })
    };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout?.toString() ?? ""}${error.stderr?.toString() ?? ""}`
    };
  }
}

function editLedger(dir, mutate) {
  const path = join(dir, "docs/internal/architecture/beta-claims.json");
  const ledger = JSON.parse(readFileSync(path, "utf8"));
  mutate(ledger);
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

describe("product claims validator", () => {
  it("passes on the repository as it stands, so a failure below means something", () => {
    const dir = sandbox();
    const result = runValidator(dir);
    expect(result.code, result.output).toBe(0);
  });

  it("fails a ledger claim with no evidencing test", () => {
    const dir = sandbox();
    // The ledger listed seven allowed claims and carried claim_support for three. The other four
    // were asserted on nobody's authority.
    editLedger(dir, (ledger) => {
      delete ledger.claim_support.read_only_mcp;
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/read_only_mcp has no claim_support entry/);
  });

  it("fails a claim whose evidencing test does not exist", () => {
    const dir = sandbox();
    // `fixture` was free text, so a claim could cite a test that had been renamed or never written.
    editLedger(dir, (ledger) => {
      ledger.claim_support.read_only_mcp.fixture = "packages/mcp/test/does-not-exist.test.ts";
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/cites a fixture that does not exist/);
  });

  it("fails a README capability claim that is not in the ledger", () => {
    const dir = sandbox();
    const path = join(dir, "README.md");
    // Written into the claim-bearing region, above the command reference, which is the part a
    // stranger reads to decide whether to adopt.
    const readme = readFileSync(path, "utf8").replace(
      "## First Five Minutes",
      "Drift detects duplicated helpers across your whole repository.\n\n## First Five Minutes"
    );
    writeFileSync(path, readme);

    const result = runValidator(dir);

    expect(result.code, "this is the extension: prose is covered, not just the manifest").toBe(1);
    expect(result.output).toMatch(/unregistered capability claim/);
    expect(result.output, "and it quotes the sentence, so the fix is obvious").toMatch(
      /Drift detects duplicated helpers/
    );
  });

  it("fails a prose_claims entry that maps to a blocked claim", () => {
    const dir = sandbox();
    // Registering a sentence is not a way to smuggle a blocked capability past the gate.
    editLedger(dir, (ledger) => {
      ledger.prose_claims["Drift enforces \\*\\*one\\*\\* convention family well"] = "cloud_sync";
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/non-allowed claim cloud_sync/);
  });

  it("fails a prose_claims pattern that no longer matches anything", () => {
    const dir = sandbox();
    // An exemption nobody uses is an exemption nobody reviews, and a stale one quietly widens what
    // the prose may say.
    editLedger(dir, (ledger) => {
      ledger.prose_claims["Drift cures baldness"] = null;
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/matches nothing in the README claim region/);
  });

  it("fails when the claim region boundary heading is gone, rather than scanning nothing", () => {
    const dir = sandbox();
    // A renamed heading must not silently turn the prose check off.
    const path = join(dir, "README.md");
    writeFileSync(path, readFileSync(path, "utf8").replace("## First Five Minutes", "## Getting going"));

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/claim-bearing region cannot be bounded/);
  });

  it("requires the enforcement posture, and that it class every allowed claim", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      ledger.enforcement_posture.advisory = ledger.enforcement_posture.advisory.filter(
        (claim) => claim !== "read_only_mcp"
      );
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(
      result.output,
      "'enforces X' and 'reports X and leaves it to you' are different products"
    ).toMatch(/must class read_only_mcp as enforced or advisory/);
  });

  it("requires a measured refusal rate with a source, a date and a sha", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      delete ledger.enforcement_posture.measured_refusal_rate.commit;
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(
      result.output,
      "a rate with no sha is a rate nobody can reproduce"
    ).toMatch(/must name the sha it was measured at/);
  });

  it("fails a per-repo rate that refuses more edits than it makes", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      ledger.enforcement_posture.measured_refusal_rate.per_repo.calcom = { refused: 9, total: 8 };
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/refuses more edits than it makes/);
  });

  it("requires the single-convention scope to be stated", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      delete ledger.enforcement_posture.single_convention_scope;
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/single_convention_scope must state how narrow the scope is/);
  });

  it("requires a determinism measurement with a source, a date and a sha", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      delete ledger.enforcement_posture.measured_determinism;
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(
      result.output,
      "'we measured determinism' is itself a claim, and it needs evidence like any other"
    ).toMatch(/measured_determinism is required/);
  });

  it("refuses to let a flap be recorded as a determinism measurement", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      ledger.enforcement_posture.measured_determinism.per_repo.calcom.distinct_results = 2;
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/a flap is not a determinism measurement/);
  });

  it("fails a single-run determinism measurement, which cannot disagree with anything", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      ledger.enforcement_posture.measured_determinism.runs_per_repo = 1;
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/runs_per_repo must be at least 2/);
  });

  it("fails when an evaluation repo is accounted for in neither column", () => {
    const dir = sandbox();
    // Silence about a repo is how "measured on the eval repos" comes to mean "measured on the two
    // that were convenient" - which is the state this whole item found.
    editLedger(dir, (ledger) => {
      ledger.enforcement_posture.measured_determinism.not_yet_measured =
        ledger.enforcement_posture.measured_determinism.not_yet_measured.filter(
          (repo) => repo !== "dub"
        );
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/accounts for neither measuring nor deferring dub/);
  });

  it("fails a repo listed as both measured and not yet measured", () => {
    const dir = sandbox();
    editLedger(dir, (ledger) => {
      ledger.enforcement_posture.measured_determinism.not_yet_measured.push("calcom");
    });

    const result = runValidator(dir);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/lists calcom as both measured and not yet measured/);
  });
});
