//! What agents read about members a rule cannot apply to (workstream C): a schema
//! naming rule's plain values are in its statement and in `drift_explain`'s known
//! exceptions, and `drift check` does not report them.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run_in(root: &Path, args: &[&str], stdin: Option<&str>) -> String {
    let mut child = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("CLAUDE_CODE_SESSION_ID")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    if let Some(s) = stdin {
        input.write_all(s.as_bytes()).unwrap();
    }
    drop(input);
    let out = child.wait_with_output().unwrap();
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// MCP tool calls, one reply text each.
fn mcp(root: &Path, calls: &[(&str, Value)]) -> Vec<String> {
    let input: String = calls
        .iter()
        .enumerate()
        .map(|(i, (name, args))| {
            format!(
                "{}\n",
                json!({"jsonrpc":"2.0","id":i + 1,"method":"tools/call","params":{"name":name,"arguments":args}})
            )
        })
        .collect();
    run_in(root, &["mcp"], Some(&input))
        .lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap();
            v["result"]["content"][0]["text"]
                .as_str()
                .unwrap_or_else(|| panic!("{v}"))
                .to_string()
        })
        .collect()
}

#[test]
fn a_plain_value_left_out_of_a_schema_naming_rule_is_a_known_exception() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"zod\": \"3.0.0\" } }",
    );
    for i in 0..40 {
        let letters = format!(
            "{}{}",
            (b'A' + (i / 26) as u8) as char,
            (b'a' + (i % 26) as u8) as char
        );
        write(
            r,
            &format!("src/schemas/s{i}.ts"),
            &format!(
                "import {{ z }} from \"zod\";\n\nexport const z{letters}Schema = z.object({{ a: z.string() }}).refine((v) => !!v.a);\n"
            ),
        );
    }
    write(
        r,
        "src/schemas/response.ts",
        "export const GenericSuccessResponse = { success: true } as const;\n",
    );
    write(
        r,
        "src/schemas/misnamed.ts",
        "import { z } from \"zod\";\n\nexport const nameRules = z.object({ name: z.string() });\n",
    );
    for i in 0..30 {
        write(
            r,
            &format!("src/other/o{i}.ts"),
            &format!(
                "export const other{i} = {i};\nexport function f{i}() {{\n  return {i};\n}}\n"
            ),
        );
    }
    run_in(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let block = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("`*Schema`"))
        .unwrap_or_else(|| panic!("{yaml}"));
    let id = block[..8].to_string();
    let flat = block.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        flat.contains("except a plain value (not a schema)"),
        "{block}"
    );
    run_in(r, &["review", "--accept", &id], None);
    run_in(r, &["review", "--show-to-agents", &id], None);
    // New code after the baseline: a misnamed schema and a plain value.
    write(
        r,
        "src/schemas/later.ts",
        "import { z } from \"zod\";\n\nexport const laterRules = z.object({ a: z.string() });\nexport const LaterResponse = { ok: true } as const;\n",
    );
    let t = mcp(
        r,
        &[
            ("drift_explain", json!({ "id": id })),
            ("drift_check", json!({ "paths": ["src/schemas/later.ts"] })),
        ],
    );
    assert!(
        t[0].contains("known exceptions: a plain value (not a schema)\n"),
        "{}",
        t[0]
    );
    // Like every exemption outside wrapper rules (a companion, a member that does not
    // call the callee), `check` lists no member here: the rule holds there vacuously.
    assert!(!t[0].contains("left out now"), "{}", t[0]);
    assert!(t[1].contains("laterRules"), "{}", t[1]);
    assert!(!t[1].contains("LaterResponse"), "{}", t[1]);
}
