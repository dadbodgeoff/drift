//! `drift security --diff-base <ref>`: only what a change introduces, against the
//! merge base's inventory. Pre-existing exceptions stay quiet; a new entry point
//! without the guard its siblings share, a new unguarded entry point reaching a risky
//! operation and a new risky operation are listed as facts. Exit 0 always.

use std::path::Path;
use std::process::{Command, Stdio};

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

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn drift(root: &Path, args: &[&str], env: &[(&str, &str)]) -> (i32, String, String) {
    let mut cmd = Command::new(&*BIN);
    cmd.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
const UNGUARDED_EVAL: &str = "export async function POST(req: Request) {\n  const body = await req.text();\n  eval(body);\n  return Response.json({ ok: true });\n}\n";

/// 37 guarded routes and 2 unguarded ones at the base, on `main`; a `pr` branch checked out.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "import { TRPCError } from \"@trpc/server\";\n\nexport function withAuth<T>(h: T): T {\n  if (!(globalThis as any).user) {\n    throw new TRPCError({ code: \"UNAUTHORIZED\" });\n  }\n  return h;\n}\n",
    );
    for i in 0..39 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 37 { GUARDED } else { UNGUARDED },
        );
    }
    write(
        r,
        "compose.yaml",
        "services:\n  web:\n    build: .\n    ports: [\"3000:3000\"]\n",
    );
    write(r, ".gitignore", ".drift/cache/\n");
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    dir
}

#[test]
fn only_what_the_change_introduces_is_listed() {
    let dir = repo();
    let r = dir.path();
    // A new route with no wrapper that evaluates request data (committed), and an
    // uncommitted one with no wrapper and nothing risky. The base's two unguarded
    // routes are not the change's doing.
    write(r, "app/api/run/route.ts", UNGUARDED_EVAL);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "run"]);
    write(r, "app/api/open/route.ts", UNGUARDED);

    let (code, out, err) = drift(
        r,
        &["--no-cache", "security", "--diff-base", "main", "--json"],
        &[],
    );
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["diff"]["base"], "main");
    assert_eq!(v["diff"]["files"], 2);
    let gaps = v["guard_gaps"].as_array().unwrap();
    let gap_paths: Vec<&str> = gaps
        .iter()
        .map(|g| g["entry"]["path"].as_str().unwrap())
        .collect();
    assert_eq!(gap_paths, ["app/api/open/route.ts", "app/api/run/route.ts"]);
    assert_eq!(gaps[0]["guard"], "withAuth");
    assert_eq!(gaps[0]["members"], 41);
    assert_eq!(gaps[0]["with_guard"], 37);
    assert_eq!(gaps[0]["example"]["path"], "app/api/r00/route.ts");
    let reaching = v["unguarded_reaching"].as_array().unwrap();
    assert_eq!(reaching.len(), 1);
    assert_eq!(reaching[0]["path"], "app/api/run/route.ts");
    assert_eq!(reaching[0]["exposure"], "public");
    let sinks = v["sinks"].as_array().unwrap();
    assert_eq!(sinks.len(), 1);
    assert_eq!(sinks[0]["kind"], "eval");
    assert_eq!(v["leaks"], serde_json::json!([]));
    assert_eq!(v["now_public"], serde_json::json!([]));

    let (code, text, err) = drift(r, &["--no-cache", "security", "--diff-base", "main"], &[]);
    assert_eq!(code, 0, "{err}");
    assert!(text.starts_with("Security: what this change introduces (2 file(s) added or changed, against main, merge base "), "{text}");
    assert!(
        text.contains("\nEntry points lacking a guard most of their siblings have\n  app/api/open/route.ts:1 GET /api/open [http]: no guard found in what Drift read; withAuth is on 37 of 41 http entry points in the repository\n      to copy: app/api/r00/route.ts:3 GET\n        export const GET = withAuth(async (req: Request) =› {\n"),
        "{text}"
    );
    assert!(
        text.contains("\nEntry points where Drift found no guard, reaching a risky operation\n  app/api/run/route.ts:1 POST /api/run [http] internet-facing (compose service web in compose.yaml publishes ports): eval\n"),
        "{text}"
    );
    assert!(
        text.contains("\nRisky operations added\n  eval  app/api/run/route.ts:1 POST\n"),
        "{text}"
    );
    assert!(!text.contains("r37"), "{text}");
    assert!(
        text.trim_end()
            .ends_with("not a verdict on its exceptions."),
        "{text}"
    );

    // GitHub output: notices (nothing fails) and a job summary.
    let summary = r.join("summary.md");
    let (code, out, err) = drift(
        r,
        &["--no-cache", "security", "--diff-base", "main", "--github"],
        &[("GITHUB_STEP_SUMMARY", summary.to_str().unwrap())],
    );
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("::notice file=app/api/open/route.ts,line=1,title=drift security::withAuth is on 37 of 41 http entry points here; this one has no guard found in what Drift read. To copy: app/api/r00/route.ts:3."), "{out}");
    assert!(out.contains("::notice file=app/api/run/route.ts,line=1,title=drift security::Entry point where Drift found no guard in what it read, reaching eval; internet-facing (compose service web in compose.yaml publishes ports)."), "{out}");
    assert!(out.contains("::notice file=app/api/run/route.ts,line=1,title=drift security::Risky operation added: eval in POST."), "{out}");
    assert!(out.contains("drift security: 2 entry point(s) lacking a shared guard, 1 where Drift found no guard in what it read reaching a risky operation, 0 new entry point(s) where Drift found no guard (0 more whose guard is unknown), 1 risky operation(s) added, 0 new client leak(s), 0 now internet-facing; facts for review, nothing fails\n"), "{out}");
    assert!(
        !out.contains("::error") && !out.contains("::warning"),
        "{out}"
    );
    let md = std::fs::read_to_string(&summary).unwrap();
    assert!(md.starts_with("## Drift security\n"), "{md}");
    assert!(md.contains("### Entry points lacking a guard most of their siblings have\n\n- `app/api/open/route.ts:1` /api/open: `withAuth` is on 37 of 41 http entry points here; to copy: `app/api/r00/route.ts:3`\n"), "{md}");
    assert!(
        md.contains("- eval in `app/api/run/route.ts:1` POST\n"),
        "{md}"
    );
    // Nothing was written into the repository.
    assert!(!r.join(".drift").exists());
}

#[test]
fn a_change_that_introduces_nothing_says_so_and_a_moved_exception_is_not_new() {
    let dir = repo();
    let r = dir.path();
    // A guarded route added, and one of the base's unguarded routes renamed.
    write(r, "app/api/new/route.ts", GUARDED);
    std::fs::create_dir_all(r.join("app/api/moved")).unwrap();
    git(r, &["mv", "app/api/r38/route.ts", "app/api/moved/route.ts"]);
    // The file's route changes with its path; what matters is that its lack of a
    // guard was already there under the old path.
    let (code, text, err) = drift(r, &["--no-cache", "security", "--diff-base", "main"], &[]);
    assert_eq!(code, 0, "{err}");
    assert!(
        text.starts_with(
            "Security: this change (2 file(s) added or changed, against main, merge base "
        ),
        "{text}"
    );
    assert!(text.contains("introduces no entry point lacking a guard its siblings share, no unguarded entry point reaching a risky operation, no new entry point where Drift found no guard, no new risky operation, no new client leak, and makes nothing internet-facing.\n"), "{text}");
    assert!(text.contains("\nNot covered:"), "{text}");
    // Not a git ref: an error, not a report.
    let (code, _, err) = drift(r, &["--no-cache", "security", "--diff-base", "nope"], &[]);
    assert_ne!(code, 0);
    assert!(err.contains("base ref `nope` not found"), "{err}");
}

const SIGNED_IN: &str = "import { auth } from \"@clerk/nextjs/server\";\n\nexport async function GET() {\n  const { userId } = await auth();\n  if (!userId) {\n    return Response.json({ error: \"Unauthorized\" }, { status: 401 });\n  }\n  return Response.json({ ok: true });\n}\n";
const UNREAD_CHECK: &str = "import { requireMember } from \"@/lib/missing\";\n\nexport async function GET() {\n  await requireMember();\n  return Response.json({ ok: true });\n}\n";

/// Routes that check the sign-in in their own bodies (Clerk's `auth()`), beside as
/// many that do not: no guard is shared, so no sibling rule speaks for a new route.
fn mixed_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\", \"@clerk/nextjs\": \"6.0.0\" } }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    for d in ["iam/orgs", "iam/users", "iam/roles", "billing/plans"] {
        write(r, &format!("app/api/{d}/route.ts"), SIGNED_IN);
    }
    for d in ["fbd/examples", "ingest", "status"] {
        write(r, &format!("app/api/{d}/route.ts"), UNGUARDED);
    }
    write(
        r,
        "compose.yaml",
        "services:\n  web:\n    build: .\n    ports: [\"3000:3000\"]\n",
    );
    write(r, ".gitignore", ".drift/\ndrift.lock\n");
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    dir
}

#[test]
fn a_new_route_with_no_sign_in_check_is_a_notice_whatever_its_siblings_do() {
    let dir = mixed_repo();
    let r = dir.path();
    // Added: a route with no sign-in check, one whose check Drift cannot read, and one
    // that checks the sign-in as its siblings do; and a handler with no check added to
    // a file that has one. A handler edited in place is not added: the sign-in check
    // taken out of `iam/roles` is not said among the new entry points, but as the
    // `no-guard` finding the security baseline would hold, with the one signed-in
    // route that checks nothing of who calls (`no-authorization`).
    write(r, "app/api/iam/orgs/count/route.ts", UNGUARDED);
    write(r, "app/api/iam/unknown/route.ts", UNREAD_CHECK);
    write(r, "app/api/iam/signed/route.ts", SIGNED_IN);
    write(
        r,
        "app/api/billing/plans/route.ts",
        &format!(
            "{SIGNED_IN}\nexport async function POST() {{\n  return Response.json({{ ok: true }});\n}}\n"
        ),
    );
    write(r, "app/api/iam/roles/route.ts", UNGUARDED);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "routes"]);

    let (code, out, err) = drift(
        r,
        &["--no-cache", "security", "--diff-base", "main", "--github"],
        &[],
    );
    assert_eq!(code, 0, "{err}");
    let notices: Vec<&str> = out.lines().filter(|l| l.starts_with("::")).collect();
    assert_eq!(
        notices,
        [
            "::notice file=app/api/billing/plans/route.ts,line=11,title=drift security::New http entry point POST /api/billing/plans: no guard found in what Drift read; internet-facing (compose service web in compose.yaml publishes ports). Facts for review; this fails nothing.",
            "::notice file=app/api/iam/orgs/count/route.ts,line=1,title=drift security::New http entry point GET /api/iam/orgs/count: no guard found in what Drift read; internet-facing (compose service web in compose.yaml publishes ports). Facts for review; this fails nothing.",
            "::notice file=app/api/iam/unknown/route.ts,line=3,title=drift security::New http entry point GET /api/iam/unknown: guard unknown, Drift cannot tell whether it requires sign-in (it could not read: requireMember); internet-facing (compose service web in compose.yaml publishes ports). Facts for review; this fails nothing.",
            "::notice file=app/api/iam/roles/route.ts,line=1,title=drift security [no-guard]::app/api/iam/roles/route.ts#GET GET /api/iam/roles: added by this change (entry point(s) where Drift found no guard). Facts for review.",
            "::notice file=app/api/iam/signed/route.ts,line=3,title=drift security [no-authorization]::app/api/iam/signed/route.ts#GET GET /api/iam/signed: added by this change (entry point(s) that sign the caller in and check nothing of who they are (no role, no tenant, no owner)). Facts for review.",
        ],
        "{out}"
    );
    assert!(
        // The one whose guard Drift cannot read is said apart: unknown is never a
        // finding.
        out.contains(
            ", 2 new entry point(s) where Drift found no guard (1 more whose guard is unknown), "
        ),
        "{out}"
    );

    let (code, text, err) = drift(r, &["--no-cache", "security", "--diff-base", "main"], &[]);
    assert_eq!(code, 0, "{err}");
    assert!(
        text.contains("\nNew entry points where Drift found no guard\n  app/api/billing/plans/route.ts:11 POST /api/billing/plans [http]: no guard found in what Drift read; internet-facing (compose service web in compose.yaml publishes ports)\n  app/api/iam/orgs/count/route.ts:1 GET /api/iam/orgs/count [http]: no guard found in what Drift read; internet-facing (compose service web in compose.yaml publishes ports)\n\n"),
        "{text}"
    );
    assert!(
        text.contains("\nNew entry points whose guard is unknown (Drift could not read what may be one; not findings)\n  app/api/iam/unknown/route.ts:3 GET /api/iam/unknown [http]: guard unknown, "),
        "{text}"
    );
    let (listed, other) = text.split_once("\nOther findings").unwrap();
    assert!(!listed.contains("iam/signed"), "{text}");
    assert!(!listed.contains("iam/roles"), "{text}");
    assert!(
        other.contains("app/api/iam/roles/route.ts#GET GET /api/iam/roles"),
        "{text}"
    );

    let (code, out, err) = drift(
        r,
        &["--no-cache", "security", "--diff-base", "main", "--json"],
        &[],
    );
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let added: Vec<&str> = v["added_without_guard"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        added,
        [
            "app/api/billing/plans/route.ts",
            "app/api/iam/orgs/count/route.ts",
        ]
    );
    assert_eq!(
        v["guard_unknown"][0]["path"], "app/api/iam/unknown/route.ts",
        "{out}"
    );

    // `drift check --diff-base`: the same two as practice notices, never a failure.
    let (code, _, err) = drift(r, &["--no-cache", "init"], &[]);
    assert_eq!(code, 0, "{err}");
    let (code, out, err) = drift(
        r,
        &[
            "--no-cache",
            "check",
            "--diff-base",
            "main",
            "--format",
            "github",
        ],
        &[],
    );
    assert_eq!(code, 0, "{err}");
    let notices: Vec<&str> = out.lines().filter(|l| l.starts_with("::")).collect();
    assert_eq!(
        notices,
        [
            "::notice file=app/api/billing/plans/route.ts,line=11,title=drift practices%3A authn::New entry point POST /api/billing/plans [http]: no guard found in what Drift read. A fact, not a rule: it does not fail the check.",
            "::notice file=app/api/iam/orgs/count/route.ts,line=1,title=drift practices%3A authn::New entry point GET /api/iam/orgs/count [http]: no guard found in what Drift read. A fact, not a rule: it does not fail the check.",
            "::notice file=app/api/iam/unknown/route.ts,line=3,title=drift practices%3A authn::New entry point GET /api/iam/unknown [http]: unknown: Drift cannot tell whether it requires sign-in (a call no vocabulary, usage or declaration classifies). A fact, not a rule: it does not fail the check.",
        ],
        "{out}"
    );
    let (code, text, err) = drift(r, &["--no-cache", "check", "--diff-base", "main"], &[]);
    assert_eq!(code, 0, "{err}");
    assert!(
        text.contains("drift: practices (facts, not rules; they never fail the check): 3 entry point(s) this change adds where Drift found no sign-in guard, or cannot tell\n  app/api/billing/plans/route.ts:11 POST /api/billing/plans [http]: no guard found in what Drift read\n  app/api/iam/orgs/count/route.ts:1 GET /api/iam/orgs/count [http]: no guard found in what Drift read\n  app/api/iam/unknown/route.ts:3 GET /api/iam/unknown [http]: unknown: "),
        "{text}"
    );
    let (code, out, err) = drift(
        r,
        &[
            "--no-cache",
            "check",
            "--diff-base",
            "main",
            "--format",
            "json",
        ],
        &[],
    );
    assert_eq!(code, 0, "{err}");
    let v: Value = serde_json::from_str(&out).unwrap();
    let added = v["practices"]["added"].as_array().unwrap();
    assert_eq!(added.len(), 3, "{out}");
    assert_eq!(added[1]["assignment"], "none");
    assert_eq!(added[2]["assignment"], "unknown");
    // Without a diff, nothing is said of them.
    let (code, text, err) = drift(r, &["--no-cache", "check"], &[]);
    assert_eq!(code, 0, "{err}");
    assert!(!text.contains("entry point(s) this change adds"), "{text}");
}
