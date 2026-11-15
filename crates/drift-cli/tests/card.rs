//! `drift card <path>`: one file's place in the repository for an agent about to touch
//! it, for an existing file and for one that does not exist yet.

use std::path::Path;
use std::process::Command;

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

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str = "import { missing } from \"./nowhere\";\n\nexport async function POST(req: Request) {\n  const body = await req.text();\n  eval(body);\n  return Response.json({ key: process.env.SECRET_KEY });\n}\n";

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
    for i in 0..40 {
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
    dir
}

fn drift(root: &Path, args: &[&str]) -> (bool, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.success(),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn the_card_of_an_existing_file() {
    let dir = repo();
    let r = dir.path();
    let (ok, text, err) = drift(r, &["--no-cache", "card", "app/api/r39/route.ts"]);
    assert!(ok, "{err}");
    // The narrowest place with 8 or more http entry points is app/api/; repository text
    // is sanitised (`>` becomes `›`).
    let expected = "app/api/r39/route.ts (root package, ts)
Entry points (1):
  POST /api/r39 [http] POST: no guard found in what Drift read; internet-facing (compose service web in compose.yaml publishes ports); reaches eval
Risky operations here: eval (POST:3)
Env reads: process.env.SECRET_KEY
Siblings: 40 http entry points in app/api/ carry withAuth 37/40
  to copy: app/api/r00/route.ts:3 GET
    export const GET = withAuth(async (req: Request) =› {
Practices here (facts, not rules; `drift practices` has the rest):
  authn: none: no guard found in what Drift read [P-68fb99]; the package mostly: wrap withAuth 37/40 (copy app/api/r00/route.ts:3 GET)
  errors: bubble framework_default [P-6123b9]
  api: builder Response.json [P-9fdb90]
  config (preview): in place process.env [P-4d1afc]
  testing (preview): POST: no test found (the package has no tests)
Not known: 1 import(s) unresolved (app/api/r39/nowhere), so what they reach is not followed; checks inside handler bodies other than sign-in checks, and anything applied outside this repository.
";
    assert_eq!(text, expected);
    // Nothing was written into the repository.
    assert!(!r.join(".drift").exists());
}

#[test]
fn the_card_of_a_file_that_does_not_exist_yet() {
    let dir = repo();
    let r = dir.path();
    std::fs::remove_file(r.join("compose.yaml")).unwrap();
    let (ok, text, err) = drift(r, &["--no-cache", "card", "./app/api/new/route.ts"]);
    assert!(ok, "{err}");
    assert!(
        text.starts_with("app/api/new/route.ts (root package, not in the repository yet)\n"),
        "{text}"
    );
    assert!(
        text.contains("\nSiblings: 40 http entry points in app/api/ carry withAuth 37/40\n  to copy: app/api/r00/route.ts:3 GET\n"),
        "{text}"
    );
    assert!(
        text.contains("Not known: exposure (no compose service or `security:` setting in .drift/config.yaml covers this path); checks inside handler bodies other than sign-in checks, and anything"),
        "{text}"
    );
    // With a conventions file the card also lists accepted conventions; none are
    // accepted right after `drift init`, and the card still prints.
    let (ok, _, err) = drift(r, &["--no-cache", "init"]);
    assert!(ok, "{err}");
    let (ok, text, err) = drift(r, &["--no-cache", "card", "app/api/new/route.ts"]);
    assert!(ok, "{err}");
    assert!(!text.contains("Conventions ("), "{text}");
    // Outside the repository, or the root itself, is an error.
    let (ok, _, err) = drift(r, &["--no-cache", "card", "../x.ts"]);
    assert!(!ok);
    assert!(err.contains("outside the repository"), "{err}");
    let (ok, _, err) = drift(r, &["--no-cache", "card", "."]);
    assert!(!ok);
    assert!(err.contains("names the repository root"), "{err}");
}

/// `drift card --json`: the same facts as the text, and every convention covering the
/// file (accepted or proposed) with its id, status, mode and summary, for the Studio.
/// The text (and MCP `drift_card`) keeps listing only accepted conventions.
#[test]
fn the_card_as_json_lists_every_convention_covering_the_file() {
    let dir = repo();
    let r = dir.path();
    // Plain helpers: the contrast mining needs to propose the withAuth convention.
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    let card = |r: &Path| -> serde_json::Value {
        let (ok, out, err) = drift(r, &["--no-cache", "card", "--json", "app/api/r00/route.ts"]);
        assert!(ok, "{err}");
        serde_json::from_str(&out).unwrap()
    };
    let v = card(r);
    assert_eq!(v["schema"], 1);
    assert_eq!(v["path"], "app/api/r00/route.ts");
    assert_eq!(v["exists"], true);
    assert_eq!(
        v["entry_points"][0]["guards"],
        serde_json::json!(["withAuth"])
    );
    assert_eq!(v["siblings"][0]["dir"], "app/api");
    assert_eq!(
        v["siblings"][0]["guards"][0],
        serde_json::json!({"guard": "withAuth", "members": 37})
    );
    assert_eq!(v["conventions"], serde_json::json!([]));
    let (ok, _, err) = drift(r, &["--no-cache", "init"]);
    assert!(ok, "{err}");
    let v = card(r);
    let convs = v["conventions"].as_array().unwrap();
    let auth = convs
        .iter()
        .find(|c| {
            c["summary"]
                .as_str()
                .is_some_and(|s| s.contains("withAuth"))
        })
        .unwrap_or_else(|| panic!("{convs:#?}"));
    assert_eq!(auth["status"], "proposed");
    assert!(
        auth["mode"] == "block" || auth["mode"] == "advise",
        "{auth}"
    );
    let id = auth["id"].as_str().unwrap().to_string();
    let (ok, text, err) = drift(r, &["--no-cache", "card", "app/api/r00/route.ts"]);
    assert!(ok, "{err}");
    assert!(!text.contains("Conventions ("), "{text}");
    let (ok, _, err) = drift(r, &["--no-cache", "review", "--accept", &id]);
    assert!(ok, "{err}");
    let v = card(r);
    let auth = v["conventions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(auth["status"], "accepted");
}

/// 40 workers in `src/workers/`, 38 named `*Worker` (a naming card the show policy
/// withholds: two outliers), 40 functions in `src/mixed/` of which 24 are named `*Task`
/// (no card: nothing is regular there), and 20 plain helpers.
fn plain_code() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    let func = |name: &str, i: usize| format!("export function {name}() {{\n  return {i};\n}}\n");
    for i in 0..40 {
        let name = if i < 38 {
            format!("w{i}Worker")
        } else {
            format!("w{i}Thing")
        };
        write(r, &format!("src/workers/k{i:02}.ts"), &func(&name, i));
        let name = if i < 24 {
            format!("m{i}Task")
        } else {
            format!("m{i}Step")
        };
        write(r, &format!("src/mixed/m{i:02}.ts"), &func(&name, i));
    }
    for i in 0..20 {
        write(
            r,
            &format!("src/misc/u{i:02}.ts"),
            &func(&format!("util{i}"), i),
        );
    }
    dir
}

const REGULARITIES: &str =
    "Regularities here (facts, not rules; not accepted conventions, nothing checks them):\n";

/// A file with no entry point gets what mining found in its role, as a fact: the card
/// the show policy withholds is no convention anywhere, and a strong one is still what
/// 38 of 40 neighbours do. A place with nothing regular gets no such line.
#[test]
fn the_card_states_the_strong_regularities_of_code_that_is_no_entry_point() {
    let dir = plain_code();
    let r = dir.path();
    let card = |rel: &str| {
        let (ok, text, err) = drift(r, &["--no-cache", "card", rel]);
        assert!(ok, "{err}");
        text
    };
    // Twice: with no policy, and after `drift init` (which proposes nothing here).
    for init in [false, true] {
        if init {
            let (ok, out, err) = drift(r, &["--no-cache", "init"]);
            assert!(ok, "{err}");
            assert!(
                out.contains(
                    "Drift found 1 candidate and none has a track record strong enough to propose"
                ),
                "{out}"
            );
            let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
            assert!(!yaml.contains("Worker"), "{yaml}");
        }
        // A member that follows it; the member to copy is another one.
        assert_eq!(
            card("src/workers/k00.ts"),
            format!(
                "src/workers/k00.ts (root package, ts)\nEntry points: none\n{REGULARITIES}  functions in src/workers/** are named '*Worker', 38 of 40 (copy src/workers/k01.ts:1 w1Worker); this file: does\nNot known: exposure (no compose service or `security:` setting in .drift/config.yaml covers this path); checks inside handler bodies other than sign-in checks, and anything applied outside this repository.\n"
            )
        );
        // One that does not.
        let text = card("src/workers/k38.ts");
        assert!(
            text.contains(&format!(
                "{REGULARITIES}  functions in src/workers/** are named '*Worker', 38 of 40 (copy src/workers/k00.ts:1 w0Worker); this file: does not (w38Thing:1)\n"
            )),
            "{text}"
        );
        // A file that does not exist yet: the role, and nothing about the file.
        let text = card("src/workers/new.ts");
        assert!(
            text.contains(&format!(
                "{REGULARITIES}  functions in src/workers/** are named '*Worker', 38 of 40 (copy src/workers/k00.ts:1 w0Worker)\n"
            )),
            "{text}"
        );
        // Nothing regular (24 of 40), and no role at all: no section, and the card says
        // it has no answer.
        for rel in ["src/mixed/m00.ts", "src/misc/u00.ts", "src/mixed/new.ts"] {
            let text = card(rel);
            assert!(!text.contains("Regularities here"), "{text}");
            assert!(!text.contains("Task"), "{text}");
            assert!(text.contains("\nNo answer for this file: "), "{text}");
        }
        // It is no convention: not listed as one, here or in the JSON.
        assert!(!card("src/workers/k00.ts").contains("Conventions ("));
        let (ok, out, err) = drift(r, &["--no-cache", "card", "--json", "src/workers/k38.ts"]);
        assert!(ok, "{err}");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["conventions"], serde_json::json!([]));
        assert_eq!(
            v["regularities"],
            serde_json::json!([{
                "id": v["regularities"][0]["id"],
                "status": "withheld",
                "summary": "functions in src/workers/** are named `*Worker`",
                "holders": 38,
                "total": 40,
                "example": {"path": "src/workers/k00.ts", "line": 1, "symbol": "w0Worker"},
                "here": {"follows": 0, "breaks": [{"line": 1, "symbol": "w38Thing"}]},
            }])
        );
        let (ok, out, err) = drift(r, &["--no-cache", "card", "--json", "src/mixed/m00.ts"]);
        assert!(ok, "{err}");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["regularities"], serde_json::json!([]));
        if !init {
            // Nothing was written into the repository.
            assert!(!r.join(".drift").exists());
        }
    }
}

/// `drift ARGS` in `root` with `env` set: its standard output.
fn drift_env(root: &Path, args: &[&str], env: &[(&str, &str)]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .envs(env.iter().copied())
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// The files of what mining found, kept under the project's cache directory.
fn kept_mined(r: &Path) -> Vec<std::path::PathBuf> {
    let mut out: Vec<_> = std::fs::read_dir(r.join(".drift/cache/derived-v1"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("mined-"))
        })
        .collect();
    out.sort();
    out
}

/// In a project with a policy the card keeps what mining found, for the facts and
/// the policy it was found from: the next card of the same code reads it back, and
/// the card is always the one a card that keeps nothing (`--no-cache`) gives, for
/// every file, after the code changes, under another show policy, and with the kept
/// file damaged. In a repository with no policy it writes nothing.
#[test]
fn what_mining_found_is_kept_for_the_same_code_and_policy_only() {
    let dir = plain_code();
    let r = dir.path();
    const FILES: [&str; 5] = [
        "src/workers/k00.ts",
        "src/workers/k38.ts",
        "src/workers/new.ts",
        "src/mixed/m00.ts",
        "src/misc/u00.ts",
    ];
    // Every card, as text and as JSON: with what is kept, and keeping nothing.
    let cards = |keep: bool, env: &[(&str, &str)]| -> Vec<String> {
        let mut out = Vec::new();
        for rel in FILES {
            for json in [false, true] {
                let mut args = vec![];
                if !keep {
                    args.push("--no-cache");
                }
                args.push("card");
                if json {
                    args.push("--json");
                }
                args.push(rel);
                out.push(drift_env(r, &args, env));
            }
        }
        out
    };

    // No policy: nothing is written into the repository, with or without the flag.
    let unruled = cards(false, &[]);
    assert_eq!(cards(true, &[]), unruled);
    assert!(!r.join(".drift").exists());

    drift_env(r, &["--no-cache", "init"], &[]);
    let fresh = cards(false, &[]);
    assert!(fresh[2].contains("38 of 40"), "{}", fresh[2]);
    assert!(kept_mined(r).is_empty());
    assert!(!r.join(".drift/cache").exists(), "--no-cache keeps nothing");
    // The first card mines and keeps; every card after it reads that back.
    assert_eq!(cards(true, &[]), fresh);
    let kept = kept_mined(r);
    assert_eq!(kept.len(), 1, "{kept:?}");
    // The facts are cached there too, as `drift check` caches them: the next card
    // parses no file again.
    let cached: Vec<String> = std::fs::read_dir(r.join(".drift/cache"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        cached.iter().any(|n| n.starts_with("facts-v")),
        "{cached:?}"
    );
    assert!(
        cached.iter().any(|n| n.starts_with("index-v")),
        "{cached:?}"
    );
    let text = std::fs::read_to_string(&kept[0]).unwrap();
    assert!(text.contains("Worker"), "{text}");
    assert_eq!(cards(true, &[]), fresh);
    assert_eq!(kept_mined(r), kept);

    // Another show policy (a test switch): its own cards, not the ones kept.
    let unshown = [("DRIFT_TEST_UNSHOWN", "1")];
    let open = cards(false, &unshown);
    assert_ne!(open, fresh);
    assert_eq!(cards(true, &unshown), open);
    assert_eq!(cards(true, &[]), fresh);
    assert_eq!(kept_mined(r).len(), 2);

    // The kept file damaged, in turn: cut short, not JSON, the other entry's content.
    let both = kept_mined(r);
    let other = std::fs::read(&both[1]).unwrap();
    let whole = std::fs::read(&both[0]).unwrap();
    for bad in [&whole[..whole.len() / 3], &b"{}"[..], &other[..]] {
        std::fs::write(&both[0], bad).unwrap();
        assert_eq!(cards(true, &[]), fresh);
        assert_eq!(cards(true, &unshown), open);
    }

    // The code changes: two more workers stop being named for what they are. The
    // card says 36 of 40, kept or not.
    for i in [0, 1] {
        write(
            r,
            &format!("src/workers/k{i:02}.ts"),
            &format!("export function w{i}Thing() {{\n  return {i};\n}}\n"),
        );
    }
    let changed = cards(false, &[]);
    assert!(changed[2].contains("36 of 40"), "{}", changed[2]);
    assert_eq!(cards(true, &[]), changed);
    assert_eq!(cards(true, &[]), changed);
    // And back: the first cards again.
    for i in [0, 1] {
        write(
            r,
            &format!("src/workers/k{i:02}.ts"),
            &format!("export function w{i}Worker() {{\n  return {i};\n}}\n"),
        );
    }
    assert_eq!(cards(true, &[]), fresh);
}

/// Every `(copy <path>:…)` of a card's practice lines.
fn copy_paths(card: &str) -> Vec<String> {
    card.lines()
        .skip_while(|l| !l.starts_with("Practices here"))
        .flat_map(|l| l.match_indices("(copy ").map(move |(i, _)| &l[i + 6..]))
        .map(|rest| rest.split(':').next().unwrap().to_string())
        .collect()
}

const NEXT_ROUTE: &str = "export async function POST(req: Request) {\n  const body = await req.json();\n  return Response.json({ ok: body });\n}\n";
const PY_TRY: &str = "from fastapi import APIRouter, HTTPException\n\nrouter = APIRouter(prefix=\"/v1\")\n\n\n@router.get(\"/runs\")\nasync def list_runs():\n    try:\n        return {\"runs\": []}\n    except KeyError:\n        raise HTTPException(status_code=404, detail=\"not found\")\n\n\n@router.get(\"/runs/{run_id}\")\nasync def get_run(run_id: str):\n    try:\n        return {\"run\": run_id}\n    except KeyError:\n        raise HTTPException(status_code=404, detail=\"not found\")\n";

/// `n` FastAPI routes declaring a response model, each wrapped in a `try` when `guarded`.
fn py_models(n: usize, wrapped: bool) -> String {
    let mut s = String::from(
        "from fastapi import APIRouter, HTTPException\nfrom pydantic import BaseModel\n\nrouter = APIRouter(prefix=\"/v1\")\n\n\nclass Item(BaseModel):\n    id: str\n",
    );
    for i in 0..n {
        if wrapped {
            s.push_str(&format!("\n\n@router.get(\"/items{i}\", response_model=Item)\nasync def get_item{i}():\n    try:\n        return Item(id=\"{i}\")\n    except KeyError:\n        raise HTTPException(status_code=404, detail=\"no\")\n"));
        } else {
            s.push_str(&format!("\n\n@router.get(\"/things{i}\", response_model=Item)\nasync def get_thing{i}():\n    return Item(id=\"{i}\")\n"));
        }
    }
    s
}

#[test]
fn a_card_offers_a_file_to_copy_of_its_own_package_and_language_only() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    // A Next.js frontend whose routes let errors bubble, and two FastAPI services: one
    // that mostly does the same (`things.py`) and declares response models, whose
    // `routes.py` does neither; and one whose routes declare response models too.
    write(
        r,
        "frontend/package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    for i in 0..8 {
        write(r, &format!("frontend/app/api/r{i}/route.ts"), NEXT_ROUTE);
    }
    for (svc, routers) in [("svc", "routes, things"), ("store", "routes")] {
        let base = format!("backend/services/{svc}");
        write(
            r,
            &format!("{base}/pyproject.toml"),
            &format!("[project]\nname = \"{svc}\"\ndependencies = [\"fastapi\"]\n"),
        );
        write(r, &format!("{base}/app/__init__.py"), "");
        write(r, &format!("{base}/app/api/__init__.py"), "");
        let mut main = String::from("from fastapi import FastAPI\n");
        for m in routers.split(", ") {
            main.push_str(&format!("from app.api.{m} import router as {m}\n"));
        }
        main.push_str("\napp = FastAPI()\n");
        for m in routers.split(", ") {
            main.push_str(&format!("app.include_router({m})\n"));
        }
        write(r, &format!("{base}/app/main.py"), &main);
    }
    write(r, "backend/services/svc/app/api/routes.py", PY_TRY);
    write(
        r,
        "backend/services/svc/app/api/things.py",
        &py_models(5, false),
    );
    write(
        r,
        "backend/services/store/app/api/routes.py",
        &py_models(8, true),
    );

    let (ok, card, err) = drift(
        r,
        &[
            "--no-cache",
            "card",
            "backend/services/svc/app/api/routes.py",
        ],
    );
    assert!(ok, "{err}");
    assert!(card.contains("  errors: "), "{card}");
    assert!(card.contains("  api: "), "{card}");
    let copies = copy_paths(&card);
    assert!(!copies.is_empty(), "{card}");
    for p in &copies {
        assert!(
            p.starts_with("backend/services/svc/") && p.ends_with(".py"),
            "{p} is not a Python file of the package: {card}"
        );
    }
    assert!(
        card.contains("; the package mostly: bubble framework_default 5/7 (copy backend/services/svc/app/api/things.py:11 get_thing0)"),
        "{card}"
    );

    // A package of both languages: where none of its Python files does what most of it
    // does, the line says so, and offers no TypeScript file to copy.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"t\"\ndependencies = [\"fastapi\"]\n",
    );
    for i in 0..8 {
        write(r, &format!("app/api/r{i}/route.ts"), NEXT_ROUTE);
    }
    write(r, "svc/__init__.py", "");
    write(
        r,
        "svc/routes.py",
        &format!("{PY_TRY}\n\napp = FastAPI()\napp.include_router(router)\n")
            .replace("import APIRouter,", "import APIRouter, FastAPI,"),
    );
    let (ok, card, err) = drift(r, &["--no-cache", "card", "svc/routes.py"]);
    assert!(ok, "{err}");
    assert!(copy_paths(&card).is_empty(), "{card}");
    assert!(
        card.contains("; the package mostly: bubble framework_default 8/10 (no py example of it in this package to copy)"),
        "{card}"
    );
}

/// `drift example` for a file no learned role covers still says where to copy from: the
/// file `drift card` names (the siblings of its kind in its place), and that this is where
/// the example comes from; for an existing file and for one not written yet. A file with
/// no such siblings gets the one line it always did.
#[test]
fn an_example_falls_back_to_the_cards_file_to_copy() {
    let dir = repo();
    let r = dir.path();
    let (ok, _, err) = drift(r, &["--no-cache", "init"]);
    assert!(ok, "{err}");
    let from = "(the file `drift card app/api/r39/route.ts` names: 37 of the 40 http entry points in app/api/ carry withAuth; a fact about the code, not a rule)";
    for (file, from) in [
        ("app/api/r39/route.ts", from.to_string()),
        ("./app/api/new/route.ts", from.replace("r39", "new")),
    ] {
        let (ok, text, err) = drift(r, &["--no-cache", "example", file]);
        assert!(ok, "{err}");
        let want = file.trim_start_matches("./");
        assert_eq!(
            text,
            format!("no learned role covers {want}\nto copy: app/api/r00/route.ts:3 GET {from}\n"),
            "{text}"
        );
    }
    // No siblings, nothing to copy: the one line.
    write(r, "scripts/job.ts", "export function job() {}\n");
    let (ok, text, err) = drift(r, &["--no-cache", "example", "scripts/job.ts"]);
    assert!(ok, "{err}");
    assert_eq!(text, "no learned role covers scripts/job.ts\n");
    let (ok, text, err) = drift(r, &["--no-cache", "example", "scripts/new.ts"]);
    assert!(ok, "{err}");
    assert_eq!(text, "no learned role covers scripts/new.ts\n");
}

/// One `drift mcp` process keeps the facts of its last scan while no file changes, and
/// reads again after any change: a card asked for after an edit is the card of the edited
/// code, and two asked for with nothing changed in between are the same.
#[test]
fn the_mcp_server_reads_again_after_any_edit() {
    use std::io::{BufRead, Write};
    use std::process::Stdio;
    let dir = repo();
    let r = dir.path();
    let (ok, _, err) = drift(r, &["--no-cache", "init"]);
    assert!(ok, "{err}");
    let mut child = Command::new(&*BIN)
        .arg("mcp")
        .current_dir(r)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = std::io::BufReader::new(child.stdout.take().unwrap());
    let mut id = 0;
    let mut ask = |tool: &str, args: serde_json::Value| -> String {
        id += 1;
        let req = serde_json::json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":tool,"arguments":args}});
        writeln!(stdin, "{req}").unwrap();
        stdin.flush().unwrap();
        let mut line = String::new();
        stdout.read_line(&mut line).unwrap();
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        v["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("{v}"))
            .to_string()
    };
    let card = |ask: &mut dyn FnMut(&str, serde_json::Value) -> String| {
        ask(
            "drift_card",
            serde_json::json!({"path": "app/api/r39/route.ts"}),
        )
    };
    let first = card(&mut ask);
    assert!(first.contains("POST /api/r39"), "{first}");
    assert_eq!(card(&mut ask), first);
    // The file now has a guard: the next card says so.
    write(r, "app/api/r39/route.ts", GUARDED);
    let second = card(&mut ask);
    assert_ne!(second, first);
    assert!(!second.contains("no guard found"), "{second}");
    assert_eq!(card(&mut ask), second);
    // Another file's edit is seen too: a sibling that lost its guard.
    write(r, "app/api/r00/route.ts", UNGUARDED);
    let third = card(&mut ask);
    assert!(third.contains("carry withAuth 37/40"), "{third}");
    drop(stdin);
    child.wait().unwrap();
}
