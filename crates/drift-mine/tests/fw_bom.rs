//! Stream FW, audit W1 (BOM rows): a file a Windows editor saved with a UTF-8 byte-order
//! mark reads as the same file without it. Before, `str::trim` kept the U+FEFF, so the
//! first line of a header did not start with `//` or `#`: a file-header `drift-ignore`
//! on line 1 suppressed nothing, and a `.drift/security.lock` lost its stamp and its
//! `# fail:` kinds. Every name is invented.

use std::collections::BTreeMap;

use drift_mine::ratchet::{INVENTORY_VERSION, parse_baseline, render_lock};
use drift_mine::roles::{header_suppressions, suppressions_at};

const BOM: &str = "\u{feff}";

/// Pins the header: `drift-ignore` on line 1, after a BOM, still covers the file.
#[test]
fn a_header_ignore_after_a_byte_order_mark_still_covers_the_file() {
    let plain = "// drift-ignore D-0a1b2c: generated client\nexport const a = 1;\n";
    let with_bom = format!("{BOM}{plain}");
    assert_eq!(header_suppressions(plain), vec!["D-0a1b2c".to_string()]);
    assert_eq!(header_suppressions(&with_bom), header_suppressions(plain));
    // A `#` header (Python), the same.
    let py = "# drift-ignore D-0a1b2c: vendored\nx = 1\n";
    assert_eq!(header_suppressions(&format!("{BOM}{py}")), vec!["D-0a1b2c".to_string()]);
}

/// Pins the line form: the comment above line 2 is on line 1, after the BOM; line
/// numbers do not move (the mark is not a line).
#[test]
fn a_comment_on_line_one_after_a_byte_order_mark_covers_line_two() {
    let plain = "// drift-ignore D-0a1b2c: the one import kept\nimport { x } from \"./a\";\n";
    let with_bom = format!("{BOM}{plain}");
    assert_eq!(suppressions_at(plain, 2), vec!["D-0a1b2c".to_string()]);
    assert_eq!(suppressions_at(&with_bom, 2), suppressions_at(plain, 2));
    assert_eq!(suppressions_at(&with_bom, 1), suppressions_at(plain, 1));
    assert!(suppressions_at(&with_bom, 3).is_empty());
}

/// A text without a BOM reads exactly as before, and only one leading mark is
/// dropped (a second is the text's own).
#[test]
fn without_a_byte_order_mark_nothing_changes() {
    let code = "export const a = 1;\n// drift-ignore D-0a1b2c: too late\n";
    assert!(header_suppressions(code).is_empty());
    let twice = format!("{BOM}{BOM}// drift-ignore D-0a1b2c: x\n");
    assert!(header_suppressions(&twice).is_empty());
}

/// Pins the security baseline: with a BOM it keeps its stamp, its `# fail:` kinds and
/// its findings.
#[test]
fn a_security_baseline_with_a_byte_order_mark_keeps_its_header() {
    let mut found = BTreeMap::new();
    found.insert(
        ("no-guard".to_string(), "a.ts#f GET /a".to_string()),
        "a.ts:3".to_string(),
    );
    let text = render_lock(&found);
    let plain = parse_baseline(&text);
    let with_bom = parse_baseline(&format!("{BOM}{text}"));
    assert_eq!(plain.version, INVENTORY_VERSION);
    assert_eq!(with_bom.version, plain.version);
    assert_eq!(with_bom.fail, plain.fail);
    assert!(with_bom.fail.is_some());
    assert_eq!(with_bom.findings, plain.findings);
    assert_eq!(with_bom.findings.len(), 1);
}
