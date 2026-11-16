//! Facts the TypeScript lowering adds for readings the first wave did not reach
//! (stream S15a). Each is in the listed reading only ([`drift_core::Listed`]):
//! what mining reads stays as the measured build read it, and every test pins
//! that too, beside a case that must stay unread.
//!
//! - A handler of a file-convention router that hands back a value answers by
//!   it (`returns_value` + `answers_by_return`), so the API reading need not
//!   name the framework.
//! - A header compared whole with a secret of the environment, the body left
//!   where they differ, is `refuses_secret:<header>`.
//! - A parameter that names the input only to leave it unread is
//!   `input_unread`.
//! - The input handed to a call is `input_handed:<callee>`.
//! - `if (a && b) { .. } else { next(err) }` as the last statement of a
//!   middleware turns away a request without a caller.

use std::fs;
use std::path::Path;

use drift_core::{CheckOutcome, FileFacts, RepoFacts, Symbol, controls};
use drift_ts::{ScanOptions, scan};

fn repo(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| {
            let names: Vec<&str> = f.symbols.iter().map(|s| s.name.as_str()).collect();
            panic!("{name} not in {}: {names:?}", f.path)
        })
}

fn has(s: &Symbol, control: &str) -> bool {
    s.controls.iter().any(|c| c == control)
}

fn has_prefix(s: &Symbol, prefix: &str) -> bool {
    s.controls.iter().any(|c| c.starts_with(prefix))
}

const ROUTER_PACKAGE: &str =
    r#"{ "name": "web", "dependencies": { "react-router": "7.1.0", "zod": "3.23.8" } }"#;

/// Pins: a React Router loader that returns a value answers by it in the listed
/// reading; one that returns nothing, and a function of no route file, do not;
/// the measured copy says neither.
#[test]
fn a_router_handler_that_returns_a_value_answers_by_it() {
    let r = repo(&[
        ("package.json", ROUTER_PACKAGE),
        (
            "app/routes/notes.ts",
            r#"export async function loader() {
  const notes = await Promise.resolve([]);
  return { notes };
}

export async function action() {
  await Promise.resolve(1);
}
"#,
        ),
        (
            "app/utils/misc.ts",
            "export function pick() {\n  return { a: 1 };\n}\n",
        ),
    ]);
    let measured = file(&r, "app/routes/notes.ts");
    assert!(!has(symbol(measured, "loader"), controls::RETURNS_VALUE));
    assert!(!has(
        symbol(measured, "loader"),
        controls::ANSWERS_BY_RETURN
    ));
    let listed = r.listed();
    let f = file(&listed, "app/routes/notes.ts");
    let loader = symbol(f, "loader");
    assert!(
        has(loader, controls::RETURNS_VALUE),
        "{:?}",
        loader.controls
    );
    assert!(
        has(loader, controls::ANSWERS_BY_RETURN),
        "{:?}",
        loader.controls
    );
    // Returns nothing: sends nothing Drift read.
    assert!(!has(symbol(f, "action"), controls::ANSWERS_BY_RETURN));
    // No route file: nothing reads what it returns.
    let misc = symbol(file(&listed, "app/utils/misc.ts"), "pick");
    assert!(!has(misc, controls::RETURNS_VALUE));
}

/// Pins: `if (!isAuthorized) return redirect("/")` of a header compared with
/// `Bearer ${process.env.TOKEN}` is an exit not read
/// (`exit_unread:header:authorization`) in the listed reading only: a redirect to
/// `/` is no refusal the lowering reads (F9), so it is not `refuses_secret`. A
/// compare with a literal, and one inside a branch, are neither.
#[test]
fn a_header_compared_with_an_environment_secret_refuses() {
    let r = repo(&[
        ("package.json", ROUTER_PACKAGE),
        (
            "app/routes/admin.cache.ts",
            r#"import { redirect } from "react-router";

export async function action({ request }: { request: Request }) {
  const token = process.env.INTERNAL_COMMAND_TOKEN;
  const isAuthorized =
    request.headers.get("Authorization") === `Bearer ${token}`;
  if (!isAuthorized) {
    return redirect("/");
  }
  return { ok: true };
}
"#,
        ),
        (
            "app/routes/admin.literal.ts",
            r#"import { redirect } from "react-router";

export async function action({ request }: { request: Request }) {
  const isAuthorized = request.headers.get("Authorization") === "Bearer abc";
  if (!isAuthorized) {
    return redirect("/");
  }
  return { ok: true };
}
"#,
        ),
        (
            "app/routes/admin.nested.ts",
            r#"import { redirect } from "react-router";

export async function action({ request }: { request: Request }) {
  const token = process.env.INTERNAL_COMMAND_TOKEN;
  if (request.method === "POST") {
    if (request.headers.get("Authorization") !== `Bearer ${token}`) {
      return redirect("/");
    }
  }
  return { ok: true };
}
"#,
        ),
    ]);
    let unread = format!("{}header:authorization", controls::EXIT_UNREAD);
    let measured = symbol(file(&r, "app/routes/admin.cache.ts"), "action");
    assert!(!has_prefix(measured, controls::REFUSES_SECRET));
    assert!(!has(measured, &unread));
    let listed = r.listed();
    let action = symbol(file(&listed, "app/routes/admin.cache.ts"), "action");
    assert!(
        !has_prefix(action, controls::REFUSES_SECRET),
        "{:?}",
        action.controls
    );
    assert!(has(action, &unread), "{:?}", action.controls);
    let literal = symbol(file(&listed, "app/routes/admin.literal.ts"), "action");
    assert!(!has_prefix(literal, controls::REFUSES_SECRET));
    // Only requests that take the outer branch are checked.
    let nested = symbol(file(&listed, "app/routes/admin.nested.ts"), "action");
    assert!(!has_prefix(nested, controls::REFUSES_SECRET));
}

const TRPC_PACKAGE: &str = r#"{ "name": "api", "dependencies": { "@trpc/server": "10.45.0", "zod": "3.23.8", "left-pad": "1.3.0" } }"#;

const TRPC: &str = r#"import { initTRPC, TRPCError } from "@trpc/server";

const t = initTRPC.context<{ user?: { id: string } }>().create();

export const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export const authedProcedure = t.procedure.use(isAuthed);
"#;

/// Pins: `async ({ ctx, input }) => handler({ ctx })` is `input_unread` in the
/// listed reading; one that hands `input` on is not; the measured copy keeps
/// `reads_input` and never says `input_unread`.
#[test]
fn an_input_the_parameter_names_and_never_reads() {
    let r = repo(&[
        ("package.json", TRPC_PACKAGE),
        ("src/trpc.ts", TRPC),
        (
            "src/stats.ts",
            r#"import { authedProcedure } from "./trpc";
import { statsHandler } from "./statsHandler";

export const myStats = authedProcedure.query(async ({ ctx, input }) => {
  return statsHandler({ ctx });
});

export const theirStats = authedProcedure.query(async ({ ctx, input }) => {
  return statsHandler({ ctx, input });
});
"#,
        ),
        (
            "src/statsHandler.ts",
            "export async function statsHandler(opts: { ctx: unknown; input?: unknown }) {\n  return { n: 1 };\n}\n",
        ),
    ]);
    let measured = symbol(file(&r, "src/stats.ts"), "myStats");
    assert!(!has(measured, controls::INPUT_UNREAD));
    let listed = r.listed();
    let f = file(&listed, "src/stats.ts");
    let mine = symbol(f, "myStats");
    assert!(has(mine, controls::INPUT_UNREAD), "{:?}", mine.controls);
    assert!(!has(symbol(f, "theirStats"), controls::INPUT_UNREAD));
}

/// Pins: the input handed to a package's call is `input_handed:<callee>` in the
/// listed reading only; a call handed nothing of the request is not.
#[test]
fn input_handed_to_a_call_is_said() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "express": "4.19.2", "left-pad": "1.3.0" } }"#,
        ),
        (
            "src/app.ts",
            r#"import express from "express";
import pad from "left-pad";

const app = express();

export function handed(req: any, res: any) {
  const out = pad(req.body.name, 10);
  res.json({ out });
}

export function untouched(req: any, res: any) {
  const out = pad("x", 10);
  res.json({ out });
}

app.post("/handed", handed);
app.post("/untouched", untouched);
"#,
        ),
    ]);
    let measured = symbol(file(&r, "src/app.ts"), "handed");
    assert!(!has_prefix(measured, controls::INPUT_HANDED));
    let listed = r.listed();
    let f = file(&listed, "src/app.ts");
    let handed = symbol(f, "handed");
    assert!(
        handed
            .controls
            .iter()
            .any(|c| c.starts_with(controls::INPUT_HANDED) && c.contains("pkg:left-pad")),
        "{:?}",
        handed.controls
    );
    assert!(!has_prefix(symbol(f, "untouched"), controls::INPUT_HANDED));
}

const USERS: &str = r#"export const users = new Map<string, { data: { id: string; email: string } }>();
"#;

/// Pins: a middleware whose last statement is `if (user && user.data.id) { .. }
/// else { next(err) }`, with `user` looked up by the `Authorization` header,
/// turns away a request without a caller (a check answering "not signed in") in
/// the listed reading; with a statement after the `if`, it does not; the
/// measured copy has neither.
#[test]
fn a_trailing_continuation_with_a_joined_presence_test_refuses() {
    let r = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "express": "4.19.2" } }"#,
        ),
        ("src/users.ts", USERS),
        (
            "src/history.ts",
            r#"import { users } from "./users";

export function history(req: any, res: any, next: any) {
  const user = users.get(req.headers.authorization);
  if (user && user.data.id) {
    res.json({ id: user.data.id });
  } else {
    next(new Error("Blocked"));
  }
}

export function goesOn(req: any, res: any, next: any) {
  const user = users.get(req.headers.authorization);
  if (user && user.data.id) {
    res.json({ id: user.data.id });
  } else {
    next(new Error("Blocked"));
  }
  console.log("after");
}
"#,
        ),
    ]);
    let refuses = |s: &Symbol| {
        s.body_checks
            .iter()
            .any(|c| c.outcome == CheckOutcome::Unauthenticated)
    };
    let measured = symbol(file(&r, "src/history.ts"), "history");
    assert!(!refuses(measured));
    let listed = r.listed();
    let f = file(&listed, "src/history.ts");
    assert!(
        refuses(symbol(f, "history")),
        "{:?}",
        symbol(f, "history").body_checks
    );
    assert!(!refuses(symbol(f, "goesOn")));
}
