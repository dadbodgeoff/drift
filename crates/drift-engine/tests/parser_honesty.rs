//! D-PA1, D-PA2, D-PA3: what the parser knows about its own failures, and says.
//!
//! Three defects of one shape - the scan reporting success over something it did not read.

use std::path::Path;
use std::process::Command;

use drift_engine::{FactKind, extract_typescript_facts, extract_typescript_facts_with_report};
use serde_json::Value;

/// The component the D-PA2 measurement was taken on: a `setOpen(false)` call and a
/// `posts.map(...)` call, both inside a JSX return.
const COMPONENT: &str = r#"import { useState } from "react";

export function Profile({ posts }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(false)}>
      {posts.map((post) => (
        <span key={post.id}>{post.title}</span>
      ))}
    </div>
  );
}
"#;

fn call_names(path: &str, source: &str) -> Vec<String> {
    let mut names = extract_typescript_facts(path, source)
        .expect("facts")
        .into_iter()
        .filter(|fact| fact.kind == FactKind::SymbolCalled)
        .map(|fact| fact.name)
        .collect::<Vec<_>>();
    names.sort();
    names
}

/// D-PA2. The grammar was chosen by suffix alone - TSX for `.tsx`/`.jsx`, TypeScript for
/// everything else - so `.js` was parsed by a grammar that cannot read JSX, and JSX in a plain
/// `.js` file is not an edge case. Measured on this exact source: `profile.js` produced 4 facts and
/// `profile.jsx` 6. The two missing were the `setOpen` and `map` call sites, each of which would
/// have carried an exact line and column had it been parsed. The `.js` scan reported full success.
#[test]
fn a_js_file_containing_jsx_yields_the_same_facts_as_a_jsx_file() {
    let jsx = call_names("src/profile.jsx", COMPONENT);
    assert_eq!(
        jsx,
        vec![
            "map".to_string(),
            "setOpen".to_string(),
            "useState".to_string()
        ],
        "control: the .jsx parse is the one that was always right"
    );

    for path in ["src/profile.js", "src/profile.mjs", "src/profile.cjs"] {
        assert_eq!(
            call_names(path, COMPONENT),
            jsx,
            "{path} is plain JavaScript, which cannot contain TypeScript-only syntax, so it must \
             be read by the grammar that can also see JSX"
        );
    }
}

/// The `.js` grammar choice is CHECKED rather than asserted, which is the actual lesson of D-PA2:
/// a grammar picked from a suffix and never verified is how `.js` sat on a JSX-blind parser for the
/// life of the project. When the TSX parse of a `.js` file has errors, the file is parsed again as
/// TypeScript and whichever grammar covered more of it wins.
///
/// Measured while writing this: the comparison ambiguity that makes *TypeScript* demand a `.tsx`
/// rename - `a < b && c > (d)`, `if (a<b && c>d)`, `g(a < b, c > d)` - is handled cleanly by
/// tree-sitter's TSX grammar in every form tried, so no real JavaScript in the corpus needs the
/// fallback. The shape that does separate the two grammars is the TypeScript type assertion, and it
/// is used here because it is the one input that demonstrates the mechanism firing. The fallback
/// stays for the same reason a seatbelt does: the cost is one reparse of a file that already
/// failed, and the failure it prevents is silent fact loss.
#[test]
fn the_js_grammar_choice_is_verified_and_falls_back_when_the_alternate_reads_more() {
    // The default for the extension, which is the half D-PA2 got wrong.
    let (_, jsx_report) =
        extract_typescript_facts_with_report("src/profile.js", COMPONENT).expect("facts");
    assert_eq!(
        jsx_report.grammar, "tsx",
        "a .js file is read by the JSX-capable grammar unless checking says otherwise"
    );

    let source = "const el = <HTMLElement>document.body;\nel.focus();\n";

    let (_, report) =
        extract_typescript_facts_with_report("src/cast.js", source).expect("a tree is produced");

    assert_eq!(
        report.grammar, "typescript",
        "the TSX grammar cannot read a type assertion and the TypeScript one can, so the second \
         parse must win"
    );
    assert!(
        report.is_clean(),
        "and the parse it fell back to must actually be clean, or the fallback chose no better"
    );
    assert!(
        call_names("src/cast.js", source).contains(&"focus".to_string()),
        "the call site the TSX parse would have lost is the whole point"
    );
}

/// `.ts` gets no JSX fallback. A `.ts` file containing JSX does not compile, so parsing one as TSX
/// would invent recall for source that cannot run.
#[test]
fn a_ts_file_is_never_reparsed_as_jsx() {
    let (_, report) =
        extract_typescript_facts_with_report("src/profile.ts", COMPONENT).expect("facts");
    assert_eq!(report.grammar, "typescript");
}

/// D-PA1. The silence is the defect. Before this, no code path in the crate inspected
/// `tree.root_node().has_error()` - an exhaustive grep for `has_error|is_error|ERROR|is_missing`
/// across crates/drift-engine/src returned one hit, a comment - so foreign content under a
/// TypeScript-family extension produced confident facts with `indexed: true` and not one
/// diagnostic.
#[test]
fn foreign_content_under_a_typescript_extension_reports_that_it_did_not_parse() {
    let python = "import os\n\ndef handler(request):\n    data = os.environ.get(\"KEY\")\n    return compute(data)\n";
    let (facts, report) =
        extract_typescript_facts_with_report("src/handler.ts", python).expect("a tree is produced");

    assert!(
        !report.is_clean(),
        "Python is not TypeScript and the parse must say so"
    );
    assert!(report.error_bytes > 0 && report.error_nodes > 0);
    // The facts are still produced - see the note at the diagnostic site in main.rs for the two
    // rules that were measured and rejected as ways to drop them. What must never happen again is
    // producing them with nothing recorded about how the parse went.
    assert!(facts.iter().any(|fact| fact.kind == FactKind::SymbolCalled));
}

/// Real TypeScript must not be reported as damaged, or the diagnostic becomes noise and gets
/// ignored - which is how the 129 real corpus gaps would end up hidden among thousands of false
/// ones.
#[test]
fn ordinary_source_reports_a_clean_parse() {
    for (path, source) in [
        (
            "app/api/users/route.ts",
            "import { prisma } from \"@/lib/prisma\";\nexport async function GET() {\n  return Response.json(await prisma.user.findMany());\n}\n",
        ),
        ("src/profile.tsx", COMPONENT),
        ("src/profile.js", COMPONENT),
    ] {
        let (_, report) = extract_typescript_facts_with_report(path, source).expect("facts");
        assert!(
            report.is_clean(),
            "{path} is ordinary source and must parse without damage, got {report:?}"
        );
    }
}

/// D-PA1 end to end: the diagnostic reaches the scan payload, which is the only place a consumer
/// can see it. `partial_parse` has been a declared gap kind of `ts.syntax_facts.v1` in
/// packages/core/src/semantic-capabilities.ts since that registry was written, and until now
/// nothing could produce one.
#[test]
fn the_scan_payload_carries_a_partial_parse_diagnostic_for_unparseable_content() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(
        dir.path().join("readme.ts"),
        "# Drift\n\nSome prose, a [link](https://example.com), and a list:\n\n- one\n- two\n",
    )
    .expect("write");
    std::fs::write(
        dir.path().join("clean.ts"),
        "export const answer = 42;\nexport function ask() { return answer; }\n",
    )
    .expect("write");

    let payload = scan_repo(dir.path());
    let diagnostics = payload["diagnostics"].as_array().expect("diagnostics");
    let partial = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic["code"] == "partial_parse")
        .collect::<Vec<_>>();

    assert_eq!(
        partial.len(),
        1,
        "exactly the markdown file must report itself, and the clean file must not: {diagnostics:#?}"
    );
    assert_eq!(partial[0]["file_path"], "readme.ts");
    assert_eq!(partial[0]["severity"], "warning");
    // The message has to carry the measurement, or a reader learns only that something happened.
    let message = partial[0]["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("bytes did not fit") && message.contains("% of the file"),
        "the diagnostic must say how much of the file was not read: {message}"
    );
}

/// D-PA3. Every one of these used to be `file_unreadable`, distinguishable only by free text, so
/// nothing keying on `code` could tell "this is a minified bundle, split it" from "this is not
/// text". Those have different answers.
#[test]
fn a_skipped_file_says_which_way_it_failed() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Reproduces the ast_depth_tests case: a 20,000-term `+` chain in a vendored bundle.
    let chain = (0..20_000)
        .map(|index| format!("a{index}"))
        .collect::<Vec<_>>()
        .join("+");
    std::fs::create_dir_all(dir.path().join("public/js")).expect("mkdir");
    std::fs::write(
        dir.path().join("public/js/vendor.min.js"),
        format!("var z={chain};\n"),
    )
    .expect("write");
    // Latin-1, which `fs::read_to_string` rejects as InvalidData.
    std::fs::write(
        dir.path().join("latin1.ts"),
        b"export const name = \"caf\xe9\";\n",
    )
    .expect("write");

    let payload = scan_repo(dir.path());
    let codes = payload["diagnostics"]
        .as_array()
        .expect("diagnostics")
        .iter()
        .filter_map(|diagnostic| {
            Some((
                diagnostic["file_path"].as_str()?.to_string(),
                diagnostic["code"].as_str()?.to_string(),
            ))
        })
        .collect::<Vec<_>>();

    assert!(
        codes.contains(&(
            "public/js/vendor.min.js".to_string(),
            "file_too_deep".to_string()
        )),
        "a bundle too deep to walk is not an unreadable file: {codes:?}"
    );
    assert!(
        codes.contains(&("latin1.ts".to_string(), "file_not_utf8".to_string())),
        "a readable file that is not UTF-8 is not an unreadable file either: {codes:?}"
    );
    assert!(
        !codes.iter().any(|(_, code)| code == "file_unreadable"),
        "neither of these is an I/O failure, and `file_unreadable` must keep meaning that: {codes:?}"
    );
}

fn scan_repo(root: &Path) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            root.to_str().expect("utf8 path"),
            "--format",
            "json",
            "--repo-id",
            "repo_fixture",
            "--scan-id",
            "scan_fixture",
        ])
        .output()
        .expect("run drift-engine");
    assert!(
        output.status.success(),
        "engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("json payload")
}
