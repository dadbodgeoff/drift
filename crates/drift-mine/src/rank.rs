//! The order, and default cap, of suggestion-tier conventions in human views (round 8, W4).
//!
//! People read every suggestion `drift init`, `drift review`, `drift census` and the Studio
//! show them, and about half of the suggestion tier is right (dev set, in-sample). So the
//! human views list the suggestions most likely to be right first, and show only the first
//! [`DEFAULT_SUGGESTION_CAP`] per repository unless asked for more (`--suggestions N`,
//! `--all`, or `suggestion_cap` in `.drift/conventions.yaml`).
//!
//! This is presentation only. It never deletes a convention, changes an id, a tier, a
//! status or a mode, and never changes what `check`, hooks, MCP or exports read: a hidden
//! suggestion is still in `conventions.yaml` and `census --json`, and is checked exactly as
//! before once accepted. Default-tier conventions are never capped and keep their order,
//! ahead of every suggestion.
//!
//! The order is [`ReviewKey`], read from the evidence alone: the higher Wilson lower bound
//! first, then fewer outliers (on the dev labels, TypeScript suggestions with 0 outliers
//! were accepted 84% of the time, 1: 68%, 2: 56%, 3 or more: 35%), then the higher lift,
//! then the convention id. No rule-family track record: ranked by the family rates of
//! the labelled dev run, the ranking only looked better on the cards the rates came from
//! (in-sample), and fell away when a repository was held out.
//!
//! [`family`] reads `rule-kind-family.json`, the table the Studio groups rules by, so the
//! product and the Studio have one family mapping.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::mine::{Candidate, Evidence, Rule};
use crate::policy::Convention;
use crate::tier::{Tier, rule_kind};

/// Suggestions shown per repository in human views when nothing else is asked for.
pub const DEFAULT_SUGGESTION_CAP: usize = 5;

/// The Studio's family table (`rule_kind` -> family): one mapping for both.
const RULE_KIND_FAMILY: &str =
    include_str!("../../../apps/studio/src/entities/convention/rule-kind-family.json");

/// How many suggestions a human view shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionCap {
    /// The first `n` by [`ReviewKey`].
    Top(usize),
    /// Every suggestion.
    All,
}

impl Default for SuggestionCap {
    fn default() -> Self {
        Self::Top(DEFAULT_SUGGESTION_CAP)
    }
}

impl SuggestionCap {
    /// The number shown, `None` for all.
    pub fn limit(self) -> Option<usize> {
        match self {
            Self::Top(n) => Some(n),
            Self::All => None,
        }
    }
}

/// `suggestion_cap: 5` or `suggestion_cap: all` in `conventions.yaml`.
impl Serialize for SuggestionCap {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Top(n) => s.serialize_u64(*n as u64),
            Self::All => s.serialize_str("all"),
        }
    }
}

impl<'de> Deserialize<'de> for SuggestionCap {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            N(u64),
            S(String),
        }
        match Raw::deserialize(d)? {
            Raw::N(n) => Ok(Self::Top(usize::try_from(n).unwrap_or(usize::MAX))),
            Raw::S(s) if s.trim() == "all" => Ok(Self::All),
            Raw::S(s) => Err(serde::de::Error::custom(format!(
                "suggestion_cap must be a number or `all`, not `{s}`"
            ))),
        }
    }
}

/// Where the cap in effect came from, as `census --json` reports it (`suggestion_cap.from`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapSource {
    /// `--suggestions N`.
    Flag,
    /// `--all`.
    All,
    /// `suggestion_cap` in `.drift/conventions.yaml`.
    Policy,
    /// [`DEFAULT_SUGGESTION_CAP`].
    Default,
}

impl CapSource {
    pub fn name(self) -> &'static str {
        match self {
            Self::Flag => "flag",
            Self::All => "all",
            Self::Policy => "conventions.yaml",
            Self::Default => "default",
        }
    }
}

/// The cap in effect: `--all`, else `--suggestions N`, else the policy's, else the default.
pub fn resolve_cap(
    all: bool,
    flag: Option<usize>,
    policy: Option<SuggestionCap>,
) -> (SuggestionCap, CapSource) {
    if all {
        (SuggestionCap::All, CapSource::All)
    } else if let Some(n) = flag {
        (SuggestionCap::Top(n), CapSource::Flag)
    } else if let Some(c) = policy {
        (c, CapSource::Policy)
    } else {
        (SuggestionCap::default(), CapSource::Default)
    }
}

fn family_table() -> &'static BTreeMap<String, String> {
    static T: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    T.get_or_init(|| serde_json::from_str(RULE_KIND_FAMILY).expect("rule-kind-family.json"))
}

/// The family the Studio shows a rule under (`Call wrappers`, `Naming`, ...); `Other` for a
/// rule kind the table lacks (a test keeps it complete).
pub fn family(rule: &Rule) -> &'static str {
    family_table()
        .get(rule_kind(rule))
        .map_or("Other", String::as_str)
}

/// What a suggestion is listed by, best first ([`ReviewKey::cmp_best_first`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReviewKey {
    pub lower_bound: f64,
    /// Members the rule is about that do not follow it (`total - holders`).
    pub outliers: usize,
    pub lift: f64,
}

impl ReviewKey {
    pub fn of(evidence: &Evidence) -> Self {
        Self {
            lower_bound: evidence.lower_bound,
            outliers: evidence.total.saturating_sub(evidence.holders),
            lift: evidence.lift,
        }
    }

    /// Higher lower bound, then fewer outliers, then higher lift.
    pub fn cmp_best_first(&self, other: &Self) -> Ordering {
        other
            .lower_bound
            .total_cmp(&self.lower_bound)
            .then(self.outliers.cmp(&other.outliers))
            .then(other.lift.total_cmp(&self.lift))
    }
}

/// A mined candidate or a policy convention, as the human views rank them.
pub trait Rankable {
    fn rank_id(&self) -> &str;
    fn rank_tier(&self) -> Tier;
    fn rank_key(&self) -> ReviewKey;
}

macro_rules! rankable {
    ($t:ty) => {
        impl Rankable for $t {
            fn rank_id(&self) -> &str {
                &self.id
            }
            fn rank_tier(&self) -> Tier {
                self.tier()
            }
            fn rank_key(&self) -> ReviewKey {
                ReviewKey::of(&self.evidence)
            }
        }
    };
}

rankable!(Candidate);
rankable!(Convention);

impl<T: Rankable + ?Sized> Rankable for &T {
    fn rank_id(&self) -> &str {
        (**self).rank_id()
    }
    fn rank_tier(&self) -> Tier {
        (**self).rank_tier()
    }
    fn rank_key(&self) -> ReviewKey {
        (**self).rank_key()
    }
}

/// One item's place in a human view.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed<'a, T> {
    pub item: &'a T,
    /// 1-based position in the view: the default tier first, then suggestions best first.
    pub rank: usize,
    /// [`ReviewKey`], for suggestions only.
    pub key: Option<ReviewKey>,
    /// Shown by default: every default-tier item, and suggestions within the cap.
    pub shown: bool,
}

/// A human view's order: the default tier first, in the order given, then suggestions by
/// [`ReviewKey`] (best first, ties by id); suggestions past `cap` are not `shown`.
pub fn place<T: Rankable>(items: &[T], cap: SuggestionCap) -> Vec<Placed<'_, T>> {
    let mut out: Vec<Placed<'_, T>> = items
        .iter()
        .filter(|x| x.rank_tier() == Tier::Default)
        .map(|item| Placed {
            item,
            rank: 0,
            key: None,
            shown: true,
        })
        .collect();
    let mut sugg: Vec<(ReviewKey, &T)> = items
        .iter()
        .filter(|x| x.rank_tier() != Tier::Default)
        .map(|x| (x.rank_key(), x))
        .collect();
    sugg.sort_by(|a, b| {
        a.0.cmp_best_first(&b.0)
            .then_with(|| a.1.rank_id().cmp(b.1.rank_id()))
    });
    let limit = cap.limit().unwrap_or(usize::MAX);
    out.extend(sugg.into_iter().enumerate().map(|(i, (k, item))| Placed {
        item,
        rank: 0,
        key: Some(k),
        shown: i < limit,
    }));
    for (i, p) in out.iter_mut().enumerate() {
        p.rank = i + 1;
    }
    out
}

/// Counts of a placed view's suggestions: (all, shown).
pub fn suggestion_counts<T>(placed: &[Placed<'_, T>]) -> (usize, usize) {
    placed
        .iter()
        .filter(|p| p.key.is_some())
        .fold((0, 0), |(n, k), p| (n + 1, k + usize::from(p.shown)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::WrapKind;

    struct T(&'static str, Tier, f64);
    impl Rankable for T {
        fn rank_id(&self) -> &str {
            self.0
        }
        fn rank_tier(&self) -> Tier {
            self.1
        }
        fn rank_key(&self) -> ReviewKey {
            ReviewKey {
                lower_bound: self.2,
                outliers: 0,
                lift: 2.0,
            }
        }
    }

    fn ids<'a>(p: &[Placed<'a, T>], shown: bool) -> Vec<&'a str> {
        p.iter()
            .filter(|x| x.shown == shown)
            .map(|x| x.item.0)
            .collect()
    }

    #[test]
    fn default_tier_first_never_capped_and_in_given_order() {
        use Tier::*;
        let items = [
            T("D-000009", Suggestion, 0.1),
            T("D-00000b", Default, 0.0),
            T("D-000001", Suggestion, 0.9),
            T("D-00000a", Default, 0.0),
            T("D-000003", Suggestion, 0.5),
        ];
        let p = place(&items, SuggestionCap::Top(1));
        assert_eq!(ids(&p, true), ["D-00000b", "D-00000a", "D-000001"]);
        assert_eq!(ids(&p, false), ["D-000003", "D-000009"]);
        assert_eq!(
            p.iter().map(|x| x.rank).collect::<Vec<_>>(),
            [1, 2, 3, 4, 5]
        );
        assert_eq!(suggestion_counts(&p), (3, 1));
        // A cap of 0 still shows every default-tier item.
        let p = place(&items, SuggestionCap::Top(0));
        assert_eq!(ids(&p, true), ["D-00000b", "D-00000a"]);
        let p = place(&items, SuggestionCap::All);
        assert!(p.iter().all(|x| x.shown));
    }

    #[test]
    fn ties_break_by_id_whatever_the_input_order() {
        use Tier::*;
        let a = [
            T("D-bbbbbb", Suggestion, 0.5),
            T("D-aaaaaa", Suggestion, 0.5),
        ];
        let b = [
            T("D-aaaaaa", Suggestion, 0.5),
            T("D-bbbbbb", Suggestion, 0.5),
        ];
        for items in [&a[..], &b[..]] {
            let p = place(items, SuggestionCap::Top(1));
            assert_eq!(ids(&p, true), ["D-aaaaaa"]);
        }
    }

    fn ev(lb: f64, lift: f64, holders: usize, total: usize) -> Evidence {
        Evidence {
            holders,
            total,
            lower_bound: lb,
            lift,
            split: vec![],
            role_members: None,
            python_members: None,
        }
    }

    #[test]
    fn key_is_lower_bound_then_fewer_outliers_then_lift() {
        let order = |a: Evidence, b: Evidence| ReviewKey::of(&a).cmp_best_first(&ReviewKey::of(&b));
        use Ordering::*;
        assert_eq!(
            order(ev(0.9, 1.5, 28, 30), ev(0.8, 9.0, 30, 30)),
            Less,
            "lower bound first"
        );
        assert_eq!(
            order(ev(0.8, 1.5, 40, 40), ev(0.8, 9.0, 38, 40)),
            Less,
            "then fewer outliers"
        );
        assert_eq!(
            order(ev(0.8, 3.0, 39, 40), ev(0.8, 2.0, 39, 40)),
            Less,
            "then lift"
        );
        assert_eq!(order(ev(0.8, 3.0, 39, 40), ev(0.8, 3.0, 39, 40)), Equal);
        assert_eq!(ReviewKey::of(&ev(0.8, 3.0, 37, 40)).outliers, 3);
        // The rule family plays no part: the key is the evidence's.
        let named = Rule::Named {
            pattern: "*Service".into(),
        };
        let wrapper = Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec!["lib/a.ts#withAuth".into()],
        };
        assert_ne!(family(&named), family(&wrapper));
    }

    #[test]
    fn every_rule_kind_has_a_family_in_the_shared_table() {
        // The rule kinds tier.rs names; the Studio's coverage test checks the same table
        // against census's kinds.
        let src = include_str!("tier.rs");
        let body = &src[src.find("pub fn rule_kind").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let kinds: Vec<&str> = body
            .lines()
            .filter_map(|l| l.split_once("=> \"")?.1.split('"').next())
            .collect();
        assert!(kinds.len() >= 28, "{kinds:?}");
        for k in kinds {
            assert!(family_table().contains_key(k), "{k} has no family");
        }
    }

    #[test]
    fn cap_reads_number_or_all_and_flags_win() {
        let n: SuggestionCap = serde_json::from_str("3").unwrap();
        assert_eq!(n, SuggestionCap::Top(3));
        let all: SuggestionCap = serde_json::from_str("\"all\"").unwrap();
        assert_eq!(all, SuggestionCap::All);
        assert!(serde_json::from_str::<SuggestionCap>("\"some\"").is_err());
        assert_eq!(serde_json::to_string(&SuggestionCap::Top(7)).unwrap(), "7");
        let pol = Some(SuggestionCap::Top(2));
        assert_eq!(
            resolve_cap(false, None, None),
            (SuggestionCap::Top(5), CapSource::Default)
        );
        assert_eq!(
            resolve_cap(false, None, pol),
            (SuggestionCap::Top(2), CapSource::Policy)
        );
        assert_eq!(
            resolve_cap(false, Some(9), pol),
            (SuggestionCap::Top(9), CapSource::Flag)
        );
        assert_eq!(
            resolve_cap(true, Some(9), pol),
            (SuggestionCap::All, CapSource::All)
        );
    }
}
