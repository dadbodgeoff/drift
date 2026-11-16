//! `drift mcp` against the MCP specification over stdio: the binary is spawned and
//! spoken to in JSON-RPC, as a client would. Each test names the case it covers;
//! every stdout line of every session must be a JSON-RPC message (logs go to stderr).

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const GUARDED: &str = "import { withAuth } from \"../../../lib/auth\";\n\nexport const GET = withAuth(async () => new Response(\"ok\"));\n";
const UNGUARDED: &str = "export async function GET() {\n  return new Response(\"no\");\n}\n";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> i32 {
    Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env("DRIFT_CACHE_DIR", root.join(".cache-test"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .code()
        .unwrap_or(-1)
}

/// The files of the fixture: 30 guarded routes, 2 legacy unguarded ones.
fn files(r: &Path) {
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..30 {
        write(r, &format!("app/api/r{i:02}/route.ts"), GUARDED);
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    write(r, "app/api/old1/route.ts", UNGUARDED);
    write(r, "app/api/old2/route.ts", UNGUARDED);
}

/// `drift init` and a blocking `withAuth` convention on `r`; its id.
fn adopt(r: &Path) -> String {
    assert_eq!(drift(r, &["init"]), 0);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|block| block.contains("withAuth"))
        .map(|b| b[..8].to_string())
        .expect("withAuth convention learned");
    assert_eq!(drift(r, &["review", "--block", &id]), 0);
    id
}

/// The fixture with the convention adopted (legacy routes baselined) and one new
/// route that breaks it: `app/api/bad/route.ts`.
fn repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    files(dir.path());
    let id = adopt(dir.path());
    write(dir.path(), "app/api/bad/route.ts", UNGUARDED);
    (dir, id)
}

/// One stdout line: a JSON-RPC 2.0 message (or a batch of them), nothing else.
fn parse(line: &str) -> Value {
    let v: Value = serde_json::from_str(line)
        .unwrap_or_else(|e| panic!("stdout carried a non-JSON line ({e}): {line}"));
    let msgs = match &v {
        Value::Array(a) => a.clone(),
        m => vec![m.clone()],
    };
    for m in &msgs {
        assert_eq!(m["jsonrpc"], "2.0", "not JSON-RPC 2.0: {line}");
        assert!(m.get("id").is_some(), "a reply without an id: {line}");
        assert!(
            m.get("result").is_some() != m.get("error").is_some(),
            "exactly one of result and error: {line}"
        );
    }
    v
}

/// A live server: requests written one at a time, each reply read as it comes.
struct Session {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl Session {
    fn start(root: &Path) -> Self {
        let mut child = Command::new(&*BIN)
            .args(["--root", root.to_str().unwrap(), "mcp"])
            .env("DRIFT_CACHE_DIR", root.join(".cache-test"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Session {
            child,
            stdin,
            stdout,
        }
    }

    fn send(&mut self, line: &str) {
        let w = self.stdin.as_mut().unwrap();
        w.write_all(line.as_bytes()).unwrap();
        w.write_all(b"\n").unwrap();
        w.flush().unwrap();
    }

    fn recv(&mut self) -> Value {
        let mut line = String::new();
        assert!(
            self.stdout.read_line(&mut line).unwrap() > 0,
            "the server closed stdout"
        );
        parse(line.trim_end())
    }

    fn request(&mut self, msg: Value) -> Value {
        self.send(&msg.to_string());
        let r = self.recv();
        assert_eq!(r["id"], msg["id"], "{r}");
        r
    }

    /// Close stdin; what is left on stdout, and the exit code.
    fn finish(mut self) -> (Vec<Value>, i32) {
        drop(self.stdin.take());
        let rest: Vec<Value> = (&mut self.stdout)
            .lines()
            .map(|l| parse(&l.unwrap()))
            .collect();
        let code = self.child.wait().unwrap().code().unwrap_or(-1);
        (rest, code)
    }
}

/// Every reply to `input` (stdin then closed), checked line by line, and the exit code.
fn exchange(root: &Path, input: &[u8]) -> (Vec<Value>, i32) {
    let mut s = Session::start(root);
    let mut w = s.stdin.take().unwrap();
    let bytes = input.to_vec();
    let feeder = std::thread::spawn(move || {
        let _ = w.write_all(&bytes);
    });
    let rest = s.finish();
    feeder.join().unwrap();
    rest
}

fn lines(msgs: &[Value]) -> Vec<u8> {
    msgs.iter()
        .flat_map(|m| format!("{m}\n").into_bytes())
        .collect()
}

fn init(version: &str) -> Value {
    json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"t","version":"1"}}})
}

fn call(id: i64, name: &str, args: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":args}})
}

fn text(reply: &Value) -> &str {
    reply["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("no text content: {reply}"))
}

fn is_error(reply: &Value) -> bool {
    reply["result"]["isError"] == true
}

/// The server echoed any protocolVersion the client asked for, so a client asking
/// for a version Drift does not speak was told it does. Now a version it speaks is
/// echoed, and any other is answered with the newest it speaks.
#[test]
fn initialize_negotiates_the_protocol_version() {
    let (dir, _) = repo();
    let r = dir.path();
    let mut s = Session::start(r);
    for (asked, got) in [
        ("2025-11-25", "2025-11-25"),
        ("2025-06-18", "2025-06-18"),
        ("2025-03-26", "2025-03-26"),
        ("2024-11-05", "2024-11-05"),
        ("1999-01-01", "2025-11-25"),
        ("2099-12-31", "2025-11-25"),
    ] {
        let reply = s.request(init(asked));
        let res = &reply["result"];
        assert_eq!(res["protocolVersion"], got, "{asked}: {reply}");
        assert!(res["capabilities"]["tools"].is_object(), "{reply}");
        assert_eq!(res["serverInfo"]["name"], "drift");
        assert!(res["serverInfo"]["version"].is_string());
    }
    // No version, or not a string: invalid params.
    let reply = s.request(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}));
    assert_eq!(reply["error"]["code"], -32602, "{reply}");
    let reply = s.request(
        json!({"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":20250618}}),
    );
    assert_eq!(reply["error"]["code"], -32602, "{reply}");
    // The initialized notification is not answered; ping is, with an empty result.
    s.send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
    let reply = s.request(json!({"jsonrpc":"2.0","id":"p","method":"ping"}));
    assert_eq!(reply["result"], json!({}));
    let (rest, code) = s.finish();
    assert!(rest.is_empty(), "{rest:?}");
    assert_eq!(code, 0, "stdin EOF ends the server cleanly");
}

/// Each tool's inputSchema is an object schema whose required arguments it
/// declares, and the tool accepts what the schema allows and refuses, as a tool
/// error the model can read, an argument of another type than the schema says
/// (`paths: "a.ts"` was ignored, checking every file; `content: 5` was ignored).
#[test]
fn tool_schemas_match_what_the_tools_accept() {
    let (dir, id) = repo();
    let r = dir.path();
    let mut s = Session::start(r);
    s.request(init("2025-11-25"));
    let list = s.request(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}));
    let tools = list["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(
        names,
        [
            "drift_rules_for",
            "drift_example",
            "drift_check",
            "drift_explain",
            "drift_map",
            "drift_card",
            "drift_security",
            "drift_practices",
            "drift_setup_questions",
            "drift_setup_answer",
            "drift_investigate_items",
            "drift_investigate_record"
        ]
    );
    for t in tools {
        let name = t["name"].as_str().unwrap();
        assert!(
            name.len() <= 128
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "_-.".contains(c)),
            "{name}"
        );
        assert!(t["description"].is_string(), "{name}");
        let problems = schema_problems(&t["inputSchema"]);
        assert!(problems.is_empty(), "{name}: {problems:?}");
    }
    // A value of each property's schema type is accepted ...
    let valid = |k: &str| match k {
        "path" => json!("app/api/r01/route.ts"),
        "content" => json!(GUARDED),
        "paths" => json!(["app/api/r01/route.ts"]),
        "id" => json!(id),
        // `drift_map`: with a path, the package and role are type-checked, not used.
        "package" => json!("."),
        "role" => json!("R-000000"),
        // `drift_practices`: one concern id.
        "concern" => json!("authn"),
        // `drift_setup_answer`.
        "answer" => json!("skip"),
        "reason" => json!("read app/api/r01/route.ts"),
        "evidence" => json!(["app/api/r01/route.ts:1"]),
        // `drift_investigate_items` and `drift_investigate_record`.
        "ids" => json!(["I-000000"]),
        "limit" => json!(50),
        "offset" => json!(0),
        "outcome" => json!("skip"),
        "title" | "fix" | "expect" => json!("words"),
        "patch" => json!(""),
        "routes" => json!(["GET /x"]),
        "files" => json!({ "app.py": "x = 1\n" }),
        "replace" => json!({ "Thing": "Other" }),
        other => panic!("untested property {other}"),
    };
    let mut n = 10;
    for t in tools {
        let name = t["name"].as_str().unwrap();
        let props = t["inputSchema"]["properties"].as_object().unwrap();
        let args: serde_json::Map<String, Value> =
            props.keys().map(|k| (k.clone(), valid(k))).collect();
        n += 1;
        let reply = s.request(call(n, name, Value::Object(args.clone())));
        if name == "drift_setup_answer" {
            // The arguments are taken; this repository has no setup question.
            assert!(
                text(&reply).contains("no question"),
                "{name} {args:?}: {reply}"
            );
        } else if name.starts_with("drift_investigate_") {
            // The arguments are taken; this repository has no such item.
            assert!(
                text(&reply).contains("no item "),
                "{name} {args:?}: {reply}"
            );
        } else {
            assert!(!is_error(&reply), "{name} {args:?}: {reply}");
        }
        // ... and one of another type is a tool error naming the argument.
        for k in props.keys() {
            let mut bad = args.clone();
            let wrong = match props[k]["type"].as_str() {
                Some("array") => json!("app/api/bad/route.ts"),
                Some("integer") => json!("five"),
                _ => json!(5),
            };
            bad.insert(k.clone(), wrong);
            n += 1;
            let reply = s.request(call(n, name, Value::Object(bad)));
            assert!(is_error(&reply), "{name}.{k}: {reply}");
            assert!(
                text(&reply).contains(&format!("`{k}`")),
                "{name}.{k}: {reply}"
            );
        }
        // Arguments that are not an object at all.
        n += 1;
        let reply = s.request(call(n, name, json!("app/api/r01/route.ts")));
        assert!(is_error(&reply), "{name}: {reply}");
        assert!(
            text(&reply).contains("`arguments` must be an object"),
            "{reply}"
        );
    }
    // An array item that is not a string.
    let reply = s.request(call(99, "drift_check", json!({ "paths": [7] })));
    assert!(is_error(&reply), "{reply}");
    // A required argument left out.
    let reply = s.request(call(100, "drift_explain", json!({})));
    assert!(text(&reply).contains("missing argument `id`"), "{reply}");
    assert_eq!(s.finish().1, 0);
}

/// What is wrong with a tool's `inputSchema`, by the shapes Drift's tools may take: an
/// object of properties, each a string, an array of strings, an object whose values
/// are strings (`additionalProperties: {type: string}`, valid JSON Schema), or a whole
/// number with a `minimum` of 0 or more (a page's `limit` and `offset`); every
/// required name is a property.
fn schema_problems(schema: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if schema["type"] != "object" {
        out.push("inputSchema is not an object".to_string());
    }
    let Some(props) = schema["properties"].as_object() else {
        out.push("no properties".to_string());
        return out;
    };
    for req in schema["required"].as_array().into_iter().flatten() {
        if !req.as_str().is_some_and(|r| props.contains_key(r)) {
            out.push(format!("required {req} is no property"));
        }
    }
    for (k, p) in props {
        match p["type"].as_str() {
            Some("string") => {}
            Some("array") if p["items"]["type"] == "string" => {}
            // An object maps names to strings (a gap report's files and names).
            Some("object") if p["additionalProperties"]["type"] == "string" => {}
            // A count: never negative.
            Some("integer") if p["minimum"].as_u64().is_some() => {}
            other => out.push(format!("{k}: {other:?} {p}")),
        }
    }
    out
}

/// The schema check refuses what it should: it accepts the object of strings and a
/// count, and no other object, array or type.
#[test]
fn a_malformed_schema_is_refused() {
    let with = |p: Value| json!({ "type": "object", "properties": { "x": p } });
    assert!(schema_problems(&with(json!({ "type": "string" }))).is_empty());
    assert!(
        schema_problems(&with(
            json!({ "type": "array", "items": { "type": "string" } })
        ))
        .is_empty()
    );
    assert!(
        schema_problems(&with(
            json!({ "type": "object", "additionalProperties": { "type": "string" } })
        ))
        .is_empty()
    );
    assert!(schema_problems(&with(json!({ "type": "integer", "minimum": 0 }))).is_empty());
    for bad in [
        json!({ "type": "object" }),
        json!({ "type": "object", "properties": { "a": { "type": "string" } } }),
        json!({ "type": "object", "additionalProperties": true }),
        json!({ "type": "object", "additionalProperties": { "type": "number" } }),
        json!({ "type": "array" }),
        json!({ "type": "array", "items": { "type": "object" } }),
        json!({ "type": "boolean" }),
        json!({ "type": "integer" }),
        json!({ "type": "integer", "minimum": -1 }),
        json!({ "type": "number", "minimum": 0 }),
        json!({ "type": "number" }),
        json!({ "description": "no type" }),
    ] {
        assert_eq!(schema_problems(&with(bad.clone())).len(), 1, "{bad}");
    }
    assert!(!schema_problems(&json!({ "type": "array", "properties": {} })).is_empty());
    assert!(!schema_problems(&json!({ "type": "object" })).is_empty());
    assert!(
        !schema_problems(&json!({ "type": "object", "properties": {}, "required": ["id"] }))
            .is_empty()
    );
}

/// An unknown tool was answered as a tool result (`isError`) instead of the
/// protocol error the specification gives; a request without a method, with a
/// non-string method or a null id was answered "method not found" or, for a client's
/// response, answered at all.
#[test]
fn protocol_errors_are_json_rpc_errors() {
    let (dir, _) = repo();
    let r = dir.path();
    let mut s = Session::start(r);
    s.request(init("2025-06-18"));
    let code = |r: &Value| r["error"]["code"].as_i64().unwrap_or_else(|| panic!("{r}"));
    let reply = s.request(call(1, "drift_nope", json!({})));
    assert_eq!(code(&reply), -32602, "unknown tool: {reply}");
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("drift_nope")
    );
    let reply = s.request(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{}}));
    assert_eq!(code(&reply), -32602, "no tool name: {reply}");
    let reply = s.request(json!({"jsonrpc":"2.0","id":3,"method":"tools/call"}));
    assert_eq!(code(&reply), -32602, "no params: {reply}");
    let reply =
        s.request(json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":["drift_check"]}));
    assert_eq!(code(&reply), -32602, "params not an object: {reply}");
    let reply = s.request(json!({"jsonrpc":"2.0","id":5,"method":"completion/complete"}));
    assert_eq!(code(&reply), -32601, "{reply}");
    let reply = s.request(json!({"jsonrpc":"2.0","id":6}));
    assert_eq!(code(&reply), -32600, "no method: {reply}");
    s.send(r#"{"jsonrpc":"2.0","id":7,"method":3}"#);
    let reply = s.recv();
    assert_eq!(
        (code(&reply), &reply["id"]),
        (-32600, &Value::Null),
        "{reply}"
    );
    s.send(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#);
    let reply = s.recv();
    assert_eq!(
        (code(&reply), &reply["id"]),
        (-32600, &Value::Null),
        "{reply}"
    );
    // Responses and notifications get no reply: the next line answered is the ping.
    s.send(r#"{"jsonrpc":"2.0","id":8,"result":{}}"#);
    s.send(r#"{"jsonrpc":"2.0","id":9,"error":{"code":-1,"message":"x"}}"#);
    s.send(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}"#);
    s.send(r#"{"jsonrpc":"2.0","method":"notifications/whatever"}"#);
    let reply = s.request(json!({"jsonrpc":"2.0","id":10,"method":"ping"}));
    assert_eq!(reply["result"], json!({}));
    let (rest, code) = s.finish();
    assert!(rest.is_empty(), "{rest:?}");
    assert_eq!(code, 0);
}

/// `drift_check` (and `drift_security`) dropped every path outside the repository
/// and matched none for `.`, so `paths: ["../x.ts"]`, `["."]` or `[]` checked nothing
/// and answered "No new violations." A path that names no file was silent. They now
/// read `paths` as `drift check FILES` does.
#[test]
fn check_reads_paths_as_the_cli_does() {
    let (dir, _) = repo();
    let r = dir.path();
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "x.ts", UNGUARDED);
    let abs_outside = outside.path().join("x.ts");
    let mut s = Session::start(r);
    s.request(init("2025-11-25"));
    for (i, tool) in ["drift_check", "drift_security"].into_iter().enumerate() {
        for (j, p) in [abs_outside.to_str().unwrap(), "../x.ts"]
            .into_iter()
            .enumerate()
        {
            let reply = s.request(call((10 * i + j) as i64, tool, json!({ "paths": [p] })));
            assert!(is_error(&reply), "{tool} {p}: {reply}");
            assert!(text(&reply).contains("outside the repository"), "{reply}");
        }
    }
    // The root, or no paths, is every file: the new violation is reported.
    for (i, paths) in [json!(["."]), json!([]), json!(null)]
        .into_iter()
        .enumerate()
    {
        let reply = s.request(call(
            30 + i as i64,
            "drift_check",
            json!({ "paths": paths }),
        ));
        assert!(
            text(&reply).contains("app/api/bad/route.ts"),
            "{paths}: {reply}"
        );
    }
    let abs = r.canonicalize().unwrap().join("app/api/bad/route.ts");
    let reply = s.request(call(40, "drift_check", json!({ "paths": [abs] })));
    assert!(text(&reply).contains("app/api/bad/route.ts"), "{reply}");
    // A path that names no file is refused like an outside one: never "No new
    // violations." for what was not checked, even beside a file that was.
    for (id, paths) in [
        (41, json!(["app/api/gone/route.ts", "app"])),
        (44, json!(["app/api"])),
        (45, json!(["app/api/r01/route.ts", "app/api/"])),
    ] {
        let reply = s.request(call(id, "drift_check", json!({ "paths": paths })));
        assert!(is_error(&reply), "{paths}: {reply}");
        let t = text(&reply);
        assert!(!t.contains("No new violations"), "{t}");
        assert!(t.contains("Nothing was checked"), "{t}");
    }
    let reply = s.request(call(
        46,
        "drift_check",
        json!({ "paths": ["app/api/gone/route.ts", "app"] }),
    ));
    let t = text(&reply);
    assert!(
        t.contains("app/api/gone/route.ts does not exist: nothing checked there"),
        "{t}"
    );
    assert!(t.contains("app is a directory"), "{t}");
    let reply = s.request(call(
        42,
        "drift_security",
        json!({ "paths": ["app/api/gone.ts"] }),
    ));
    assert!(
        text(&reply).contains("app/api/gone.ts does not exist"),
        "{reply}"
    );
    // A guarded file passes without a note.
    let reply = s.request(call(
        43,
        "drift_check",
        json!({ "paths": ["app/api/r01/route.ts"] }),
    ));
    assert_eq!(text(&reply), "No new violations.", "{reply}");
    assert_eq!(s.finish().1, 0);
}

/// With no `.drift/conventions.yaml` the server exited before answering
/// `initialize`, so the client saw it die with nothing to tell the agent; and it read
/// the conventions once, so a `drift init` or `drift review` during the session was
/// not seen until a restart. Now it starts, says what to do, and reads them per call.
#[test]
fn missing_repo_state_is_a_tool_error_and_the_policy_is_read_per_call() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    files(r);
    write(r, "app/api/bad/route.ts", UNGUARDED);
    let mut s = Session::start(r);
    let reply = s.request(init("2025-11-25"));
    assert_eq!(reply["result"]["protocolVersion"], "2025-11-25");
    let reply = s.request(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}));
    assert_eq!(reply["result"]["tools"].as_array().unwrap().len(), 12);
    for (i, tool) in ["drift_rules_for", "drift_check", "drift_explain"]
        .into_iter()
        .enumerate()
    {
        let reply = s.request(call(2 + i as i64, tool, json!({"path": "a.ts", "id": "x"})));
        assert!(is_error(&reply), "{reply}");
        assert!(text(&reply).contains("run `drift init` first"), "{reply}");
    }
    // Adopted while the server runs, with the bad route already there (so it is
    // baselined), and no drift.lock: every violation is new, none hidden.
    let id = adopt(r);
    std::fs::remove_file(r.join("drift.lock")).unwrap();
    let reply = s.request(call(10, "drift_check", json!({})));
    let t = text(&reply);
    assert!(!is_error(&reply), "{t}");
    for f in [
        "app/api/bad/route.ts",
        "app/api/old1/route.ts",
        "app/api/old2/route.ts",
    ] {
        assert!(t.contains(f), "{f}: {t}");
    }
    let reply = s.request(call(11, "drift_explain", json!({ "id": id })));
    assert!(text(&reply).contains("withAuth"), "{reply}");
    // Rejected during the session: it no longer applies.
    assert_eq!(drift(r, &["review", "--reject", &id]), 0);
    let reply = s.request(call(12, "drift_check", json!({})));
    assert_eq!(text(&reply), "No new violations.", "{reply}");
    assert_eq!(s.finish().1, 0);
}

/// JSON-RPC batches (which 2025-03-26 requires a server to accept) got one
/// invalid-request error for the whole array. Each request in one is now answered,
/// in an array; notifications in it are not, and an empty batch is invalid.
#[test]
fn batches_are_answered_request_by_request() {
    let (dir, _) = repo();
    let r = dir.path();
    let batch = json!([
        {"jsonrpc":"2.0","id":1,"method":"ping"},
        {"jsonrpc":"2.0","method":"notifications/initialized"},
        {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"drift_check","arguments":{"paths":["app/api/bad/route.ts"]}}},
        7,
    ]);
    let mut input = lines(&[init("2025-03-26"), batch]);
    input.extend_from_slice(b"[]\n");
    input.extend_from_slice(b"[{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}]\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"ping\"}\n");
    let (rs, code) = exchange(r, &input);
    assert_eq!(code, 0);
    assert_eq!(rs.len(), 4, "{rs:?}");
    let b = rs[1].as_array().expect("a batch reply is an array");
    assert_eq!(b.len(), 3, "{b:?}");
    assert_eq!(b[0]["id"], 1);
    assert_eq!(b[1]["id"], 2);
    assert!(text(&b[1]).contains("app/api/bad/route.ts"), "{b:?}");
    assert_eq!(b[2]["error"]["code"], -32600);
    assert_eq!(rs[2]["error"]["code"], -32600, "an empty batch");
    assert_eq!(rs[3]["id"], 3, "an all-notification batch gets no reply");
}

/// Many requests written before any reply is read (as a client with concurrent
/// calls does), a large result and a large request: each is answered once, under
/// its own id, on one line, and stdin EOF after them ends the server cleanly.
#[test]
fn pipelined_and_large_messages() {
    let (dir, _) = repo();
    let r = dir.path();
    for i in 0..300 {
        write(r, &format!("app/api/n{i:03}/route.ts"), UNGUARDED);
    }
    let mut msgs = vec![init("2025-11-25")];
    for i in 1..=40 {
        msgs.push(match i % 4 {
            0 => json!({"jsonrpc":"2.0","id":i,"method":"ping"}),
            1 => call(
                i,
                "drift_rules_for",
                json!({"path": format!("app/api/r{:02}/route.ts", i % 30)}),
            ),
            2 => call(
                i,
                "drift_check",
                json!({"paths": [format!("app/api/n{i:03}/route.ts")]}),
            ),
            _ => call(i, "drift_security", json!({})),
        });
    }
    msgs.push(call(41, "drift_check", json!({})));
    // An 8 MiB request line.
    let big = "export const a = 1;\n".repeat(420_000);
    msgs.push(call(
        42,
        "drift_rules_for",
        json!({"path": "app/api/zz/route.ts", "content": big}),
    ));
    let (rs, code) = exchange(r, &lines(&msgs));
    assert_eq!(code, 0);
    let ids: Vec<i64> = rs.iter().map(|m| m["id"].as_i64().unwrap()).collect();
    assert_eq!(ids, (0..=42).collect::<Vec<_>>());
    for m in &rs[1..] {
        assert!(m.get("error").is_none(), "{m}");
        if m["result"] != json!({}) {
            assert!(!is_error(m), "{m}");
            let content = m["result"]["content"].as_array().unwrap();
            assert!(
                content
                    .iter()
                    .all(|c| c["type"] == "text" && c["text"].is_string()),
                "{m}"
            );
        }
    }
    let all = text(&rs[41]);
    assert!(
        all.contains("app/api/n000/route.ts") || all.contains("301"),
        "{all}"
    );
}

/// Bytes that are not a message: each is answered with a null-id error and the
/// session goes on; nothing but JSON-RPC reaches stdout, CRLF line ends included.
/// A leading byte-order mark made the line a parse error.
#[test]
fn malformed_input_is_answered_and_stdout_stays_json_rpc() {
    let (dir, _) = repo();
    let r = dir.path();
    let mut input = Vec::new();
    input.extend_from_slice(format!("{}\r\n", init("2025-06-18")).as_bytes());
    input.extend_from_slice(b"{oops\n\"ping\"\nnull\n{}\n\xff\n");
    // A byte-order mark (some Windows tools write one) is ignored.
    input.extend_from_slice(b"\xef\xbb\xbf{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\r\n");
    input.extend_from_slice(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"drift_check\"}}");
    let (rs, code) = exchange(r, &input);
    assert_eq!(code, 0);
    let got: Vec<(Value, Option<i64>)> = rs
        .iter()
        .map(|m| (m["id"].clone(), m["error"]["code"].as_i64()))
        .collect();
    assert_eq!(
        got,
        [
            (json!(0), None),
            (Value::Null, Some(-32700)),
            (Value::Null, Some(-32600)),
            (Value::Null, Some(-32600)),
            (Value::Null, Some(-32600)),
            (Value::Null, Some(-32700)),
            (json!(1), None),
            (json!(2), None),
        ]
    );
    assert!(text(&rs[7]).contains("app/api/bad/route.ts"));
}

/// `drift_map` describes structure, read-only: the overview, one file (its package, layer
/// and roles), one role by the id it returned, and an error for a role it does not know.
#[test]
fn drift_map_describes_structure() {
    let (dir, _) = repo();
    let r = dir.path();
    let mut s = Session::start(r);
    s.request(init("2025-11-25"));
    let reply = s.request(call(1, "drift_map", json!({})));
    assert!(!is_error(&reply), "{reply}");
    let t = text(&reply).to_string();
    assert!(t.starts_with("(Names come from the repository"), "{t}");
    assert!(t.contains("roles ("), "{t}");
    let reply = s.request(call(
        2,
        "drift_map",
        json!({ "path": "app/api/bad/route.ts" }),
    ));
    assert!(!is_error(&reply), "{reply}");
    let f = text(&reply).to_string();
    assert!(f.contains("layer: app/api"), "{f}");
    let id = f
        .split_whitespace()
        .find(|w| w.starts_with("R-"))
        .unwrap_or_else(|| panic!("no role in {f}"))
        .to_string();
    let reply = s.request(call(3, "drift_map", json!({ "role": id })));
    assert!(!is_error(&reply), "{reply}");
    assert!(text(&reply).contains("app/api/"), "{reply}");
    let reply = s.request(call(4, "drift_map", json!({ "role": "R-000000" })));
    assert!(is_error(&reply), "{reply}");
    // Nothing is written: the same answer twice.
    let again = s.request(call(5, "drift_map", json!({})));
    assert_eq!(text(&again), t);
}
