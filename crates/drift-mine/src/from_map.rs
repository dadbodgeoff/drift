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
use crate::mine::{Candidate, Evidence, Rule, convention_id, r3, wilson_lower_bound};
use crate::policy::{Convention, Mode, Status};
use crate::roles::{FILE_UNIT, FileKinds, PACKAGE_WIDE, RoleSelector, View};

/// [`Convention::from_map`] of a layering proposal ([`layering`]).
pub const LAYERING: &str = "layering";
/// [`Convention::from_map`] of a manifest proposal ([`manifest`]).
pub const MANIFEST: &str = "manifest";
/// [`Convention::from_map`] of a rule the repository declares ([`crate::declared`]).
pub const DECLARED: &str = crate::declared::DECLARED;
/// The channel of wiring regularities ([`crate::wiring_proposals`]): listed by `drift
/// census --from-map`, never written, so never a [`Convention::from_map`] value.
pub const WIRING: &str = crate::wiring_proposals::WIRING;

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

/// The largest share of a layer's files Drift may have failed to read for "no file of
/// it imports the target" to be said: the bound promoted practices use for the same
/// question ([`crate::practices::promote::MAX_UNKNOWN_SHARE`], "Drift cannot hold code
/// to what it cannot read"), not a new one.
pub const MAX_NOT_READ_SHARE: f64 = crate::practices::promote::MAX_UNKNOWN_SHARE;

/// What `drift check` reads of an accepted layering proposal, said in its summary: the
/// rule is mining's `avoids import:<area>`, whose signal is a value import by path
/// (`crate::mine`'s `layer_signals`), while the evidence here counts every kind of
/// import. So the proposal says that an import by package name, or of types only, is
/// not what it checks.
pub const CHECKED_CLAUSE: &str = "checked on imports by path that load code, not on type-only imports or imports by package name";

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
    /// Members of the role that import in-repo code and that Drift read to the end, every
    /// import resolved ([`Graph::unread`]): the population of the rule.
    pub importing: usize,
    /// Members of the role, importing or not.
    pub members: usize,
    /// Files of the role's whole layer that import the target, type-only and deferred
    /// imports included: always 0 (a pair with one is mining's case, not this one's).
    /// Said only of the files Drift read ([`LayeringEvidence::not_read`] are apart).
    pub importing_target: usize,
    /// Files of the role's layer Drift cannot vouch for: one that failed to parse, one
    /// skipped whole (`RepoFacts::skipped`), or one with an import Drift could not
    /// resolve ([`Graph::unread`]). Whether they import the target is unknown, so they
    /// count toward no threshold, the summary names them, and a layer with more than
    /// [`MAX_NOT_READ_SHARE`] of its files not read is not proposed.
    pub not_read: usize,
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
///   direction, as mining's lint veto reads it), nor already forbid A to import T at
///   error (the linter decides that rule, so Drift does not restate it, as mining's
///   `lint` gate drops a rule the linter decides);
/// - Drift read A: "no file of A imports T" is said only of files Drift read to the end
///   with every import resolved ([`Graph::unread`]); the others are counted apart
///   ([`LayeringEvidence::not_read`]), count toward no threshold, and more than
///   [`MAX_NOT_READ_SHARE`] of A's files not read leaves the pair unproposed.
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
    let files = file_units(&units);
    let graph = Graph::new(repo, &files);
    // What Drift read: only these files can be said not to import a layer.
    let read = |f: &FileFacts| -> bool {
        graph.importing.contains(f.path.as_str()) && !graph.unread.contains(f.path.as_str())
    };

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
        let importing = members.iter().filter(|&&f| read(f)).count();
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
        // Files of the layer Drift could not vouch for: too many, and "none of its files
        // import" would rest on what Drift did not read.
        let not_read = graph.not_read_in(layer);
        let layer_files = graph.files_in(layer);
        if not_read as f64 > MAX_NOT_READ_SHARE * layer_files as f64 {
            continue;
        }
        for (target, &target_files) in &graph.targetable {
            let Some((reverse_files, through)) = graph.one_way_to(layer, target, target_files)
            else {
                continue;
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
                // The linter already forbids this import for the role's files at error: it
                // decides the rule, so it is not proposed again (mining's `lint` gate).
                if ctx.import_restriction(&scope, target).decides() {
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
                .all(|f| rule.holds_in(Some(role), &View::File(f), &ctx))
            {
                continue;
            }
            let direct = reverse_files >= MIN_REVERSE_FILES || declared_back;
            let example = members
                .iter()
                .find(|&&f| read(f))
                .map_or(String::new(), |f| format!("{}#{FILE_UNIT}", f.path));
            let python = members.iter().filter(|f| f.lang == "py").count();
            let evidence = LayeringEvidence {
                layer: layer.clone(),
                target: target.clone(),
                importing,
                members: members.len(),
                importing_target: 0,
                not_read,
                target_files,
                reverse_files,
                reverse_declared: declared_back,
                through: if direct { None } else { through.clone() },
                example: example.clone(),
            };
            let convention = Convention {
                // The id mining gives the same role and rule: accepted, it is the rule
                // mining keeps (`Keep`, by role and rule), and `ConventionsFile::merge`
                // finds it under the same id instead of adding a second copy.
                id: convention_id(role, &rule),
                status: Status::Proposed,
                mode: Mode::Advise,
                summary: layering_summary(role, target, importing, not_read),
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
                accepted_evidence: None,
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

/// The file units of mining's units: what the layering graph is built from.
fn file_units<'r>(units: &[crate::roles::Unit<'r>]) -> Vec<&'r FileFacts> {
    units
        .iter()
        .filter_map(|u| match u.view {
            View::File(f) => Some(f),
            _ => None,
        })
        .collect()
}

/// The graph of layers (areas) that [`layering`] reads, for `drift map --json`: what
/// a layering proposal rests on, from the same facts and the same functions.
#[derive(Debug, Clone, Default, Serialize)]
pub struct AreaGraph {
    /// Each pair of layers where production files of the first import the second
    /// (non-type-only path imports between packages or in the root package, as mining
    /// counts layer edges), with how many files. Sorted by `from`, then `to`.
    pub edges: Vec<AreaEdge>,
    /// The one-way pairs: `layer` never touches `never_imports` in any way (type-only,
    /// deferred and by workspace-package name included), `never_imports` has at least
    /// [`MIN_TARGET_FILES`] production files, and it imports `layer` in at least
    /// [`MIN_REVERSE_FILES`] files, or through a third layer. What a layering proposal
    /// starts from, before what [`layering`] asks of a role (its importing members, its
    /// package's manifest, the linter). Sorted by `layer`, then `never_imports`.
    pub one_way: Vec<OneWayPair>,
}

/// One edge of the [`AreaGraph`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct AreaEdge {
    pub from: String,
    pub to: String,
    pub files: usize,
}

/// One one-way pair of the [`AreaGraph`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct OneWayPair {
    pub layer: String,
    pub never_imports: String,
    /// Production files of `never_imports`.
    pub target_files: usize,
    /// Files of `never_imports` that import `layer`.
    pub reverse_files: usize,
    /// The third layer `never_imports` reaches `layer` through, where fewer than
    /// [`MIN_REVERSE_FILES`] files import it directly. Not serialised when none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub through: Option<String>,
}

/// The [`AreaGraph`] of `repo`: built as [`layering`] builds its graph, and its one-way
/// pairs found with the test [`layering`] applies first (`Graph::one_way_to`).
pub fn area_graph(repo: &RepoFacts, kinds: &FileKinds) -> AreaGraph {
    let units = crate::roles::units(repo, kinds);
    let files = file_units(&units);
    let graph = Graph::new(repo, &files);
    let edges = graph
        .edges
        .iter()
        .map(|((from, to), &files)| AreaEdge {
            from: from.clone(),
            to: to.clone(),
            files,
        })
        .collect();
    let mut one_way = Vec::new();
    for layer in graph.packages.keys() {
        for (target, &target_files) in &graph.targetable {
            let Some((reverse_files, through)) = graph.one_way_to(layer, target, target_files)
            else {
                continue;
            };
            if reverse_files < MIN_REVERSE_FILES && through.is_none() {
                continue;
            }
            one_way.push(OneWayPair {
                layer: layer.clone(),
                never_imports: target.clone(),
                target_files,
                reverse_files,
                through,
            });
        }
    }
    AreaGraph { edges, one_way }
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

/// "Code in packages/features never imports apps/web (779 files, none do; checked on
/// ...)", with "; 3 files of packages/features not read" before the clause when Drift
/// could not vouch for some files of the layer ([`LayeringEvidence::not_read`]): the
/// count is of files Drift read, and the summary says what `check` reads
/// ([`CHECKED_CLAUSE`]).
fn layering_summary(
    role: &RoleSelector,
    target: &str,
    importing: usize,
    not_read: usize,
) -> String {
    let scope = scope_of(role);
    let what = if role.dir == "." {
        format!("Files at the top of {scope}")
    } else if role.file == "*" {
        format!("Code in {scope}")
    } else {
        format!("{} files in {scope}", role.file)
    };
    let unread = match not_read {
        0 => String::new(),
        1 => format!("; 1 file of {} not read", layer_of_scope(&scope)),
        n => format!("; {n} files of {} not read", layer_of_scope(&scope)),
    };
    format!("{what} never imports {target} ({importing} files, none do{unread}; {CHECKED_CLAUSE})")
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
    /// Members that import in-repo code ([`Graph::importing`]) and that Drift read
    /// ([`Graph::unread`] apart).
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
    /// Files Drift cannot say anything is absent from: one that failed to parse (its
    /// imports are best-effort), one whose imports were cut short (`truncated` names
    /// `imports`), or one with an import Drift could not resolve. An unresolved import
    /// keeps its specifier, but both resolvers record a third-party package they cannot
    /// find as `pkg:` (read as such below, and never a layer); what stays `unresolved:`
    /// is a relative or aliased specifier (TypeScript, joined to the importer's folder,
    /// so an alias such as `@/x` no longer says where it points) or an in-repo Python
    /// package missing a submodule. Any of those may land in any layer, so the file is
    /// not read for every target, not only for one.
    unread: BTreeSet<&'a str>,
    /// Files of each layer, production files of `files` and skipped ones alike: the
    /// whole of what "no file of the layer imports" is said of.
    layer_files: BTreeMap<String, usize>,
    /// Files of each layer Drift cannot vouch for: [`Graph::unread`] ones, and the
    /// production paths the scan skipped whole (`RepoFacts::skipped`: no facts at all).
    not_read: BTreeMap<String, usize>,
}

impl<'a> Graph<'a> {
    fn new(repo: &'a RepoFacts, files: &[&'a FileFacts]) -> Self {
        // (a Python package, its name) -> its directory: an import by name lands only in
        // a package of the importer's own ecosystem (`import emails` in Python is not the
        // npm workspace package `emails`), as `crate::map`'s `Targets::by_name`.
        let by_name: BTreeMap<(bool, &str), &str> = repo
            .packages
            .iter()
            .filter(|p| !p.name.is_empty())
            .map(|p| {
                (
                    (crate::roles::is_python_package(p), p.name.as_str()),
                    p.path.as_str(),
                )
            })
            .collect();
        let mut packages: BTreeMap<String, BTreeSet<&'a str>> = BTreeMap::new();
        let mut package_areas: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
        let mut targetable: BTreeMap<String, usize> = BTreeMap::new();
        let mut unread: BTreeSet<&'a str> = BTreeSet::new();
        let mut layer_files: BTreeMap<String, usize> = BTreeMap::new();
        let mut not_read: BTreeMap<String, usize> = BTreeMap::new();
        for s in repo
            .skipped
            .iter()
            .filter(|s| !crate::roles::is_test_path(&s.path))
        {
            let a = area(&s.path);
            *layer_files.entry(a.clone()).or_default() += 1;
            *not_read.entry(a).or_default() += 1;
        }
        for &f in files {
            let a = area(&f.path);
            *layer_files.entry(a.clone()).or_default() += 1;
            if !f.parse_ok
                || f.truncated.iter().any(|t| t == "imports")
                || f.imports
                    .iter()
                    .any(|i| i.module.starts_with("unresolved:"))
            {
                unread.insert(f.path.as_str());
                *not_read.entry(a.clone()).or_default() += 1;
            }
            packages
                .entry(a.clone())
                .or_default()
                .insert(f.package.as_str());
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
                    let Some(&path) = by_name.get(&(f.lang == "py", name.as_str())) else {
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
            unread,
            layer_files,
            not_read,
        }
    }

    /// Files of the layer `area` Drift cannot vouch for ([`Graph::not_read`]).
    fn not_read_in(&self, area: &str) -> usize {
        self.not_read.get(area).copied().unwrap_or(0)
    }

    /// Files of the layer `area`, read or not ([`Graph::layer_files`]).
    fn files_in(&self, area: &str) -> usize {
        self.layer_files.get(area).copied().unwrap_or(0)
    }

    fn edges(&self, from: &str, to: &str) -> usize {
        self.edges
            .get(&(from.to_string(), to.to_string()))
            .copied()
            .unwrap_or(0)
    }

    /// `layer` never touches `target` ([`Graph::touches`]), a layer of at least
    /// [`MIN_TARGET_FILES`] production files: the files of `target` that import `layer`,
    /// and, where fewer than [`MIN_REVERSE_FILES`] do, the third layer `target` reaches
    /// it through ([`Graph::through`]). `None` for any other pair. The first test of
    /// [`layering`], and the one-way pairs of [`area_graph`].
    fn one_way_to(
        &self,
        layer: &str,
        target: &str,
        target_files: usize,
    ) -> Option<(usize, Option<String>)> {
        if target == layer || target_files < MIN_TARGET_FILES || self.touches(layer, target) > 0 {
            return None;
        }
        let reverse_files = self.edges(target, layer);
        let through = if reverse_files < MIN_REVERSE_FILES {
            self.through(target, layer)
        } else {
            None
        };
        Some((reverse_files, through))
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
        self.packages.get(area).is_some_and(|p| p.contains(package))
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
            layering_summary(&role, "apps/web", 779, 0),
            format!(
                "Code in packages/ui never imports apps/web (779 files, none do; {CHECKED_CLAUSE})"
            )
        );
        // Files Drift did not read are named apart, never counted as files that do not
        // import (rule 2: unknown is never "none do").
        assert_eq!(
            layering_summary(&role, "apps/web", 779, 3),
            format!(
                "Code in packages/ui never imports apps/web (779 files, none do; 3 files of packages/ui not read; {CHECKED_CLAUSE})"
            )
        );
    }
}
