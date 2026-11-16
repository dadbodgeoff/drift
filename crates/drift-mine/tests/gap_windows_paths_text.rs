//! Gap windows-paths: Drift's own files as a Windows checkout holds them. Git for
//! Windows checks text out with CRLF (`core.autocrlf`), and some Windows editors save a
//! UTF-8 byte-order mark; either way the file must read as the one Drift wrote. Every
//! name is invented.

use drift_mine::policy::Lock;
use drift_mine::ratchet::same_lines;

const BOM: &str = "\u{feff}";

fn lock_from(text: &str) -> Lock {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("drift.lock"), text).unwrap();
    Lock::load(dir.path()).unwrap()
}

/// Pins the lock: CRLF, a byte-order mark, or both, read as the LF file. Before, a mark
/// before a first line that is an entry (a person removed the comment) made its id
/// `\u{feff}D-…`, so the baselined violation blocked again.
#[test]
fn a_lock_with_crlf_or_a_byte_order_mark_reads_as_written() {
    let plain =
        "D-0a1b2c app/a.ts#handler\n#~ D-0a1b2c abc123 app/a.ts#handler\nD-0a1b2c app/b.ts#x\n";
    let want = lock_from(plain).entries;
    assert_eq!(want.len(), 3, "{want:?}");
    for text in [
        plain.replace('\n', "\r\n"),
        format!("{BOM}{plain}"),
        format!("{BOM}{}", plain.replace('\n', "\r\n")),
    ] {
        assert_eq!(lock_from(&text).entries, want, "{text:?}");
    }
    assert!(lock_from(&format!("{BOM}{plain}")).contains("D-0a1b2c", "app/a.ts#handler"));
}

/// Pins the security baseline's history check: the working copy (CRLF, maybe a mark) and
/// `git show HEAD:` (LF) of an unchanged file are the same file; a changed line is not.
#[test]
fn baseline_copies_compare_by_their_lines() {
    let lf = "# inventory: 9\nno-guard\ta.ts#f GET /a\n";
    assert!(same_lines(lf, &lf.replace('\n', "\r\n")));
    assert!(same_lines(
        lf,
        &format!("{BOM}{}", lf.replace('\n', "\r\n"))
    ));
    assert!(!same_lines(lf, &lf.replace("/a", "/b")));
    assert!(!same_lines(lf, "# inventory: 9\n"));
}
