import { describe, expect, it } from "vitest";
import { API_ROUTE_SCOPE_GLOBS, expandApiRouteScopeGlobs } from "../src/next-routes.js";
import { matchesAnyGlob, matchesGlob } from "../src/globs.js";

/**
 * Regression suite for the glob semantics bugs found by the 6-repo falsification
 * test (findings F3 and F9). The previous hand-rolled implementations compiled
 * `**` to `.*` unconditionally, which made `** /` require a leading slash.
 */

const API_SCOPE = expandApiRouteScopeGlobs([...API_ROUTE_SCOPE_GLOBS]);

describe("globstar matches zero segments (F3)", () => {
  // Every one of these is a real Next.js API route layout that must be in scope.
  const inScope = [
    // repo-root app/ — the default `create-next-app` layout (shadcn-ui/taxonomy).
    // This is the case that silently disabled enforcement entirely.
    "app/api/users/route.ts",
    "app/api/route.ts",
    "app/api/a/b/c/route.ts",
    // src/ layout
    "src/app/api/users/route.ts",
    // monorepo layouts (dub, formbricks, cal.com)
    "apps/web/app/api/users/route.ts",
    "packages/web/app/api/users/route.ts",
    // route groups
    "apps/web/app/(ee)/api/admin/route.ts",
    // pages/api at repo root, file directly in the directory (papermark)
    "pages/api/report.ts",
    "pages/api/nested/report.ts",
    "apps/web/pages/api/auth/verify-email.ts",
    // other extensions
    "app/api/users/route.tsx",
    "pages/api/report.js",
  ];

  for (const path of inScope) {
    it(`treats ${path} as an API route scope match`, () => {
      expect(matchesAnyGlob(path, API_SCOPE)).toBe(true);
    });
  }

  const outOfScope = [
    "app/page.tsx",
    "app/apiary/users/route.ts", // must not match on a partial segment
    "src/lib/db.ts",
    "pages/index.tsx",
    "app/api/users/helper.ts", // not a route file
    "docs/api/route.ts.md",
  ];

  for (const path of outOfScope) {
    it(`does not treat ${path} as an API route scope match`, () => {
      expect(matchesAnyGlob(path, API_SCOPE)).toBe(false);
    });
  }
});

describe("globstar semantics", () => {
  it("matches zero segments for a leading globstar", () => {
    expect(matchesGlob("a.ts", "**/*.ts")).toBe(true);
    expect(matchesGlob("x/a.ts", "**/*.ts")).toBe(true);
    expect(matchesGlob("x/y/a.ts", "**/*.ts")).toBe(true);
  });

  it("keeps single-star scoped to one segment", () => {
    expect(matchesGlob("src/a.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/nested/a.ts", "src/*.ts")).toBe(false);
  });

  it("matches a trailing globstar against the directory and its contents", () => {
    expect(matchesGlob("src", "src/**")).toBe(true);
    expect(matchesGlob("src/a.ts", "src/**")).toBe(true);
    expect(matchesGlob("src/a/b.ts", "src/**")).toBe(true);
    expect(matchesGlob("srcx/a.ts", "src/**")).toBe(false);
  });

  it("treats ? as exactly one non-separator character", () => {
    expect(matchesGlob("a.ts", "?.ts")).toBe(true);
    expect(matchesGlob("ab.ts", "?.ts")).toBe(false);
    expect(matchesGlob("a/b.ts", "?/?.ts")).toBe(true);
  });

  it("escapes regex metacharacters in literal segments", () => {
    expect(matchesGlob("a+b.ts", "a+b.ts")).toBe(true);
    expect(matchesGlob("axb.ts", "a+b.ts")).toBe(false);
    expect(matchesGlob("lib/v1.2.ts", "lib/v1.2.ts")).toBe(true);
    expect(matchesGlob("lib/v1x2.ts", "lib/v1.2.ts")).toBe(false);
  });

  it("normalizes windows separators", () => {
    expect(matchesGlob("app\\api\\users\\route.ts", "**/app/api/**/route.ts")).toBe(true);
  });

  it("matches nothing for an empty glob list", () => {
    expect(matchesAnyGlob("anything.ts", [])).toBe(false);
  });
});

describe("default context-egress deny list covers secrets (F9)", () => {
  // Mirrors the default in packages/cli/src/domain/repo-paths.ts. The old glob
  // semantics let root-level *.pem/*.key/*.crt through, and `.env*` (no globstar
  // prefix) never matched nested env files - which is exactly where monorepo
  // secrets live.
  const DENIED = [
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/*.crt",
    "**/*.p12",
    "**/id_rsa",
    "**/id_ed25519",
  ];

  const mustDeny = [
    ".env",
    ".env.local",
    ".env.production",
    "server.pem",
    "private.key",
    "cert.crt",
    "keystore.p12",
    "id_rsa",
    "id_ed25519",
    "certs/server.pem",
    "apps/web/.env",
    "apps/web/.env.production",
    "packages/db/private.key",
    "infra/secrets/id_rsa",
  ];

  for (const path of mustDeny) {
    it(`denies ${path}`, () => {
      expect(matchesAnyGlob(path, DENIED)).toBe(true);
    });
  }

  const mustAllow = ["src/env.ts", "docs/environment.md", "src/lib/keyboard.ts", "README.md"];

  for (const path of mustAllow) {
    it(`allows ${path}`, () => {
      expect(matchesAnyGlob(path, DENIED)).toBe(false);
    });
  }
});
