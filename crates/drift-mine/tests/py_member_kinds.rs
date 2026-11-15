//! Round 8, W1 (Python): a class role is split by the framework lineage of its members
//! (`RoleSelector::member_kind`, from the `lineage_<kind>` trait the Python repo pass
//! records), so base-class, call and naming rules are mined per kind; naming rules on
//! plain Python classes are not proposed (W3); a role formed by a framework base does
//! not restate it; a convention written before (selector version 2) keeps the members
//! it had.

use drift_core::lineage;
use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, SELECTOR_VERSION, Status};

fn class(name: &str, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind: SymbolKind::Class,
        exported_as: vec![name.into()],
        line: 1,
        ..Default::default()
    };
    edit(&mut s);
    s
}

fn py(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "py".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn extends(s: &mut Symbol, base: &str) {
    s.wraps.push(Wrap {
        wrapper: base.into(),
        kind: WrapKind::Extends,
    });
}

fn of_kind(s: &mut Symbol, kind: &str) {
    s.traits.push(lineage::trait_for(kind));
}

fn repo(files: Vec<FileFacts>) -> RepoFacts {
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

fn mined(r: &RepoFacts) -> Vec<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 }).candidates
}

fn background(files: &mut Vec<FileFacts>) {
    for i in 0..100 {
        files.push(py(
            &format!("other/c{i}.py"),
            vec![class(&format!("C{i}"), |_| {})],
        ));
    }
}

const TEAM_BASE: &str = "app/lib/api.py#TeamSerializer";
const MODEL_SERIALIZER: &str = "pkg:rest_framework#serializers.ModelSerializer";

/// 60 serializers on the team's base in `app/m*/api.py`, and beside some of them a
/// permission class, a filter and a helper: plain classes of no serializer lineage.
fn api_files(with_kinds: bool) -> Vec<FileFacts> {
    let mut files = vec![py(
        "app/lib/api.py",
        vec![class("TeamSerializer", |s| {
            extends(s, MODEL_SERIALIZER);
            if with_kinds {
                of_kind(s, lineage::SERIALIZER);
            }
        })],
    )];
    for i in 0..60 {
        let mut symbols = vec![class(&format!("M{i}Serializer"), |s| {
            extends(s, TEAM_BASE);
            if with_kinds {
                of_kind(s, lineage::SERIALIZER);
            }
        })];
        match i {
            0 => symbols.push(class("TeamPermission", |s| {
                extends(s, "app/lib/permissions.py#IsAuthenticated")
            })),
            1 => symbols.push(class("Helper", |_| {})),
            2 => symbols.push(class("Lookup", |_| {})),
            _ => {}
        }
        files.push(py(&format!("app/m{i}/api.py"), symbols));
    }
    background(&mut files);
    files
}

fn base_rule(base: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![base.into()],
    }
}

fn find(cs: &[Candidate], f: impl Fn(&Candidate) -> bool) -> &Candidate {
    cs.iter().find(|c| f(c)).unwrap_or_else(|| {
        panic!(
            "not mined: {:?}",
            cs.iter()
                .map(|c| (c.role.describe(), c.rule.describe()))
                .collect::<Vec<_>>()
        )
    })
}

fn outliers(c: &Candidate) -> Vec<&str> {
    let mut v: Vec<&str> = c.outliers.iter().map(|o| o.symbol.as_str()).collect();
    v.sort();
    v
}

#[test]
fn a_base_class_rule_is_mined_over_the_classes_of_one_lineage() {
    // Without kinds (as before W1): the plain classes beside the serializers are
    // outliers of "classes in api files extend TeamSerializer".
    let before = mined(&repo(api_files(false)));
    let c = find(&before, |c| c.rule == base_rule(TEAM_BASE));
    assert_eq!(c.role.member_kind, None);
    // (The permission class, on a base the facts lack, is exempt as another kind.)
    assert_eq!(outliers(c), ["Helper", "Lookup"]);

    // With kinds: the rule is about the serializers alone.
    let after = mined(&repo(api_files(true)));
    let c = find(&after, |c| c.rule == base_rule(TEAM_BASE));
    assert_eq!(c.role.member_kind.as_deref(), Some(lineage::SERIALIZER));
    assert!(outliers(c).is_empty(), "{:?}", outliers(c));
    assert_eq!(c.evidence.total, 60);
    assert!(
        c.role.describe().starts_with("serializers in app/**"),
        "{}",
        c.role.describe()
    );
    // The split role has its own id: the role key names the kind.
    let old = find(&before, |c| c.rule == base_rule(TEAM_BASE));
    assert_ne!(c.id, old.id);
}

#[test]
fn a_member_kind_role_does_not_restate_the_framework_base_that_formed_it() {
    // Every serializer extends `serializers.ModelSerializer` directly; four plain
    // classes beside them do not.
    let mut files = Vec::new();
    for i in 0..60 {
        let mut symbols = vec![class(&format!("M{i}Serializer"), |s| {
            extends(s, MODEL_SERIALIZER);
            of_kind(s, lineage::SERIALIZER);
        })];
        if i < 4 {
            symbols.push(class(&format!("Helper{i}"), |_| {}));
        }
        files.push(py(&format!("app/m{i}/serializers.py"), symbols));
    }
    background(&mut files);
    let cs = mined(&repo(files.clone()));
    assert!(
        !cs.iter().any(|c| c.rule == base_rule(MODEL_SERIALIZER)),
        "{:?}",
        cs.iter().map(|c| c.rule.describe()).collect::<Vec<_>>()
    );
    // Without the kind, the same classes are plain, and the framework base is a rule
    // of their role, as before.
    for f in &mut files {
        for s in &mut f.symbols {
            s.traits.clear();
        }
    }
    let cs = mined(&repo(files));
    find(&cs, |c| c.rule == base_rule(MODEL_SERIALIZER));
}

fn named(pattern: &str) -> Rule {
    Rule::Named {
        pattern: pattern.into(),
    }
}

/// 30 repositories in `app/repositories/`, one result type beside them.
fn repositories(kind: Option<&str>) -> Vec<FileFacts> {
    let mut files = Vec::new();
    for i in 0..30 {
        let mut symbols = vec![class(&format!("M{i}Repository"), |s| {
            if let Some(k) = kind {
                of_kind(s, k);
            }
        })];
        if i == 0 {
            symbols.push(class("WriteCounts", |s| {
                if let Some(k) = kind {
                    of_kind(s, k);
                }
            }));
        }
        files.push(py(&format!("app/repositories/m{i}.py"), symbols));
    }
    background(&mut files);
    files
}

#[test]
fn python_naming_rules_are_mined_only_within_a_member_kind() {
    // Plain classes: no naming rule (the role may mix kinds Drift cannot see).
    let cs = mined(&repo(repositories(None)));
    assert!(
        !cs.iter().any(|c| c.rule == named("*Repository")),
        "{:?}",
        cs.iter().map(|c| c.rule.describe()).collect::<Vec<_>>()
    );
    // Classes of one lineage: the naming rule is mined over them.
    let cs = mined(&repo(repositories(Some(lineage::MODEL))));
    let c = find(&cs, |c| c.rule == named("*Repository"));
    assert_eq!(c.role.member_kind.as_deref(), Some(lineage::MODEL));
    assert_eq!(outliers(c), ["WriteCounts"]);
}

#[test]
fn a_selector_written_before_member_kinds_keeps_every_kind_at_its_place() {
    // A convention accepted on main before W1: "classes in api files extend
    // TeamSerializer", mined without kinds, so its role names no member kind.
    let before = repo(api_files(false));
    let cs = mined(&before);
    let old = find(&cs, |c| c.rule == base_rule(TEAM_BASE)).clone();
    let mut p = ConventionsFile::merge(
        None,
        "test",
        mine(&before, &MineOptions::default()).kinds,
        std::slice::from_ref(&old),
    );
    for c in &mut p.conventions {
        c.status = Status::Accepted;
    }
    // Today a new serializer that skips the base has the serializer kind.
    let mut files = api_files(true);
    files.push(py(
        "app/m99/api.py",
        vec![class("RogueSerializer", |s| {
            extends(s, MODEL_SERIALIZER);
            of_kind(s, lineage::SERIALIZER);
        })],
    ));
    let now = repo(files);
    let violators = |p: &ConventionsFile| {
        let mut v: Vec<String> = check(&now, p, &Lock::default(), Scope::Accepted, None)
            .violations
            .into_iter()
            .map(|v| v.symbol)
            .collect();
        v.sort();
        v
    };
    // Version 2 (written before member kinds): it still holds the serializer and the
    // plain classes, as when it was accepted.
    p.conventions[0].selector_version = 2;
    assert_eq!(violators(&p), ["Helper", "Lookup", "RogueSerializer"]);
    // The same selector written today holds only the plain classes at its place.
    p.conventions[0].selector_version = SELECTOR_VERSION;
    assert_eq!(violators(&p), ["Helper", "Lookup"]);
}

fn decorator_rule(d: &str) -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![d.into()],
    }
}

const REGISTER: &str = "app/lib/search.py#register_search";

/// 30 search indexes decorated with `register_search()` in `app/m*/search.py`, and a
/// form and a model beside two of them that are not.
fn search_files(decorate_others: bool) -> Vec<FileFacts> {
    let mut files = vec![py("app/lib/search.py", vec![])];
    for i in 0..30 {
        let mut symbols = vec![class(&format!("M{i}Index"), |s| {
            s.wraps.push(Wrap {
                wrapper: REGISTER.into(),
                kind: WrapKind::Decorator,
            })
        })];
        let other = |name: &str, kind: &str| {
            class(name, |s| {
                of_kind(s, kind);
                if decorate_others {
                    s.wraps.push(Wrap {
                        wrapper: REGISTER.into(),
                        kind: WrapKind::Decorator,
                    });
                }
            })
        };
        match i {
            0 => symbols.push(other("SearchForm", lineage::FORM)),
            1 => symbols.push(other("CachedValue", lineage::MODEL)),
            _ => {}
        }
        files.push(py(&format!("app/m{i}/search.py"), symbols));
    }
    background(&mut files);
    files
}

#[test]
fn a_rule_universal_once_the_kinds_are_apart_is_carried_from_the_unsplit_role() {
    // 30 of the 32 classes at the place hold it; the two that do not are of other kinds,
    // so it holds for all 30 plain classes: still a convention, with no outlier.
    let cs = mined(&repo(search_files(false)));
    let c = find(&cs, |c| c.rule == decorator_rule(REGISTER));
    assert_eq!(c.role.member_kind, None);
    assert_eq!(c.evidence.holders, 30);
    assert_eq!(c.evidence.total, 30);
    assert!(outliers(c).is_empty());
    // Universal at the unsplit place too: documentation, not a rule, as before.
    let cs = mined(&repo(search_files(true)));
    assert!(
        !cs.iter().any(|c| c.rule == decorator_rule(REGISTER)),
        "{:?}",
        cs.iter().map(|c| c.rule.describe()).collect::<Vec<_>>()
    );
}

#[test]
fn a_naming_rule_universal_within_its_kind_is_carried_from_the_unsplit_role() {
    // wger's serializers: every serializer is named `*Serializer`, on one of two DRF
    // bases; beside them, plain classes are not.
    let mut files = Vec::new();
    for i in 0..30 {
        let mut symbols = vec![class(&format!("M{i}Serializer"), |s| {
            if i % 3 == 0 {
                extends(s, "pkg:rest_framework#serializers.Serializer");
            } else {
                extends(s, MODEL_SERIALIZER);
            }
            of_kind(s, lineage::SERIALIZER);
        })];
        if i < 2 {
            symbols.push(class(&format!("Helper{i}"), |_| {}));
        }
        files.push(py(&format!("app/m{i}/serializers.py"), symbols));
    }
    background(&mut files);
    let cs = mined(&repo(files));
    let c = find(&cs, |c| c.rule == named("*Serializer"));
    assert_eq!(c.role.member_kind.as_deref(), Some(lineage::SERIALIZER));
    assert_eq!((c.evidence.holders, c.evidence.total), (30, 30));
}

/// The same naming rule, carried from the unsplit roles of two sibling file kinds
/// (`serializers.py` and `api.py`, as ralph's), is one merged card: the unsplit roles
/// are mined card by card, so each carried rule is found, and only then merged.
#[test]
fn carried_rules_of_sibling_file_kinds_merge_into_one_card() {
    let mut files = Vec::new();
    for (stem, tag) in [("serializers", "S"), ("api", "A")] {
        for i in 0..30 {
            let mut symbols = vec![class(&format!("{tag}{i}Serializer"), |s| {
                if i % 3 == 0 {
                    extends(s, "pkg:rest_framework#serializers.Serializer");
                } else {
                    extends(s, MODEL_SERIALIZER);
                }
                of_kind(s, lineage::SERIALIZER);
            })];
            if i < 2 {
                symbols.push(class(&format!("{tag}Helper{i}"), |_| {}));
            }
            files.push(py(&format!("app/m{i}/{stem}.py"), symbols));
        }
    }
    background(&mut files);
    let cs = mined(&repo(files));
    let c = find(&cs, |c| c.rule == named("*Serializer"));
    assert_eq!(c.role.member_kind.as_deref(), Some(lineage::SERIALIZER));
    let mut kinds: Vec<String> = c.role.parts().into_iter().map(|p| p.file).collect();
    kinds.sort();
    assert_eq!(kinds, ["api", "serializers"]);
    assert_eq!((c.evidence.holders, c.evidence.total), (60, 60));
}
