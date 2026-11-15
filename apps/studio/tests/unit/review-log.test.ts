// Round 9, workstream G: the opt-in, local review log. The Studio writes through `drift review` only
// (`--set-log`, `--export-log`, `--shown`, and DRIFT_REVIEW_VIA=studio on its decisions), validated in the
// main process; the setting is `review_log: on` in conventions.yaml, absent when off.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StudioMain } from "../../electron/handlers";
import { InvalidArgument, assertSavePath, driftArgs, driftEnv } from "../../electron/ops";
import { Store } from "../../electron/store";
import { parseConventions } from "@/entities/convention";
import { FixtureApi } from "@/shared/api/fixture";
import { channels } from "@/shared/ipc/contract";
import { text } from "./helpers";

describe("the review log's drift argv (main process)", () => {
  it("turns it on or off, exports to the chosen path, and records cards shown, every value attached by =", () => {
    expect(driftArgs("/r", { op: "setLog", on: true })).toEqual(["--root", "/r", "review", "--set-log=on"]);
    expect(driftArgs("/r", { op: "setLog", on: false })).toEqual(["--root", "/r", "review", "--set-log=off"]);
    expect(driftArgs("/r", { op: "exportLog", out: "/home/me/review log.json", includePaths: false })).toEqual(["--root", "/r", "review", "--export-log=/home/me/review log.json"]);
    expect(driftArgs("/r", { op: "exportLog", out: "/tmp/x.json", includePaths: true })).toEqual(["--root", "/r", "review", "--export-log=/tmp/x.json", "--include-paths"]);
    expect(driftArgs("/r", { op: "shown", ids: ["D-abcdef", "D-123456", "D-abcdef"] })).toEqual(["--root", "/r", "review", "--shown=D-abcdef,D-123456"]);
    expect(() => driftArgs("/r", { op: "shown", ids: ["D-abcdef,--accept"] })).toThrow(InvalidArgument);
    expect(() => driftArgs("/r", { op: "setLog", on: "yes" as never })).toThrow(InvalidArgument);
  });

  it("exports only to an absolute path without control characters", () => {
    for (const bad of ["", "x.json", "./x.json", "/tmp/a\nb.json", "/tmp/a\u0000b", 3]) expect(() => assertSavePath(bad), String(bad)).toThrow(InvalidArgument);
    expect(assertSavePath("/tmp/x.json")).toBe("/tmp/x.json");
  });

  it("marks every drift run as the Studio's, so the log says where a decision was made", () => {
    expect(driftEnv({ PATH: "/bin", DRIFT_REVIEW_VIA: "cli" }, "/c")).toEqual({ PATH: "/bin", DRIFT_CACHE_DIR: "/c", DRIFT_REVIEW_VIA: "studio" });
  });

  it("checks the channels' arguments", () => {
    const repo = { path: "/r", name: "r" };
    expect(channels.setReviewLog.req.safeParse([repo, true]).success).toBe(true);
    expect(channels.setReviewLog.req.safeParse([repo, "on"]).success).toBe(false);
    expect(channels.exportReviewLog.req.safeParse([repo, { includePaths: false }]).success).toBe(true);
    expect(channels.exportReviewLog.req.safeParse([repo, { includePaths: false, out: "/etc/passwd" }]).data).toEqual([repo, { includePaths: false }]);
    expect(channels.reviewShown.req.safeParse([repo, ["D-abcdef"]]).success).toBe(true);
    expect(channels.reviewShown.req.safeParse([repo, []]).success).toBe(false);
    expect(channels.reviewShown.req.safeParse([repo, ["../x"]]).success).toBe(false);
  });

  it("asks where to export and runs nothing when the person cancels", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "studio-log-"));
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    let asked = "";
    const main = new StudioMain({
      store: new Store(join(tmp, "data")),
      projectsDir: join(tmp, "projects"),
      user: "t",
      appVersion: "0",
      platform: "linux",
      dialogs: {
        chooseDirectory: async () => null,
        chooseFile: async () => null,
        chooseSavePath: async (name) => {
          asked = name;
          return null;
        },
      },
    });
    main.preopen(repo);
    await expect(main.exportReviewLog({ path: repo, name: "repo" }, { includePaths: false })).resolves.toEqual({ path: null, output: "" });
    expect(asked).toBe("drift-review-log.json");
    // A repository the person never opened is refused before any dialog.
    await expect(main.exportReviewLog({ path: join(tmp, "other"), name: "other" }, { includePaths: false })).rejects.toThrow(/unknown repository/);
    // Recording a card shown never fails the view (here: no drift binary at all).
    await expect(main.reviewShown({ path: repo, name: "repo" }, ["D-abcdef"])).resolves.toBe(false);
  });
});

describe("the setting in conventions.yaml", () => {
  it("is on only for `review_log: on` (or YAML 1.1's true), as Drift reads it", () => {
    const yaml = text("acme/conventions.yaml");
    expect(parseConventions(yaml).review_log).toBeUndefined();
    const at = yaml.indexOf("conventions:\n");
    const withLog = (v: string) => `${yaml.slice(0, at)}review_log: ${v}\n${yaml.slice(at)}`;
    expect(parseConventions(withLog("on")).review_log).toBe("on");
    expect(parseConventions(withLog('"on"')).review_log).toBe("on");
    expect(parseConventions(withLog("true")).review_log).toBe("on");
    expect(parseConventions(withLog("off")).review_log).toBeUndefined();
    expect(parseConventions(withLog("yes please")).review_log).toBeUndefined();
  });

  it("is set and cleared in fixture mode the way drift review writes it, and counts what would be recorded", async () => {
    const api = new FixtureApi("/", 0);
    const files = new Map<string, string>([["/acme/conventions.yaml", text("acme/conventions.yaml")], ["/acme/drift.lock", text("acme/drift.lock")], ["/index.json", text("index.json")]]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => new Response(files.get(String(u)) ?? "", { status: files.has(String(u)) ? 200 : 404, headers: { "content-type": "text/plain" } })) as typeof fetch;
    try {
      const repo = { id: "acme", path: "/work/acme", name: "acme" };
      // Off: nothing recorded.
      await api.reviewShown(repo, ["D-b0d245"]);
      expect((await api.exportReviewLog(repo)).output).toMatch(/0 review event/);
      expect(await api.setReviewLog(repo, true)).toMatch(/review log on/);
      let yaml = (await api.policy(repo)).conventions!;
      expect(yaml).toMatch(/^review_log: on$/m);
      expect(parseConventions(yaml).review_log).toBe("on");
      await api.reviewShown(repo, ["D-b0d245"]);
      await api.review(repo, "accept", ["D-b0d245"]);
      expect(await api.exportReviewLog(repo)).toEqual({ path: null, output: "fixture mode: 2 review event(s) recorded in this tab; no file was written" });
      await api.setReviewLog(repo, false);
      yaml = (await api.policy(repo)).conventions!;
      expect(yaml).not.toContain("review_log");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
