//! A tRPC procedure is listed at its dotted path end to end: `drift security --json`
//! and `drift practices --units --json` name `user.q0`, not `q0`; a router nothing
//! mounts is under `?`; and a practice promoted under the procedure prefix `user.`
//! (`--in '.:/user.'`) holds the procedures of the user router only, so `drift check`
//! reports a new one there that departs, and not a new one of the post router.
//! Before, every procedure was listed by its key and no route place could hold one.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    let (stdout, stderr) = (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    );
    assert_eq!(
        out.status.code(),
        Some(0),
        "{args:?} failed:\n{stdout}\n{stderr}"
    );
    stdout
}

const TRPC: &str = r#"import { initTRPC, TRPCError } from "@trpc/server";

const t = initTRPC.context<{ user?: { id: string } }>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx });
});

export const authedProcedure = t.procedure.use(isAuthed);
"#;

/// A router of `n` procedures named `<prefix><i>`, each on `builder`.
fn routers(name: &str, prefix: &str, builder: &str, n: usize, extra: &str) -> String {
    let procs: String = (0..n)
        .map(|i| format!("  {prefix}{i}: {builder}.query(() => ({{ n: {i} }})),\n"))
        .collect();
    format!(
        "import {{ router, publicProcedure, authedProcedure }} from \"../trpc\";\n\nexport const {name} = router({{\n{procs}{extra}}});\n"
    )
}

const APP: &str = r#"import { router } from "./trpc";
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";

export const appRouter = router({
  user: userRouter,
  post: postRouter,
});
"#;

const ORPHAN: &str = r#"import { router, publicProcedure } from "../trpc";

export const orphanRouter = router({
  ping: publicProcedure.query(() => "pong"),
});
"#;

fn fixture(r: &Path) {
    write(
        r,
        "package.json",
        "{ \"name\": \"api\", \"dependencies\": { \"@trpc/server\": \"11.0.0\" } }\n",
    );
    write(r, "src/trpc.ts", TRPC);
    write(r, "src/app.ts", APP);
    write(
        r,
        "src/routers/user.ts",
        &routers("userRouter", "q", "authedProcedure", 10, ""),
    );
    write(
        r,
        "src/routers/post.ts",
        &routers("postRouter", "p", "publicProcedure", 10, ""),
    );
    write(r, "src/routers/orphan.ts", ORPHAN);
}

/// `drift security --json` and `drift practices --units --json` name each
/// procedure by its dotted path, the unmounted one under `?`.
#[test]
fn security_and_practices_list_dotted_routes() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fixture(r);
    let v: Value = serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let mut routes: Vec<&str> = v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "rpc")
        .filter_map(|e| e["route"].as_str())
        .collect();
    routes.sort();
    assert_eq!(routes.len(), 21, "{routes:?}");
    assert!(routes.contains(&"user.q0"), "{routes:?}");
    assert!(routes.contains(&"post.p9"), "{routes:?}");
    assert!(routes.contains(&"?.ping"), "{routes:?}");
    assert!(!routes.contains(&"q0"), "{routes:?}");

    let v: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "practices", "--json", "--units"])).unwrap();
    let authn = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap();
    let units: Vec<&str> = authn["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|u| u["route"].as_str())
        .collect();
    assert!(units.contains(&"user.q3"), "{units:?}");
    assert!(units.contains(&"?.ping"), "{units:?}");
}

/// Promoted under `user.`, the practice holds the user router's procedures: a new
/// one there on the public builder is reported, a new one of the post router is not.
#[test]
fn a_procedure_prefix_place_holds_the_procedures_under_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fixture(r);
    drift(r, &["init"]);
    let v: Value = serde_json::from_str(&drift(r, &["practices", "--json", "--units"])).unwrap();
    let authn = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap();
    let variant = authn["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["route"] == "user.q0")
        .and_then(|u| u["variant"].as_str())
        .unwrap_or_else(|| panic!("no unit at user.q0: {authn:#}"))
        .to_string();
    let out = drift(
        r,
        &[
            "practices",
            "promote",
            &variant,
            "--in",
            ".:/user.",
            "--json",
        ],
    );
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
    assert_eq!(v["written"], true, "{v:#}");
    assert_eq!(v["baselined"], 0, "{v:#}");
    let id = v["convention"]["id"].as_str().unwrap().to_string();
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(yaml.contains("under_route: user."), "{yaml}");

    let added = "  q10: publicProcedure.query(() => ({ n: 10 })),\n";
    write(
        r,
        "src/routers/user.ts",
        &routers("userRouter", "q", "authedProcedure", 10, added),
    );
    let added = "  p10: publicProcedure.query(() => ({ n: 10 })),\n";
    write(
        r,
        "src/routers/post.ts",
        &routers("postRouter", "p", "publicProcedure", 10, added),
    );
    let out = drift(r, &["check", "--format", "json"]);
    let report: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
    let mine: Vec<&str> = report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["id"] == id.as_str())
        .map(|v| v["path"].as_str().unwrap())
        .collect();
    assert_eq!(mine, ["src/routers/user.ts"], "{report:#}");
}
