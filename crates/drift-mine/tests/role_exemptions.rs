//! A member one rule of a role leaves out for what it is (another kind of class, a
//! documented exception, the module that defines the target, ...:
//! [`ROLE_EXEMPTION_CODES`]) is not an outlier of the role's sibling rules either, and
//! the rule statement names the members it leaves out ([`except_clause`]).
//!
//! Only outliers take the exemption over, never under a guard or for an entry point
//! ([`Rule::takes_role_exemptions`]); `check` reads it from every sibling convention of
//! the policy, and a hook's single-file scan of such an outlier goes to a full scan.
//!
//! The fixtures are generic providers and errors, not any dev repository's code.

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::mine::{
    Candidate, Exempt, MineOptions, ROLE_EXEMPTION_CODES, Rule, except_clause, mine_unshown as mine,
};
use drift_mine::policy::{ConventionsFile, Lock, Status};

const SYNC: &str = "worker/src/providers";
const BASE: &str = "lib/src/base.ts#SyncBase";
const AUTH: &str = "worker/src/auth.ts#requireAuth";

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

fn file(path: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: path.split('/').next().unwrap().into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn wrap(wrapper: &str, kind: WrapKind) -> Wrap {
    Wrap {
        wrapper: wrapper.into(),
        kind,
    }
}

/// 40 classes `P{i}Provider` in `worker/src/providers/p{i}.ts`, all but `P39Provider` on
/// `SyncBase`, each but
/// `P38Provider` also decorated with `decorator` when given; `RateLimitError extends Error`, the default export of
/// `worker/src/providers/errors.ts`; and 60 plain classes in another package, for lift.
fn repo(decorator: Option<&str>) -> RepoFacts {
    repo_named(decorator, "Provider")
}

/// [`repo`] with the classes named `P{i}{suffix}`.
fn repo_named(decorator: Option<&str>, suffix: &str) -> RepoFacts {
    let mut files = vec![file("lib/src/base.ts", vec![class("SyncBase", |_| {})])];
    for i in 0..40 {
        files.push(file(
            &format!("{SYNC}/p{i}.ts"),
            vec![class(&format!("P{i}{suffix}"), |s| {
                // One provider skips the base: an outlier of the base rule only, so
                // the two rules have different holders.
                if i != 39 {
                    s.wraps.push(wrap(BASE, WrapKind::Extends));
                }
                if let Some(d) = decorator.filter(|_| i != 38) {
                    s.wraps.push(wrap(d, WrapKind::Decorator));
                }
            })],
        ));
    }
    files.push(file(
        &format!("{SYNC}/errors.ts"),
        vec![class("RateLimitError", |s| {
            s.wraps.push(wrap("global#Error", WrapKind::Extends));
            // Its file's default export: never a shared part, so only the sibling's
            // exemption can leave a single-file scan of it undecided.
            s.exported_as = vec!["default".into()];
        })],
    ));
    for i in 0..60 {
        files.push(file(
            &format!("web/src/util/u{i}.ts"),
            vec![class(&format!("Widget{i}"), |_| {})],
        ));
    }
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

fn candidate<'a>(cs: &'a [Candidate], rule: &Rule) -> &'a Candidate {
    cs.iter()
        .find(|c| c.rule == *rule && c.role.package == "worker")
        .unwrap_or_else(|| {
            panic!(
                "{:?}",
                cs.iter().map(Candidate::summary).collect::<Vec<_>>()
            )
        })
}

fn extends_base() -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![BASE.into()],
    }
}

fn named() -> Rule {
    Rule::Named {
        pattern: "*Provider".into(),
    }
}

fn outliers(c: &Candidate) -> Vec<&str> {
    c.outliers.iter().map(|o| o.symbol.as_str()).collect()
}

fn exempt(c: &Candidate) -> Vec<(&str, &str, &str)> {
    c.exempt
        .iter()
        .map(|e| (e.symbol.as_str(), e.code.as_str(), e.reason.as_str()))
        .collect()
}

/// The policy with `accepted` accepted and the other candidates proposed.
fn policy(cs: &[Candidate], accepted: &Rule) -> ConventionsFile {
    let mine: Vec<Candidate> = cs
        .iter()
        .filter(|c| c.role.package == "worker")
        .cloned()
        .collect();
    let mut p = ConventionsFile::merge(None, "test", Default::default(), &mine);
    for c in &mut p.conventions {
        if c.rule == *accepted {
            c.status = Status::Accepted;
        }
    }
    p
}

/// `drift check` with `accepted` accepted: (violations, exempt members with code).
fn checked(r: &RepoFacts, cs: &[Candidate], accepted: &Rule) -> (Vec<String>, Vec<String>) {
    let report = check(
        r,
        &policy(cs, accepted),
        &Lock::default(),
        Scope::Accepted,
        None,
    );
    (
        report.violations.iter().map(|v| v.symbol.clone()).collect(),
        report
            .exempt
            .iter()
            .map(|e| format!("{} {}", e.symbol, e.code))
            .collect(),
    )
}

fn only(r: &RepoFacts, path: &str) -> RepoFacts {
    let mut one = r.clone();
    one.files.retain(|f| f.path == path);
    one
}

#[test]
fn a_class_of_another_kind_is_no_outlier_of_the_roles_naming_rule() {
    let r = repo(None);
    let cs = mined(&r);
    // The base-class rule leaves the error out for what it is.
    let base = candidate(&cs, &extends_base());
    let own = exempt(base);
    assert_eq!(own.len(), 1, "{own:?}");
    assert_eq!((own[0].0, own[0].1), ("RateLimitError", "named_for_base"));
    // The naming rule of the same role takes it over, said as such; holders stay.
    let c = candidate(&cs, &named());
    assert!(outliers(c).is_empty(), "{:?}", c.outliers);
    let why = format!(
        "{} (as for the role's rule \"{}\")",
        own[0].2,
        extends_base().describe()
    );
    assert_eq!(
        exempt(c),
        [("RateLimitError", "named_for_base", why.as_str())]
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (40, 40));
    assert!(
        c.summary()
            .ends_with(", except a class (named for a base of another kind)"),
        "{}",
        c.summary()
    );
    // `check` with only the naming rule accepted: the sibling still says what the
    // error is.
    assert_eq!(
        checked(&r, &cs, &named()),
        (vec![], vec!["RateLimitError named_for_base".to_string()])
    );
}

#[test]
fn never_under_a_guard() {
    // Every provider is also decorated with an access-control decorator: the error is
    // an outlier of that rule, whatever it is.
    let r = repo(Some(AUTH));
    let cs = mined(&r);
    let guard = Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![AUTH.into()],
    };
    let c = candidate(&cs, &guard);
    assert_eq!(outliers(c), ["RateLimitError", "P38Provider"]);
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(
        checked(&r, &cs, &guard).0,
        ["RateLimitError", "P38Provider"]
    );
    // The naming rule still takes it over.
    assert!(outliers(candidate(&cs, &named())).is_empty());
}

#[test]
fn a_single_file_scan_of_such_an_outlier_needs_a_full_scan() {
    // Whether the error is of another kind is read against the classes that follow the
    // sibling rule across the repo: one file alone cannot say.
    let r = repo(None);
    let cs = mined(&r);
    let p = policy(&cs, &named());
    assert!(needs_full_scan(&only(&r, &format!("{SYNC}/errors.ts")), &p));
    assert!(!needs_full_scan(&only(&r, &format!("{SYNC}/p3.ts")), &p));
    assert!(!needs_full_scan(&r, &p));
}

#[test]
fn only_codes_about_what_a_member_is_are_shared() {
    for c in [
        "opt_out",
        "does_not_call",
        "no_input",
        "factory",
        "registered_key",
        "own_target",
        "shared_part",
        "does_not_override",
        "does_not_use",
        "defines_alternative",
    ] {
        assert!(!ROLE_EXEMPTION_CODES.contains(&c), "{c}");
    }
}

fn ex(code: &str) -> Exempt {
    Exempt {
        path: "a.ts".into(),
        symbol: "x".into(),
        line: 1,
        code: code.into(),
        reason: "why".into(),
    }
}

#[test]
fn the_rule_statement_names_what_it_leaves_out() {
    assert_eq!(except_clause(&[]), "");
    assert_eq!(
        except_clause(&[ex("shared_part"), ex("another_kind"), ex("another_kind")]),
        ", except 2 classes (of another kind) and a shared part (used by several members, not a member)"
    );
    assert_eq!(
        except_clause(&[ex("root_file"), ex("companion"), ex("something_new")]),
        ", except a companion (a helper or constant beside the members that follow it), a framework root file (wired by the framework) and a member (something new)"
    );
}

#[test]
fn sharing_is_deterministic() {
    let r = repo(None);
    assert_eq!(format!("{:?}", mined(&r)), format!("{:?}", mined(&r)));
}

#[test]
fn never_under_a_name_that_says_who_may_pass() {
    // "classes are named `*Admin`" names who may pass: the error stays its outlier,
    // though the base-class rule leaves it out.
    let r = repo_named(None, "Admin");
    let cs = mined(&r);
    assert_eq!(exempt(candidate(&cs, &extends_base())).len(), 1);
    let admin = Rule::Named {
        pattern: "*Admin".into(),
    };
    let c = candidate(&cs, &admin);
    assert_eq!(outliers(c), ["RateLimitError"]);
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(checked(&r, &cs, &admin).0, ["RateLimitError"]);
}

#[test]
fn a_companion_is_shared_with_naming_rules_only() {
    // A plain class beside a follower on the team's base: a companion of the naming
    // rule's followers, and a provider that skipped the base under the base-class rule.
    let mut r = repo(None);
    r.files
        .iter_mut()
        .find(|f| f.path == format!("{SYNC}/p0.ts"))
        .unwrap()
        .symbols
        .push(class("UrlThing", |s| s.line = 5));
    r.normalize();
    let cs = mined(&r);
    let n = candidate(&cs, &named());
    assert!(
        n.exempt
            .iter()
            .any(|e| e.symbol == "UrlThing" && e.code == "companion"),
        "{:?}",
        n.exempt
    );
    let base = candidate(&cs, &extends_base());
    assert!(outliers(base).contains(&"UrlThing"), "{:?}", base.exempt);
    assert!(
        checked(&r, &cs, &extends_base())
            .0
            .contains(&"UrlThing".to_string())
    );
}
