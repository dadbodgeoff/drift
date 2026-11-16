//! S15b, item 4 (audit 1 §3, "Certainty: Ignored"): `Symbol.order` is capped by both
//! lowerings with no `truncated` entry. The listed reading (what `drift security` and
//! the practice map read) marks a list as long as the cap `order` in `truncated`, so a
//! reader answers unknown from it; mining's copy of the facts is left as it is.

use drift_core::practice::caps;
use drift_core::*;

fn repo(order_len: usize) -> RepoFacts {
    let symbol = Symbol {
        name: "handler".into(),
        line: 1,
        order: (0..order_len).map(|i| format!("lib.ts#f{i:03}")).collect(),
        ..Symbol::default()
    };
    RepoFacts {
        files: vec![FileFacts {
            path: "src/a.ts".into(),
            symbols: vec![symbol],
            ..FileFacts::default()
        }],
        ..RepoFacts::default()
    }
}

/// Pins the mark: before S15b the listed reading of a symbol whose `order` stopped at
/// the cap said nothing of it.
#[test]
fn an_order_at_its_cap_is_marked_cut_in_the_listed_reading_only() {
    let facts = repo(caps::ORDER);
    let listed = facts.listed();
    assert_eq!(listed.files[0].symbols[0].truncated, vec!["order".to_string()]);
    // What mining reads is unchanged.
    assert!(facts.files[0].symbols[0].truncated.is_empty());
    let owned = facts.clone().into_listed();
    assert_eq!(owned.files[0].symbols[0].truncated, vec!["order".to_string()]);
}

/// Under the cap nothing was cut, and nothing is said.
#[test]
fn an_order_under_its_cap_is_not_marked() {
    let facts = repo(caps::ORDER - 1);
    assert!(facts.listed().files[0].symbols[0].truncated.is_empty());
}
