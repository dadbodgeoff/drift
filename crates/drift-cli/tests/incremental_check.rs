//! `check` on the facts of a single-file scan (what the hooks use) must report what
//! `check` on a full scan reports for that file. Rules that follow in-repo base
//! chains ("extend Mailer" holds for `ZEmail extends MidEmail extends Mailer`) read
//! the base classes, which a single-file scan carries as context.

use std::collections::BTreeSet;
use std::path::Path;

use drift_mine::check::{Scope, check};
use drift_mine::mine::{MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_ts::{ScanOptions, scan, scan_file};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

#[test]
fn chained_subclass_checks_the_same_in_a_single_file_scan() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "app" }"#);
    write(
        r,
        "src/lib/mailer.ts",
        "export class Mailer {\n  send() {}\n}\n",
    );
    // A base re-exported through a barrel, extended across files.
    write(r, "src/lib/index.ts", "export * from \"./mailer\";\n");
    write(
        r,
        "src/emails/mid-email.ts",
        "import { Mailer } from \"../lib\";\nexport class MidEmail extends Mailer {}\n",
    );
    for i in 0..20 {
        write(
            r,
            &format!("src/emails/email-{i}.ts"),
            &format!(
                "import {{ Mailer }} from \"../lib\";\nexport class Email{i} extends Mailer {{}}\n"
            ),
        );
    }
    write(
        r,
        "src/emails/z-email.ts",
        "import { MidEmail } from \"./mid-email\";\nexport class ZEmail extends MidEmail {}\n",
    );
    // Other classes, so that extending Mailer is specific to emails.
    for i in 0..30 {
        write(
            r,
            &format!("src/models/model-{i}.ts"),
            &format!("export class Model{i} {{}}\n"),
        );
    }
    write(
        r,
        "src/emails/plain-email.ts",
        "export class PlainEmail {\n  send() {}\n}\n",
    );

    let cache = r.join(".drift-cache");
    let opts = ScanOptions {
        cache_dir: Some(cache),
        threads: 1,
    };
    let (full, _) = scan(r, &opts).unwrap();
    let mined = mine(&full, &MineOptions::default());
    let mailer = Rule::WrappedBy {
        kind: drift_core::WrapKind::Extends,
        any_of: vec!["src/lib/mailer.ts#Mailer".into()],
    };
    let c = mined
        .candidates
        .iter()
        .find(|c| c.rule == mailer)
        .expect("emails extend Mailer");
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    assert_eq!(
        outliers,
        ["PlainEmail"],
        "ZEmail follows the rule through MidEmail"
    );

    let mut policy = ConventionsFile::merge(None, "test", mined.kinds.clone(), &mined.candidates);
    for conv in &mut policy.conventions {
        conv.status = Status::Accepted;
    }
    let lock = Lock::default();
    for rel in ["src/emails/z-email.ts", "src/emails/plain-email.ts"] {
        let only: BTreeSet<String> = [rel.to_string()].into();
        let whole = check(&full, &policy, &lock, Scope::Accepted, Some(&only));
        let one = scan_file(r, &opts, rel).unwrap().expect("incremental scan");
        assert_eq!(one.files.len(), 1);
        assert_eq!(
            one.files[0],
            *full.files.iter().find(|f| f.path == rel).unwrap()
        );
        let single = check(&one, &policy, &lock, Scope::Accepted, Some(&only));
        assert_eq!(single.violations, whole.violations, "{rel}");
    }
    let one = scan_file(r, &opts, "src/emails/z-email.ts")
        .unwrap()
        .unwrap();
    let context: Vec<&str> = one.context_files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(context, ["src/emails/mid-email.ts", "src/lib/mailer.ts"]);
}

/// A convention narrowed to the subtree its holders sit in (F10) checks the same in a
/// single-file scan (the hooks) as in a full scan: a new handler in the subtree without
/// the base is reported, a new service next to it, in a folder of its own, is not.
#[test]
fn subtree_narrowed_convention_checks_the_same_in_a_single_file_scan() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let runner = "src/engine/manager/migration/runner";
    write(r, "package.json", r#"{ "name": "app" }"#);
    write(
        r,
        &format!("{runner}/action-handler.ts"),
        "export class MigrationActionHandler {\n  run() {}\n}\n",
    );
    // 60 handlers and 4 other services: 60/64 clears the lower bound over the role.
    for i in 0..60 {
        write(
            r,
            &format!(
                "{runner}/action-handlers/group-{}/services/handler-{i}.service.ts",
                i % 6
            ),
            &format!(
                "import {{ MigrationActionHandler }} from \"../../../action-handler\";\nexport class Handler{i}Service extends MigrationActionHandler {{}}\n"
            ),
        );
    }
    for (rel, name) in [
        (
            "deferred-action-handlers/services/build-index.service.ts",
            "BuildIndexService",
        ),
        (
            "deferred-action-handlers/services/validate-key.service.ts",
            "ValidateKeyService",
        ),
        (
            "registry/handler-registry.service.ts",
            "HandlerRegistryService",
        ),
        ("services/runner.service.ts", "RunnerService"),
    ] {
        write(
            r,
            &format!("{runner}/{rel}"),
            &format!("export class {name} {{\n  go() {{}}\n}}\n"),
        );
    }
    for i in 0..60 {
        write(
            r,
            &format!(
                "src/engine/manager/migration/area-{}/thing-{i}.service.ts",
                i % 5
            ),
            &format!("export class Thing{i}Service {{\n  go() {{}}\n}}\n"),
        );
    }

    let opts = ScanOptions {
        cache_dir: Some(r.join(".drift-cache")),
        threads: 1,
    };
    let (full, _) = scan(r, &opts).unwrap();
    let mined = mine(&full, &MineOptions::default());
    let base = Rule::WrappedBy {
        kind: drift_core::WrapKind::Extends,
        any_of: vec![format!("{runner}/action-handler.ts#MigrationActionHandler")],
    };
    let c = mined
        .candidates
        .iter()
        .find(|c| c.rule == base)
        .unwrap_or_else(|| {
            panic!(
                "handlers extend MigrationActionHandler: {:#?}",
                mined
                    .candidates
                    .iter()
                    .map(|c| (
                        c.role.describe(),
                        &c.rule,
                        c.evidence.holders,
                        c.evidence.total
                    ))
                    .collect::<Vec<_>>()
            )
        });
    assert_eq!(c.role.dir, format!("{runner}/action-handlers"));
    assert!(c.outliers.is_empty(), "{:?}", c.outliers);

    let mut policy = ConventionsFile::merge(None, "test", mined.kinds.clone(), &mined.candidates);
    for conv in &mut policy.conventions {
        conv.status = Status::Accepted;
    }
    let id = c.id.clone();
    let new_handler = format!("{runner}/action-handlers/group-2/services/new.service.ts");
    let new_deferred = format!("{runner}/deferred-action-handlers/services/new.service.ts");
    write(
        r,
        &new_handler,
        "export class NewHandlerService {\n  go() {}\n}\n",
    );
    write(
        r,
        &new_deferred,
        "export class NewDeferredService {\n  go() {}\n}\n",
    );
    let (full, _) = scan(r, &opts).unwrap();
    let lock = Lock::default();
    for (rel, expected) in [(&new_handler, 1), (&new_deferred, 0)] {
        let only: BTreeSet<String> = [rel.to_string()].into();
        let whole = check(&full, &policy, &lock, Scope::Accepted, Some(&only));
        let one = scan_file(r, &opts, rel).unwrap().expect("incremental scan");
        let single = check(&one, &policy, &lock, Scope::Accepted, Some(&only));
        assert_eq!(single.violations, whole.violations, "{rel}");
        let ours = whole.violations.iter().filter(|v| v.id == id).count();
        assert_eq!(ours, expected, "{rel}: {:?}", whole.violations);
    }
}

/// A plain alias of a function (`export const generateMetadata = referenceMetadata`)
/// is a member of the role of functions, and what the function does is what it does
/// (`drift_mine::roles::FunctionAliases`). A single-file scan links the function the
/// alias names and returns it as context, so a hook reports the alias of an unwrapped
/// function, and not the alias of a wrapped one, as `drift check` does.
#[test]
fn an_alias_of_a_function_checks_the_same_in_a_single_file_scan() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "app" }"#);
    write(
        r,
        "lib/meta.ts",
        "export function genPageMeta(f: (p: any) => any) {\n  return async (p: any) => f(p);\n}\n",
    );
    write(
        r,
        "lib/reference.ts",
        "export async function referenceMetadata(p: any) {\n  return { title: p.slug };\n}\n",
    );
    write(
        r,
        "lib/wrapped.ts",
        "import { genPageMeta } from \"./meta\";\nexport const wrappedMetadata = genPageMeta((p: any) => ({ title: p.slug }));\n",
    );
    for i in 0..30 {
        write(
            r,
            &format!("app/g-{i}/page.tsx"),
            &format!(
                "import {{ genPageMeta }} from \"../../lib/meta\";\nexport const generateMetadata = genPageMeta((p: any) => ({{ title: \"g{i}\" + p.slug }}));\n"
            ),
        );
    }
    write(
        r,
        "app/odd/page.tsx",
        "export async function generateMetadata(p: any) {\n  return { title: p.slug };\n}\n",
    );
    for (rel, target, module) in [
        ("app/r-0/page.tsx", "referenceMetadata", "reference"),
        ("app/r-1/page.tsx", "referenceMetadata", "reference"),
        ("app/r-2/page.tsx", "wrappedMetadata", "wrapped"),
    ] {
        write(
            r,
            rel,
            &format!(
                "import {{ {target} }} from \"../../lib/{module}\";\nexport const generateMetadata = {target};\n"
            ),
        );
    }
    for i in 0..60 {
        write(
            r,
            &format!("util/u{i}.ts"),
            &format!("export function util{i}(x: number) {{\n  return x + {i};\n}}\n"),
        );
    }

    let opts = ScanOptions {
        cache_dir: Some(r.join(".drift-cache")),
        threads: 1,
    };
    let (full, _) = scan(r, &opts).unwrap();
    let mined = mine(&full, &MineOptions::default());
    let meta = Rule::WrappedBy {
        kind: drift_core::WrapKind::Call,
        any_of: vec!["lib/meta.ts#genPageMeta".into()],
    };
    let c = mined
        .candidates
        .iter()
        .find(|c| c.rule == meta)
        .unwrap_or_else(|| {
            panic!(
                "pages wrap genPageMeta: {:#?}",
                mined
                    .candidates
                    .iter()
                    .map(|c| (c.role.describe(), c.rule.describe()))
                    .collect::<Vec<_>>()
            )
        });
    // 30 pages and the alias of the wrapped function hold it; the alias of the
    // unwrapped one is a member that does it differently.
    assert_eq!((c.evidence.holders, c.evidence.total), (31, 34));
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.path.as_str()).collect();
    assert_eq!(
        outliers,
        ["app/odd/page.tsx", "app/r-0/page.tsx", "app/r-1/page.tsx"]
    );

    let mut policy = ConventionsFile::merge(None, "test", mined.kinds.clone(), &mined.candidates);
    for conv in &mut policy.conventions {
        conv.status = Status::Accepted;
    }
    let lock = Lock::default();
    for (rel, expected) in [("app/r-0/page.tsx", 1), ("app/r-2/page.tsx", 0)] {
        let only: BTreeSet<String> = [rel.to_string()].into();
        let whole = check(&full, &policy, &lock, Scope::Accepted, Some(&only));
        let one = scan_file(r, &opts, rel).unwrap().expect("incremental scan");
        let single = check(&one, &policy, &lock, Scope::Accepted, Some(&only));
        assert_eq!(single.violations, whole.violations, "{rel}");
        let ours = whole.violations.iter().filter(|v| v.id == c.id).count();
        assert_eq!(ours, expected, "{rel}: {:?}", whole.violations);
    }
    let one = scan_file(r, &opts, "app/r-0/page.tsx").unwrap().unwrap();
    let context: Vec<(&str, Vec<&str>)> = one
        .context_files
        .iter()
        .map(|f| {
            (
                f.path.as_str(),
                f.symbols.iter().map(|s| s.name.as_str()).collect(),
            )
        })
        .collect();
    assert_eq!(context, [("lib/reference.ts", vec!["referenceMetadata"])]);
}
