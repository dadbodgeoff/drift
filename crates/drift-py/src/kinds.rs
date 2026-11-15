//! Symbol kinds (GAPS P1): what a class is beyond where it sits.
//!
//! A role of "classes in `repository.py` files" should hold repositories, not the
//! NamedTuple and the result dataclass defined next to them, nor the base class the
//! repositories extend. Kinds are recorded as [`Symbol::traits`] facts:
//!
//! - from the class itself (lowering): `abstract` (an `@abstractmethod`,
//!   `metaclass=ABCMeta`, Django/graphene `class Meta: abstract = True`);
//! - from its resolved bases and decorators ([`direct_traits`]): `enum`,
//!   `namedtuple`, `typeddict`, `protocol`, `abstract` (`ABC`), `dataclass`;
//! - from the whole repo ([`classify`]): `base` (named `*Mixin`, `Base*` or
//!   `Abstract*`; in a `base`/`base_*`/`bases`/`mixins` module; extended by two or
//!   more production classes; or extended once, or abstract, and named `*Base`; a
//!   concrete parent extended once, such as a Django proxy parent, stays primary), `view` (a class-based view whose handler methods are
//!   the entry points, or one built on a framework view base that is not routed
//!   itself), and kinds inherited through in-repo bases (a subclass of an in-repo
//!   `Enum` is an enum);
//! - purpose facts from the same pass: `subclassed` (a production class extends it)
//!   and `test_helper` (a production test double or test-support module, by name);
//! - from a value's calls, at link time ([`value_traits`]): `type_var`
//!   (`T = TypeVar("T")`).
//!
//! The same pass turns functions decorated with an in-repo wrapper of a task-queue
//! decorator (polar's `actor`, which calls `dramatiq.actor`) into job entry points.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::traits::{
    ABSTRACT, BASE, DATACLASS, ENUM, NAMEDTUPLE, PROTOCOL, SUBCLASSED, TEST_HELPER, TYPE_VAR,
    TYPEDDICT, VIEW,
};
use drift_core::{EntryPoint, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};

/// Base classes (canonical ids) that make a class of a kind.
const BASE_KINDS: &[(&str, &str)] = &[
    ("pkg:python:enum#Enum", ENUM),
    ("pkg:python:enum#IntEnum", ENUM),
    ("pkg:python:enum#StrEnum", ENUM),
    ("pkg:python:enum#Flag", ENUM),
    ("pkg:python:enum#IntFlag", ENUM),
    ("pkg:python:enum#ReprEnum", ENUM),
    ("pkg:django#db.models.TextChoices", ENUM),
    ("pkg:django#db.models.IntegerChoices", ENUM),
    ("pkg:django#db.models.Choices", ENUM),
    ("pkg:django#db.models.enums.TextChoices", ENUM),
    ("pkg:django#db.models.enums.IntegerChoices", ENUM),
    ("pkg:django#db.models.enums.Choices", ENUM),
    ("pkg:graphene#Enum", ENUM),
    ("pkg:python:typing#NamedTuple", NAMEDTUPLE),
    ("pkg:typing_extensions#NamedTuple", NAMEDTUPLE),
    ("pkg:python:typing#TypedDict", TYPEDDICT),
    ("pkg:typing_extensions#TypedDict", TYPEDDICT),
    ("pkg:python:typing#Protocol", PROTOCOL),
    ("pkg:typing_extensions#Protocol", PROTOCOL),
    ("pkg:python:abc#ABC", ABSTRACT),
];

/// Class decorators that make a class of a kind.
const DECORATOR_KINDS: &[(&str, &str)] = &[
    ("pkg:python:dataclasses#dataclass", DATACLASS),
    ("pkg:pydantic#dataclasses.dataclass", DATACLASS),
    ("pkg:attrs#define", DATACLASS),
    ("pkg:attrs#frozen", DATACLASS),
    ("pkg:attrs#mutable", DATACLASS),
    ("pkg:attr#s", DATACLASS),
    ("pkg:attr#attrs", DATACLASS),
    ("pkg:attr#define", DATACLASS),
    ("pkg:attr#frozen", DATACLASS),
    ("pkg:python:enum#unique", ENUM),
    ("pkg:strawberry#enum", ENUM),
];

/// Kinds inherited by a subclass: a subclass of an in-repo enum, NamedTuple or
/// TypedDict is one too. (A subclass of a Protocol or an ABC is an implementation,
/// and a subclass of a dataclass is a dataclass only if decorated itself.)
const INHERITED: &[&str] = &[ENUM, NAMEDTUPLE, TYPEDDICT];

/// Task-queue decorators: a function that calls one and is used as a decorator
/// declares jobs.
const JOB_DECORATORS: &[(&str, &str)] = &[
    ("pkg:dramatiq#actor", "dramatiq"),
    ("pkg:celery#shared_task", "celery"),
    ("pkg:celery#task", "celery"),
];

/// Kinds a class has from its resolved bases and decorators.
pub fn direct_traits(wraps: &[Wrap]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in wraps {
        let table = match w.kind {
            WrapKind::Extends => BASE_KINDS,
            WrapKind::Decorator => DECORATOR_KINDS,
            _ => continue,
        };
        if let Some((_, t)) = table.iter().find(|(r, _)| *r == w.wrapper) {
            out.push((*t).to_string());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Test code: pytest/unittest files, and anything under a `tests`/`test` directory.
pub(crate) fn is_test_code(path: &str) -> bool {
    crate::is_test_file(path)
        || path
            .rsplit_once('/')
            .is_some_and(|(dir, _)| dir.split('/').any(|d| matches!(d, "tests" | "test")))
}

/// Named like a base class or a mixin on its own: `ExportMixin`, `BaseLoader`,
/// `AbstractHandler`. (A `*Base` suffix is not enough alone: `KnowledgeBase` and
/// `CodeBase` are things, see [`base_suffix`].)
fn base_name(name: &str) -> bool {
    let prefixed = |p: &str| {
        name.strip_prefix(p)
            .is_some_and(|r| r.starts_with(|c: char| c.is_ascii_uppercase()))
    };
    (name.len() > 5 && name.ends_with("Mixin")) || prefixed("Base") || prefixed("Abstract")
}

/// `RepositoryBase`: a base when the repo extends it or it is abstract.
fn base_suffix(name: &str) -> bool {
    name.len() > 4 && name.ends_with("Base")
}

/// A module of test doubles or test utilities, outside test directories:
/// `factories.py` (factory_boy), `fakes.py`, `mocks.py`, `stubs.py`, `testutils.py`.
/// Not `factory.py` (a factory function builds the product) or `fixtures.py` (often
/// a command that loads seed data). `test_utils.py` and `test_helpers.py` are test
/// files by name ([`is_test_code`]) already.
fn test_support_module(path: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = file.strip_suffix(".py").unwrap_or(file);
    matches!(
        stem,
        "factories" | "fakes" | "mocks" | "stubs" | "testutils" | "testing_utils"
    )
}

/// A class whose subclassing says nothing about production code: one in test code,
/// Django's `tests.py`, a `testing/` or `fixtures/` package, a test-support module,
/// or a class named for a test double. [`SUBCLASSED`] does not count it (`base` keeps
/// its own, older count).
fn test_side(path: &str, name: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    is_test_code(path)
        || file == "tests.py"
        || path
            .rsplit_once('/')
            .is_some_and(|(dir, _)| dir.split('/').any(|d| matches!(d, "testing" | "fixtures")))
        || test_support_module(path)
        || test_double_name(name)
}

/// A class named for a test double: `FakeListLLM`, `MockTransport`, `DummyCache`,
/// `StubClient` (not `Fakeroot` or `Mockingbird`). Functions named `fake_*` are
/// mostly stand-ins in examples or data anonymisation, not test code.
fn test_double_name(name: &str) -> bool {
    let name = name.trim_start_matches('_');
    ["Fake", "Mock", "Dummy", "Stub"].iter().any(|p| {
        name.strip_prefix(p)
            .is_some_and(|r| r.starts_with(|c: char| c.is_ascii_uppercase()))
    })
}

/// A module that holds base classes or mixins: `base.py`, `base_types.py`, `bases.py`,
/// `mixins.py` (not `baseline.py`).
fn base_module(path: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = file.strip_suffix(".py").unwrap_or(file);
    matches!(stem, "base" | "bases" | "mixin" | "mixins") || stem.starts_with("base_")
}

/// Repo pass: `base`, `view` and inherited kinds, and jobs declared through in-repo
/// wrappers of task-queue decorators.
pub fn classify(repo: &mut RepoFacts) {
    // Classes and functions by canonical id (`path#name`, also under exported names).
    let mut index: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for (fi, f) in repo.files.iter().enumerate() {
        for (si, s) in f.symbols.iter().enumerate() {
            if !matches!(s.kind, SymbolKind::Class | SymbolKind::Function) {
                continue;
            }
            index
                .entry(format!("{}#{}", f.path, s.name))
                .or_insert((fi, si));
        }
    }
    let class_at = |r: &str, repo: &RepoFacts| {
        index
            .get(r)
            .copied()
            .filter(|&(fi, si)| repo.files[fi].symbols[si].kind == SymbolKind::Class)
    };

    // In-repo parents of every class, and how many production classes extend each.
    let mut parents: BTreeMap<(usize, usize), Vec<(usize, usize)>> = BTreeMap::new();
    let mut extended: BTreeMap<(usize, usize), BTreeSet<(usize, usize)>> = BTreeMap::new();
    // The same, for `subclassed`: production classes that are not test doubles.
    let mut subclassed: BTreeSet<(usize, usize)> = BTreeSet::new();
    for (fi, f) in repo.files.iter().enumerate() {
        let test = is_test_code(&f.path);
        for (si, s) in f.symbols.iter().enumerate() {
            if s.kind != SymbolKind::Class {
                continue;
            }
            for w in s.wraps.iter().filter(|w| w.kind == WrapKind::Extends) {
                if let Some(p) = class_at(&w.wrapper, repo)
                    && p != (fi, si)
                {
                    parents.entry((fi, si)).or_default().push(p);
                    if !test {
                        extended.entry(p).or_default().insert((fi, si));
                    }
                    if !test_side(&f.path, &s.name) {
                        subclassed.insert(p);
                    }
                }
            }
        }
    }

    // Inherited kinds, to a fixpoint (bounded: inheritance chains are short).
    for _ in 0..16 {
        let mut add: Vec<((usize, usize), String)> = Vec::new();
        for (&c, ps) in &parents {
            for &(pf, ps_) in ps {
                for t in &repo.files[pf].symbols[ps_].traits {
                    if INHERITED.contains(&t.as_str())
                        && !repo.files[c.0].symbols[c.1].traits.contains(t)
                    {
                        add.push((c, t.clone()));
                    }
                }
            }
        }
        if add.is_empty() {
            break;
        }
        for ((fi, si), t) in add {
            push_trait(&mut repo.files[fi].symbols[si], &t);
        }
    }

    // View classes by ancestry: a class built on a framework view base, directly or
    // through in-repo classes, is a view even when Drift sees no URL for it (netbox's
    // `@register_model_view` registers views by decorator).
    let mut view_derived: BTreeSet<(usize, usize)> = BTreeSet::new();
    for (fi, f) in repo.files.iter().enumerate() {
        for (si, s) in f.symbols.iter().enumerate() {
            if s.kind == SymbolKind::Class
                && s.wraps.iter().any(|w| {
                    w.kind == WrapKind::Extends && drift_core::lineage::framework_view(&w.wrapper)
                })
            {
                view_derived.insert((fi, si));
            }
        }
    }
    let mut children: BTreeMap<(usize, usize), Vec<(usize, usize)>> = BTreeMap::new();
    for (&c, ps) in &parents {
        for &p in ps {
            children.entry(p).or_default().push(c);
        }
    }
    let mut work: Vec<(usize, usize)> = view_derived.iter().copied().collect();
    while let Some(p) = work.pop() {
        for &c in children.get(&p).into_iter().flatten() {
            if view_derived.insert(c) {
                work.push(c);
            }
        }
    }

    // Lineage kinds (W1), through in-repo bases: what each class is built on.
    let lineage = lineage_kinds(repo, &class_at);
    for ((fi, si), k) in lineage {
        push_trait(
            &mut repo.files[fi].symbols[si],
            &drift_core::lineage::trait_for(k),
        );
    }

    for (fi, f) in repo.files.iter_mut().enumerate() {
        let module = base_module(&f.path);
        let handlers: BTreeSet<&str> = f
            .entry_points
            .iter()
            .filter_map(|e| e.symbol.split_once('.').map(|(c, _)| c))
            .collect();
        let mut views = Vec::new();
        let production = !is_test_code(&f.path);
        let support = production && test_support_module(&f.path);
        for s in f.symbols.iter_mut() {
            let named = s.kind == SymbolKind::Class && test_double_name(&s.name);
            if production
                && matches!(s.kind, SymbolKind::Class | SymbolKind::Function)
                && (support || named)
            {
                push_trait(s, TEST_HELPER);
            }
        }
        for (si, s) in f.symbols.iter().enumerate() {
            if s.kind != SymbolKind::Class {
                continue;
            }
            // Extended once, a class may be a concrete parent (a Django multi-table or
            // proxy parent, a serializer refined once); it is a base when it is also
            // abstract or named like one, or when several classes extend it.
            let subclasses = extended.get(&(fi, si)).map_or(0, BTreeSet::len);
            let abstract_ = s.traits.iter().any(|t| t == ABSTRACT);
            let base = base_name(&s.name)
                || module
                || subclasses >= 2
                || (subclasses == 1 && (abstract_ || base_suffix(&s.name)))
                || (abstract_ && base_suffix(&s.name));
            // A routed class without handler methods of its own is the entry point
            // itself (`router.register("x", XViewSet)`): it stays in its HTTP role.
            let routed = f
                .entry_points
                .iter()
                .any(|e| e.symbol == s.name || s.exported_as.contains(&e.symbol));
            let view =
                handlers.contains(s.name.as_str()) || (!routed && view_derived.contains(&(fi, si)));
            views.push((si, base, view, subclassed.contains(&(fi, si))));
        }
        for (si, base, view, subclassed) in views {
            if base {
                push_trait(&mut f.symbols[si], BASE);
            }
            if subclassed {
                push_trait(&mut f.symbols[si], SUBCLASSED);
            }
            if view {
                push_trait(&mut f.symbols[si], VIEW);
            }
        }
    }

    // Job wrappers: in-repo functions that call a task-queue decorator.
    let wrappers: BTreeMap<&str, &'static str> = index
        .iter()
        .filter_map(|(id, &(fi, si))| {
            let s = &repo.files[fi].symbols[si];
            (s.kind == SymbolKind::Function)
                .then(|| {
                    JOB_DECORATORS
                        .iter()
                        .find(|(d, _)| s.calls.iter().any(|c| c == d))
                        .map(|(_, a)| (id.as_str(), *a))
                })
                .flatten()
        })
        .collect();
    let mut jobs: Vec<(usize, EntryPoint)> = Vec::new();
    for (fi, f) in repo.files.iter().enumerate() {
        if is_test_code(&f.path) {
            continue;
        }
        for s in &f.symbols {
            if s.kind != SymbolKind::Function || s.exported_as.is_empty() {
                continue;
            }
            let Some(adapter) = s
                .wraps
                .iter()
                .filter(|w| w.kind == WrapKind::Decorator)
                .find_map(|w| wrappers.get(w.wrapper.as_str()))
            else {
                continue;
            };
            let symbol = s.exported_as[0].clone();
            if f.entry_points.iter().any(|e| e.symbol == symbol) {
                continue;
            }
            jobs.push((
                fi,
                EntryPoint {
                    symbol: symbol.clone(),
                    kind: "job".into(),
                    method: None,
                    route: Some(symbol),
                    adapter: (*adapter).into(),
                },
            ));
        }
    }
    for (fi, e) in jobs {
        repo.files[fi].entry_points.push(e);
    }
}

/// The lineage kind ([`drift_core::lineage`]) of every class that has one, resolved
/// through the repo's own bases: a class is of a kind when its bases, followed through
/// classes of the repo, reach a framework base of exactly that kind
/// ([`drift_core::lineage::framework_kind`]); a mixin when it is named `*Mixin` or all
/// its bases are mixins. Bases of two different kinds, or none of a known kind, make a
/// plain class (no entry): a kind is never guessed from an unresolved base.
fn lineage_kinds(
    repo: &RepoFacts,
    class_at: &impl Fn(&str, &RepoFacts) -> Option<(usize, usize)>,
) -> BTreeMap<(usize, usize), &'static str> {
    use drift_core::lineage::{MIXIN, framework_kind, mixin_name};
    // `None` inside: computed, plain. Chains are short; a cycle reads as plain.
    let mut memo: BTreeMap<(usize, usize), Option<&'static str>> = BTreeMap::new();
    fn visit(
        c: (usize, usize),
        repo: &RepoFacts,
        class_at: &impl Fn(&str, &RepoFacts) -> Option<(usize, usize)>,
        memo: &mut BTreeMap<(usize, usize), Option<&'static str>>,
        depth: usize,
    ) -> Option<&'static str> {
        if let Some(k) = memo.get(&c) {
            return *k;
        }
        // Provisional, so a cycle ends as plain.
        memo.insert(c, None);
        let s = &repo.files[c.0].symbols[c.1];
        let kind = if mixin_name(&s.name) {
            Some(MIXIN)
        } else if depth > 32 {
            None
        } else {
            let mut kinds: BTreeSet<&'static str> = BTreeSet::new();
            let mut bases = 0;
            let mut mixins = 0;
            for w in s.wraps.iter().filter(|w| w.kind == WrapKind::Extends) {
                bases += 1;
                let k = match class_at(&w.wrapper, repo) {
                    Some(p) if p != c => visit(p, repo, class_at, memo, depth + 1),
                    Some(_) => None,
                    None => framework_kind(&w.wrapper),
                };
                match k {
                    Some(MIXIN) => mixins += 1,
                    Some(k) => {
                        kinds.insert(k);
                    }
                    None => {}
                }
            }
            match kinds.len() {
                1 => kinds.into_iter().next(),
                0 if bases > 0 && mixins == bases => Some(MIXIN),
                _ => None,
            }
        };
        memo.insert(c, kind);
        kind
    }
    for (fi, f) in repo.files.iter().enumerate() {
        for (si, s) in f.symbols.iter().enumerate() {
            if s.kind == SymbolKind::Class {
                visit((fi, si), repo, class_at, &mut memo, 0);
            }
        }
    }
    memo.into_iter()
        .filter_map(|(c, k)| k.map(|k| (c, k)))
        .collect()
}

/// Constructors of type variables: a module-level `T = TypeVar("T", ...)` declares a
/// generic parameter, not a value.
const TYPE_VAR_CONSTRUCTORS: &[&str] = &[
    "pkg:python:typing#TypeVar",
    "pkg:python:typing#ParamSpec",
    "pkg:python:typing#TypeVarTuple",
    "pkg:typing_extensions#TypeVar",
    "pkg:typing_extensions#ParamSpec",
    "pkg:typing_extensions#TypeVarTuple",
];

/// Kinds a module-level value has from its (canonical) calls: `type_var` when its
/// only calls construct a type variable. Computed at link time, so a single-file
/// scan records it exactly as a repo scan does.
pub fn value_traits(kind: SymbolKind, calls: &[String]) -> Vec<String> {
    let type_var = matches!(kind, SymbolKind::Variable | SymbolKind::Const)
        && !calls.is_empty()
        && calls
            .iter()
            .all(|c| TYPE_VAR_CONSTRUCTORS.contains(&c.as_str()));
    if type_var {
        vec![TYPE_VAR.to_string()]
    } else {
        vec![]
    }
}

fn push_trait(s: &mut Symbol, t: &str) {
    if !s.traits.iter().any(|x| x == t) {
        s.traits.push(t.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_names_and_modules() {
        assert!(!base_name("RepositoryBase"), "a suffix needs a subclass");
        assert!(base_suffix("RepositoryBase"));
        assert!(!base_suffix("Base"));
        assert!(base_name("ExportMixin"));
        assert!(base_name("BaseLoader"));
        assert!(base_name("AbstractHandler"));
        assert!(!base_name("Base"));
        assert!(!base_name("Baseline"));
        assert!(!base_name("Database"));
        assert!(!base_name("Mixin"));
        assert!(base_module("polar/kit/repository/base.py"));
        assert!(base_module("app/base_types.py"));
        assert!(base_module("app/mixins.py"));
        assert!(base_module("app/bases.py"));
        assert!(!base_module("app/baseline.py"));
        assert!(!base_module("app/baseball.py"));
        assert!(!base_module("app/views.py"));
    }

    #[test]
    fn direct_kinds_from_bases_and_decorators() {
        let w = |r: &str, kind| Wrap {
            wrapper: r.into(),
            kind,
        };
        assert_eq!(
            direct_traits(&[
                w("global#str", WrapKind::Extends),
                w("pkg:python:enum#Enum", WrapKind::Extends)
            ]),
            ["enum"]
        );
        assert_eq!(
            direct_traits(&[w("pkg:python:dataclasses#dataclass", WrapKind::Decorator)]),
            ["dataclass"]
        );
        assert!(direct_traits(&[w("pkg:pydantic#BaseModel", WrapKind::Extends)]).is_empty());
    }

    fn class(name: &str, wraps: &[(&str, WrapKind)]) -> Symbol {
        Symbol {
            name: name.into(),
            kind: SymbolKind::Class,
            exported_as: vec![name.into()],
            wraps: wraps
                .iter()
                .map(|(w, k)| Wrap {
                    wrapper: (*w).into(),
                    kind: *k,
                })
                .collect(),
            traits: direct_traits(
                &wraps
                    .iter()
                    .map(|(w, k)| Wrap {
                        wrapper: (*w).into(),
                        kind: *k,
                    })
                    .collect::<Vec<_>>(),
            ),
            ..Default::default()
        }
    }

    #[test]
    fn repo_pass_finds_bases_inherited_kinds_views_and_job_wrappers() {
        use drift_core::FileFacts;
        let e = WrapKind::Extends;
        let mut worker = FileFacts {
            path: "app/worker.py".into(),
            ..Default::default()
        };
        worker.symbols.push(Symbol {
            name: "actor".into(),
            kind: SymbolKind::Function,
            exported_as: vec!["actor".into()],
            calls: vec!["pkg:dramatiq#actor".into()],
            ..Default::default()
        });
        let mut tasks = FileFacts {
            path: "app/order/tasks.py".into(),
            ..Default::default()
        };
        for (name, decorated) in [("order_created", true), ("sign_payload", false)] {
            tasks.symbols.push(Symbol {
                name: name.into(),
                kind: SymbolKind::Function,
                exported_as: vec![name.into()],
                wraps: if decorated {
                    vec![Wrap {
                        wrapper: "app/worker.py#actor".into(),
                        kind: WrapKind::Decorator,
                    }]
                } else {
                    vec![]
                },
                ..Default::default()
            });
        }
        let mut models = FileFacts {
            path: "app/models.py".into(),
            ..Default::default()
        };
        models.symbols = vec![
            class("Status", &[("pkg:python:enum#Enum", e)]),
            class("OrderStatus", &[("app/models.py#Status", e)]),
            class("Repo", &[]),
            class("OrderRepo", &[("app/models.py#Repo", e)]),
            class("UserRepo", &[("app/models.py#Repo", e)]),
            class("Place", &[]),
            class("Restaurant", &[("app/models.py#Place", e)]),
            class("KnowledgeBase", &[]),
            class("RepositoryBase", &[]),
            class("Repository", &[("app/models.py#RepositoryBase", e)]),
            class("PostView", &[]),
            class("Unused", &[]),
        ];
        models.entry_points.push(EntryPoint {
            symbol: "PostView.get".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some("/posts".into()),
            adapter: "django".into(),
        });
        // A test subclass does not make a base.
        let mut test = FileFacts {
            path: "app/tests/test_models.py".into(),
            ..Default::default()
        };
        test.symbols = vec![class("FakeUnused", &[("app/models.py#Unused", e)])];
        let mut repo = RepoFacts {
            files: vec![worker, tasks, models, test],
            ..Default::default()
        };
        classify(&mut repo);
        let traits = |name: &str| {
            repo.files[2]
                .symbols
                .iter()
                .find(|s| s.name == name)
                .unwrap()
                .traits
                .clone()
        };
        assert_eq!(traits("Status"), ["enum", "subclassed"]);
        assert_eq!(traits("OrderStatus"), ["enum"]);
        assert_eq!(traits("Repo"), ["base", "subclassed"], "two subclasses");
        assert!(traits("OrderRepo").is_empty());
        assert_eq!(
            traits("Place"),
            ["subclassed"],
            "a concrete parent extended once is no base"
        );
        assert!(traits("KnowledgeBase").is_empty());
        assert_eq!(traits("RepositoryBase"), ["base", "subclassed"]);
        assert_eq!(traits("PostView"), ["view"]);
        assert!(traits("Unused").is_empty());
        let jobs: Vec<&str> = repo.files[1]
            .entry_points
            .iter()
            .map(|e| e.symbol.as_str())
            .collect();
        assert_eq!(
            jobs,
            ["order_created"],
            "helpers in tasks files are not jobs"
        );
    }

    #[test]
    fn views_by_ancestry_and_type_variables() {
        use drift_core::FileFacts;
        let e = WrapKind::Extends;
        let mut views = FileFacts {
            path: "app/views.py".into(),
            ..Default::default()
        };
        views.symbols = vec![
            // A generic view of the team's, extended by several views.
            class("ObjectView", &[("pkg:django#views.generic.View", e)]),
            // Registered by a decorator Drift does not follow: still a view.
            class("DeviceView", &[("app/views.py#ObjectView", e)]),
            // Routed itself (`path("x/", XListView.as_view())`): the entry point.
            class("DeviceListView", &[("app/views.py#ObjectView", e)]),
            class("RootView", &[("pkg:rest_framework#routers.APIRootView", e)]),
            // Not a view.
            class("ViewTab", &[]),
        ];
        views.entry_points.push(EntryPoint {
            symbol: "DeviceListView".into(),
            kind: "http".into(),
            method: None,
            route: Some("/devices".into()),
            adapter: "django".into(),
        });
        // Built on a Django view mixin only: no view.
        views.symbols.push(class(
            "Panel",
            &[("pkg:django#views.generic.base.ContextMixin", e)],
        ));
        let mut repo = RepoFacts {
            files: vec![views],
            ..Default::default()
        };
        classify(&mut repo);
        let traits = |name: &str| {
            repo.files[0]
                .symbols
                .iter()
                .find(|s| s.name == name)
                .unwrap()
                .traits
                .clone()
        };
        // Lineage kinds (W1) are checked apart.
        let lineage = |name: &str| drift_core::lineage::of_traits(&traits(name));
        let traits = |name: &str| {
            let mut t = traits(name);
            t.retain(|t| !t.starts_with(drift_core::lineage::TRAIT_PREFIX));
            t
        };
        assert_eq!(traits("DeviceView"), ["view"]);
        assert_eq!(traits("RootView"), ["view"]);
        assert!(traits("DeviceListView").is_empty(), "routed: its own role");
        assert!(traits("ViewTab").is_empty());
        assert!(traits("Panel").is_empty(), "a mixin is no view");
        assert_eq!(lineage("DeviceView"), Some(drift_core::lineage::VIEW));
        assert_eq!(lineage("Panel"), Some(drift_core::lineage::MIXIN));
        assert_eq!(lineage("ViewTab"), None);
    }

    #[test]
    fn lineage_kinds_resolve_through_in_repo_bases_and_never_guess() {
        use drift_core::FileFacts;
        let e = WrapKind::Extends;
        let mut lib = FileFacts {
            path: "app/lib.py".into(),
            ..Default::default()
        };
        lib.symbols = vec![
            class(
                "TeamSerializer",
                &[("pkg:rest_framework#serializers.ModelSerializer", e)],
            ),
            class(
                "IsAuthenticated",
                &[("pkg:rest_framework#permissions.IsAuthenticated", e)],
            ),
            class("OwnedMixin", &[]),
            class("TeamModel", &[("pkg:django#db.models.Model", e)]),
            class("AppError", &[("global#Exception", e)]),
            // A cycle the resolver cannot settle.
            class("Loop", &[("app/lib.py#Loop2", e)]),
            class("Loop2", &[("app/lib.py#Loop", e)]),
        ];
        let mut api = FileFacts {
            path: "app/api.py".into(),
            ..Default::default()
        };
        api.symbols = vec![
            class("OrderSerializer", &[("app/lib.py#TeamSerializer", e)]),
            class(
                "TeamPermission",
                &[
                    ("app/lib.py#OwnedMixin", e),
                    ("app/lib.py#IsAuthenticated", e),
                ],
            ),
            class(
                "Composed",
                &[
                    ("app/lib.py#OwnedMixin", e),
                    ("pkg:rest_framework#mixins.ListModelMixin", e),
                ],
            ),
            class(
                "Both",
                &[
                    ("app/lib.py#TeamModel", e),
                    ("pkg:django#forms.ModelForm", e),
                ],
            ),
            class("NotFound", &[("app/lib.py#AppError", e)]),
            class("Unknown", &[("unresolved:Thing", e)]),
            class("Pydantic", &[("pkg:pydantic#BaseModel", e)]),
            class("Plain", &[]),
            class(
                "AuditedOrderSerializer",
                &[
                    ("app/lib.py#OwnedMixin", e),
                    ("app/api.py#OrderSerializer", e),
                ],
            ),
        ];
        let mut repo = RepoFacts {
            files: vec![lib, api],
            ..Default::default()
        };
        classify(&mut repo);
        let lineage = |name: &str| {
            repo.files
                .iter()
                .flat_map(|f| &f.symbols)
                .find(|s| s.name == name)
                .and_then(|s| drift_core::lineage::of_traits(&s.traits))
        };
        use drift_core::lineage::{EXCEPTION, MIXIN, MODEL, SERIALIZER};
        assert_eq!(lineage("TeamSerializer"), Some(SERIALIZER));
        assert_eq!(
            lineage("OrderSerializer"),
            Some(SERIALIZER),
            "through an in-repo base"
        );
        assert_eq!(
            lineage("AuditedOrderSerializer"),
            Some(SERIALIZER),
            "a mixin beside a kind is that kind"
        );
        assert_eq!(lineage("TeamModel"), Some(MODEL));
        assert_eq!(lineage("NotFound"), Some(EXCEPTION));
        assert_eq!(lineage("OwnedMixin"), Some(MIXIN), "named *Mixin");
        assert_eq!(lineage("Composed"), Some(MIXIN), "only mixin bases");
        // A permission class is of no kind Drift knows: plain.
        assert_eq!(lineage("IsAuthenticated"), None);
        assert_eq!(lineage("TeamPermission"), None);
        // Two kinds, an unresolved base, an unknown package base, no base, a cycle:
        // plain, never guessed.
        assert_eq!(lineage("Both"), None);
        assert_eq!(lineage("Unknown"), None);
        assert_eq!(lineage("Pydantic"), None);
        assert_eq!(lineage("Plain"), None);
        assert_eq!(lineage("Loop"), None);
        assert_eq!(lineage("Loop2"), None);
    }

    #[test]
    fn type_variables_from_calls() {
        let t = |kind, calls: &[&str]| {
            value_traits(
                kind,
                &calls.iter().map(|c| (*c).to_string()).collect::<Vec<_>>(),
            )
        };
        let v = SymbolKind::Variable;
        assert_eq!(t(v, &["pkg:python:typing#TypeVar"]), ["type_var"]);
        assert_eq!(t(v, &["pkg:typing_extensions#ParamSpec"]), ["type_var"]);
        assert!(t(v, &["pkg:python:typing#TypeVar", "global#dict"]).is_empty());
        assert!(t(v, &[]).is_empty());
        assert!(t(SymbolKind::Function, &["pkg:python:typing#TypeVar"]).is_empty());
    }
}
