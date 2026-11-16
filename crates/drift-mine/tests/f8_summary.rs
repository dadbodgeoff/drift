//! F8 (review R8 rows 4 and 11): the first-run security summary says "no guard found"
//! only where Drift read everything on the way, and a line names the inventory's own
//! validation fact as what it is.
//!
//! Before: an entry point with wrappers or middleware Drift saw and did not read was
//! ranked first as "A caller Drift found no guard for can", ahead of every guard Drift
//! read; and a schema seen in the body was worded "the input is validated on the way".

use drift_mine::practices::basis::{Basis, NotRead};
use drift_mine::security::{EntryRow, Exposure, Inventory, Reach};
use drift_mine::security_summary::{Caller, Readings, render, summarize};

fn entry(path: &str, route: &str, basis: Option<Basis>) -> EntryRow {
    let mut e = EntryRow {
        path: path.to_string(),
        package: String::new(),
        symbol: format!("POST {route}"),
        line: 1,
        kind: "http".to_string(),
        method: Some("POST".to_string()),
        route: Some(route.to_string()),
        guards: Vec::new(),
        wrappers: Vec::new(),
        opaque: Vec::new(),
        authenticates: Vec::new(),
        opens: Vec::new(),
        validates: false,
        reaches: Vec::new(),
        reads: Vec::new(),
        exposure: Exposure::Public,
        boundary: None,
        local: false,
        descriptions: Vec::new(),
        tied: false,
        basis,
        exposure_basis: None,
        known_open: false,
        verifies_signature: Vec::new(),
    };
    let via = vec![format!("{path}#{}", e.symbol), format!("{path}#run")];
    e.reaches.push(Reach {
        kind: "shell_exec".to_string(),
        via,
        fed: true,
    });
    e
}

fn unread() -> Basis {
    Basis {
        not_read: vec![NotRead {
            kind: "package_function".to_string(),
            what: "pkg:mystery#mount".to_string(),
            why: "a package's function no list of Drift's has an entry for".to_string(),
        }],
        ..Basis::default()
    }
}

/// A route with something unread on the way ranks after one behind a guard Drift read,
/// worded as not read; a route Drift read to the end still ranks first.
#[test]
fn no_guard_found_with_something_unread_is_worded_as_not_read_and_ranked_after_guards() {
    let open = entry("a.ts", "/a", Some(Basis::default()));
    let hazy = entry("b.ts", "/b", Some(unread()));
    let mut guarded = entry("c.ts", "/c", None);
    guarded.guards = vec!["requireUser".to_string()];
    let s = summarize(
        &Inventory {
            entry_points: vec![hazy, guarded, open],
            ..Inventory::default()
        },
        &Readings::default(),
    );
    let callers: Vec<(String, Caller)> = s
        .ranked
        .iter()
        .map(|r| (r.places[0].path.clone(), r.caller))
        .collect();
    assert_eq!(
        callers,
        [
            ("a.ts".to_string(), Caller::Anyone),
            ("c.ts".to_string(), Caller::PassesGuard),
            ("b.ts".to_string(), Caller::Unread),
        ]
    );
    let text = render(&s, 10);
    assert!(
        text.contains("A caller, unless something Drift did not read turns them away, can send text that becomes part of a shell command"),
        "{text}"
    );
    assert!(
        text.contains("no guard found in what Drift read, and some of the way was not read"),
        "{text}"
    );
    assert!(
        text.contains("1 thing(s) on the way a guard may be in"),
        "{text}"
    );
}

/// A schema the inventory saw in the body, with no reading of the practice map, is
/// said as that, not as validation on the way.
#[test]
fn a_schema_in_the_body_is_said_as_what_it_is() {
    let mut e = entry("a.ts", "/a", Some(Basis::default()));
    e.validates = true;
    let s = summarize(
        &Inventory {
            entry_points: vec![e],
            ..Inventory::default()
        },
        &Readings::default(),
    );
    let text = render(&s, 10);
    assert!(text.contains("a schema is read in the body"), "{text}");
    assert!(!text.contains("validated on the way"), "{text}");
}
