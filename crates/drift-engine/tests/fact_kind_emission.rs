//! Which fact kinds does any code actually emit?
//!
//! `FactKind::ALL` is a vocabulary — a list of names the wire may carry. It is not evidence that
//! anything produces them, and three of its members are produced by nothing at all. That mattered
//! once already: `rate_limit_guard_called` is a `FAMILY_SPECS` source for the rate-limit family, and
//! it contributes exactly nothing to it. The family works only because a `symbol_called` source
//! sits beside it — a fallback the request-validation family did not have, which is precisely why
//! that one was structurally unable to form and its presence cell could not fire.
//!
//! So "is this kind emitted anywhere?" is made a declared, checked property rather than an
//! assumption, in the same spirit as the convention cell ledger. A kind that no extractor writes
//! must be listed below with a reason; wiring one up fails this test until the list is updated,
//! which is the point — the declaration cannot quietly drift away from the code.
//!
//! Derivation is a grep over the crate's own sources for the two forms that actually construct a
//! fact kind: `kind: FactKind::X` (a struct literal) and `=> FactKind::X` (a mapping arm — the
//! Prisma reader builds `data_model_*` by translating `PrismaFactKind`, and a grep for the struct
//! form alone reported those three as dead when they are not). `vocabulary.rs` is excluded: it is
//! the vocabulary's definition, so every kind appears there by construction and counting it would
//! make this test vacuous.
//!
//! That is weaker than a parser and chosen for the same reason the ledger checker chooses it: no
//! build step, so it cannot go stale against a rebuilt binary, and it is anchored to forms that
//! already exist throughout this crate.

use drift_engine::FactKind;
use std::collections::BTreeSet;
use std::path::Path;

/// Fact kinds in the vocabulary that NO code in this crate emits, each with the reason it is here.
///
/// This is a statement about the extractors, not about the wire format: every one of these is a
/// legal `fact_kind` that a consumer may already branch on, and removing them from the vocabulary
/// is a compatibility decision this list does not make.
const NEVER_EMITTED: &[(&str, &str)] = &[
    (
        "csrf_guard_called",
        "No extractor writes it. `evaluate_api_route_requires_csrf_for_mutation` reasons over \
         source text through `accepted_helper_called` (security_rules.rs) instead of over facts, \
         so the CSRF path never needed the kind and nothing ever produced it.",
    ),
    (
        "rate_limit_guard_called",
        "No extractor writes it, yet it is the FIRST source of the rate-limit entry in \
         FAMILY_SPECS (candidate_command.rs). That family forms only from the `symbol_called` \
         source listed beside it. The request-validation family had no such fallback, which is how \
         its presence cell came to be structurally unreachable - see \
         docs/ground-truth-audit/presence-facts-report.md.",
    ),
    (
        "test_declared",
        "No extractor writes it. Nothing in this crate consumes it either, so it is vocabulary \
         reserved for a test-file adapter that does not exist yet.",
    ),
];

/// Every `.rs` file in `src/`, recursively — `frameworks/` is a subdirectory and emits facts too.
fn crate_sources() -> Vec<String> {
    fn walk(dir: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).expect("read src dir") {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs")
                // The vocabulary's own definition names every kind; counting it would make the
                // question "is this emitted?" answer itself.
                && path.file_name().and_then(|name| name.to_str()) != Some("vocabulary.rs")
            {
                out.push(std::fs::read_to_string(&path).expect("read source"));
            }
        }
    }
    let mut out = Vec::new();
    walk(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut out);
    assert!(!out.is_empty(), "found no sources to scan");
    out
}

/// The Rust variant name for a wire name: `request_validation_called` -> `RequestValidationCalled`.
fn variant_name(kind: FactKind) -> String {
    kind.as_wire()
        .split('_')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

#[test]
fn every_fact_kind_is_emitted_by_something_or_declared_dead() {
    let sources = crate_sources();
    let declared: BTreeSet<&str> = NEVER_EMITTED.iter().map(|(kind, _)| *kind).collect();

    let mut emitted = BTreeSet::new();
    let mut unemitted = BTreeSet::new();
    for kind in FactKind::ALL {
        // Both construction forms: the struct literal, and the mapping arm the Prisma reader
        // uses to translate `PrismaFactKind` into `data_model_*`.
        let variant = variant_name(*kind);
        let literal = format!("kind: FactKind::{variant}");
        let mapped = format!("=> FactKind::{variant}");
        if sources
            .iter()
            .any(|source| source.contains(&literal) || source.contains(&mapped))
        {
            emitted.insert(kind.as_wire());
        } else {
            unemitted.insert(kind.as_wire());
        }
    }

    // Guard the instrument itself. A grep that matches nothing would declare every kind dead and
    // this test would then be asserting only that the list is complete, which is worthless.
    assert!(
        emitted.contains("symbol_called") && emitted.contains("request_validation_called"),
        "the emission grep found neither of two kinds this crate certainly emits, so the pattern \
         has drifted from the code and every result below is noise"
    );

    let undeclared: Vec<&str> = unemitted.difference(&declared).copied().collect();
    assert!(
        undeclared.is_empty(),
        "these fact kinds are in the vocabulary but no extractor writes them, and they are not \
         declared in NEVER_EMITTED: {undeclared:?}. A kind nothing produces is a claim the wire \
         format makes and the engine does not keep - declare it with a reason, or emit it."
    );

    let stale: Vec<&str> = declared
        .iter()
        .copied()
        .filter(|kind| emitted.contains(kind))
        .collect();
    assert!(
        stale.is_empty(),
        "these kinds are declared as never emitted but something now emits them: {stale:?}. \
         Remove them from NEVER_EMITTED - a recorded dead kind that is alive is a false record, \
         and it is how a list like this stops describing anything."
    );
}

/// The two halves of the request-validation story, pinned against each other.
///
/// `request_validation_called` is emitted, and it is emitted by the scan path rather than only by
/// the check path — that is the whole fix. `rate_limit_guard_called` is not, and the difference
/// between the two families' fates is the `symbol_called` fallback, not the fact kind.
#[test]
fn request_validation_is_emitted_where_rate_limit_is_not() {
    let sources = crate_sources();
    assert!(
        sources
            .iter()
            .any(|source| source.contains("kind: FactKind::RequestValidationCalled")),
        "the kind whose absence made the presence cell unreachable"
    );
    assert!(
        !sources.iter().any(|source| {
            source.contains("kind: FactKind::RateLimitGuardCalled")
                || source.contains("=> FactKind::RateLimitGuardCalled")
        }),
        "if this now fails, the rate-limit family gained a real dedicated source - update \
         NEVER_EMITTED and the report's fact-kind table"
    );
}
