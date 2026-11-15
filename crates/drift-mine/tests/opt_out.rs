//! Opt-outs from a decorator rule ([`drift_mine::opt_out`]) and the target that is never
//! its own member: each clause has a fixture that exempts and a counter-case that must
//! stay an outlier, and `check` (and a single-file scan, through `needs_full_scan`)
//! agrees with mining. Like every exemption, an opt-out runs behind the exemption gate
//! (`Rule::exemption_allowed`): a route never opts out, so the fixtures that exempt are
//! decorated functions that are not entry points, and the routed fixture shows the gate.

use std::collections::BTreeSet;

use drift_core::{EntryPoint, FileFacts, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, check, needs_full_scan};
use drift_mine::context::RepoContext;
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::{View, units};

const DOCS: &str = "src/decorators.ts#Endpoint";
const EXCLUDE: &str = "pkg:@nestjs/swagger#ApiExcludeEndpoint";
const OPERATION: &str = "pkg:@nestjs/swagger#ApiOperation";

fn sym(name: &str, kind: SymbolKind, edit: impl FnOnce(&mut Symbol)) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind,
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
        package: String::new(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn deco(wrapper: &str) -> Wrap {
    Wrap {
        wrapper: wrapper.into(),
        kind: WrapKind::Decorator,
    }
}

/// What the controllers of a fixture carry.
struct Nest<'a> {
    /// The target's file and what its body calls.
    target: &'a str,
    target_calls: &'a [&'a str],
    /// Entry-point adapter of the handlers.
    adapter: &'a str,
    /// The handlers are routes (entry points of `adapter`); otherwise they are decorated
    /// functions no route reaches.
    routed: bool,
    /// Decorators of the opt-out handlers (which lack the target), one list per handler.
    opted: Vec<Vec<&'a str>>,
    /// Extra decorators of the first holder.
    holder_extra: &'a [&'a str],
}

impl Default for Nest<'_> {
    fn default() -> Self {
        Self {
            target: DOCS,
            target_calls: &[
                "global#console.log",
                "pkg:@nestjs/common#applyDecorators",
                "pkg:@nestjs/swagger#ApiOperation",
                "pkg:@nestjs/swagger#ApiTags",
            ],
            adapter: "nestjs",
            routed: false,
            opted: vec![vec![EXCLUDE], vec![EXCLUDE], vec![EXCLUDE]],
            holder_extra: &[],
        }
    }
}

/// Four controllers of 10 handlers each (routes when `routed`): every handler is `@Get()`, the holders are
/// decorated with the target, `missing` (in `c0`) carries nothing else, and the opt-out
/// handlers (`opt0`, `opt1`, ... in `c1`) carry their decorators instead. Plus the
/// target's own file and 40 plain functions for lift.
fn nest(n: &Nest) -> RepoFacts {
    let mut files = Vec::new();
    let (tpath, tname) = n.target.split_once('#').unwrap();
    if !n.target.starts_with("pkg:") {
        files.push(file(
            tpath,
            vec![sym(tname, SymbolKind::Function, |s| {
                s.calls = n.target_calls.iter().map(|c| c.to_string()).collect();
            })],
        ));
    }
    for f in 0..4 {
        let mut symbols = Vec::new();
        let mut entries = Vec::new();
        let mut handler = |name: String, decorators: Vec<&str>| {
            symbols.push(sym(&name, SymbolKind::Function, |s| {
                s.line = symbols_line(f, &name);
                s.wraps = std::iter::once("pkg:@nestjs/common#Get")
                    .chain(decorators)
                    .map(deco)
                    .collect();
            }));
            entries.push(EntryPoint {
                symbol: name,
                kind: "http".into(),
                method: Some("GET".into()),
                route: Some(format!("/r{f}")),
                adapter: n.adapter.into(),
            });
        };
        for i in 0..10 {
            let mut d = vec![n.target];
            if f == 0 && i == 0 {
                d.extend(n.holder_extra);
            }
            handler(format!("GET /r{f}/h{i}"), d);
        }
        if f == 0 {
            handler("missing".into(), vec![]);
        }
        if f == 1 {
            for (i, d) in n.opted.iter().enumerate() {
                handler(format!("opt{i}"), d.clone());
            }
        }
        let mut c = file(&format!("src/c{f}.controller.ts"), symbols);
        if n.routed {
            c.entry_points = entries;
        }
        files.push(c);
    }
    for i in 0..40 {
        files.push(file(
            &format!("misc/m{i}.ts"),
            vec![sym("run", SymbolKind::Function, |_| {})],
        ));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// Distinct lines per handler, so outliers sort and compare by line.
fn symbols_line(f: usize, name: &str) -> u32 {
    (f as u32 + 1) * 100 + name.len() as u32 + name.bytes().map(u32::from).sum::<u32>() % 50
}

fn mined(r: &RepoFacts) -> Vec<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 }).candidates
}

/// Every rule family, including TypeScript call rules, which are never proposed
/// (`mine::hidden_call_rule`): for what such a rule is about, which still decides
/// `check` on conventions accepted before.
fn mined_every(r: &RepoFacts) -> Vec<Candidate> {
    drift_mine::mine::mine_every_family(r, &MineOptions { max_per_repo: 200 }).candidates
}

/// The convention "decorated with `target`", if mined.
fn decorated(cs: &[Candidate], target: &str) -> Option<Candidate> {
    cs.iter()
        .find(|c| {
            matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Decorator, any_of }
                if any_of == &[target.to_string()])
        })
        .cloned()
}

fn outliers(c: &Candidate) -> BTreeSet<String> {
    c.outliers.iter().map(|o| o.symbol.clone()).collect()
}

fn exempt(c: &Candidate) -> BTreeSet<String> {
    c.exempt.iter().map(|o| o.symbol.clone()).collect()
}

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|s| s.to_string()).collect()
}

/// `c` accepted, over the file kinds mined from `r`.
fn accepted(r: &RepoFacts, c: &Candidate) -> ConventionsFile {
    let kinds = mine(r, &MineOptions::default()).kinds;
    let mut p = ConventionsFile::merge(None, "test", kinds, std::slice::from_ref(c));
    p.conventions[0].status = Status::Accepted;
    p
}

fn violators(r: &RepoFacts, p: &ConventionsFile) -> BTreeSet<String> {
    check(r, p, &Lock::default(), Scope::Accepted, None)
        .violations
        .iter()
        .map(|v| v.symbol.clone())
        .collect()
}

/// Mines `n`, and checks that `check` reports exactly the census outliers.
fn census(n: &Nest) -> (Candidate, RepoFacts) {
    let r = nest(n);
    let c = decorated(&mined(&r), n.target).expect("the decorator convention is mined");
    assert_eq!(
        violators(&r, &accepted(&r, &c)),
        outliers(&c),
        "check agrees"
    );
    (c, r)
}

// Clauses 1 to 5 hold: a decorator of the one package the target wraps, on no holder and
// on three outliers, opts them out. A real outlier stays one.
#[test]
fn an_opt_out_from_the_wrapped_package_is_exempt() {
    let (c, _) = census(&Nest::default());
    assert_eq!(outliers(&c), set(&["missing"]));
    assert_eq!(exempt(&c), set(&["opt0", "opt1", "opt2"]));
    assert_eq!((c.evidence.holders, c.evidence.total), (40, 41));
    assert_eq!(c.evidence.role_members, Some(44));
    assert_eq!(
        c.exempt[0].reason,
        "opts out with ApiExcludeEndpoint() (@nestjs/swagger, the package Endpoint() wraps)"
    );
}

// Clause 5: nothing is read from the decorator's name.
#[test]
fn an_opt_out_needs_no_name() {
    let z = "pkg:@nestjs/swagger#Zebra";
    let (c, _) = census(&Nest {
        opted: vec![vec![z], vec![z]],
        ..Default::default()
    });
    assert_eq!(exempt(&c), set(&["opt0", "opt1"]));
    assert_eq!(outliers(&c), set(&["missing"]));
}

// An external target wraps its own package.
#[test]
fn an_external_targets_package_is_its_own() {
    let (c, _) = census(&Nest {
        target: OPERATION,
        ..Default::default()
    });
    assert_eq!(exempt(&c), set(&["opt0", "opt1", "opt2"]));
    assert_eq!(
        c.exempt[0].reason,
        "opts out with ApiExcludeEndpoint() (@nestjs/swagger, ApiOperation's own package)"
    );
}

// Clause 1: an auth decorator that mixes behaviour (`SetMetadata`) with docs wraps two
// packages; a docs decorator only on its outliers does not opt them out.
#[test]
fn an_auth_decorator_with_docs_only_on_outliers_keeps_its_outliers() {
    let (c, _) = census(&Nest {
        target: "src/guard.ts#Authenticated",
        target_calls: &[
            "pkg:@nestjs/common#SetMetadata",
            "pkg:@nestjs/common#applyDecorators",
            "pkg:@nestjs/swagger#ApiBearerAuth",
        ],
        ..Default::default()
    });
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(outliers(&c), set(&["missing", "opt0", "opt1", "opt2"]));
}

// Clause 1: a wrapper that mixes two packages, or calls into the repo (which could
// wrap anything), wraps no single package.
#[test]
fn a_wrapper_of_several_packages_or_of_the_repo_has_no_opt_out() {
    for calls in [
        &[
            "pkg:@nestjs/swagger#ApiOperation",
            "pkg:class-transformer#Expose",
        ][..],
        &["pkg:@nestjs/swagger#ApiOperation", "src/util.ts#describe"][..],
        &["pkg:@nestjs/swagger#ApiOperation", "unresolved:./x#y"][..],
        &["pkg:@nestjs/common#applyDecorators"][..],
    ] {
        let (c, _) = census(&Nest {
            target_calls: calls,
            ..Default::default()
        });
        assert!(c.exempt.is_empty(), "{calls:?}: {:?}", c.exempt);
    }
}

// A guard- or auth-shaped target never has an opt-out, whatever it wraps.
#[test]
fn a_guard_shaped_target_has_no_opt_out() {
    for (target, calls) in [
        (
            "src/auth.ts#Documented",
            &["pkg:@nestjs/swagger#ApiOperation"][..],
        ),
        (
            "src/docs.ts#Protected",
            &["pkg:@nestjs/swagger#ApiOperation"][..],
        ),
        (
            "src/docs.ts#Documented",
            &[
                "pkg:@nestjs/swagger#ApiOperation",
                "pkg:@nestjs/swagger#ApiBearerAuth",
            ][..],
        ),
        (
            "src/docs.ts#Documented",
            &["pkg:@nestjs/passport#Strategy"][..],
        ),
    ] {
        let opt = if calls.iter().any(|c| c.contains("passport")) {
            "pkg:@nestjs/passport#Skip"
        } else {
            EXCLUDE
        };
        let (c, _) = census(&Nest {
            target,
            target_calls: calls,
            opted: vec![vec![opt], vec![opt], vec![opt]],
            ..Default::default()
        });
        assert!(c.exempt.is_empty(), "{target} {calls:?}: {:?}", c.exempt);
        assert_eq!(c.outliers.len(), 4, "{target}");
    }
}

// Clause 2: a decorator of the entry points' framework says how a handler runs. The same
// fixture under an adapter the framework table does not know would exempt. Routes never
// reach the opt-out through the gate (see the test after this one), so the clause is
// asked directly, as `Rule::exemption_in` would ask it once the gate let a member through.
#[test]
fn the_framework_package_is_never_an_opt_out() {
    let code = "pkg:@nestjs/common#HttpCode";
    let n = |adapter| Nest {
        target_calls: &[
            "pkg:@nestjs/common#applyDecorators",
            "pkg:@nestjs/common#UseInterceptors",
        ],
        adapter,
        routed: true,
        opted: vec![vec![code], vec![code], vec![code]],
        ..Default::default()
    };
    for (adapter, opts_out) in [("nestjs", false), ("other", true)] {
        let r = nest(&n(adapter));
        let c = decorated(&mined(&r), DOCS).expect("the decorator convention is mined");
        assert!(
            c.exempt.is_empty(),
            "{adapter}: routes are never exempt: {:?}",
            c.exempt
        );
        let kinds = mine(&r, &MineOptions::default()).kinds;
        let all = units(&r, &kinds);
        let ctx = RepoContext::new(&r, &all);
        let opt = all
            .iter()
            .find_map(|u| match &u.view {
                View::Symbol(_, s) if s.name == "opt0" => Some(*s),
                _ => None,
            })
            .unwrap();
        assert_eq!(
            drift_mine::opt_out::exemption(DOCS, &c.role, opt, &ctx).is_some(),
            opts_out,
            "{adapter}"
        );
    }
}

// The exemption gate: an opt-out never exempts an entry point, and never under a guard
// rule. Here the handlers are routes and `@Endpoint()` decorates them (a guard as
// `drift security` reads guards). The opt-outs that exempt the same handlers when no
// route reaches them stay outliers, and `check` reports them.
#[test]
fn an_opt_out_never_exempts_a_route_under_a_guard_decorator() {
    let (c, _) = census(&Nest::default());
    assert_eq!(
        exempt(&c),
        set(&["opt0", "opt1", "opt2"]),
        "not routed: opts out"
    );
    let routed = Nest {
        routed: true,
        ..Default::default()
    };
    let (c, r) = census(&routed);
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(outliers(&c), set(&["missing", "opt0", "opt1", "opt2"]));
    let kinds = mine(&r, &MineOptions::default()).kinds;
    let all = units(&r, &kinds);
    let ctx = RepoContext::new(&r, &all);
    assert!(ctx.is_guard(DOCS), "the target guards the routes");
    let opt = all
        .iter()
        .find(|u| matches!(&u.view, View::Symbol(_, s) if s.name == "opt0"))
        .unwrap();
    assert!(!c.rule.exemption_allowed(&opt.view, &ctx));
    assert!(violators(&r, &accepted(&r, &c)).contains("opt0"));
    // An auth decorator on routes, one of which opts out: the route stays an outlier.
    let (c, _) = census(&Nest {
        target: "src/auth.ts#RequireTeam",
        routed: true,
        opted: vec![vec![EXCLUDE], vec![EXCLUDE]],
        ..Default::default()
    });
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(outliers(&c), set(&["missing", "opt0", "opt1"]));
}

// Clause 3: the primitive the wrapper wraps, written by hand, bypasses the wrapper.
#[test]
fn a_bare_primitive_is_a_bypass_not_an_opt_out() {
    let (c, _) = census(&Nest {
        opted: vec![vec![OPERATION], vec![OPERATION], vec![OPERATION]],
        ..Default::default()
    });
    assert!(c.exempt.is_empty(), "{:?}", c.exempt);
    assert_eq!(outliers(&c), set(&["missing", "opt0", "opt1", "opt2"]));
}

// Clause 4: a decorator one holder carries is not an opt-out from the target, and one on
// a single outlier is that member's own choice.
#[test]
fn an_opt_out_is_on_no_holder_and_several_outliers() {
    let (c, _) = census(&Nest {
        holder_extra: &[EXCLUDE],
        ..Default::default()
    });
    assert!(c.exempt.is_empty(), "on a holder: {:?}", c.exempt);
    let (c, _) = census(&Nest {
        opted: vec![vec![EXCLUDE]],
        ..Default::default()
    });
    assert!(c.exempt.is_empty(), "on one outlier: {:?}", c.exempt);
    assert_eq!(outliers(&c), set(&["missing", "opt0"]));
}

// A single file's facts cannot count clause 4: a file with a possible opt-out falls back
// to a full scan; a file whose outliers carry none (once the target's body says what it
// wraps), or one with only holders, does not.
#[test]
fn a_single_file_with_a_possible_opt_out_needs_a_full_scan() {
    let (c, r) = census(&Nest::default());
    let p = accepted(&r, &c);
    let alone = |path: &str, with_target: bool| {
        let mut one = RepoFacts {
            files: r
                .files
                .iter()
                .filter(|f| f.path == path || (with_target && f.path == "src/decorators.ts"))
                .cloned()
                .collect(),
            ..Default::default()
        };
        one.normalize();
        one
    };
    for with_target in [false, true] {
        assert!(needs_full_scan(
            &alone("src/c1.controller.ts", with_target),
            &p
        ));
        // `missing` may be a shared part of the role (#52, F5), which a single file cannot
        // count either; whether it may be an opt-out is asked below.
        assert!(needs_full_scan(
            &alone("src/c0.controller.ts", with_target),
            &p
        ));
        assert!(!needs_full_scan(
            &alone("src/c2.controller.ts", with_target),
            &p
        ));
    }
    // The opt-out part of that: undecided for `opt0`, which carries a decorator of the
    // package the target wraps; not for `missing` once the target's body says what it
    // wraps (`@Get()` is not of that package), and undecided without it.
    for (with_target, path, name, want) in [
        (false, "src/c1.controller.ts", "opt0", true),
        (true, "src/c1.controller.ts", "opt0", true),
        (false, "src/c0.controller.ts", "missing", true),
        (true, "src/c0.controller.ts", "missing", false),
    ] {
        let one = alone(path, with_target);
        let all = units(&one, &p.file_kinds);
        let ctx = RepoContext::new(&one, &all);
        let u = all
            .iter()
            .find(|u| matches!(&u.view, View::Symbol(_, s) if s.name == name))
            .unwrap();
        assert_eq!(
            c.rule
                .exemption_undecided(Some(&c.role), &u.view, &ctx, c.evidence.holders),
            want,
            "{name} with_target={with_target}"
        );
    }
    // The full scan reaches the census verdict.
    assert!(!violators(&r, &p).contains("opt0"));
}

// The target is never its own member: `BaseService` is not an outlier of "extend
// `BaseService`".
#[test]
fn the_target_is_not_its_own_member() {
    let base = "src/base.service.ts#BaseService";
    let mut files = vec![file(
        "src/base.service.ts",
        vec![sym("BaseService", SymbolKind::Class, |_| {})],
    )];
    for i in 0..40 {
        files.push(file(
            &format!("src/s{i}.service.ts"),
            vec![sym(&format!("S{i}Service"), SymbolKind::Class, |s| {
                if i != 0 {
                    s.wraps.push(Wrap {
                        wrapper: base.into(),
                        kind: WrapKind::Extends,
                    });
                }
            })],
        ));
    }
    for i in 0..40 {
        files.push(file(
            &format!("misc/m{i}.ts"),
            vec![sym(&format!("M{i}"), SymbolKind::Class, |_| {})],
        ));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    let c = mined(&r)
        .into_iter()
        .find(|c| {
            matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Extends, any_of }
                if any_of == &[base.to_string()])
        })
        .expect("extends convention");
    assert_eq!(outliers(&c), set(&["S0Service"]));
    // A class rule's target module was already exempt (`defining_module`).
    assert_eq!(exempt(&c), set(&["BaseService"]));
    assert_eq!(violators(&r, &accepted(&r, &c)), set(&["S0Service"]));
}

// The target is never its own member, for a call rule too: `track` is not an outlier of
// "call `track()`".
#[test]
fn a_callee_is_not_its_own_member() {
    let callee = "src/jobs/track.ts#track";
    let mut files = vec![file(
        "src/jobs/track.ts",
        vec![sym("track", SymbolKind::Function, |_| {})],
    )];
    for i in 0..40 {
        files.push(file(
            &format!("src/jobs/j{i}.ts"),
            vec![sym(&format!("job{i}"), SymbolKind::Function, |s| {
                if i != 0 {
                    s.calls.push(callee.into());
                }
            })],
        ));
    }
    for i in 0..40 {
        files.push(file(
            &format!("misc/m{i}.ts"),
            vec![sym(&format!("m{i}"), SymbolKind::Function, |s| {
                // Used outside the role too, so `track` is no shared part of it (#52, F5).
                if i < 2 {
                    s.calls.push(callee.into());
                }
            })],
        ));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    let c = mined_every(&r)
        .into_iter()
        .find(|c| matches!(&c.rule, Rule::Calls { callee: k } if k == callee))
        .expect("calls convention");
    assert_eq!(outliers(&c), set(&["job0"]));
    let own: Vec<_> = c.exempt.iter().filter(|e| e.symbol == "track").collect();
    assert_eq!(own.len(), 1, "{:?}", c.exempt);
    assert_eq!(own[0].reason, "the rule's own target");
    assert_eq!(violators(&r, &accepted(&r, &c)), set(&["job0"]));
}
