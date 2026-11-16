//! S15b, item 7: `--suggestions` no longer says the default tier "is always listed in
//! full", which is false when mining's own caps cut a default-tier rule.

use std::process::Command;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// Pins the help text: before S15b it read "The default tier is always listed in full."
#[test]
fn suggestions_help_says_only_this_cap_spares_the_default_tier() {
    let out = Command::new(&*BIN)
        .args(["census", "--help"])
        .output()
        .unwrap();
    let help = String::from_utf8_lossy(&out.stdout);
    assert!(!help.contains("always listed in full"), "{help}");
    assert!(
        help.contains("This cap never cuts the default tier"),
        "{help}"
    );
}
