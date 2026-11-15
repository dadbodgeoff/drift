//! A value of the caller, and what a body does with one (TypeScript lowering 66,
//! `src/caller.rs`): the closed list of sources, the closed list of uses that are no
//! scope, and where the facts hold what is recorded (`caller_args` of the listed
//! reading, a method's own, `param_flows`, `returns_caller`). What mining reads is
//! what it was.

use std::fs;
use std::path::Path;

use drift_core::{FileFacts, RepoFacts, Symbol};
use drift_ts::{ScanOptions, scan};

const PACKAGE: &str = r#"{ "name": "web", "dependencies": { "next": "15.0.0", "next-auth": "5.0.0", "drizzle-orm": "0.33.0", "jsonwebtoken": "9.0.0", "hono": "4.6.0" } }"#;

fn scanned(files: &[(&str, &str)]) -> RepoFacts {
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
        .unwrap_or_else(|| panic!("{name} not in {}", f.path))
}

const EQ: &str = "pkg:drizzle-orm#eq";
const UNREAD: &str = drift_core::CALLER_USE_UNREAD;

const HEAD: &str = r#"import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { auth } from "next-auth";
import { auth as clerkAuth } from "@clerk/nextjs/server";
import { getSession, currentDepot, lookup, settings } from "./lib";
declare const db: any;
declare const rows: any;
"#;

/// Each function hands `<value>` to `eq(rows.depotId, <value>)`.
fn handing(values: &[(&str, &str, &str)]) -> String {
    let mut out = HEAD.to_string();
    for (name, params, body) in values {
        out += &format!("export async function {name}({params}) {{\n{body}\n}}\n");
    }
    out
}

const LIB: &str = r#"import { auth } from "next-auth";
export async function getSession() {
  return JSON.parse("{}");
}
export async function currentDepot() {
  const session = await auth();
  return session?.user?.depotId ?? null;
}
export async function lookup() {
  return { depotId: "d1" };
}
export const settings = { depot: "d1" };
"#;

#[test]
fn the_sources_of_a_value_of_the_caller_are_a_closed_list() {
    let q = |v: &str| format!("  return db.select().where(eq(rows.depotId, {v}));");
    let callers: Vec<(&str, &str, String)> = vec![
        ("accessor", "", format!("  const session = await getSession();\n{}", q("session.depotId"))),
        ("accessorInline", "", q("(await auth()).user.depotId")),
        ("importedUnderAnotherName", "", format!("  const {{ orgId }} = await clerkAuth();\n{}", q("orgId"))),
        ("verified", "token: string", format!("  const claims = jwt.verify(token, \"k\") as any;\n{}", q("claims.depotId"))),
        ("reqUser", "req: any", q("req.user.depotId")),
        ("reqAuth", "req: any", q("req.auth.depotId")),
        ("reqSession", "request: any", q("request.session.user.depotId")),
        ("resLocals", "req: any, res: any", q("res.locals.user.depotId")),
        ("honoGet", "c: any", q("c.get(\"user\").depotId")),
        ("honoVar", "c: any", q("c.var.claims.depotId")),
        ("trpcCtx", "{ ctx }: any", q("ctx.session.user.depotId")),
        ("trpcOpts", "opts: any", q("opts.ctx.user.depotId")),
        ("tenantKeyOnTheRequest", "req: any", q("req.orgId")),
        ("namedParameter", "currentUser: any", q("currentUser.depotId")),
        ("destructured", "", format!("  const session = await getSession();\n  const {{ user: {{ depotId }} }} = session;\n{}", q("depotId"))),
        ("severalHops", "req: any", format!("  const a = req.user;\n  const b = a;\n  const c2 = b.depotId;\n  const d = String(c2).trim();\n{}", q("d"))),
        ("inAnArm", "req: any, flag: boolean", q("flag ? \"d0\" : req.user.depotId")),
        ("inATemplate", "req: any", q("`depot:${req.user.depotId}`")),
        ("shorthand", "req: any", "  const depotId = req.user.depotId;\n  return db.select().where(eq(rows.depotId, { depotId }));".to_string()),
        ("loopElement", "req: any", format!("  for (const m of req.user.memberships) {{\n  {}\n  }}", q("m.depotId"))),
    ];
    let others: Vec<(&str, &str, String)> = vec![
        ("query", "req: any", q("req.query.depot")),
        ("params", "req: any", q("req.params.depot")),
        ("body", "req: any", q("req.body.depot")),
        ("headers", "req: any", q("req.headers[\"x-depot\"]")),
        ("cookies", "req: any", q("req.cookies.depot")),
        (
            "searchParams",
            "req: any",
            q("req.nextUrl.searchParams.get(\"depot\")"),
        ),
        ("trpcInput", "{ ctx, input }: any", q("input.depot")),
        ("honoQuery", "c: any", q("c.req.query(\"depot\")")),
        ("environment", "", q("process.env.DEPOT")),
        ("aSetting", "", q("settings.depot")),
        ("aLiteral", "", q("\"d1\"")),
        (
            "anotherCall",
            "",
            format!("  const row = await lookup();\n{}", q("row.depotId")),
        ),
        (
            "aLoaderByAnArgument",
            "id: string",
            format!("  const u = await db.getUser(id);\n{}", q("u.depotId")),
        ),
        ("aPlainParameter", "depot: string", q("depot")),
        ("aKeyNothingBinds", "req: any", q("req.depot")),
    ];
    let all: Vec<(&str, &str, &str)> = callers
        .iter()
        .chain(&others)
        .map(|(n, p, b)| (*n, *p, b.as_str()))
        .collect();
    let facts = scanned(&[
        ("package.json", PACKAGE),
        ("lib.ts", LIB),
        ("handlers.ts", &handing(&all)),
    ]);
    let listed = facts.listed();
    let f = file(&listed, "handlers.ts");
    for (name, _, _) in &callers {
        assert_eq!(symbol(f, name).caller_args, [EQ], "{name}");
    }
    for (name, _, _) in &others {
        assert!(
            symbol(f, name).caller_args.is_empty(),
            "{name}: {:?}",
            symbol(f, name).caller_args
        );
    }
    // What mining reads holds none of it.
    let mined = file(&facts, "handlers.ts");
    for s in &mined.symbols {
        assert!(s.caller_args.is_empty(), "{}", s.name);
    }
}

#[test]
fn a_use_that_is_no_scope_is_not_recorded_and_every_other_one_is() {
    let cases: Vec<(&str, &str, &str, &[&str])> = vec![
        // No scope.
        (
            "returned",
            "req: any",
            "  return { who: req.user.id };",
            &[],
        ),
        (
            "answered",
            "req: any, res: any",
            "  res.status(200).json({ who: req.user.id });",
            &[],
        ),
        (
            "answeredNext",
            "req: any",
            "  return Response.json(req.user);",
            &[],
        ),
        (
            "logged",
            "req: any",
            "  console.log(\"seen\", req.user.id);",
            &[],
        ),
        (
            "converted",
            "req: any",
            "  const id = String(req.user.id);\n  return id;",
            &[],
        ),
        (
            "collected",
            "req: any",
            "  const ids: string[] = [];\n  ids.push(req.user.id);\n  return ids;",
            &[],
        ),
        (
            "comparedWithItself",
            "req: any",
            "  return req.user.id === req.user.id;",
            &[],
        ),
        (
            "presence",
            "req: any",
            "  if (!req.user?.id) return null;\n  if (req.user.id == null) return null;\n  return 1;",
            &[],
        ),
        (
            "comparedByOrder",
            "req: any",
            "  return req.user.expires < Date.now();",
            &[],
        ),
        // Recorded, by the callee where there is one.
        (
            "handed",
            "req: any",
            "  return db.select().where(eq(rows.depotId, req.user.depotId));",
            &[EQ],
        ),
        (
            "inAnObject",
            "req: any",
            "  return lookup({ where: { depotId: req.user.depotId } });",
            &["lib.ts#lookup"],
        ),
        (
            "collectedThenHanded",
            "req: any",
            "  const ids: string[] = [];\n  ids.push(req.user.id);\n  return lookup(ids);",
            &["lib.ts#lookup"],
        ),
        (
            "fetched",
            "req: any",
            "  return fetch(`http://svc/x?d=${req.user.depotId}`);",
            &["global#fetch"],
        ),
        (
            "built",
            "req: any",
            "  return new Scope(req.user.depotId);",
            &["global#Scope(new)"],
        ),
        (
            "compared",
            "req: any",
            "  return rows.filter((r: any) => r.depotId === req.user.depotId);",
            &[UNREAD],
        ),
        (
            "switched",
            "req: any",
            "  switch (req.user.role) {\n    case \"admin\":\n      return 1;\n  }\n  return 0;",
            &[UNREAD],
        ),
        (
            "indexed",
            "req: any",
            "  return rows[req.user.depotId];",
            &[UNREAD],
        ),
        (
            "included",
            "req: any",
            "  return [\"a\"].includes(req.user.depotId);",
            &[UNREAD],
        ),
        (
            "tested",
            "req: any",
            "  return req.user.isAdmin ? rows : [];",
            &[UNREAD],
        ),
        (
            "aMethodOfTheCaller",
            "req: any",
            "  return req.user.can(\"edit\");",
            &[UNREAD],
        ),
    ];
    let all: Vec<(&str, &str, &str)> = cases.iter().map(|(n, p, b, _)| (*n, *p, *b)).collect();
    let facts = scanned(&[
        ("package.json", PACKAGE),
        ("lib.ts", LIB),
        ("handlers.ts", &handing(&all)),
    ]);
    let listed = facts.listed();
    let f = file(&listed, "handlers.ts");
    for (name, _, _, want) in &cases {
        assert_eq!(symbol(f, name).caller_args, *want, "{name}");
    }
}

#[test]
fn what_a_helper_or_a_holder_gives_is_named_and_kept_only_where_it_gives_the_caller() {
    let facts = scanned(&[
        ("package.json", PACKAGE),
        ("lib.ts", LIB),
        (
            "handlers.ts",
            &handing(&[
                // A function of the repository whose body returns a value of the
                // caller, called with nothing.
                (
                    "fromAHelper",
                    "",
                    "  return db.select().where(eq(rows.depotId, await currentDepot()));",
                ),
                // One whose body returns anything else.
                (
                    "fromAnotherCall",
                    "",
                    "  return db.select().where(eq(rows.depotId, (await lookup()).depotId));",
                ),
                // A key a middleware binds a value of the caller on, read off
                // another spelling of the holder.
                (
                    "bind",
                    "c: any, next: any",
                    "  const claims = jwt.verify(c.req.header(\"authorization\"), \"k\") as any;\n  c.set(\"depot\", claims.depotId);\n  return next();",
                ),
                (
                    "fromAHolder",
                    "req: any",
                    "  return db.select().where(eq(rows.depotId, req.depot));",
                ),
                (
                    "comparedWithAHolder",
                    "c: any",
                    "  return rows.filter((r: any) => r.depotId === c.var.depot);",
                ),
                // A key nothing binds one on.
                (
                    "fromAnUnboundKey",
                    "req: any",
                    "  return db.select().where(eq(rows.depotId, req.region));",
                ),
                // What the body signs the caller in by.
                (
                    "signedInBy",
                    "req: any",
                    "  const who = await lookup();\n  if (!who) return Response.json({}, { status: 401 });\n  return db.select().where(eq(rows.depotId, who.depotId));",
                ),
            ]),
        ),
    ]);
    let listed = facts.listed();
    let f = file(&listed, "handlers.ts");
    let args = |n: &str| symbol(f, n).caller_args.clone();
    assert_eq!(
        args("fromAHelper"),
        [format!("{EQ} via lib.ts#currentDepot")]
    );
    assert!(args("fromAnotherCall").is_empty());
    assert_eq!(args("bind"), ["global#held.depot"]);
    assert_eq!(args("fromAHolder"), [format!("{EQ} via global#held.depot")]);
    assert_eq!(
        args("comparedWithAHolder"),
        ["global#held.depot via global#held.depot"]
    );
    assert!(args("fromAnUnboundKey").is_empty());
    assert_eq!(args("signedInBy"), [EQ]);
    let returns = |n: &str| {
        symbol(file(&listed, "lib.ts"), n)
            .controls
            .iter()
            .any(|c| c == drift_core::controls::RETURNS_CALLER)
    };
    assert!(returns("currentDepot"));
    assert!(!returns("lookup"));
    assert!(!returns("getSession"));
}

#[test]
fn a_function_and_a_method_say_whether_they_do_something_with_their_parameters() {
    let facts = scanned(&[
        ("package.json", PACKAGE),
        (
            "service.ts",
            r#"import { eq } from "drizzle-orm";
declare const db: any;
declare const rows: any;
export function listFor(depot: string) {
  return db.select().where(eq(rows.depotId, depot));
}
export function audit(who: string) {
  console.log("seen", who);
}
export function forward(req: any) {
  return req.headers.authorization;
}
export function handsBack(depot: string) {
  return depot.trim();
}
export function rest(...depots: string[]) {
  return db.select().where(eq(rows.depotId, depots[0]));
}
export function namedLikeAContext(ctx: { depot: string }) {
  return db.select().where(eq(rows.depotId, ctx.depot));
}
export class Parcels {
  listFor(depot: string) {
    return db.select().where(eq(rows.depotId, depot));
  }
  mine(user: any) {
    return db.select().where(eq(rows.depotId, user.depotId));
  }
  count() {
    return db.count();
  }
}
"#,
        ),
    ]);
    let listed = facts.listed();
    let f = file(&listed, "service.ts");
    let flows = |n: &str| {
        f.symbol_calls(symbol(f, n))
            .is_some_and(|calls| calls.param_flows)
    };
    assert!(flows("listFor"));
    assert!(!flows("audit"));
    assert!(!flows("forward"));
    // What it hands back of a parameter is used where the call's value is.
    assert!(flows("handsBack"));
    assert!(flows("rest"));
    assert!(flows("namedLikeAContext"));
    let class = symbol(f, "Parcels");
    let member = |n: &str| class.members.iter().find(|m| m.name == n).unwrap();
    let param_flows = drift_core::controls::PARAM_FLOWS.to_string();
    assert!(member("listFor").unread.contains(&param_flows));
    assert!(!member("count").unread.contains(&param_flows));
    assert_eq!(member("mine").caller_args, [EQ]);
    // The class holds what its methods do with a value of the caller in the
    // methods, not rolled up.
    assert!(class.caller_args.is_empty());
}
