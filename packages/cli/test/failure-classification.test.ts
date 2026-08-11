import { describe, expect, it } from "vitest";
import { StoredBlobCorruptionError } from "@drift/storage";
import { operationalFailureFor, operationalFailureForMessage } from "../src/app/failure-classification.js";

/**
 * F-1 (R-3 fix). Three verified failure shapes reached users classified as generic `cli_error`
 * with the advice "rerun with corrected inputs" - advice that is wrong for all three. The
 * messages below are verbatim from the R-3 robustness run.
 */

describe("fallback classifier routes verified R-3 failure shapes honestly", () => {
  it("classifies SQLite 'disk I/O error' (how ENOSPC surfaces mid-check) as a disk/io failure", () => {
    const failure = operationalFailureForMessage("disk I/O error");
    expect(failure.code).toBe("disk_io_error");
    expect(failure.user_action).toMatch(/disk/i);
    // "rerun with corrected inputs" is the misleading advice this fix removes.
    expect(failure.user_action).not.toContain("corrected inputs");
    expect(failure.recovery_commands.length).toBeGreaterThan(0);
  });

  it("classifies SQLITE_IOERR text as the same disk/io failure", () => {
    const failure = operationalFailureForMessage("SQLITE_IOERR: disk I/O error");
    expect(failure.code).toBe("disk_io_error");
  });

  it("classifies SQLite's 'attempt to write a readonly database' as permission_denied", () => {
    const failure = operationalFailureForMessage("attempt to write a readonly database");
    expect(failure.code).toBe("permission_denied");
    expect(failure.safe_to_retry).toBe(false);
    expect(failure.user_action).not.toContain("corrected inputs");
  });

  it("classifies a JSON parse failure on a DB blob as corrupt_database via the throw-site marker", () => {
    // The storage layer marks parses of blobs it wrote itself; the classifier must honor the
    // marker rather than pattern-matching all JSON errors.
    const error = new StoredBlobCorruptionError(
      "repo_contracts.contract_json",
      new SyntaxError("Unexpected end of JSON input")
    );
    const failure = operationalFailureFor(error, error.message);
    expect(failure.code).toBe("corrupt_database");
    expect(failure.safe_to_retry).toBe(false);
    expect(failure.user_action).toMatch(/backup|rebuild/i);
  });

  it("still classifies user-input JSON parse errors as cli_error, not corruption", () => {
    // Disambiguation must live at the throw site: a malformed contract file the user passed in
    // is their input to fix, not a corrupt database.
    const error = new SyntaxError("Unexpected token } in JSON at position 12");
    const failure = operationalFailureFor(error, error.message);
    expect(failure.code).toBe("cli_error");
  });
});
