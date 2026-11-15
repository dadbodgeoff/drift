//! Opt-outs from a decorator rule: an outlier that carries, instead of the team's
//! wrapper, a decorator of the one package that wrapper wraps, a decorator no
//! holder carries and other outliers carry too (`@ApiExcludeEndpoint()` among the
//! handlers that `@Endpoint()` documents with `@nestjs/swagger`). The member says it
//! is not described by the wrapper, with the wrapped package's own vocabulary, so it
//! is not an outlier of the rule ([`crate::mine::Rule::exemption`]).
//!
//! An outlier `o` of "decorated with `T`" is exempt only when all of these hold:
//!
//! 1. `T` wraps a single package `P`: an in-repo `T`'s body calls into `P` and
//!    nothing else (pure combinators such as `applyDecorators` and built-ins aside;
//!    a call into the repo, which could wrap anything, refuses); an external `T`
//!    is `P`'s own;
//! 2. `P` is not the framework of the role's entry points (`@nestjs/common` for Nest
//!    handlers), whose decorators say how a handler runs;
//! 3. `o` carries a decorator `D` of `P` that is not one of `T`'s own calls: the
//!    primitive the wrapper wraps, written by hand, bypasses the wrapper;
//! 4. `D` is on no holder of the rule and on at least [`MIN_OPT_OUTS`] outliers;
//! 5. nothing is read from `D`'s name.
//!
//! A guard- or auth-shaped `T` never has an opt-out: an opt-out of a guard is a
//! missing guard. And like every exemption it runs behind the exemption gate
//! ([`crate::mine::Rule::exemption_allowed`]): never for an entry point, never under
//! a guard rule.

use std::collections::BTreeSet;

use drift_core::{FileFacts, Symbol, WrapKind};

use crate::context::RepoContext;
use crate::frameworks::{DECORATOR_COMBINATORS, entry_framework};
use crate::mine::{norm_ref, ref_root, same_ref, short};
use crate::roles::RoleSelector;
use crate::vocab::refuse;

/// Outliers that must carry an opt-out decorator before it is one: a decorator on a
/// single outlier is that member's own choice.
pub const MIN_OPT_OUTS: usize = 2;

/// What `target` wraps: the package (`pkg:@nestjs/swagger`) and `target`'s own calls
/// (package-normalised), if it wraps exactly one package. `None` when the facts lack an
/// in-repo target's body.
fn wrapped_package(target: &str, ctx: &RepoContext) -> Option<(String, BTreeSet<String>)> {
    if target.starts_with("pkg:") {
        return Some((ref_root(target), BTreeSet::new()));
    }
    if target.starts_with("global#") || target.starts_with("unresolved:") {
        return None;
    }
    let (_, t) = ctx.symbol(target)?;
    let mut roots = BTreeSet::new();
    let mut own = BTreeSet::new();
    let wrapped = t
        .wraps
        .iter()
        .filter(|w| matches!(w.kind, WrapKind::Call | WrapKind::Decorator))
        .map(|w| w.wrapper.as_str());
    for c in t.calls.iter().map(String::as_str).chain(wrapped) {
        let c = norm_ref(c.strip_suffix("(ref)").unwrap_or(c));
        if c.starts_with("global#") || DECORATOR_COMBINATORS.contains(&c.as_ref()) {
            continue;
        }
        if !c.starts_with("pkg:") {
            // An in-repo helper (or a callee the facts could not resolve) may wrap
            // any package: what `target` wraps is unknown.
            return None;
        }
        roots.insert(ref_root(&c));
        own.insert(c.into_owned());
    }
    match roots.len() {
        1 => roots.pop_first().map(|p| (p, own)),
        _ => None,
    }
}

/// `target` is guard- or auth-shaped: by its name, module or own calls
/// ([`refuse::wrapper_access_shaped`]), or as the security inventory and the exemption
/// gate read names ([`refuse::guard_shaped`], [`refuse::names_access_control`]).
fn access_shaped(target: &str, own: &BTreeSet<String>) -> bool {
    refuse::wrapper_access_shaped(target, own.iter().map(String::as_str))
        || refuse::guard_shaped(target)
        || refuse::names_access_control(target)
}

/// The package root of a `pkg:` root (`pkg:@nestjs/common` -> `@nestjs/common`).
fn bare(root: &str) -> &str {
    root.strip_prefix("pkg:").unwrap_or(root)
}

/// Framework packages of the entry points among `members` (`pkg:` roots).
fn frameworks_of(members: &[(&FileFacts, &Symbol)]) -> BTreeSet<String> {
    members
        .iter()
        .flat_map(|(f, s)| {
            f.entry_points
                .iter()
                .filter(move |e| e.symbol == s.name || s.exported_as.contains(&e.symbol))
                .flat_map(|e| entry_framework(&e.adapter))
        })
        .map(|p| format!("pkg:{p}"))
        .collect()
}

fn decorated_with(s: &Symbol, d: &str) -> bool {
    s.wraps
        .iter()
        .any(|w| w.kind == WrapKind::Decorator && same_ref(&w.wrapper, d))
}

/// The decorators of `o` that could opt it out of "decorated with `target`" (clauses 1
/// to 3), given what `target` wraps, sorted and package-normalised.
fn candidates(o: &Symbol, target: &str, package: &str, own: &BTreeSet<String>) -> Vec<String> {
    let mut out: Vec<String> = o
        .wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Decorator)
        .map(|w| norm_ref(&w.wrapper).into_owned())
        .filter(|d| {
            d.starts_with("pkg:") && ref_root(d) == package && d != target && !own.contains(d)
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Why `o` (a member of `role`) is exempt from "decorated with `target`", if it opts out.
pub fn exemption(
    target: &str,
    role: &RoleSelector,
    o: &Symbol,
    ctx: &RepoContext,
) -> Option<String> {
    if decorated_with(o, target) {
        return None;
    }
    let target = norm_ref(target);
    let (package, own) = wrapped_package(&target, ctx)?;
    if access_shaped(&target, &own) {
        return None;
    }
    let members = ctx.role_members(role);
    if frameworks_of(members).contains(&package) {
        return None;
    }
    candidates(o, &target, &package, &own)
        .into_iter()
        .find(|d| {
            let (mut on_holders, mut on_outliers) = (0, 0);
            for (_, m) in members {
                if decorated_with(m, d) {
                    if decorated_with(m, &target) {
                        on_holders += 1;
                    } else {
                        on_outliers += 1;
                    }
                }
            }
            on_holders == 0 && on_outliers >= MIN_OPT_OUTS
        })
        .map(|d| {
            let via = if target.starts_with("pkg:") {
                format!("{}'s own package", short(&target))
            } else {
                format!("the package {}() wraps", short(&target))
            };
            format!("opts out with {}() ({}, {via})", short(&d), bare(&package))
        })
}

/// Whether `o` might be exempt from "decorated with `target`" in a full scan, when
/// these facts are a single file's: the counts of clause 4 are over the whole role,
/// which the file alone does not have, and an in-repo target's body may be in another
/// file. True whenever `o` carries a decorator that could opt it out on what these
/// facts show; then callers scan the repo.
pub fn undecided(target: &str, role: &RoleSelector, o: &Symbol, ctx: &RepoContext) -> bool {
    if decorated_with(o, target) {
        return false;
    }
    let target = norm_ref(target);
    let local = frameworks_of(ctx.role_members(role));
    if !target.starts_with("pkg:") && ctx.symbol(&target).is_none() {
        // The target's body is in a file these facts lack: any package decorator
        // outside the framework might be from the package it wraps.
        return o.wraps.iter().any(|w| {
            let d = norm_ref(&w.wrapper);
            w.kind == WrapKind::Decorator
                && d.starts_with("pkg:")
                && *d != *target
                && !local.contains(&ref_root(&d))
        });
    }
    let Some((package, own)) = wrapped_package(&target, ctx) else {
        return false;
    };
    !access_shaped(&target, &own)
        && !local.contains(&package)
        && !candidates(o, &target, &package, &own).is_empty()
}
