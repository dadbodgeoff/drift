//! The show policy: which suggestion-tier cards Drift shows at all (eval/study/PLAN-R10.md
//! §4, WS-B).
//!
//! Every WRONG card shown costs trust, and the dev labels say where they come from: cards
//! with several outliers and rule families whose accept does not hold across repos. So a
//! suggestion is shown only when
//!
//! - it has at most [`Table::max_outliers`] outliers (1; `total - holders`, as the review
//!   order counts them, [`crate::rank::ReviewKey`]), and
//! - its rule family is admitted for its language by the leave-one-repo-out family table:
//!   with any one dev repo's cards left out, the family's suggestion-tier accept on the
//!   other dev repos meets the table's bar (60% of at least 5 labelled cards), and
//! - its family is not hidden outright for its language ([`Table::hidden`]: call order in
//!   both languages, PLAN-R10 I1; TypeScript rendered components and calls, Python package
//!   and repo facts, I2).
//!
//! The default tier is not affected. A card the policy hides is gone, not moved behind a
//! flag (PLAN-R10 §6): mining does not propose it ([`crate::mine::mine`]), so `census`
//! (`--all` included), `init` and the Studio's census never list it, and a proposal of
//! it that an older Drift wrote to `.drift/conventions.yaml` is dropped when the file is
//! read ([`crate::policy::ConventionsFile::load`]), so `check`, the hooks, MCP, PR mode,
//! SARIF, the AGENTS.md export and `drift review` never see it either.
//!
//! The policy protects agents, not the people reviewing: mining keeps what it hides aside,
//! with why ([`Withheld`], [`crate::mine::Mined::withheld`]). `init`, `census` (a new
//! `withheld` field in its JSON) and `review` count it by language, family and reason, and
//! `drift review --hidden` lists it for people. What is hidden is a convention for no
//! one; the card of a file (`drift card`, MCP `drift_card`) states the strong regularities
//! of the file's roles as facts about the code, not rules, whether or not their cards are
//! hidden ([`crate::card::regularities`]). A person may promote a withheld card
//! with the review answers: it is then a person's decision in `.drift/conventions.yaml`
//! (`promoted_from_hidden: true`) and, like any accepted convention, is kept and follows
//! the normal tier and agent rules ([`crate::admission`]).
//!
//! What a person decided stays: a convention a person accepted, rejected or chose to show
//! to agents is the team's, and is kept (and checked) whatever its family; hysteresis keeps
//! an accepted convention in `census` and `init` as before. The experimental wiring rules
//! (`experimental: [wiring]`, off by default) are not mined here and are not affected.
//!
//! The table is data: `data/show-policy.json`, generated from a dev label run by
//! `node eval/study/show-policy.mjs --run eval/study/runs/<run>` (it records the run and the
//! sha256 of every queue and label file it read; `eval/study/show-policy.test.mjs` checks
//! the committed table is what its run gives). It is frozen in the binary: a new table
//! comes only with a new Drift, regenerated from a newer dev run in a PR that reports the
//! census before and after. Its `schema` is the format this module reads.
//!
//! [STRICT] Anything ambiguous shows no suggestion: a table that is missing, does not
//! parse, is of another schema or has no valid bar; a rule kind the table does not map; a
//! family with no entry for the language. A family is admitted only when the table says so
//! **and** its per-repo counts meet the bar with every single repo left out (recomputed
//! here), so an edited `admitted` cannot admit a family below it.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use drift_core::ingest::Lang;
use serde::Deserialize;

use crate::mine::{Candidate, Evidence, Rule};
use crate::policy::{Convention, Status};
use crate::tier::{Tier, language_code, rule_kind};

/// The committed table.
pub const TABLE_JSON: &str = include_str!("../data/show-policy.json");

/// The committed table's file.
pub const TABLE_FILE: &str = "crates/drift-mine/data/show-policy.json";

/// The format of the table this module reads.
pub const SCHEMA: u32 = 1;

/// Debug builds only: set to `1`, the policy is not applied, so tests of `check`, the hooks
/// and the other surfaces can set up conventions of any family with `drift init` as before.
/// Release builds (every binary Drift ships, and the study's census) do not read it: there
/// is no way to show a hidden card to agents [STRICT] but a person promoting it
/// (`drift review --hidden --answer`).
pub const TEST_UNSHOWN_ENV: &str = "DRIFT_TEST_UNSHOWN";

/// Whether the policy applies: always in a release build; in a debug build unless
/// [`TEST_UNSHOWN_ENV`] is `1`.
pub fn enforced() -> bool {
    #[cfg(debug_assertions)]
    if std::env::var_os(TEST_UNSHOWN_ENV).is_some_and(|v| v == "1") {
        return false;
    }
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct Table {
    pub schema: u32,
    pub source: Source,
    pub bar: Bar,
    /// Most outliers a shown suggestion may have.
    pub max_outliers: usize,
    /// Language code (`ts`, `py`) -> families never shown in that language.
    pub hidden: BTreeMap<String, Vec<String>>,
    /// Rule kind -> study family (`null`: no family, never shown).
    pub rule_kinds: BTreeMap<String, Option<String>>,
    /// Language code -> family -> counts.
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
    /// Share of labelled suggestion-tier cards accepted (`0.6`).
    pub min_accept: f64,
    /// Labelled suggestion-tier cards (`5`).
    pub min_cards: u32,
}

impl Bar {
    fn valid(&self) -> bool {
        self.min_accept.is_finite()
            && self.min_accept > 0.0
            && self.min_accept <= 1.0
            && self.min_cards >= 1
    }

    /// Whether `accepted` of `n` meets it, compared in hundredths as integers (no float
    /// rounding at the edge).
    pub fn met(&self, accepted: u32, n: u32) -> bool {
        let pct = (self.min_accept * 100.0).round() as u64;
        accepted <= n && n >= self.min_cards && u64::from(accepted) * 100 >= pct * u64::from(n)
    }
}

/// Accepted of labelled suggestion-tier cards.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Counts {
    pub accepted: u32,
    pub n: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FamilyRecord {
    pub accepted: u32,
    pub n: u32,
    pub admitted: bool,
    /// Dev repo -> its cards of the family.
    pub repos: BTreeMap<String, Counts>,
}

impl FamilyRecord {
    /// Whether the family meets `bar` with every single repo left out: at least 2 repos,
    /// per-repo counts that add up to the totals, and each remainder at the bar.
    pub fn loro_met(&self, bar: &Bar) -> bool {
        let (a, n) = self.repos.values().fold((0u64, 0u64), |(a, n), c| {
            (a + u64::from(c.accepted), n + u64::from(c.n))
        });
        if self.repos.len() < 2
            || a != u64::from(self.accepted)
            || n != u64::from(self.n)
            || self.repos.values().any(|c| c.accepted > c.n)
        {
            return false;
        }
        self.repos
            .values()
            .all(|c| bar.met(self.accepted - c.accepted, self.n - c.n))
    }
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
        .filter(|t| t.schema == SCHEMA && t.bar.valid())
}

impl Table {
    /// The study family of `rule` in this table, if it has one.
    pub fn family(&self, rule: &Rule) -> Option<&str> {
        self.rule_kinds.get(rule_kind(rule))?.as_deref()
    }

    /// Whether suggestions of `family` are shown in `lang`: not hidden, admitted, and at
    /// the bar with any one repo left out.
    pub fn admits(&self, family: &str, lang: Lang) -> bool {
        let code = language_code(lang);
        if self
            .hidden
            .get(code)
            .is_some_and(|h| h.iter().any(|f| f == family))
        {
            return false;
        }
        self.languages
            .get(code)
            .and_then(|fams| fams.get(family))
            .is_some_and(|r| r.admitted && r.loro_met(&self.bar))
    }

    /// Whether a suggestion with this rule, language and number of outliers is shown.
    pub fn shows(&self, rule: &Rule, lang: Lang, outliers: usize) -> bool {
        outliers <= self.max_outliers && self.family(rule).is_some_and(|f| self.admits(f, lang))
    }
}

/// Whether a card of this rule, tier and language with `outliers` outliers is shown, by
/// `table`: the default tier always; a suggestion when the table shows it, never without
/// a table.
pub fn shown_by(
    table: Option<&Table>,
    rule: &Rule,
    tier: Tier,
    lang: Lang,
    outliers: usize,
) -> bool {
    tier == Tier::Default || table.is_some_and(|t| t.shows(rule, lang, outliers))
}

/// [`shown_by`] on the committed table.
pub fn shown(rule: &Rule, tier: Tier, lang: Lang, outliers: usize) -> bool {
    shown_by(table(), rule, tier, lang, outliers)
}

/// A card's outliers: the members its rule is about that do not follow it.
pub fn outliers(evidence: &Evidence) -> usize {
    evidence.total.saturating_sub(evidence.holders)
}

/// Whether mining proposes `c` ([`shown`]).
pub fn candidate_shown(c: &Candidate) -> bool {
    shown(&c.rule, c.tier(), c.language(), outliers(&c.evidence))
}

/// Whether a convention read from `.drift/conventions.yaml` stays in the policy: one a
/// person decided (accepted, rejected, `agents: show`) or a wiring rule always; a proposal
/// when the policy shows it ([`shown`]).
pub fn convention_kept(c: &Convention) -> bool {
    !enforced()
        || c.status != Status::Proposed
        || c.agents.is_some()
        || c.rule.is_wiring()
        || shown(&c.rule, c.tier(), c.language(), outliers(&c.evidence))
}

/// Why mining withheld a card it found (round 11, surface11): the show policy's reason, or
/// Python proposals being off (decision D13-py). A withheld card is not proposed and never
/// reaches `check`, agents, hooks, MCP, the AGENTS.md export or SARIF; `drift init`,
/// `census` and `review` count it, and `drift review --hidden` lists it for people, who
/// may promote it (an accepted convention marked `promoted_from_hidden`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Withheld {
    /// No valid show table in this build: no suggestion is shown [STRICT].
    NoTable,
    /// The table maps the rule kind to no family.
    NoFamily,
    /// The family is never shown in this language ([`Table::hidden`]).
    FamilyHidden,
    /// The family's leave-one-repo-out accept is below the bar for this language.
    FamilyNotAdmitted,
    /// More outliers than [`Table::max_outliers`].
    TooManyOutliers,
    /// A Python card while Python proposals are off (decision D13-py).
    PythonOff,
}

impl Withheld {
    /// The reason's code, as `census --json` `withheld.by[].reason` gives it.
    pub fn code(self) -> &'static str {
        match self {
            Withheld::NoTable => "no_table",
            Withheld::NoFamily => "no_family",
            Withheld::FamilyHidden => "family_hidden",
            Withheld::FamilyNotAdmitted => "family_not_admitted",
            Withheld::TooManyOutliers => "too_many_outliers",
            Withheld::PythonOff => "python_off",
        }
    }

    /// The reason in words, for the text views.
    pub fn text(self) -> String {
        match self {
            Withheld::NoTable => "no show table in this build".to_string(),
            Withheld::NoFamily => "its rule kind has no family in the show table".to_string(),
            Withheld::FamilyHidden => "family never shown in this language".to_string(),
            Withheld::FamilyNotAdmitted => {
                "family not admitted (below the show bar on the dev labels)".to_string()
            }
            Withheld::TooManyOutliers => format!(
                "too many outliers (more than {})",
                table().map_or(1, |t| t.max_outliers)
            ),
            Withheld::PythonOff => "Python proposals off".to_string(),
        }
    }
}

/// Why `table` hides a card of this rule, tier and language with `outliers` outliers;
/// `None` exactly when [`shown_by`] shows it. A family reason comes before the outliers.
pub fn withheld_by(
    table: Option<&Table>,
    rule: &Rule,
    tier: Tier,
    lang: Lang,
    outliers: usize,
) -> Option<Withheld> {
    if tier == Tier::Default {
        return None;
    }
    let Some(t) = table else {
        return Some(Withheld::NoTable);
    };
    let Some(family) = t.family(rule) else {
        return Some(Withheld::NoFamily);
    };
    let code = language_code(lang);
    if t.hidden
        .get(code)
        .is_some_and(|h| h.iter().any(|f| f == family))
    {
        return Some(Withheld::FamilyHidden);
    }
    if !t.admits(family, lang) {
        return Some(Withheld::FamilyNotAdmitted);
    }
    (outliers > t.max_outliers).then_some(Withheld::TooManyOutliers)
}

/// [`withheld_by`] on the committed table, for a mined card.
pub fn candidate_withheld(c: &Candidate) -> Option<Withheld> {
    withheld_by(
        table(),
        &c.rule,
        c.tier(),
        c.language(),
        outliers(&c.evidence),
    )
}

/// The family a withheld card is counted under: the show table's family of its rule, or
/// its rule kind when the table maps it to none.
pub fn family_name(rule: &Rule) -> String {
    table()
        .and_then(|t| t.family(rule))
        .map_or_else(|| rule_kind(rule).to_string(), str::to_string)
}

/// Where the policy comes from, for `census --json` (`show_policy`).
pub fn describe() -> serde_json::Value {
    match table() {
        None => serde_json::Value::Null,
        Some(t) => serde_json::json!({
            "file": TABLE_FILE,
            "schema": t.schema,
            "run": t.source.run,
            "date": t.source.date,
            "min_accept": t.bar.min_accept,
            "min_cards": t.bar.min_cards,
            "max_outliers": t.max_outliers,
            "admitted": t.languages.iter().map(|(lang, fams)| {
                let l = if lang == "py" { Lang::Python } else { Lang::TypeScript };
                (lang.clone(), fams.keys().filter(|f| t.admits(f, l)).cloned().collect::<Vec<_>>())
            }).collect::<BTreeMap<_, _>>(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{AgentsChoice, Mode};
    use crate::roles::RoleSelector;
    use drift_core::{SymbolKind, WrapKind};

    fn repo_file(rel: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(rel);
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("reading {}: {e}", p.display()))
    }

    /// A table with TS naming at `repos` (accepted, n per repo), marked `admitted`.
    fn table_with(repos: &[(u32, u32)], admitted: bool) -> Table {
        let (a, n) = repos.iter().fold((0, 0), |(a, n), (x, y)| (a + x, n + y));
        let rs: Vec<String> = repos
            .iter()
            .enumerate()
            .map(|(i, (x, y))| format!(r#""r{i}":{{"accepted":{x},"n":{y}}}"#))
            .collect();
        parse(&format!(
            r#"{{"schema":1,"source":{{"run":"eval/study/runs/dev-x-2026-01-01","date":"2026-01-01"}},
               "bar":{{"min_accept":0.6,"min_cards":5}},"max_outliers":1,
               "hidden":{{"ts":["ordering"],"py":["ordering"]}},
               "rule_kinds":{{"named":"naming","before":"ordering","calls":"calls","throws":null}},
               "languages":{{"ts":{{"naming":{{"accepted":{a},"n":{n},"admitted":{admitted},"repos":{{{}}}}},
                                     "ordering":{{"accepted":10,"n":10,"admitted":true,
                                       "repos":{{"a":{{"accepted":5,"n":5}},"b":{{"accepted":5,"n":5}}}}}}}}}}}}"#,
            rs.join(",")
        ))
        .unwrap()
    }

    fn naming() -> Rule {
        Rule::Named {
            pattern: "*Service".into(),
        }
    }

    fn order() -> Rule {
        Rule::Before {
            first: "a".into(),
            then: "b".into(),
        }
    }

    const STRONG: &[(u32, u32)] = &[(5, 5), (5, 5), (5, 5)];

    #[test]
    fn a_suggestion_needs_at_most_one_outlier_and_an_admitted_family() {
        let t = table_with(STRONG, true);
        let ts = Lang::TypeScript;
        assert!(shown_by(Some(&t), &naming(), Tier::Suggestion, ts, 0));
        assert!(shown_by(Some(&t), &naming(), Tier::Suggestion, ts, 1));
        assert!(!shown_by(Some(&t), &naming(), Tier::Suggestion, ts, 2));
        // Admitted for TypeScript only: Python has no record.
        assert!(!shown_by(
            Some(&t),
            &naming(),
            Tier::Suggestion,
            Lang::Python,
            0
        ));
        // A kind the table maps to no family, or does not know.
        let throws = Rule::Throws { class: "E".into() };
        assert!(!shown_by(Some(&t), &throws, Tier::Suggestion, ts, 0));
        let calls = Rule::Calls { callee: "f".into() };
        assert!(!shown_by(Some(&t), &calls, Tier::Suggestion, ts, 0));
    }

    #[test]
    fn the_default_tier_is_never_affected() {
        let t = table_with(STRONG, false);
        let w = Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec!["withAuth".into()],
        };
        for table in [Some(&t), None] {
            assert!(shown_by(table, &w, Tier::Default, Lang::TypeScript, 40));
            assert!(shown_by(
                table,
                &order(),
                Tier::Default,
                Lang::TypeScript,
                3
            ));
        }
    }

    #[test]
    fn a_withheld_reason_is_given_exactly_when_a_card_is_not_shown() {
        let tables = [
            Some(table_with(STRONG, true)),
            Some(table_with(STRONG, false)),
            None,
        ];
        let rules = [
            naming(),
            order(),
            Rule::Throws { class: "E".into() },
            Rule::Calls { callee: "f".into() },
        ];
        for t in &tables {
            for rule in &rules {
                for tier in [Tier::Default, Tier::Suggestion] {
                    for lang in [Lang::TypeScript, Lang::Python] {
                        for n in 0..4 {
                            let shown = shown_by(t.as_ref(), rule, tier, lang, n);
                            let why = withheld_by(t.as_ref(), rule, tier, lang, n);
                            assert_eq!(why.is_none(), shown, "{rule:?} {tier:?} {lang:?} {n}");
                        }
                    }
                }
            }
        }
        let t = table_with(STRONG, true);
        let ts = Lang::TypeScript;
        let s = Tier::Suggestion;
        let why = |rule: &Rule, lang, n| withheld_by(Some(&t), rule, s, lang, n);
        assert_eq!(why(&naming(), ts, 2), Some(Withheld::TooManyOutliers));
        assert_eq!(why(&order(), ts, 0), Some(Withheld::FamilyHidden));
        assert_eq!(
            why(&naming(), Lang::Python, 0),
            Some(Withheld::FamilyNotAdmitted)
        );
        // A family reason comes before the outliers.
        assert_eq!(why(&order(), ts, 5), Some(Withheld::FamilyHidden));
        let throws = Rule::Throws { class: "E".into() };
        assert_eq!(why(&throws, ts, 0), Some(Withheld::NoFamily));
        assert_eq!(
            withheld_by(None, &naming(), s, ts, 0),
            Some(Withheld::NoTable)
        );
        assert_eq!(
            withheld_by(Some(&table_with(STRONG, false)), &naming(), s, ts, 0),
            Some(Withheld::FamilyNotAdmitted)
        );
    }

    #[test]
    fn hidden_families_are_hidden_whatever_the_counts() {
        // I1: call order is hidden although its record says admitted at 10 of 10.
        let t = table_with(STRONG, true);
        assert!(!t.admits("ordering", Lang::TypeScript));
        assert!(!shown_by(
            Some(&t),
            &order(),
            Tier::Suggestion,
            Lang::TypeScript,
            0
        ));
    }

    #[test]
    fn admission_is_the_minimum_over_left_out_repos() {
        // 12 of 17 (70.6%) pooled, but one repo carries it: without it, 4 of 9 (44%).
        let carried = table_with(&[(8, 8), (2, 5), (2, 4)], true);
        assert!(carried.bar.met(12, 17));
        assert!(!carried.admits("naming", Lang::TypeScript));
        // At the bar with any one repo left out: 60% of 5 exactly.
        let edge = table_with(&[(3, 5), (3, 5)], true);
        assert!(edge.admits("naming", Lang::TypeScript));
        let below = table_with(&[(3, 5), (2, 5)], true);
        assert!(!below.admits("naming", Lang::TypeScript));
        // One repo: nothing is left to judge it by.
        assert!(!table_with(&[(20, 20)], true).admits("naming", Lang::TypeScript));
        // Fewer than 5 cards left out of either repo.
        assert!(!table_with(&[(4, 4), (4, 4)], true).admits("naming", Lang::TypeScript));
    }

    #[test]
    fn strict_an_edited_table_cannot_admit_a_family() {
        // `admitted: false` is not overridden by good counts...
        assert!(!table_with(STRONG, false).admits("naming", Lang::TypeScript));
        // ...and `admitted: true` is not trusted over counts below the bar.
        assert!(!table_with(&[(1, 5), (1, 5)], true).admits("naming", Lang::TypeScript));
        // Per-repo counts that do not add up to the totals.
        let mut t = table_with(STRONG, true);
        t.languages
            .get_mut("ts")
            .unwrap()
            .get_mut("naming")
            .unwrap()
            .n = 14;
        assert!(!t.admits("naming", Lang::TypeScript));
        // No table, another schema, an invalid bar: no suggestion.
        assert!(!shown_by(
            None,
            &naming(),
            Tier::Suggestion,
            Lang::TypeScript,
            0
        ));
        let text = TABLE_JSON.replacen("\"schema\": 1", "\"schema\": 2", 1);
        assert!(parse(&text).is_none());
        let text = TABLE_JSON.replacen("\"min_accept\": 0.6", "\"min_accept\": 0", 1);
        assert!(parse(&text).is_none());
        assert!(parse("{").is_none());
    }

    fn conv(rule: Rule, status: Status, holders: usize, total: usize) -> Convention {
        Convention {
            id: "D-1".into(),
            status,
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
                holders,
                total,
                lower_bound: 0.8,
                lift: 3.0,
                split: vec![],
                role_members: None,
                python_members: None,
            },
            example: "src/a.ts#a".into(),
            selector_version: crate::policy::SELECTOR_VERSION,
            agents: None,
            exceptions: vec![],
            different_kind: vec![],
            promoted_from_hidden: false,
        }
    }

    #[test]
    fn a_hidden_proposal_is_dropped_and_a_person_decision_kept() {
        let calls = Rule::Calls {
            callee: "src/log.ts#log".into(),
        };
        // TypeScript calls are hidden (I2): a proposal of one is not kept...
        assert!(!convention_kept(&conv(
            calls.clone(),
            Status::Proposed,
            20,
            20
        )));
        // ...a person's decision is.
        assert!(convention_kept(&conv(
            calls.clone(),
            Status::Accepted,
            20,
            20
        )));
        assert!(convention_kept(&conv(
            calls.clone(),
            Status::Rejected,
            20,
            20
        )));
        let mut shown = conv(calls, Status::Proposed, 20, 20);
        shown.agents = Some(AgentsChoice::Show);
        assert!(convention_kept(&shown));
        // The committed table admits TS naming: one outlier is kept, two are not.
        assert!(table().unwrap().admits("naming", Lang::TypeScript));
        assert!(convention_kept(&conv(naming(), Status::Proposed, 19, 20)));
        assert!(!convention_kept(&conv(naming(), Status::Proposed, 18, 20)));
        // Experimental wiring rules are not the policy's.
        let wiring = Rule::MirrorsKeys {
            from: "a".into(),
            to: "b".into(),
        };
        assert!(convention_kept(&conv(wiring, Status::Proposed, 1, 20)));
    }

    /// The committed table parses, comes from a dev run, maps every rule kind the
    /// product emits as the W0 table does (one family mapping, `lib.mjs` `familyOf`),
    /// hides I1 and I2, and agrees with its own counts (`eval/study/show-policy.test.mjs`
    /// checks that it is what its run gives).
    #[test]
    fn committed_table_is_complete() {
        let t = table().expect("data/show-policy.json parses");
        assert!(
            t.source.run.starts_with("eval/study/runs/dev-"),
            "{}",
            t.source.run
        );
        // A blind dev pool's own run directory is `dev3-…`, `dev4-…`: never `dev-…`, so the prefix above
        // refuses it. Its labels reach the table only through a build-set relabel run, after its report.
        for bad in ["heldout", "holdout"] {
            assert!(!t.source.run.contains(bad), "{}", t.source.run);
        }
        assert!(t.source.date.is_some());
        assert_eq!(t.max_outliers, 1);
        assert_eq!((t.bar.min_accept, t.bar.min_cards), (0.6, 5));
        let w0 = crate::admission::table().expect("family-admission.json");
        assert_eq!(t.rule_kinds, w0.rule_kinds);
        let hidden = |l: &str| t.hidden.get(l).cloned().unwrap_or_default();
        assert_eq!(hidden("ts"), ["calls", "ordering", "renders"]);
        assert_eq!(hidden("py"), ["ordering", "repo"]);
        for (lang, fams) in &t.languages {
            assert!(["ts", "py"].contains(&lang.as_str()), "{lang}");
            let l = if lang == "py" {
                Lang::Python
            } else {
                Lang::TypeScript
            };
            for (f, r) in fams {
                let hide = hidden(lang).contains(f);
                assert_eq!(r.admitted, r.loro_met(&t.bar) && !hide, "{lang} {f}");
                assert_eq!(t.admits(f, l), r.admitted, "{lang} {f}");
            }
        }
        // As generated from relabel 6 (relabel 5's TypeScript part; the labelled mined
        // pool of the 50 Python build-set repos): TypeScript naming and control, Python
        // control, layering, naming and call wrappers.
        let admitted = |l: Lang, code: &str| -> Vec<&str> {
            t.languages[code]
                .keys()
                .filter(|f| t.admits(f, l))
                .map(String::as_str)
                .collect()
        };
        assert_eq!(admitted(Lang::TypeScript, "ts"), ["control", "naming"]);
        assert_eq!(
            admitted(Lang::Python, "py"),
            ["control", "layering", "naming", "wrapper"]
        );
        let _ = repo_file(TABLE_FILE);
    }
}
