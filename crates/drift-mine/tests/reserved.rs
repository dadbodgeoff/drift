//! Exports whose name the framework reserves ([`drift_mine::roles::reserved_export`]):
//! in a Next.js route file, `generateMetadata`, `generateStaticParams` and
//! `dynamicParams` each mean what the framework says, so the exports of one reserved
//! name form roles of their own ([`drift_mine::roles::RoleSelector::export_name`]).
//! A rule every `generateMetadata` follows is not broken by a `generateStaticParams`
//! next to it, and an export of a name no framework reserves keeps its role.
//!
//! The fixtures are pages with metadata, not any dev repository's code.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{role_covers_path, units};

const PKG: &str = "web";
const META: &str = "web/lib/meta.ts#genPageMeta";

fn sym(name: &str, kind: SymbolKind, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind,
        exported_as: vec![name.into()],
        line: 3,
        ..Default::default()
    };
    edit(&mut s);
    s
}

fn wrapped(name: &str) -> Symbol {
    sym(name, SymbolKind::Function, |s| {
        s.wraps.push(Wrap {
            wrapper: META.into(),
            kind: WrapKind::Call,
        });
    })
}

/// A page file at `web/app/<dir>/page.tsx` with a Next.js page entry point (its
/// default export) when `next` is true, and `symbols`.
fn page(dir: &str, next: bool, mut symbols: Vec<Symbol>) -> FileFacts {
    symbols.push(sym("Page", SymbolKind::Component, |s| {
        s.exported_as = vec!["default".into()];
    }));
    FileFacts {
        path: format!("web/app/{dir}/page.tsx"),
        package: PKG.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        entry_points: if next {
            vec![EntryPoint {
                symbol: "default".into(),
                kind: "page".into(),
                method: None,
                route: Some(format!("/{dir}")),
                adapter: "nextjs".into(),
            }]
        } else {
            vec![]
        },
        ..Default::default()
    }
}

/// 30 pages exporting `generateMetadata = genPageMeta(...)`, one with a
/// `generateMetadata` that skips it, and `extra`; the wrapper, and 60 plain functions
/// in another package so the rule has lift.
fn repo(next: bool, extra: Vec<FileFacts>) -> RepoFacts {
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| page(&format!("g-{i}"), next, vec![wrapped("generateMetadata")]))
        .collect();
    files.push(page(
        "odd",
        next,
        vec![sym("generateMetadata", SymbolKind::Function, |_| {})],
    ));
    files.extend(extra);
    files.push(FileFacts {
        path: "web/lib/meta.ts".into(),
        package: PKG.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![sym("genPageMeta", SymbolKind::Function, |_| {})],
        ..Default::default()
    });
    for i in 0..60 {
        files.push(FileFacts {
            path: format!("api/src/util/u{i}.ts"),
            package: "api".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![sym(&format!("util{i}"), SymbolKind::Function, |_| {})],
            ..Default::default()
        });
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// Two pages that also export a `generateStaticParams` function without the wrapper.
fn with_static_params(next: bool) -> RepoFacts {
    repo(
        next,
        (0..2)
            .map(|k| {
                page(
                    &format!("p-{k}"),
                    next,
                    vec![sym("generateStaticParams", SymbolKind::Function, |_| {})],
                )
            })
            .collect(),
    )
}

fn candidate(r: &RepoFacts) -> Option<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 })
        .candidates
        .into_iter()
        .find(|c| {
            c.rule
                == Rule::WrappedBy {
                    kind: WrapKind::Call,
                    any_of: vec![META.into()],
                }
        })
}

fn outliers(c: &Candidate) -> Vec<(String, String)> {
    c.outliers
        .iter()
        .map(|o| (o.path.clone(), o.symbol.clone()))
        .collect()
}

#[test]
fn each_reserved_export_is_a_role_of_its_own() {
    let r = with_static_params(true);
    let c = candidate(&r).expect("every generateMetadata wraps genPageMeta");
    assert_eq!(c.role.export_name.as_deref(), Some("generateMetadata"));
    assert_eq!(
        c.role.describe(),
        "web: functions named `generateMetadata` in app/** (page files)"
    );
    // The `generateStaticParams` exports are not members of it.
    assert_eq!((c.evidence.holders, c.evidence.total), (30, 31));
    assert_eq!(
        outliers(&c),
        [("web/app/odd/page.tsx".into(), "generateMetadata".into())]
    );
    // `drift check` agrees.
    let kinds = mine(&r, &MineOptions { max_per_repo: 200 }).kinds;
    let mut p = ConventionsFile::merge(None, "test", kinds.clone(), std::slice::from_ref(&c));
    p.conventions[0].status = Status::Accepted;
    let report = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    let v: Vec<(String, String)> = report
        .violations
        .iter()
        .map(|v| (v.path.clone(), v.symbol.clone()))
        .collect();
    assert_eq!(v, outliers(&c));
    // A new page file may export one, so the role covers it; a units' role keeps the
    // name.
    assert!(role_covers_path(
        &c.role,
        "web/app/new/page.tsx",
        None,
        None,
        &kinds
    ));
    let all = units(&r, &kinds);
    let sp = all
        .iter()
        .find(|u| u.name() == "generateStaticParams")
        .unwrap();
    assert!(
        sp.roles
            .iter()
            .all(|r| r.export_name.as_deref() == Some("generateStaticParams"))
    );
}

/// Outside a file a Next.js adapter found entry points in, a name is just a name: the
/// exports share the role of functions there, as before.
#[test]
fn a_name_outside_a_next_route_file_keeps_its_role() {
    let r = with_static_params(false);
    let c = candidate(&r).expect("pages wrap genPageMeta");
    assert_eq!(c.role.export_name, None);
    assert_eq!(c.role.describe(), "web: functions in app/** (page files)");
    assert_eq!((c.evidence.holders, c.evidence.total), (30, 33));
}

/// A role of a reserved name is not nested in the role of other exports at its place,
/// nor they in it: of the two `genPageMeta()` rules, each keeps its own folder.
#[test]
fn a_reserved_role_is_no_child_of_the_others() {
    let mut extra: Vec<FileFacts> = (0..33)
        .map(|i| {
            let s = if i < 30 {
                wrapped("loader")
            } else {
                sym("loader", SymbolKind::Function, |_| {})
            };
            page(&format!("tools/t-{i}"), true, vec![s])
        })
        .collect();
    // Two more `generateMetadata` without the wrapper: one outside the guides, one
    // among them.
    for dir in ["odd-2", "g-odd"] {
        extra.push(page(
            dir,
            true,
            vec![sym("generateMetadata", SymbolKind::Function, |_| {})],
        ));
    }
    let mut r = repo(true, extra);
    // The guide pages sit in `app/guides/`, so their role there (30 of 31) is clearly
    // higher than the reserved role of `app/` (30 of 33) and than the loaders' (30 of
    // 33), which is not its parent: the loaders' rule stays at `app/`.
    for f in &mut r.files {
        if let Some(rest) = f.path.strip_prefix("web/app/g-") {
            f.path = format!("web/app/guides/g-{rest}");
        }
    }
    r.normalize();
    let cs = mine(&r, &MineOptions { max_per_repo: 200 }).candidates;
    let rule = Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: vec![META.into()],
    };
    let loaders: Vec<&str> = cs
        .iter()
        .filter(|c| c.rule == rule && c.role.export_name.is_none())
        .map(|c| c.role.dir.as_str())
        .collect();
    assert_eq!(
        loaders,
        ["app"],
        "{:?}",
        cs.iter().map(|c| c.role.describe()).collect::<Vec<_>>()
    );
    let metadata: Vec<&str> = cs
        .iter()
        .filter(|c| c.rule == rule && c.role.export_name.as_deref() == Some("generateMetadata"))
        .map(|c| c.role.dir.as_str())
        .collect();
    assert_eq!(metadata, ["app/guides"]);
}

/// `drift check`'s (path, symbol) violations of `p` on `r`.
fn violations(r: &RepoFacts, p: &ConventionsFile) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = check(r, p, &Lock::default(), Scope::Accepted, None)
        .violations
        .iter()
        .map(|v| (v.path.clone(), v.symbol.clone()))
        .collect();
    v.sort();
    v
}

/// A frozen selector keeps its meaning. A policy accepted before reserved exports had
/// roles of their own ("functions in app/** (page files) are wrapped in genPageMeta()",
/// written with no `selector_version`) still checks every function at its place,
/// reserved exports included, though mining now splits them: the `generateMetadata`
/// that skips the wrapper is still reported, and so are the `generateStaticParams` it
/// held then. A convention first written now reads the selector as mining does.
#[test]
fn a_policy_accepted_before_the_split_keeps_checking_what_it_checked() {
    // The policy as it was accepted: mined when these exports shared one role.
    let before = with_static_params(false);
    let mined_before = mine(&before, &MineOptions { max_per_repo: 200 });
    let c = candidate(&before).expect("pages wrap genPageMeta");
    assert_eq!(c.role.export_name, None);
    let mut p = ConventionsFile::merge(
        None,
        "test",
        mined_before.kinds.clone(),
        std::slice::from_ref(&c),
    );
    p.conventions[0].status = Status::Accepted;
    let dir = tempfile::tempdir().unwrap();
    p.save(dir.path()).unwrap();
    let path = dir.path().join(".drift/conventions.yaml");
    let written = std::fs::read_to_string(&path).unwrap();
    assert!(written.contains("selector_version: 3"), "{written}");
    // A file written before this change has no `selector_version`.
    let old: String = written
        .lines()
        .filter(|l| !l.trim_start().starts_with("selector_version:"))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(&path, old).unwrap();
    let legacy = ConventionsFile::load(dir.path()).unwrap().unwrap();
    assert_eq!(legacy.conventions[0].selector_version, 1);

    // The same pages, now Next.js route files: mining gives reserved names roles of
    // their own.
    let after = with_static_params(true);
    let all = units(&after, &legacy.file_kinds);
    let odd = all
        .iter()
        .find(|u| u.path() == "web/app/odd/page.tsx" && u.name() == "generateMetadata")
        .unwrap();
    assert!(odd.roles.iter().all(|r| r.export_name.is_some()));
    assert!(!odd.in_role(&legacy.conventions[0].role));

    let reported = [
        ("web/app/odd/page.tsx", "generateMetadata"),
        ("web/app/p-0/page.tsx", "generateStaticParams"),
        ("web/app/p-1/page.tsx", "generateStaticParams"),
    ]
    .map(|(p, s)| (p.to_string(), s.to_string()));
    assert_eq!(violations(&before, &legacy), reported);
    assert_eq!(violations(&after, &legacy), reported);
    // Which conventions apply to a page that only exports a `generateMetadata`.
    let page_only = page(
        "new",
        true,
        vec![sym("generateMetadata", SymbolKind::Function, |_| {})],
    );
    let covers = |c: &drift_mine::policy::Convention| {
        drift_mine::roles::convention_role_covers_path(
            &c.role,
            c.selector_version,
            &page_only.path,
            Some(&page_only),
            None,
            &legacy.file_kinds,
        )
    };
    assert!(covers(&legacy.conventions[0]));

    // Written now, the same selector is read as mining reads it.
    let mut current = legacy.clone();
    current.conventions[0].selector_version = drift_mine::policy::SELECTOR_VERSION;
    assert_eq!(violations(&after, &current), []);
    assert!(!covers(&current.conventions[0]));
}

/// `c` accepted before reserved exports had roles of their own: a policy written then
/// has no `selector_version` (version 1).
fn accepted_before_the_split(
    kinds: drift_mine::roles::FileKinds,
    c: &Candidate,
) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "test", kinds, std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    p.conventions[0].selector_version = 1;
    p
}

/// `drift check`'s exemptions of `p` on `r`, as (path, symbol, code).
fn exemptions(r: &RepoFacts, p: &ConventionsFile) -> Vec<(String, String, String)> {
    check(r, p, &Lock::default(), Scope::Accepted, None)
        .exempt
        .iter()
        .map(|e| (e.path.clone(), e.symbol.clone(), e.code.clone()))
        .collect()
}

const DOCUMENTED: &str = "pkg:@acme/docs#Documented";
const HIDDEN: &str = "pkg:@acme/docs#Hidden";

fn decorated(name: &str, with: &[&str]) -> Symbol {
    sym(name, SymbolKind::Function, |s| {
        for d in with {
            s.wraps.push(Wrap {
                wrapper: (*d).into(),
                kind: WrapKind::Decorator,
            });
        }
    })
}

/// 30 page loaders decorated with `@Documented()`, two that carry `@Hidden()` of the
/// same package instead, and two pages whose `generateMetadata` carries both.
fn opt_out_pages(next: bool) -> RepoFacts {
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| {
            page(
                &format!("g-{i}"),
                next,
                vec![decorated("loader", &[DOCUMENTED])],
            )
        })
        .collect();
    for i in 0..2 {
        files.push(page(
            &format!("odd-{i}"),
            next,
            vec![decorated("loader", &[HIDDEN])],
        ));
        files.push(page(
            &format!("m-{i}"),
            next,
            vec![decorated("generateMetadata", &[DOCUMENTED, HIDDEN])],
        ));
    }
    for i in 0..60 {
        files.push(FileFacts {
            path: format!("api/src/util/u{i}.ts"),
            package: "api".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![sym(&format!("util{i}"), SymbolKind::Function, |_| {})],
            ..Default::default()
        });
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// A frozen selector keeps its exemptions too: every lookup of the members of a
/// version-1 convention's role finds the members it held when accepted, reserved
/// exports included. Accepted when every function at its place shared one role, "decorated
/// with `@Documented()`" counted the `generateMetadata` that carry `@Hidden()` among
/// its holders, so `@Hidden()` was no opt-out (a decorator no holder carries) and the
/// two loaders that carry it were reported. Today the `generateMetadata` have a role of
/// their own: read with today's members, `@Hidden()` would be on no holder and newly
/// exempt both loaders.
#[test]
fn a_policy_accepted_before_the_split_keeps_its_opt_outs() {
    let before = opt_out_pages(false);
    let mined = mine(&before, &MineOptions { max_per_repo: 200 });
    let rule = Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![DOCUMENTED.into()],
    };
    let c = mined
        .candidates
        .iter()
        .find(|c| c.rule == rule && c.role.export_name.is_none())
        .expect("page functions are decorated with Documented");
    let legacy = accepted_before_the_split(mined.kinds.clone(), c);
    let reported = [
        ("web/app/odd-0/page.tsx", "loader"),
        ("web/app/odd-1/page.tsx", "loader"),
    ]
    .map(|(p, s)| (p.to_string(), s.to_string()));
    assert_eq!(violations(&before, &legacy), reported);
    assert_eq!(exemptions(&before, &legacy), []);

    let after = opt_out_pages(true);
    assert_eq!(violations(&after, &legacy), reported);
    assert_eq!(exemptions(&after, &legacy), []);

    // Written now, the selector holds today's members: `@Hidden()` is on no holder.
    let mut current = legacy.clone();
    current.conventions[0].selector_version = drift_mine::policy::SELECTOR_VERSION;
    assert_eq!(violations(&after, &current), []);
    assert_eq!(
        exemptions(&after, &current),
        reported.map(|(p, s)| (p, s, "opt_out".to_string()))
    );
}

const BASE: &str = "web/lib/base.ts#Base";
const THING: &str = "pkg:@acme/ui#Thing";

fn class(name: &str, exported: &str, extends: bool, decorators: &[&str]) -> Symbol {
    sym(name, SymbolKind::Class, |s| {
        s.exported_as = vec![exported.into()];
        if extends {
            s.wraps.push(Wrap {
                wrapper: BASE.into(),
                kind: WrapKind::Extends,
            });
        }
        for d in decorators {
            s.wraps.push(Wrap {
                wrapper: (*d).into(),
                kind: WrapKind::Decorator,
            });
        }
    })
}

/// 30 page classes that extend `Base`, one decorated with `@Thing()` that does not,
/// and two pages exporting a class as `metadata` that extends `Base` with `@Thing()`.
fn class_pages(next: bool) -> RepoFacts {
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| {
            page(
                &format!("g-{i}"),
                next,
                vec![class("Loader", "Loader", true, &[])],
            )
        })
        .collect();
    files.push(page(
        "odd",
        next,
        vec![class("Loader", "Loader", false, &[THING])],
    ));
    for i in 0..2 {
        files.push(page(
            &format!("m-{i}"),
            next,
            vec![class("PageMeta", "metadata", true, &[THING])],
        ));
    }
    files.push(FileFacts {
        path: "web/lib/base.ts".into(),
        package: PKG.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![sym("Base", SymbolKind::Class, |_| {})],
        ..Default::default()
    });
    for i in 0..60 {
        files.push(FileFacts {
            path: format!("api/src/util/u{i}.ts"),
            package: "api".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![sym(&format!("Util{i}"), SymbolKind::Class, |_| {})],
            ..Default::default()
        });
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// The classes that follow a version-1 convention's rule are those of its role as
/// accepted. "Classes in app/** (page files) extend Base" was accepted with the classes
/// exported as `metadata` among its holders, whose `@Thing()` puts the `@Thing()` loader
/// on the holders' line: an outlier, not another kind of class. Today those classes have
/// a role of their own: read with today's holders, the loader would newly be exempt
/// (`another_kind`).
#[test]
fn a_policy_accepted_before_the_split_keeps_its_followers() {
    let before = class_pages(false);
    let mined = mine(&before, &MineOptions { max_per_repo: 200 });
    let rule = Rule::WrappedBy {
        kind: WrapKind::Extends,
        any_of: vec![BASE.into()],
    };
    let c = mined
        .candidates
        .iter()
        .find(|c| c.rule == rule && c.role.export_name.is_none())
        .expect("page classes extend Base");
    let legacy = accepted_before_the_split(mined.kinds.clone(), c);
    let reported = [("web/app/odd/page.tsx".to_string(), "Loader".to_string())];
    assert_eq!(violations(&before, &legacy), reported);
    assert_eq!(exemptions(&before, &legacy), []);

    let after = class_pages(true);
    assert_eq!(violations(&after, &legacy), reported);
    assert_eq!(exemptions(&after, &legacy), []);

    let mut current = legacy.clone();
    current.conventions[0].selector_version = drift_mine::policy::SELECTOR_VERSION;
    assert_eq!(violations(&after, &current), []);
    assert_eq!(
        exemptions(&after, &current),
        reported.map(|(p, s)| (p, s, "another_kind".to_string()))
    );
}

/// Page classes: 30 decorated with `@Documented()`, and one that carries `@Hidden()`
/// instead next to a class exported as `metadata` that carries it too.
fn opt_out_classes(next: bool) -> RepoFacts {
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| {
            page(
                &format!("g-{i}"),
                next,
                vec![class("Loader", "Loader", false, &[DOCUMENTED])],
            )
        })
        .collect();
    files.push(page(
        "odd",
        next,
        vec![
            class("Loader", "Loader", false, &[HIDDEN]),
            class("PageMeta", "metadata", false, &[HIDDEN]),
        ],
    ));
    for i in 0..60 {
        files.push(FileFacts {
            path: format!("api/src/util/u{i}.ts"),
            package: "api".into(),
            lang: "ts".into(),
            parse_ok: true,
            symbols: vec![sym(&format!("Util{i}"), SymbolKind::Class, |_| {})],
            ..Default::default()
        });
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// A hook decides a version-1 convention as `drift check` does. Accepted when the class
/// exported as `metadata` shared the role, "classes in app/** (page files) are
/// decorated with `@Documented()`" counts two outliers that carry `@Hidden()`, an
/// opt-out, so `check` exempts the loader that carries it. A route in another file may
/// run that class, which refuses any exemption, so in the facts of one file the
/// exemption is undecided and the hook scans the repo
/// ([`drift_mine::check::needs_full_scan`]) even where today's roles, which hold one
/// such outlier and every holder these facts have, would leave nothing open.
#[test]
fn a_hook_scans_the_repo_for_an_exemption_a_frozen_selector_leaves_open() {
    // The convention on the classes at the place of the loaders: mined as the
    // functions' is, then written for classes.
    let mined = mine(&opt_out_pages(false), &MineOptions { max_per_repo: 200 });
    let rule = Rule::WrappedBy {
        kind: WrapKind::Decorator,
        any_of: vec![DOCUMENTED.into()],
    };
    let mut c = mined
        .candidates
        .iter()
        .find(|c| c.rule == rule && c.role.export_name.is_none())
        .expect("page functions are decorated with Documented")
        .clone();
    c.role.kind = SymbolKind::Class;
    let c = &c;
    let before = opt_out_classes(false);
    let mut legacy = accepted_before_the_split(mined.kinds.clone(), c);
    let after = opt_out_classes(true);
    let opt_outs: Vec<(String, String, String)> = ["Loader", "PageMeta"]
        .map(|s| ("web/app/odd/page.tsx".into(), s.into(), "opt_out".into()))
        .into();
    assert_eq!(exemptions(&before, &legacy), opt_outs);
    assert_eq!(exemptions(&after, &legacy), opt_outs);

    // A repo of one file, with the holders a later `drift init` counted (today's).
    let mut one = after.clone();
    let mut odd = one
        .files
        .iter()
        .find(|f| f.path == "web/app/odd/page.tsx")
        .unwrap()
        .clone();
    for i in 0..3 {
        odd.symbols.push(class(
            &format!("L{i}"),
            &format!("L{i}"),
            false,
            &[DOCUMENTED],
        ));
    }
    one.files = vec![odd];
    one.normalize();
    legacy.conventions[0].evidence.holders = 3;
    assert!(drift_mine::check::needs_full_scan(&one, &legacy));
    let mut current = legacy.clone();
    current.conventions[0].selector_version = drift_mine::policy::SELECTOR_VERSION;
    assert!(!drift_mine::check::needs_full_scan(&one, &current));
}
