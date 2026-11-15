//! What the callee's declared parameter type says about a `passes_key` rule's key,
//! from the parameter-type facts ([`drift_core::Symbol::arg_types`]).
//!
//! Shown with a proposal (`census --json` `key_type`, Studio's convention detail) so
//! a reviewer sees when the compiler already requires the key. Mining reads it once:
//! a key rule with no outlier left whose key the type requires restates the type and
//! is not proposed (`mine::compiler_enforced`). Dropping every rule whose key the
//! type requires was measured on the TypeScript dev set and not kept: it removed
//! 2 TRIVIAL and 3 ACCEPT proposals, whose outliers were members that never called
//! the callee (a public handler skipping the team's client), which a reviewer wants
//! named whatever the type says.

use std::collections::BTreeSet;

use drift_core::RepoFacts;

use crate::mine::{Rule, norm_ref};

/// `required`, `optional` or `unknown` when every call in the repo that passes the
/// rule's key to its callee says the same, `mixed` when they differ, and `None` for
/// other rules or when no call has parameter-type facts (languages that do not
/// resolve parameter types).
pub fn key_type(repo: &RepoFacts, rule: &Rule) -> Option<&'static str> {
    let Rule::PassesKey { callee, index, key } = rule else {
        return None;
    };
    let want = format!("{index}:{key}");
    let callee = norm_ref(callee);
    let mut seen = BTreeSet::new();
    for s in repo.files.iter().flat_map(|f| &f.symbols) {
        for a in &s.arg_types {
            let Some((site, kind)) = a.rsplit_once('=') else {
                continue;
            };
            if let Some((c, rest)) = site.rsplit_once('@')
                && rest == want
                && norm_ref(c) == callee
            {
                seen.insert(kind);
            }
        }
    }
    match seen.len() {
        0 => None,
        1 => match seen.into_iter().next()? {
            "required" => Some("required"),
            "optional" => Some("optional"),
            _ => Some("unknown"),
        },
        _ => Some("mixed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{FileFacts, Symbol};

    fn repo(arg_types: &[&[&str]]) -> RepoFacts {
        RepoFacts {
            files: vec![FileFacts {
                path: "a.ts".into(),
                symbols: arg_types
                    .iter()
                    .map(|a| Symbol {
                        arg_types: a.iter().map(|s| s.to_string()).collect(),
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn rule(callee: &str, key: &str) -> Rule {
        Rule::PassesKey {
            callee: callee.into(),
            index: 0,
            key: key.into(),
        }
    }

    #[test]
    fn agreement_across_calls_and_package_subpaths() {
        let r = repo(&[
            &["lib/x.ts#f@0:a=required", "lib/x.ts#f@0:b=optional"],
            &["lib/x.ts#f@0:a=required", "lib/x.ts#f@1:a=optional"],
            &["pkg:lib/sub#g@0:a=required", "pkg:lib#g@0:a=unknown"],
        ]);
        assert_eq!(key_type(&r, &rule("lib/x.ts#f", "a")), Some("required"));
        assert_eq!(key_type(&r, &rule("lib/x.ts#f", "b")), Some("optional"));
        // `pkg:lib/sub#g` and `pkg:lib#g` are one callee; the calls disagree.
        assert_eq!(key_type(&r, &rule("pkg:lib#g", "a")), Some("mixed"));
        assert_eq!(key_type(&r, &rule("lib/x.ts#f", "c")), None);
        assert_eq!(
            key_type(
                &r,
                &Rule::Calls {
                    callee: "lib/x.ts#f".into()
                }
            ),
            None
        );
    }
}
