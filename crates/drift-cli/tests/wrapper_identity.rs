//! Call-wrapper rules and the wrappers built on a rule's wrapper (F1): a tRPC procedure
//! built on an authenticated one (`bookingsProcedure = authedProcedure.input(s).use(mw)`)
//! is that procedure, and a next-safe-action client chain without `.inputSchema()` is
//! the rule's chain for a handler that takes no input. A wrapper built on a public one,
//! or by a step that may replace what it is built on, is not.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String) {
    let mut child = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    } else {
        drop(child.stdin.take());
    }
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
    )
}

fn census(root: &Path) -> Vec<Value> {
    let (code, out) = run(root, &["census", "--json"], None);
    assert_eq!(code, 0, "census failed");
    let v: Value = serde_json::from_str(&out).unwrap();
    v["proposals"].as_array().unwrap().clone()
}

/// The call-wrapper proposal whose `any_of` is exactly `targets` (short names).
fn wrapped_in<'a>(proposals: &'a [Value], targets: &[&str]) -> Option<&'a Value> {
    proposals.iter().find(|p| {
        p["rule"]["type"] == "wrapped_by"
            && p["rule"]["kind"] == "call"
            && p["rule"]["any_of"].as_array().is_some_and(|a| {
                a.len() == targets.len()
                    && a.iter().zip(targets).all(|(x, t)| {
                        x.as_str()
                            .and_then(|x| x.rsplit_once('#'))
                            .is_some_and(|(_, n)| n == *t)
                    })
            })
    })
}

fn symbols(list: &Value) -> Vec<String> {
    let mut v: Vec<String> = list
        .as_array()
        .map(|a| {
            a.iter()
                .map(|o| o["symbol"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

fn base(root: &Path) {
    write(
        root,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"@trpc/server\": \"11.0.0\", \"next-safe-action\": \"8.0.0\", \"zod\": \"3.0.0\" } }",
    );
    write(
        root,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    for i in 0..60 {
        write(
            root,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
}

const TRPC: &str = "import { initTRPC } from \"@trpc/server\";\nconst t = initTRPC.create();\nexport const procedure = t.procedure;\nexport const middleware = t.middleware;\n";
const MIDDLEWARE: &str = "import { middleware } from \"./trpc\";\nexport const isAuthed = middleware(({ ctx, next }) => next({ ctx }));\nexport const rateLimit = middleware(({ next }) => next());\n";
/// The procedures: an authenticated one built on the base procedure, a public alias of
/// it, and a rate-limited one built on the public one.
const PROCEDURES: &str = "import { procedure } from \"./trpc\";\nimport { isAuthed, rateLimit } from \"./middleware\";\nexport const authedProcedure = procedure.use(isAuthed);\nexport const publicProcedure = procedure;\nexport const rateLimitedProcedure = publicProcedure.use(rateLimit);\n";

/// A tRPC repo: 40 routers use `authedProcedure`; `derived` lists (file, procedure
/// import, procedure) for the others, one router each.
fn trpc_repo(extra: &[(&str, &str)], others: &[(&str, &str, &str)]) -> tempfile::TempDir {
    trpc_repo_on("@/server/procedures", "authedProcedure", extra, others)
}

/// [`trpc_repo`] whose 40 routers use `holder`, imported from `from`.
fn trpc_repo_on(
    from: &str,
    holder: &str,
    extra: &[(&str, &str)],
    others: &[(&str, &str, &str)],
) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    base(r);
    write(r, "server/trpc.ts", TRPC);
    write(r, "server/middleware.ts", MIDDLEWARE);
    write(r, "server/procedures.ts", PROCEDURES);
    for (rel, body) in extra {
        write(r, rel, body);
    }
    for i in 0..40 {
        write(
            r,
            &format!("server/routers/r{i:02}/_router.ts"),
            &format!(
                "import {{ {holder} }} from \"{from}\";\nexport const q{i} = {holder}.query(async ({{ ctx }}) => ctx.load({i}));\n"
            ),
        );
    }
    for (i, (from, name, wrapper)) in others.iter().enumerate() {
        write(
            r,
            &format!("server/routers/x{i}/_router.ts"),
            &format!(
                "import {{ {name} }} from \"{from}\";\nexport const x{i} = {wrapper}.mutation(async ({{ ctx, input }}) => ctx.save(input));\n"
            ),
        );
    }
    dir
}

const BOOKINGS_UTIL: (&str, &str) = (
    "server/routers/bookings/util.ts",
    "import { z } from \"zod\";\nimport { authedProcedure } from \"@/server/procedures\";\nexport const bookingsProcedure = authedProcedure\n  .input(z.object({ id: z.number() }))\n  .use(async ({ ctx, next }) => next({ ctx }));\n",
);

// cal.com D-0b36fb: `bookingsProcedure = authedProcedure.input(...).use(...)` in another
// file is authenticated through a derived helper. Its routers hold "wrapped in
// authedProcedure", and the census says so; the public-derived routers stay outliers.
#[test]
fn a_procedure_built_on_the_rules_procedure_holds_it() {
    let bookings = (
        "@/server/routers/bookings/util",
        "bookingsProcedure",
        "bookingsProcedure",
    );
    let open = (
        "@/server/procedures",
        "rateLimitedProcedure",
        "rateLimitedProcedure",
    );
    let dir = trpc_repo(
        &[BOOKINGS_UTIL],
        &[bookings, bookings, bookings, open, open],
    );
    let proposals = census(dir.path());
    let p = wrapped_in(&proposals, &["authedProcedure"]).expect("authedProcedure rule");
    assert_eq!(p["evidence"]["holders"], 43, "{p}");
    assert_eq!(p["evidence"]["total"], 45, "{p}");
    // Built on `publicProcedure`, not on `authedProcedure`: still outliers.
    assert_eq!(symbols(&p["outliers"]), ["x3", "x4"], "{p}");
    assert_eq!(symbols(&p["derived"]), ["x0", "x1", "x2"], "{p}");
    for d in p["derived"].as_array().unwrap() {
        assert!(
            d["wrapper"]
                .as_str()
                .unwrap()
                .ends_with("util.ts#bookingsProcedure")
        );
        assert!(
            d["from"]
                .as_str()
                .unwrap()
                .ends_with("procedures.ts#authedProcedure")
        );
    }
    // The example is wrapped in the rule's own procedure.
    assert!(
        p["example"]["path"]
            .as_str()
            .unwrap()
            .starts_with("server/routers/r"),
        "{p}"
    );
    let (_, text) = run(dir.path(), &["census"], None);
    assert!(
        text.contains("derived:  bookingsProcedure 3 (built on authedProcedure)"),
        "{text}"
    );
}

// Aliases and re-exports are the binding they name (`export const p = base`, a barrel's
// `export { p } from`), and `.input()` only adds to a procedure. (One router each: a
// wrapper of several routers would join the rule as a variant of its own.)
#[test]
fn aliases_reexports_and_input_are_the_procedure_they_name() {
    let extra = [
        (
            "server/admin.ts",
            "import { authedProcedure } from \"./procedures\";\nexport const adminProcedure = authedProcedure.input(adminSchema);\nexport const staffProcedure = adminProcedure;\n",
        ),
        (
            "server/index.ts",
            "export { staffProcedure } from \"./admin\";\n",
        ),
    ];
    let staff = ("@/server/index", "staffProcedure", "staffProcedure");
    let admin = ("@/server/admin", "adminProcedure", "adminProcedure");
    let open = (
        "@/server/procedures",
        "rateLimitedProcedure",
        "rateLimitedProcedure",
    );
    let dir = trpc_repo(&extra, &[staff, admin, open]);
    let proposals = census(dir.path());
    let p = wrapped_in(&proposals, &["authedProcedure"])
        .unwrap_or_else(|| panic!("authedProcedure rule: {proposals:?}"));
    assert_eq!(symbols(&p["derived"]), ["x0", "x1"], "{p}");
    assert_eq!(symbols(&p["outliers"]), ["x2"], "{p}");
    let (_, text) = run(dir.path(), &["census"], None);
    assert!(
        text.contains(
            "derived:  adminProcedure 1 (built on authedProcedure), staffProcedure 1 (built on authedProcedure)"
        ),
        "{text}"
    );
}

// The guard: a chain only adds middleware, so a procedure built on an authenticated one
// is authenticated. One built on a public procedure is not, and one whose name says it
// opens up (`publicBookingsProcedure`) does not count as the authenticated procedure it
// is built on. A step Drift does not know (`.unstable_skip()`) may replace the
// procedure: no derivation.
#[test]
fn a_derived_public_procedure_does_not_satisfy_an_authed_rule() {
    let extra = [(
        "server/more.ts",
        "import { authedProcedure, publicProcedure } from \"./procedures\";\nexport const publicBookingsProcedure = authedProcedure.use(async ({ next }) => next());\nexport const skippingProcedure = authedProcedure.unstable_skip();\nexport const cachedPublicProcedure = publicProcedure.meta({ cache: true });\n",
    )];
    let others = [
        (
            "@/server/more",
            "publicBookingsProcedure",
            "publicBookingsProcedure",
        ),
        ("@/server/more", "skippingProcedure", "skippingProcedure"),
        (
            "@/server/more",
            "cachedPublicProcedure",
            "cachedPublicProcedure",
        ),
        (
            "@/server/procedures",
            "rateLimitedProcedure",
            "rateLimitedProcedure",
        ),
    ];
    let dir = trpc_repo(&extra, &others);
    let proposals = census(dir.path());
    let p = wrapped_in(&proposals, &["authedProcedure"]).expect("authedProcedure rule");
    assert_eq!(symbols(&p["outliers"]), ["x0", "x1", "x2", "x3"], "{p}");
    assert!(p.get("derived").is_none(), "{p}");
}

// The review of #51 (probe T): tRPC middleware reads `meta`, so
// `authedProcedure.meta({ authRequired: false })` may turn authentication off. Metadata
// is no additive step: the procedure derives from nothing and stays an outlier.
#[test]
fn metadata_that_may_turn_auth_off_does_not_derive() {
    let extra = [(
        "server/more.ts",
        "import { authedProcedure } from \"./procedures\";\nexport const bookingsListProcedure = authedProcedure.meta({ authRequired: false });\n",
    )];
    let list = (
        "@/server/more",
        "bookingsListProcedure",
        "bookingsListProcedure",
    );
    let dir = trpc_repo(&extra, &[list, list]);
    let p = wrapped_in(&census(dir.path()), &["authedProcedure"])
        .expect("authedProcedure rule")
        .clone();
    assert_eq!(symbols(&p["outliers"]), ["x0", "x1"], "{p}");
    assert!(p.get("derived").is_none(), "{p}");
}

// The review of #51: a procedure built on the authenticated one whose name negates or
// weakens authentication is not counted as it.
#[test]
fn negated_and_weakened_auth_names_never_hold() {
    let names = [
        "notAuthedProcedure",
        "nonAuthenticatedProcedure",
        "noAuthProcedure",
        "unauthProcedure",
        "allowGuestsProcedure",
        "authNotRequiredProcedure",
        "skipAuthProcedure",
        "maybeAuthedProcedure",
        "softAuthProcedure",
    ];
    let mut more = "import { authedProcedure } from \"./procedures\";\n".to_string();
    for n in names {
        more.push_str(&format!(
            "export const {n} = authedProcedure.use(async ({{ next }}) => next());\n"
        ));
    }
    let extra = [("server/more.ts", more.as_str())];
    let others: Vec<(&str, &str, &str)> = names.iter().map(|n| ("@/server/more", *n, *n)).collect();
    let dir = trpc_repo_on("@/server/procedures", "authedProcedure", &extra, &others);
    // 9 outliers among 49 would not pass the lower bound in a role this size; with 80
    // holders it does.
    for i in 40..80 {
        write(
            dir.path(),
            &format!("server/routers/r{i:02}/_router.ts"),
            &format!(
                "import {{ authedProcedure }} from \"@/server/procedures\";\nexport const q{i} = authedProcedure.query(async ({{ ctx }}) => ctx.load({i}));\n"
            ),
        );
    }
    let p = wrapped_in(&census(dir.path()), &["authedProcedure"])
        .expect("authedProcedure rule")
        .clone();
    let want: Vec<String> = (0..names.len()).map(|i| format!("x{i}")).collect();
    assert_eq!(symbols(&p["outliers"]), want, "{p}");
    assert!(p.get("derived").is_none(), "{p}");
}

// The review of #51: the guard holds whatever the target is named. `teamProcedure` says
// nothing about authentication; `publicTeamProcedure`, built on it, says it opens up and
// does not count as it, while `billingTeamProcedure` does.
#[test]
fn a_public_named_binding_never_holds_an_unknown_named_target() {
    let extra = [(
        "server/team.ts",
        "import { procedure } from \"./trpc\";\nimport { isAuthed } from \"./middleware\";\nexport const teamProcedure = procedure.use(isAuthed);\nexport const publicTeamProcedure = teamProcedure.use(async ({ next }) => next());\nexport const billingTeamProcedure = teamProcedure.use(async ({ next }) => next());\n",
    )];
    let public = (
        "@/server/team",
        "publicTeamProcedure",
        "publicTeamProcedure",
    );
    let billing = (
        "@/server/team",
        "billingTeamProcedure",
        "billingTeamProcedure",
    );
    let dir = trpc_repo_on("@/server/team", "teamProcedure", &extra, &[public, billing]);
    let p = wrapped_in(&census(dir.path()), &["teamProcedure"])
        .expect("teamProcedure rule")
        .clone();
    assert_eq!(symbols(&p["outliers"]), ["x0"], "{p}");
    assert_eq!(symbols(&p["derived"]), ["x1"], "{p}");
}

/// The review's middleware probes: 36 actions `actionClient.use(authMw).inputSchema(s)`,
/// two that follow `odd`, two plain `actionClient.inputSchema(s).action()`.
fn middleware_repo(odd: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    base(r);
    write(
        r,
        "lib/action-client.ts",
        "import { createSafeActionClient } from \"next-safe-action\";\nimport { authMw, rateLimit, logMw } from \"./mw\";\nexport const actionClient = createSafeActionClient();\nexport const loggedClient = actionClient.use(logMw);\nexport const authClient = actionClient.use(authMw);\n",
    );
    write(
        r,
        "lib/mw.ts",
        "export const authMw = async ({ next }) => next({ ctx: { user: await session() } });\nexport const rateLimit = async ({ next }) => next();\nexport const logMw = async ({ next }) => next();\n",
    );
    let head = "\"use server\";\nimport { z } from \"zod\";\nimport { actionClient, loggedClient, authClient } from \"@/lib/action-client\";\nimport { authMw, rateLimit, logMw } from \"@/lib/mw\";\n";
    for i in 0..40 {
        let body = match i {
            0..36 => {
                "export const act{i} = actionClient.use(authMw).inputSchema(z.string()).action(async ({ ctx, parsedInput }) => save(ctx.user, parsedInput));\n"
            }
            36 | 37 => odd,
            _ => {
                "export const act{i} = actionClient.inputSchema(z.string()).action(async ({ ctx, parsedInput }) => save(ctx, parsedInput));\n"
            }
        };
        write(
            r,
            &format!("app/a{i:02}/actions.ts"),
            &format!("{head}{}", body.replace("{i}", &i.to_string())),
        );
    }
    dir
}

// The review of #51 (A2, B2, C2, E3, N4): Drift does not record which middleware a
// `.use()` adds, so a rule chain with a `.use()` is held only by the member's own chain
// with exactly the same steps. A `.use()` of the binding the wrapper is built on (A2, E3), one in
// another place (B2) or fewer of them (C2) never holds it, and does not make a member
// without input exempt (E3).
#[test]
fn a_use_step_is_held_only_in_place_in_the_members_own_chain() {
    let rule = &["actionClient.use().inputSchema().action"];
    for (what, odd) in [
        (
            "A2: built on actionClient.use(logMw)",
            "export const act{i} = loggedClient.inputSchema(z.string()).action(async ({ ctx, parsedInput }) => save(ctx, parsedInput));\n",
        ),
        (
            "B2: use after inputSchema",
            "export const act{i} = actionClient.inputSchema(z.string()).use(logMw).action(async ({ ctx, parsedInput }) => save(ctx, parsedInput));\n",
        ),
        (
            "E3: built on actionClient.use(logMw), no input",
            "export const act{i} = loggedClient.action(async ({ ctx }) => ping(ctx));\n",
        ),
        // N4 (re-review of #51): the rule's `.use()` is anonymous inline middleware, so
        // its chain compares exactly, as on main: another `.use()` without the input
        // step is no exemption, and one with an extra step does not hold.
        (
            "N4: other middleware, no input",
            "export const act{i} = actionClient.use(logMw).action(async ({ ctx }) => ping(ctx));\n",
        ),
        (
            "N4: other middleware and an extra use",
            "export const act{i} = actionClient.use(logMw).inputSchema(z.string()).use(rateLimit).action(async ({ ctx, parsedInput }) => save(ctx, parsedInput));\n",
        ),
    ] {
        let dir = middleware_repo(odd);
        let proposals = census(dir.path());
        let p = proposals
            .iter()
            .find(|p| {
                p["rule"]["any_of"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|x| x.as_str().unwrap().ends_with(rule[0])))
            })
            .unwrap_or_else(|| panic!("{what}: {proposals:?}"));
        let outliers = symbols(&p["outliers"]);
        assert!(
            outliers.contains(&"act36".to_string()) && outliers.contains(&"act37".to_string()),
            "{what}: {p}"
        );
        assert!(p.get("derived").is_none(), "{what}: {p}");
        assert!(p.get("exempt").is_none(), "{what}: {p}");
    }
    // C2: the rule's chain has two `.use()`s; one is not enough.
    let dir = middleware_repo(
        "export const act{i} = actionClient.use(rateLimit).inputSchema(z.string()).action(async ({ ctx, parsedInput }) => save(ctx, parsedInput));\n",
    );
    let r = dir.path();
    for i in 0..36 {
        write(
            r,
            &format!("app/a{i:02}/actions.ts"),
            &format!(
                "\"use server\";\nimport {{ z }} from \"zod\";\nimport {{ actionClient }} from \"@/lib/action-client\";\nimport {{ authMw, rateLimit }} from \"@/lib/mw\";\nexport const act{i} = actionClient.use(authMw).use(rateLimit).inputSchema(z.string()).action(async ({{ ctx, parsedInput }}) => save(ctx.user, parsedInput));\n"
            ),
        );
    }
    let proposals = census(r);
    let p = proposals
        .iter()
        .find(|p| {
            p["rule"]["any_of"].as_array().is_some_and(|a| {
                a.iter().any(|x| {
                    x.as_str()
                        .unwrap()
                        .ends_with("actionClient.use().use().inputSchema().action")
                })
            })
        })
        .unwrap_or_else(|| panic!("C2: {proposals:?}"));
    let outliers = symbols(&p["outliers"]);
    assert!(
        outliers.contains(&"act36".to_string()) && outliers.contains(&"act37".to_string()),
        "C2: {p}"
    );
}

/// A next-safe-action repo: 37 actions `authenticatedActionClient.inputSchema(s).action()`
/// and three that follow `odd`.
fn actions_repo(odd: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    base(r);
    write(
        r,
        "lib/action-client.ts",
        "import { createSafeActionClient } from \"next-safe-action\";\nexport const actionClient = createSafeActionClient();\nexport const authenticatedActionClient = actionClient.use(async ({ next }) => next({ ctx: { user: await session() } }));\n",
    );
    for i in 0..40 {
        let body = if i < 37 {
            "\"use server\";\nimport { z } from \"zod\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient\n  .inputSchema(z.object({ id: z.string() }))\n  .action(async ({ ctx, parsedInput }) => save(ctx.user, parsedInput.id));\n"
        } else {
            odd
        };
        write(
            r,
            &format!("app/a{i:02}/actions.ts"),
            &body.replace("{i}", &i.to_string()),
        );
    }
    dir
}

const AUTHED_SCHEMA: &[&str] = &["authenticatedActionClient.inputSchema().action"];

// formbricks D-5303d3: `resetPasswordAction` is `authenticatedActionClient.action()` and
// reads only `ctx`: it takes no input, so it needs no `.inputSchema()`. It is exempt, with
// the reason, not an outlier.
#[test]
fn an_action_without_input_needs_no_input_schema() {
    let dir = actions_repo(
        "\"use server\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient.action(async ({ ctx }) => reset(ctx.user));\n",
    );
    let proposals = census(dir.path());
    let p = wrapped_in(&proposals, AUTHED_SCHEMA).expect("inputSchema rule");
    assert_eq!(p["evidence"]["holders"], 37, "{p}");
    assert_eq!(p["evidence"]["total"], 37, "{p}");
    assert_eq!(p["outliers_total"], 0, "{p}");
    let exempt = p["exempt"].as_array().unwrap();
    assert_eq!(exempt.len(), 3, "{p}");
    assert_eq!(
        exempt[0]["reason"],
        "reads no input, so needs no .inputSchema() (authenticatedActionClient.action() without it)"
    );
}

// The counter-cases: an action that reads its input without a schema is an outlier, and
// so is one wrapped in the public client (not built on the authenticated one), with or
// without input, and one with `.metadata()` (not an additive step). An action with an
// extra additive step (`.outputSchema()`) holds the rule's chain.
#[test]
fn actions_that_read_input_or_skip_authentication_are_outliers() {
    for (what, odd) in [
        (
            "reads input",
            "\"use server\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient.action(async ({ ctx, parsedInput }) => save(ctx.user, parsedInput));\n",
        ),
        (
            "public client without input",
            "\"use server\";\nimport { actionClient } from \"@/lib/action-client\";\nexport const act{i} = actionClient.action(async ({ ctx }) => ping(ctx));\n",
        ),
        (
            "public client with a schema",
            "\"use server\";\nimport { z } from \"zod\";\nimport { actionClient } from \"@/lib/action-client\";\nexport const act{i} = actionClient.inputSchema(z.string()).action(async ({ parsedInput }) => ping(parsedInput));\n",
        ),
    ] {
        let dir = actions_repo(odd);
        let proposals = census(dir.path());
        let p = wrapped_in(&proposals, AUTHED_SCHEMA)
            .unwrap_or_else(|| panic!("{what}: no inputSchema rule"));
        assert_eq!(p["outliers_total"], 3, "{what}: {p}");
        assert!(p.get("exempt").is_none(), "{what}: {p}");
    }
    // `.metadata()` is no additive step (middleware reads it): another chain.
    let dir = actions_repo(
        "\"use server\";\nimport { z } from \"zod\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient.metadata({ name: \"a\" }).inputSchema(z.string()).action(async ({ parsedInput }) => save(parsedInput));\n",
    );
    let p = wrapped_in(&census(dir.path()), AUTHED_SCHEMA).map(|p| p["outliers_total"].clone());
    assert_eq!(p, Some(json!(3)), "metadata");
    // An extra additive step (`.outputSchema()`) keeps the rule's chain: every action holds.
    let dir = actions_repo(
        "\"use server\";\nimport { z } from \"zod\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient.inputSchema(z.string()).outputSchema(z.string()).action(async ({ parsedInput }) => save(parsedInput));\n",
    );
    let proposals = census(dir.path());
    assert!(
        wrapped_in(&proposals, AUTHED_SCHEMA).is_none(),
        "every action holds the chain once more steps count: {proposals:?}"
    );
}

fn hook(root: &Path, event: &str, extra: Value) -> Option<Value> {
    let mut input = json!({ "session_id": "s1", "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (code, out) = run(root, &["hook", "claude", event], Some(&input.to_string()));
    assert_eq!(code, 0, "hooks always exit 0");
    let out = out.trim();
    (!out.is_empty()).then(|| serde_json::from_str(out).expect("hook output is JSON"))
}

fn accept(root: &Path, targets: &[&str]) -> String {
    let id =
        wrapped_in(&census(root), targets).unwrap_or_else(|| panic!("no rule {targets:?}"))["id"]
            .as_str()
            .unwrap()
            .to_string();
    run(root, &["init"], None);
    run(root, &["review", "--block", &id], None);
    hook(root, "SessionStart", json!({ "source": "startup" }));
    id
}

/// `name` is reported as a violation in `out` (hook JSON or check text): named on a line
/// that is not #45's line of exempt members ("not checked against", "exempt").
fn violates(out: &str, name: &str) -> bool {
    out.split("\\n")
        .flat_map(|l| l.split('\n'))
        .any(|l| l.contains(name) && !l.contains("not checked against") && !l.contains("exempt"))
}

/// What PostToolUse says about `rel`, and what `drift check` reports.
fn post_and_check(r: &Path, rel: &str) -> (String, String) {
    let post = hook(
        r,
        "PostToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(rel) } }),
    )
    .map(|v| v.to_string())
    .unwrap_or_default();
    let (_, check) = run(r, &["check"], None);
    (post, check)
}

// `drift check`, the hooks and the census agree: a new router wrapped in a procedure
// built on the rule's (in a file the hook's single-file scan must load) holds it; one
// built on the public procedure, or whose name opens it up, breaks it.
#[test]
fn hooks_check_and_census_agree_on_derived_procedures() {
    let bookings = (
        "@/server/routers/bookings/util",
        "bookingsProcedure",
        "bookingsProcedure",
    );
    let open = (
        "@/server/procedures",
        "rateLimitedProcedure",
        "rateLimitedProcedure",
    );
    let dir = trpc_repo(&[BOOKINGS_UTIL], &[bookings, bookings, open, open]);
    let r = dir.path();
    let id = accept(r, &["authedProcedure"]);
    write(
        r,
        "server/routers/new/_router.ts",
        "import { bookingsProcedure } from \"@/server/routers/bookings/util\";\nexport const fresh = bookingsProcedure.mutation(async ({ ctx, input }) => ctx.save(input));\n",
    );
    let (post, check) = post_and_check(r, "server/routers/new/_router.ts");
    for out in [&post, &check] {
        assert!(!out.contains("fresh"), "{out}");
    }
    write(
        r,
        "server/routers/new/_router.ts",
        "import { rateLimitedProcedure } from \"@/server/procedures\";\nexport const fresh = rateLimitedProcedure.mutation(async ({ ctx, input }) => ctx.save(input));\n",
    );
    let (post, check) = post_and_check(r, "server/routers/new/_router.ts");
    for out in [&post, &check] {
        assert!(out.contains("fresh") && out.contains(&id), "{out}");
    }
}

#[test]
fn hooks_check_and_census_agree_on_actions_without_input() {
    let dir = actions_repo(
        "\"use server\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient.action(async ({ ctx }) => reset(ctx.user));\n",
    );
    let r = dir.path();
    let id = accept(r, AUTHED_SCHEMA);
    write(
        r,
        "app/new/actions.ts",
        "\"use server\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const noInput = authenticatedActionClient.action(async ({ ctx }) => reset(ctx.user));\nexport const readsInput = authenticatedActionClient.action(async ({ parsedInput }) => save(parsedInput));\n",
    );
    let (post, check) = post_and_check(r, "app/new/actions.ts");
    for out in [&post, &check] {
        assert!(violates(out, "readsInput") && out.contains(&id), "{out}");
        // #45 lists exempt members next to the violations; an exempt one is no violation.
        assert!(!violates(out, "noInput"), "{out}");
    }
}

// #45 x #51: the missing-input exemption is decided before #45's gate (no exemption for an
// entry point or under a guard), since its members are handlers under the rule's own
// guard. It must never hide a missing guard: an action on another root binding that reads
// no input (the unauthenticated base client the rule's client is built on, or an unrelated
// client) is not exempt; census, check and the hook report it, while the same-root action
// without input stays exempt.
#[test]
fn an_action_on_another_root_without_input_stays_reported() {
    let dir = actions_repo(
        "\"use server\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient.action(async ({ ctx }) => reset(ctx.user));\n",
    );
    let r = dir.path();
    write(
        r,
        "lib/other-client.ts",
        "import { createSafeActionClient } from \"next-safe-action\";\nexport const otherClient = createSafeActionClient();\n",
    );
    let id = accept(r, AUTHED_SCHEMA);
    write(
        r,
        "app/new/actions.ts",
        "\"use server\";\nimport { actionClient, authenticatedActionClient } from \"@/lib/action-client\";\nimport { otherClient } from \"@/lib/other-client\";\nexport const sameRoot = authenticatedActionClient.action(async ({ ctx }) => reset(ctx.user));\nexport const baseRoot = actionClient.action(async ({ ctx }) => ping(ctx));\nexport const otherRoot = otherClient.action(async ({ ctx }) => ping(ctx));\n",
    );
    let (post, check) = post_and_check(r, "app/new/actions.ts");
    for out in [&post, &check] {
        assert!(out.contains(&id), "{out}");
        assert!(
            violates(out, "baseRoot") && violates(out, "otherRoot"),
            "{out}"
        );
        assert!(!violates(out, "sameRoot"), "{out}");
    }
    // The census, on the same repo before the convention is accepted.
    let fresh = actions_repo(
        "\"use server\";\nimport { authenticatedActionClient } from \"@/lib/action-client\";\nexport const act{i} = authenticatedActionClient.action(async ({ ctx }) => reset(ctx.user));\n",
    );
    let f = fresh.path();
    for rel in ["lib/other-client.ts", "app/new/actions.ts"] {
        write(f, rel, &std::fs::read_to_string(r.join(rel)).unwrap());
    }
    let proposals = census(f);
    // With four same-root actions that take no input, mining may also propose the variant
    // set (`.action()` or `.inputSchema().action()`); either way the two actions on
    // another root are outliers and never exempt.
    let p = wrapped_in(&proposals, AUTHED_SCHEMA)
        .or_else(|| {
            wrapped_in(
                &proposals,
                &[
                    "authenticatedActionClient.action",
                    "authenticatedActionClient.inputSchema().action",
                ],
            )
        })
        .unwrap_or_else(|| panic!("no rule on the actions: {proposals:?}"));
    let exempt = symbols(&p["exempt"]);
    assert!(
        !exempt
            .iter()
            .any(|s| s.contains("baseRoot") || s.contains("otherRoot")),
        "{p}"
    );
    let outliers = symbols(&p["outliers"]);
    assert!(outliers.iter().any(|s| s.contains("baseRoot")), "{p}");
    assert!(outliers.iter().any(|s| s.contains("otherRoot")), "{p}");
}
