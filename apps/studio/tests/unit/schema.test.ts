import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_FACTS, SchemaError, checkFacts } from "@/entities/drift/schema";
import type { RepoFacts } from "@/shared/contract/drift";
import { slimFacts } from "@/shared/contract/slim";
import { INPUT_LABEL, inputOf } from "@/entities/facts";
import { madeByTag } from "@/entities/convention";
import { facts as acmeFacts } from "./helpers";

const facts = (schema_version: number): RepoFacts => ({ schema_version, files: [], skipped: [] });

describe("facts schema handshake", () => {
  it("reads the facts schema the CLI in this checkout writes", () => {
    // crates/drift-core/src/facts.rs is the source of `drift scan`'s schema_version.
    const src = readFileSync(join(__dirname, "../../../../crates/drift-core/src/facts.rs"), "utf8");
    const m = /pub const FACTS_SCHEMA_VERSION: u32 = (\d+);/.exec(src);
    expect(m).not.toBeNull();
    const cli = Number(m![1]);
    expect(SUPPORTED_FACTS).toContain(cli);
    expect(checkFacts(facts(cli), "drift 0.1.0-dev").schema_version).toBe(cli);
  });
  it("lists the same versions in the README contract table", () => {
    const row = readFileSync(join(__dirname, "../../README.md"), "utf8")
      .split("\n")
      .find((l) => l.includes("scan --out F"));
    const m = row && /`schema_version` ∈ \{([\d, ]+)\}/.exec(row);
    expect(m, "facts row of the README contract table").toBeTruthy();
    expect(m![1].split(",").map((s) => Number(s.trim()))).toEqual(SUPPORTED_FACTS);
  });
  it("reads schema 5 facts too (8 only adds Python class facts omitted when empty)", () => {
    expect(checkFacts(facts(5), null).schema_version).toBe(5);
  });
  it("still reads schema 4 facts and rejects unknown ones", () => {
    expect(checkFacts(facts(4), null).schema_version).toBe(4);
    expect(() => checkFacts(facts(99), null)).toThrow(SchemaError);
  });
});

describe("import loads and peer dependencies (facts schema 6)", () => {
  it("reads schema 6 and slim facts keep a deferred load, not a static one", () => {
    expect(SUPPORTED_FACTS).toContain(6);
    const out = slimFacts({
      schema_version: 6,
      skipped: [],
      files: [
        {
          path: "a.ts",
          lang: "ts",
          package: "",
          parse_ok: true,
          directives: [],
          imports: [
            { module: "b.ts", names: ["x"], type_only: false, load: "dynamic" },
            { module: "c.ts", names: ["y"], type_only: false, load: "static" },
            { module: "d.ts", names: ["z"], type_only: false },
          ],
          symbols: [],
          entry_points: [],
        },
      ],
      packages: [{ path: "", name: "a", scripts: [], dependencies: ["x@1"], peer_dependencies: ["p@1"], optional_dependencies: ["p@1"], compiler_flags: [], dev_only: ["x"] }],
    });
    expect(out.files[0].imports).toEqual([
      { module: "b.ts", names: [], type_only: false, load: "dynamic" },
      { module: "c.ts", names: [], type_only: false },
      { module: "d.ts", names: [], type_only: false },
    ]);
    expect(out.packages?.[0]).toEqual({ path: "", name: "a", scripts: [], dependencies: [], compiler_flags: [] });
  });
});

describe("request input and field decorators (#37, facts schema 5)", () => {
  it("slim facts keep the input controls and field decorators, and nothing else of controls", () => {
    const sym = { name: "GET", kind: "function" as const, exported_as: ["GET"], line: 1, wraps: [], controls: ["await", "reads_input", "try"], field_decorators: ["pkg:class-validator#IsUUID"] };
    const out = slimFacts({ schema_version: 5, skipped: [], files: [{ path: "a.ts", lang: "ts", package: "", parse_ok: true, directives: [], imports: [], symbols: [sym], entry_points: [] }] });
    expect(out.files[0].symbols[0].controls).toEqual(["reads_input"]);
    expect(out.files[0].symbols[0].field_decorators).toEqual(["pkg:class-validator#IsUUID"]);
  });

  it("slim facts keep what a binding is built on (facts schema 7)", () => {
    const sym = { name: "bookingsProcedure", kind: "const" as const, exported_as: ["bookingsProcedure"], line: 3, wraps: [], derives_from: "server/p.ts#authedProcedure.input().use()" };
    const out = slimFacts({ schema_version: 7, skipped: [], files: [{ path: "a.ts", lang: "ts", package: "", parse_ok: true, directives: [], imports: [], symbols: [sym, { ...sym, name: "plain", derives_from: undefined }], entry_points: [] }] });
    expect(out.files[0].symbols[0].derives_from).toBe("server/p.ts#authedProcedure.input().use()");
    expect(out.files[0].symbols[1]).not.toHaveProperty("derives_from");
    expect(checkFacts(facts(7), null).schema_version).toBe(7);
  });

  it("slim facts keep what made a function value (#91 `made_by`), and the drawer names it beside \"built on\"", () => {
    const sym = { name: "GET", kind: "function" as const, exported_as: ["GET"], line: 7, wraps: [], made_by: "apps/web/lib/api.ts#defaultResponderForAppDir" };
    const out = slimFacts({ schema_version: 9, skipped: [], files: [{ path: "app/api/x/route.ts", lang: "ts", package: "", parse_ok: true, directives: [], imports: [], symbols: [sym, { ...sym, name: "plain", kind: "const" as const, made_by: undefined }], entry_points: [] }] });
    expect(out.files[0].symbols[0]).toMatchObject({ kind: "function", made_by: "apps/web/lib/api.ts#defaultResponderForAppDir" });
    expect(out.files[0].symbols[1]).not.toHaveProperty("made_by");
    const tag = madeByTag(sym.made_by);
    expect(tag.label).toBe("made by defaultResponderForAppDir()");
    expect(tag.title).toContain("apps/web/lib/api.ts#defaultResponderForAppDir");
    expect(tag.title).toContain("returns a function");
    expect(madeByTag("pkg:next-auth#default").label).toBe("made by next-auth()");
  });

  it("says what a handler does with input: reads, none, or unknown when neither fact is there", () => {
    expect(inputOf({ controls: ["reads_input"] })).toBe("reads");
    expect(inputOf({ controls: ["no_input"] })).toBe("none");
    expect(inputOf({})).toBe("unknown");
    expect(INPUT_LABEL.unknown.label).toBe("input unknown");
  });

  it("the acme fixture has both facts, from the real binary", () => {
    const f = acmeFacts();
    // Regenerated with the current binary: its facts schema (drift-core FACTS_SCHEMA_VERSION), which SUPPORTED_FACTS reads.
    const rust = readFileSync(join(__dirname, "../../../../crates/drift-core/src/facts.rs"), "utf8").match(/FACTS_SCHEMA_VERSION: u32 = (\d+);/)!;
    expect(f.schema_version).toBe(Number(rust[1]));
    expect(SUPPORTED_FACTS).toContain(f.schema_version);
    const all = f.files.flatMap((x) => x.symbols.map(inputOf));
    expect(all).toContain("reads");
    expect(all).toContain("none");
  });
});
