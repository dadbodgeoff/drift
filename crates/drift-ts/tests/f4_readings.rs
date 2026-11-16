//! Readings a review of the listed reading found to credit what does not stop the
//! request, or to hide what does (stream F4). Each test says what it pins; the
//! unsafe-direction ones fail on the code before the fix.
//!
//! - A refusal by continuation is only the parameter a middleware takes last of
//!   three or four, handed an error Drift sees is one: `next()`, `next(null)`,
//!   `next(undefined)`, tRPC's destructured `next({ ctx })` and Koa's `(ctx,
//!   next)` refuse no one, and a value that is not read is unknown.
//! - A `try` that hands a credential to what it calls and gives what it caught
//!   to the continuation keeps a swallowed (not proven) check.
//! - An error class's status is read only where nothing else in the class writes
//!   it.
//! - A header compared with an environment secret refuses no one where the
//!   branch hands the request on.
//! - A parameter that names the input and never reads it is not `input_unread`
//!   where the body reaches the arguments otherwise.
//! - A catch clause that may leave before it hands the error on is no rethrow.
//! - Only an equality assertion says the status a test asserts.

use std::fs;
use std::path::Path;

use drift_core::{CheckOutcome, FileFacts, RepoFacts, Symbol, controls};
use drift_ts::{ScanOptions, scan};

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "express": "4.19.2", "jsonwebtoken": "9.0.2", "chai": "4.4.1", "supertest": "7.0.0" } }"#;

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
    f.symbols.iter().find(|s| s.name == name).unwrap_or_else(|| {
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

fn signs_in(s: &Symbol) -> bool {
    s.body_checks
        .iter()
        .any(|c| c.outcome == CheckOutcome::Unauthenticated)
}

const USERS: &str = r#"
export const users = new Map<string, { id: string }>();
"#;

const CONTINUED: &str = r#"
import { users } from "./users";

export const bare = (req: any, res: any, next: any) => {
  const user = users.get(req.cookies.token);
  if (!user) {
    return next();
  }
  res.json(user);
};

export const nulled = (req: any, res: any, next: any) => {
  const user = users.get(req.cookies.token);
  if (!user) {
    return next(null);
  }
  res.json(user);
};

export const undef = (req: any, res: any, next: any) => {
  const user = users.get(req.cookies.token);
  if (!user) {
    return next(undefined);
  }
  res.json(user);
};

export const trpcStyle = ({ ctx, next }: any) => {
  const user = users.get(ctx.req.cookies.token);
  if (!user) {
    return next({ ctx: { ...ctx, user: null, error: "Unauthorized" } });
  }
  return next({ ctx: { ...ctx, user } });
};

export const koaStyle = async (ctx: any, next: any) => {
  const user = users.get(ctx.cookies.get("token"));
  if (!user) {
    return next(new Error("Unauthorized"));
  }
  ctx.state.user = user;
  await next();
};

export const refused = (req: any, res: any, next: any) => {
  const user = users.get(req.cookies.token);
  if (!user) {
    return next(new Error("Blocked"));
  }
  res.json(user);
};
"#;

/// Pins row 1 of the review: every continuation call with no error, and every
/// continuation that is no Express middleware's, was a refusal
/// (`refuses_without:` / an Unauthenticated check, `next(null)` and tRPC's
/// `next({ ctx: { error: "Unauthorized" } })` included). Now only the positional
/// continuation handed a `new` of a class refuses. Mining reads none of it.
#[test]
fn only_an_error_handed_to_a_middleware_continuation_refuses() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/users.ts", USERS),
        ("src/mw.ts", CONTINUED),
    ]);
    let listed = r.listed();
    let f = file(&listed, "src/mw.ts");
    for name in ["bare", "nulled", "undef", "trpcStyle", "koaStyle"] {
        let s = symbol(f, name);
        assert!(
            !has_prefix(s, controls::REFUSES_WITHOUT),
            "{name}: {:?}",
            s.controls
        );
        assert!(!signs_in(s), "{name}: {:?}", s.body_checks);
    }
    let refused = symbol(f, "refused");
    assert!(
        has_prefix(refused, controls::REFUSES_WITHOUT) || signs_in(refused),
        "{:?} {:?}",
        refused.controls,
        refused.body_checks
    );
    let measured = symbol(file(&r, "src/mw.ts"), "refused");
    assert!(!has_prefix(measured, controls::REFUSES_WITHOUT));
}

const UNREAD: &str = r#"
import { users } from "./users";

declare function problemOf(token: unknown): unknown;

export const handedLocal = (req: any, res: any, next: any) => {
  const user = users.get(req.cookies.token);
  const problem = problemOf(req.cookies.token);
  if (!user) {
    return next(problem);
  }
  res.json(user);
};
"#;

/// Pins row 1's unknown: a positional continuation handed a value Drift does not
/// read (`next(problem)` of a local) was a refusal; it is now none, and the exit
/// is said to be unread (`exit_unread:`), so a reader takes it as unknown.
#[test]
fn a_value_the_continuation_is_handed_that_is_not_read_is_unknown() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/users.ts", USERS),
        ("src/unread.ts", UNREAD),
    ]);
    let listed = r.listed();
    let s = symbol(file(&listed, "src/unread.ts"), "handedLocal");
    let said = &s.controls;
    assert!(!has_prefix(s, controls::REFUSES_WITHOUT), "{said:?}");
    assert!(!signs_in(s), "{:?}", s.body_checks);
    assert!(has_prefix(s, controls::EXIT_UNREAD), "{said:?}");
}

const VERIFIED: &str = r#"
import jwt from "jsonwebtoken";

declare const db: any;

export const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization;
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET as string);
    next();
  } catch (e) {
    next(e);
  }
};

export const lookup = async (req: any, res: any, next: any) => {
  try {
    const row = await db.query({ id: req.params.id });
    res.json(row);
  } catch (e) {
    next(e);
  }
};
"#;

/// Pins row 4: the listed reading recorded no check for `try { req.user =
/// jwt.verify(token, key) } catch (e) { next(e) }`, turning a refusal whose
/// answer is not read into none. It keeps the swallowed (not proven) check where
/// the `try` hands a credential the request carries to what it calls; a `try`
/// around a query still gives none.
#[test]
fn a_verifying_try_that_hands_its_error_on_keeps_a_check_not_proven() {
    let r = repo(&[("package.json", PACKAGE), ("src/auth.ts", VERIFIED)]);
    let listed = r.listed();
    let f = file(&listed, "src/auth.ts");
    let auth = symbol(f, "authenticate");
    let swallowed = |c: &drift_core::BodyCheck| {
        c.outcome == CheckOutcome::Unauthenticated
            && c.conditional
            && c.condition == drift_core::not_always::SWALLOWED
    };
    let checks = &auth.body_checks;
    assert!(checks.iter().any(swallowed), "{checks:?}");
    let lookup = symbol(f, "lookup");
    assert!(!signs_in(lookup), "{:?}", lookup.body_checks);
}

const CLASSES: &str = r#"
export class Plain extends Error {
  constructor() {
    super("not signed in");
    this.status = 401;
  }
}

export class Reassigned extends Error {
  constructor(code?: number) {
    super("not signed in");
    this.status = 401;
    if (code) this.status = code;
  }
}

export class Elsewhere extends Error {
  statusCode = 401;
  retry() {
    this.statusCode = 503;
  }
}

export class Getter extends Error {
  statusCode = 401;
  get status() {
    return 500;
  }
}
"#;

/// Pins row 6: only the constructor's top-level statements were read, so a class
/// that sets 401 and then another status under a condition, in another method or
/// by a getter carried `refusal_status:401`. Now only a class that writes its
/// status nowhere else does.
#[test]
fn a_class_status_written_anywhere_else_is_not_read() {
    let r = repo(&[("package.json", PACKAGE), ("src/errors.ts", CLASSES)]);
    let listed = r.listed();
    let f = file(&listed, "src/errors.ts");
    let status = |name: &str| -> Vec<String> {
        symbol(f, name)
            .controls
            .iter()
            .filter(|c| c.starts_with(controls::REFUSAL_STATUS))
            .cloned()
            .collect()
    };
    assert_eq!(status("Plain"), ["refusal_status:401"]);
    for name in ["Reassigned", "Elsewhere", "Getter"] {
        assert!(status(name).is_empty(), "{name}: {:?}", status(name));
    }
}

const SECRET: &str = r#"
export function internal(req: any, res: any, next: any) {
  if (req.get("x-internal-key") !== process.env.INTERNAL_KEY) {
    return next();
  }
  req.internal = true;
  next();
}

export function guarded(req: any, res: any, next: any) {
  if (req.get("x-internal-key") !== process.env.INTERNAL_KEY) {
    return res.status(401).end();
  }
  next();
}
"#;

/// Pins the later stream's `refuses_secret:`: a branch that leaves by handing the
/// request on (`return next()`) where the header differs let every request
/// through and was read as service sign-in. It refuses no one now; a branch that
/// answers is still read.
#[test]
fn a_secret_branch_that_hands_the_request_on_refuses_no_one() {
    let r = repo(&[("package.json", PACKAGE), ("src/internal.ts", SECRET)]);
    let listed = r.listed();
    let f = file(&listed, "src/internal.ts");
    let secret = format!("{}x-internal-key", controls::REFUSES_SECRET);
    let internal = symbol(f, "internal");
    assert!(!has(internal, &secret), "{:?}", internal.controls);
    let guarded = symbol(f, "guarded");
    assert!(has(guarded, &secret), "{:?}", guarded.controls);
}

const INPUTS: &str = r#"
declare function statsHandler(x: unknown): unknown;

export const unread = async ({ ctx, input }: any) => statsHandler({ ctx });

export const viaArguments = function ({ ctx, input }: any) {
  return statsHandler(arguments[0]);
};

export const viaRequest = async ({ ctx, input }: any) => {
  const body = await ctx.req.json();
  return statsHandler({ ctx, body });
};
"#;

/// Pins the later stream's `input_unread`: a body that reaches what it was
/// handed through `arguments`, or the request through its context, read the
/// input as never read. Only a body that does neither is `input_unread`.
#[test]
fn input_reached_another_way_is_not_unread() {
    let r = repo(&[("package.json", PACKAGE), ("src/procs.ts", INPUTS)]);
    let listed = r.listed();
    let f = file(&listed, "src/procs.ts");
    let u = symbol(f, "unread");
    assert!(has(u, controls::INPUT_UNREAD), "{:?}", u.controls);
    for name in ["viaArguments", "viaRequest"] {
        let s = symbol(f, name);
        assert!(!has(s, controls::INPUT_UNREAD), "{name}: {:?}", s.controls);
    }
}

const CATCHES: &str = r#"
declare const store: any;

export const partial = async (req: any, res: any, next: any) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e: any) {
    if (e.code === "ENOENT") return;
    next(e);
  }
};

export const whole = async (req: any, res: any, next: any) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    next(e);
  }
};
"#;

/// Pins row 5: a catch clause any of whose statements handed the error on was a
/// `rethrow`, its `return` deleted, though another statement leaves first and
/// swallows some errors. Only a clause whose last statement hands it on, after
/// nothing that may leave, is one now.
#[test]
fn a_catch_that_may_leave_first_is_no_rethrow() {
    let r = repo(&[("package.json", PACKAGE), ("src/store.ts", CATCHES)]);
    let listed = r.listed();
    let f = file(&listed, "src/store.ts");
    let does = |name: &str| -> Vec<String> {
        symbol(f, name)
            .catches
            .iter()
            .flat_map(|c| c.does.clone())
            .collect()
    };
    let partial = does("partial");
    assert!(partial.iter().any(|d| d == "return"), "{partial:?}");
    assert!(!partial.iter().any(|d| d == "rethrow"), "{partial:?}");
    assert_eq!(does("whole"), ["rethrow"]);
}

const COMPARED: &str = r#"
import { assert } from "chai";
import request from "supertest";
import { it } from "node:test";

const app = {};

it("above", async () => {
  const res = await request(app).get("/rest/basket");
  assert.isAbove(res.status, 399);
});

it("equal", async () => {
  const res = await request(app).get("/rest/admin");
  assert.equal(res.status, 403);
});
"#;

/// Pins row 8: any package call handed a status and a number recorded that
/// status (`assert.isAbove(res.status, 399)` recorded 399). Only an equality
/// assertion does now. `test_requests` is read by the testing practice only.
#[test]
fn only_an_equality_assertion_says_the_status() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("test/api/basket.test.ts", COMPARED),
    ]);
    let f = file(&r, "test/api/basket.test.ts");
    let mut got: Vec<String> = f
        .test_requests
        .iter()
        .map(|t| format!("{} {} {:?}", t.method, t.route, t.statuses))
        .collect();
    got.sort();
    assert_eq!(got, ["GET /rest/admin [403]", "GET /rest/basket []"]);
}
