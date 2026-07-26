import { describe, expect, it } from "vitest";
import { checkDiskSpace, insufficientDiskMessage } from "../src/domain/disk-space.js";

/**
 * T41. Disk exhaustion mid-scan does not fail cleanly: SQLite reports a raw "database or disk
 * is full", the database is left partially written, and later operations report failures that
 * have nothing to do with the repo. During development this produced four false test failures
 * that all passed on retry after freeing space, with no code change. So Drift refuses up front.
 */
describe("checkDiskSpace", () => {
  it("measures the volume holding the database", () => {
    const report = checkDiskSpace(`${process.cwd()}/.drift/repos/x/drift.sqlite`);
    expect(report.availableBytes).toBeGreaterThan(0);
    expect(report.detail).toMatch(/free/);
  });

  it("walks up to an existing directory when the state path does not exist yet", () => {
    // First run: ~/.drift/repos/<id>/ has not been created.
    const report = checkDiskSpace(`${process.cwd()}/does/not/exist/yet/drift.sqlite`);
    expect(report.availableBytes).toBeGreaterThan(0);
    expect(Number.isFinite(report.availableBytes)).toBe(true);
  });

  it("scales the estimate with the number of indexable files", () => {
    const small = checkDiskSpace(process.cwd(), 100);
    const large = checkDiskSpace(process.cwd(), 100_000);
    expect(small.estimatedBytes).toBeLessThan(large.estimatedBytes!);
    // cal.com is ~5,000 files and reached roughly 1 GB of state.
    const calcomScale = checkDiskSpace(process.cwd(), 5_000);
    expect(calcomScale.estimatedBytes!).toBeGreaterThan(512 * 1024 * 1024);
  });

  it("reports sufficient when no file count is known and space is ample", () => {
    expect(checkDiskSpace(process.cwd()).sufficient).toBe(true);
  });

  it("names the remedy in a refusal, rather than only the problem", () => {
    const message = insufficientDiskMessage(
      { availableBytes: 1, estimatedBytes: 2, sufficient: false, detail: "0.0 GB free" },
      "/home/u/.drift"
    );
    expect(message).toContain("/home/u/.drift");
    expect(message).toContain("drift state size");
    expect(message).toMatch(/rm -rf/);
  });
});
