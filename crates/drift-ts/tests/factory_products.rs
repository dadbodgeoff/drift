//! Factory products (`drift_core::Symbol::made_by`): a value bound to a call is a
//! function only when the callee is proven to return one. Proven: the callee's
//! declared return type is a function type (in-repo source or a declaration file, an
//! installed package's included), or it is neither async nor a generator and every
//! `return` of its own body hands back a function. Anything else stays the value it
//! was, with no `made_by`.

use std::path::Path;

use drift_core::{RepoFacts, Symbol, SymbolKind};
use drift_ts::{ScanOptions, scan, scan_file};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn symbol<'a>(r: &'a RepoFacts, path: &str, name: &str) -> &'a Symbol {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
        .symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {path}"))
}

const FACTORIES: &str = r#"
const pick = (o: any) => o.fn;
export function createAuthWrapper(o: any) {
  return (handler: any) => async (req: any) => {
    if (!o.check(req)) throw new Error("no");
    return handler(req);
  };
}
export const conciseFactory = (o: any) => (h: any) => h(o);
export function namedInner(o: any) {
  async function inner(req: any) {
    return o(req);
  }
  return inner;
}
export function constInner(o: any) {
  const inner = (req: any) => o(req);
  if (!o) {
    return (req: any) => req;
  }
  return inner;
}
export function typedReturn(o: any): (h: any) => any {
  return pick(o);
}
export async function asyncFactory(o: any) {
  return () => o;
}
export const asyncArrow = async (o: any) => () => o;
export function* generatorFactory(o: any) {
  yield o;
  return () => o;
}
export function sometimesNull(o: any) {
  if (!o) return null;
  return () => o;
}
export function fallsThrough(o: any) {
  if (o) {
    return () => o;
  }
}
export function returnsCall(o: any) {
  return pick(() => o);
}
type Middleware = (h: any) => any;
export function namedType(o: any): Middleware {
  return pick(o);
}
export function letInner(o: any) {
  let inner = (req: any) => o(req);
  return inner;
}
export function nestedReturnOnly(o: any) {
  const make = () => {
    return () => o;
  };
  return make();
}
export function blockScopedName(o: any) {
  const inner = () => o;
  if (o) {
    const inner = 1;
    return inner;
  }
  return inner;
}
export function makeValue(n: number) {
  return { n };
}
"#;

const USE: &str = r#"
import {
  asyncArrow,
  asyncFactory,
  blockScopedName,
  conciseFactory,
  constInner,
  createAuthWrapper,
  fallsThrough,
  generatorFactory,
  letInner,
  makeValue,
  namedInner,
  namedType,
  nestedReturnOnly,
  returnsCall,
  sometimesNull,
  typedReturn,
} from "../lib/factories";
import { declared, declaredValue } from "../types/declared";
import { createHandler, createConfig } from "fake-factory";
const opts = { role: "user" };
export const withAuth = createAuthWrapper(opts);
export const withAdmin = createAuthWrapper({ role: "admin" });
export const GET = createAuthWrapper(opts);
export const SearchIcon = createAuthWrapper(opts);
export const viaConcise = conciseFactory(1);
export const viaNamedInner = namedInner(opts);
export const viaConstInner = constInner(opts);
export const viaTypedReturn = typedReturn(opts);
export const viaDeclared = declared(opts);
export const viaPackage = createHandler(opts);
export const notAsync = asyncFactory(opts);
export const notAsyncArrow = asyncArrow(opts);
export const notGenerator = generatorFactory(opts);
export const notSometimesNull = sometimesNull(opts);
export const notFallsThrough = fallsThrough(opts);
export const notReturnsCall = returnsCall(opts);
export const notNamedType = namedType(opts);
export const notLetInner = letInner(opts);
export const notNestedReturnOnly = nestedReturnOnly(opts);
export const notBlockScopedName = blockScopedName(opts);
export const notValue = makeValue(1);
export const notDeclaredValue = declaredValue(opts);
export const notPackageValue = createConfig(opts);
export const notAwaited = await createAuthWrapper(opts);
"#;

fn fixture(root: &Path) {
    write(root, "package.json", r#"{ "name": "app" }"#);
    write(root, "src/lib/factories.ts", FACTORIES);
    write(
        root,
        "src/types/declared.d.ts",
        "export declare function declared(o: any): (h: any) => any;\n\
         export declare function declaredValue(o: any): { n: number };\n",
    );
    write(
        root,
        "node_modules/fake-factory/package.json",
        r#"{ "name": "fake-factory", "types": "index.d.ts" }"#,
    );
    write(
        root,
        "node_modules/fake-factory/index.d.ts",
        "export declare function createHandler(o: any): ((req: any) => Promise<any>);\n\
         export declare function createConfig(o: any): Record<string, unknown>;\n",
    );
    write(root, "src/app/use.ts", USE);
}

const PROVEN: &[&str] = &[
    "withAuth",
    "withAdmin",
    "GET",
    "viaConcise",
    "viaNamedInner",
    "viaConstInner",
    "viaTypedReturn",
    "viaDeclared",
    "viaPackage",
];

const UNPROVEN: &[&str] = &[
    "SearchIcon",
    "notAsync",
    "notAsyncArrow",
    "notGenerator",
    "notSometimesNull",
    "notFallsThrough",
    "notReturnsCall",
    "notNamedType",
    "notLetInner",
    "notNestedReturnOnly",
    "notBlockScopedName",
    "notValue",
    "notDeclaredValue",
    "notPackageValue",
    "notAwaited",
];

#[test]
fn a_value_made_by_a_factory_proven_to_return_a_function_is_a_function() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fixture(r);
    let facts = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let use_ts = "src/app/use.ts";
    let lib = "src/lib/factories.ts#";
    let expect = |name: &str, made_by: &str| {
        let s = symbol(&facts, use_ts, name);
        assert_eq!(
            (s.kind, s.made_by.as_str()),
            (SymbolKind::Function, made_by),
            "{name}"
        );
    };
    expect("withAuth", &format!("{lib}createAuthWrapper"));
    // An object of options is no function the factory wraps: the call still makes one.
    expect("withAdmin", &format!("{lib}createAuthWrapper"));
    // A route's handler name is upper case, not PascalCase.
    expect("GET", &format!("{lib}createAuthWrapper"));
    expect("viaConcise", &format!("{lib}conciseFactory"));
    expect("viaNamedInner", &format!("{lib}namedInner"));
    expect("viaConstInner", &format!("{lib}constInner"));
    expect("viaTypedReturn", &format!("{lib}typedReturn"));
    let declared = symbol(&facts, use_ts, "viaDeclared");
    assert_eq!(declared.kind, SymbolKind::Function);
    assert!(
        declared.made_by.ends_with("#declared"),
        "{}",
        declared.made_by
    );
    expect("viaPackage", "pkg:fake-factory#createHandler");
    for name in PROVEN {
        assert!(!symbol(&facts, use_ts, name).made_by.is_empty(), "{name}");
    }
    for name in UNPROVEN {
        let s = symbol(&facts, use_ts, name);
        assert_eq!(
            (s.kind, s.made_by.as_str()),
            (SymbolKind::Const, ""),
            "{name} is not proven a function"
        );
    }
    // The factories themselves are untouched, and so is a value bound to no call.
    assert!(
        symbol(&facts, "src/lib/factories.ts", "createAuthWrapper")
            .made_by
            .is_empty()
    );
    assert_eq!(symbol(&facts, use_ts, "opts").kind, SymbolKind::Const);
}

#[test]
fn an_uninstalled_package_factory_is_not_proven() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fixture(r);
    std::fs::remove_dir_all(r.join("node_modules")).unwrap();
    let facts = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0;
    let s = symbol(&facts, "src/app/use.ts", "viaPackage");
    assert_eq!((s.kind, s.made_by.as_str()), (SymbolKind::Const, ""));
    // In-repo proofs do not depend on installed packages.
    assert_eq!(
        symbol(&facts, "src/app/use.ts", "withAuth").kind,
        SymbolKind::Function
    );
}

#[test]
fn a_javascript_factory_is_not_proven() {
    // Drift reads no declarations from JavaScript: a factory there proves nothing.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "app" }"#);
    write(
        r,
        "src/lib/make.js",
        "export function make(o) {\n  return (h) => h(o);\n}\n",
    );
    write(
        r,
        "src/app/use.ts",
        "import { make } from \"../lib/make\";\nexport const made = make(1);\n",
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
    let s = symbol(&facts, "src/app/use.ts", "made");
    assert_eq!((s.kind, s.made_by.as_str()), (SymbolKind::Const, ""));
}

#[test]
fn a_single_file_scan_proves_what_a_full_scan_proves() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fixture(r);
    let opts = ScanOptions {
        cache_dir: Some(r.join(".drift-cache")),
        threads: 1,
    };
    let full = scan(r, &opts).unwrap().0;
    let one = scan_file(r, &opts, "src/app/use.ts")
        .unwrap()
        .expect("indexed");
    let want = full.files.iter().find(|f| f.path == "src/app/use.ts");
    assert_eq!(one.files.first(), want);
    let s = symbol(&one, "src/app/use.ts", "withAdmin");
    assert_eq!(s.kind, SymbolKind::Function);
}
