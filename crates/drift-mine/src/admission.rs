//! Admission to agents: which conventions Drift shows to agents.
//!
//! A convention reaches an agent (the Claude Code hooks' priming and advice, the MCP
//! tools, `drift check`'s text report, `drift example`, the AGENTS.md export) only when
//! this module's [`Decision`] says so. Every other convention stays visible to people
//! (`drift census`, `drift init`, `drift review`, the Studio), marked "not shown to
//! agents" with the reason (eval/study/PLAN-ROUND8.md, W0).
//!
//! **The default tier is a candidate tier** (decision D13, eval/study/PLAN-R11.md §2,
//! option (d)). The default tier ([`crate::tier`], `eval/study/tier-d7.json`) is unchanged
//! and shown to people first, marked "block candidate: reaches agents once you accept
//! it" ([`Reason::Candidate`]); a default-tier convention reaches agents only once a person
//! accepts it (`drift review`, or the Studio, which runs it) or sets `agents: show`. A
//! mined proposal (`census`, `init`) is never shown to agents as a convention (the card of
//! a file states a strong one as a fact about the code, [`crate::card::regularities`]).
//! Blocking is unchanged: it
//! already needed an accept in block mode. [STRICT] Anything ambiguous is a candidate: a
//! status other than `accepted` (and a policy that cannot be read, which no surface
//! loads at all).
//!
//! A suggestion reaches an agent only when an [`Admission`] source admits it. The source
//! is pluggable: whatever it is, it produces one [`Decision`] per convention,
//! `{shown_to_agents, reason, source}` (`agents` in `census --json` and
//! `check --format json`). Today it is the rule-family table ([`Table`]): a family is
//! admitted, per language, when its suggestion-tier accept rate on the latest labelled
//! dev run meets the table's own bar (`bar.min_accept` of at least `bar.min_cards`
//! labelled cards: 85% of 10 as committed). The bar lives in the data file, not here.
//! A card-level score could later implement [`Admission`] instead. It is never asked
//! about the default tier.
//!
//! The table is `data/family-admission.json`, generated from a study run's
//! `metrics.json` by `node eval/study/family-admission.mjs --run eval/study/runs/<run>`
//! (it records the run and its date). Its `rule_kinds` maps each [`crate::tier::rule_kind`]
//! to the study's family (`eval/study/lib.mjs` `familyOf`), so this crate keeps no
//! mapping of its own.
//!
//! A person overrides any source per repository: `agents: show` on a convention in
//! `.drift/conventions.yaml` (`drift review --show-to-agents <id>`, or `a` in interactive
//! review) shows it to agents; a suggestion a person forced to block is shown too (it
//! blocks the agent's turn). Accepting a suggestion alone does not: a team may accept
//! every proposal at once, and the track record is what says whether an agent should act
//! on it.
//!
//! [STRICT] Anything ambiguous is not shown: a rule kind the table does not map, a family
//! with no labelled cards in the language, a table that is missing, does not parse or has
//! no valid bar. A family is admitted only when the table says so **and** its counts meet
//! the table's bar, so an edited `admitted` cannot admit a family below it.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use drift_core::ingest::Lang;
use serde::{Deserialize, Serialize};

use crate::mine::Rule;
use crate::policy::{AgentsChoice, Convention, Status};
use crate::tier::{Tier, language_code, rule_kind};

/// The committed table.
pub const TABLE_JSON: &str = include_str!("../data/family-admission.json");

/// The committed family table's file, as [`Decision::source`] names it.
pub const TABLE_FILE: &str = "crates/drift-mine/data/family-admission.json";

/// What decides whether a suggestion-tier rule is shown to agents. Called only for
/// suggestions: the default tier is a candidate tier, decided by a person's accept alone
/// ([`decide_convention`]), and a person's decision overrides any source.
pub trait Admission: Sync {
    fn decide(&self, rule: &Rule, lang: Lang) -> Decision;
    /// The decision for the suggestion-tier convention `id` with this rule: what
    /// [`Admission::decide`] says, unless the source judges cards rather than rule kinds
    /// (the agent verifier, [`crate::verify::WithVerifier`]). Never called for the
    /// default tier ([`decide_card`]).
    fn decide_card(&self, id: &str, rule: &Rule, lang: Lang) -> Decision {
        let _ = id;
        self.decide(rule, lang)
    }
    /// Where its decisions come from, for people and `census --json` (`agents.admission`).
    fn describe(&self) -> serde_json::Value;
}

#[derive(Debug, Clone, Deserialize)]
pub struct Table {
    pub schema: u32,
    pub source: Source,
    pub bar: Bar,
    /// Rule kind -> study family (`null`: no family, never admitted).
    pub rule_kinds: BTreeMap<String, Option<String>>,
    #[serde(default)]
    pub families: BTreeMap<String, FamilyName>,
    /// Language code (`ts`, `py`) -> family -> counts.
    pub languages: BTreeMap<String, BTreeMap<String, FamilyRecord>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Source {
    pub run: String,
    pub date: Option<String>,
}

/// The admission bar, as the table states it.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bar {
    /// Share of labelled suggestion-tier cards accepted (`0.85`).
    pub min_accept: f64,
    /// Labelled suggestion-tier cards of the family in the language (`10`).
    pub min_cards: u32,
}

impl Bar {
    fn valid(&self) -> bool {
        self.min_accept.is_finite()
            && self.min_accept > 0.0
            && self.min_accept <= 1.0
            && self.min_cards >= 1
    }

    /// Whether `accepted` of `n` meets it (the share compared in hundredths, as integers:
    /// no float rounding at the edge).
    pub fn met(&self, accepted: u32, n: u32) -> bool {
        let pct = (self.min_accept * 100.0).round() as u64;
        accepted <= n && n >= self.min_cards && u64::from(accepted) * 100 >= pct * u64::from(n)
    }

    /// `85% of 10`.
    pub fn text(&self) -> String {
        format!(
            "{}% of {}",
            (self.min_accept * 100.0).round() as u64,
            self.min_cards
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct FamilyName {
    pub name: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct FamilyRecord {
    pub accepted: u32,
    pub n: u32,
    pub admitted: bool,
}

/// The committed table, parsed once; `None` when it does not parse.
pub fn table() -> Option<&'static Table> {
    static T: OnceLock<Option<Table>> = OnceLock::new();
    T.get_or_init(|| parse(TABLE_JSON)).as_ref()
}

/// A table from its JSON; `None` when it does not parse, is of another schema or has no
/// valid bar.
pub fn parse(text: &str) -> Option<Table> {
    serde_json::from_str::<Table>(text)
        .ok()
        .filter(|t| t.schema == 1 && t.bar.valid())
}

/// No source: decides nothing is shown ([`Reason::NoTable`]).
pub struct Missing;

impl Admission for Missing {
    fn decide(&self, _: &Rule, _: Lang) -> Decision {
        Decision::new(false, Reason::NoTable, "none".into(), None, None)
    }
    fn describe(&self) -> serde_json::Value {
        serde_json::Value::Null
    }
}

/// The committed source: the family table, or [`Missing`] when it does not parse.
pub fn admission() -> &'static dyn Admission {
    match table() {
        Some(t) => t,
        None => &Missing,
    }
}

impl Table {
    fn source_text(&self) -> String {
        format!(
            "{TABLE_FILE} ({}, bar {})",
            self.source.run,
            self.bar.text()
        )
    }
}

impl Admission for Table {
    fn decide(&self, rule: &Rule, lang: Lang) -> Decision {
        let source = self.source_text();
        let Some(Some(family)) = self.rule_kinds.get(rule_kind(rule)) else {
            return Decision::new(false, Reason::UnknownFamily, source, None, None);
        };
        let rec = self
            .languages
            .get(language_code(lang))
            .and_then(|fams| fams.get(family))
            .copied();
        let fam = Some(family.clone());
        match rec {
            Some(r) if r.admitted && self.bar.met(r.accepted, r.n) => {
                Decision::new(true, Reason::Admitted, source, fam, rec)
            }
            _ => Decision::new(false, Reason::BelowBar, source, fam, rec),
        }
    }

    fn describe(&self) -> serde_json::Value {
        serde_json::json!({
            "kind": "family_table",
            "file": TABLE_FILE,
            "run": self.source.run,
            "date": self.source.date,
            "min_accept": self.bar.min_accept,
            "min_cards": self.bar.min_cards,
        })
    }
}

/// Why a convention is or is not shown to agents ([`Decision::reason`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum Reason {
    /// Shown: a default-tier convention a person accepted.
    DefaultTier,
    /// Not shown: a default-tier convention no person has accepted (a mined proposal, or a
    /// convention that is not `accepted`): a block candidate, which reaches agents once a
    /// person accepts it (decision D13).
    Candidate,
    /// Shown: the family is admitted for the language.
    Admitted,
    /// Shown: the host agent verified the card as it is now (`agents.verify: on`,
    /// [`crate::verify`]).
    Verified,
    /// Shown: a person chose it (`agents: show`).
    Person,
    /// Shown: a person forced a suggestion to block.
    Blocks,
    /// Not shown: the family is below the bar (or has no labelled cards in the language).
    BelowBar,
    /// Not shown: the rule kind maps to no family in the table.
    UnknownFamily,
    /// Not shown: no admission source (the table is missing or invalid).
    NoTable,
}

/// The per-convention decision record every [`Admission`] source produces: whether
/// agents are shown it, why, and where the decision comes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Decision {
    #[serde(rename = "shown_to_agents")]
    pub shown: bool,
    pub reason: Reason,
    /// What decided: `default tier`, `conventions.yaml agents: show`, `mode: block`, or the
    /// source with its run and bar (`crates/drift-mine/data/family-admission.json
    /// (eval/study/runs/dev-…, bar 85% of 10)`).
    pub source: String,
    /// The study family (`naming`), when the rule kind has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    /// Its suggestion-tier record in the convention's language (accepted of n labelled).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
    /// For people: `not shown to agents (family below admission bar: 56% of 37)`.
    pub text: String,
}

impl Decision {
    pub(crate) fn new(
        shown: bool,
        reason: Reason,
        source: String,
        family: Option<String>,
        rec: Option<FamilyRecord>,
    ) -> Self {
        let pct = |r: FamilyRecord| {
            // Floored, so a rate just under the bar never reads as the bar.
            (r.accepted * 100).checked_div(r.n).unwrap_or(0)
        };
        let text = match (reason, rec) {
            (Reason::DefaultTier, _) => "shown to agents (default tier)".to_string(),
            (Reason::Candidate, _) => format!("not shown to agents ({CANDIDATE_TEXT})"),
            (Reason::Admitted, Some(r)) => {
                format!("shown to agents (family admitted: {}% of {})", pct(r), r.n)
            }
            (Reason::Admitted, None) => "shown to agents (family admitted)".to_string(),
            (Reason::Verified, _) => "shown to agents (verified by agent)".to_string(),
            (Reason::Person, _) => {
                "shown to agents (a person chose to show it: `agents: show`)".to_string()
            }
            (Reason::Blocks, _) => "shown to agents (a person set it to block)".to_string(),
            (Reason::BelowBar, Some(r)) => format!(
                "not shown to agents (family below admission bar: {}% of {})",
                pct(r),
                r.n
            ),
            (Reason::BelowBar, None) => {
                "not shown to agents (family below admission bar: no labelled cards)".to_string()
            }
            (Reason::UnknownFamily, _) => {
                "not shown to agents (rule family not in the admission table)".to_string()
            }
            (Reason::NoTable, _) => "not shown to agents (no family admission table)".to_string(),
        };
        Self {
            shown,
            reason,
            source,
            accepted: rec.map(|r| r.accepted),
            n: rec.map(|r| r.n),
            family,
            text,
        }
    }
}

/// What a block candidate is told to people (decision D13): census, init, review and the
/// Studio mark every default-tier card no person has accepted with it.
pub const CANDIDATE_TEXT: &str = "block candidate: reaches agents once you accept it";

/// The decision for a default-tier convention no person has accepted.
fn candidate() -> Decision {
    Decision::new(
        false,
        Reason::Candidate,
        "default tier (block candidate)".into(),
        None,
        None,
    )
}

/// The decision for a rule of this tier and language, with no person's decision (a
/// census proposal): the default tier is a block candidate, never shown to agents as a
/// convention [STRICT]; a suggestion is what `adm` decides.
pub fn decide(adm: &dyn Admission, rule: &Rule, tier: Tier, lang: Lang) -> Decision {
    if tier == Tier::Default {
        return candidate();
    }
    adm.decide(rule, lang)
}

/// [`decide`] for the convention `id`: the default tier is a block candidate without
/// asking `adm` [STRICT] (no source, the agent verifier included, admits it); a suggestion
/// is what `adm` decides for that card ([`Admission::decide_card`]).
pub fn decide_card(adm: &dyn Admission, id: &str, rule: &Rule, tier: Tier, lang: Lang) -> Decision {
    if tier == Tier::Default {
        return decide(adm, rule, tier, lang);
    }
    adm.decide_card(id, rule, lang)
}

/// The decision for a policy convention. The default tier: shown once a person accepted
/// it (`status: accepted`), else a block candidate [STRICT: any other status]. Either
/// tier: shown when a person chose `agents: show`, or forced an accepted suggestion to
/// block; otherwise a suggestion is what `adm` decides ([`decide_card`]).
pub fn decide_convention(adm: &dyn Admission, c: &Convention) -> Decision {
    let d = if c.tier() == Tier::Default {
        if matches!(c.status, Status::Accepted) {
            Decision::new(
                true,
                Reason::DefaultTier,
                "default tier, accepted".into(),
                None,
                None,
            )
        } else {
            candidate()
        }
    } else {
        decide_card(adm, &c.id, &c.rule, c.tier(), c.language())
    };
    if d.shown {
        return d;
    }
    let keep = |reason, source: &str| Decision {
        shown: true,
        reason,
        source: source.to_string(),
        text: Decision::new(true, reason, String::new(), None, None).text,
        ..d.clone()
    };
    if c.agents == Some(AgentsChoice::Show) {
        keep(Reason::Person, "conventions.yaml agents: show")
    } else if c.status == Status::Accepted && crate::check::effective_mode(c) == "block" {
        keep(Reason::Blocks, "conventions.yaml mode: block")
    } else {
        d
    }
}

/// [`decide_convention`] on the committed source.
pub fn convention_view(c: &Convention) -> Decision {
    decide_convention(admission(), c)
}

/// [`decide`] on the committed source for a mined proposal (`census`, `init`): no person
/// has decided it yet.
pub fn candidate_view(c: &crate::mine::Candidate) -> Decision {
    decide(admission(), &c.rule, c.tier(), c.language())
}

/// What agents would be shown of `c` once accepted, without a person's `agents: show` or a
/// forced block: what `drift review --show-to-agents` needs no override for (an accepted
/// default-tier convention, a suggestion of an admitted family).
pub fn accepted_view(c: &Convention) -> Decision {
    let mut plain = c.clone();
    plain.status = Status::Accepted;
    plain.agents = None;
    plain.mode = crate::policy::Mode::Advise;
    convention_view(&plain)
}

/// Whether agents are shown this convention ([`convention_view`]).
pub fn shown_to_agents(c: &Convention) -> bool {
    convention_view(c).shown
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mine::Evidence;
    use crate::policy::Mode;
    use crate::roles::RoleSelector;
    use drift_core::{SymbolKind, WrapKind};

    fn repo_file(rel: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(rel);
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("reading {}: {e}", p.display()))
    }

    fn table_with(ts_naming: (u32, u32, bool)) -> Table {
        let (accepted, n, admitted) = ts_naming;
        parse(&format!(
            r#"{{"schema":1,"source":{{"run":"eval/study/runs/x-2026-01-01","date":"2026-01-01"}},
               "bar":{{"min_accept":0.85,"min_cards":10}},
               "rule_kinds":{{"named":"naming","calls":"calls","throws":null,"wrapped_by:decorator":"decorator"}},
               "languages":{{"ts":{{"naming":{{"accepted":{accepted},"n":{n},"admitted":{admitted}}},
                                     "decorator":{{"accepted":9,"n":10,"admitted":true}}}},
                             "py":{{"naming":{{"accepted":20,"n":20,"admitted":true}}}}}}}}"#
        ))
        .unwrap()
    }

    fn naming() -> Rule {
        Rule::Named {
            pattern: "*Service".into(),
        }
    }

    fn conv(rule: Rule, example: &str) -> Convention {
        Convention {
            id: "D-1".into(),
            status: Status::Accepted,
            mode: Mode::Advise,
            summary: String::new(),
            role: RoleSelector {
                package: String::new(),
                dir: "src".into(),
                file: "-".into(),
                entry: "-".into(),
                kind: SymbolKind::Function,
                variety: None,
                export_name: None,
                member_kind: None,
                shape: None,
                also: vec![],
            },
            rule,
            evidence: Evidence {
                holders: 20,
                total: 22,
                lower_bound: 0.8,
                lift: 2.0,
                split: vec![],
                role_members: None,
                python_members: None,
            },
            example: example.into(),
            selector_version: crate::policy::SELECTOR_VERSION,
            agents: None,
            exceptions: Vec::new(),
            different_kind: Vec::new(),
            promoted_from_hidden: false,
            promoted_from_practice: None,
            from_map: None,
            accepted_evidence: None,
        }
    }

    #[test]
    fn the_bar_is_85_percent_of_10() {
        let ts = Lang::TypeScript;
        let at = |k, n, ok| decide(&table_with((k, n, ok)), &naming(), Tier::Suggestion, ts);
        // 17 of 20 is 85%: admitted. 16 of 19 (84.2%) is not, and reads 84%, never 85%.
        assert!(at(17, 20, true).shown);
        let below = at(16, 19, false);
        assert!(!below.shown);
        assert_eq!(below.reason, Reason::BelowBar);
        assert_eq!(
            below.text,
            "not shown to agents (family below admission bar: 84% of 19)"
        );
        // 9 of 9 is 100% of too few cards.
        assert!(!at(9, 9, true).shown);
        // The table's verdict alone admits nothing: the bar is recomputed, and both must agree.
        assert!(!at(5, 10, true).shown);
        assert!(!at(17, 20, false).shown);
        assert!(!at(30, 20, true).shown);
    }

    #[test]
    fn per_language_and_the_default_tier_is_a_candidate() {
        let t = table_with((5, 30, false));
        assert!(!decide(&t, &naming(), Tier::Suggestion, Lang::TypeScript).shown);
        assert!(decide(&t, &naming(), Tier::Suggestion, Lang::Python).shown);
        // Default tier, no person's decision (a census proposal): a block candidate, with
        // or without a table, whatever the source would say.
        for adm in [&t as &dyn Admission, &Missing] {
            let d = decide(adm, &naming(), Tier::Default, Lang::TypeScript);
            assert_eq!((d.shown, d.reason), (false, Reason::Candidate));
            assert_eq!(
                d.text,
                "not shown to agents (block candidate: reaches agents once you accept it)"
            );
            let d = decide_card(adm, "D-1", &naming(), Tier::Default, Lang::TypeScript);
            assert_eq!((d.shown, d.reason), (false, Reason::Candidate));
        }
        assert_eq!(
            serde_json::to_value(candidate()).unwrap()["reason"],
            "candidate"
        );
        assert_eq!(admission().describe()["kind"], "family_table");
    }

    fn wrapper() -> Rule {
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec!["src/auth.ts#withAuth".into()],
        }
    }

    #[test]
    fn a_default_tier_convention_reaches_agents_only_once_accepted() {
        // A table that would admit everything: the default tier never asks it.
        let t = table_with((20, 20, true));
        let mut c = conv(wrapper(), "src/a.ts#handler");
        assert_eq!(c.tier(), Tier::Default);
        // Accepted, in either mode: shown.
        let v = decide_convention(&t, &c);
        assert_eq!((v.shown, v.reason), (true, Reason::DefaultTier));
        c.mode = Mode::Block;
        assert_eq!(decide_convention(&t, &c).reason, Reason::DefaultTier);
        // Proposed (also set to block) or rejected: a block candidate, with or without a table.
        for status in [Status::Proposed, Status::Rejected] {
            c.status = status;
            for adm in [&t as &dyn Admission, &Missing] {
                let v = decide_convention(adm, &c);
                assert_eq!(
                    (v.shown, v.reason),
                    (false, Reason::Candidate),
                    "{status:?}"
                );
            }
        }
        // A person's `agents: show` shows a proposed one.
        c.status = Status::Proposed;
        c.agents = Some(AgentsChoice::Show);
        let v = decide_convention(&t, &c);
        assert_eq!((v.shown, v.reason), (true, Reason::Person));
        // What `--show-to-agents` needs no override for: an accepted default-tier
        // convention; a suggestion of a family below the bar does need one.
        c.agents = None;
        assert!(accepted_view(&c).shown);
        assert!(!accepted_view(&conv(naming(), "src/a.ts#AService")).shown);
    }

    #[test]
    fn strict_ambiguity_is_not_shown() {
        let t = table_with((20, 20, true));
        // A kind mapped to null, and one the table does not list.
        let throws = Rule::Throws {
            class: "src/e.ts#E".into(),
        };
        let v = decide(&t, &throws, Tier::Suggestion, Lang::TypeScript);
        assert_eq!((v.shown, v.reason), (false, Reason::UnknownFamily));
        let has_test = Rule::HasTest;
        let v = decide(&t, &has_test, Tier::Suggestion, Lang::TypeScript);
        assert_eq!((v.shown, v.reason), (false, Reason::UnknownFamily));
        // A family with no cards in the language.
        let calls = Rule::Calls {
            callee: "src/a.ts#f".into(),
        };
        let v = decide(&t, &calls, Tier::Suggestion, Lang::TypeScript);
        assert_eq!((v.shown, v.reason), (false, Reason::BelowBar));
        assert_eq!(
            v.text,
            "not shown to agents (family below admission bar: no labelled cards)"
        );
        // No table, and a table that does not parse or is of another schema.
        let v = decide(&Missing, &naming(), Tier::Suggestion, Lang::TypeScript);
        assert_eq!((v.shown, v.reason), (false, Reason::NoTable));
        assert!(parse("{").is_none());
        assert!(parse(&TABLE_JSON.replacen("\"schema\": 1", "\"schema\": 2", 1)).is_none());
    }

    #[test]
    fn a_person_overrides_the_family() {
        let t = table_with((5, 30, false));
        let mut c = conv(naming(), "src/a.ts#AService");
        assert!(!decide_convention(&t, &c).shown);
        // Accepting alone does not show it; `agents: show` does, whatever the status.
        c.agents = Some(AgentsChoice::Show);
        let v = decide_convention(&t, &c);
        assert_eq!((v.shown, v.reason), (true, Reason::Person));
        assert_eq!(v.family.as_deref(), Some("naming"));
        c.status = Status::Proposed;
        assert!(decide_convention(&t, &c).shown);
        // Also without a table.
        assert!(decide_convention(&Missing, &c).shown);
        // A suggestion forced to block (a role large enough to block) is shown; one whose
        // role is too small advises, so the family decides.
        let mut b = conv(naming(), "src/a.ts#AService");
        b.mode = Mode::Block;
        let v = decide_convention(&t, &b);
        assert_eq!((v.shown, v.reason), (true, Reason::Blocks));
        b.status = Status::Proposed;
        assert!(!decide_convention(&t, &b).shown);
        b.status = Status::Accepted;
        b.evidence.total = 5;
        b.evidence.holders = 5;
        assert!(!decide_convention(&t, &b).shown);
    }

    #[test]
    fn a_python_convention_reads_the_python_row() {
        let t = table_with((5, 30, false));
        let c = conv(naming(), "app/views.py#AView");
        let v = decide_convention(&t, &c);
        assert_eq!((v.shown, v.reason), (true, Reason::Admitted));
        let d = conv(
            Rule::WrappedBy {
                kind: WrapKind::Decorator,
                any_of: vec!["src/a.ts#d".into()],
            },
            "src/a.ts#f",
        );
        // 9 of 10 in TypeScript: admitted.
        assert!(decide_convention(&t, &d).shown);
    }

    #[test]
    fn the_bar_is_the_tables() {
        // The same counts, another bar in the data file: 6 of 10 is admitted at 60% of 10.
        let t = parse(
            &serde_json::to_string(&serde_json::json!({
                "schema": 1,
                "source": {"run": "eval/study/runs/x-2026-01-01", "date": null},
                "bar": {"min_accept": 0.6, "min_cards": 10},
                "rule_kinds": {"named": "naming"},
                "languages": {"ts": {"naming": {"accepted": 6, "n": 10, "admitted": true}}}
            }))
            .unwrap(),
        )
        .unwrap();
        let d = decide(&t, &naming(), Tier::Suggestion, Lang::TypeScript);
        assert_eq!((d.shown, d.reason), (true, Reason::Admitted));
        assert!(
            d.source
                .ends_with("(eval/study/runs/x-2026-01-01, bar 60% of 10)"),
            "{}",
            d.source
        );
        // A bar that is missing or makes no sense: no table at all.
        for bar in [
            "",
            r#","bar":{"min_accept":0,"min_cards":10}"#,
            r#","bar":{"min_accept":1.5,"min_cards":10}"#,
            r#","bar":{"min_accept":0.85,"min_cards":0}"#,
        ] {
            let text = format!(
                r#"{{"schema":1,"source":{{"run":"r","date":null}}{bar},"rule_kinds":{{}},"languages":{{}}}}"#
            );
            assert!(parse(&text).is_none(), "{text}");
        }
        assert!(
            Bar {
                min_accept: 0.85,
                min_cards: 10
            }
            .met(17, 20)
        );
        assert!(
            !Bar {
                min_accept: 0.85,
                min_cards: 10
            }
            .met(16, 19)
        );
        assert!(
            Bar {
                min_accept: 0.75,
                min_cards: 10
            }
            .met(8, 10)
        );
        assert!(
            !Bar {
                min_accept: 0.65,
                min_cards: 10
            }
            .met(9, 9)
        );
    }

    /// Another source (a card-level score, say) plugs in: it gives the decision record for
    /// suggestions; the default tier (a block candidate) and a person's decision stay as they are.
    #[test]
    fn the_admission_source_is_pluggable() {
        struct Score(bool);
        impl Admission for Score {
            fn decide(&self, _: &Rule, _: Lang) -> Decision {
                Decision {
                    shown: self.0,
                    reason: if self.0 {
                        Reason::Admitted
                    } else {
                        Reason::BelowBar
                    },
                    source: "card score".into(),
                    family: None,
                    accepted: None,
                    n: None,
                    text: String::new(),
                }
            }
            fn describe(&self) -> serde_json::Value {
                serde_json::json!({"kind": "card_score"})
            }
        }
        let mut c = conv(naming(), "src/a.ts#AService");
        assert!(decide_convention(&Score(true), &c).shown);
        let d = decide_convention(&Score(false), &c);
        assert_eq!((d.shown, d.source.as_str()), (false, "card score"));
        c.agents = Some(AgentsChoice::Show);
        let d = decide_convention(&Score(false), &c);
        assert_eq!(
            (d.shown, d.reason, d.source.as_str()),
            (true, Reason::Person, "conventions.yaml agents: show")
        );
        // A source that would admit everything does not admit a block candidate.
        let d = decide(&Score(true), &naming(), Tier::Default, Lang::TypeScript);
        assert_eq!(
            (d.shown, d.reason, d.source.as_str()),
            (false, Reason::Candidate, "default tier (block candidate)")
        );
        // The record's JSON shape.
        let v = serde_json::to_value(decide_convention(
            &Score(false),
            &conv(naming(), "src/a.ts#A"),
        ))
        .unwrap();
        assert_eq!(v["shown_to_agents"], false);
        assert_eq!(v["reason"], "below_bar");
        assert_eq!(v["source"], "card score");
    }

    /// The committed table parses, comes from a dev run, maps every rule kind the product
    /// emits, and agrees with its own counts (`eval/study/family-admission.test.mjs`
    /// checks that it is what its run gives).
    #[test]
    fn committed_table_is_complete() {
        let t = table().expect("data/family-admission.json parses");
        assert!(
            t.source.run.starts_with("eval/study/runs/dev-"),
            "{}",
            t.source.run
        );
        assert!(!t.source.run.contains("heldout"));
        assert!(t.source.date.is_some());
        let kinds: Vec<String> =
            serde_json::from_str::<serde_json::Value>(&repo_file("eval/study/tier-cases.json"))
                .unwrap()["cases"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c["kind"].as_str().unwrap().to_string())
                .collect();
        for k in kinds
            .iter()
            .map(String::as_str)
            .chain(crate::tier::D5_DEFAULT_RULE_KINDS.iter().copied())
        {
            assert!(
                t.rule_kinds.contains_key(k),
                "{k} is not in the admission table"
            );
        }
        for (lang, fams) in &t.languages {
            assert!(["ts", "py"].contains(&lang.as_str()), "{lang}");
            for (f, r) in fams {
                assert!(t.families.contains_key(f), "{f}");
                assert_eq!(r.admitted, t.bar.met(r.accepted, r.n), "{lang} {f}");
            }
        }
        for f in t.rule_kinds.values().flatten() {
            assert!(t.families.contains_key(f), "{f}");
        }
    }

    #[test]
    fn admission_families_agree_with_the_one_family_mapping() {
        // rule-kind-family.json (rule kind -> Studio family; crate::rank::family reads it)
        // is the one mapping: the table's `families[f].studio` is derived from it
        // (eval/study/lib.mjs `studioFamilies()`), so a kind's Studio family is one of its
        // admission family's, and no Studio family belongs to two admission families.
        let t: serde_json::Value = serde_json::from_str(TABLE_JSON).unwrap();
        let studio: BTreeMap<String, String> = serde_json::from_str(&repo_file(
            "apps/studio/src/entities/convention/rule-kind-family.json",
        ))
        .unwrap();
        let mut owner: BTreeMap<&str, &str> = BTreeMap::new();
        for (kind, fam) in t["rule_kinds"].as_object().unwrap() {
            let name = studio
                .get(kind)
                .unwrap_or_else(|| panic!("{kind} is not in rule-kind-family.json"));
            let Some(fam) = fam.as_str() else { continue };
            let names: Vec<&str> = t["families"][fam]["studio"]
                .as_array()
                .unwrap_or_else(|| panic!("{fam} has no studio names"))
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect();
            assert!(
                names.contains(&name.as_str()),
                "{kind}: {name} not in {fam} {names:?}"
            );
            let prev = owner.insert(name.as_str(), fam);
            assert!(
                prev.is_none_or(|p| p == fam),
                "{name} is in {fam} and {prev:?}"
            );
        }
        for (fam, v) in t["families"].as_object().unwrap() {
            for n in v["studio"].as_array().unwrap() {
                assert_eq!(
                    owner.get(n.as_str().unwrap()),
                    Some(&fam.as_str()),
                    "{fam} {n}"
                );
            }
        }
    }
}
