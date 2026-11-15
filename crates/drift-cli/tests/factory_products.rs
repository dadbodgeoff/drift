//! A route handler made by a factory proven to return a function
//! (`export const GET = withResponder(getHandler)`, `drift_core::Symbol::made_by`) is
//! a function: it is in the role of its route's function handlers, so a call-wrapper
//! convention counts it with them, and a handler written without the wrapper is an
//! outlier of that convention. A handler made by a factory not proven to return a
//! function stays a value, in a role of its own, as before.

use std::path::Path;

use drift_core::{SymbolKind, WrapKind};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_ts::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn repo(root: &Path) {
    write(root, "package.json", r#"{ "name": "app" }"#);
    write(
        root,
        "lib/responder.ts",
        "export const withResponder = (handler: any) => {\n  \
           return async (req: any) => {\n    \
             try {\n      return await handler(req);\n    \
             } catch (e) {\n      return new Response(\"error\", { status: 500 });\n    }\n  };\n};\n\
         export async function withLater(handler: any) {\n  \
           return async (req: any) => handler(req);\n}\n",
    );
    let handler = "async function getHandler(req: any) {\n  return new Response(req.url);\n}\n";
    for i in 0..30 {
        write(
            root,
            &format!("app/api/r{i}/route.ts"),
            &format!(
                "import {{ withResponder }} from \"../../../lib/responder\";\n{handler}\
                 export const GET = withResponder(getHandler);\n"
            ),
        );
        write(
            root,
            &format!("app/legacy/u{i}/route.ts"),
            &format!(
                "import {{ withLater }} from \"../../../lib/responder\";\n{handler}\
                 export const GET = withLater(getHandler);\n"
            ),
        );
    }
    for i in 0..2 {
        write(
            root,
            &format!("app/api/bare{i}/route.ts"),
            "export async function GET(req: any) {\n  return new Response(req.url);\n}\n",
        );
    }
    for i in 0..60 {
        write(
            root,
            &format!("util/u{i}.ts"),
            &format!("export function util{i}(x: number) {{\n  return x + {i};\n}}\n"),
        );
    }
}

fn wrapped_in<'a>(candidates: &'a [Candidate], target: &str) -> Vec<&'a Candidate> {
    candidates
        .iter()
        .filter(|c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Call,
                    any_of: vec![target.to_string()],
                }
        })
        .collect()
}

#[test]
fn a_handler_made_by_a_proven_factory_is_counted_with_function_handlers() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repo(r);
    let (facts, _) = scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let mined = mine(&facts, &MineOptions::default());
    let describe = || {
        mined
            .candidates
            .iter()
            .map(|c| (c.role.describe(), c.rule.describe()))
            .collect::<Vec<_>>()
    };

    let made = wrapped_in(&mined.candidates, "lib/responder.ts#withResponder");
    let [c] = made.as_slice() else {
        panic!("one withResponder rule: {:#?}", describe());
    };
    // The 30 made handlers and the 2 written as functions share a role.
    assert_eq!(
        (c.role.kind, c.role.entry.as_str()),
        (SymbolKind::Function, "http")
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (30, 32));
    let mut outliers: Vec<&str> = c.outliers.iter().map(|o| o.path.as_str()).collect();
    outliers.sort();
    assert_eq!(
        outliers,
        ["app/api/bare0/route.ts", "app/api/bare1/route.ts"]
    );

    // `withLater` is async: what it returns is a promise, so its handlers stay values.
    for c in wrapped_in(&mined.candidates, "lib/responder.ts#withLater") {
        assert_eq!(c.role.kind, SymbolKind::Const, "{}", c.role.describe());
    }
    let legacy = facts
        .files
        .iter()
        .find(|f| f.path == "app/legacy/u0/route.ts")
        .unwrap();
    let get = legacy.symbols.iter().find(|s| s.name == "GET").unwrap();
    assert_eq!((get.kind, get.made_by.as_str()), (SymbolKind::Const, ""));
}
