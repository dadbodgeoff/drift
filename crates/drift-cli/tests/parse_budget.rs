//! Files that make the TypeScript/JavaScript parser re-read large spans (its
//! speculation over `<`, arrow parameters and `infer` constraints is quadratic or
//! exponential on them) are skipped as `too_costly`, within a fixed memory bound:
//! a scan, a hook and the MCP server all finish under an address-space limit far
//! below what parsing them would take (gigabytes from a few hundred bytes up).
//! Linux only: the bound is set with `ulimit -v`.
#![cfg(target_os = "linux")]

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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

/// `x=a<a<...b>()>()...` of about `len` bytes, one `a<` and one `>()` per line (a
/// single long line would be skipped as minified).
fn generic_calls(len: usize) -> String {
    let n = (len - 4) / 7;
    format!("x={}b{}", "a<\n".repeat(n), ">()\n".repeat(n))
}

/// The hostile files: (path, content). Each takes gigabytes to parse with oxc 0.157.
fn hostile() -> Vec<(&'static str, String)> {
    let pay = "g(1),\n".repeat(20_000);
    let mut infer = "0".to_string();
    for _ in 0..30 {
        infer = format!("((a: infer B extends\n{infer} ? 0 : 0) => 0)");
    }
    vec![
        // Quadratic: 64 KB, and just under the 1 MiB size cap.
        ("lib/calls.ts", generic_calls(64 * 1024)),
        (
            "lib/calls_1m.ts",
            generic_calls(drift_core::ingest::MAX_FILE_BYTES as usize - 16),
        ),
        // Quadratic and valid TypeScript: `a<a<...<a`.
        ("lib/chain.ts", format!("x={}a\n", "a<\n".repeat(20_000))),
        // Exponential, from 300 bytes: type arguments through a default value.
        (
            "lib/defaults.ts",
            format!("x={}b{}", "a<(y=\n".repeat(25), ")>()\n".repeat(25)),
        ),
        // Exponential: `infer` constraints rewound at `?`.
        (
            "lib/infer.ts",
            format!("type T<X> = X extends [{infer}] ? 1 : 2\n"),
        ),
        // Quadratic in the nesting, no `<` at all, valid JavaScript: arrow parameters.
        (
            "lib/wrap.js",
            format!("x={}({pay}){}", "([a=\n".repeat(300), "])\n".repeat(300)),
        ),
    ]
}

/// Ordinary TypeScript heavy with generics, comparisons and arrow functions.
const ORDINARY: &str = r#"import { z } from "zod";

export type Shape<T> = { [K in keyof T]: T[K] extends Array<infer U> ? Shape<U>[] : T[K] };
export type Pick2<T, K extends keyof T = keyof T> = Pick<T, K> & Partial<Omit<T, K>>;

export const schema = z.object({
  a: z.array(z.object({ b: z.string().optional(), c: z.record(z.string(), z.number()) })),
});

export function first<T extends { id: string }>(xs: Map<string, Array<T>>, n: number): T | undefined {
  for (let i = 0; i < n && i < xs.size; i++) {
    const v = xs.get(String(i));
    if (v && v.length > 0 && v[0].id < "m") return v[0];
  }
  return undefined;
}

export const pick = <T,>(x: T, ok = (y: T): boolean => y !== x) => (ok(x) ? [x] : []);
export const sorted = (xs: number[]) => xs.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
"#;

/// An address-space limit (KiB) far below what the hostile files would take to
/// parse, with room for the worker threads' 64 MiB stacks on this machine.
fn limit_kib() -> u64 {
    let cpus = std::thread::available_parallelism().map_or(8, |n| n.get()) as u64;
    1_500_000 + 2 * cpus * 66_000
}

/// `drift <args>` in `root` under `ulimit -v`, with `stdin`: exit code, stdout,
/// stderr and how long it took.
fn limited(root: &Path, args: &str, stdin: Option<&str>) -> (i32, String, String, Duration) {
    let started = Instant::now();
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "ulimit -v {} && exec {BIN} {args}",
            limit_kib(),
            BIN = *BIN
        ))
        .env_remove("DRIFT_CACHE_DIR")
        .current_dir(root)
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
        String::from_utf8_lossy(&out.stderr).into_owned(),
        started.elapsed(),
    )
}

/// Time any of these runs may take (debug builds read 1 MiB more slowly).
const TIME_BOUND: Duration = Duration::from_secs(60);

#[test]
fn hostile_speculation_is_skipped_within_a_memory_bound() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(r, "lib/ok.ts", ORDINARY);
    let hostile = hostile();
    for (path, content) in &hostile {
        assert!(content.len() as u64 <= drift_core::ingest::MAX_FILE_BYTES);
        write(r, path, content);
    }
    for cache in ["--no-cache", ""] {
        let (code, out, err, took) = limited(r, &format!("{cache} scan --json"), None);
        assert_eq!(code, 0, "{err}");
        assert!(took < TIME_BOUND, "{took:?}");
        assert!(!err.contains("panicked"), "{err}");
        let v: Value = serde_json::from_str(&out).unwrap();
        let files: Vec<&str> = v["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["path"].as_str().unwrap())
            .collect();
        assert_eq!(files, ["lib/ok.ts"]);
        assert_eq!(v["files"][0]["parse_ok"], true);
        let skipped: Vec<(&str, &str)> = v["skipped"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| (s["path"].as_str().unwrap(), s["reason"].as_str().unwrap()))
            .collect();
        let mut want: Vec<(&str, &str)> = hostile.iter().map(|(p, _)| (*p, "too_costly")).collect();
        want.sort();
        assert_eq!(skipped, want);
    }
}

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// Routes with an accepted blocking `withAuth` convention, so hooks and the MCP
/// server read the files they are given.
fn policy_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        let body = if i < 38 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/r{i:02}/route.ts"), body);
    }
    for i in 0..30 {
        let body = format!("export function h{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/h{i:02}.ts"), &body);
    }
    let run = |args: &[&str]| {
        let out = Command::new(&*BIN)
            .args(args)
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    run(&["init"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|block| block.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    run(&["review", "--block", &id]);
    dir
}

#[test]
fn hostile_speculation_does_not_take_down_hooks_or_mcp() {
    let dir = policy_repo();
    let r = dir.path();
    let content = generic_calls(64 * 1024);
    let rel = "app/api/hostile/route.ts";
    let hook = |event: &str, extra: Value| {
        let mut input = json!({ "session_id": "s1", "cwd": r, "hook_event_name": event });
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (code, out, err, took) =
            limited(r, &format!("hook claude {event}"), Some(&input.to_string()));
        assert_eq!(code, 0, "hooks always exit 0: {err}");
        assert!(took < TIME_BOUND, "{took:?}");
        out
    };
    let ti = json!({ "file_path": r.join(rel), "content": content });
    hook(
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": ti }),
    );
    write(r, rel, &content);
    hook(
        "PostToolUse",
        json!({ "tool_name": "Edit", "tool_input": { "file_path": r.join(rel) } }),
    );

    let msgs = [
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_rules_for","arguments":{"path":"app/api/new/route.ts","content":content}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    ];
    let input: String = msgs.iter().map(|m| format!("{m}\n")).collect();
    let (code, out, err, took) = limited(r, "mcp", Some(&input));
    assert_eq!(code, 0, "{err}");
    assert!(took < TIME_BOUND, "{took:?}");
    let replies: Vec<Value> = out
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(replies.len(), 2, "the server survives: {out}");
    assert_eq!(replies[1]["id"], 2);
    assert!(replies[1]["result"]["tools"].is_array());
}
