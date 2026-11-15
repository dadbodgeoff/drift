//! Whose rows a TypeScript route reads, by what its code does and never by what
//! anything is called.
//!
//! - **A helper gives the caller by what it returns.** `requireSeat(request)`
//!   returns what `seatOf(request)` gave, which is read off the row the session
//!   token names: its value is the caller's whatever the helper is called
//!   (`requireUserId` reads the same). One that returns what the request chose
//!   (`?as=`) gives nothing of the caller.
//! - **Rows narrowed to the caller itself are the caller's under any key**
//!   (`where: { id: seat }`, `where: { target_type: { type, target: seat } }`),
//!   not under a negation (`id: { not: seat }`) or beside an alternative that is
//!   anyone's (`OR: [{ holder: seat }, { open: true }]`). The caller itself is
//!   what the helper a request is refused without hands back, or the key of the
//!   caller's record; a setting or a group read off the caller (the session's
//!   locale, its kennel) is not, and rows by it stay unproven.
//! - **A query every call of which is narrowed to the caller**, on whatever path
//!   (`if (intent === "delete") delete({ where: { id, holder: seat } })`), scopes
//!   the route; beside a call of it narrowed by nothing of the caller it does not.
//! - **A refusal where no row of the caller's own meets a fixed condition** is the
//!   role's check (`findFirst({ where: { id: seat, roles: { some: { name } } } })`,
//!   `if (!user) throw 403`, with `name` a literal at the call): not where the
//!   request chose the role, and not where the refusal is the other way round.
//! - **What identifies the caller proves no scope.** The session row the sign-in
//!   helper looks up by the token is the caller's, and a route that does nothing
//!   else is not thereby authorized for what its path names.
//! - **A client built in a factory is the client.** `remember("prisma", () => {
//!   const client = new PrismaClient(); return client })` binds what the function
//!   built: `prisma.user.findUnique` is a query. A factory that returns anything
//!   else is not read as one.
//! - **What is called only in what a body throws changes nothing before a check
//!   that follows**: `throw redirect("/", { headers: { "set-cookie": await
//!   sessions.destroySession(held) } })` in the sign-in helper does not make the
//!   owner's filter after it late; the same call as a statement of its own does.

use std::collections::BTreeMap;
use std::process::Command;
use std::sync::LazyLock;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: LazyLock<String> = LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const PACKAGE: &str = r#"{ "name": "web", "dependencies": { "react-router": "7.1.0", "@react-router/node": "7.1.0", "@prisma/client": "5.20.0", "@epic-web/remember": "1.1.0" } }
"#;

const DB: &str = r#"import { remember } from "@epic-web/remember";
import { PrismaClient } from "@prisma/client";

export const prisma = remember("prisma", () => {
  const client = new PrismaClient();
  void client.$connect();
  return client;
});

export const stats = remember("stats", () => {
  const client = new PrismaClient();
  return { client, started: Date.now() };
});
"#;

const SESSION: &str = r#"import { createCookieSessionStorage } from "react-router";

export const sessions = createCookieSessionStorage({
  cookie: { name: "seat", httpOnly: true, secrets: [process.env.SESSION_SECRET ?? ""] },
});
"#;

const SEAT: &str = r#"import { redirect } from "react-router";
import { prisma } from "./db.server";
import { sessions } from "./session.server";

export async function seatOf(request: Request) {
  const held = await sessions.getSession(request.headers.get("cookie"));
  const token = held.get("token");
  if (!token) return null;
  const row = await prisma.session.findUnique({
    select: { userId: true },
    where: { id: token, expirationDate: { gt: new Date() } },
  });
  if (!row?.userId) {
    throw redirect("/", {
      headers: { "set-cookie": await sessions.destroySession(held) },
    });
  }
  return row.userId;
}

export async function requireSeat(request: Request) {
  const seat = await seatOf(request);
  if (!seat) {
    throw redirect("/login");
  }
  return seat;
}

export async function requireUserId(request: Request) {
  const seat = await seatOf(request);
  if (!seat) {
    throw redirect("/login");
  }
  return seat;
}

export async function asked(request: Request) {
  const who = new URL(request.url).searchParams.get("as");
  if (!who) {
    throw redirect("/login");
  }
  return who;
}

export async function localeOf(request: Request) {
  const held = await sessions.getSession(request.headers.get("cookie"));
  return held.get("locale");
}

export async function forgetting(request: Request) {
  const held = await sessions.getSession(request.headers.get("cookie"));
  await sessions.destroySession(held);
  const seat = await seatOf(request);
  if (!seat) {
    throw redirect("/login");
  }
  return seat;
}

export async function requireRole(request: Request, name: string) {
  const seat = await requireSeat(request);
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: { id: seat, roles: { some: { name } } },
  });
  if (!user) {
    throw new Response("no", { status: 403 });
  }
  return user.id;
}

export async function refuseRole(request: Request, name: string) {
  const seat = await requireSeat(request);
  const user = await prisma.user.findFirst({
    select: { id: true },
    where: { id: seat, roles: { some: { name } } },
  });
  if (user) {
    throw new Response("no", { status: 403 });
  }
  return seat;
}

export async function requireSecret(seat: string) {
  const secret = await prisma.secret.findUnique({ select: { id: true }, where: { userId: seat } });
  if (!secret) {
    throw redirect("/secret/new");
  }
}
"#;

/// The routes, each a file of `app/routes`.
const ROUTES: &[(&str, &str)] = &[
    (
        "lang.$id.tsx",
        r#"import { localeOf, requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  await requireSeat(request);
  const lang = await localeOf(request);
  const pages = await prisma.page.findMany({ where: { lang } });
  return { pages };
}
"#,
    ),
    (
        "group.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";
import { sessions } from "../utils/session.server";

export async function loader({ request }: any) {
  await requireSeat(request);
  const held = await sessions.getSession(request.headers.get("cookie"));
  const rows = await prisma.page.findMany({ where: { kennel: held.get("kennel") } });
  return { rows };
}
"#,
    ),
    (
        "mine.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  const seat = await requireSeat(request);
  const me = await prisma.user.findUnique({ where: { id: seat } });
  return { me };
}
"#,
    ),
    (
        "named.tsx",
        r#"import { requireUserId } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  const seat = await requireUserId(request);
  const me = await prisma.user.findUnique({ where: { id: seat } });
  return { me };
}
"#,
    ),
    (
        "as.tsx",
        r#"import { asked } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  const who = await asked(request);
  const them = await prisma.user.findUnique({ where: { id: who } });
  return { them };
}
"#,
    ),
    (
        "nested.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

const kind = "2fa";

export async function loader({ request }: any) {
  const seat = await requireSeat(request);
  const v = await prisma.verification.findUnique({
    select: { id: true },
    where: { target_type: { type: kind, target: seat } },
  });
  return { on: Boolean(v) };
}
"#,
    ),
    (
        "others.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  const seat = await requireSeat(request);
  const rows = await prisma.user.findMany({ where: { id: { not: seat } } });
  return { rows };
}
"#,
    ),
    (
        "either.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  const seat = await requireSeat(request);
  const rows = await prisma.note.findMany({ where: { OR: [{ holder: seat }, { open: true }] } });
  return { rows };
}
"#,
    ),
    (
        "any.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request, params }: any) {
  await requireSeat(request);
  const note = await prisma.note.findFirst({ where: { id: params.id } });
  return { note };
}
"#,
    ),
    (
        "only.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";

export async function loader({ request }: any) {
  await requireSeat(request);
  return {};
}
"#,
    ),
    (
        "admin.tsx",
        r#"import { requireRole } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  await requireRole(request, "admin");
  const users = await prisma.user.findMany({ select: { id: true } });
  return { users };
}
"#,
    ),
    (
        "role.$role.tsx",
        r#"import { requireRole } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request, params }: any) {
  await requireRole(request, params.role);
  const users = await prisma.user.findMany({ select: { id: true } });
  return { users };
}
"#,
    ),
    (
        "inverted.$id.tsx",
        r#"import { refuseRole } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function loader({ request }: any) {
  await refuseRole(request, "admin");
  const users = await prisma.user.findMany({ select: { id: true } });
  return { users };
}
"#,
    ),
    (
        "stats.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { stats } from "../utils/db.server";

export async function loader({ request }: any) {
  const seat = await requireSeat(request);
  const me = await stats.client.user.findUnique({ where: { id: seat } });
  return { me };
}
"#,
    ),
    (
        "secret.$id.tsx",
        r#"import { requireSeat, requireSecret } from "../utils/seat.server";

export async function loader({ request }: any) {
  const seat = await requireSeat(request);
  await requireSecret(seat);
  return {};
}
"#,
    ),
    (
        "forgot.$id.tsx",
        r#"import { forgetting, requireSecret } from "../utils/seat.server";

export async function loader({ request }: any) {
  const seat = await forgetting(request);
  await requireSecret(seat);
  return {};
}
"#,
    ),
    (
        "keys.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function action({ request }: any) {
  const seat = await requireSeat(request);
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    const id = form.get("id");
    await prisma.passkey.delete({ where: { id, holder: seat } });
  }
  return {};
}
"#,
    ),
    (
        "loose.$id.tsx",
        r#"import { requireSeat } from "../utils/seat.server";
import { prisma } from "../utils/db.server";

export async function action({ request }: any) {
  const seat = await requireSeat(request);
  const form = await request.formData();
  const id = form.get("id");
  if (form.get("intent") === "delete") {
    await prisma.passkey.delete({ where: { id, holder: seat } });
  } else {
    await prisma.passkey.delete({ where: { id } });
  }
  return {};
}
"#,
    ),
];

/// `METHOD route` -> `known <mechanisms>`, `none`, or `unknown <reason>
/// <obligation>`, of the whole fixture, read once.
static READ: LazyLock<BTreeMap<String, String>> = LazyLock::new(|| {
    let dir = tempfile::tempdir().unwrap();
    let mut files: Vec<(String, &str)> = vec![
        ("package.json".into(), PACKAGE),
        ("app/utils/db.server.ts".into(), DB),
        ("app/utils/session.server.ts".into(), SESSION),
        ("app/utils/seat.server.ts".into(), SEAT),
    ];
    files.extend(
        ROUTES
            .iter()
            .map(|(name, text)| (format!("app/routes/{name}"), *text)),
    );
    for (rel, text) in &files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(dir.path())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let map: Value = serde_json::from_slice(&out.stdout).unwrap();
    let concern = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .cloned()
        .unwrap();
    let variants: Vec<Value> = concern["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|v| {
            std::iter::once(v.clone())
                .chain(v["alternatives"].as_array().into_iter().flatten().cloned())
        })
        .collect();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "known" => {
                    let key = u["key"]
                        .as_str()
                        .or_else(|| {
                            variants
                                .iter()
                                .find(|v| v["id"] == u["variant"])
                                .and_then(|v| v["key"].as_str())
                        })
                        .unwrap_or_default();
                    format!("known {key}")
                }
                "unknown" => format!(
                    "unknown {} {}",
                    u["reason"].as_str().unwrap_or_default(),
                    u["not_proven"]["obligation"].as_str().unwrap_or_default()
                )
                .trim_end()
                .to_string(),
                other => other.to_string(),
            };
            (
                format!(
                    "{} {}",
                    u["method"].as_str().unwrap_or_default(),
                    u["route"].as_str().unwrap_or_default()
                ),
                said,
            )
        })
        .collect()
});

fn said(route: &str) -> &'static str {
    READ.get(route)
        .unwrap_or_else(|| panic!("{route} is not a unit: {:#?}", *READ))
}

#[test]
fn a_helper_gives_the_caller_by_what_it_returns_whatever_it_is_called() {
    assert_eq!(said("GET /mine"), "known owner_filter:where.id (session)");
    // The same body under a name the lowering knows reads the same.
    assert_eq!(said("GET /named"), said("GET /mine"));
}

#[test]
fn a_helper_that_returns_what_the_request_chose_gives_no_caller() {
    assert_eq!(said("GET /as"), "unknown unresolved");
}

#[test]
fn rows_narrowed_to_the_caller_are_the_callers_under_any_key() {
    assert_eq!(
        said("GET /nested/:id"),
        "known owner_filter:where.target_type.target (session)"
    );
}

#[test]
fn a_setting_or_a_group_read_off_the_caller_is_not_the_caller() {
    // What a helper that never refuses hands back (the session's locale), and a
    // member read off the session: rows by either are not this caller's alone.
    for route in ["GET /lang/:id", "GET /group/:id"] {
        assert!(
            said(route).starts_with("unknown"),
            "{route}: {}",
            said(route)
        );
    }
}

#[test]
fn a_negation_or_an_alternative_that_is_anyones_narrows_nothing() {
    assert_eq!(said("GET /others/:id"), "unknown unresolved");
    assert_eq!(said("GET /either/:id"), "unknown unresolved");
}

#[test]
fn a_row_chosen_by_the_request_is_not_the_callers() {
    assert_eq!(said("GET /any/:id"), "unknown unresolved");
}

#[test]
fn what_identifies_the_caller_proves_no_scope() {
    // The sign-in helper looks the session up by the caller's token, and the
    // route does nothing else.
    assert_eq!(said("GET /only/:id"), "unknown unresolved");
}

#[test]
fn a_refusal_where_no_row_of_the_callers_meets_a_fixed_condition_is_a_role_check() {
    assert_eq!(said("GET /admin"), "known role_check:where.roles.some.name");
}

#[test]
fn a_role_the_request_chose_or_a_refusal_the_other_way_round_is_no_role_check() {
    for route in ["GET /role/:role", "GET /inverted/:id"] {
        assert!(
            said(route).starts_with("unknown check_not_proven"),
            "{route}: {}",
            said(route)
        );
    }
}

#[test]
fn a_client_built_in_a_factory_is_the_client_and_anything_else_is_not() {
    // Every query above is through `prisma`, which a factory built.
    assert!(said("GET /mine").starts_with("known"));
    // `stats` is `{ client, started }`: not what the factory built.
    assert_eq!(said("GET /stats/:id"), "unknown unresolved");
}

#[test]
fn a_call_only_in_what_a_body_throws_is_no_effect_before_what_follows() {
    assert_eq!(
        said("GET /secret/:id"),
        "known owner_filter:where.userId (session)"
    );
    // The same call as a statement of its own: the filter runs after it.
    assert_eq!(
        said("GET /forgot/:id"),
        "unknown check_not_proven after_effect"
    );
}

#[test]
fn a_query_every_call_of_which_is_by_the_caller_scopes_the_route() {
    assert_eq!(
        said("POST /keys/:id"),
        "known owner_filter:where.holder (session)"
    );
    // One call of it narrowed by nothing of the caller.
    assert_eq!(said("POST /loose/:id"), "unknown unresolved");
}
