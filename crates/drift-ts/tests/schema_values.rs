//! What builds a value (TS `LOWERING_VERSION` 37): a schema library's chain is a schema
//! value, whatever callbacks its steps take (`z.object({...}).refine((v) => ...)`), not a
//! function wrapped in calls; values built from literals and built-ins only are plain
//! values; and a module of types only says so (`FileFacts::type_only`).

use std::path::Path;

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, traits};
use drift_ts::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn symbol<'a>(r: &'a RepoFacts, path: &str, name: &str) -> &'a Symbol {
    file(r, path)
        .symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {path}"))
}

fn has(s: &Symbol, t: &str) -> bool {
    s.traits.iter().any(|x| x == t)
}

const SCHEMAS: &str = r#"
import { z } from "zod";
import * as yup from "yup";
import { withAuth } from "./auth";

export const MemberIdsSchema = z
  .object({ ids: z.array(z.string()) })
  .refine((v) => v.ids.length > 0, { message: "empty" })
  .refine((v) => new Set(v.ids).size === v.ids.length);
export const SuperSchema = z.object({ a: z.string() }).superRefine((v, ctx) => {
  if (!v.a) ctx.addIssue({ code: "custom", message: "a" });
});
export const DescriptionSchema = z
  .string()
  .trim()
  .max(10)
  .regex(/x/)
  .transform((d) => d || null);
export const Tree = z.lazy(() => z.object({ child: Tree }));
export const ExtendedSchema = MemberIdsSchema.and(z.object({ b: z.number() })).refine(
  (v) => v.b > 0,
);
export const YupSchema = yup.string().test("x", "y", (v) => !!v);
export const Implemented = z
  .function()
  .args(z.string())
  .implement((s) => s.length);
export const handler = withAuth(async (req: any) => req);
export const guarded = withAuth(z.object({ a: z.string() }).refine((v) => !!v.a));
export const ZGenericSuccessResponse = { success: true } as const;
export const commandSchemas = [MemberIdsSchema, SuperSchema];
export const TOOLS = { one: 1, two: 2 };
export const TOOL_NAMES = Object.keys(TOOLS);
export const frozen = Object.freeze({ a: 1 });
export const LIMIT = -1;
export const made = makeThing();
function makeThing() {
  return { a: 1 };
}
"#;

#[test]
fn a_schema_chain_with_callbacks_is_a_schema_value_not_a_function() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "src/schemas.ts", SCHEMAS);
    write(
        r,
        "src/auth.ts",
        "export const withAuth = (h: any) => async (req: any) => h(req);\n",
    );
    let facts = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let p = "src/schemas.ts";
    for name in [
        "MemberIdsSchema",
        "SuperSchema",
        "DescriptionSchema",
        "Tree",
        "ExtendedSchema",
        "YupSchema",
    ] {
        let s = symbol(&facts, p, name);
        assert_eq!(s.kind, SymbolKind::Const, "{name}");
        assert!(s.wraps.is_empty(), "{name}: {:?}", s.wraps);
        assert!(has(s, traits::SCHEMA_VALUE), "{name}: {:?}", s.traits);
        assert!(!has(s, traits::PLAIN_VALUE), "{name}");
    }
    // A schema step that makes a function of the schema: what it binds is a function.
    let implemented = symbol(&facts, p, "Implemented");
    assert_eq!(implemented.kind, SymbolKind::Function);
    assert!(!has(implemented, traits::SCHEMA_VALUE));
    // A team's wrapper of a function is still one.
    let handler = symbol(&facts, p, "handler");
    assert_eq!(handler.kind, SymbolKind::Function);
    assert!(handler.traits.is_empty(), "{:?}", handler.traits);
    // A schema handed to a wrapper is no function it wraps (what `withAuth` returns
    // is another matter: `made_by`).
    let guarded = symbol(&facts, p, "guarded");
    assert!(guarded.wraps.is_empty(), "{:?}", guarded.wraps);
    assert!(!has(guarded, traits::SCHEMA_VALUE));
    for name in [
        "ZGenericSuccessResponse",
        "commandSchemas",
        "TOOLS",
        "TOOL_NAMES",
        "frozen",
        "LIMIT",
    ] {
        let s = symbol(&facts, p, name);
        assert!(has(s, traits::PLAIN_VALUE), "{name}: {:?}", s.traits);
        assert!(!has(s, traits::SCHEMA_VALUE), "{name}");
    }
    // Made by the repo's own code: neither.
    assert!(symbol(&facts, p, "made").traits.is_empty());
}

#[test]
fn a_module_of_types_only_is_type_only() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let cases: &[(&str, &str, bool)] = &[
        (
            "src/types.ts",
            "import type { A } from \"./a\";\nexport interface B { a: A }\nexport type C = B[];\n",
            true,
        ),
        (
            "src/server-types.ts",
            "import \"server-only\";\nimport { A } from \"./a\";\ninterface I { a: A }\nexport type { I };\nexport { I as J };\n",
            true,
        ),
        (
            "src/ambient.ts",
            "declare global { interface Window { x: number } }\ndeclare const y: number;\nexport type Z = typeof y;\n",
            true,
        ),
        (
            "src/reexport-types.ts",
            "export type { A } from \"./a\";\nexport type Q = 1;\n",
            true,
        ),
        (
            "src/with-const.ts",
            "export type A = 1;\nexport const LIST = [1, 2] as const;\n",
            false,
        ),
        (
            "src/with-guard.ts",
            "export type A = { k: string };\nexport function isA(x: any): x is A { return !!x.k; }\n",
            false,
        ),
        (
            "src/with-enum.ts",
            "export enum E { A }\nexport type T = E;\n",
            false,
        ),
        (
            "src/barrel.ts",
            "export * from \"./a\";\nexport type T = 1;\n",
            false,
        ),
        (
            "src/value-reexport.ts",
            "export { a } from \"./a\";\nexport type T = 1;\n",
            false,
        ),
        (
            "src/local-value-export.ts",
            "import { a } from \"./a\";\nexport type T = 1;\nexport { a };\n",
            false,
        ),
        ("src/empty.ts", "import \"./a\";\n", false),
    ];
    write(
        r,
        "src/a.ts",
        "export const a = 1;\nexport type A = number;\n",
    );
    for (path, body, _) in cases {
        write(r, path, body);
    }
    let facts = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    for (path, _, want) in cases {
        assert_eq!(file(&facts, path).type_only, *want, "{path}");
    }
    assert!(!file(&facts, "src/a.ts").type_only);
}
