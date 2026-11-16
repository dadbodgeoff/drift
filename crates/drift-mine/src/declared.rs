//! Rules the repository declares in writing, read as evidence and offered as proposals
//! from the map ([`Convention::from_map`] [`DECLARED`]).
//!
//! A linter configuration that forbids a folder to import another is the team stating
//! a layering rule in writing: cal.com's `biome.json` forbids `packages/lib` to import
//! `packages/features`, `packages/app-store` and `packages/trpc`, and more. Drift already
//! reads those settings (`drift_core::LintConfig::scoped`: `no-restricted-imports` at
//! `warn` or `error` in an `overrides` entry of a JSON configuration, with the folders
//! the entry's globs name), but only as a veto on mining. This module reads the same
//! facts as a statement: each restriction Drift can express with its own layering rule
//! (`Rule::Avoids { signal: "import:<area>" }`, the rule [`crate::from_map::layering`]
//! proposes and `drift check` evaluates) is checked against the code and offered as a
//! proposal labelled "declared in `<file>`", with how many files follow it, how many
//! break it today and how many Drift could not read. A declared rule the code breaks in
//! many places is still made, with that count: it is the team's rule, and the count is
//! the news. Whether it is offered is then decided as for every proposal from the map
//! (the show policy: a suggestion-tier one with more outliers than the policy shows is
//! held, with why, since the conventions file would not keep it).
//!
//! What it never does:
//!
//! - guess. Only what the scan reads as written is read: the `overrides` of a JSON
//!   configuration, and, apart from what mining reads (`drift_core::LintConfig::declared`),
//!   each block of an ESLint JavaScript or TypeScript configuration that a literal
//!   `files` scopes to a folder, and the Python linters' banned modules and import
//!   contracts (ruff, flake8-tidy-imports, import-linter) ([`crate::declared_lint`]).
//!   A configuration the scan could not parse is listed with no settings, so it gives
//!   nothing; a setting the scan could not read whole (a block built by a call, one a
//!   later unread part may change, one that leaves files out, a contract that forbids
//!   indirect imports too) is listed with why and never proposed. A restriction Drift cannot express exactly (an
//!   allow-list, one about some names of a module only, a pattern over many packages, a
//!   package outside the repository, part of a layer) is listed with why, never
//!   approximated by a wider or narrower rule.
//! - duplicate. A restriction a mined convention or a layering proposal from the map
//!   already states is attached to that one ("also declared in `<file>`",
//!   [`AlsoDeclared`]), as [`crate::from_map::Proposal::same_as_mined`] does for layering.
//! - count what it could not read against the rule: a file Drift could not read to the
//!   end is "not read", never a break.
//!
//! Like every proposal from the map, these are `proposed` and `advise`, written with no
//! agents choice, kept out of `drift.lock` until a person accepts one, and they pass
//! through none of mining's gates. Mining, its ids and its output are untouched.
//!
//! Instruction files people write for agents (`AGENTS.md`, `CLAUDE.md`, the files
//! `drift export agents-md` writes into) are prose: Drift records only that one exists
//! and which of its proposals an export would add to it ([`instruction_notes`]), and
//! never reads rules out of the prose.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use drift_core::{FileFacts, RepoFacts, SkipReason, SymbolKind};
use serde::Serialize;
use serde_json::{Value, json};

use crate::context::RepoContext;
use crate::from_map::{self, MinedRule};
use crate::mine::{Evidence, Rule, r3, wilson_lower_bound};
use crate::policy::{Convention, Mode, Status};
use crate::report::{MAX_PATH, sanitize};
use crate::roles::{FILE_UNIT, FileKinds, PACKAGE_WIDE, RoleSelector, View, is_test_path};
use crate::unchecked::Unchecked;

/// Repository text (a configuration's path, an option as written, a folder) as it is
/// put in a line people or, once accepted, agents read: [`sanitize`]d.
pub(crate) fn safe(s: &str) -> String {
    sanitize(s, MAX_PATH)
}

/// [`safe`] of each of `items`, joined by `sep`.
fn safe_list(items: &[String], sep: &str) -> String {
    items
        .iter()
        .map(String::as_str)
        .map(safe)
        .collect::<Vec<_>>()
        .join(sep)
}

/// What cannot be expressed, by (configuration, folder, why, words).
pub(crate) type NotKey = (String, String, &'static str, String);

/// [`Convention::from_map`] of a rule the repository declares ([`declared`]).
pub const DECLARED: &str = "declared";

/// The tool-neutral name the scan gives an import restriction
/// (`drift_core::LintRule::rule`).
const RESTRICTED_IMPORTS: &str = "no-restricted-imports";

/// Option keys, in the linters' own configuration formats (ESLint and oxlint
/// `no-restricted-imports`, Biome `noRestrictedImports`), that narrow a restriction to
/// some names of a module. With one of them a restriction is not "nothing from this
/// module", and the scan keeps the options as a bag of strings that no longer says which
/// path each narrowing belongs to: the entry is read as nothing rather than guessed.
/// (`allowTypeImports` narrows nothing Drift's rule counts: it never counts a type-only
/// import.)
const PARTIAL_KEYS: &[&str] = &[
    "importNames",
    "allowImportNames",
    "importNamePattern",
    "allowImportNamePattern",
    "invertImportNamePattern",
];

/// Files named per proposal ("breaks it today: a.ts, b.ts, and 3 more").
const MAX_NAMED: usize = 3;

/// The file names `drift export agents-md --write` is documented to write into.
pub const INSTRUCTION_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md"];

/// The start of the block `drift export agents-md` writes (`drift-cli`'s `export::START`).
const EXPORT_MARK: &str = "<!-- drift:start";

/// What a declared proposal rests on, counted from the facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeclaredEvidence {
    /// The configuration files that declare it (`biome.json`), sorted.
    pub configs: Vec<String>,
    /// `error` or `warn`: the strongest level it is declared at.
    pub level: String,
    /// The folder the declaration covers (`packages/lib`).
    pub scope: String,
    /// The layer it must not import (`packages/features`).
    pub target: String,
    /// The options as written that name the target (`../features/**`), sorted.
    pub written: Vec<String>,
    /// Members of the role the rule is checked on (the files of `scope` Drift's role
    /// holds).
    pub in_scope: usize,
    /// Production files under `scope` that the role does not hold: those of a nested
    /// workspace package, and, for a folder's role (`file: "*"`), the files of a kind of
    /// their own there (`*.service`, `route`), which are in their kind's roles only. The
    /// declaration covers them, the proposed rule does not.
    pub outside_role: usize,
    /// Members Drift read that follow the rule.
    pub follows: usize,
    /// Members Drift read that break it today.
    pub breaks: usize,
    /// The first [`MAX_NAMED`] members that break it, sorted.
    pub breaking: Vec<String>,
    /// Production files under `scope` Drift cannot vouch for, counted as a layering
    /// proposal counts them (`from_map::LayeringEvidence::not_read`): one that failed to
    /// parse, one whose imports were cut short or include one Drift could not resolve,
    /// and one the scan skipped whole. Neither follows nor breaks.
    pub not_read: usize,
    /// Members that follow the rule and still import the target in a way it does not
    /// count (type-only, by workspace-package name, a declared dependency): the
    /// declaration may cover those imports, the rule does not see them.
    pub unseen: usize,
    /// A member that follows it, `path#(file)` (empty when none does).
    pub example: String,
    /// Where each setting that declares it is written, `<file>:<line>`, sorted; empty
    /// for a JSON configuration's `overrides`, whose lines the scan does not keep.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub at: Vec<String>,
}

/// A rule the repository declares, proposed.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DeclaredProposal {
    /// `status: proposed`, `mode: advise`, `from_map: declared`, no agents choice.
    pub convention: Convention,
    pub declared: DeclaredEvidence,
}

/// A declared restriction Drift already states another way: not proposed again, said
/// next to the one that states it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct AlsoDeclared {
    /// The id of the mined convention or the layering proposal that states it.
    pub id: String,
    /// `mined` or [`from_map::LAYERING`].
    pub by: &'static str,
    pub configs: Vec<String>,
    pub scope: String,
    pub target: String,
    pub written: Vec<String>,
}

/// A declared restriction Drift cannot express with a rule it has: listed with why.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct NotExpressed {
    pub config: String,
    pub scope: String,
    /// The options as written, sorted.
    pub written: Vec<String>,
    /// `allow_list`, `partial`, `pattern`, `package`, `outside`, `not_a_layer`,
    /// `no_folder`, `no_role`, `own_layer`, `declared_dependency`, `nothing_read`.
    pub why: &'static str,
    /// For people.
    pub words: String,
}

/// What the repository's declarations give.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Declared {
    /// Strongest first: those the code follows today before those it breaks, then more
    /// members read, then by id. Deterministic.
    pub proposals: Vec<DeclaredProposal>,
    pub also: Vec<AlsoDeclared>,
    pub not_expressed: Vec<NotExpressed>,
}

/// A line of information from the map that is not a proposal: never written to the
/// conventions file, listed by `drift census --from-map` (text and JSON) only. Shared by
/// this module and [`crate::wiring_proposals`].
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Note {
    /// The id it is about: a mined convention's or a proposal's ("also declared in"), a
    /// wiring regularity's own; empty for one about a file.
    pub id: String,
    /// [`DECLARED`] or [`crate::wiring_proposals::WIRING`].
    pub kind: &'static str,
    /// As `drift census --from-map` prints it, indented.
    pub lines: Vec<String>,
    /// As `drift census --from-map --json` lists it.
    pub json: Value,
}

/// One scoped import restriction of one configuration, for one folder.
pub(crate) struct Entry<'r> {
    pub(crate) config: &'r str,
    pub(crate) level: &'r str,
    pub(crate) dir: std::borrow::Cow<'r, str>,
    pub(crate) options: &'r [String],
    /// `<file>:<line>` of the setting, where the scan keeps its line.
    pub(crate) at: Option<String>,
    /// The options are Python modules, dotted.
    pub(crate) python: bool,
}

/// What one option names.
pub(crate) enum Target {
    /// Not a module specifier (a message, an option key, a bare word that names no
    /// workspace package): no restriction to read.
    Ignore,
    /// A whole layer of this repository.
    Area(String),
    /// A restriction Drift cannot express: why, and the words.
    Not(&'static str, String),
}

/// The restrictions declared for one folder and one layer, over every configuration.
#[derive(Default)]
struct Group {
    configs: BTreeSet<String>,
    level: String,
    written: BTreeSet<String>,
    at: BTreeSet<String>,
}

/// The repository's declared import restrictions, read from the facts and checked
/// against the code ([`Declared`]). `mined`: the rules Drift already has (mined, or in
/// the policy), compared as [`from_map::layering`] compares them. Nothing is read when no
/// configuration scopes an import restriction to a folder (the units are not even
/// built).
pub fn declared(repo: &RepoFacts, kinds: &FileKinds, mined: &[MinedRule<'_>]) -> Declared {
    let mut out = Declared::default();
    let mut entries = entries(repo);
    let mut not: BTreeMap<NotKey, BTreeSet<String>> = BTreeMap::new();
    let listed = crate::declared_lint::listed(repo);
    entries.extend(listed.entries);
    not.extend(listed.not);
    if entries.is_empty() && not.is_empty() {
        return out;
    }
    let units = crate::roles::units(repo, kinds);
    let ctx = RepoContext::new(repo, &units);
    let files: Vec<&FileFacts> = units
        .iter()
        .filter_map(|u| match u.view {
            View::File(f) => Some(f),
            _ => None,
        })
        .collect();
    let areas: BTreeSet<String> = files
        .iter()
        .filter(|f| f.path.contains('/'))
        .map(|f| area(&f.path))
        .collect();

    // Restrictions, grouped by (folder, layer); what cannot be expressed, by what it is.
    let mut groups: BTreeMap<(String, String), Group> = BTreeMap::new();
    for e in &entries {
        let label = e.at.as_deref().unwrap_or(e.config);
        if e.options.iter().any(|o| o.starts_with('!')) {
            let words = "it allows only the modules it lists and forbids the rest (an allow-list): Drift has no rule kind for \"imports only these\"".to_string();
            not.entry((label.to_string(), e.dir.to_string(), "allow_list", words))
                .or_default()
                .extend(specifiers(e.options));
            continue;
        }
        if e.options.iter().any(|o| PARTIAL_KEYS.contains(&o.as_str())) {
            let words =
                "it restricts only some names of a module, and Drift's rule is about whole layers"
                    .to_string();
            not.entry((label.to_string(), e.dir.to_string(), "partial", words))
                .or_default()
                .extend(specifiers(e.options));
            continue;
        }
        for o in e.options {
            let target = if e.python {
                crate::declared_lint::target_of(&areas, &files, e.config, e.dir.as_ref(), o)
            } else {
                target_of(repo, &areas, &files, e.dir.as_ref(), o)
            };
            match target {
                Target::Ignore => {}
                Target::Area(t) => {
                    let g = groups.entry((e.dir.to_string(), t)).or_default();
                    g.configs.insert(e.config.to_string());
                    if g.level != "error" {
                        g.level = e.level.to_string();
                    }
                    g.written.insert(o.clone());
                    g.at.extend(e.at.clone());
                }
                Target::Not(why, words) => {
                    not.entry((label.to_string(), e.dir.to_string(), why, words))
                        .or_default()
                        .insert(o.clone());
                }
            }
        }
    }

    // The file role that holds the files of each folder (the whole package where the
    // folder is a package), with its members.
    let roles = scope_roles(&units);
    let unread = import_unread(repo, &files);
    let by_name: BTreeMap<&str, &str> = repo
        .packages
        .iter()
        .filter(|p| !p.path.is_empty() && !p.name.is_empty())
        .filter(|p| !crate::roles::is_python_package(p))
        .map(|p| (p.name.as_str(), p.path.as_str()))
        .collect();
    let mut layering: Option<Vec<from_map::Proposal>> = None;

    for ((scope, target), g) in groups {
        let configs: Vec<String> = g.configs.iter().cloned().collect();
        let written: Vec<String> = g.written.iter().cloned().collect();
        let at: Vec<String> = g.at.iter().cloned().collect();
        // Where a setting's line is known, a note names it there.
        let labels: Vec<String> = if at.is_empty() {
            configs.clone()
        } else {
            at.clone()
        };
        let mut held = |why: &'static str, words: String| {
            for c in &labels {
                not.entry((c.clone(), scope.clone(), why, words.clone()))
                    .or_default()
                    .extend(written.iter().cloned());
            }
        };
        let Some((role, members)) = roles.get(&scope) else {
            held(
                "no_role",
                format!(
                    "no role of Drift's holds the files of `{}` as one place, so no rule can be written for them",
                    safe(&scope)
                ),
            );
            continue;
        };
        let layer = layer_of_scope(&scope);
        let own_package = !role.package.is_empty()
            && (target == role.package || target.starts_with(&format!("{}/", role.package)));
        if target == layer
            || target.starts_with(&format!("{scope}/"))
            || scope.starts_with(&format!("{target}/"))
            || own_package
        {
            held(
                "own_layer",
                format!(
                    "`{}` is the restricted files' own layer or package, where an import is no layer edge Drift checks",
                    safe(&target)
                ),
            );
            continue;
        }
        if let Some(name) = declared_in(repo, &ctx, &role.package, &target) {
            held(
                "declared_dependency",
                format!(
                    "`{}` declares `{}` as a dependency, and Drift's layering rule never counts an import of a declared dependency, so it could not check this",
                    safe(&role.package),
                    safe(&name)
                ),
            );
            continue;
        }
        let rule = Rule::Avoids {
            signal: format!("import:{target}"),
        };

        // What `drift check` would say today, on the files Drift read.
        let mut follows = 0usize;
        let mut breaking: Vec<String> = Vec::new();
        let mut unseen = 0usize;
        let mut example = String::new();
        for &f in members {
            if unread.contains(f.path.as_str()) {
                continue;
            }
            if rule.holds_in(Some(role), &View::File(f), &ctx) {
                follows += 1;
                if example.is_empty() {
                    example = format!("{}#{FILE_UNIT}", f.path);
                }
                if touches(f, &target, &by_name) {
                    unseen += 1;
                }
            } else {
                breaking.push(f.path.clone());
            }
        }
        breaking.sort();
        let breaks = breaking.len();
        let read = follows + breaks;
        if read == 0 {
            held(
                "nothing_read",
                format!(
                    "Drift read none of the files of `{}` to the end, so it cannot say whether the code follows it",
                    safe(&scope)
                ),
            );
            continue;
        }
        // Not read, as a layering proposal counts it: production files of the place
        // Drift cannot vouch for, and the production paths the scan skipped whole.
        let prefix = format!("{scope}/");
        let not_read = files
            .iter()
            .filter(|f| f.path.starts_with(&prefix) && unread.contains(f.path.as_str()))
            .count()
            + repo
                .skipped
                .iter()
                .filter(|s| s.path.starts_with(&prefix) && !is_test_path(&s.path))
                .count();
        let under = files.iter().filter(|f| f.path.starts_with(&prefix)).count();
        let evidence = DeclaredEvidence {
            configs: configs.clone(),
            level: g.level.clone(),
            scope: scope.clone(),
            target: target.clone(),
            written: written.clone(),
            in_scope: members.len(),
            outside_role: under.saturating_sub(members.len()),
            follows,
            breaks,
            breaking: breaking.iter().take(MAX_NAMED).cloned().collect(),
            not_read,
            unseen,
            example: example.clone(),
            at: at.clone(),
        };

        // Said already: by a mined convention, or by a layering proposal from the map.
        let same =
            |r: &Rule, role: &RoleSelector| *r == rule && layer_of_scope(&scope_of(role)) == layer;
        let also = |id: &str, by: &'static str| AlsoDeclared {
            id: id.to_string(),
            by,
            configs: configs.clone(),
            scope: scope.clone(),
            target: target.clone(),
            written: written.clone(),
        };
        if let Some(m) = mined.iter().find(|m| same(m.rule, m.role)) {
            out.also.push(also(m.id, "mined"));
            continue;
        }
        let proposed = layering.get_or_insert_with(|| from_map::layering(repo, kinds, mined));
        if let Some(p) = proposed
            .iter()
            .find(|p| same(&p.convention.rule, &p.convention.role))
        {
            out.also.push(also(&p.convention.id, from_map::LAYERING));
            continue;
        }

        let python = members.iter().filter(|f| f.lang == "py").count();
        let convention = Convention {
            id: declared_id(role, &target),
            status: Status::Proposed,
            mode: Mode::Advise,
            summary: declared_summary(role, &target, &configs, breaks, read),
            role: role.clone(),
            rule,
            evidence: Evidence {
                holders: follows,
                total: read,
                lower_bound: r3(wilson_lower_bound(follows, read)),
                // No contrast is measured: the team's statement is the evidence.
                lift: 0.0,
                split: vec![],
                role_members: (members.len() != read).then_some(members.len()),
                python_members: (python > 0).then_some(python),
            },
            example: if example.is_empty() {
                members
                    .first()
                    .map_or(String::new(), |f| format!("{}#{FILE_UNIT}", f.path))
            } else {
                example
            },
            selector_version: crate::policy::selector_version_of(role),
            agents: None,
            exceptions: Vec::new(),
            different_kind: Vec::new(),
            promoted_from_hidden: false,
            promoted_from_practice: None,
            from_map: Some(DECLARED.to_string()),
            accepted_evidence: None,
        };
        out.proposals.push(DeclaredProposal {
            convention,
            declared: evidence,
        });
    }

    out.proposals.sort_by(|a, b| {
        (
            a.declared.breaks > 0,
            std::cmp::Reverse(a.declared.follows + a.declared.breaks),
            &a.convention.id,
        )
            .cmp(&(
                b.declared.breaks > 0,
                std::cmp::Reverse(b.declared.follows + b.declared.breaks),
                &b.convention.id,
            ))
    });
    out.also.sort();
    out.also.dedup();
    out.not_expressed = not
        .into_iter()
        .map(|((config, scope, why, words), written)| NotExpressed {
            config,
            scope,
            written: written.into_iter().collect(),
            why,
            words,
        })
        .collect();
    out.not_expressed.sort();
    out
}

/// The id of a declared proposal: `D-` and 6 hex digits of what it is about (the role's
/// place and the layer it must not import), never of its counts or of the file that
/// declares it, so it is the same however many files break it and wherever the
/// declaration moves. Its input is repository-relative text only (no absolute path, no
/// map order), so it is the same on every machine. It starts with `declared`, so it is
/// apart from every mined id's input (`crate::mine::convention_id`, a serialised role
/// and rule, which a layering proposal also takes): the two `D-` spaces meet only by a
/// collision of 6 hex digits, and then [`ConventionsFile`](crate::policy::ConventionsFile)
/// keeps the convention already there (a proposal is never written over an id in use).
pub fn declared_id(role: &RoleSelector, target: &str) -> String {
    let h = blake3::hash(
        format!(
            "declared\0{}\0{}\0{}\0{target}",
            role.package, role.dir, role.file
        )
        .as_bytes(),
    );
    format!("D-{}", &h.to_hex()[..6])
}

/// "Code in packages/lib does not import packages/features, as biome.json declares (2 of
/// 241 files do today)".
fn declared_summary(
    role: &RoleSelector,
    target: &str,
    configs: &[String],
    breaks: usize,
    read: usize,
) -> String {
    let scope = safe(&scope_of(role));
    let what = if role.dir == "." {
        format!("Files at the top of {scope}")
    } else if role.file == "*" {
        format!("Code in {scope}")
    } else {
        format!("{} files in {scope}", safe(&role.file))
    };
    let by = configs
        .first()
        .map_or_else(|| "a lint configuration".to_string(), |c| safe(c));
    let today = if breaks == 0 {
        format!("none of {read} files do")
    } else {
        format!("{breaks} of {read} files do today")
    };
    format!(
        "{what} does not import {}, as {by} declares ({today})",
        safe(target)
    )
}

/// The scoped import restrictions of every linter configuration, one per folder: a
/// JSON configuration's `overrides` ([`drift_core::LintConfig::scoped`]), and the
/// JavaScript import restrictions listed with their lines that the scan read whole
/// ([`drift_core::LintConfig::declared`]; the Python ones are
/// [`crate::declared_lint`]'s).
fn entries(repo: &RepoFacts) -> Vec<Entry<'_>> {
    let mut out = Vec::new();
    for c in &repo.lint {
        for sc in &c.scoped {
            for r in sc.rules.iter().filter(|r| {
                r.rule == RESTRICTED_IMPORTS && matches!(r.level.as_str(), "warn" | "error")
            }) {
                for d in &sc.dirs {
                    out.push(Entry {
                        config: &c.path,
                        level: &r.level,
                        dir: d.as_str().into(),
                        options: &r.options,
                        at: None,
                        python: false,
                    });
                }
            }
        }
        for d in c.declared.iter().filter(|d| {
            d.rule == drift_core::DECLARED_IMPORTS
                && d.limits.is_empty()
                && matches!(d.level.as_str(), "warn" | "error")
        }) {
            out.push(Entry {
                config: &c.path,
                level: &d.level,
                dir: d.dir.as_str().into(),
                options: &d.options,
                at: Some(format!("{}:{}", c.path, d.line)),
                python: false,
            });
        }
    }
    out
}

/// The options that read as module specifiers (a relative path, a scoped name, a path,
/// a negation), for listing a restriction Drift cannot express.
fn specifiers(options: &[String]) -> impl Iterator<Item = String> + '_ {
    options
        .iter()
        .filter(|o| !o.is_empty() && !o.chars().any(char::is_whitespace))
        .filter(|o| {
            o.starts_with('.') || o.starts_with('@') || o.starts_with('!') || o.contains('/')
        })
        .cloned()
}

/// What `option`, declared for the folder `dir`, names. A relative option is read from
/// `dir`, as the existing reading of a declared layer reads it
/// (`RepoContext::forbids_import`); a workspace package's name stands for its folder;
/// `x`, `x/*` and `x/**` all name the whole of `x`. Only a whole layer, as Drift counts
/// layers (`crate::mine`'s `area`: the first two folders), can be expressed.
fn target_of(
    repo: &RepoFacts,
    areas: &BTreeSet<String>,
    files: &[&FileFacts],
    dir: &str,
    option: &str,
) -> Target {
    if option.is_empty() || option.chars().any(char::is_whitespace) {
        return Target::Ignore;
    }
    let specifier = option.starts_with('.') || option.starts_with('@') || option.contains('/');
    let base = option
        .strip_suffix("/**")
        .or_else(|| option.strip_suffix("/*"))
        .unwrap_or(option);
    if base.contains(['*', '?', '{', '[', '^', '$', '|', '\\', '(']) {
        return if specifier {
            Target::Not(
                "pattern",
                format!(
                    "`{}` is a pattern over many modules, and Drift's layering rule names one layer",
                    safe(option)
                ),
            )
        } else {
            Target::Ignore
        };
    }
    let path = if base == "." || base == ".." || base.starts_with("./") || base.starts_with("../") {
        match resolve_relative(dir, base) {
            Some(p) if !p.is_empty() => p,
            _ => {
                return Target::Not(
                    "outside",
                    format!(
                        "read from `{}`, `{}` names a place outside this repository",
                        safe(dir),
                        safe(option)
                    ),
                );
            }
        }
    } else if let Some(p) = workspace_path(repo, base) {
        p
    } else if specifier {
        return Target::Not(
            "package",
            format!(
                "`{}` names a package outside this repository, or an alias Drift does not place, and Drift's layering rule is about this repository's own code",
                safe(option)
            ),
        );
    } else {
        return Target::Ignore;
    };
    area_target(areas, files, dir, option, path)
}

/// What the repository path `path`, read from `option` declared for the folder `dir`,
/// names: a whole layer as Drift counts layers, or why not.
pub(crate) fn area_target(
    areas: &BTreeSet<String>,
    files: &[&FileFacts],
    dir: &str,
    option: &str,
    path: String,
) -> Target {
    let layer = area(&format!("{path}/x"));
    if layer == path && areas.contains(&path) {
        return Target::Area(path);
    }
    let prefix = format!("{path}/");
    if files.iter().any(|f| f.path.starts_with(&prefix)) {
        return Target::Not(
            "not_a_layer",
            format!(
                "`{}` names `{}`, which is not one layer as Drift counts layers (the first two folders), and Drift's layering rule names whole layers",
                safe(option),
                safe(&path)
            ),
        );
    }
    Target::Not(
        "no_folder",
        format!(
            "read from `{}`, `{}` names `{}`, where Drift found no source file",
            safe(dir),
            safe(option),
            safe(&path)
        ),
    )
}

/// The folder of the workspace package `spec` names (`@x/web` -> `apps/web`), or of a
/// path inside it (`@x/web/lib` -> `apps/web/lib`). npm packages only: a lint
/// configuration restricts JavaScript imports.
fn workspace_path(repo: &RepoFacts, spec: &str) -> Option<String> {
    let npm = || {
        repo.packages
            .iter()
            .filter(|p| !p.path.is_empty() && !p.name.is_empty())
            .filter(|p| !crate::roles::is_python_package(p))
    };
    if let Some(p) = npm().find(|p| p.name == spec) {
        return Some(p.path.clone());
    }
    npm()
        .filter_map(|p| {
            spec.strip_prefix(p.name.as_str())
                .and_then(|r| r.strip_prefix('/'))
                .map(|rest| format!("{}/{rest}", p.path))
        })
        .min()
}

/// For each folder, the file role that holds its files as one place: the whole package
/// ([`PACKAGE_WIDE`]) where the folder is a workspace package, else the role of the
/// folder's files of no particular kind (`file: "*"`). Of two at one folder, the
/// package-wide one, then the one with more members, then the first. Members sorted by
/// path.
fn scope_roles<'r>(
    units: &[crate::roles::Unit<'r>],
) -> BTreeMap<String, (RoleSelector, Vec<&'r FileFacts>)> {
    let mut by_role: BTreeMap<&RoleSelector, Vec<&'r FileFacts>> = BTreeMap::new();
    for u in units {
        let View::File(f) = u.view else {
            continue;
        };
        for r in &u.roles {
            if r.kind == SymbolKind::Module
                && r.shape.is_none()
                && r.also.is_empty()
                && r.file == "*"
                && r.dir != "."
            {
                by_role.entry(r).or_default().push(f);
            }
        }
    }
    let mut out: BTreeMap<String, (RoleSelector, Vec<&'r FileFacts>)> = BTreeMap::new();
    for (role, mut members) in by_role {
        let scope = scope_of(role);
        if scope.is_empty() {
            continue;
        }
        members.sort_by(|a, b| a.path.cmp(&b.path));
        members.dedup_by(|a, b| a.path == b.path);
        let better = match out.get(&scope) {
            None => true,
            Some((r, m)) => {
                (role.dir == PACKAGE_WIDE, members.len()) > (r.dir == PACKAGE_WIDE, m.len())
            }
        };
        if better {
            out.insert(scope, (role.clone(), members));
        }
    }
    out
}

/// The package at `package` declares a workspace package of the layer `target`: its
/// name. Mining's layering signal never counts an import of a declared dependency
/// (`crate::mine::signals`).
fn declared_in(repo: &RepoFacts, ctx: &RepoContext, package: &str, target: &str) -> Option<String> {
    repo.packages
        .iter()
        .filter(|q| !q.path.is_empty() && !q.name.is_empty() && q.path != package)
        .filter(|q| {
            q.path == target
                || q.path.starts_with(&format!("{target}/"))
                || target.starts_with(&format!("{}/", q.path))
        })
        .find(|q| ctx.package_depends_on(package, &q.name))
        .map(|q| q.name.clone())
}

/// `f` imports something of the layer `target` in any way: by path (whatever the rule
/// counts), or by a workspace package's name.
fn touches(f: &FileFacts, target: &str, by_name: &BTreeMap<&str, &str>) -> bool {
    let prefix = format!("{target}/");
    f.imports.iter().any(|i| {
        let m = i.module.as_str();
        if let Some(name) = crate::map::imported_package_name(m) {
            return by_name
                .get(name.as_str())
                .is_some_and(|p| *p == target || p.starts_with(&prefix));
        }
        m.starts_with(&prefix)
    })
}

/// The production files of `files` Drift cannot say an import is absent from, read as
/// the layering proposals read them (`crate::from_map`'s `Graph::unread`): one that
/// failed to parse, one whose imports were cut short, one with an import Drift could not
/// resolve (it may land in any layer); and, reading less rather than more, one whose
/// facts depend on a file skipped for lack of stack ([`Unchecked::uncertain`]). Neither
/// follows nor breaks a declared rule. The paths the scan skipped whole have no facts,
/// so they are no member; [`declared`] counts them apart.
fn import_unread<'r>(repo: &RepoFacts, files: &[&'r FileFacts]) -> BTreeSet<&'r str> {
    let unchecked = Unchecked::of(repo);
    files
        .iter()
        .filter(|f| {
            !f.parse_ok
                || f.truncated.iter().any(|t| t == "imports")
                || f.imports
                    .iter()
                    .any(|i| i.module.starts_with("unresolved:"))
                || unchecked.uncertain(&f.path)
        })
        .map(|&f| f.path.as_str())
        .collect()
}

/// Repository files Drift could not read to the end: a file whose parse failed, one
/// skipped for its size or a parser limit, and one whose facts depend on a file skipped
/// for lack of stack ([`Unchecked::uncertain`]). What they hold is unknown, not absent.
/// Generated, minified and declaration files are left out on purpose, so they are not
/// in it.
pub fn unread_paths(repo: &RepoFacts) -> BTreeSet<String> {
    let unchecked = Unchecked::of(repo);
    let mut out: BTreeSet<String> = repo
        .files
        .iter()
        .filter(|f| !f.parse_ok || unchecked.uncertain(&f.path))
        .map(|f| f.path.clone())
        .collect();
    out.extend(
        repo.skipped
            .iter()
            .filter(|s| {
                matches!(
                    s.reason,
                    SkipReason::TooLarge
                        | SkipReason::NotUtf8
                        | SkipReason::TooDeep
                        | SkipReason::TooCostly
                        | SkipReason::StackUnavailable
                        | SkipReason::FlowSyntax
                        | SkipReason::ComponentScript
                )
            })
            .map(|s| s.path.clone()),
    );
    out
}

/// The lines `drift census --from-map` prints for a declared proposal: what it says,
/// how many follow and break it of the files Drift read, how many it could not read, and
/// what the rule does not cover of the declaration.
pub fn proposal_lines(c: &Convention, e: &DeclaredEvidence) -> Vec<String> {
    let read = e.follows + e.breaks;
    let mut out = vec![format!(
        "  [{}] {}: declared in {} ({}, `{}` for {}); of the {} files there Drift read, {} follow it, {} {} it today; {} could not be read (never reported)",
        c.id,
        c.summary,
        safe_list(if e.at.is_empty() { &e.configs } else { &e.at }, ", "),
        e.level,
        safe_list(&e.written, "`, `"),
        safe(&e.scope),
        read,
        e.follows,
        e.breaks,
        if e.breaks == 1 { "breaks" } else { "break" },
        e.not_read
    )];
    if e.breaks > 0 {
        let more = e.breaks.saturating_sub(e.breaking.len());
        out.push(format!(
            "    the team's own rule, broken in {} file(s) today: {}{}. Accepting it records those as they are and reports only a new import against it",
            e.breaks,
            safe_list(&e.breaking, ", "),
            if more > 0 {
                format!(", and {more} more")
            } else {
                String::new()
            }
        ));
    }
    if e.unseen > 0 {
        out.push(format!(
            "    {} of the files that follow it import {} in a way Drift's rule does not count (type-only, by package name, or a declared dependency): the linter may see those, this rule does not",
            e.unseen,
            safe(&e.target)
        ));
    }
    if e.outside_role > 0 {
        out.push(format!(
            "    {} file(s) under {} are in no part of this rule (a nested package's files, or files of a kind of their own there): the declaration covers them, this rule does not",
            e.outside_role,
            safe(&e.scope)
        ));
    }
    out.push(
        "    the linter reports a break when it runs; accepted, Drift also tells an agent the rule before it writes the import".to_string(),
    );
    out
}

/// The lines of `drift review`'s card for a proposed declared convention. `breaks` and
/// `unread`: the files that break it and those Drift could not read to the end, as the
/// caller checked them just now, because accepting records what breaks it at that
/// moment, not what broke it when it was proposed (the counts kept in `c`, said as
/// such).
pub fn card_lines(c: &Convention, breaks: usize, unread: usize) -> Vec<String> {
    let mut out = vec![format!(
        "  declared by the repository: {breaks} file(s) break it today, {unread} could not be read (never reported); when it was proposed, {} of the {} files there Drift read followed it",
        c.evidence.holders, c.evidence.total
    )];
    out.push(if breaks > 0 {
        format!(
            "  y accepts it (advise mode; the {breaks} file(s) that break it today recorded in drift.lock, so only a new import against it is reported)"
        )
    } else {
        "  y accepts it (advise mode; nothing breaks it today, so any import against it from now on is reported)".to_string()
    });
    out
}

/// The notes of `d` that are not proposals: each restriction already stated by another
/// convention ("also declared in"), and each Drift cannot express, with why.
pub fn notes(d: &Declared) -> Vec<Note> {
    let mut out = Vec::new();
    for a in &d.also {
        let by = if a.by == "mined" {
            "a mined convention"
        } else {
            "a layering proposal from the map"
        };
        out.push(Note {
            id: a.id.clone(),
            kind: DECLARED,
            lines: vec![format!(
                "  [{}] also declared in {}: {} must not import {} (`{}`); not proposed again, {} already says it",
                a.id,
                safe_list(&a.configs, ", "),
                safe(&a.scope),
                safe(&a.target),
                safe_list(&a.written, "`, `"),
                by
            )],
            json: json!({
                "proposed": false,
                "note": "also_declared",
                "kind": DECLARED,
                "id": a.id,
                "by": a.by,
                "configs": a.configs,
                "scope": a.scope,
                "target": a.target,
                "written": a.written,
            }),
        });
    }
    for n in &d.not_expressed {
        out.push(Note {
            id: String::new(),
            kind: DECLARED,
            lines: vec![format!(
                "  {}: {} restricts `{}`; not proposed: {}",
                safe(&n.config),
                safe(&n.scope),
                safe_list(&n.written, "`, `"),
                n.words
            )],
            json: json!({
                "proposed": false,
                "note": "not_expressed",
                "kind": DECLARED,
                "config": n.config,
                "scope": n.scope,
                "written": n.written,
                "reason": n.why,
                "why": n.words,
            }),
        });
    }
    out
}

/// The instruction files at the root of the repository at `root` that people write for
/// agents ([`INSTRUCTION_FILES`]): that each exists, whether it holds the block `drift
/// export agents-md` writes, and which of `proposed` an export would add to it once
/// accepted (the declared ones among them are already stated by the repository). Its
/// prose is never read for rules. A link is said to be one and not followed.
pub fn instruction_notes(root: &Path, proposed: &[&Convention]) -> Vec<Note> {
    let mut out = Vec::new();
    let mut ids: Vec<&str> = proposed.iter().map(|c| c.id.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    let mut declared: Vec<&str> = proposed
        .iter()
        .filter(|c| c.from_map.as_deref() == Some(DECLARED))
        .map(|c| c.id.as_str())
        .collect();
    declared.sort_unstable();
    declared.dedup();
    for name in INSTRUCTION_FILES {
        let Ok(meta) = std::fs::symlink_metadata(root.join(name)) else {
            continue;
        };
        let block = if meta.is_file() {
            drift_core::fsutil::read_regular_to_string(
                &root.join(name),
                drift_core::fsutil::MAX_CONFIG_BYTES,
            )
            .ok()
            .map(|t| t.contains(EXPORT_MARK))
        } else {
            None
        };
        let holds = match block {
            Some(true) => "it holds a block `drift export agents-md` wrote".to_string(),
            Some(false) => "it holds no block `drift export agents-md` wrote".to_string(),
            None => "it is a link or could not be read, so Drift did not open it".to_string(),
        };
        let mut line = format!(
            "  {name} exists: instructions people wrote for agents; Drift does not read rules out of its prose, so it cannot say which it already states; {holds}"
        );
        if !ids.is_empty() {
            line.push_str(&format!(
                ". `drift export agents-md --write {name}` would add to it the ones you accept of these {} proposal(s)",
                ids.len()
            ));
            if !declared.is_empty() {
                line.push_str(&format!(
                    ", {} of which a lint configuration of the repository already declares ({})",
                    declared.len(),
                    declared.join(", ")
                ));
            }
        }
        out.push(Note {
            id: String::new(),
            kind: DECLARED,
            lines: vec![line],
            json: json!({
                "proposed": false,
                "note": "instructions",
                "kind": DECLARED,
                "path": name,
                "drift_block": block,
                "would_add": ids,
                "already_declared": declared,
            }),
        });
    }
    out
}

/// Area of a repo path, exactly as `crate::mine`'s `area` (and [`from_map`]'s copy).
fn area(path: &str) -> String {
    let segs: Vec<&str> = path.split('/').collect();
    segs[..segs.len().saturating_sub(1).clamp(1, 2)].join("/")
}

/// The place of a role from the repository root, as [`from_map`]'s `scope_of`.
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

/// The layer of a place: its first two segments, as [`from_map`]'s `layer_of_scope`.
fn layer_of_scope(scope: &str) -> String {
    scope
        .split('/')
        .filter(|s| !s.is_empty())
        .take(2)
        .collect::<Vec<_>>()
        .join("/")
}

/// `option` (starting `./` or `../`, or `.`/`..`) read from `dir`; `None` when it climbs
/// above the repository root. As `crate::context`'s `resolve_relative`.
fn resolve_relative(dir: &str, option: &str) -> Option<String> {
    let mut out: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    for seg in option.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                out.pop()?;
            }
            s => out.push(s),
        }
    }
    Some(out.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_options_are_read_from_the_folder() {
        assert_eq!(
            resolve_relative("packages/lib", "../features").as_deref(),
            Some("packages/features")
        );
        assert_eq!(
            resolve_relative("packages/features", "../../apps/web").as_deref(),
            Some("apps/web")
        );
        assert_eq!(resolve_relative("lib", "../../x"), None);
    }

    #[test]
    fn layers_are_mining_layers() {
        assert_eq!(area("packages/features/x"), "packages/features");
        assert_eq!(area("routes/x"), "routes");
        assert_eq!(
            layer_of_scope("packages/platform/atoms"),
            "packages/platform"
        );
    }

    #[test]
    fn ids_are_apart_from_layering_ids() {
        let role = RoleSelector {
            package: "packages/lib".into(),
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
        let id = declared_id(&role, "packages/features");
        assert!(id.starts_with("D-") && id.len() == 8, "{id}");
        let rule = Rule::Avoids {
            signal: "import:packages/features".into(),
        };
        assert_ne!(id, crate::mine::convention_id(&role, &rule));
        assert_eq!(id, declared_id(&role, "packages/features"));
    }
}
