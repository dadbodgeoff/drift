//! Role stability (round 9, D): hysteresis keeps a convention a person accepted where a
//! one-file change would have mining propose another one in its place (a parent role,
//! a child role, a variant set), and sibling cards that state the same rule merge into
//! one card whose evidence is counted on the union.

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{
    Candidate, MineOptions, Mined, Rule, convention_id, mine_before_show, mine_unshown as mine,
    wilson_lower_bound,
};

// The miner's hysteresis, before the show policy (`drift_mine::show`).
fn mine_with_kinds(r: &RepoFacts, o: &MineOptions, k: FileKinds) -> Mined {
    mine_before_show(r, o, k, &[])
}

fn mine_keeping(
    r: &RepoFacts,
    o: &MineOptions,
    k: FileKinds,
    accepted: &[(RoleSelector, Rule)],
) -> Mined {
    mine_before_show(r, o, k, accepted)
}
use drift_mine::policy::{ConventionsFile, Exception, Lock, Status};
use drift_mine::roles::{FileKinds, RoleSelector, role_covers_path};
use drift_mine::tier::Tier;

const BASE: &str = "lib/base.ts#Base";
const WRAP: &str = "lib/wrap.ts#withThing";

fn symbol(name: &str, kind: SymbolKind, wraps: &[(&str, WrapKind)]) -> Symbol {
    Symbol {
        name: name.into(),
        kind,
        exported_as: vec![name.into()],
        line: 3,
        wraps: wraps
            .iter()
            .map(|(w, k)| Wrap {
                wrapper: (*w).into(),
                kind: *k,
            })
            .collect(),
        ..Default::default()
    }
}

fn file(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn repo(mut files: Vec<FileFacts>) -> RepoFacts {
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// A class in its own file, extending [`BASE`] or not.
fn class(path: &str, name: &str, follows: bool) -> FileFacts {
    let wraps: &[(&str, WrapKind)] = if follows {
        &[(BASE, WrapKind::Extends)]
    } else {
        &[]
    };
    file(path, vec![symbol(name, SymbolKind::Class, wraps)])
}

/// `feat` classes under `src/feat/g<0..4>/` (all but `feat_out` extend [`BASE`]),
/// `other` classes under `src/other/` (all but `other_out` do), and 60 plain classes
/// under `lib/` for the baseline. `src/feat/**` (39 of 40) is clearly above `src/**`
/// (55 of 60), so mining proposes the child.
fn depth_files(feat: usize, feat_out: usize, other: usize, other_out: usize) -> Vec<FileFacts> {
    let mut files = Vec::new();
    for i in 0..feat {
        files.push(class(
            &format!("src/feat/g{}/f{i}.ts", i % 4),
            &format!("Feat{i}"),
            i >= feat_out,
        ));
    }
    for i in 0..other {
        files.push(class(
            &format!("src/other/o{i}.ts"),
            &format!("Other{i}"),
            i >= other_out,
        ));
    }
    for i in 0..60 {
        files.push(class(&format!("lib/l{i}.ts"), &format!("Lib{i}"), false));
    }
    files
}

fn extends_rule() -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![BASE.into()],
    }
}

fn opts() -> MineOptions {
    MineOptions { max_per_repo: 200 }
}

fn on_rule<'a>(cs: &'a [Candidate], rule: &Rule) -> Vec<&'a Candidate> {
    cs.iter().filter(|c| &c.rule == rule).collect()
}

fn dirs(cs: &[Candidate], rule: &Rule) -> Vec<String> {
    on_rule(cs, rule)
        .iter()
        .map(|c| c.role.dir.clone())
        .collect()
}

fn accept(policy: &mut ConventionsFile, id: &str) {
    policy.get_mut(id).unwrap().status = Status::Accepted;
}

/// The one-file change: a file with one more class in `src/feat/` that does not extend
/// the base. `src/feat/**` (39 of 41) is no longer clearly above `src/**` (55 of 61):
/// without a policy, mining now proposes the parent, a new id, in place of the child.
#[test]
fn a_one_file_change_does_not_replace_an_accepted_card() {
    let before = repo(depth_files(40, 1, 20, 4));
    let mined = mine(&before, &opts());
    assert_eq!(dirs(&mined.candidates, &extends_rule()), ["src/feat"]);
    let child = on_rule(&mined.candidates, &extends_rule())[0].id.clone();
    let mut policy = ConventionsFile::merge(None, "t", mined.kinds.clone(), &mined.candidates);
    accept(&mut policy, &child);

    let mut files = depth_files(40, 1, 20, 4);
    files.push(class("src/feat/g1/new.ts", "NewFeat", false));
    let after = repo(files);
    // Without the policy: the parent replaces the child.
    let fresh = mine_with_kinds(&after, &opts(), policy.file_kinds.clone());
    assert_eq!(dirs(&fresh.candidates, &extends_rule()), ["src"]);
    // With it: the accepted child stays, its evidence refreshed, and the parent that
    // would have replaced it is not proposed.
    let kept = mine_keeping(
        &after,
        &opts(),
        policy.file_kinds.clone(),
        &policy.accepted_rules(),
    );
    let ours = on_rule(&kept.candidates, &extends_rule());
    assert_eq!(ours.len(), 1, "{ours:?}");
    assert_eq!(ours[0].id, child);
    assert_eq!((ours[0].evidence.holders, ours[0].evidence.total), (39, 41));
    // Nothing else changes.
    let others = |cs: &[Candidate]| {
        cs.iter()
            .filter(|c| c.rule != extends_rule())
            .map(|c| c.id.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(others(&kept.candidates), others(&fresh.candidates));
    // `init` keeps the decision and proposes nothing new for the rule.
    let again = ConventionsFile::merge(Some(policy), "t", kept.kinds.clone(), &kept.candidates);
    let ids: Vec<&str> = again
        .conventions
        .iter()
        .filter(|c| c.rule == extends_rule())
        .map(|c| c.id.as_str())
        .collect();
    assert_eq!(ids, [child.as_str()]);
}

/// The other way: an accepted parent stays when one file makes a child clearly higher.
#[test]
fn an_accepted_parent_is_kept_over_a_child() {
    // `src/feat/**` 38 of 40 is not clearly above `src/**` 54 of 60.
    let before = repo(depth_files(40, 2, 20, 4));
    let mined = mine(&before, &opts());
    assert_eq!(dirs(&mined.candidates, &extends_rule()), ["src"]);
    let parent = on_rule(&mined.candidates, &extends_rule())[0].id.clone();
    let accepted = [(
        on_rule(&mined.candidates, &extends_rule())[0].role.clone(),
        extends_rule(),
    )];
    // One file: two more followers in `src/feat/` and one more outlier in `src/other/`.
    let mut files = depth_files(40, 2, 20, 4);
    files.push(file(
        "src/feat/g2/two.ts",
        vec![
            symbol("TwoA", SymbolKind::Class, &[(BASE, WrapKind::Extends)]),
            symbol("TwoB", SymbolKind::Class, &[(BASE, WrapKind::Extends)]),
        ],
    ));
    files.push(class("src/other/odd.ts", "Odd", false));
    let after = repo(files);
    let fresh = mine(&after, &opts());
    assert_eq!(dirs(&fresh.candidates, &extends_rule()), ["src/feat"]);
    let kept = mine_keeping(&after, &opts(), fresh.kinds.clone(), &accepted);
    let ours = on_rule(&kept.candidates, &extends_rule());
    assert_eq!(ours.len(), 1, "{ours:?}");
    assert_eq!(ours[0].id, parent);
}

/// [STRICT] Hysteresis keeps only what mining drafts on its own evidence: an accepted
/// convention whose lower bound fell below the bar is not kept.
#[test]
fn an_accepted_card_below_the_bar_is_not_kept() {
    let before = repo(depth_files(40, 1, 20, 4));
    let mined = mine(&before, &opts());
    let c = on_rule(&mined.candidates, &extends_rule())[0];
    let accepted = [(c.role.clone(), c.rule.clone())];
    // One file with 8 more outliers in `src/feat/`: 39 of 48, lower bound 0.68.
    let mut files = depth_files(40, 1, 20, 4);
    files.push(file(
        "src/feat/g0/many.ts",
        (0..8)
            .map(|i| symbol(&format!("Many{i}"), SymbolKind::Class, &[]))
            .collect(),
    ));
    let after = repo(files);
    assert!(wilson_lower_bound(39, 48) < drift_mine::mine::MIN_LOWER_BOUND);
    let kept = mine_keeping(&after, &opts(), mined.kinds.clone(), &accepted);
    assert!(
        kept.candidates.iter().all(|k| k.id != c.id),
        "{:?}",
        kept.candidates
    );
    // And mining is as without the policy.
    let fresh = mine_with_kinds(&after, &opts(), mined.kinds.clone());
    let ids = |cs: &[Candidate]| cs.iter().map(|c| c.id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&kept.candidates), ids(&fresh.candidates));
}

/// No accepted convention: hysteresis is no-op, so a first `init` is unaffected; and the
/// result depends on no order of the files or of the accepted list.
#[test]
fn mining_with_hysteresis_is_deterministic() {
    let r = repo(depth_files(40, 1, 20, 4));
    let plain = mine(&r, &opts());
    let none = mine_keeping(&r, &opts(), plain.kinds.clone(), &[]);
    assert_eq!(plain.candidates, none.candidates);

    let mut files = depth_files(40, 1, 20, 4);
    files.push(class("src/feat/g1/new.ts", "NewFeat", false));
    let mut accepted: Vec<(RoleSelector, Rule)> = plain
        .candidates
        .iter()
        .map(|c| (c.role.clone(), c.rule.clone()))
        .collect();
    let forward = mine_keeping(
        &repo(files.clone()),
        &opts(),
        plain.kinds.clone(),
        &accepted,
    );
    files.reverse();
    accepted.reverse();
    let mut backward_repo = RepoFacts {
        files,
        ..Default::default()
    };
    backward_repo.normalize();
    let backward = mine_keeping(&backward_repo, &opts(), plain.kinds.clone(), &accepted);
    assert_eq!(forward.candidates, backward.candidates);
    let again = mine_keeping(
        &repo_sorted(&backward_repo),
        &opts(),
        plain.kinds,
        &accepted,
    );
    assert_eq!(forward.candidates, again.candidates);
}

fn repo_sorted(r: &RepoFacts) -> RepoFacts {
    repo(r.files.clone())
}

/// A function in its own file, wrapped in [`WRAP`] or not.
fn function(path: &str, name: &str, follows: bool) -> FileFacts {
    let wraps: &[(&str, WrapKind)] = if follows {
        &[(WRAP, WrapKind::Call)]
    } else {
        &[]
    };
    file(path, vec![symbol(name, SymbolKind::Function, wraps)])
}

/// [STRICT] A default-tier proposal is never hidden for an accepted one: a call wrapper
/// on the parent (60 functions, default tier) stays beside the accepted child.
#[test]
fn a_default_tier_parent_is_not_hidden_for_an_accepted_child() {
    let files = |feat_out: usize| {
        let mut v = Vec::new();
        for i in 0..40 {
            v.push(function(
                &format!("src/feat/g{}/f{i}.ts", i % 4),
                &format!("feat{i}"),
                i >= feat_out,
            ));
        }
        for i in 0..20 {
            v.push(function(
                &format!("src/other/o{i}.ts"),
                &format!("other{i}"),
                i >= 4,
            ));
        }
        for i in 0..60 {
            v.push(function(&format!("lib/l{i}.ts"), &format!("lib{i}"), false));
        }
        v
    };
    let rule = Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: vec![WRAP.into()],
    };
    let mined = mine(&repo(files(1)), &opts());
    assert_eq!(dirs(&mined.candidates, &rule), ["src/feat"]);
    let child = on_rule(&mined.candidates, &rule)[0];
    let accepted = [(child.role.clone(), rule.clone())];
    let mut after = files(1);
    after.push(function("src/feat/g1/new.ts", "newFeat", false));
    let after = repo(after);
    let fresh = mine(&after, &opts());
    let parent = on_rule(&fresh.candidates, &rule)[0];
    assert_eq!(parent.role.dir, "src");
    assert_eq!(parent.tier(), Tier::Default);
    let kept = mine_keeping(&after, &opts(), fresh.kinds.clone(), &accepted);
    let mut got = dirs(&kept.candidates, &rule);
    got.sort();
    assert_eq!(got, ["src", "src/feat"]);
}

/// `src/a` and `src/b` follow the rule (39 of 40 and 29 of 30), `src/c` does not (none
/// of 30), so `src/**` is no convention and the two siblings state the same rule.
fn sibling_files(extra: &[FileFacts]) -> Vec<FileFacts> {
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(class(&format!("src/a/a{i}.ts"), &format!("A{i}"), i != 0));
    }
    for i in 0..30 {
        files.push(class(&format!("src/b/b{i}.ts"), &format!("B{i}"), i != 0));
    }
    for i in 0..30 {
        files.push(class(&format!("src/c/c{i}.ts"), &format!("C{i}"), false));
    }
    for i in 0..60 {
        files.push(class(&format!("lib/l{i}.ts"), &format!("Lib{i}"), false));
    }
    files.extend(extra.iter().cloned());
    files
}

fn part(dir: &str) -> RoleSelector {
    RoleSelector {
        package: String::new(),
        dir: dir.into(),
        file: "*".into(),
        entry: "-".into(),
        kind: SymbolKind::Class,
        variety: None,
        export_name: None,
        member_kind: None,
        shape: None,
        also: vec![],
    }
}

fn merged_role(dirs: &[&str]) -> RoleSelector {
    let mut r = part(dirs[0]);
    r.also = dirs[1..].iter().map(|d| part(d)).collect();
    r
}

#[test]
fn sibling_cards_that_state_the_same_rule_merge() {
    let r = repo(sibling_files(&[]));
    let mined = mine(&r, &opts());
    let ours = on_rule(&mined.candidates, &extends_rule());
    assert_eq!(ours.len(), 1, "{ours:?}");
    let c = ours[0];
    // One card on both roles, its id the merged selector's.
    assert_eq!(c.role, merged_role(&["src/a", "src/b"]));
    assert_eq!(c.id, convention_id(&c.role, &extends_rule()));
    assert_eq!(c.summary(), "classes in src/a/** and src/b/** extend Base");
    // Evidence on the union, not the better part's.
    assert_eq!((c.evidence.holders, c.evidence.total), (68, 70));
    let lb = (wilson_lower_bound(68, 70) * 1000.0).round() / 1000.0;
    assert_eq!(c.evidence.lower_bound, lb);
    let base_rate = 68.0 / 160.0;
    let lift = ((68.0 / 70.0) / base_rate * 1000.0_f64).round() / 1000.0;
    assert_eq!(c.evidence.lift, lift);
    let outliers: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    assert_eq!(outliers, ["A0", "B0"]);
    assert_eq!(c.tier(), Tier::Suggestion);

    // `check` holds both parts to it, under the one id, and nothing else.
    let mut policy = ConventionsFile::merge(None, "t", mined.kinds.clone(), &mined.candidates);
    accept(&mut policy, &c.id);
    let mut grown = sibling_files(&[
        class("src/b/new.ts", "NewB", false),
        class("src/c/new.ts", "NewC", false),
    ]);
    grown.sort_by(|a, b| a.path.cmp(&b.path));
    let grown = repo(grown);
    let mut flagged: Vec<String> = check(&grown, &policy, &Lock::default(), Scope::Accepted, None)
        .violations
        .into_iter()
        .filter(|v| v.id == c.id)
        .map(|v| v.symbol)
        .collect();
    flagged.sort();
    assert_eq!(flagged, ["A0", "B0", "NewB"]);
    let conv = policy.conventions.iter().find(|p| p.id == c.id).unwrap();
    let covers = |rel: &str| role_covers_path(&conv.role, rel, None, None, &policy.file_kinds);
    assert!(covers("src/a/x.ts") && covers("src/b/x.ts"));
    assert!(!covers("src/c/x.ts") && !covers("lib/x.ts"));
}

/// [STRICT] Hysteresis: a sibling accepted on its own is never merged away, and an
/// accepted merged card is formed again from exactly its parts when a third sibling
/// would join it.
#[test]
fn accepted_cards_keep_their_ids_across_merges() {
    let r = repo(sibling_files(&[]));
    let mined = mine(&r, &opts());
    // Accepted on its own (from before merging): `src/a` stays a card of its own.
    let alone = [(part("src/a"), extends_rule())];
    let kept = mine_keeping(&r, &opts(), mined.kinds.clone(), &alone);
    let mut got: Vec<RoleSelector> = on_rule(&kept.candidates, &extends_rule())
        .iter()
        .map(|c| c.role.clone())
        .collect();
    got.sort();
    assert_eq!(got, [part("src/a"), part("src/b")]);

    // An accepted merged card, then a sibling `src/d` that follows the rule too.
    let card = [(merged_role(&["src/a", "src/b"]), extends_rule())];
    let d: Vec<FileFacts> = (0..20)
        .map(|i| class(&format!("src/d/d{i}.ts"), &format!("D{i}"), i != 0))
        .collect();
    let grown = repo(sibling_files(&d));
    let fresh = mine(&grown, &opts());
    let fresh_roles: Vec<RoleSelector> = on_rule(&fresh.candidates, &extends_rule())
        .iter()
        .map(|c| c.role.clone())
        .collect();
    assert_eq!(fresh_roles, [merged_role(&["src/a", "src/b", "src/d"])]);
    let kept = mine_keeping(&grown, &opts(), fresh.kinds.clone(), &card);
    let mut got: Vec<RoleSelector> = on_rule(&kept.candidates, &extends_rule())
        .iter()
        .map(|c| c.role.clone())
        .collect();
    got.sort();
    assert_eq!(got, [merged_role(&["src/a", "src/b"]), part("src/d")]);
}

/// A reviewer's exceptions follow a member when cards merge: the merged card takes the
/// union of its parts' exceptions; a part that comes apart again takes the merged card's
/// exceptions on the members it lists.
#[test]
fn reviewer_exceptions_follow_merged_cards() {
    let r = repo(sibling_files(&[]));
    let mined = mine(&r, &opts());
    let merged = on_rule(&mined.candidates, &extends_rule())[0].clone();
    // The policy before merging: a card per part, each with an exception.
    let split = |dir: &str| {
        let mut c = merged.clone();
        c.role = part(dir);
        c.id = convention_id(&c.role, &c.rule);
        c.outliers
            .retain(|o| o.path.starts_with(&format!("{dir}/")));
        c
    };
    let mut before = ConventionsFile::merge(
        None,
        "t",
        mined.kinds.clone(),
        &[split("src/a"), split("src/b")],
    );
    let (a, b) = (split("src/a").id, split("src/b").id);
    before
        .get_mut(&a)
        .unwrap()
        .set_exception("src/a/a0.ts#A0", "legacy");
    before
        .get_mut(&b)
        .unwrap()
        .set_exception("src/b/b0.ts#B0", "generated");
    accept(&mut before, &a);
    let after = ConventionsFile::merge(
        Some(before),
        "t",
        mined.kinds.clone(),
        std::slice::from_ref(&merged),
    );
    let card = after
        .conventions
        .iter()
        .find(|c| c.id == merged.id)
        .unwrap();
    assert_eq!(
        card.exceptions,
        [
            Exception {
                member: "src/a/a0.ts#A0".into(),
                reason: "legacy".into()
            },
            Exception {
                member: "src/b/b0.ts#B0".into(),
                reason: "generated".into()
            },
        ]
    );
    // The parts keep theirs, and their decisions.
    assert_eq!(
        after.conventions.iter().find(|c| c.id == a).unwrap().status,
        Status::Accepted
    );
    // A check of the accepted merged card lists the members as reviewed, not violations.
    let mut policy = after.clone();
    accept(&mut policy, &merged.id);
    let report = check(&r, &policy, &Lock::default(), Scope::Accepted, None);
    assert!(
        report.violations.iter().all(|v| v.id != merged.id),
        "{:?}",
        report.violations
    );
    assert_eq!(
        report
            .exempt
            .iter()
            .filter(|e| e.id == merged.id && e.code == "reviewed")
            .count(),
        2
    );

    // Coming apart: a new card on `src/b` takes the merged card's exception on `B0`.
    let only_merged = ConventionsFile {
        conventions: policy
            .conventions
            .iter()
            .filter(|c| c.id == merged.id)
            .cloned()
            .collect(),
        ..policy.clone()
    };
    let apart = ConventionsFile::merge(
        Some(only_merged),
        "t",
        FileKinds::default(),
        &[split("src/b")],
    );
    let b_card = apart.conventions.iter().find(|c| c.id == b).unwrap();
    assert_eq!(
        b_card.exceptions,
        [Exception {
            member: "src/b/b0.ts#B0".into(),
            reason: "generated".into()
        }]
    );
}

/// Sibling cards in the default tier are never merged [STRICT]: call wrappers on 40 and
/// 30 functions stay two cards.
#[test]
fn default_tier_siblings_are_not_merged() {
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(function(
            &format!("src/a/a{i}.ts"),
            &format!("a{i}"),
            i != 0,
        ));
    }
    for i in 0..30 {
        files.push(function(
            &format!("src/b/b{i}.ts"),
            &format!("b{i}"),
            i != 0,
        ));
    }
    for i in 0..30 {
        files.push(function(&format!("src/c/c{i}.ts"), &format!("c{i}"), false));
    }
    for i in 0..60 {
        files.push(function(&format!("lib/l{i}.ts"), &format!("l{i}"), false));
    }
    let rule = Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: vec![WRAP.into()],
    };
    let mined = mine(&repo(files), &opts());
    let ours = on_rule(&mined.candidates, &rule);
    let mut got: Vec<&str> = ours.iter().map(|c| c.role.dir.as_str()).collect();
    got.sort();
    assert_eq!(got, ["src/a", "src/b"]);
    assert!(
        ours.iter()
            .all(|c| c.tier() == Tier::Default && c.role.also.is_empty())
    );
}

/// Hysteresis keeps an accepted rule's own form where a small change would reshape it:
/// a wrapper rule whose outlier's sibling wrapper would join its set, and a model field
/// whose spelling most models use changes.
#[test]
fn an_accepted_rule_keeps_its_form() {
    const META: &str = "src/decorators/metadata-resolver.decorator.ts#MetadataResolver";
    const CORE: &str = "src/decorators/core-resolver.decorator.ts#CoreResolver";
    let deco = |path: &str, name: &str, w: Option<&str>| {
        let wraps: Vec<(&str, WrapKind)> =
            w.map(|w| (w, WrapKind::Decorator)).into_iter().collect();
        file(path, vec![symbol(name, SymbolKind::Function, &wraps)])
    };
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| deco(&format!("src/app/a{i}.ts"), &format!("h{i}"), Some(META)))
        .collect();
    files.push(deco("src/app/odd.ts", "odd", Some(CORE)));
    files.push(deco("src/app/bare.ts", "bare", None));
    for i in 0..3 {
        files.push(deco(
            &format!("lib/admin/b{i}.ts"),
            &format!("admin{i}"),
            Some(CORE),
        ));
    }
    for i in 0..40 {
        files.push(deco(&format!("lib/x/x{i}.ts"), &format!("x{i}"), None));
    }
    let r = repo(files);
    let fresh = mine(&r, &opts());
    let joined = fresh
        .candidates
        .iter()
        .find(|c| matches!(&c.rule, Rule::WrappedBy { any_of, .. } if any_of.len() == 2))
        .unwrap_or_else(|| panic!("{:?}", fresh.candidates));
    let single = Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![META.into()],
    };
    let accepted = [(joined.role.clone(), single.clone())];
    let kept = mine_keeping(&r, &opts(), fresh.kinds.clone(), &accepted);
    let c = kept
        .candidates
        .iter()
        .find(|c| c.role == joined.role && matches!(c.rule, Rule::WrappedBy { .. }))
        .unwrap();
    assert_eq!(c.rule, single);
    assert_eq!(c.id, convention_id(&joined.role, &single));
    assert_eq!(c.outliers.len(), 2);

    // Models: 20 spell the field `createdAt`, 8 `created_at`, 2 have neither.
    let mut models = Vec::new();
    for i in 0..30 {
        let fields = match i {
            0..20 => vec!["createdAt".to_string(), "id".to_string()],
            20..28 => vec!["created_at".to_string(), "id".to_string()],
            _ => vec!["id".to_string()],
        };
        models.push(drift_core::Model {
            path: "prisma/schema.prisma".into(),
            name: format!("M{i}"),
            source: "prisma".into(),
            line: i + 1,
            fields,
        });
    }
    let mut r = RepoFacts {
        models,
        ..Default::default()
    };
    r.normalize();
    let fresh = mine(&r, &opts());
    let field = |cs: &[Candidate]| {
        cs.iter()
            .find_map(|c| match &c.rule {
                Rule::ModelHas { field } => Some((c.role.clone(), field.clone())),
                _ => None,
            })
            .unwrap_or_else(|| panic!("{cs:?}"))
    };
    let (role, spelled) = field(&fresh.candidates);
    assert_eq!(spelled, "createdAt");
    let accepted = [(
        role,
        Rule::ModelHas {
            field: "created_at".into(),
        },
    )];
    let kept = mine_keeping(&r, &opts(), fresh.kinds.clone(), &accepted);
    assert_eq!(field(&kept.candidates).1, "created_at");
}

/// `check` reads a merged card part by part: a shared part of `src/b` (a component only
/// `src/b`'s members render) is exempt there, as on `src/b`'s own card, not judged
/// against the scope of the card's first part.
#[test]
fn a_merged_card_is_checked_in_the_part_each_member_is_in() {
    const FRAME: &str = "lib/frame.tsx#Frame";
    let component = |path: &str, name: &str, renders: &[&str]| {
        let mut s = symbol(name, SymbolKind::Component, &[]);
        s.renders = renders.iter().map(|r| r.to_string()).collect();
        s.controls.push("return_jsx".into());
        let mut f = file(path, vec![s]);
        f.lang = "tsx".into();
        f
    };
    let mut files = Vec::new();
    for i in 0..40 {
        let r: &[&str] = if i == 0 { &[] } else { &[FRAME] };
        files.push(component(&format!("src/a/A{i}.tsx"), &format!("A{i}"), r));
    }
    for i in 0..30 {
        let r: &[&str] = match i {
            0 => &[],
            1..=5 => &[FRAME, "src/b/BPart.tsx#BPart"],
            _ => &[FRAME],
        };
        files.push(component(&format!("src/b/B{i}.tsx"), &format!("B{i}"), r));
    }
    files.push(component("src/b/BPart.tsx", "BPart", &[]));
    for i in 0..30 {
        files.push(component(&format!("src/c/C{i}.tsx"), &format!("C{i}"), &[]));
    }
    for i in 0..60 {
        files.push(component(&format!("lib/L{i}.tsx"), &format!("L{i}"), &[]));
    }
    let r = repo(files);
    let mined = mine(&r, &opts());
    let rule = Rule::Renders {
        component: FRAME.into(),
    };
    let ours = on_rule(&mined.candidates, &rule);
    assert_eq!(ours.len(), 1, "{:?}", mined.candidates);
    let c = ours[0];
    assert!(!c.role.also.is_empty(), "{:?}", c.role);
    assert!(
        c.exempt
            .iter()
            .any(|e| e.symbol == "BPart" && e.code == "shared_part"),
        "{:?}",
        c.exempt
    );
    let mut policy = ConventionsFile::merge(None, "t", mined.kinds.clone(), &mined.candidates);
    accept(&mut policy, &c.id);
    let report = check(&r, &policy, &Lock::default(), Scope::Accepted, None);
    let mut flagged: Vec<&str> = report
        .violations
        .iter()
        .filter(|v| v.id == c.id)
        .map(|v| v.symbol.as_str())
        .collect();
    flagged.sort();
    assert_eq!(flagged, ["A0", "B0"]);
    assert!(
        report
            .exempt
            .iter()
            .any(|e| e.id == c.id && e.symbol == "BPart")
    );
}
