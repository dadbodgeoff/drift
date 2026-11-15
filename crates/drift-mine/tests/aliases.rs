//! A plain alias of a function ([`drift_mine::roles::FunctionAliases`]):
//! `export const generateMetadata = referenceMetadata` is that function, exported under
//! another name in another place. It is a member of the role of functions at its place,
//! and what the function does is what it does: an alias of a function without the
//! role's wrapper is an outlier (so the rule's bound drops), an alias of a wrapped one
//! is a holder. A binding to a value, a member or a package's function is no function.
//!
//! The fixtures are documentation pages (`genPageMeta()`), not any dev repository's
//! code.

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{FileKinds, role_covers_path, units};

const PKG: &str = "web";
const META: &str = "web/lib/meta.ts#genPageMeta";
const PLAIN: &str = "web/lib/reference.ts#referenceMetadata";
const WRAPPED: &str = "web/lib/wrapped.ts#wrappedMetadata";

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

fn file(path: &str, package: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: package.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

/// An exported `const generateMetadata` bound to `target`.
fn alias(target: &str) -> Symbol {
    sym("generateMetadata", SymbolKind::Const, |s| {
        s.derives_from = target.into();
    })
}

/// A page file at `dir` exporting `generateMetadata`, edited by `edit`.
fn page(dir: &str, s: Symbol) -> FileFacts {
    file(&format!("web/app/{dir}/page.tsx"), PKG, vec![s])
}

/// `generateMetadata = genPageMeta(...)`.
fn wrapped() -> Symbol {
    sym("generateMetadata", SymbolKind::Function, |s| {
        s.wraps.push(Wrap {
            wrapper: META.into(),
            kind: WrapKind::Call,
        });
    })
}

/// `pages`, plus, in `web/lib/`, the wrapper, an unwrapped `referenceMetadata`, a
/// `wrappedMetadata = genPageMeta(...)`, a plain value `siteName`, an alias of an alias
/// and two aliases of each other. Plus 60 plain functions in another package, so the
/// rule has lift.
fn repo(pages: Vec<FileFacts>) -> RepoFacts {
    let mut files = pages;
    files.push(file(
        "web/lib/meta.ts",
        PKG,
        vec![sym("genPageMeta", SymbolKind::Function, |_| {})],
    ));
    files.push(file(
        "web/lib/reference.ts",
        PKG,
        vec![
            sym("referenceMetadata", SymbolKind::Function, |_| {}),
            sym("siteName", SymbolKind::Const, |_| {}),
            // `export const legacyMetadata = wrappedMetadata`: an alias of a function.
            sym("legacyMetadata", SymbolKind::Const, |s| {
                s.derives_from = WRAPPED.into();
            }),
            // `export const loopA = loopB; export const loopB = loopA`.
            sym("loopA", SymbolKind::Const, |s| {
                s.derives_from = "web/lib/reference.ts#loopB".into();
            }),
            sym("loopB", SymbolKind::Const, |s| {
                s.derives_from = "web/lib/reference.ts#loopA".into();
            }),
        ],
    ));
    files.push(file(
        "web/lib/wrapped.ts",
        PKG,
        vec![{
            let mut s = wrapped();
            s.name = "wrappedMetadata".into();
            s.exported_as = vec!["wrappedMetadata".into()];
            s
        }],
    ));
    for i in 0..60 {
        files.push(file(
            &format!("api/src/util/u{i}.ts"),
            "api",
            vec![sym(&format!("util{i}"), SymbolKind::Function, |_| {})],
        ));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// 30 pages `web/app/g-i/` with the wrapper, one `web/app/odd/` without it, and one
/// page `web/app/r-k/` per entry of `others`.
fn flat(others: Vec<Symbol>) -> RepoFacts {
    let mut pages: Vec<FileFacts> = (0..30)
        .map(|i| page(&format!("g-{i}"), wrapped()))
        .collect();
    pages.push(page(
        "odd",
        sym("generateMetadata", SymbolKind::Function, |_| {}),
    ));
    for (k, s) in others.into_iter().enumerate() {
        pages.push(page(&format!("r-{k}"), s));
    }
    repo(pages)
}

fn rule() -> Rule {
    Rule::WrappedBy {
        kind: WrapKind::Call,
        any_of: vec![META.into()],
    }
}

fn candidate(r: &RepoFacts) -> Option<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 })
        .candidates
        .into_iter()
        .find(|c| c.rule == rule() && c.role.package == PKG)
}

fn outliers(c: &Candidate) -> Vec<String> {
    c.outliers.iter().map(|o| o.path.clone()).collect()
}

/// `drift check` with `c` accepted: the files it reports.
fn violations(r: &RepoFacts, c: &Candidate) -> Vec<String> {
    let kinds = mine(r, &MineOptions { max_per_repo: 200 }).kinds;
    let mut p = ConventionsFile::merge(None, "test", kinds, std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    let report = check(r, &p, &Lock::default(), Scope::Accepted, None);
    let mut v: Vec<String> = report.violations.iter().map(|v| v.path.clone()).collect();
    v.sort();
    v
}

#[test]
fn an_alias_of_another_function_is_a_member_without_the_wrapper() {
    let r = flat(vec![alias(PLAIN), alias(PLAIN)]);
    let c = candidate(&r).expect("pages wrap genPageMeta");
    assert_eq!(c.role.describe(), "web: functions in app/** (page files)");
    assert_eq!((c.evidence.holders, c.evidence.total), (30, 33));
    let outliers_ = [
        "web/app/odd/page.tsx",
        "web/app/r-0/page.tsx",
        "web/app/r-1/page.tsx",
    ];
    assert_eq!(outliers(&c), outliers_);
    // `drift check` agrees.
    assert_eq!(violations(&r, &c), outliers_);
}

/// Members that alias a function without the wrapper are members that do it
/// differently: three of them, and the bound no longer clears the bar.
#[test]
fn aliases_that_do_it_differently_lower_the_bound() {
    let r = flat(vec![alias(PLAIN), alias(PLAIN), alias(PLAIN)]);
    assert!(candidate(&r).is_none(), "{:?}", candidate(&r));
}

/// D-c2e88c's shape: the wrapped pages are guides, the aliases are elsewhere. Counted,
/// they take the whole folder's bound down, and the rule is the guides'.
#[test]
fn aliases_elsewhere_leave_the_rule_to_the_folder_that_follows_it() {
    let mut pages: Vec<FileFacts> = (0..30)
        .map(|i| page(&format!("guides/g-{i}"), wrapped()))
        .collect();
    // One guide page aliases the unwrapped function too.
    pages.push(page("guides/prompts", alias(PLAIN)));
    for k in 0..4 {
        pages.push(page(&format!("reference/r-{k}"), alias(PLAIN)));
    }
    let r = repo(pages);
    let c = candidate(&r).expect("guide pages wrap genPageMeta");
    assert_eq!(
        c.role.describe(),
        "web: functions in app/guides/** (page files)"
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (30, 31));
    assert_eq!(outliers(&c), ["web/app/guides/prompts/page.tsx"]);
}

/// An alias of a function wrapped in the rule's wrapper carries it, directly or
/// through another alias.
#[test]
fn an_alias_of_a_wrapped_function_holds_the_rule() {
    let r = flat(vec![
        alias(WRAPPED),
        alias(PLAIN),
        alias("web/lib/reference.ts#legacyMetadata"),
    ]);
    let c = candidate(&r).expect("pages wrap genPageMeta");
    assert_eq!((c.evidence.holders, c.evidence.total), (32, 34));
    let outliers_ = ["web/app/odd/page.tsx", "web/app/r-1/page.tsx"];
    assert_eq!(outliers(&c), outliers_);
    assert_eq!(violations(&r, &c), outliers_);
}

/// A binding to a value, to a member of something, to a package's function, to
/// nothing the facts define or to a loop of aliases is no function: not a member of
/// the role.
#[test]
fn a_binding_to_anything_else_is_no_function() {
    for target in [
        "web/lib/reference.ts#siteName",
        "web/lib/reference.ts#referenceMetadata.bind",
        "web/lib/reference.ts#loopA",
        "pkg:next#generateMetadata",
        "web/lib/missing.ts#referenceMetadata",
    ] {
        let r = flat(vec![alias(target); 4]);
        let c = candidate(&r).unwrap_or_else(|| panic!("{target}"));
        assert_eq!((c.evidence.holders, c.evidence.total), (30, 31), "{target}");
        let kinds = FileKinds::learn(&r);
        let u = units(&r, &kinds);
        let a = u
            .iter()
            .find(|u| u.path() == "web/app/r-0/page.tsx" && u.name() == "generateMetadata")
            .unwrap();
        assert_eq!(a.kind(), SymbolKind::Const, "{target}");
        assert!(a.alias.is_none(), "{target}");
    }
}

/// Which conventions apply to an existing file: a role of functions covers a file
/// whose only symbol is a plain alias, which may be one of its functions.
#[test]
fn a_role_of_functions_covers_a_file_with_an_alias() {
    let r = flat(vec![alias(PLAIN), alias(PLAIN)]);
    let c = candidate(&r).unwrap();
    let kinds = FileKinds::learn(&r);
    let at = |s: Symbol| file("web/app/new/page.tsx", PKG, vec![s]);
    let aliased = at(alias("web/lib/other.ts#otherMetadata"));
    assert!(role_covers_path(
        &c.role,
        &aliased.path,
        Some(&aliased),
        None,
        &kinds
    ));
    // A plain value there is not a function.
    let value = at(sym("revalidate", SymbolKind::Const, |_| {}));
    assert!(!role_covers_path(
        &c.role,
        &value.path,
        Some(&value),
        None,
        &kinds
    ));
}

/// An entry point that is an alias (`export const GET = handler` in a route file)
/// keeps its own kind and facts: it stays with its route's other handlers, as before.
#[test]
fn an_entry_point_alias_keeps_its_own_kind() {
    let mut r = flat(vec![alias(PLAIN), alias(PLAIN)]);
    let f = r
        .files
        .iter_mut()
        .find(|f| f.path == "web/app/r-0/page.tsx")
        .unwrap();
    f.entry_points.push(EntryPoint {
        symbol: "generateMetadata".into(),
        kind: "http".into(),
        method: Some("GET".into()),
        route: Some("/r-0".into()),
        adapter: "nextjs".into(),
    });
    let kinds = FileKinds::learn(&r);
    let u = units(&r, &kinds);
    let at = |p: &str| {
        u.iter()
            .find(|u| u.path() == p && u.name() == "generateMetadata")
            .unwrap()
    };
    let entry = at("web/app/r-0/page.tsx");
    assert_eq!(
        (entry.kind(), entry.alias.is_none()),
        (SymbolKind::Const, true)
    );
    let other = at("web/app/r-1/page.tsx");
    assert_eq!(
        (other.kind(), other.alias.is_some()),
        (SymbolKind::Function, true)
    );
}
