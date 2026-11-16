//! The security baseline against readings newer than it (F3, review R3 row 1).
//!
//! Pins: before, `found_since` knew only new kinds and new sink kinds, so a finding
//! of an old kind that a widened reading found (a route behind a wrapper a call
//! builds, a `$where` built in a helper, a guard gap from guards read since) failed
//! `drift check` against a baseline the previous release wrote, with no change to
//! the code; against a diff, only `guard-gap` outside the change was spared.

use drift_mine::ratchet::{
    Findings, INVENTORY_VERSION, Since, compare_with, found_since, newer_readings_line,
    parse_baseline, render, render_lock,
};

/// What a commit shows (review of PR 148, area 7 item 1): `found` there, `touched`
/// since, and gap exceptions that are not the change's.
fn since(found: &Findings, touched: &[&str], outside: &[(&str, &str)]) -> Since {
    Since {
        commit: "c0ffee".into(),
        found: found.keys().cloned().collect(),
        touched: touched.iter().map(|p| p.to_string()).collect(),
        outside: outside
            .iter()
            .map(|(k, key)| (k.to_string(), key.to_string()))
            .collect(),
    }
}

fn found(rows: &[(&str, &str, &str)]) -> Findings {
    rows.iter()
        .map(|(k, key, at)| ((k.to_string(), key.to_string()), at.to_string()))
        .collect()
}

/// What the release before the stamp wrote: no `# inventory:`, no `# fail:`.
const OLDER: &str = "# drift security baseline: what `drift security` found when this was written.\n\
                     # `drift security --ratchet` reports what is found now and is not here.\n\
                     # Written by `drift security --write-baseline`; do not edit by hand.\n\
                     no-guard\tserver.ts#GET /a GET /a\n";

#[test]
fn every_kind_a_reading_widened_is_found_since_the_widening() {
    // Widened by version 3: a tRPC procedure keyed by its dotted path, and the entry
    // points a deployment file names (more entry points, so more of every kind read
    // off one).
    for kind in [
        "guard-gap",
        "no-authorization",
        "no-guard",
        "risky",
        "scope-gap",
        "unguarded-reaching",
        "unscoped-key",
        "whole-row",
    ] {
        assert_eq!(found_since(kind, "x"), 3, "{kind}");
    }
    // Widened by version 3: the pipelines of CI systems other than GitHub Actions.
    assert_eq!(found_since("workflow", "x"), 3);
    // Read as before.
    for kind in ["dependency", "kubernetes", "leak"] {
        assert_eq!(found_since(kind, "x"), 1, "{kind}");
    }
    const { assert!(INVENTORY_VERSION >= 3) };
}

#[test]
fn an_older_baseline_fails_nothing_a_wider_reading_finds_in_a_whole_tree_check() {
    let b = parse_baseline(OLDER);
    assert_eq!(b.version, 1);
    let now = found(&[
        ("no-guard", "server.ts#GET /a GET /a", "server.ts:3"),
        (
            "unguarded-reaching",
            "server.ts#GET /s GET /s -> sql_string_interpolation",
            "server.ts:9",
        ),
        (
            "risky",
            "nosql_injection in lib/dao.ts#byThreshold",
            "lib/dao.ts:2",
        ),
        (
            "guard-gap",
            "routes/x.ts#GET /x GET /x lacks auth",
            "routes/x.ts:4",
        ),
        (
            "workflow",
            "unpinned_action in .github/workflows/ci.yml job a: someone/x@v1",
            ".github/workflows/ci.yml:7",
        ),
    ]);
    // A whole-tree check, where the commit that wrote the baseline shows every
    // finding there and no file changed since. (Against a diff, a touched file fails
    // as before: `against_a_diff_*` below, F10. With nothing to compare with, nothing
    // is held: review of PR 148, area 7 item 1.)
    {
        let r = compare_with(&now, &b, None);
        assert!(r.new_in_drift.is_empty(), "{r:?}");
        assert_eq!(r.unshown, 4, "{r:?}");
        let r = compare_with(&now, &b, Some(&since(&now, &[], &[])));
        assert_eq!(r.kept, 1);
        for kind in ["unguarded-reaching", "risky", "guard-gap", "workflow"] {
            assert_eq!(
                r.new_in_drift.get(kind).map(Vec::len),
                Some(1),
                "{kind}: {r:?}"
            );
            assert!(!r.added.contains_key(kind), "{kind}: {r:?}");
        }
        // The workflow reading widened too (comment-triggered runs, bracket-form
        // expressions): held as the others are, only where shown old.
        assert!(!r.added.contains_key("workflow"), "{r:?}");
        let line = newer_readings_line(&r).unwrap();
        assert!(line.starts_with("4 finding(s) come from readings newer than this baseline; they are listed and do not fail the check; write the baseline again to start checking them"), "{line}");
        let text = render(&r, 20);
        assert_eq!(
            text.matches("readings newer than this baseline").count(),
            1,
            "{text}"
        );
        // Rows pass through `report::sanitize`, which writes `>` as `›` (as before
        // this build), so the key's arrow prints as `-›`.
        assert!(
            text.contains("  server.ts#GET /s GET /s -› sql_string_interpolation  (server.ts:9)\n"),
            "{text}"
        );
    }
}

#[test]
fn a_baseline_written_now_fails_on_a_new_finding() {
    let before = found(&[("no-guard", "server.ts#GET /a GET /a", "server.ts:3")]);
    let b = parse_baseline(&render_lock(&before));
    assert_eq!(b.version, INVENTORY_VERSION);
    let now = found(&[
        ("no-guard", "server.ts#GET /a GET /a", "server.ts:3"),
        ("no-guard", "server.ts#GET /b GET /b", "server.ts:8"),
    ]);
    let r = compare_with(&now, &b, None);
    assert_eq!(r.added["no-guard"][0].key, "server.ts#GET /b GET /b");
    assert!(r.new_in_drift.is_empty(), "{r:?}");
    assert!(newer_readings_line(&r).is_none());
}

/// A scope gap is a share of siblings, as a guard gap is: an untouched entry point
/// turns into an exception when others gain the scope. Before, only `guard-gap`
/// went to `outside_change`.
#[test]
fn a_scope_gap_outside_the_change_fails_nothing() {
    let b = parse_baseline(&render_lock(&Findings::new()));
    let now = found(&[
        (
            "scope-gap",
            "a.ts#f GET /a reads note without userId",
            "a.ts:3",
        ),
        (
            "scope-gap",
            "b.ts#g GET /b reads note without userId",
            "b.ts:4",
        ),
    ]);
    // `a.ts`'s exception was there at the commit compared with, in a file the change
    // did not touch ([`drift_mine::ratchet::not_the_changes_gaps`] says so).
    let shown = since(
        &Findings::new(),
        &["b.ts"],
        &[("scope-gap", "a.ts#f GET /a reads note without userId")],
    );
    let r = compare_with(&now, &b, Some(&shown));
    assert_eq!(r.added["scope-gap"][0].at, "b.ts:4");
    assert_eq!(r.outside_change["scope-gap"][0].at, "a.ts:3");
}

/// F10 (review R10 F-1): before, against a baseline older than a kind's reading,
/// every finding of the kind went to `new_in_drift`, also one in a file the diff
/// touched, so after an upgrade a change's new unguarded route failed nothing.
/// Pins: against a diff, a newer-reading finding in a touched file fails as the
/// kind did before; one in an untouched file is held as new in this Drift.
#[test]
fn against_a_diff_a_new_unguarded_route_fails_an_unstamped_baseline() {
    let b = parse_baseline(OLDER);
    assert_eq!(b.version, 1);
    let now = found(&[
        ("no-guard", "server.ts#GET /a GET /a", "server.ts:3"),
        ("no-guard", "routes/new.ts#GET /n GET /n", "routes/new.ts:2"),
        (
            "risky",
            "nosql_injection in lib/dao.ts#byThreshold",
            "lib/dao.ts:2",
        ),
    ]);
    // The merge base has what was there; the route is the change's (also if a
    // reading at the base had found it: its file is touched).
    let r = compare_with(&now, &b, Some(&since(&now, &["routes/new.ts"], &[])));
    assert_eq!(r.kept, 1);
    assert_eq!(
        r.added.get("no-guard").map(|rows| rows[0].at.as_str()),
        Some("routes/new.ts:2"),
        "{r:?}"
    );
    assert!(!r.new_in_drift.contains_key("no-guard"), "{r:?}");
}

#[test]
fn against_a_diff_an_old_finding_in_an_untouched_file_fails_nothing() {
    let b = parse_baseline(OLDER);
    let now = found(&[
        ("no-guard", "server.ts#GET /a GET /a", "server.ts:3"),
        (
            "risky",
            "nosql_injection in lib/dao.ts#byThreshold",
            "lib/dao.ts:2",
        ),
    ]);
    let r = compare_with(&now, &b, Some(&since(&now, &["routes/new.ts"], &[])));
    assert!(r.added.is_empty(), "{r:?}");
    assert_eq!(r.new_in_drift.get("risky").map(Vec::len), Some(1), "{r:?}");
    assert!(newer_readings_line(&r).is_some());
}
