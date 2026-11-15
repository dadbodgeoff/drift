// Symbol traits (`Symbol.traits` in drift scan): kinds of class and the purpose facts
// `subclassed` and `test_helper` (#35). The Studio keeps them in slim facts and shows them
// in the code drawer and on the map, with what each means.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYMBOL_TRAIT, symbolTrait } from "@/entities/facts";
import { slimFacts } from "@/shared/contract/slim";
import { facts } from "./helpers";

const src = (p: string) => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");

describe("symbol traits (#35)", () => {
  it("every trait Drift defines (facts.rs `pub mod traits`) has a label and a meaning", () => {
    const text = src("crates/drift-core/src/facts.rs");
    const start = text.indexOf("pub mod traits {");
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf("\n}\n", start));
    const traits = [...body.matchAll(/pub const [A-Z_]+: &str = "([a-z_]+)";/g)].map((m) => m[1]);
    expect(traits).toEqual(expect.arrayContaining(["abstract", "subclassed", "test_helper"]));
    expect(traits.filter((t) => !(t in SYMBOL_TRAIT)), "add these to entities/facts SYMBOL_TRAIT").toEqual([]);
  });

  it("marks the purpose facts, and shows an unknown trait as Drift spells it", () => {
    expect(symbolTrait("test_helper")).toMatchObject({ label: "test helper", purpose: true });
    expect(symbolTrait("subclassed").purpose).toBe(true);
    expect(symbolTrait("abstract").purpose).toBeUndefined();
    expect(symbolTrait("brand_new").label).toBe("brand_new");
  });

  it("slim facts keep traits", () => {
    const sym = { name: "FakeClock", kind: "class" as const, exported_as: ["FakeClock"], line: 1, wraps: [], traits: ["test_helper"] };
    const out = slimFacts({ schema_version: 4, skipped: [], files: [{ path: "a.py", lang: "py", package: "", parse_ok: true, directives: [], imports: [], symbols: [sym, { ...sym, name: "Clock", traits: [] }], entry_points: [] }] });
    expect(out.files[0].symbols[0].traits).toEqual(["test_helper"]);
    expect("traits" in out.files[0].symbols[1]).toBe(false);
  });

  it("the acme fixture has both new traits, from the real binary", () => {
    const syms = facts().files.flatMap((f) => f.symbols.map((s) => ({ path: f.path, ...s })));
    expect(syms.find((s) => s.name === "FakeClock")?.traits).toEqual(["test_helper"]);
    expect(syms.find((s) => s.name === "Gateway" && s.path.endsWith("gateway.py"))?.traits).toEqual(expect.arrayContaining(["abstract", "subclassed"]));
  });
});
