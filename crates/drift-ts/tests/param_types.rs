//! Parameter-type facts: whether the callee's declared parameter type requires
//! each object key a call passes (`Symbol::arg_types`). One assertion per type
//! shape the resolver reads, and per shape it must leave unknown.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use drift_core::RepoFacts;
use drift_ts::{ScanOptions, scan, scan_file};

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/param-types")
}

fn scan_at(root: &Path, threads: usize) -> RepoFacts {
    scan(
        root,
        &ScanOptions {
            cache_dir: None,
            threads,
        },
    )
    .expect("scan")
    .0
}

/// `callee@i:key` -> requirement, for one symbol.
fn kinds(r: &RepoFacts, path: &str, symbol: &str) -> BTreeMap<String, String> {
    let f = r.files.iter().find(|f| f.path == path).expect("file");
    let s = f.symbols.iter().find(|s| s.name == symbol).expect("symbol");
    assert_eq!(s.arg_types.len(), s.args.len(), "one entry per passed key");
    s.arg_types
        .iter()
        .map(|a| {
            let (k, v) = a.rsplit_once('=').expect("kind");
            (k.to_string(), v.to_string())
        })
        .collect()
}

const C: &str = "src/lib/callees.ts#";

fn assert_kinds(got: &BTreeMap<String, String>, callee: &str, want: &[(&str, &str)]) {
    for (key, kind) in want {
        let k = format!("{callee}@0:{key}");
        assert_eq!(
            got.get(&k).map(String::as_str),
            Some(*kind),
            "{k} in {got:#?}"
        );
    }
}

#[test]
fn inline_object_types_and_undefined_members() {
    let r = scan_at(&fixture(), 0);
    let k = kinds(&r, "src/app/use.ts", "callsTyped");
    // `c: string | undefined` and an alias of `string | undefined` are optional.
    assert_kinds(
        &k,
        &format!("{C}inline"),
        &[
            ("a", "required"),
            ("b", "optional"),
            ("c", "optional"),
            ("d", "optional"),
        ],
    );
}

#[test]
fn interfaces_through_a_barrel_with_extends_and_nested_keys() {
    let r = scan_at(&fixture(), 0);
    let k = kinds(&r, "src/app/use.ts", "callsTyped");
    assert_kinds(
        &k,
        &format!("{C}withInterface"),
        &[
            ("id", "required"), // from `extends BaseOpts`
            ("label", "optional"),
            ("name", "required"),
            ("note", "optional"),
            ("meta", "optional"),
            ("meta.trace", "optional"), // inside an optional object
            ("where", "required"),
            ("where.tenantId", "required"),
            ("where.deleted", "optional"),
        ],
    );
    // `O.BaseOpts` on a namespace import.
    assert_kinds(
        &k,
        &format!("{C}withNamespace"),
        &[("id", "required"), ("label", "optional")],
    );
}

#[test]
fn aliases_utility_types_and_intersections() {
    let r = scan_at(&fixture(), 0);
    let k = kinds(&r, "src/app/use.ts", "callsTyped");
    assert_kinds(
        &k,
        &format!("{C}withAlias"),
        &[
            ("kind", "required"),
            ("size", "required"),
            ("extra", "optional"),
        ],
    );
    assert_kinds(
        &k,
        &format!("{C}withPartial"),
        &[("id", "optional"), ("name", "optional")],
    );
    assert_kinds(
        &k,
        &format!("{C}withRequired"),
        &[("id", "required"), ("label", "required")],
    );
    // `Pick<Opts, Keys | "note">` with the keys from an alias of a literal union.
    assert_kinds(
        &k,
        &format!("{C}withPick"),
        &[
            ("id", "required"),
            ("name", "required"),
            ("note", "optional"),
        ],
    );
    assert_kinds(
        &k,
        &format!("{C}withOmit"),
        &[("id", "required"), ("where.tenantId", "required")],
    );
    // `size` is required on one side and optional on the other: required.
    assert_kinds(
        &k,
        &format!("{C}withIntersection"),
        &[
            ("kind", "required"),
            ("size", "required"),
            ("color", "required"),
        ],
    );
}

#[test]
fn generics_whose_property_set_does_not_depend_on_the_argument() {
    let r = scan_at(&fixture(), 0);
    let k = kinds(&r, "src/app/use.ts", "callsTyped");
    for callee in ["withGeneric", "withBound"] {
        assert_kinds(
            &k,
            &format!("{C}{callee}"),
            &[
                ("value", "required"),
                ("tag", "required"),
                ("maybe", "optional"),
            ],
        );
    }
    // A destructuring default makes a key optional whatever the type says.
    assert_kinds(
        &k,
        &format!("{C}createState"),
        &[
            ("key", "required"),
            ("defaultValue", "required"),
            ("persist", "optional"),
        ],
    );
}

#[test]
fn classes_methods_and_declaration_files() {
    let r = scan_at(&fixture(), 0);
    let k = kinds(&r, "src/app/use.ts", "callsTyped");
    // A class used as a type: its public fields, initialised or not.
    assert_kinds(
        &k,
        &format!("{C}withDto"),
        &[
            ("title", "required"),
            ("body", "optional"),
            ("draft", "required"),
        ],
    );
    // An enum and a lib type are never `undefined`.
    assert_kinds(
        &k,
        &format!("{C}withEnum"),
        &[
            ("region", "required"),
            ("at", "required"),
            ("when", "optional"),
        ],
    );
    assert_kinds(
        &k,
        "src/lib/service.ts#Service.build",
        &[("region", "required"), ("zone", "optional")],
    );
    // In-repo `.d.ts` files are not scanned but are read for types.
    assert_kinds(
        &k,
        "src/lib/ambient.d.ts#fromDts",
        &[("x", "required"), ("y", "optional")],
    );
    // A method reached through constructor injection (`this.service.create`).
    let k = kinds(&r, "src/app/use.ts", "Controller");
    assert_kinds(
        &k,
        "src/lib/service.ts#Service.create",
        &[("workspaceId", "required"), ("dryRun", "optional")],
    );
}

#[test]
fn everything_else_is_unknown() {
    let r = scan_at(&fixture(), 0);
    let k = kinds(&r, "src/app/use.ts", "callsUnknown");
    let unknown = [
        format!("{C}withUnion@0:a"),
        format!("{C}untyped@0:a"),
        format!("{C}rest@0:a"),
        format!("{C}overloaded@0:a"),
        format!("{C}withMapped@0:x"),
        format!("{C}withPrivate@0:visible"),
        format!("{C}withExternal@0:anything"),
        // A property typed by an uninstalled package's type may alias `undefined`.
        format!("{C}withExternalProp@0:ext"),
        // A key the type does not list, allowed by its index signature.
        format!("{C}withLoose@0:other"),
        format!("{C}wrapped@0:a"),
        "src/lib/legacy.js#fromJs@0:a".to_string(),
    ];
    for u in &unknown {
        assert_eq!(k.get(u).map(String::as_str), Some("unknown"), "{u}");
    }
    assert_eq!(k[&format!("{C}withExternalProp@0:plain")], "required");
    assert_eq!(k[&format!("{C}withLoose@0:known")], "required");
}

#[test]
fn output_is_deterministic_across_thread_counts() {
    let a = serde_json::to_string(&scan_at(&fixture(), 1)).unwrap();
    let b = serde_json::to_string(&scan_at(&fixture(), 8)).unwrap();
    assert_eq!(a, b);
}

#[test]
fn single_file_scan_has_the_same_parameter_types() {
    let cache = tempfile::tempdir().unwrap();
    let opts = ScanOptions {
        cache_dir: Some(cache.path().to_path_buf()),
        threads: 0,
    };
    let full = scan(&fixture(), &opts).unwrap().0;
    let one = scan_file(&fixture(), &opts, "src/app/use.ts")
        .unwrap()
        .expect("indexed");
    let want = full.files.iter().find(|f| f.path == "src/app/use.ts");
    assert_eq!(one.files.first(), want);
}

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// A package's declaration files are read when `node_modules` is installed, and
/// the same calls are unknown when it is not.
#[test]
fn installed_package_declarations_are_read() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "app" }"#);
    write(
        r,
        "src/use.ts",
        "import { makeTable } from \"fake-lib\";\n\
         export const users = () => makeTable({ name: \"users\", schema: \"s\", ttl: 1 });\n",
    );
    let before = scan_at(r, 0);
    assert_eq!(
        kinds(&before, "src/use.ts", "users")["pkg:fake-lib#makeTable@0:name"],
        "unknown"
    );
    write(
        r,
        "node_modules/fake-lib/package.json",
        r#"{ "name": "fake-lib", "main": "dist/index.js", "types": "dist/index.d.ts" }"#,
    );
    write(
        r,
        "node_modules/fake-lib/dist/index.js",
        "exports.makeTable = () => {};\n",
    );
    write(
        r,
        "node_modules/fake-lib/dist/index.d.ts",
        "export * from \"./table.js\";\n",
    );
    write(
        r,
        "node_modules/fake-lib/dist/table.d.ts",
        "import type { Base } from \"./base.js\";\n\
         export interface TableConfig extends Base { name: string; ttl?: number }\n\
         export declare function makeTable(config: TableConfig): void;\n",
    );
    write(
        r,
        "node_modules/fake-lib/dist/base.d.ts",
        "export type Base = { schema: string | undefined };\n",
    );
    let after = scan_at(r, 0);
    let k = kinds(&after, "src/use.ts", "users");
    assert_eq!(k["pkg:fake-lib#makeTable@0:name"], "required");
    assert_eq!(k["pkg:fake-lib#makeTable@0:schema"], "optional");
    assert_eq!(k["pkg:fake-lib#makeTable@0:ttl"], "optional");
}

/// Installed declaration files are lowered once and cached like scanned files: a warm
/// scan reads them from the cache and finds the same parameter types, and an edited
/// declaration file is lowered again (the entry is keyed by content).
#[test]
fn installed_declarations_are_cached_by_content() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let cache = tempfile::tempdir().unwrap();
    let opts = ScanOptions {
        cache_dir: Some(cache.path().to_path_buf()),
        threads: 0,
    };
    write(r, "package.json", r#"{ "name": "app" }"#);
    write(
        r,
        "src/use.ts",
        "import { makeTable } from \"fake-lib\";\n\
         export const users = () => makeTable({ name: \"users\", ttl: 1 });\n",
    );
    write(
        r,
        "node_modules/fake-lib/package.json",
        r#"{ "name": "fake-lib", "types": "index.d.ts" }"#,
    );
    let table = |ttl: &str| {
        format!(
            "export interface TableConfig {{ name: string; ttl{ttl}: number }}\n\
             export declare function makeTable(config: TableConfig): void;\n"
        )
    };
    write(r, "node_modules/fake-lib/index.d.ts", &table("?"));
    let entries = || {
        walkdir(cache.path())
            .into_iter()
            .filter(|p| p.to_string_lossy().contains("/ts-types-"))
            .count()
    };
    let cold = scan(r, &opts).unwrap().0;
    assert_eq!(entries(), 1, "the declaration file's types are cached");
    let warm = scan(r, &opts).unwrap().0;
    assert_eq!(cold, warm);
    assert_eq!(entries(), 1);
    assert_eq!(
        kinds(&warm, "src/use.ts", "users")["pkg:fake-lib#makeTable@0:ttl"],
        "optional"
    );
    write(r, "node_modules/fake-lib/index.d.ts", &table(""));
    let edited = scan(r, &opts).unwrap().0;
    assert_eq!(
        kinds(&edited, "src/use.ts", "users")["pkg:fake-lib#makeTable@0:ttl"],
        "required"
    );
    assert_eq!(entries(), 2);
    assert_eq!(edited, scan_at(r, 0), "the same facts as an uncached scan");
}

/// Every file below `dir`.
fn walkdir(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walkdir(&p));
        } else {
            out.push(p);
        }
    }
    out
}

/// Two copies of one package, installed for two workspace directories, declare
/// different parameter types: each file reads the copy its own directory resolves
/// to, however many files of a directory call it (the package's declarations are
/// looked up once per directory and specifier).
#[test]
fn each_directory_reads_the_package_copy_it_resolves_to() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "app" }"#);
    for (d, field) in [("a", "name: string"), ("b", "name?: string")] {
        write(
            r,
            &format!("{d}/node_modules/lib/package.json"),
            r#"{ "name": "lib", "types": "index.d.ts" }"#,
        );
        write(
            r,
            &format!("{d}/node_modules/lib/index.d.ts"),
            &format!("export declare function make(config: {{ {field} }}): void;\n"),
        );
        for f in ["x", "y"] {
            write(
                r,
                &format!("{d}/src/{f}.ts"),
                &format!(
                    "import {{ make }} from \"lib\";\nexport const {f} = () => make({{ name: \"n\" }});\n"
                ),
            );
        }
    }
    for threads in [1, 0] {
        let facts = scan_at(r, threads);
        for (d, want) in [("a", "required"), ("b", "optional")] {
            for f in ["x", "y"] {
                let k = kinds(&facts, &format!("{d}/src/{f}.ts"), f);
                assert_eq!(k["pkg:lib#make@0:name"], want, "{d}/src/{f}.ts");
            }
        }
    }
}

fn copy_dir(from: &Path, to: &Path) {
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let name = e.file_name();
        // The repository ignores `node_modules`; fixtures keep theirs as `_node_modules`.
        let target = to.join(if name == "_node_modules" {
            "node_modules".into()
        } else {
            name
        });
        if e.file_type().unwrap().is_dir() {
            std::fs::create_dir_all(&target).unwrap();
            copy_dir(&e.path(), &target);
        } else {
            std::fs::copy(e.path(), &target).unwrap();
        }
    }
}

/// Shapes that once came out wrong (review of #34), on a fixture that type-checks
/// cleanly; `eval/oracle/fixtures.mjs` checks every key of it against the compiler.
#[test]
fn tricky_shapes_are_right_or_unknown() {
    let dir = tempfile::tempdir().unwrap();
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/param-types-tricky"),
        dir.path(),
    );
    let r = scan_at(dir.path(), 0);
    let k = kinds(&r, "src/app/use.ts", "run");
    let want = [
        // A defaulted type parameter takes its default (`<T = undefined>`).
        ("src/lib/callees.ts#gdef@0:a", "optional"),
        ("src/lib/callees.ts#gdef2@0:a", "optional"),
        ("src/lib/callees.ts#gdef3@0:a", "required"),
        ("src/lib/callees.ts#gdef3@0:b", "optional"),
        ("pkg:fakepkg#pf@0:g", "optional"),
        ("pkg:fakepkg#pf@0:a", "required"),
        // Accessors are typed by their annotations.
        ("src/lib/callees.ts#getter@0:name", "optional"),
        ("src/lib/callees.ts#setter@0:v", "optional"),
        ("src/lib/callees.ts#ifaceGetter@0:label", "optional"),
        ("pkg:fakepkg#pcf@0:label", "optional"),
        ("pkg:fakepkg#pcf@0:size", "required"),
        // Homomorphic mapped types keep their argument's `undefined`.
        ("src/lib/callees.ts#mappedUndef@0:r", "optional"),
        ("src/lib/callees.ts#mappedUndef@0:p", "optional"),
        ("src/lib/callees.ts#mappedUndef@0:q", "optional"),
        // `Pick` maps over keys: an object even over `X | undefined`.
        ("src/lib/callees.ts#mappedUndef@0:s", "required"),
        // A declaration the barrel does not export does not shadow its `export *`.
        ("src/lib/callees.ts#shadowed@0:k", "optional"),
        ("src/lib/callees.ts#shadowed@0:j", "required"),
        // `import Inner = NS.Inner` is not read: unknown.
        ("src/lib/callees.ts#importEq@0:a", "unknown"),
        // `Omit` over an index signature keeps no named property.
        ("src/lib/callees.ts#omitOpen@0:b", "unknown"),
        // `export =` is not read.
        ("src/lib/legacy.d.ts#default@0:a", "unknown"),
    ];
    for (key, kind) in want {
        assert_eq!(
            k.get(key).map(String::as_str),
            Some(kind),
            "{key} in {k:#?}"
        );
    }
}

/// Scan `root` on another thread; fail when it takes longer than `secs`.
fn scan_within(root: &Path, secs: u64) -> RepoFacts {
    let (tx, rx) = std::sync::mpsc::channel();
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let _ = tx.send(scan_at(&root, 0));
    });
    rx.recv_timeout(std::time::Duration::from_secs(secs))
        .expect("the scan finishes")
}

/// Modules that `export *` each other, and interfaces that extend each other, end
/// in unknown rather than in an exponential walk.
#[test]
fn cycles_end_in_unknown_quickly() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "cycles" }"#);
    for (me, others) in [
        ("a", ["b", "c", "d"]),
        ("b", ["a", "c", "d"]),
        ("c", ["a", "b", "d"]),
        ("d", ["a", "b", "c"]),
    ] {
        let mut body: String = others
            .iter()
            .map(|o| format!("export * from \"./{o}\";\n"))
            .collect();
        body.push_str(&format!("export const v_{me} = 1;\n"));
        write(r, &format!("src/{me}.ts"), &body);
    }
    write(
        r,
        "src/use.ts",
        "import type { Missing } from \"./a\";\n\
         export function f(o: { k: Missing; n: string }) { return o; }\n\
         export function g() { f({ k: 1 as never, n: \"\" }); }\n",
    );
    write(
        r,
        "src/ext.ts",
        "export interface A extends B, C { a: string }\n\
         export interface B extends A, C { b: string }\n\
         export interface C extends A, B { c: string }\n\
         export function h(o: A) { return o; }\n\
         export function i() { h({ a: \"x\", b: \"y\", c: \"z\" } as never); }\n",
    );
    let facts = scan_within(r, 30);
    let k = kinds(&facts, "src/use.ts", "g");
    assert_eq!(k["src/use.ts#f@0:k"], "unknown");
    assert_eq!(k["src/use.ts#f@0:n"], "required");
    let k = kinds(&facts, "src/ext.ts", "i");
    assert_eq!(k["src/ext.ts#h@0:a"], "unknown");
}

/// Declaration files are read only inside the repository root: not through a
/// package symlinked from outside (`npm link`), nor through an absolute specifier.
#[cfg(unix)]
#[test]
fn declarations_outside_the_root_are_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let outside = dir.path().join("outside");
    write(
        &outside,
        "linked/package.json",
        r#"{ "name": "linked", "types": "index.d.ts" }"#,
    );
    write(
        &outside,
        "linked/index.d.ts",
        "export declare function lf(o: { a: string }): void;\n",
    );
    write(
        &outside,
        "secret.d.ts",
        "export declare function sf(o: { a: string }): void;\n",
    );
    let r = dir.path().join("repo");
    write(&r, "package.json", r#"{ "name": "app" }"#);
    std::fs::create_dir_all(r.join("node_modules")).unwrap();
    std::os::unix::fs::symlink(outside.join("linked"), r.join("node_modules/linked")).unwrap();
    write(
        &r,
        "node_modules/escape/package.json",
        r#"{ "name": "escape", "types": "index.d.ts" }"#,
    );
    write(
        &r,
        "node_modules/escape/index.d.ts",
        &format!("export * from \"{}\";\n", outside.join("secret").display()),
    );
    write(
        &r,
        "src/use.ts",
        "import { lf } from \"linked\";\nimport { sf } from \"escape\";\n\
         export function g() { lf({ a: \"x\" }); sf({ a: \"x\" }); }\n",
    );
    let facts = scan_at(&r, 0);
    let k = kinds(&facts, "src/use.ts", "g");
    assert_eq!(k["pkg:linked#lf@0:a"], "unknown");
    assert_eq!(k["pkg:escape#sf@0:a"], "unknown");
}

/// Shapes from the second review of #34: declaration files' implicit exports,
/// `any`/`unknown` in unions and intersections, augmentations, `this` parameters,
/// method shorthand and default-imported package functions.
#[test]
fn second_review_shapes_are_right_or_unknown() {
    let dir = tempfile::tempdir().unwrap();
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/param-types-review2"),
        dir.path(),
    );
    let r = scan_at(dir.path(), 0);
    let k = kinds(&r, "src/app/use.ts", "run");
    let c = "src/lib/callees.ts#";
    let want = [
        // A `.d.ts` with an export declaration exports only what it lists: the
        // local interface does not shadow `export *`.
        ("dshadow@0:k", "optional"),
        ("dbundle@0:k", "optional"),
        ("q9@0:k", "optional"),
        // `export *` sources that disagree.
        ("conflict@0:k", "unknown"),
        // `unknown` is the identity of an intersection; `any`/`unknown` absorb a union.
        ("iu@0:a", "optional"),
        ("iu2@0:a", "optional"),
        ("iu4@0:a", "optional"),
        ("iu5@0:a", "optional"),
        ("iu6@0:a", "optional"),
        ("uu@0:a", "required"),
        ("ua@0:a", "required"),
        ("plain@0:a", "required"),
        ("plain@0:b", "required"),
        ("withTop@0:a", "required"),
        // An augmentation may give `AugO` an index signature.
        ("omitAug@0:b", "unknown"),
        ("pickAug@0:b", "unknown"),
        ("omitPlain@0:b", "required"),
        ("th@0:a", "required"),
        ("th@0:b", "optional"),
        ("a9@0:n", "required"),
        ("a9@0:g", "optional"),
    ];
    for (key, kind) in want {
        let key = format!("{c}{key}");
        assert_eq!(
            k.get(&key).map(String::as_str),
            Some(kind),
            "{key} in {k:#?}"
        );
    }
    for (key, kind) in [
        ("pkg:fakepkg#default@0:a", "required"),
        ("pkg:fakepkg#default@0:b", "optional"),
        // The package's own call uses its local `BOpts`.
        ("pkg:fakepkg/bundle#bf@0:k", "required"),
    ] {
        assert_eq!(
            k.get(key).map(String::as_str),
            Some(kind),
            "{key} in {k:#?}"
        );
    }
}

/// A barrel that `export *`s thousands of modules (openapi-generator's
/// `models/index.ts`) builds its export table once, not once per name.
#[test]
fn wide_barrels_stay_linear() {
    const MODELS: usize = 3000;
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "api" }"#);
    let mut index = String::new();
    let mut api = String::from("import type {");
    for i in 0..MODELS {
        write(
            r,
            &format!("src/models/Model{i}.ts"),
            &format!(
                "export interface Model{i} {{ id: string; name?: string; tag: string | undefined }}\n"
            ),
        );
        index.push_str(&format!("export * from \"./Model{i}\";\n"));
        api.push_str(&format!("\n  Model{i},"));
    }
    api.push_str("\n} from \"../models/index\";\n");
    for i in 0..MODELS {
        api.push_str(&format!(
            "interface Create{i}Request {{ body: Model{i}; dryRun?: boolean }}\n\
             export function create{i}(req: Create{i}Request) {{ return req; }}\n"
        ));
    }
    api.push_str("export function run() {\n");
    for i in 0..MODELS {
        api.push_str(&format!(
            "  create{i}({{ body: {{ id: \"\", name: \"\", tag: undefined }}, dryRun: true }});\n"
        ));
    }
    api.push_str("}\n");
    write(r, "src/models/index.ts", &index);
    write(r, "src/apis/Api.ts", &api);
    let started = std::time::Instant::now();
    let facts = scan_within(r, 120);
    let k = kinds(&facts, "src/apis/Api.ts", "run");
    assert_eq!(k["src/apis/Api.ts#create7@0:body.id"], "required");
    assert_eq!(k["src/apis/Api.ts#create7@0:body.tag"], "optional");
    assert_eq!(k["src/apis/Api.ts#create2999@0:dryRun"], "optional");
    // A quadratic walk took about 28 s here in a debug build; linear is well under.
    assert!(
        started.elapsed() < std::time::Duration::from_secs(15),
        "{:?}",
        started.elapsed()
    );
}

/// What a parameter requires of a passed key is remembered per callee, parameter and
/// key: two callees whose parameters require the same keys the opposite way, a second
/// parameter, and nested keys under both, each called from several files (at 1 and 4
/// threads), all keep their own answers.
#[test]
fn remembered_requirements_are_per_parameter_and_key() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let write = |rel: &str, text: &str| {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().expect("parent")).expect("mkdir");
        std::fs::write(p, text).expect("write");
    };
    write("package.json", r#"{ "name": "memo" }"#);
    write(
        "src/callees.ts",
        "export function f(o: { a: { x: number; y?: number }; b?: string }, p: { a?: number }) {}\n\
         export function g(o: { a?: { x?: number; y: number }; b: string }) {}\n",
    );
    let call =
        "f({ a: { x: 1, y: 2 }, b: \"\" }, { a: 1 });\n  g({ a: { x: 1, y: 2 }, b: \"\" });\n";
    for i in 0..4 {
        write(
            &format!("src/use{i}.ts"),
            &format!(
                "import {{ f, g }} from \"./callees\";\nexport function run{i}() {{\n  {call}  {call}}}\n"
            ),
        );
    }
    let f = "src/callees.ts#f";
    let g = "src/callees.ts#g";
    for threads in [1, 4] {
        let r = scan_at(root, threads);
        for i in 0..4 {
            let k = kinds(&r, &format!("src/use{i}.ts"), &format!("run{i}"));
            let want = [
                (format!("{f}@0:a"), "required"),
                (format!("{f}@0:a.x"), "required"),
                (format!("{f}@0:a.y"), "optional"),
                (format!("{f}@0:b"), "optional"),
                (format!("{f}@1:a"), "optional"),
                (format!("{g}@0:a"), "optional"),
                (format!("{g}@0:a.x"), "optional"),
                // Inside an optional object.
                (format!("{g}@0:a.y"), "optional"),
                (format!("{g}@0:b"), "required"),
            ];
            for (key, kind) in &want {
                assert_eq!(
                    k.get(key).map(String::as_str),
                    Some(*kind),
                    "{key} in {k:#?}"
                );
            }
        }
    }
}
