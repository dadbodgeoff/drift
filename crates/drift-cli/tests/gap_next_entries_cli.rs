//! `drift security --json` lists an inline Next.js server action (a function whose
//! own body starts with `"use server"`, written inside a server component) as an
//! entry point of its own: with no guard where its body checks nothing, even when
//! the component that hands it out checks the caller (that check does not run when
//! the action is called), and with its guard where its own body calls one.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

fn drift(root: &Path, args: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

const SESSION: &str = "import { cookies } from \"next/headers\";\nexport async function requireUser() {\n  const session = (await cookies()).get(\"session\");\n  if (!session) throw new Error(\"Unauthorized\");\n  return session.value;\n}\n";

const PAGE: &str = r#"import { requireUser } from "../../lib/session";
import { db } from "../../lib/db";

export default async function Page() {
  await requireUser();
  async function save(formData: FormData) {
    "use server";
    await db.note.create({ data: { text: formData.get("text") } });
  }
  async function remove(formData: FormData) {
    "use server";
    await requireUser();
    await db.note.delete({ where: { id: formData.get("id") } });
  }
  return (
    <form action={save}>
      <button formAction={remove}>x</button>
    </form>
  );
}
"#;

#[test]
fn an_inline_server_action_is_an_entry_point_with_its_own_guards() {
    let dir = write(&[
        (
            "package.json",
            r#"{ "name": "web", "dependencies": { "next": "16.0.1", "react": "19.0.0" } }"#,
        ),
        ("lib/session.ts", SESSION),
        ("lib/db.ts", "export const db: any = {};\n"),
        ("app/notes/page.tsx", PAGE),
    ]);
    let inventory = drift(dir.path(), &["security", "--json"]);
    let rows = inventory["entry_points"].as_array().unwrap();
    let row = |symbol: &str| {
        rows.iter()
            .find(|e| e["symbol"] == symbol)
            .unwrap_or_else(|| panic!("no row {symbol}: {rows:#?}"))
    };
    let guards = |symbol: &str| -> Vec<String> {
        row(symbol)["guards"]
            .as_array()
            .map(|g| {
                g.iter()
                    .map(|x| x.as_str().unwrap_or_default().to_string())
                    .collect()
            })
            .unwrap_or_default()
    };
    assert_eq!(row("Page.save")["kind"], "server_action");
    assert_eq!(row("Page.save")["path"], "app/notes/page.tsx");
    // The component checks the caller; the action it hands out does not.
    assert!(guards("Page.save").is_empty(), "{:?}", guards("Page.save"));
    assert_eq!(row("Page.remove")["kind"], "server_action");
    let remove = guards("Page.remove");
    assert_eq!(remove.len(), 1, "{remove:?}");
    assert!(remove[0].contains("requireUser"), "{remove:?}");
}
