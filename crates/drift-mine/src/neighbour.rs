//! The neighbour gate (round 11, WS-J): a warning `drift check` would give a member that
//! breaks a convention is held back when the member is structurally nearer the members
//! the convention sets apart (Drift's exemptions, a reviewer's exceptions) than the
//! members that hold it. Deterministic, label-free and learned from nothing: a fixed
//! distance over facts Drift already has, and the rule "nearer", with no threshold.
//!
//! - **Signature** ([`Signature`]): what a member is, apart from what the rule asks of it:
//!   - the modules its file imports, resolved ones only, without the modules the rule
//!     itself names ([`rule_modules`]: the wrapper's, the callee's, the layer it avoids),
//!     so the signature never encodes the verdict;
//!   - its export position: default or named export (or a whole file), its entry kind
//!     and its symbol kind;
//!   - its consumers: the files that import it (by one of its exported names or `*`;
//!     any import of the file, for a file unit);
//!   - its role selectors (package, folder, file kind, entry and symbol kind at each
//!     depth), as `roles` computes them.
//! - **Distance** ([`distance`]): the mean of the four Jaccard distances, a part both
//!   sides leave empty counting 0. Fixed weights.
//! - **Decision** ([`holds_back`]): held back only when the nearest set-apart member is
//!   strictly nearer than the nearest holder. A tie warns, and so does a convention that
//!   sets nobody apart [STRICT].
//! - **Never held back** ([`may_hold_back`]) [STRICT]: what no exemption may leave out
//!   ([`crate::mine::Rule::exemption_allowed`]: an entry point, a handler a route refers
//!   to, any member under a guard rule or a call to a guard) and any member under an input
//!   validation rule. A warning on a reachable entry point under an auth or validation
//!   rule is therefore always given.
//!
//! Off by default; `DRIFT_NEIGHBOUR_GATE=on` turns it on for `drift check`, the hooks, MCP
//! and PR mode ([`crate::check::neighbour_gate_on`]). Known limitation: a new violator next
//! to a member Drift exempts by itself is nearer that member than the holders, so it is
//! held back (eval/study/runs/neighbour-r11-2026-11-08).
//!
//! A held-back warning is never dropped: `drift check` keeps it in `violations`, marked
//! `suppressed_neighbour`, and lists it with both neighbours in the report's
//! `suppressed_neighbour` ([`crate::check::NeighbourHold`]). It never fails a check.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{RepoFacts, SymbolKind};

use crate::context::RepoContext;
use crate::mine::Rule;
use crate::roles::{RoleSelector, Unit, View};

/// One member's structural signature ([`signature`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Signature {
    /// Resolved modules its file imports, less the rule's own ([`rule_modules`]).
    pub imports: BTreeSet<String>,
    /// `export:default` / `export:named` / `export:file`, `entry:<kind>`, `kind:<kind>`.
    pub export: BTreeSet<String>,
    /// Files that import it.
    pub consumers: BTreeSet<String>,
    /// Its role selectors, one string per depth.
    pub roles: BTreeSet<String>,
}

/// Who imports what: per imported module, the files importing it and the names they use.
#[derive(Debug, Default)]
pub struct Consumers<'a> {
    by_module: BTreeMap<&'a str, Vec<(&'a str, &'a [String])>>,
}

impl<'a> Consumers<'a> {
    pub fn learn(repo: &'a RepoFacts) -> Self {
        let mut by_module: BTreeMap<&'a str, Vec<(&'a str, &'a [String])>> = BTreeMap::new();
        for f in &repo.files {
            for i in &f.imports {
                if i.module.starts_with("unresolved:") || i.module.starts_with("pkg:") {
                    continue;
                }
                by_module
                    .entry(i.module.as_str())
                    .or_default()
                    .push((f.path.as_str(), i.names.as_slice()));
            }
        }
        Consumers { by_module }
    }

    /// The files importing `path` by one of `names` (or `*`); any of them when `names` is
    /// `None` (a file unit).
    fn of(&self, path: &str, names: Option<&[String]>) -> BTreeSet<String> {
        let Some(users) = self.by_module.get(path) else {
            return BTreeSet::new();
        };
        users
            .iter()
            .filter(|(from, used)| {
                *from != path
                    && names.is_none_or(|n| used.iter().any(|u| u == "*" || n.contains(u)))
            })
            .map(|(from, _)| (*from).to_string())
            .collect()
    }
}

/// The modules a rule names: what a member's imports must not carry into its signature,
/// since importing them is what holding the rule looks like.
pub fn rule_modules(rule: &Rule) -> Vec<String> {
    let mut refs: Vec<&str> = Vec::new();
    match rule {
        Rule::WrappedBy { any_of, .. } => refs.extend(any_of.iter().map(String::as_str)),
        Rule::PassesKey { callee, .. } | Rule::Calls { callee } => refs.push(callee),
        Rule::Renders { component } => refs.push(component),
        Rule::Throws { class } => refs.push(class),
        Rule::Before { first, then } => refs.extend([first.as_str(), then.as_str()]),
        Rule::Avoids { signal } => {
            if let Some(m) = signal.strip_prefix("import:") {
                refs.push(m);
            }
        }
        Rule::ImportsFrom {
            source, instead_of, ..
        } => {
            refs.push(source);
            refs.extend(instead_of.iter().map(String::as_str));
        }
        Rule::PrefersLibrary { group, .. } => {
            if let Some((_, members)) = crate::mine::LIBRARY_GROUPS.iter().find(|(g, _)| g == group)
            {
                return members.iter().map(|m| format!("pkg:{m}")).collect();
            }
        }
        _ => {}
    }
    refs.into_iter()
        .map(|r| {
            let n = crate::mine::norm_ref(r);
            n.split_once('#').map_or(n.as_ref(), |(m, _)| m).to_string()
        })
        .filter(|m| !m.is_empty())
        .collect()
}

fn named_by(module: &str, excluded: &[String]) -> bool {
    excluded.iter().any(|m| {
        module == m
            || module
                .strip_prefix(m.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

fn role_feature(r: &RoleSelector) -> String {
    format!(
        "{}|{}|{}|{}|{:?}|{}|{}",
        r.package,
        r.dir,
        r.file,
        r.entry,
        r.kind,
        r.variety.as_deref().unwrap_or(""),
        r.member_kind.as_deref().unwrap_or("")
    )
}

/// `u`'s signature for a convention whose rule names `excluded` modules ([`rule_modules`]).
pub fn signature(u: &Unit, consumers: &Consumers, excluded: &[String]) -> Signature {
    let (file, names) = match u.view {
        View::Symbol(f, s) => (Some(f), Some(s.exported_as.as_slice())),
        View::File(f) => (Some(f), None),
        View::Model(_) | View::Package(_) => (None, None),
    };
    let imports = file.map_or_else(BTreeSet::new, |f| {
        f.imports
            .iter()
            .filter(|i| !i.module.starts_with("unresolved:") && !named_by(&i.module, excluded))
            .map(|i| i.module.clone())
            .collect()
    });
    let mut export = BTreeSet::new();
    match names {
        Some(n) if n.iter().any(|x| x == "default") => export.insert("export:default".into()),
        Some(_) => export.insert("export:named".into()),
        None => export.insert("export:file".into()),
    };
    export.insert(format!("entry:{}", u.entry));
    let kind: SymbolKind = u.kind();
    export.insert(format!("kind:{kind:?}"));
    let consumers = file.map_or_else(BTreeSet::new, |f| consumers.of(&f.path, names));
    let roles = u.roles.iter().map(role_feature).collect();
    Signature {
        imports,
        export,
        consumers,
        roles,
    }
}

fn jaccard_distance(a: &BTreeSet<String>, b: &BTreeSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let both = a.intersection(b).count();
    let either = a.len() + b.len() - both;
    1.0 - both as f64 / either as f64
}

/// The distance of two signatures: the mean of the Jaccard distances of their imports,
/// export positions, consumers and roles. 0 for equal signatures, 1 at most.
pub fn distance(a: &Signature, b: &Signature) -> f64 {
    (jaccard_distance(&a.imports, &b.imports)
        + jaccard_distance(&a.export, &b.export)
        + jaccard_distance(&a.consumers, &b.consumers)
        + jaccard_distance(&a.roles, &b.roles))
        / 4.0
}

/// The nearest of `pool` to `sig` (the first in pool order on a tie), as (index, distance).
pub fn nearest<'s>(
    sig: &Signature,
    pool: impl IntoIterator<Item = &'s Signature>,
) -> Option<(usize, f64)> {
    let mut best: Option<(usize, f64)> = None;
    for (i, s) in pool.into_iter().enumerate() {
        let d = distance(sig, s);
        if best.is_none_or(|(_, b)| d < b) {
            best = Some((i, d));
        }
    }
    best
}

/// The gate's one rule: held back only when there is a set-apart member and it is
/// strictly nearer than the nearest holder. No holder, no set-apart member, or a tie:
/// warn [STRICT].
pub fn holds_back(nearest_holder: Option<f64>, nearest_apart: Option<f64>) -> bool {
    match (nearest_holder, nearest_apart) {
        (Some(h), Some(a)) => a < h, // mutation:neighbour-nearer
        _ => false,
    }
}

/// Whether the gate may hold back a warning of `rule` on `view` at all [STRICT]: never
/// where no exemption may leave a member out ([`Rule::exemption_allowed`]: an entry point
/// or a handler a route refers to, and every member under a guard rule), and never under
/// a rule about validating input.
pub fn may_hold_back(rule: &Rule, view: &View, ctx: &RepoContext) -> bool {
    if crate::mine::is_input_validation(rule) {
        return false; // mutation:neighbour-validation
    }
    rule.exemption_allowed(view, ctx) // mutation:neighbour-guard
}

/// Environment variable naming a file `drift census --json` writes the gate's study
/// readings to ([`study`]): eval/study/neighbour.mjs reads it. Unset, nothing is written.
pub const STUDY_ENV: &str = "DRIFT_STUDY_NEIGHBOUR";

/// The gate's readings for every mined proposal, for a leave-one-out evaluation on
/// labelled outliers (eval/study/neighbour.mjs): per outlier, whether the gate may hold it
/// back at all ([`may_hold_back`]), its nearest holder and nearest exempt member with
/// their distances, and its distance to every other outlier (`pair`, in outlier order),
/// so a reader can treat other outliers as a reviewer's exceptions. The same signature,
/// distance and guard `drift check` uses; holders are the role's members, not outliers
/// and not exempt, that the rule is about and that hold it.
pub fn study(
    repo: &RepoFacts,
    mined: &crate::mine::Mined,
    shown: &BTreeSet<&str>,
) -> serde_json::Value {
    use serde_json::json;
    let all = crate::roles::units(repo, &mined.kinds);
    let ctx = RepoContext::new(repo, &all);
    let consumers = Consumers::learn(repo);
    let by_key: BTreeMap<String, usize> =
        all.iter().enumerate().map(|(i, u)| (u.key(), i)).collect();
    let mut cards = Vec::new();
    for c in &mined.candidates {
        if c.rule.is_wiring() {
            continue;
        }
        let excluded = rule_modules(&c.rule);
        let sig = |i: usize| signature(&all[i], &consumers, &excluded);
        let outliers: Vec<(String, Option<usize>)> = c
            .outliers
            .iter()
            .map(|o| {
                let k = format!("{}#{}", o.path, o.symbol);
                let i = by_key.get(&k).copied();
                (k, i)
            })
            .collect();
        let exempt: Vec<(String, usize)> = c
            .exempt
            .iter()
            .filter_map(|e| {
                by_key
                    .get(&format!("{}#{}", e.path, e.symbol))
                    .map(|&i| (e.code.clone(), i))
            })
            .collect();
        let out_set: BTreeSet<usize> = outliers.iter().filter_map(|(_, i)| *i).collect();
        let ex_set: BTreeSet<usize> = exempt.iter().map(|(_, i)| *i).collect();
        let holders: Vec<usize> = all
            .iter()
            .enumerate()
            .filter(|(i, u)| {
                !out_set.contains(i)
                    && !ex_set.contains(i)
                    && u.in_role(&c.role)
                    && c.rule.applies_in(Some(&c.role), &u.view, &ctx)
                    && c.rule.holds_in(Some(&c.role), &u.view, &ctx)
            })
            .map(|(i, _)| i)
            .collect();
        let hsigs: Vec<Signature> = holders.iter().map(|&i| sig(i)).collect();
        let esigs: Vec<Signature> = exempt.iter().map(|&(_, i)| sig(i)).collect();
        let osigs: Vec<Option<Signature>> = outliers.iter().map(|(_, i)| i.map(sig)).collect();
        let mut rows = Vec::new();
        for (k, (key, i)) in outliers.iter().enumerate() {
            let (Some(i), Some(me)) = (*i, &osigs[k]) else {
                rows.push(json!({ "member": key, "found": false }));
                continue;
            };
            let h = nearest(me, &hsigs);
            let e = nearest(me, &esigs);
            let pair: Vec<Option<f64>> = osigs
                .iter()
                .enumerate()
                .map(|(j, s)| {
                    if j == k {
                        None
                    } else {
                        s.as_ref().map(|s| distance(me, s))
                    }
                })
                .collect();
            rows.push(json!({
                "member": key,
                "found": true,
                "may_hold_back": may_hold_back(&c.rule, &all[i].view, &ctx),
                "holder": h.map(|(j, d)| json!({ "member": all[holders[j]].key(), "distance": d })),
                "exempt": e.map(|(j, d)| json!({ "member": all[exempt[j].1].key(), "code": exempt[j].0, "distance": d })),
                "pair": pair,
            }));
        }
        cards.push(json!({
            "id": c.id,
            "shown": shown.contains(c.id.as_str()),
            "tier": c.tier(),
            "rule_kind": crate::tier::rule_kind(&c.rule),
            "holders": holders.len(),
            "exempt": exempt.len(),
            "outliers": rows,
        }));
    }
    json!({ "kind": "drift-neighbour-study", "cards": cards })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(xs: &[&str]) -> BTreeSet<String> {
        xs.iter().map(|x| x.to_string()).collect()
    }

    fn sig(imports: &[&str], consumers: &[&str]) -> Signature {
        Signature {
            imports: set(imports),
            export: set(&["export:named", "entry:-", "kind:Function"]),
            consumers: set(consumers),
            roles: set(&["r"]),
        }
    }

    #[test]
    fn distance_is_a_mean_of_jaccard_distances() {
        let a = sig(&["x", "y"], &[]);
        assert_eq!(distance(&a, &a), 0.0);
        let b = sig(&["x"], &[]);
        // imports 1 - 1/2, the rest equal or both empty.
        assert!((distance(&a, &b) - 0.125).abs() < 1e-12);
        let c = sig(&["z"], &["c"]);
        assert!((distance(&a, &c) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn held_back_only_when_strictly_nearer_the_set_apart() {
        assert!(holds_back(Some(0.4), Some(0.1)));
        assert!(!holds_back(Some(0.1), Some(0.4)));
        assert!(!holds_back(Some(0.3), Some(0.3)), "a tie warns");
        assert!(!holds_back(Some(0.3), None), "nobody set apart: warn");
        assert!(!holds_back(None, Some(0.0)), "no holder: warn");
    }

    #[test]
    fn nearest_takes_the_first_on_a_tie() {
        let a = sig(&["x"], &[]);
        let pool = [sig(&["y"], &[]), sig(&["x"], &[]), sig(&["x"], &[])];
        assert_eq!(nearest(&a, &pool), Some((1, 0.0)));
        assert_eq!(nearest(&a, &[] as &[Signature]), None);
    }

    #[test]
    fn the_rules_own_modules_are_not_in_the_signature() {
        let r: Rule = serde_json::from_str(
            r#"{"type":"wrapped_by","kind":"call","any_of":["lib/auth.ts#withAuth"]}"#,
        )
        .unwrap();
        assert_eq!(rule_modules(&r), vec!["lib/auth.ts".to_string()]);
        let l: Rule =
            serde_json::from_str(r#"{"type":"avoids","signal":"import:packages/db"}"#).unwrap();
        let ex = rule_modules(&l);
        assert!(named_by("packages/db/src/index.ts", &ex));
        assert!(!named_by("packages/dbx/index.ts", &ex));
    }
}
