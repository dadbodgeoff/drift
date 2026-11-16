//! Which GraphQL resolver maps are served, proven across the linked files
//! ([`crate::lower::graphql`]): a map is served when a server or a schema builder
//! is given it, or a map served takes it in (a spread, an array, a merge), through
//! imports, re-exports and `import * as` namespaces. Each root field of a map served
//! is an operation; the fields a Pothos call adds are operations when its builder is
//! a `SchemaBuilder`. A value served that reaches no map Drift read is said through
//! the unlisted-routes report. The listed reading only: the files as the last
//! measured build listed them hold no map with fields.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::{EntryPoint, FileFacts, Wrap, WrapKind};

use super::{Linker, LoweredFile};
use crate::lower::RawSymbol;
use crate::lower::graphql::RawGqlMap;

/// The root types whose fields are operations.
const ROOTS: [&str; 3] = ["Query", "Mutation", "Subscription"];

/// What [`Linker::graphql_proofs`] proves.
#[derive(Default)]
pub(super) struct GqlProofs {
    /// Map (`path#name`) -> the root types it is served for, and what the server
    /// runs before its operations that Drift does not read.
    served: BTreeMap<String, (BTreeSet<String>, BTreeSet<String>)>,
    /// File -> lines of what it serves or takes into a map served that reaches no
    /// map Drift read.
    unmatched: BTreeMap<String, BTreeSet<u32>>,
    /// The Pothos builders (`path#name`).
    builders: BTreeSet<String>,
    /// `<type>.<field>` (or `<type>.*`) -> the rules a `graphql-shield` map applied
    /// with `applyMiddleware` gives it, canonical.
    rules: BTreeMap<String, Vec<String>>,
    /// The rule of every field such a map names none for.
    fallback: Vec<String>,
    /// Some key of such a map is not read.
    shield_unread: bool,
}

/// The operations one file lists ([`Linker::graphql_listing`]).
#[derive(Default)]
pub(super) struct GqlListing {
    pub symbols: Vec<RawSymbol>,
    pub entries: Vec<EntryPoint>,
    unlisted: BTreeSet<u32>,
    /// Operation symbol -> the rules a shield map gives it, outermost first.
    rules: BTreeMap<String, Vec<String>>,
}

fn all_roots() -> BTreeSet<String> {
    ROOTS.iter().map(|r| r.to_string()).collect()
}

impl GqlProofs {
    /// Notes `id` served for `roots` with `unread`; true when that is more than
    /// was known.
    fn add(&mut self, id: &str, roots: &BTreeSet<String>, unread: &BTreeSet<String>) -> bool {
        let (r, u) = self.served.entry(id.to_string()).or_default();
        let before = (r.len(), u.len());
        r.extend(roots.iter().cloned());
        u.extend(unread.iter().cloned());
        before != (r.len(), u.len())
    }
}

impl Linker<'_> {
    /// The maps `target` (a canonical reference) is, each with the roots it is for:
    /// the map itself, or for a namespace (`import * as resolvers`) its bindings
    /// named for a root type.
    fn gql_targets(
        &self,
        target: &str,
        maps: &BTreeMap<String, (&str, &RawGqlMap)>,
    ) -> Vec<(String, BTreeSet<String>)> {
        if maps.contains_key(target) {
            return vec![(target.to_string(), all_roots())];
        }
        if let Some(module) = target.strip_suffix("#*") {
            return ROOTS
                .iter()
                .map(|root| {
                    (
                        self.origin(module, root),
                        BTreeSet::from([root.to_string()]),
                    )
                })
                .filter(|(o, _)| maps.contains_key(o))
                .collect();
        }
        Vec::new()
    }

    pub(super) fn graphql_proofs(&self, files: &[LoweredFile]) -> GqlProofs {
        let mut maps: BTreeMap<String, (&str, &RawGqlMap)> = BTreeMap::new();
        for f in files {
            for m in &f.raw.graphql.maps {
                maps.insert(format!("{}#{}", f.rel_path, m.name), (&f.rel_path, m));
            }
        }
        let mut p = GqlProofs::default();
        let mut queue = Vec::new();
        for f in files {
            let rel = f.rel_path.as_str();
            for s in &f.raw.graphql.served {
                let targets = self.gql_targets(&self.canon(rel, &s.map), &maps);
                if targets.is_empty() {
                    p.unmatched
                        .entry(rel.to_string())
                        .or_default()
                        .insert(s.line);
                }
                let unread: BTreeSet<String> = s.unread.iter().cloned().collect();
                for (t, roots) in targets {
                    if p.add(&t, &roots, &unread) {
                        queue.push(t);
                    }
                }
            }
            p.builders
                .extend(f.raw.graphql.builders.iter().map(|b| format!("{rel}#{b}")));
        }
        while let Some(id) = queue.pop() {
            let Some((rel, m)) = maps.get(&id).copied() else {
                continue;
            };
            let (roots, unread) = p.served[&id].clone();
            for part in &m.parts {
                let roots: BTreeSet<String> = roots
                    .iter()
                    .filter(|r| part.root.is_empty() || **r == part.root)
                    .cloned()
                    .collect();
                if roots.is_empty() {
                    continue;
                }
                let targets = self.gql_targets(&self.canon(rel, &part.map), &maps);
                if targets.is_empty() {
                    p.unmatched
                        .entry(rel.to_string())
                        .or_default()
                        .insert(part.line);
                }
                for (t, of) in targets {
                    let r: BTreeSet<String> = roots.intersection(&of).cloned().collect();
                    if !r.is_empty() && p.add(&t, &r, &unread) {
                        queue.push(t);
                    }
                }
            }
        }
        // The rule maps a schema is given with `applyMiddleware`.
        let shields: BTreeMap<String, (&str, &crate::lower::graphql::RawShield)> = files
            .iter()
            .flat_map(|f| {
                f.raw.graphql.shields.iter().map(move |s| {
                    (
                        format!("{}#{}", f.rel_path, s.name),
                        (f.rel_path.as_str(), s),
                    )
                })
            })
            .collect();
        let mut applied = BTreeSet::new();
        for f in files {
            for a in &f.raw.graphql.applied {
                let id = self.canon(&f.rel_path, a);
                if shields.contains_key(&id) {
                    applied.insert(id);
                }
            }
        }
        for id in applied {
            let (rel, s) = shields[&id];
            for (key, rules) in &s.rules {
                let canon = rules.iter().map(|r| self.canon(rel, r));
                let to = p.rules.entry(key.clone()).or_default();
                for c in canon {
                    if !to.contains(&c) {
                        to.push(c);
                    }
                }
            }
            for r in &s.fallback {
                let c = self.canon(rel, r);
                if !p.fallback.contains(&c) {
                    p.fallback.push(c);
                }
            }
            p.shield_unread |= s.unread;
        }
        p
    }

    /// The operations `f` lists: the root fields of its maps proven served, and
    /// the lines of what it serves that are not read.
    pub(super) fn graphql_listing(&self, f: &LoweredFile) -> GqlListing {
        let rel = f.rel_path.as_str();
        let p = &self.graphql;
        let mut out = GqlListing::default();
        if let Some(lines) = p.unmatched.get(rel) {
            out.unlisted.extend(lines.iter().copied());
        }
        let none = (BTreeSet::new(), BTreeSet::new());
        for m in &f.raw.graphql.maps {
            let (mut roots, unread) = p
                .served
                .get(&format!("{rel}#{}", m.name))
                .cloned()
                .unwrap_or_else(|| none.clone());
            if m.builder
                .as_ref()
                .is_some_and(|b| p.builders.contains(&self.canon(rel, b)))
            {
                roots = all_roots();
            }
            if roots.is_empty() {
                continue;
            }
            out.unlisted.extend(m.unlisted.iter().copied());
            for e in m.entries.iter().filter(|e| roots.contains(&e.root)) {
                let mut sym = e.symbol.clone();
                sym.app_unread.extend(unread.iter().cloned());
                out.symbols.push(sym);
                out.entries.push(e.entry.clone());
            }
        }
        // The rules of a shield map, for these operations and for those the file
        // lists by itself (Nexus).
        let operations = out
            .entries
            .iter()
            .chain(f.raw.entry_points.iter().filter(|e| e.adapter == "graphql"));
        let mut unread_shield = Vec::new();
        for e in operations {
            let Some(route) = &e.route else { continue };
            let root = route.split('.').next().unwrap_or_default();
            let rules = p
                .rules
                .get(route)
                .or_else(|| p.rules.get(&format!("{root}.*")))
                .filter(|r| !r.is_empty())
                .unwrap_or(&p.fallback);
            if !rules.is_empty() {
                out.rules.insert(e.symbol.clone(), rules.clone());
            } else if p.shield_unread {
                unread_shield.push(e.symbol.clone());
            }
        }
        for s in out
            .symbols
            .iter_mut()
            .filter(|s| unread_shield.contains(&s.name))
        {
            s.app_unread
                .push("a graphql-shield rule map not read whole".to_string());
        }
        out
    }
}

impl GqlListing {
    /// Gives the linked file what only linking knows: the lines not read, and the
    /// rules of a shield map as the first wraps of the operations they guard.
    pub(super) fn hold(&self, facts: &mut FileFacts) {
        if !self.unlisted.is_empty() {
            facts.unlisted_routes.extend(self.unlisted.iter().copied());
            facts.unlisted_routes.sort_unstable();
            facts.unlisted_routes.dedup();
        }
        if self.rules.is_empty() {
            return;
        }
        for s in facts.symbols.iter_mut() {
            if let Some(rules) = self.rules.get(&s.name) {
                let mut wraps: Vec<Wrap> = rules
                    .iter()
                    .filter(|r| !s.wraps.iter().any(|w| &w.wrapper == *r))
                    .map(|r| Wrap {
                        wrapper: r.clone(),
                        kind: WrapKind::Call,
                    })
                    .collect();
                wraps.append(&mut s.wraps);
                s.wraps = wraps;
            }
        }
    }
}
