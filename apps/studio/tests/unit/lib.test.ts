import { describe, expect, it } from "vitest";
import { diffSnapshots, makeSnapshot, sameSnapshot } from "@/entities/history";
import { retain } from "@/shared/api/types";
import { t } from "@/shared/i18n";
import { mdCode, mdFence, mdTable, mdText } from "@/shared/lib/markdown";
import { middlePath } from "@/shared/lib/path";
import { redact, redactLines } from "@/shared/lib/redact";
import { parseHash } from "@/shared/lib/router";
import { check, security } from "./helpers";

describe("secret redaction", () => {
  it("hides common token and key formats, keeping variable names", () => {
    const r = redact("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nGITHUB_TOKEN=ghp_EXAMPLEexampleEXAMPLEexample0123456789\npostgres://u:hunter22@db/x\nDATABASE_URL=postgres://localhost:5432/acme");
    expect(r.text).not.toMatch(/AKIAIOSFODNN7EXAMPLE|ghp_EXAMPLE|hunter22/);
    expect(r.text).toContain("AWS_ACCESS_KEY_ID=");
    expect(r.text).toContain("DATABASE_URL=postgres://localhost:5432/acme");
    expect(r.count).toBe(3);
  });
  it("redacts a PEM key across diff lines, keeping the line count", () => {
    const lines = ["EXPORT_BUCKET=acme", "-----BEGIN PRIVATE KEY-----", "EXAMPLEONLYnotarealkeyEXAMPLEONLY", "", "MOREEXAMPLEONLYlines", "-----END PRIVATE KEY-----", "done"];
    const r = redactLines(lines);
    expect(r.lines).toHaveLength(lines.length);
    expect(r.lines.join("\n")).not.toMatch(/EXAMPLEONLY|BEGIN PRIVATE KEY/);
    expect(r.lines[2]).toBe("[redacted private key]");
    expect(r.lines[3]).toBe("");
    expect([r.lines[0], r.lines[6]]).toEqual(["EXPORT_BUCKET=acme", "done"]);
    expect(r.count).toBe(1);
  });
  it("redacts JSON-style secrets", () => {
    const r = redact('{"DB_PASSWORD": "hunter2hunter2", "name": "acme"}');
    expect(r.text).toBe('{"DB_PASSWORD": "[redacted secret value]", "name": "acme"}');
  });
  it("redacts private keys and JWTs", () => {
    expect(redact("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----").text).toBe("[redacted private key]\n[redacted private key]\n[redacted private key]");
    expect(redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U").count).toBe(1);
  });
});

describe("markdown export never makes repository text live", () => {
  it("fences and spans survive backticks", () => {
    expect(mdCode("a`b")).toBe("``a`b``");
    expect(mdFence("```\nx\n```")).toMatch(/^````\n/);
    expect(mdText("[x](javascript:alert(1))")).toBe("\\[x\\]\\(javascript:alert\\(1\\)\\)");
    expect(mdTable(["a"], [["x|y"]])).toContain("x\\|y");
  });
});

describe("snapshots", () => {
  it("diffs what changed since the last scan", () => {
    const cur = makeSnapshot({ at: 2, commit: "b", files: 1, pending: ["D-aaaaaa"], check: check(), security: security() });
    const prev = { ...cur, at: 1, newViolations: [], unguarded: cur.unguarded.slice(1) };
    const d = diffSnapshots(prev, cur);
    expect(d.newViolations.added).toHaveLength(3);
    expect(d.unguarded.added).toHaveLength(1);
    expect(sameSnapshot(cur, { ...cur, at: 99 })).toBe(true);
  });
  it("keeps history within retention", () => {
    const now = Date.now();
    const old = { at: now - 400 * 86_400_000, user: "u", decision: "accept" as const, ids: ["D-aaaaaa"], command: "", ok: true, output: "" };
    const snaps = Array.from({ length: 40 }, (_, i) => ({ at: now - i, commit: null, files: 0, pending: [], newViolations: [], unguarded: [], reaching: [], sinks: [], leaks: [] }));
    const h = retain({ snapshots: snaps, audit: [old, { ...old, at: now }] }, now);
    expect(h.snapshots).toHaveLength(30);
    expect(h.audit).toHaveLength(1);
  });
});

describe("small helpers", () => {
  it("routes", () => {
    expect(parseHash("#/conventions/D-abc123")).toMatchObject({ view: "conventions", param: "D-abc123" });
    expect(parseHash("#/nope").view).toBe("attention");
    expect(parseHash("#/map?focus=apps%2Fweb").query.get("focus")).toBe("apps/web");
  });
  it("pluralises and interpolates UI strings", () => {
    expect(t("shell.staleBody", { n: 1 })).toBe("1 file changed since this scan");
    expect(t("shell.staleBody", { n: 3 })).toBe("3 files changed since this scan");
    expect(t("conventions.progress", { done: 7, total: 15 })).toBe("7 of 15 reviewed");
  });
  it("shortens paths from the middle", () => {
    expect(middlePath("apps/web/app/api/workspaces/[id]/archive-all/route.ts", 40)).toBe("apps/…/[id]/archive-all/route.ts");
    expect(middlePath("a/b.ts")).toBe("a/b.ts");
  });
});
