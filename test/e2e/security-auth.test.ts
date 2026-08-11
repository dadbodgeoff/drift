import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixtures = [
  "security-auth-missing",
  "security-auth-before-sink",
  "security-auth-after-data",
  "security-auth-branch-bypass",
  "security-auth-callback-bypass",
  "security-dynamic-control-flow"
];

describe("security-auth fixture matrix", () => {
  it("ships durable Phase 1 auth-boundary fixtures", () => {
    for (const fixture of fixtures) {
      const root = resolve("test/fixtures", fixture);
      expect(existsSync(resolve(root, "package.json")), `${fixture} package.json`).toBe(true);
      expect(existsSync(resolve(root, "app/api/projects/route.ts")), `${fixture} route.ts`).toBe(true);
      const route = readFileSync(resolve(root, "app/api/projects/route.ts"), "utf8");
      expect(route).not.toContain("SECRET_VALUE");
    }
  });
});
