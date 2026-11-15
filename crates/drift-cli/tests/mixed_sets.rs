//! Variant sets that mix guards with wrappers that are not ("rpc entry points are wrapped
//! in `authedProcedure()` or `publicProcedure()`"): a set with a guard among its
//! alternatives keeps only the guards, so a new public or database-only handler is an
//! outlier in the census and a violation in `drift check` and the hooks. Holders are
//! counted over every call-wrapper slot, as `check` reads them. A set of guards only is
//! unchanged.

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
        .env("DRIFT_TEST_UNSHOWN", "1")
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

/// Short names of a call-wrapper proposal's alternatives.
fn alternatives(p: &Value) -> Vec<String> {
    p["rule"]["any_of"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().rsplit_once('#').unwrap().1.to_string())
        .collect()
}

/// The call-wrapper proposals with more than one alternative, any of them named `name`.
fn sets_with<'a>(proposals: &'a [Value], name: &str) -> Vec<&'a Value> {
    proposals
        .iter()
        .filter(|p| {
            p["rule"]["type"] == "wrapped_by"
                && p["rule"]["kind"] == "call"
                && alternatives(p).len() > 1
                && alternatives(p).iter().any(|a| a == name)
        })
        .collect()
}

fn the_set<'a>(proposals: &'a [Value], name: &str) -> &'a Value {
    let sets = sets_with(proposals, name);
    assert_eq!(sets.len(), 1, "one set with {name}: {proposals:#?}");
    sets[0]
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

/// Accept every proposal, block `id`, and start a session. Python proposals are
/// suggestions (D7): blocking one is forced, for every set alike.
fn block(root: &Path, id: &str) {
    run(root, &["init"], None);
    let (code, _) = run(root, &["review", "--block", id, "--force"], None);
    assert_eq!(code, 0, "review --block {id} --force");
    hook(root, "SessionStart", json!({ "source": "startup" }));
}

/// After writing `rel`: what PostToolUse says, `drift check`'s exit code and output, and
/// whether Stop blocks.
fn after_write(r: &Path, rel: &str) -> (String, i32, String, bool) {
    let post = hook(
        r,
        "PostToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(rel) } }),
    )
    .map(|v| v.to_string())
    .unwrap_or_default();
    let (code, check) = run(r, &["check"], None);
    let stop = hook(r, "Stop", json!({})).is_some_and(|v| v["decision"] == "block");
    (post, code, check, stop)
}

fn ts_base(root: &Path) {
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

const TRPC: &str = "import { initTRPC, TRPCError } from \"@trpc/server\";\nexport const t = initTRPC.create();\nexport const middleware = t.middleware;\n";
/// An authentication middleware that throws `UNAUTHORIZED`, an admin check that throws
/// `FORBIDDEN`, and a timing middleware that rethrows whatever it catches.
/// An authentication middleware that throws `UNAUTHORIZED` and an admin check that
/// throws `FORBIDDEN`; a timing middleware that rethrows whatever it catches; a rate
/// limit that turns some callers away (it rejects, it does not authenticate); and an
/// error-mapping middleware that turns an `AuthError` from deeper code into
/// `UNAUTHORIZED` and logs "Unauthorized ..." before an unrelated throw.
const MIDDLEWARE: &str = "import { TRPCError } from \"@trpc/server\";\nimport { middleware } from \"./trpc\";\nexport const isAuthed = middleware(({ ctx, next }) => {\n  if (!ctx.user) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return next({ ctx: { user: ctx.user } });\n});\nexport const isAdmin = middleware(({ ctx, next }) => {\n  if (!ctx.user?.admin) {\n    throw new TRPCError({ code: \"FORBIDDEN\", message: \"Admins only\" });\n  }\n  return next({ ctx });\n});\nexport const timing = middleware(async ({ next }) => {\n  try {\n    return await next();\n  } catch (e) {\n    throw toTrpcError(e);\n  }\n});\nexport const rateLimit = middleware(async ({ ctx, next }) => {\n  if (await tooMany(ctx.ip)) {\n    throw new TRPCError({ code: \"FORBIDDEN\", message: \"Too many requests\" });\n  }\n  return next();\n});\nexport const errors = middleware(async ({ ctx, next }) => {\n  if (!ctx.requestId) {\n    console.warn(\"Unauthorized clients send no request id\");\n    throw new Error(\"missing request id\");\n  }\n  try {\n    return await next();\n  } catch (e) {\n    if (e instanceof AuthError) {\n      throw new TRPCError({ code: \"UNAUTHORIZED\", cause: e });\n    }\n    throw e;\n  }\n});\nexport const mapsCatch = middleware(({ next }) =>\n  next().catch((e) => {\n    if (e instanceof AuthError) throw new TRPCError({ code: \"UNAUTHORIZED\" });\n    throw e;\n  }),\n);\nexport const mapsResult = middleware(async ({ next }) => {\n  const result = await next();\n  if (!result.ok && result.error.cause instanceof AuthError) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return result;\n});\nexport const aliased = middleware(async ({ next: go }) => {\n  const r = await go();\n  if (!r.ok && r.error instanceof AuthError) throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  return r;\n});\nexport function mapAuthErrors(r: any) {\n  if (!r.ok && r.error instanceof AuthError) throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  return r;\n}\nexport const mapped = middleware(async ({ next }) => mapAuthErrors(await next()));\nclass AuthError extends Error {}\nasync function tooMany(ip: string) {\n  return ip === \"\";\n}\nfunction toTrpcError(e: unknown) {\n  return new TRPCError({ code: \"INTERNAL_SERVER_ERROR\", cause: e });\n}\n";
/// The public procedure is built with timing and a rate limit; the authenticated and
/// admin ones on it.
const PROCEDURES: &str = "import { t } from \"./trpc\";\nimport { isAuthed, isAdmin, timing, rateLimit } from \"./middleware\";\nexport const publicProcedure = t.procedure.use(timing).use(rateLimit);\nexport const authedProcedure = publicProcedure.use(isAuthed);\nexport const adminProcedure = authedProcedure.use(isAdmin);\nexport const bookingsProcedure = authedProcedure.use(timing);\n";
/// documenso's shape: the base `procedure` is built with `base`, a middleware that
/// rejects no caller itself; the authenticated and admin procedures on it.
fn based_procedures(base: &str) -> String {
    format!(
        "import {{ t }} from \"./trpc\";\nimport {{ isAuthed, isAdmin, {base} }} from \"./middleware\";\nexport const procedure = t.procedure.use({base});\nexport const authedProcedure = procedure.use(isAuthed);\nexport const adminProcedure = authedProcedure.use(isAdmin);\n"
    )
}

/// A tRPC repo whose routers use the procedures `uses(i)` names for `i` in `0..n`.
fn trpc_repo_with(
    procedures: &str,
    n: usize,
    uses: impl Fn(usize) -> &'static str,
) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    ts_base(r);
    write(r, "server/trpc.ts", TRPC);
    write(r, "server/middleware.ts", MIDDLEWARE);
    write(r, "server/procedures.ts", procedures);
    for i in 0..n {
        let p = uses(i);
        write(
            r,
            &format!("server/routers/r{i:02}/_router.ts"),
            &format!(
                "import {{ {p} }} from \"@/server/procedures\";\nexport const q{i} = {p}.query(async ({{ ctx }}) => ctx.load({i}));\n"
            ),
        );
    }
    dir
}

/// 40 routers on `authedProcedure`, 10 on `adminProcedure`, 4 on `open`.
fn trpc_repo(procedures: &str, open: &'static str) -> tempfile::TempDir {
    trpc_repo_with(procedures, 54, |i| match i {
        0..40 => "authedProcedure",
        40..50 => "adminProcedure",
        _ => open,
    })
}

// cal.com D-0b36fb, midday D-ef5012, documenso D-efe3da: rpc entry points "are wrapped in
// authedProcedure() or adminProcedure() or publicProcedure()" let a new public mutation
// pass. The set keeps the two guards; public routers are outliers; a new public mutation
// is a violation that `drift check` and the Stop hook block on, and a new authenticated
// one is not.
#[test]
fn a_trpc_set_keeps_its_guards_and_a_new_public_mutation_blocks() {
    let dir = trpc_repo(PROCEDURES, "publicProcedure");
    let r = dir.path();
    let proposals = census(r);
    // `publicProcedure`'s rate limit rejects some callers; its name says it opens
    // access, so it is no guard.
    assert!(
        sets_with(&proposals, "publicProcedure").is_empty(),
        "{proposals:#?}"
    );
    let p = the_set(&proposals, "authedProcedure");
    assert_eq!(
        alternatives(p),
        ["adminProcedure", "authedProcedure"],
        "{p}"
    );
    assert_eq!(p["evidence"]["holders"], 50, "{p}");
    assert_eq!(p["evidence"]["total"], 54, "{p}");
    assert_eq!(symbols(&p["outliers"]), ["q50", "q51", "q52", "q53"], "{p}");
    let id = p["id"].as_str().unwrap().to_string();
    block(r, &id);

    write(
        r,
        "server/routers/fresh/_router.ts",
        "import { authedProcedure } from \"@/server/procedures\";\nexport const fresh = authedProcedure.mutation(async ({ ctx, input }) => ctx.save(input));\n",
    );
    let (post, code, check, stop) = after_write(r, "server/routers/fresh/_router.ts");
    assert!(
        !post.contains("fresh") && !check.contains("fresh"),
        "{post}\n{check}"
    );
    assert_eq!(code, 0, "{check}");
    assert!(!stop);

    write(
        r,
        "server/routers/fresh/_router.ts",
        "import { publicProcedure } from \"@/server/procedures\";\nexport const fresh = publicProcedure.mutation(async ({ ctx, input }) => ctx.save(input));\n",
    );
    let (post, code, check, stop) = after_write(r, "server/routers/fresh/_router.ts");
    for out in [&post, &check] {
        assert!(out.contains("fresh") && out.contains(&id), "{out}");
    }
    assert_ne!(code, 0, "check fails on a blocking violation: {check}");
    assert!(stop, "Stop blocks on the new public mutation");
}

// documenso D-efe3da: `procedure = t.procedure.use(m)`, where `m` rejects no caller
// before it hands control on:
// - `errors` maps an `AuthError` caught from deeper code to `UNAUTHORIZED` in a `catch`,
//   and logs "Unauthorized ..." before an unrelated throw;
// - `mapsCatch` does it in a `next().catch()` callback (b1);
// - `mapsResult` reads `await next()`'s result first (b2, tRPC v10/v11's shape);
// - `rateLimit` throws `FORBIDDEN` "Too many requests" (b3);
// - `aliased` does b2 with the continuation renamed (`({ next: go })`, n1);
// - `mapped` hands `await next()` to a helper that maps it (`mapAuthErrors`, n2).
// None makes `procedure` a guard: its routers are outliers and a new `procedure.query`
// blocks.
#[test]
fn a_middleware_that_rejects_no_caller_makes_no_guard() {
    for base in [
        "errors",
        "mapsCatch",
        "mapsResult",
        "rateLimit",
        "aliased",
        "mapped",
    ] {
        let dir = trpc_repo(&based_procedures(base), "procedure");
        let r = dir.path();
        let proposals = census(r);
        assert!(
            sets_with(&proposals, "procedure").is_empty(),
            "{base}: {proposals:#?}"
        );
        let p = the_set(&proposals, "authedProcedure");
        assert_eq!(
            alternatives(p),
            ["adminProcedure", "authedProcedure"],
            "{base}: {p}"
        );
        assert_eq!(
            symbols(&p["outliers"]),
            ["q50", "q51", "q52", "q53"],
            "{base}: {p}"
        );
        let id = p["id"].as_str().unwrap().to_string();
        block(r, &id);
        write(
            r,
            "server/routers/fresh/_router.ts",
            "import { procedure } from \"@/server/procedures\";\nexport const fresh = procedure.query(async ({ ctx }) => ctx.load(0));\n",
        );
        let (post, code, check, stop) = after_write(r, "server/routers/fresh/_router.ts");
        for out in [&post, &check] {
            assert!(out.contains("fresh") && out.contains(&id), "{base}: {out}");
        }
        assert_ne!(code, 0, "{base}: {check}");
        assert!(stop, "{base}");
    }
}

// One guard left (`authedProcedure`, beside `publicProcedure`): no set, the
// single-wrapper rule says it, once. A router on a procedure built on it holds it.
#[test]
fn a_set_with_one_guard_left_is_the_single_wrapper_rule() {
    let dir = trpc_repo_with(PROCEDURES, 53, |i| match i {
        0..48 => "authedProcedure",
        48 => "bookingsProcedure",
        _ => "publicProcedure",
    });
    let proposals = census(dir.path());
    let calls: Vec<&Value> = proposals
        .iter()
        .filter(|p| p["rule"]["type"] == "wrapped_by" && p["rule"]["kind"] == "call")
        .collect();
    assert_eq!(calls.len(), 1, "{calls:#?}");
    assert_eq!(
        alternatives(calls[0]),
        ["authedProcedure"],
        "{:#}",
        calls[0]
    );
    assert_eq!(calls[0]["evidence"]["holders"], 49, "{:#}", calls[0]);
    assert_eq!(symbols(&calls[0]["derived"]), ["q48"], "{:#}", calls[0]);
}

const ACTION_CLIENT: &str = "import { createSafeActionClient } from \"next-safe-action\";\nimport { getSession } from \"@/lib/session\";\nexport const actionClient = createSafeActionClient({\n  handleServerError: (e) => e.message,\n});\nexport const authActionClient = actionClient.use(async ({ next }) => {\n  const session = await getSession();\n  if (!session?.user) {\n    throw new Error(\"Unauthorized: Login required.\");\n  }\n  return next({ ctx: { user: session.user } });\n});\nexport const partnerActionClient = actionClient.use(async ({ next }) => {\n  const session = await getSession();\n  if (!session?.partner) {\n    throw new AuthorizationError(\"Not a partner\");\n  }\n  return next({ ctx: { partner: session.partner } });\n});\nclass AuthorizationError extends Error {}\n";

// dub D-50df58, formbricks D-60208a: server actions "are wrapped in
// actionClient.inputSchema().action() or authActionClient.inputSchema().action() or ...".
// The bare `actionClient` authenticates nobody: its actions are outliers.
#[test]
fn a_safe_action_set_keeps_the_authenticated_clients() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    ts_base(r);
    write(
        r,
        "lib/session.ts",
        "export async function getSession() {\n  return null as any;\n}\n",
    );
    write(r, "lib/action-client.ts", ACTION_CLIENT);
    for i in 0..54 {
        let client = match i {
            0..40 => "authActionClient",
            40..50 => "partnerActionClient",
            _ => "actionClient",
        };
        write(
            r,
            &format!("app/a{i:02}/actions.ts"),
            &format!(
                "\"use server\";\nimport {{ z }} from \"zod\";\nimport {{ {client} }} from \"@/lib/action-client\";\nexport const act{i} = {client}\n  .inputSchema(z.object({{ id: z.string() }}))\n  .action(async ({{ ctx, parsedInput }}) => save(ctx, parsedInput.id));\n"
            ),
        );
    }
    let proposals = census(r);
    let p = the_set(&proposals, "authActionClient.inputSchema().action");
    assert_eq!(
        alternatives(p),
        [
            "authActionClient.inputSchema().action",
            "partnerActionClient.inputSchema().action"
        ],
        "{p}"
    );
    assert_eq!(p["evidence"]["holders"], 50, "{p}");
    assert_eq!(p["outliers_total"], 4, "{p}");
    assert!(
        sets_with(&proposals, "actionClient.inputSchema().action").is_empty(),
        "{proposals:#?}"
    );
}

fn py_base(r: &Path) {
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"app\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(r, "app/api/__init__.py", "");
    write(
        r,
        "app/db.py",
        "def get_db():\n    db = object()\n    try:\n        yield db\n    finally:\n        pass\n",
    );
    write(
        r,
        "app/auth.py",
        "from fastapi import Depends, HTTPException, status\nfrom fastapi.security import OAuth2PasswordBearer\n\noauth2_scheme = OAuth2PasswordBearer(tokenUrl=\"token\")\noptional_oauth2 = OAuth2PasswordBearer(tokenUrl=\"token\", auto_error=False)\n\n\ndef get_current_user(token: str = Depends(oauth2_scheme)):\n    credentials = HTTPException(\n        status_code=status.HTTP_401_UNAUTHORIZED,\n        detail=\"Could not validate credentials\",\n    )\n    if not token:\n        raise credentials\n    return token\n\n\ndef get_current_admin(user=Depends(get_current_user)):\n    if user != \"admin\":\n        raise HTTPException(status_code=403, detail=\"Admins only\")\n    return user\n",
    );
    for i in 0..40 {
        write(
            r,
            &format!("app/h{i:02}.py"),
            &format!("def helper_{i}():\n    return {i}\n"),
        );
    }
}

// open-wearables D-3b39dc, tasking-manager D-c373f7: HTTP handlers "are wrapped in
// get_db() or get_current_user() or ...", where `Depends(get_db)` comes first in most of
// them. The set keeps the guards; a handler that depends on `get_db` before
// `get_current_user` holds it (every slot counts, as in `check`); one with only the
// database session is an outlier.
#[test]
fn a_fastapi_set_keeps_the_user_dependencies_and_counts_every_slot() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    py_base(r);
    for i in 0..54 {
        let params = match i {
            0..25 => "db=Depends(get_db), user=Depends(get_current_user)",
            25..40 => "user=Depends(get_current_user), db=Depends(get_db)",
            40..50 => "admin=Depends(get_current_admin), db=Depends(get_db)",
            50 | 51 => "db=Depends(get_db)",
            // Optional auth: a scheme built with `auto_error=False` lets anyone in.
            _ => "token=Depends(optional_oauth2), db=Depends(get_db)",
        };
        write(
            r,
            &format!("app/api/r{i:02}.py"),
            &format!(
                "from fastapi import APIRouter, Depends\nfrom app.db import get_db\nfrom app.auth import get_current_user, get_current_admin, optional_oauth2\n\nrouter = APIRouter()\n\n\n@router.post(\"/r{i}\")\ndef route_{i}({params}):\n    return {i}\n"
            ),
        );
    }
    let proposals = census(r);
    assert!(sets_with(&proposals, "get_db").is_empty(), "{proposals:#?}");
    let p = the_set(&proposals, "get_current_user");
    assert!(
        alternatives(p).contains(&"get_current_admin".to_string()),
        "{p}"
    );
    assert_eq!(p["evidence"]["holders"], 50, "{p}");
    assert_eq!(p["evidence"]["total"], 54, "{p}");
    let outliers = symbols(&p["outliers"]);
    assert_eq!(outliers.len(), 4, "{p}");
    assert!(
        outliers.iter().all(|o| ["50", "51", "52", "53"]
            .iter()
            .any(|n| o.ends_with(&format!("route_{n}")))),
        "{outliers:?}"
    );
    let id = p["id"].as_str().unwrap().to_string();
    block(r, &id);
    write(
        r,
        "app/api/fresh.py",
        "from fastapi import APIRouter, Depends\nfrom app.db import get_db\n\nrouter = APIRouter()\n\n\n@router.post(\"/fresh\")\ndef fresh_route(db=Depends(get_db)):\n    return 1\n",
    );
    let (post, code, check, stop) = after_write(r, "app/api/fresh.py");
    for out in [&post, &check] {
        assert!(out.contains("fresh_route") && out.contains(&id), "{out}");
    }
    assert_ne!(code, 0, "{check}");
    assert!(stop);
}

// A FastAPI scheme counts as optional, never a guard, unless every build of it is proven
// strict: options unpacked from a literal or a constant (`**{"auto_error": False}`,
// `**OPTS`), or an in-repo subclass that passes `auto_error=False` up or catches the
// scheme's 401 in `__call__`, let a request without credentials through. Routes on such
// a scheme are outliers of the guard set. (Its names say nothing: a name that opens
// access, `optional`, would make it no guard by itself.)
#[test]
fn an_optional_fastapi_scheme_is_no_guard() {
    let shapes = [
        "from fastapi.security import HTTPBearer\n\nbearer = HTTPBearer(**{\"auto_error\": False})\n",
        "from fastapi.security import HTTPBearer\n\nOPTS = {\"auto_error\": False}\nbearer = HTTPBearer(**OPTS)\n",
        "from fastapi.security import HTTPBearer\n\n\nclass ProjectBearer(HTTPBearer):\n    def __init__(self):\n        super().__init__(auto_error=False)\n\n\nbearer = ProjectBearer()\n",
        "from fastapi import HTTPException\nfrom fastapi.security import HTTPBearer\n\n\nclass ProjectBearer(HTTPBearer):\n    async def __call__(self, request):\n        try:\n            return await super().__call__(request)\n        except HTTPException:\n            return None\n\n\nbearer = ProjectBearer()\n",
    ];
    for (k, scheme) in shapes.iter().enumerate() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        py_base(r);
        write(r, "app/schemes.py", scheme);
        for i in 0..54 {
            let params = match i {
                0..25 => "db=Depends(get_db), user=Depends(get_current_user)",
                25..40 => "user=Depends(get_current_user), db=Depends(get_db)",
                40..50 => "admin=Depends(get_current_admin), db=Depends(get_db)",
                _ => "token=Depends(bearer), db=Depends(get_db)",
            };
            write(
                r,
                &format!("app/api/r{i:02}.py"),
                &format!(
                    "from fastapi import APIRouter, Depends\nfrom app.db import get_db\nfrom app.auth import get_current_user, get_current_admin\nfrom app.schemes import bearer\n\nrouter = APIRouter()\n\n\n@router.post(\"/r{i}\")\ndef route_{i}({params}):\n    return {i}\n"
                ),
            );
        }
        let proposals = census(r);
        let p = the_set(&proposals, "get_current_user");
        assert_eq!(p["evidence"]["holders"], 50, "shape {k}: {p}");
        let outliers = symbols(&p["outliers"]);
        assert!(
            outliers.iter().all(|o| ["50", "51", "52", "53"]
                .iter()
                .any(|n| o.ends_with(&format!("route_{n}")))),
            "shape {k}: {outliers:?}"
        );
    }
}

// dub D-d24d21: route handlers "are wrapped in withSession() or withWorkspace()", both of
// them guards. The set is as before.
#[test]
fn a_set_of_guards_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    ts_base(r);
    write(
        r,
        "lib/errors.ts",
        "export class DubApiError extends Error {\n  constructor(public opts: { code: string; message: string }) {\n    super(opts.message);\n  }\n}\n",
    );
    write(
        r,
        "lib/auth/session.ts",
        "import { DubApiError } from \"@/lib/errors\";\nexport const withSession = (handler: any) => async (req: Request) => {\n  const session = await getSession(req);\n  if (!session) {\n    throw new DubApiError({ code: \"unauthorized\", message: \"Login required.\" });\n  }\n  return handler({ req, session });\n};\nasync function getSession(req: Request) {\n  return req.headers.get(\"cookie\");\n}\n",
    );
    write(
        r,
        "lib/auth/workspace.ts",
        "import { DubApiError } from \"@/lib/errors\";\nexport const withWorkspace = (handler: any) => async (req: Request) => {\n  const key = req.headers.get(\"authorization\");\n  if (!key) {\n    throw new DubApiError({ code: \"unauthorized\", message: \"Missing API key.\" });\n  }\n  if (key === \"x\") {\n    throw new DubApiError({ code: \"forbidden\", message: \"No access.\" });\n  }\n  return handler({ req, key });\n};\n",
    );
    for i in 0..44 {
        let (w, from) = match i {
            0..30 => ("withWorkspace", "workspace"),
            30..42 => ("withSession", "session"),
            _ => ("withNothing", "nothing"),
        };
        let body = if w == "withNothing" {
            "export const GET = async () => new Response(\"ok\");\n".to_string()
        } else {
            format!(
                "import {{ {w} }} from \"@/lib/auth/{from}\";\nexport const GET = {w}(async () => new Response(\"ok\"));\n"
            )
        };
        write(r, &format!("app/api/r{i:02}/route.ts"), &body);
    }
    let proposals = census(r);
    let p = the_set(&proposals, "withWorkspace");
    assert_eq!(alternatives(p), ["withSession", "withWorkspace"], "{p}");
    assert_eq!(p["evidence"]["holders"], 42, "{p}");
    assert_eq!(p["evidence"]["total"], 44, "{p}");
}

/// A Django project whose URLconf wraps 40 views in `login_required(...)`, 10 in
/// `staff_required(...)` and 4 in `handles_errors(...)`, the last defined by `public`
/// in `app/auth.py` with whatever helpers it needs; two more views are bare.
fn django_repo(public: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"proj\"\ndependencies = [\"django\"]\n",
    );
    for p in ["proj", "app", "app/views"] {
        write(r, &format!("{p}/__init__.py"), "");
    }
    write(
        r,
        "manage.py",
        "import os\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
    );
    write(
        r,
        "proj/settings.py",
        "ROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\"app\"]\n",
    );
    write(
        r,
        "app/auth.py",
        &format!(
            "from functools import wraps\n\nfrom django.core.exceptions import PermissionDenied\nfrom django.http import HttpResponseForbidden\nfrom django.shortcuts import redirect\n\n\nclass AuthError(Exception):\n    pass\n\n\ndef login_required(view_func):\n    @wraps(view_func)\n    def inner(request, *args, **kwargs):\n        if not request.user.is_authenticated:\n            return redirect(\"/accounts/login/\")\n        return view_func(request, *args, **kwargs)\n    return inner\n\n\ndef staff_required(view_func):\n    @wraps(view_func)\n    def inner(request, *args, **kwargs):\n        if not request.user.is_staff:\n            return HttpResponseForbidden()\n        return view_func(request, *args, **kwargs)\n    return inner\n\n\n{public}"
        ),
    );
    let mut urls = String::from(
        "from django.urls import path\n\nfrom app.auth import handles_errors, login_required, staff_required\nfrom app.views import b0, b1",
    );
    for i in 0..54 {
        urls.push_str(&format!(", r{i:02}"));
    }
    urls.push_str("\n\nurlpatterns = [\n");
    for i in 0..54 {
        let w = match i {
            0..40 => "login_required",
            40..50 => "staff_required",
            _ => "handles_errors",
        };
        urls.push_str(&format!("    path(\"r{i:02}/\", {w}(r{i:02}.view_{i})),\n"));
        write(
            r,
            &format!("app/views/r{i:02}.py"),
            &format!("def view_{i}(request):\n    return {i}\n"),
        );
    }
    for i in 0..2 {
        urls.push_str(&format!("    path(\"b{i}/\", b{i}.bare_{i}),\n"));
        write(
            r,
            &format!("app/views/b{i}.py"),
            &format!("def bare_{i}(request):\n    return {i}\n"),
        );
    }
    urls.push_str("]\n");
    write(r, "proj/urls.py", &urls);
    for i in 0..40 {
        write(
            r,
            &format!("app/h{i:02}.py"),
            &format!("def helper_{i}():\n    return {i}\n"),
        );
    }
    dir
}

/// Route one more view, `fresh_view`, through `wrapper`: what PostToolUse says,
/// `drift check`'s exit code and output, and whether Stop blocks.
fn django_fresh(r: &Path, wrapper: &str) -> (String, i32, String, bool) {
    let urls = std::fs::read_to_string(r.join("proj/urls.py")).unwrap();
    let urls = urls
        .replacen("from app.views import ", "from app.views import fresh, ", 1)
        .replacen(
            "urlpatterns = [\n",
            &format!("urlpatterns = [\n    path(\"fresh/\", {wrapper}(fresh.fresh_view)),\n"),
            1,
        );
    write(r, "proj/urls.py", &urls);
    write(
        r,
        "app/views/fresh.py",
        "def fresh_view(request):\n    return request.POST\n",
    );
    after_write(r, "app/views/fresh.py")
}

// A decorator that maps what the wrapped view hands back, or what it raises, turns no
// caller away: it runs the view first. Each shape of `handles_errors` below is no guard,
// so the set keeps `login_required` and `staff_required`, the views wrapped in
// `handles_errors` are outliers, and a new view routed through it fails `drift check`
// and blocks Stop. The wrapped view is the outer function's parameter under any name
// (`target`), or what a class-based decorator keeps (`self.view`).
#[test]
fn a_django_decorator_that_maps_the_views_result_is_no_guard() {
    let shapes = [
        // Calls a helper that rejects on the view's result.
        "def map_errors(response):\n    if response.status_code == 401 and not response.user:\n        return redirect(\"/accounts/login/\")\n    return response\n\n\ndef handles_errors(view_func):\n    @wraps(view_func)\n    def inner(request, *args, **kwargs):\n        return map_errors(view_func(request, *args, **kwargs))\n    return inner\n",
        // The same with the view under a name no list knows.
        "def map_errors(response):\n    if response.status_code == 401 and not response.user:\n        return redirect(\"/accounts/login/\")\n    return response\n\n\ndef handles_errors(target):\n    @wraps(target)\n    def inner(request, *args, **kwargs):\n        return map_errors(target(request, *args, **kwargs))\n    return inner\n",
        // Rejects by itself, but only after the view has run.
        "def handles_errors(target):\n    def inner(request, *args, **kwargs):\n        response = target(request, *args, **kwargs)\n        if not request.user.is_authenticated:\n            return redirect(\"/accounts/login/\")\n        return response\n    return inner\n",
        // Maps the view's error to a rejection class.
        "def handles_errors(view_func):\n    def inner(request, *args, **kwargs):\n        try:\n            return view_func(request, *args, **kwargs)\n        except AuthError:\n            raise PermissionDenied\n    return inner\n",
        // Maps it to a 403 response in the handler.
        "def handles_errors(view_func):\n    def inner(request, *args, **kwargs):\n        try:\n            return view_func(request, *args, **kwargs)\n        except AuthError:\n            return HttpResponseForbidden()\n    return inner\n",
        // Maps it through a helper that rejects.
        "def deny(request):\n    if not request.user.is_authenticated:\n        raise PermissionDenied\n\n\ndef handles_errors(target):\n    def inner(request, *args, **kwargs):\n        try:\n            return target(request, *args, **kwargs)\n        except AuthError:\n            deny(request)\n    return inner\n",
        // A class-based decorator that maps what the view it keeps hands back.
        "def map_errors(response):\n    if response.status_code == 401 and not response.user:\n        return redirect(\"/accounts/login/\")\n    return response\n\n\nclass handles_errors:\n    def __init__(self, view):\n        self.view = view\n\n    def __call__(self, request, *args, **kwargs):\n        return map_errors(self.view(request, *args, **kwargs))\n",
    ];
    for (k, public) in shapes.iter().enumerate() {
        let dir = django_repo(public);
        let r = dir.path();
        let proposals = census(r);
        assert!(
            sets_with(&proposals, "handles_errors").is_empty(),
            "shape {k}: {proposals:#?}"
        );
        let p = the_set(&proposals, "login_required");
        assert_eq!(
            alternatives(p),
            ["login_required", "staff_required"],
            "shape {k}: {p}"
        );
        assert_eq!(p["evidence"]["holders"], 50, "shape {k}: {p}");
        let outliers = symbols(&p["outliers"]);
        for n in 50..54 {
            assert!(
                outliers.iter().any(|o| o.ends_with(&format!("view_{n}"))),
                "shape {k}: {outliers:?}"
            );
        }
        let id = p["id"].as_str().unwrap().to_string();
        block(r, &id);
        let (post, code, check, stop) = django_fresh(r, "handles_errors");
        for out in [&post, &check] {
            assert!(
                out.contains("fresh_view") && out.contains(&id),
                "shape {k}: {out}"
            );
        }
        assert_ne!(code, 0, "shape {k}: {check}");
        assert!(stop, "shape {k}: Stop blocks on the new mapped view");
    }
}

// The other side: a decorator that checks the caller before it runs the view, under any
// name for the view, is a guard. That holds for a helper it calls before the view even
// when it calls the helper again after it, and for a class-based decorator. Its views
// hold the set, and a new view routed through it passes.
#[test]
fn a_django_decorator_that_checks_before_the_view_is_a_guard() {
    let shapes = [
        "def ensure_login(request):\n    if not request.user.is_authenticated:\n        raise PermissionDenied\n\n\ndef handles_errors(target):\n    def inner(request, *args, **kwargs):\n        ensure_login(request)\n        response = target(request, *args, **kwargs)\n        ensure_login(request)\n        return response\n    return inner\n",
        "def handles_errors(target):\n    def inner(request, *args, **kwargs):\n        if not request.user.is_authenticated:\n            return redirect(\"/accounts/login/\")\n        return target(request, *args, **kwargs)\n    return inner\n",
        "class handles_errors:\n    def __init__(self, view):\n        self.view = view\n\n    def __call__(self, request, *args, **kwargs):\n        if not request.user.is_authenticated:\n            raise PermissionDenied\n        return self.view(request, *args, **kwargs)\n",
    ];
    for (k, guard) in shapes.iter().enumerate() {
        let dir = django_repo(guard);
        let r = dir.path();
        let proposals = census(r);
        let p = the_set(&proposals, "login_required");
        assert_eq!(
            alternatives(p),
            ["handles_errors", "login_required", "staff_required"],
            "shape {k}: {p}"
        );
        assert_eq!(p["evidence"]["holders"], 54, "shape {k}: {p}");
        let id = p["id"].as_str().unwrap().to_string();
        block(r, &id);
        let (post, code, check, stop) = django_fresh(r, "handles_errors");
        assert!(
            !post.contains("fresh_view") && !check.contains("fresh_view"),
            "shape {k}: {post}\n{check}"
        );
        assert_eq!(code, 0, "shape {k}: {check}");
        assert!(!stop, "shape {k}");
    }
}

/// `py_base` with one more dependency module, `app/audit.py`, and 56 routes: 40 on
/// `get_current_user`, 10 on `get_current_admin`, 4 on `audited`, and two more with
/// only the database session.
fn fastapi_repo(audit: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    py_base(r);
    write(
        r,
        "app/audit.py",
        &format!(
            "from fastapi import HTTPException, Request\n\n\nclass AuthError(Exception):\n    pass\n\n\ndef require_session(request: Request):\n    if not request.session.get(\"user\"):\n        raise HTTPException(status_code=401, detail=\"Not signed in\")\n\n\n{audit}"
        ),
    );
    for i in 0..56 {
        let params = match i {
            0..40 => "user=Depends(get_current_user), db=Depends(get_db)",
            40..50 => "admin=Depends(get_current_admin), db=Depends(get_db)",
            50..54 => "audit=Depends(audited), db=Depends(get_db)",
            _ => "db=Depends(get_db)",
        };
        write(
            r,
            &format!("app/api/r{i:02}.py"),
            &format!(
                "from fastapi import APIRouter, Depends\nfrom app.db import get_db\nfrom app.auth import get_current_user, get_current_admin\nfrom app.audit import audited\n\nrouter = APIRouter()\n\n\n@router.post(\"/r{i}\")\ndef route_{i}({params}):\n    return {i}\n"
            ),
        );
    }
    dir
}

fn fastapi_fresh(r: &Path) -> (String, i32, String, bool) {
    write(
        r,
        "app/api/fresh.py",
        "from fastapi import APIRouter, Depends\nfrom app.db import get_db\nfrom app.audit import audited\n\nrouter = APIRouter()\n\n\n@router.post(\"/fresh\")\ndef fresh_route(audit=Depends(audited), db=Depends(get_db)):\n    return 1\n",
    );
    after_write(r, "app/api/fresh.py")
}

// A FastAPI dependency hands control on at its `yield`: what follows is teardown, run
// after the endpoint, and never turns a caller away, whether it rejects by itself, calls
// a helper that does, or maps the endpoint's error in `except` or `finally`. `audited` is
// no guard: its routes are outliers and a new route on it blocks.
#[test]
fn a_fastapi_dependency_that_checks_after_its_yield_is_no_guard() {
    let shapes = [
        "def audited(request: Request):\n    yield\n    if not request.session.get(\"user\"):\n        raise HTTPException(status_code=401)\n",
        "def audited(request: Request):\n    yield\n    require_session(request)\n",
        "def audited(request: Request):\n    try:\n        yield\n    except AuthError:\n        raise HTTPException(status_code=401)\n",
        "async def audited(request: Request):\n    try:\n        yield request.state\n    finally:\n        require_session(request)\n",
    ];
    for (k, audit) in shapes.iter().enumerate() {
        let dir = fastapi_repo(audit);
        let r = dir.path();
        let proposals = census(r);
        assert!(
            sets_with(&proposals, "audited").is_empty(),
            "shape {k}: {proposals:#?}"
        );
        let p = the_set(&proposals, "get_current_user");
        assert_eq!(
            alternatives(p),
            ["get_current_admin", "get_current_user"],
            "shape {k}: {p}"
        );
        assert_eq!(p["evidence"]["holders"], 50, "shape {k}: {p}");
        let id = p["id"].as_str().unwrap().to_string();
        block(r, &id);
        let (post, code, check, stop) = fastapi_fresh(r);
        for out in [&post, &check] {
            assert!(
                out.contains("fresh_route") && out.contains(&id),
                "shape {k}: {out}"
            );
        }
        assert_ne!(code, 0, "shape {k}: {check}");
        assert!(stop, "shape {k}: Stop blocks on the new route");
    }
}

// A dependency that checks the caller before its `yield`, by itself or through a helper,
// is a guard: its routes hold the set and a new one passes.
#[test]
fn a_fastapi_dependency_that_checks_before_its_yield_is_a_guard() {
    let shapes = [
        "def audited(request: Request):\n    if not request.session.get(\"user\"):\n        raise HTTPException(status_code=401)\n    yield request.session[\"user\"]\n",
        "def audited(request: Request):\n    require_session(request)\n    try:\n        yield\n    finally:\n        require_session(request)\n",
    ];
    for (k, audit) in shapes.iter().enumerate() {
        let dir = fastapi_repo(audit);
        let r = dir.path();
        let proposals = census(r);
        let p = the_set(&proposals, "get_current_user");
        assert_eq!(
            alternatives(p),
            ["audited", "get_current_admin", "get_current_user"],
            "shape {k}: {p}"
        );
        assert_eq!(p["evidence"]["holders"], 54, "shape {k}: {p}");
        let id = p["id"].as_str().unwrap().to_string();
        block(r, &id);
        let (post, code, check, stop) = fastapi_fresh(r);
        // The set does not flag the route. The edit hook may still say, as a fact, that
        // the route uses `audited` where most of its directory uses `get_current_user`,
        // and `drift check` lists the same fact under its practices heading, after the
        // violations and apart from them.
        let violations = check
            .split("drift: practices (facts, not rules")
            .next()
            .unwrap();
        assert!(
            !post.contains(&id) && !violations.contains("fresh_route"),
            "shape {k}: {post}\n{check}"
        );
        assert!(
            !post.contains("fresh_route") || post.contains("departs from the practices"),
            "shape {k}: {post}"
        );
        assert_eq!(code, 0, "shape {k}: {check}");
        assert!(!stop, "shape {k}");
    }
}
