//! Facts the TypeScript/JavaScript lowering did not produce, or got wrong, that left
//! units unknown or misread (one TS `LOWERING_VERSION` bump). Each is in the listed
//! reading only ([`drift_core::Listed`]): what mining reads stays as the last
//! measured build read it, and every test pins that too.
//!
//! - Every function of an object literal is a member of it, `path#<object>.<key>`,
//!   with its body, and `this.<key>()` of a `function` is a call of the sibling
//!   (`const authenticatedUsers = { from(req) { ... this.get(token) } }`). A key
//!   the module writes elsewhere is not read.
//! - A function a constructor function assigns on `this` names the instances the
//!   constructor builds (`const users = new UsersDAO(db)`, then `users.find(id)` is
//!   `UsersDAO.find`), and `this.<key>()` is the sibling.
//! - `catch (e) { next(e) }`, with `next` the parameter a middleware takes last,
//!   passes the error on (`rethrow`), and is no swallowed "not signed in" check.
//! - A thrown error class of the repository is a refusal by the status its own
//!   definition sets (`super(403, ...)`), never by its name.

use std::fs;
use std::path::Path;

use drift_core::{CheckOutcome, FileFacts, RepoFacts, Symbol};
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

fn find<'a>(f: &'a FileFacts, name: &str) -> Option<&'a Symbol> {
    f.symbols.iter().find(|s| s.name == name)
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    find(f, name).unwrap_or_else(|| {
        let names: Vec<&str> = f.symbols.iter().map(|s| s.name.as_str()).collect();
        panic!("{name} not in {}: {names:?}", f.path)
    })
}

const USERS: &str = r#"export const authenticatedUsers = {
  tokenMap: {} as Record<string, unknown>,
  get: function (token: string) {
    return this.tokenMap[token];
  },
  from: function (req: any) {
    const token = req.headers.authorization;
    return token ? this.get(token) : undefined;
  },
  later: function (req: any) {
    return req.user;
  },
};

authenticatedUsers.later = function (req: any) {
  return undefined;
};
"#;

/// Pins G4 (objects): `authenticatedUsers.from` had no body in the facts, so a unit
/// calling it stopped at `body_unreadable`. It now has one, its `this.get(...)` is
/// the sibling, a key the module writes again is not read, and the measured
/// reading has none of it.
#[test]
fn every_function_of_an_object_is_a_member_with_its_body() {
    let facts = repo(&[("lib/insecurity.ts", USERS)]);
    let listed = facts.listed();
    let f = file(&listed, "lib/insecurity.ts");
    let from = symbol(f, "authenticatedUsers.from");
    assert!(
        from.calls
            .iter()
            .any(|c| c == "lib/insecurity.ts#authenticatedUsers.get"),
        "{:?}",
        from.calls
    );
    assert!(find(f, "authenticatedUsers.get").is_some());
    // Written again below: which function a call runs is not said.
    assert!(find(f, "authenticatedUsers.later").is_none());
    let mined = file(&facts, "lib/insecurity.ts");
    assert!(find(mined, "authenticatedUsers.from").is_none());
    assert!(find(mined, "authenticatedUsers.get").is_none());
}

const DAO: &str = r#"export function UsersDAO(db: any) {
  this.find = function (id: string, cb: any) {
    db.collection("users").findOne({ id }, cb);
  };
}
"#;

const HANDLER: &str = r#"import { UsersDAO } from "./dao";

export function Handler(db: any) {
  const users = new UsersDAO(db);
  this.check = (req: any, res: any, next: any) => {
    this.show(req, res, next);
  };
  this.show = (req: any, res: any, next: any) => {
    users.find(req.session.userId, (err: any, u: any) => {
      if (err) return next(err);
      res.json(u);
    });
  };
}
"#;

/// Pins G4 (constructor functions): a method assigned on `this` read the
/// constructor's own instances as unknown locals (`local:users.find`), the cause of
/// NodeGoat's `scope_unread` units. It now calls `UsersDAO.find`, the in-place
/// member of the constructor function that defines it, and `this.show()` is the
/// sibling.
#[test]
fn a_constructor_s_members_name_the_instances_it_builds() {
    let facts = repo(&[("dao.ts", DAO), ("handler.ts", HANDLER)]);
    let listed = facts.listed();
    let f = file(&listed, "handler.ts");
    let show = symbol(f, "Handler.show");
    let through: Vec<&String> = show
        .receiver_calls
        .iter()
        .chain(&show.order)
        .chain(&show.calls)
        .collect();
    assert!(
        through.iter().any(|c| *c == "dao.ts#UsersDAO.find"),
        "{through:?}"
    );
    assert!(
        !through.iter().any(|c| c.starts_with("local:users")),
        "{through:?}"
    );
    let check = symbol(f, "Handler.check");
    assert!(
        check.calls.iter().any(|c| c == "handler.ts#Handler.show"),
        "{:?}",
        check.calls
    );
    assert!(find(file(&listed, "dao.ts"), "UsersDAO.find").is_some());
    assert!(find(file(&facts, "handler.ts"), "Handler.show").is_none());
}

const BASKET: &str = r#"declare const Basket: any;

export const retrieve = async (req: any, res: any, next: any) => {
  try {
    const basket = await Basket.findOne({ where: { id: req.params.id } });
    res.json(basket);
  } catch (error) {
    next(error);
  }
};

export const returned = async (req: any, res: any, next: any) => {
  try {
    const basket = await Basket.findOne({ where: { id: req.params.id } });
    res.json(basket);
  } catch (error) {
    return next(error);
  }
};

export const logged = async (req: any, res: any) => {
  try {
    const basket = await Basket.findOne({ where: { id: req.params.id } });
    res.json(basket);
  } catch (error) {
    console.log(error);
  }
};
"#;

fn does(s: &Symbol) -> Vec<String> {
    s.catches.iter().flat_map(|c| c.does.clone()).collect()
}

/// Pins G6 (TypeScript): `catch (error) { next(error) }` was a swallow, and a
/// swallowed "not signed in" check (juice-shop `routes/basket.ts`). The error goes
/// on to the framework: `rethrow`, no return, no check. A clause that hands the
/// error to nothing is no rethrow. Mining's reading is unchanged.
#[test]
fn handing_the_caught_error_to_the_continuation_passes_it_on() {
    let facts = repo(&[("routes/basket.ts", BASKET)]);
    let listed = facts.listed();
    let f = file(&listed, "routes/basket.ts");
    assert_eq!(does(symbol(f, "retrieve")), ["rethrow"]);
    assert_eq!(does(symbol(f, "returned")), ["rethrow"]);
    assert!(!does(symbol(f, "logged")).contains(&"rethrow".to_string()));
    for name in ["retrieve", "returned"] {
        assert!(
            !symbol(f, name)
                .body_checks
                .iter()
                .any(|c| c.outcome == CheckOutcome::Unauthenticated),
            "{name}: {:?}",
            symbol(f, name).body_checks
        );
    }
    let mined = file(&facts, "routes/basket.ts");
    assert_eq!(does(symbol(mined, "retrieve")), ["swallow"]);
    assert!(!does(symbol(mined, "returned")).contains(&"rethrow".to_string()));
}

const ERRORS: &str = r#"export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Forbidden extends HttpError {
  constructor(message = "forbidden") {
    super(403, message);
  }
}

export class NotSignedIn extends Error {
  statusCode = 401;
}

export class Teapot extends HttpError {
  constructor() {
    super(418, "tea");
  }
}

export class UnauthorizedError extends Error {}
"#;

const GUARD: &str = r#"import { Forbidden, NotSignedIn, Teapot, UnauthorizedError } from "./errors";

export function requireAdmin(user: any) {
  if (user.role !== "admin") throw new Forbidden();
  return user;
}

export function requireUser(session: any) {
  if (session.kind !== "user") {
    throw new NotSignedIn();
  }
  return session;
}

export function brew(user: any) {
  if (user.role !== "admin") throw new Teapot();
  return user;
}

export function byName(user: any) {
  if (user.role !== "admin") throw new UnauthorizedError();
  return user;
}
"#;

/// Pins G5 (TypeScript): a throw of a repository error class with no argument
/// gave no refusal. It is now the check its class answers by its own definition
/// (403 passed to the base, 401 declared as `statusCode`); a class whose status is
/// another (418), or that sets none whatever it is called (`UnauthorizedError`),
/// gives none. The class carries `refusal_status:<n>`. Mining reads none of it.
#[test]
fn a_thrown_class_refuses_by_the_status_its_definition_sets() {
    let facts = repo(&[("errors.ts", ERRORS), ("guard.ts", GUARD)]);
    let listed = facts.listed();
    let f = file(&listed, "guard.ts");
    let outcomes = |name: &str| -> Vec<CheckOutcome> {
        symbol(f, name).body_checks.iter().map(|c| c.outcome).collect()
    };
    assert_eq!(outcomes("requireAdmin"), [CheckOutcome::Forbidden]);
    assert_eq!(outcomes("requireUser"), [CheckOutcome::Unauthenticated]);
    assert!(outcomes("brew").is_empty());
    assert!(outcomes("byName").is_empty());
    let e = file(&listed, "errors.ts");
    let status = |name: &str| -> Vec<String> {
        symbol(e, name)
            .controls
            .iter()
            .filter(|c| c.starts_with(drift_core::controls::REFUSAL_STATUS))
            .cloned()
            .collect()
    };
    assert_eq!(status("Forbidden"), ["refusal_status:403"]);
    assert_eq!(status("NotSignedIn"), ["refusal_status:401"]);
    assert!(status("Teapot").is_empty());
    assert!(status("HttpError").is_empty());
    assert!(status("UnauthorizedError").is_empty());
    let mined = file(&facts, "guard.ts");
    assert!(symbol(mined, "requireAdmin").body_checks.is_empty());
    assert!(symbol(mined, "requireUser").body_checks.is_empty());
    let mined_errors = file(&facts, "errors.ts");
    assert!(
        !symbol(mined_errors, "Forbidden")
            .controls
            .iter()
            .any(|c| c.starts_with(drift_core::controls::REFUSAL_STATUS))
    );
}
