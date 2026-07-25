import { describe, expect, it } from "vitest";
import { extractImports, parseImportNames } from "../src/engine/fact-extraction.js";

/**
 * Regression suite for finding A3/F2/F5 from the 6-repo falsification test.
 *
 * The CLI's import extraction is reconciled against the Rust engine's
 * `import_used` facts by evidence key (file, line, symbol, source). Any divergence
 * between the two parsers used to throw and abort onboarding entirely
 * (openstatus, cal.com, papermark). These cases pin the semantics the engine uses.
 */

describe("parseImportNames: type-only bindings are excluded", () => {
  it("drops a whole `import type` statement", () => {
    // cal.com: apps/web/app/api/cron/bookingReminder/route.ts
    expect(parseImportNames("type { EventTypeMetadata }")).toEqual([]);
    expect(parseImportNames("type Foo")).toEqual([]);
  });

  it("drops inline type modifiers but keeps value bindings", () => {
    // openstatus: apps/dashboard/src/app/api/chat/route.ts
    // Previously produced the symbol "type ChatStoredMessage", matching no fact.
    expect(parseImportNames("{\n  type ChatStoredMessage,\n  storedMessageSchema,\n}")).toEqual([
      "storedMessageSchema"
    ]);
  });

  it("never emits a name with a leading type keyword", () => {
    for (const name of parseImportNames("{ type A, type B, c }")) {
      expect(name.startsWith("type ")).toBe(false);
    }
  });
});

describe("parseImportNames: binding forms", () => {
  it("captures default imports", () => {
    expect(parseImportNames("prisma")).toEqual(["prisma"]);
  });

  it("captures default and named bindings together", () => {
    // cal.com: `import prisma, { bookingMinimalSelect } from "@calcom/prisma"`.
    // The default binding used to be dropped entirely, a silent false negative.
    expect(parseImportNames("prisma, { bookingMinimalSelect }")).toEqual([
      "bookingMinimalSelect",
      "prisma"
    ]);
  });

  it("captures namespace imports", () => {
    expect(parseImportNames("* as db")).toEqual(["db"]);
    expect(parseImportNames("prisma, * as db")).toEqual(["prisma", "db"]);
  });

  it("resolves aliases to the bound local name", () => {
    expect(parseImportNames("{ prisma as db }")).toEqual(["db"]);
  });

  it("deduplicates repeated bindings", () => {
    expect(parseImportNames("{ a, a }")).toEqual(["a"]);
  });
});

describe("extractImports: line numbers match the import keyword", () => {
  it("reports the import line, not a preceding blank line", () => {
    // papermark: app/(ee)/api/ai/store/runs/[runId]/route.ts. `\s*` in the old
    // pattern swallowed the blank line, reporting line 6 for an import on line 7 and
    // breaking evidence-key reconciliation.
    const source = [
      'import { NextResponse } from "next/server";', // 1
      "", // 2
      'import { authOptions } from "@/lib/auth";', // 3
      "", // 4
      "", // 5
      'import prisma from "@/lib/prisma";' // 6
    ].join("\n");

    const found = extractImports(source).find((entry) => entry.source === "@/lib/prisma");
    expect(found).toBeDefined();
    expect(found!.line).toBe(6);
    expect(found!.name).toBe("prisma");
  });

  it("reports the correct line for indented imports", () => {
    const source = ['import "side-effect";', '  import prisma from "@/lib/prisma";'].join("\n");
    const found = extractImports(source).find((entry) => entry.source === "@/lib/prisma");
    expect(found!.line).toBe(2);
  });

  it("emits no bindings for a type-only import statement", () => {
    const source = 'import type { Foo } from "@/lib/db";';
    expect(extractImports(source)).toEqual([]);
  });

  it("handles a multi-line import with an inline type modifier", () => {
    const source = [
      'import { NextResponse } from "next/server";',
      "import {",
      "  type StoredMessage,",
      "  messageSchema,",
      '} from "@openstatus/db/src/schema";'
    ].join("\n");

    const fromSchema = extractImports(source).filter(
      (entry) => entry.source === "@openstatus/db/src/schema"
    );
    expect(fromSchema.map((entry) => entry.name)).toEqual(["messageSchema"]);
    expect(fromSchema[0]!.line).toBe(2);
  });
});
