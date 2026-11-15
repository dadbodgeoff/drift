//! Rules about validating input, end to end: a server action's arguments are client
//! input, so "server actions validate their input" keeps its unvalidated actions as
//! outliers (the review of PR #37), while handlers that provably take no input are not.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

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

fn census(root: &Path) -> Vec<Value> {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(["census", "--json"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success(), "census failed");
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["proposals"].as_array().unwrap().clone()
}

fn validates(proposals: &[Value]) -> Option<&Value> {
    proposals
        .iter()
        .find(|p| p["rule"]["type"] == "control" && p["rule"]["value"] == "validates")
}

fn base_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"zod\": \"3.0.0\" } }",
    );
    for i in 0..60 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    dir
}

const VALIDATED: &str = "\"use server\";\nimport { z } from \"zod\";\n\nconst Schema = z.object({ name: z.string() });\n\nexport async function save(formData: FormData) {\n  const data = Schema.parse(Object.fromEntries(formData));\n  return data.name;\n}\n";
const UNVALIDATED: &str = "\"use server\";\n\nexport async function save(formData: FormData) {\n  return String(formData.get(\"name\"));\n}\n";
const POSITIONAL: &str =
    "\"use server\";\n\nexport async function save(url: string) {\n  return url.length;\n}\n";

// The reviewer's scenario: 70 zod-validated server actions and 3 that read their
// `formData` (or a positional argument) unvalidated. The rule is proposed and the 3
// are its outliers.
#[test]
fn server_actions_that_skip_validation_are_outliers() {
    let dir = base_repo();
    let r = dir.path();
    for i in 0..73 {
        let body = match i {
            70 | 71 => UNVALIDATED,
            72 => POSITIONAL,
            _ => VALIDATED,
        };
        write(r, &format!("app/a{i:02}/actions.ts"), body);
    }
    let proposals = census(r);
    let p = validates(&proposals).expect("server actions validate their input");
    assert_eq!(p["evidence"]["holders"], 70);
    assert_eq!(p["evidence"]["total"], 73);
    assert_eq!(p["outliers_total"], 3);
}

const ROUTE_VALIDATED: &str = "import { z } from \"zod\";\n\nconst Body = z.object({ name: z.string() });\n\nexport async function POST(r: Request) {\n  const body = Body.parse(await r.json());\n  return Response.json(body);\n}\n";
const ROUTE_NO_INPUT: &str =
    "export async function POST() {\n  return Response.json({ ok: true });\n}\n";
const ROUTE_HELPER: &str = "import { parseRequestBody } from \"@/lib/body\";\n\nexport async function POST(req: Request) {\n  const body = await parseRequestBody(req);\n  return Response.json(body);\n}\n";

fn routes(odd: &str) -> tempfile::TempDir {
    let dir = base_repo();
    let r = dir.path();
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/body.ts",
        "export async function parseRequestBody(req: Request) {\n  return req.json();\n}\n",
    );
    for i in 0..40 {
        let body = if i < 37 { ROUTE_VALIDATED } else { odd };
        write(r, &format!("app/api/r{i:02}/route.ts"), body);
    }
    dir
}

// Route handlers whose outliers take no argument at all have nothing to validate; a
// handler that hands its request to a helper may read it, so it stays an outlier.
#[test]
fn only_handlers_that_provably_take_no_input_follow_it() {
    let none = routes(ROUTE_NO_INPUT);
    assert!(
        validates(&census(none.path())).is_none(),
        "outliers take no input"
    );
    let helper = routes(ROUTE_HELPER);
    let proposals = census(helper.path());
    let p = validates(&proposals).expect("a request read through a helper");
    assert_eq!(p["outliers_total"], 3);
}

/// A repo of 40 handlers, `{i}` in each template standing for the handler's number:
/// 37 validate their input with zod and 3 follow `outlier`. `extra` files are added
/// as they are.
fn shaped(path: &str, holder: &str, outlier: &str, extra: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = base_repo();
    let r = dir.path();
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    for (rel, body) in extra {
        write(r, rel, body);
    }
    for i in 0..40 {
        let n = format!("{i:02}");
        let body = if i < 37 { holder } else { outlier };
        write(r, &path.replace("{i}", &n), &body.replace("{i}", &n));
    }
    dir
}

/// The `validates` rule is proposed over all 40 handlers and the 3 are its outliers.
fn assert_three_outliers(dir: &tempfile::TempDir, what: &str) {
    let proposals = census(dir.path());
    let p = validates(&proposals).unwrap_or_else(|| panic!("{what}: no validates rule"));
    assert_eq!(p["evidence"]["holders"], 37, "{what}");
    assert_eq!(p["evidence"]["total"], 40, "{what}");
    assert_eq!(p["outliers_total"], 3, "{what}");
}

const ZOD: &str = "import { z } from \"zod\";\nconst Body = z.object({ name: z.string() });\n";

// The re-review of PR #37: handlers that destructure a key Drift does not know, or
// hand their request to a wrapper with a callback, may read input. Unvalidated ones
// stay the rule's outliers rather than being taken for handlers without input.
#[test]
fn inngest_functions_that_destructure_their_event() {
    let lib = (
        "lib/inngest.ts",
        "import { Inngest } from \"inngest\";\nexport const inngest = new Inngest({ id: \"app\" });\n",
    );
    let dir = shaped(
        "inngest/f{i}.ts",
        &format!(
            "{ZOD}import {{ inngest }} from \"@/lib/inngest\";\nexport const f{{i}} = inngest.createFunction({{ id: \"f{{i}}\" }}, {{ event: \"e/{{i}}\" }}, async ({{ event }}) => {{\n  const d = Body.parse(event.data);\n  return mail(d.name);\n}});\n"
        ),
        "import { inngest } from \"@/lib/inngest\";\nexport const f{i} = inngest.createFunction({ id: \"f{i}\" }, { event: \"e/{i}\" }, async ({ event, step }) => mail(event.data.email));\n",
        &[lib],
    );
    assert_three_outliers(&dir, "inngest");
}

#[test]
fn bullmq_workers_that_destructure_their_job() {
    let dir = shaped(
        "workers/w{i}.ts",
        &format!(
            "{ZOD}import {{ Worker }} from \"bullmq\";\nexport const w{{i}} = new Worker(\"q{{i}}\", async (job) => {{\n  const d = Body.parse(job.data);\n  return send(d.name);\n}});\n"
        ),
        "import { Worker } from \"bullmq\";\nexport const w{i} = new Worker(\"q{i}\", async ({ data }) => send(data.to));\n",
        &[],
    );
    assert_three_outliers(&dir, "bullmq");
}

#[test]
fn trigger_tasks_that_destructure_their_payload() {
    let dir = shaped(
        "trigger/t{i}.ts",
        &format!(
            "{ZOD}import {{ task }} from \"@trigger.dev/sdk/v3\";\nexport const t{{i}} = task({{ id: \"t{{i}}\", run: async (payload) => {{\n  const d = Body.parse(payload);\n  return load(d.name);\n}} }});\n"
        ),
        "import { task } from \"@trigger.dev/sdk/v3\";\nexport const t{i} = task({ id: \"t{i}\", run: async ({ userId }) => load(userId) });\n",
        &[],
    );
    assert_three_outliers(&dir, "trigger.dev");
}

const EXPRESS_HOLDER: &str = "import { Router } from \"express\";\nexport const r = Router();\nr.post(\"/x{i}\", (req, res) => res.json(store(Body.parse(req.body))));\n";

#[test]
fn express_uploads_that_destructure_their_file() {
    let dir = shaped(
        "routes/r{i}.ts",
        &format!("{ZOD}{EXPRESS_HOLDER}"),
        "import { Router } from \"express\";\nimport multer from \"multer\";\nconst upload = multer();\nexport const r = Router();\nr.post(\"/x{i}\", upload.single(\"f\"), ({ file }, res) => res.json(store(file)));\n",
        &[],
    );
    assert_three_outliers(&dir, "multer");
}

#[test]
fn express_handlers_that_destructure_a_param_loaded_user() {
    let dir = shaped(
        "routes/r{i}.ts",
        &format!("{ZOD}{EXPRESS_HOLDER}"),
        "import { Router } from \"express\";\nexport const r = Router();\nr.param(\"id\", (req, _res, next, id) => { req.user = load(id); next(); });\nr.post(\"/x{i}/:id\", ({ user }, res) => res.json(user));\n",
        &[],
    );
    assert_three_outliers(&dir, "router.param");
}

const BODY_LIB: (&str, &str) = (
    "lib/body.ts",
    "export async function withBody(req: Request, f: (b: any) => Promise<Response>) {\n  return f(await req.json());\n}\n",
);

#[test]
fn routes_that_hand_their_request_to_a_wrapper_with_a_callback() {
    for (what, outlier) in [
        (
            "withBody with a destructuring callback",
            "import { withBody } from \"@/lib/body\";\nexport async function POST(req: Request) {\n  return withBody(req, async ({ name }) => Response.json(await save(name)));\n}\n",
        ),
        (
            "withBody with a callback without parameters",
            "import { withBody } from \"@/lib/body\";\nexport async function POST(req: Request) {\n  return withBody(req, async () => Response.json({ ok: true }));\n}\n",
        ),
        (
            "destructured headers",
            "export async function POST({ headers }: Request) {\n  return Response.json({ v: headers.get(\"x\") });\n}\n",
        ),
    ] {
        let dir = shaped(
            "app/api/r{i}/route.ts",
            ROUTE_VALIDATED,
            outlier,
            &[BODY_LIB],
        );
        assert_three_outliers(&dir, what);
    }
}

#[test]
fn plain_functions_that_destructure_their_argument() {
    let dir = shaped(
        "services/p{i}.ts",
        &format!(
            "{ZOD}export function createProject{{i}}(args: unknown) {{\n  const {{ name }} = Body.parse(args);\n  return insert(name);\n}}\n"
        ),
        "export function createProject{i}({ name, ownerId }) {\n  return insert(name, ownerId);\n}\n",
        &[],
    );
    assert_three_outliers(&dir, "plain function");
}

// What the reviewer confirmed keeps working: a tRPC query that takes no input has
// nothing to validate, so it does not make the rule's outliers.
#[test]
fn trpc_queries_without_input_still_follow_it() {
    let trpc = (
        "server/trpc.ts",
        "import { initTRPC } from \"@trpc/server\";\nconst t = initTRPC.create();\nexport const procedure = t.procedure;\n",
    );
    let holder = format!(
        "{ZOD}import {{ procedure }} from \"@/server/trpc\";\nexport const p{{i}} = procedure.mutation(async ({{ ctx, input }}) => ctx.save(Body.parse(input).name));\n"
    );
    let repo = |outlier: &str| shaped("server/routers/p{i}.ts", &holder, outlier, &[trpc]);
    let unvalidated = repo(
        "import { procedure } from \"@/server/trpc\";\nexport const p{i} = procedure.mutation(async ({ ctx, input }) => ctx.save(input.name));\n",
    );
    assert_three_outliers(&unvalidated, "tRPC mutations that skip validation");
    for outlier in [
        "import { procedure } from \"@/server/trpc\";\nexport const p{i} = procedure.mutation(async ({ ctx }) => ctx.save(ctx.user));\n",
        "import { procedure } from \"@/server/trpc\";\nexport const p{i} = procedure.mutation(async () => 1);\n",
    ] {
        assert!(
            validates(&census(repo(outlier).path())).is_none(),
            "tRPC procedures without input: {outlier}"
        );
    }
}
