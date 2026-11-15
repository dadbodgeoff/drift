// The desktop app's code drawer on a real repository: the main process scans it with a real drift binary
// and reads sources from the checkout, only files the scan listed. Runs only when both are given (a dev
// clone is third-party code and never part of the repository):
//
//   STUDIO_DRIFT=<drift binary> STUDIO_REAL_REPO=<a scratch copy of a checkout> npx vitest run tests/unit/real-repo.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioMain } from "../../electron/handlers";
import { Store } from "../../electron/store";

const bin = process.env.STUDIO_DRIFT;
const repo = process.env.STUDIO_REAL_REPO;

describe.skipIf(!bin || !repo)("the code drawer on a real repository (desktop app, real drift)", () => {
  it("scans it, then reads every listed source as it is on disk, and nothing the scan did not list", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "studio-real-"));
    const store = new Store(join(tmp, "data"));
    store.update({ driftPath: bin! });
    const main = new StudioMain({ store, projectsDir: join(tmp, "projects"), user: "t", appVersion: "0", platform: process.platform, dialogs: { chooseDirectory: async () => repo!, chooseFile: async () => null, chooseSavePath: async () => null } });
    const ref = await main.openRepo();
    expect(ref?.path).toBe(repo);
    const facts = await main.facts(ref!, { refresh: true });
    const files = facts.data.files.filter((f) => statSync(join(repo!, f.path)).size <= 2 * 1024 * 1024);
    expect(files.length).toBeGreaterThan(100);
    let read = 0;
    for (const f of files) {
      expect(await main.readSource(ref!, f.path)).toBe(readFileSync(join(repo!, f.path), "utf8"));
      read++;
    }
    expect(read).toBe(files.length);
    // Not listed by the scan, or outside the repository: not available.
    expect(await main.readSource(ref!, ".git/HEAD")).toBeNull();
    await expect(main.readSource(ref!, "../outside.ts")).rejects.toThrow();
  }, 300_000);
});
