//! Layering proposals from the structure map (`drift_mine::from_map`, stream S11): a layer
//! that never imports the layer above it is proposed as `avoids import`, which mining
//! cannot do (its drafts need one member that breaks the rule). Every name is invented.

use drift_core::{FileFacts, Import, PackageFacts, RepoFacts};
use drift_mine::check::{Scope, check};
use drift_mine::context::RepoContext;
use drift_mine::from_map::{CHECKED_CLAUSE, MAX_OFFERED, MinedRule, layering, manifest, offered};
use drift_mine::mine::{Rule, convention_id, signals};
use drift_mine::policy::{ConventionsFile, Lock, Mode, Status};
use drift_mine::roles::{FileKinds, PACKAGE_WIDE, View};

fn file(path: &str, package: &str, imports: &[String]) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        package: package.into(),
        parse_ok: true,
        imports: imports
            .iter()
            .map(|m| Import {
                module: m.clone(),
                names: vec!["x".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect(),
        ..Default::default()
    }
}

fn repo(files: Vec<FileFacts>, packages: Vec<PackageFacts>) -> RepoFacts {
    let mut r = RepoFacts {
        files,
        packages,
        ..Default::default()
    };
    r.normalize();
    r
}

/// `core/` (`n` files, the first `importing` of which import a sibling) below
/// `ui/screens/` (12 files, each importing `core/c1.ts`), plus `extra`.
fn layered(n: usize, importing: usize, extra: Vec<FileFacts>) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..n {
        let imports = if i < importing {
            vec![format!("core/c{}.ts", (i + 1) % n)]
        } else {
            vec![]
        };
        files.push(file(&format!("core/c{i}.ts"), "", &imports));
    }
    for i in 0..12 {
        files.push(file(
            &format!("ui/screens/s{i}.tsx"),
            "",
            &["core/c1.ts".to_string()],
        ));
    }
    files.extend(extra);
    repo(files, vec![])
}

fn propose(r: &RepoFacts) -> Vec<drift_mine::from_map::Proposal> {
    layering(r, &FileKinds::learn(r), &[])
}

/// Pins the proposal itself: a clean one-way pair with a reverse edge is proposed, as
/// the existing `avoids import` rule, labelled from the map, proposed and advise. Before
/// this stream no channel proposed it (mining needs an outlier).
#[test]
fn a_clean_one_way_pair_is_proposed() {
    let r = layered(40, 40, vec![]);
    let ps = propose(&r);
    assert_eq!(ps.len(), 1, "{ps:#?}");
    let p = &ps[0];
    let c = &p.convention;
    assert_eq!(
        c.rule,
        Rule::Avoids {
            signal: "import:ui/screens".into()
        }
    );
    assert_eq!((c.role.package.as_str(), c.role.dir.as_str()), ("", "core"));
    assert_eq!(c.from_map.as_deref(), Some("layering"));
    assert_eq!((c.status, c.mode), (Status::Proposed, Mode::Advise));
    assert!(c.id.starts_with("D-"), "{}", c.id);
    assert_eq!(
        c.summary,
        format!("Code in core never imports ui/screens (40 files, none do; {CHECKED_CLAUSE})")
    );
    assert_eq!(
        (
            p.layering.importing,
            p.layering.importing_target,
            p.layering.reverse_files
        ),
        (40, 0, 12)
    );
    assert!(
        p.layering.example.starts_with("core/c"),
        "{}",
        p.layering.example
    );
    assert_eq!(p.same_as_mined, None);
}

/// Pins that `drift check` reads the proposal with no change: accepted, it holds today and
/// reports the first file of `core/` that imports `ui/screens`.
#[test]
fn the_checker_evaluates_an_accepted_proposal() {
    let r = layered(40, 40, vec![]);
    let kinds = FileKinds::learn(&r);
    let ps = layering(&r, &kinds, &[]);
    let mut accepted = ps[0].convention.clone();
    accepted.status = Status::Accepted;
    let id = accepted.id.clone();
    let mut policy = ConventionsFile::merge(None, "test", kinds, &[]);
    policy.conventions.push(accepted);
    let today = check(&r, &policy, &Lock::default(), Scope::Accepted, None);
    assert!(
        !today.violations.iter().any(|v| v.id == id),
        "{:?}",
        today.violations
    );
    let after = layered(
        40,
        40,
        vec![file(
            "core/c40.ts",
            "",
            &["core/c1.ts".to_string(), "ui/screens/s2.tsx".to_string()],
        )],
    );
    let report = check(&after, &policy, &Lock::default(), Scope::Accepted, None);
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.id == id && v.path == "core/c40.ts"),
        "{:?}",
        report.violations
    );
}

/// Pins that one file of the layer importing the target stops the proposal: a pair with an
/// outlier is mining's case (its rule names the outlier). The outlier carries exactly the
/// signal the proposal would have named.
#[test]
fn a_pair_with_one_reverse_import_is_not_proposed_here() {
    let breaker = file(
        "core/c40.ts",
        "",
        &["core/c1.ts".to_string(), "ui/screens/s1.tsx".to_string()],
    );
    let r = layered(40, 40, vec![breaker]);
    assert!(propose(&r).is_empty(), "{:#?}", propose(&r));
    let kinds = FileKinds::learn(&r);
    let units = drift_mine::roles::units(&r, &kinds);
    let ctx = RepoContext::new(&r, &units);
    let f = r.files.iter().find(|f| f.path == "core/c40.ts").unwrap();
    assert!(signals(&View::File(f), &ctx).contains("import:ui/screens"));
}

/// Pins that files with no imports are not counted: 40 files of which 10 import anything
/// is a population of 10, below the minimum, so nothing is proposed (the juice-shop
/// `data/**` case, 100 of 104 files importing nothing).
#[test]
fn files_that_import_nothing_are_not_counted() {
    assert!(propose(&layered(40, 10, vec![])).is_empty());
}

/// Pins the reverse-direction condition: two folders that never import each other are
/// unrelated, not a layering.
#[test]
fn unrelated_folders_are_not_proposed() {
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(file(
            &format!("core/c{i}.ts"),
            "",
            &[format!("core/c{}.ts", (i + 1) % 40)],
        ));
    }
    for i in 0..12 {
        files.push(file(
            &format!("docs/pages/p{i}.ts"),
            "",
            &["docs/pages/p0.ts".to_string()],
        ));
    }
    assert!(propose(&repo(files, vec![])).is_empty());
}

fn workspace(core_declares_web: bool) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..40 {
        files.push(file(
            &format!("packages/core/src/c{i}.ts"),
            "packages/core",
            &[format!("packages/core/src/c{}.ts", (i + 1) % 40)],
        ));
    }
    for i in 0..12 {
        files.push(file(
            &format!("apps/web/a{i}.ts"),
            "apps/web",
            &["packages/core/src/c1.ts".to_string()],
        ));
    }
    let core = PackageFacts {
        path: "packages/core".into(),
        name: "@x/core".into(),
        dependencies: if core_declares_web {
            vec!["@x/web@workspace:*".into()]
        } else {
            vec![]
        },
        ..Default::default()
    };
    let web = PackageFacts {
        path: "apps/web".into(),
        name: "@x/web".into(),
        dependencies: vec!["@x/core@workspace:*".into()],
        ..Default::default()
    };
    repo(files, vec![core, web])
}

/// Pins both sides of declared dependencies: the declared edge web -> core is the reverse
/// evidence for "core never imports web" (proposed on the whole package), and a
/// dependency core declares on web is not restated backwards (an import it declares is
/// never a layering signal, so the rule could never fire).
#[test]
fn a_declared_dependency_is_evidence_and_never_restated() {
    let ps = propose(&workspace(false));
    assert_eq!(ps.len(), 1, "{ps:#?}");
    let c = &ps[0].convention;
    assert_eq!(
        (c.role.package.as_str(), c.role.dir.as_str()),
        ("packages/core", PACKAGE_WIDE)
    );
    assert!(ps[0].layering.reverse_declared);
    assert_eq!(
        c.summary,
        format!(
            "Code in packages/core never imports apps/web (40 files, none do; {CHECKED_CLAUSE})"
        )
    );
    assert!(propose(&workspace(true)).is_empty());
}

/// Pins that the id is about the rule, not its counts: more files, same id.
#[test]
fn the_id_is_stable_when_counts_change() {
    let a = propose(&layered(40, 40, vec![]));
    let b = propose(&layered(45, 45, vec![]));
    assert_eq!(a[0].convention.id, b[0].convention.id);
    assert_ne!(a[0].convention.summary, b[0].convention.summary);
    assert_eq!(b[0].layering.importing, 45);
}

/// Pins the duplicate test: a mined convention with the same rule on the same layer is
/// named, and the proposal is not offered again.
#[test]
fn a_rule_the_miner_makes_is_not_offered_twice() {
    let r = layered(40, 40, vec![]);
    let first = propose(&r);
    let role = first[0].convention.role.clone();
    let rule = first[0].convention.rule.clone();
    let mined = [MinedRule {
        id: "D-000001",
        role: &role,
        rule: &rule,
    }];
    let ps = layering(&r, &FileKinds::learn(&r), &mined);
    assert_eq!(ps[0].same_as_mined.as_deref(), Some("D-000001"));
    let (shown, more) = offered(&ps);
    assert!(shown.is_empty());
    assert_eq!(more, 0);
}

/// Pins the cap: seven clean lower layers under one top layer give seven proposals, of
/// which five are offered and two counted.
#[test]
fn a_repository_is_offered_a_few_and_told_how_many_more() {
    let mut files = Vec::new();
    for k in 0..7 {
        for i in 0..36 {
            files.push(file(
                &format!("l{k}/m{k}_{i}.ts"),
                "",
                &[format!("l{k}/m{k}_{}.ts", (i + 1) % 36)],
            ));
        }
    }
    for i in 0..8 {
        let imports: Vec<String> = (0..7).map(|k| format!("l{k}/m{k}_0.ts")).collect();
        files.push(file(&format!("top/x/t{i}.ts"), "", &imports));
    }
    let r = repo(files, vec![]);
    let ps = propose(&r);
    assert_eq!(ps.len(), 7, "{ps:#?}");
    assert!(ps.iter().all(|p| p.convention.rule
        == Rule::Avoids {
            signal: "import:top/x".into()
        }));
    let (shown, more) = offered(&ps);
    assert_eq!((shown.len(), more), (MAX_OFFERED, 2));
    // Deterministic: the same facts, the same order.
    let again: Vec<String> = propose(&r)
        .iter()
        .map(|p| p.convention.id.clone())
        .collect();
    let ids: Vec<String> = ps.iter().map(|p| p.convention.id.clone()).collect();
    assert_eq!(ids, again);
}

/// Pins that a manifest the code follows is proposed as a guard (`Rule::ImportsDeclared`,
/// proposed, advising, from the map): `packages/core` imports only its own code, so it
/// has no package to hold to a rule and is not proposed; `apps/web` has 12 files that
/// import the `@x/core` it declares (the floor is 8). Before the rule kind existed this
/// returned nothing.
#[test]
fn a_followed_manifest_is_proposed_as_a_guard() {
    let r = workspace(false);
    let m = manifest(&r, &FileKinds::learn(&r), &[]);
    assert_eq!(m.proposals.len(), 1, "{m:?}");
    let p = &m.proposals[0];
    assert_eq!(p.convention.rule, Rule::ImportsDeclared);
    assert_eq!(p.convention.role.package, "apps/web");
    assert_eq!(p.convention.status, Status::Proposed);
    assert_eq!(p.convention.mode, Mode::Advise);
    assert_eq!(p.convention.from_map.as_deref(), Some("manifest"));
    assert_eq!(p.manifest.importing, 12);
    assert_eq!(p.manifest.breaking_imports, 0);
}

/// `core/` read in full (40 importing files) plus `extra` files of `core/` that each
/// import a sibling, as `layered` builds them, made unread by `unread`.
fn with_unread(n: usize, unread: impl Fn(&mut FileFacts)) -> RepoFacts {
    let extra = (0..n)
        .map(|i| {
            let mut f = file(&format!("core/u{i}.ts"), "", &["core/c1.ts".to_string()]);
            unread(&mut f);
            f
        })
        .collect();
    layered(40, 40, extra)
}

/// Pins rule 2 (unknown is never "none do"): a file of the layer that failed to parse is
/// not counted as a file that does not import the target. It is counted apart, named in
/// the summary, and counts toward no threshold. Before, it was one of the "41 files,
/// none do".
#[test]
fn a_file_that_failed_to_parse_is_not_read_not_clean() {
    let ps = propose(&with_unread(1, |f| f.parse_ok = false));
    assert_eq!(ps.len(), 1, "{ps:#?}");
    let p = &ps[0];
    assert_eq!((p.layering.importing, p.layering.not_read), (40, 1));
    assert_eq!(p.convention.evidence.total, 40);
    assert_eq!(
        p.convention.summary,
        format!(
            "Code in core never imports ui/screens (40 files, none do; 1 file of core not read; {CHECKED_CLAUSE})"
        )
    );
    assert!(
        !p.layering.example.starts_with("core/u"),
        "{}",
        p.layering.example
    );
}

/// Pins that an import Drift could not resolve makes its file unknown: `@/x` joined to
/// the importer's folder no longer says which layer it lands in, so it may be the
/// target's. Before, the import was skipped and the file counted as one that does not
/// import the target.
#[test]
fn a_file_with_an_unresolved_import_is_not_read() {
    let ps = propose(&with_unread(1, |f| {
        f.imports.push(Import {
            module: "unresolved:core/@/screens/s1".into(),
            names: vec!["x".into()],
            type_only: false,
            load: Default::default(),
        })
    }));
    assert_eq!(ps.len(), 1, "{ps:#?}");
    assert_eq!((ps[0].layering.importing, ps[0].layering.not_read), (40, 1));
}

/// Pins that a file the scan skipped whole is not read either (it has no facts at all),
/// and that a layer with more than a fifth of its files not read (the bound promoted
/// practices use, `MAX_UNKNOWN_SHARE`) is not proposed: 11 of 51 files is 21.6%; 10 of 50
/// is exactly a fifth, still proposed.
#[test]
fn a_layer_drift_mostly_could_not_read_is_not_proposed() {
    let mut r = layered(40, 40, vec![]);
    r.skipped.push(drift_core::Skipped {
        path: "core/huge.ts".into(),
        reason: drift_core::SkipReason::TooLarge,
    });
    let ps = propose(&r);
    assert_eq!(ps.len(), 1, "{ps:#?}");
    assert_eq!((ps[0].layering.importing, ps[0].layering.not_read), (40, 1));

    assert_eq!(propose(&with_unread(10, |f| f.parse_ok = false)).len(), 1);
    assert!(propose(&with_unread(11, |f| f.parse_ok = false)).is_empty());
}

/// Pins that the proposal's id is the one mining gives the same role and rule: once
/// accepted, mining keeps that rule under that id, and `ConventionsFile::merge` finds
/// the accepted convention instead of adding a proposed copy beside it.
#[test]
fn the_id_is_minings_id_for_the_same_rule() {
    let ps = propose(&layered(40, 40, vec![]));
    let c = &ps[0].convention;
    assert_eq!(c.id, convention_id(&c.role, &c.rule));
}
