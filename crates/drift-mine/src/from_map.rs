//! Conventions proposed from the structure map, not mined ([`Convention::from_map`]).
//!
//! Mining can turn a dependency direction into `avoids import` only where the direction is
//! already broken: an avoidance draft needs at least one member that has the signal, and a
//! rule every member holds is "documentation, not a check" (`crate::mine`'s `avoid_drafts`
//! and `draft_over`). So a lower layer that never imports an upper one is never told not
//! to: on seven repositories 148 pairs of layers import one way only and none could be
//! proposed, among them rules the teams wrote down themselves (cal.com: `packages/features`
//! never imports `apps/web`, in none of its files). This module reads the same facts the
//! map reads and proposes those pairs.
//!
//! It is a second channel: mining, its thresholds, ids and output are untouched, and
//! nothing here passes through mining's gates. Every proposal is `proposed` and `advise`,
//! labelled `from_map`, and nothing checks it until a person accepts it. Its rule is the
//! existing `Rule::Avoids { signal: "import:<area>" }`, the signal exactly as
//! [`crate::mine::signals`] forms it for a file, so `drift check` evaluates an accepted
//! proposal with no change: each proposal is verified here with [`Rule::holds_in`] on
//! every member of its role before it is returned.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{FileFacts, RepoFacts, SymbolKind};
use serde::Serialize;

use crate::context::RepoContext;
use crate::mine::{Candidate, Evidence, Rule, r3, wilson_lower_bound};
use crate::policy::{Convention, Mode, Status};
use crate::roles::{FILE_UNIT, FileKinds, PACKAGE_WIDE, RoleSelector, View};

/// [`Convention::from_map`] of a layering proposal ([`layering`]).
pub const LAYERING: &str = "layering";
/// [`Convention::from_map`] of a manifest proposal ([`manifest`]).
pub const MANIFEST: &str = "manifest";

/// Members of the role that import in-repo code, at least: with every one of them
/// holding, the 95% Wilson lower bound of "holds" is at least 0.9, the bound mining asks
/// of a layering rule (`AVOID_IMPORT_MIN_LOWER_BOUND` in `crate::mine`); 34 gives 0.899.
/// The structure audit counted the strong one-way pairs with it (cal.com, plane). A
/// starting value, to be measured: label what it proposes on the seven repositories.
pub const MIN_IMPORTING_MEMBERS: usize = 35;

/// Production files the target layer needs for "never imports it" to mean something:
/// a folder of three files is no layer that code avoids. Mining's smallest role
/// (`crate::mine::MIN_ROLE_SIZE`), and the "lower area of at least 8 production files"
/// of the structure audit's strong one-way pairs. A starting value, to be measured.
pub const MIN_TARGET_FILES: usize = crate::mine::MIN_ROLE_SIZE;

/// Files of the target layer that import the role's layer, at least, for the direction
/// to be a layering (the target is above the role): the structure audit's strong one-way
/// pair has at least 5 importing files. Without a reverse edge (or a declared one, or a
/// chain through a third layer, see [`layering`]) two folders that never import each other
/// are unrelated, not layered. A starting value, to be measured.
pub const MIN_REVERSE_FILES: usize = 5;

/// Proposals one repository is offered at once ([`offered`]); the rest are counted. As
/// many as the suggestions `drift review` and `drift init` show by default
/// (`crate::rank`), so a repository with many clean layers is not handed a wall of them.
pub const MAX_OFFERED: usize = 5;

/// A convention Drift already has (mined, or in the policy): what a proposal from the
/// map is compared with so it is not made twice ([`Proposal::same_as_mined`]).
#[derive(Debug, Clone, Copy)]
pub struct MinedRule<'a> {
    pub id: &'a str,
    pub role: &'a RoleSelector,
    pub rule: &'a Rule,
}

impl<'a> MinedRule<'a> {
    pub fn of_convention(c: &'a Convention) -> Self {
        Self {
            id: &c.id,
            role: &c.role,
            rule: &c.rule,
        }
    }

    pub fn of_candidate(c: &'a Candidate) -> Self {
        Self {
            id: &c.id,
            role: &c.role,
            rule: &c.rule,
        }
    }
}

/// A convention proposed from the map, with what it rests on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Proposal {
    /// `status: proposed`, `mode: advise`, `from_map: layering`.
    pub convention: Convention,
    pub layering: LayeringEvidence,
    /// The id of a mined convention with the same rule on the same layer: the caller says
    /// "Drift already proposes this as <id>" instead of offering it again. Such proposals
    /// come last and [`offered`] leaves them out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub same_as_mined: Option<String>,
}

/// What a layering proposal rests on, counted from the facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LayeringEvidence {
    /// The role's layer (`packages/features`): the area mining names (its first two
    /// directories from the repository root).
    pub layer: String,
    /// The layer it never imports (`apps/web`).
    pub target: String,
    /// Members of the role that import in-repo code: the population of the rule.
    pub importing: usize,
    /// Members of the role, importing or not.
    pub members: usize,
    /// Files of the role's whole layer that import the target, type-only and deferred
    /// imports included: always 0 (a pair with one is mining's case, not this one's).
    pub importing_target: usize,
    /// Production files of the target layer.
    pub target_files: usize,
    /// Files of the target layer that import the role's layer.
    pub reverse_files: usize,
    /// A workspace package of the target layer declares the role's package.
    pub reverse_declared: bool,
    /// With no direct reverse edge: a third layer the target imports and that imports
    /// the role's layer, each in at least [`MIN_REVERSE_FILES`] files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub through: Option<String>,
    /// The repository's linter already forbids this import for the role's files
    /// (`no-restricted-imports` at error): the caller may say so.
    pub lint_forbids: bool,
    /// A member that imports in-repo code, `path#(file)`.
    pub example: String,
}

/// Layering proposals: "code in layer A never imports layer T", for each pair the facts
/// show is one-way and layered. All of:
///
/// - no production file of A imports T, in any way (type-only, deferred and by
///   workspace-package name included), so the rule holds today for every member;
/// - the role has at least [`MIN_IMPORTING_MEMBERS`] members that import in-repo code
///   (a file with no imports can neither follow nor break the rule: juice-shop's
///   `data/**` is 104 files, of which 100 import nothing);
/// - T has at least [`MIN_TARGET_FILES`] production files;
/// - the reverse direction exists: at least [`MIN_REVERSE_FILES`] files of T import A, or a
///   package of T declares the role's package, or T imports a third layer that imports A
///   (each edge in at least [`MIN_REVERSE_FILES`] files), the way stacked layers do, so
///   that A importing T would close a cycle. A pair of folders with no path between them
///   is not a layering. (Two layers that are both imported by a third, with nothing
///   between them, say nothing about which is above: siblings are left out.)
/// - the role's package declares no workspace package in T: an import it declares is
///   intended and is no layering signal ([`crate::mine::signals`]), so such a rule would
///   restate the manifest backwards, and could never fire;
/// - the linter does not forbid T to import A (then A importing T is the intended
///   direction, as mining's lint veto reads it).
///
/// Layers are counted between packages and in the root package, as mining counts them;
/// inside one workspace package an import is no layer edge (intra-package layering is off,
/// `crate::mine`'s `edge_areas`). The role of a pair is the file role that lies wholly in
/// A with the most importing members (the whole package where the package is the layer).
///
/// Sorted strongest first: a direct or declared reverse edge before a chain through a
/// third layer, then more importing members, more reverse files, a larger target; each
/// role's best target comes before any role's second, so the few [`offered`] are not all
/// about one layer. Proposals the miner already makes ([`Proposal::same_as_mined`]) come
/// last. Deterministic: the same facts give the same proposals in the same order.
pub fn layering(repo: &RepoFacts, kinds: &FileKinds, mined: &[MinedRule<'_>]) -> Vec<Proposal> {
    let units = crate::roles::units(repo, kinds);
    let ctx = RepoContext::new(repo, &units);
    let files: Vec<&FileFacts> = units
        .iter()
        .filter_map(|u| match u.view {
            View::File(f) => Some(f),
            _ => None,
        })
        .collect();
    let graph = Graph::new(repo, &files);

    // File roles that lie wholly in one layer, with their members.
    let mut by_role: BTreeMap<&RoleSelector, Vec<&FileFacts>> = BTreeMap::new();
    for u in &units {
        let View::File(f) = u.view else {
            continue;
        };
        for r in &u.roles {
            if r.kind == SymbolKind::Module && r.shape.is_none() && r.also.is_empty() {
                by_role.entry(r).or_default().push(f);
            }
        }
    }
    let mut layer_roles: BTreeMap<String, Vec<LayerRole>> = BTreeMap::new();
    for (role, members) in by_role {
        let areas: BTreeSet<String> = members.iter().map(|f| area(&f.path)).collect();
        if areas.len() != 1 {
            continue;
        }
        let importing = members
            .iter()
            .filter(|f| graph.importing.contains(f.path.as_str()))
            .count();
        if importing < MIN_IMPORTING_MEMBERS {
            continue;
        }
        let layer = areas.into_iter().next().unwrap_or_default();
        layer_roles.entry(layer).or_default().push(LayerRole {
            role,
            members,
            importing,
        });
    }

    let mut out: Vec<(u8, Proposal)> = Vec::new();
    for (layer, roles) in &layer_roles {
        for (target, &target_files) in &graph.targetable {
            if target == layer
                || target_files < MIN_TARGET_FILES
                || graph.touches(layer, target) > 0
            {
                continue;
            }
            let reverse_files = graph.edges(target, layer);
            let through = if reverse_files < MIN_REVERSE_FILES {
                graph.through(target, layer)
            } else {
                None
            };
            // The linter says the target must not import this layer: this layer
            // importing the target is the intended direction.
            if ctx.forbids_import(target, layer) {
                continue;
            }
            // The best role of the layer for this target, and whether the target
            // declares its package.
            let mut best: Option<(&LayerRole, bool)> = None;
            for lr in roles {
                let role = lr.role;
                let scope = scope_of(role);
                if scope.is_empty()
                    || *target == scope
                    || target.starts_with(&format!("{scope}/"))
                    || scope.starts_with(&format!("{target}/"))
                {
                    continue;
                }
                // An import of the role's own package is no layer edge: it never shows.
                if !role.package.is_empty() && graph.has_package_in(target, &role.package) {
                    continue;
                }
                // A declared dependency is intended, and never a layering signal.
                if declares_package_in(repo, &ctx, &role.package, target) {
                    continue;
                }
                let declared_back = declared_by(repo, &ctx, target, &role.package);
                if reverse_files < MIN_REVERSE_FILES && !declared_back && through.is_none() {
                    continue;
                }
                let better = match best {
                    None => true,
                    Some((b, _)) => {
                        (lr.importing, lr.members.len(), role_rank(role))
                            > (b.importing, b.members.len(), role_rank(b.role))
                    }
                };
                if better {
                    best = Some((lr, declared_back));
                }
            }
            let Some((lr, declared_back)) = best else {
                continue;
            };
            let (role, members, importing) = (lr.role, &lr.members, lr.importing);
            let rule = Rule::Avoids {
                signal: format!("import:{target}"),
            };
            // What `drift check` would say today: every member holds.
            if !members
                .iter()
                .all(|f| rule.holds_in(Some(role), &View::File(*f), &ctx))
            {
                continue;
            }
            let direct = reverse_files >= MIN_REVERSE_FILES || declared_back;
            let example = members
                .iter()
                .find(|f| graph.importing.contains(f.path.as_str()))
                .map_or(String::new(), |f| format!("{}#{FILE_UNIT}", f.path));
            let python = members.iter().filter(|f| f.lang == "py").count();
            let evidence = LayeringEvidence {
                layer: layer.clone(),
                target: target.clone(),
                importing,
                members: members.len(),
                importing_target: 0,
                target_files,
                reverse_files,
                reverse_declared: declared_back,
                through: if direct { None } else { through.clone() },
                lint_forbids: ctx.import_restriction(&scope_of(role), target).decides(),
                example: example.clone(),
            };
            let convention = Convention {
                id: layering_id(role, target),
                status: Status::Proposed,
                mode: Mode::Advise,
                summary: layering_summary(role, target, importing),
                role: role.clone(),
                rule: rule.clone(),
                evidence: Evidence {
                    holders: importing,
                    total: importing,
                    lower_bound: r3(wilson_lower_bound(importing, importing)),
                    // No contrast is measured: the direction is the evidence.
                    lift: 0.0,
                    split: vec![],
                    role_members: (members.len() != importing).then_some(members.len()),
                    python_members: (python > 0).then_some(python),
                },
                example,
                selector_version: crate::policy::selector_version_of(role),
                agents: None,
                exceptions: Vec::new(),
                different_kind: Vec::new(),
                promoted_from_hidden: false,
                promoted_from_practice: None,
                from_map: Some(LAYERING.to_string()),
            };
            let same_as_mined = mined
                .iter()
                .find(|m| *m.rule == rule && layer_of_scope(&scope_of(m.role)) == *layer)
                .map(|m| m.id.to_string());
            out.push((
                u8::from(!direct),
                Proposal {
                    convention,
                    layering: evidence,
                    same_as_mined,
                },
            ));
        }
    }
    rank(out)
}

/// The proposals to offer a repository now (at most [`MAX_OFFERED`], in [`layering`]'s
/// order, leaving out those the miner already makes), and how many more there are.
pub fn offered(proposals: &[Proposal]) -> (Vec<&Proposal>, usize) {
    let fresh: Vec<&Proposal> = proposals
        .iter()
        .filter(|p| p.same_as_mined.is_none())
        .collect();
    let more = fresh.len().saturating_sub(MAX_OFFERED);
    (fresh.into_iter().take(MAX_OFFERED).collect(), more)
}

/// Manifest proposals ("a workspace package imports only what its manifest declares"):
/// none, on purpose, because no rule kind says it and the checker evaluates none that does.
///
/// The fact is in the map: [`crate::map::file_targets`] lists the workspace packages a
/// file's imports land in, and [`RepoContext::package_depends_on`] says whether its
/// package declares each (plane: 0 of 1,727 importing files break it; cal.com: 1,192 of
/// 2,469 do, so it would not be proposed there). But the rule is "no import of an
/// undeclared workspace package, whichever": `Rule::Avoids` names one signal (one area),
/// so it cannot say "any package not declared", and its `import:` signals leave out
/// imports by workspace-package name (`pkg:@x/ui`), which this rule is mostly about.
/// One `Avoids` per undeclared package would restate today's packages and miss the next
/// one. A rule kind is needed (say `Rule::ImportsDeclared`, about a file or a package,
/// held when every import that lands in another workspace package is of one its manifest
/// declares, test edges and `dev_only` apart), with `check` evaluating it, and the
/// cross-ecosystem name match fixed first (`map.rs` joins a PyPI import `emails` to an npm
/// workspace package `emails`). Until then this returns nothing.
pub fn manifest(_repo: &RepoFacts, _kinds: &FileKinds, _mined: &[MinedRule<'_>]) -> Vec<Proposal> {
    Vec::new()
}

/// The id of a layering proposal: `D-` and 6 hex digits of what it is about (the role's
/// place and the target layer), never of its counts, so it is the same however many
/// files there are. The prefix keeps it apart from every mined id's input (a role and a
/// rule) and from promoted practices' (`practice`).
pub fn layering_id(role: &RoleSelector, target: &str) -> String {
    let h = blake3::hash(
        format!(
            "layering\0{}\0{}\0{}\0{target}",
            role.package, role.dir, role.file
        )
        .as_bytes(),
    );
    format!("D-{}", &h.to_hex()[..6])
}

/// "Code in packages/features never imports apps/web (779 files, none do)".
fn layering_summary(role: &RoleSelector, target: &str, importing: usize) -> String {
    let scope = scope_of(role);
    let what = if role.dir == "." {
        format!("Files at the top of {scope}")
    } else if role.file == "*" {
        format!("Code in {scope}")
    } else {
        format!("{} files in {scope}", role.file)
    };
    format!("{what} never imports {target} ({importing} files, none do)")
}

/// Strongest first ([`layering`]): `class` 0 (a direct or declared reverse edge) before
/// 1 (through a third layer), then each role's best before any role's second.
fn rank(mut out: Vec<(u8, Proposal)>) -> Vec<Proposal> {
    let strength = |(class, p): &(u8, Proposal)| {
        (
            p.same_as_mined.is_some(),
            *class,
            std::cmp::Reverse(p.layering.importing),
            std::cmp::Reverse(p.layering.reverse_files),
            std::cmp::Reverse(p.layering.target_files),
            p.convention.id.clone(),
        )
    };
    out.sort_by_key(strength);
    let mut seen: BTreeMap<RoleSelector, usize> = BTreeMap::new();
    let mut rounds: Vec<(usize, (u8, Proposal))> = Vec::new();
    for item in out {
        let n = seen.entry(item.1.convention.role.clone()).or_default();
        rounds.push((*n, item));
        *n += 1;
    }
    rounds.sort_by(|a, b| {
        (a.1.1.same_as_mined.is_some(), a.1.0, a.0)
            .cmp(&(b.1.1.same_as_mined.is_some(), b.1.0, b.0))
            .then_with(|| strength(&a.1).cmp(&strength(&b.1)))
    });
    rounds.into_iter().map(|(_, (_, p))| p).collect()
}

/// A role covering its whole package first, then a shallower folder: the larger of
/// two places with the same members.
fn role_rank(role: &RoleSelector) -> std::cmp::Reverse<(bool, usize)> {
    std::cmp::Reverse((
        role.dir != PACKAGE_WIDE,
        role.dir.split('/').filter(|s| !s.is_empty()).count(),
    ))
}

/// Area of a repo path, exactly as `crate::mine`'s `area` (the signal's target is
/// `area(module)` there): its first two segments, or its first for a file one folder
/// down (`packages/ui`, `routes`), the file name for a file at the root.
fn area(path: &str) -> String {
    let segs: Vec<&str> = path.split('/').collect();
    segs[..segs.len().saturating_sub(1).clamp(1, 2)].join("/")
}

/// The place of a role from the repository root, as `crate::mine`'s `role_scope`:
/// `packages/ui`, `packages/ui/src/hooks`, `routes`; empty for the whole root package.
fn scope_of(role: &RoleSelector) -> String {
    let dir = if role.dir == "." || role.dir == PACKAGE_WIDE {
        ""
    } else {
        role.dir.as_str()
    };
    match (role.package.is_empty(), dir.is_empty()) {
        (true, _) => dir.to_string(),
        (false, true) => role.package.clone(),
        (false, false) => format!("{}/{dir}", role.package),
    }
}

/// The layer of a place: its first two segments.
fn layer_of_scope(scope: &str) -> String {
    scope
        .split('/')
        .filter(|s| !s.is_empty())
        .take(2)
        .collect::<Vec<_>>()
        .join("/")
}

/// Workspace packages (not the root) that make up, lie in or contain the layer `area`.
fn packages_in<'r>(
    repo: &'r RepoFacts,
    area: &'r str,
) -> impl Iterator<Item = &'r drift_core::PackageFacts> + 'r {
    repo.packages.iter().filter(move |p| {
        !p.path.is_empty()
            && !p.name.is_empty()
            && (p.path == area
                || p.path.starts_with(&format!("{area}/"))
                || area.starts_with(&format!("{}/", p.path)))
    })
}

/// The package at `package` declares a workspace package of the layer `target`.
fn declares_package_in(repo: &RepoFacts, ctx: &RepoContext, package: &str, target: &str) -> bool {
    packages_in(repo, target).any(|q| q.path != package && ctx.package_depends_on(package, &q.name))
}

/// A workspace package of the layer `target` declares the package at `package`.
fn declared_by(repo: &RepoFacts, ctx: &RepoContext, target: &str, package: &str) -> bool {
    let Some(name) = repo
        .packages
        .iter()
        .find(|p| p.path == package && !p.path.is_empty() && !p.name.is_empty())
        .map(|p| p.name.as_str())
    else {
        return false;
    };
    packages_in(repo, target).any(|q| q.path != package && ctx.package_depends_on(&q.path, name))
}

/// A file role that lies wholly in one layer ([`layering`]).
struct LayerRole<'r> {
    role: &'r RoleSelector,
    members: Vec<&'r FileFacts>,
    /// Members that import in-repo code ([`Graph::importing`]).
    importing: usize,
}

/// The import graph of the production files between layers, as mining counts it.
struct Graph<'a> {
    /// Files that import in-repo code (a path, or a workspace package by name), not
    /// type-only.
    importing: BTreeSet<&'a str>,
    /// Layers a signal can name (areas of files in a folder), with their file counts.
    targetable: BTreeMap<String, usize>,
    /// (layer, layer) -> files of the first importing the second: non-type-only path
    /// imports between packages or in the root package, as `crate::mine`'s `area_deps`.
    edges: BTreeMap<(String, String), usize>,
    /// (layer, layer) -> files of the first that touch the second in any way: type-only
    /// and deferred imports, and imports of its workspace packages by name, included.
    touches: BTreeMap<(String, String), usize>,
    /// Packages of each layer's files.
    packages: BTreeMap<String, BTreeSet<&'a str>>,
}

impl<'a> Graph<'a> {
    fn new(repo: &'a RepoFacts, files: &[&'a FileFacts]) -> Self {
        let by_name: BTreeMap<&str, &str> = repo
            .packages
            .iter()
            .filter(|p| !p.name.is_empty())
            .map(|p| (p.name.as_str(), p.path.as_str()))
            .collect();
        let mut packages: BTreeMap<String, BTreeSet<&'a str>> = BTreeMap::new();
        let mut package_areas: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
        let mut targetable: BTreeMap<String, usize> = BTreeMap::new();
        for &f in files {
            let a = area(&f.path);
            packages.entry(a.clone()).or_default().insert(f.package.as_str());
            package_areas
                .entry(f.package.as_str())
                .or_default()
                .insert(a.clone());
            if f.path.contains('/') {
                *targetable.entry(a).or_default() += 1;
            }
        }
        let mut importing = BTreeSet::new();
        let mut edges: BTreeMap<(String, String), usize> = BTreeMap::new();
        let mut touches: BTreeMap<(String, String), usize> = BTreeMap::new();
        for &f in files {
            let own = area(&f.path);
            let mut hard: BTreeSet<String> = BTreeSet::new();
            let mut any: BTreeSet<String> = BTreeSet::new();
            for i in &f.imports {
                let m = i.module.as_str();
                if m.starts_with("unresolved:") {
                    continue;
                }
                if let Some(name) = crate::map::imported_package_name(m) {
                    let Some(&path) = by_name.get(name.as_str()) else {
                        continue;
                    };
                    if !i.type_only {
                        importing.insert(f.path.as_str());
                    }
                    if path != f.package {
                        any.extend(package_areas.get(path).into_iter().flatten().cloned());
                    }
                    continue;
                }
                if !m.contains('/') {
                    continue;
                }
                if !i.type_only {
                    importing.insert(f.path.as_str());
                }
                if !f.package.is_empty() && m.starts_with(&format!("{}/", f.package)) {
                    continue;
                }
                let t = area(m);
                if !i.type_only {
                    hard.insert(t.clone());
                }
                any.insert(t);
            }
            for t in hard.into_iter().filter(|t| *t != own) {
                *edges.entry((own.clone(), t)).or_default() += 1;
            }
            for t in any.into_iter().filter(|t| *t != own) {
                *touches.entry((own.clone(), t)).or_default() += 1;
            }
        }
        Self {
            importing,
            targetable,
            edges,
            touches,
            packages,
        }
    }

    fn edges(&self, from: &str, to: &str) -> usize {
        self.edges
            .get(&(from.to_string(), to.to_string()))
            .copied()
            .unwrap_or(0)
    }

    fn touches(&self, from: &str, to: &str) -> usize {
        self.touches
            .get(&(from.to_string(), to.to_string()))
            .copied()
            .unwrap_or(0)
    }

    /// The first layer (by name) `from` imports and that imports `to`, each in at least
    /// [`MIN_REVERSE_FILES`] files.
    fn through(&self, from: &str, to: &str) -> Option<String> {
        self.edges
            .iter()
            .filter(|((a, x), n)| a == from && x != to && **n >= MIN_REVERSE_FILES)
            .map(|((_, x), _)| x)
            .find(|x| self.edges(x, to) >= MIN_REVERSE_FILES)
            .cloned()
    }

    /// Some file of the layer `area` is in the package at `package`.
    fn has_package_in(&self, area: &str, package: &str) -> bool {
        self.packages
            .get(area)
            .is_some_and(|p| p.contains(package))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn areas_are_mining_areas() {
        assert_eq!(area("packages/ui/src/a.ts"), "packages/ui");
        assert_eq!(area("routes/a.ts"), "routes");
        assert_eq!(area("server.ts"), "server.ts");
    }

    #[test]
    fn scope_and_layer_of_a_role() {
        let role = RoleSelector {
            package: "packages/ui".into(),
            dir: PACKAGE_WIDE.into(),
            file: "*".into(),
            entry: "-".into(),
            kind: SymbolKind::Module,
            variety: None,
            export_name: None,
            member_kind: None,
            shape: None,
            also: vec![],
        };
        assert_eq!(scope_of(&role), "packages/ui");
        assert_eq!(layer_of_scope("packages/ui/src/hooks"), "packages/ui");
        assert_eq!(
            layering_summary(&role, "apps/web", 779),
            "Code in packages/ui never imports apps/web (779 files, none do)"
        );
    }
}
