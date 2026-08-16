//! D-S2: `export { a, b };` referring to identifiers declared on earlier lines.
//!
//! `extract_export` had three fact-producing paths - a list export WITH a `from` source, a bare
//! `export default <expr>`, and an inline declaration on the export node - and none of them handled
//! the ordinary way a module publishes helpers declared above it. Two distinct symptoms, both worse
//! than a missing fact, and both asserted here:
//!
//!   (a) A file mixing inline and list exports has a key in `resolver.exported_symbols` from its
//!       inline exports, and that key is exactly what the conservative gate in main.rs uses to
//!       decide absence is provable. Consumers of the list-exported symbols got a FALSE
//!       `unresolved_import_symbol`. Measured on taxonomy: 8 diagnostics, every one of them against
//!       `components/ui/use-toast.ts`, from the 8 files importing `{ toast }` / `{ useToast }` -
//!       symbols TypeScript resolves without complaint. After the fix, 0.
//!
//!   (b) A file exporting ONLY via bare lists has no key at all, so the gate stays silent: no fact,
//!       no gap, no signal.
//!
//! Both contradict what `ts.import_resolution.v1` and `ts.syntax_facts.v1` declare about themselves
//! in packages/core/src/semantic-capabilities.ts: `certification: "certified_deterministic"`,
//! `can_block: true`. A false diagnostic on a route file is not cosmetic - it flows into check
//! completeness and withholds findings, which is why the corpus-wide movement matters:
//!
//!   taxonomy      8 -> 0        dub          23 ->  15
//!   calcom      606 -> 338      papermark   386 -> 243
//!   midday      475 -> 369      openstatus  355 -> 272
//!   formbricks  920 -> 138
//!
//!   2,773 -> 1,375 across the corpus.

use std::path::PathBuf;
use std::process::Command;

use drift_engine::{FactKind, extract_typescript_facts};
use serde_json::Value;

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/local-export-lists")
}

struct Scan {
    facts: Vec<Value>,
    diagnostics: Vec<Value>,
}

fn scan() -> Scan {
    let output = Command::new(env!("CARGO_BIN_EXE_drift-engine"))
        .args([
            "scan-repo",
            fixture().to_str().expect("utf8 fixture path"),
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
    let payload: Value = serde_json::from_slice(&output.stdout).expect("json payload");
    Scan {
        facts: payload["facts"].as_array().cloned().unwrap_or_default(),
        diagnostics: payload["diagnostics"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
    }
}

fn exports_of(scan: &Scan, file_path: &str) -> Vec<String> {
    let mut names = scan
        .facts
        .iter()
        .filter(|fact| fact["kind"] == "exported_symbol" && fact["file_path"] == file_path)
        .map(|fact| fact["name"].as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    names.sort();
    names
}

/// Symptom (a). This is the assertion that would have caught taxonomy's 8 false diagnostics.
#[test]
fn a_mixed_inline_and_list_export_file_does_not_make_its_consumers_unresolvable() {
    let scan = scan();
    let false_positives = scan
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic["code"] == "unresolved_import_symbol")
        .map(|diagnostic| {
            diagnostic["message"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        })
        .collect::<Vec<_>>();

    assert!(
        false_positives.is_empty(),
        "every symbol imported in this fixture is exported by the module it comes from, and \
         TypeScript resolves all of them. A diagnostic here is a claim the engine cannot support, \
         and it flows into check completeness: {false_positives:?}"
    );
}

/// Symptom (b). The file has no inline export at all, so before the fix it produced no key and no
/// signal - the failure mode the product's own CI comment calls worse than stopping.
#[test]
fn a_file_exporting_only_by_list_still_reports_what_it_exports() {
    let scan = scan();

    assert_eq!(
        exports_of(&scan, "lib/only-list.ts"),
        vec!["alpha".to_string(), "betaFn".to_string()],
        "a module that publishes everything by bare list must still say what it publishes; \
         `type Gamma` is erased and must not appear"
    );
    assert_eq!(
        exports_of(&scan, "components/ui/use-toast.ts"),
        vec![
            "TOAST_LIMIT".to_string(),
            "toast".to_string(),
            "useToast".to_string()
        ],
        "the inline and the list exports are both exports"
    );
}

/// `export type { Delta };` is erased at compile time. Claiming it as a runtime export would turn a
/// missing-symbol gap into a wrong answer, which is the same reasoning the default-export branch
/// records for `export type { X as default }`.
#[test]
fn a_type_only_export_list_publishes_nothing_at_runtime() {
    assert_eq!(
        exports_of(&scan(), "lib/type-only.ts"),
        Vec::<String>::new()
    );
}

/// The reason this is read off the AST rather than off the statement text: the text route cannot
/// tell `export { a, b };` from `export const config = { a: 1, b: 2 };`. Both carry a brace pair and
/// a comma-separated list, and the text route would publish a phantom export named `a:`.
#[test]
fn an_exported_object_literal_is_one_export_not_one_per_property() {
    assert_eq!(
        exports_of(&scan(), "lib/object-literal.ts"),
        vec!["config".to_string()]
    );
}

/// `export { handler as default };` publishes `default`, and carries the local binding so a
/// consumer can follow it - the same convention the `export default <identifier>` branch uses.
#[test]
fn a_renamed_export_publishes_the_alias_and_records_the_local_binding() {
    let facts = extract_typescript_facts(
        "pages/api/report.ts",
        "function handler(req, res) { res.end(); }\nexport { handler as default };\n",
    )
    .expect("typescript facts");

    let exported = facts
        .iter()
        .find(|fact| fact.kind == FactKind::ExportedSymbol && fact.name == "default")
        .expect("the module exports `default`");
    assert_eq!(exported.value.as_deref(), Some("handler"));
}
