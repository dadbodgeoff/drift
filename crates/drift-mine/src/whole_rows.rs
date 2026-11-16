//! Rows sent back whole where other code withholds a field of them.
//!
//! No field is sensitive by its name. What the repository does not send back is
//! what its own code takes out before it answers: a field a query is told to
//! leave out, one taken apart from the rest and never read, one deleted or
//! blanked ([`drift_core::controls::WITHHOLDS`]). Where one body withholds a
//! field of the rows a call hands back, and another hands the whole of the same
//! rows to a response ([`drift_core::controls::SENDS_WHOLE`]) or, being an entry
//! point, returns them ([`drift_core::controls::RETURNS_WHOLE`]), the second is
//! listed with the field: the repository's own practice says it is not for the
//! caller.
//!
//! The rows are named by where they are read: the name before the method of the
//! call that hands them back (`user` of `prisma.user.findUnique`, of
//! `ctx.db.user.findMany` and of `tx.user.update`). A function of the
//! repository that returns the whole of what such a call gave stands for that
//! call, with what it withholds on the way.
//!
//! In Python the fields are chosen by a class beside the body, and that class is
//! what is read ([`classes`]):
//!
//! - a class over a model (`class Meta: model = User`, a serializer, a form, a
//!   filter set) that takes the whole of it (`fields = "__all__"`, or `exclude`
//!   and so everything else), where another class of the same kind over the same
//!   model withholds a field (`exclude`, a field declared `write_only`);
//! - a route whose declared response is the class the rows are read of
//!   (`response_model=User`, `-> User`), where the declared response of another
//!   route is that class with fields left out (`UserPublic`: every field it has
//!   is one of `User`'s, and it shares a base with it or is declared where rows
//!   of `User` are read).
//!
//! A fact for a person to read: the field may be withheld elsewhere for a reason
//! that does not hold here (another caller, another purpose). A serializer or a
//! schema of TypeScript that chooses the fields outside the body is not read, nor
//! a Python route that declares no response and returns the row itself.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::controls::{ARG_VALUE, RETURNS_WHOLE, ROWS, SENDS_WHOLE, WITHHOLDS};
use drift_core::{RepoFacts, ResponseVia, Symbol, SymbolKind, WrapKind};
use serde::Serialize;

/// How many functions a whole row is followed through.
const MAX_DEPTH: usize = 4;
/// How many of the places that withhold a field are named.
const SHOWN: usize = 3;

/// One body that sends rows whole where other code withholds a field of them.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct WholeRow {
    pub path: String,
    pub line: u32,
    pub symbol: String,
    /// The rows, by the name the code reads them under (`user`), or by the class
    /// they are read of (`app/models.py#User`).
    pub rows: String,
    /// The call that handed them back, as the body writes it, or what makes the
    /// class the whole of the rows (`fields = "__all__"`, `response_model`).
    pub from: String,
    /// The fields other code withholds of these rows and this body does not.
    pub fields: Vec<String>,
    /// The first places that withhold one of them (`path#symbol`).
    pub withheld_at: Vec<String>,
    /// How many places withhold one of them.
    pub withheld_count: usize,
}

/// What one body does with what calls hand back.
#[derive(Default)]
struct Body {
    path: String,
    symbol: String,
    line: u32,
    withholds: Vec<(String, String)>,
    sends: Vec<String>,
    returns: Vec<String>,
    /// What the body hands the repository's functions that a call handed back:
    /// the function, the position (`#0`), the call.
    hands: Vec<(String, String, String)>,
}

impl Body {
    fn read(path: &str, symbol: String, line: u32, controls: &[String]) -> Option<Body> {
        let mut b = Body {
            path: path.to_string(),
            symbol,
            line,
            ..Body::default()
        };
        for c in controls {
            if let Some((callee, field)) =
                c.strip_prefix(WITHHOLDS).and_then(|w| w.split_once('\t'))
            {
                b.withholds.push((callee.to_string(), field.to_string()));
            } else if let Some(callee) = c.strip_prefix(SENDS_WHOLE) {
                b.sends.push(callee.to_string());
            } else if let Some(callee) = c.strip_prefix(RETURNS_WHOLE) {
                b.returns.push(callee.to_string());
            } else if let Some(given) = c.strip_prefix(ARG_VALUE) {
                let mut parts = given.split('\t');
                let Some(function) = parts.next() else {
                    continue;
                };
                while let (Some(at), Some(side)) = (parts.next(), parts.next()) {
                    if let Some(call) = side.strip_prefix("call ") {
                        b.hands
                            .push((function.to_string(), at.to_string(), call.to_string()));
                    }
                }
            }
        }
        (!(b.withholds.is_empty()
            && b.sends.is_empty()
            && b.returns.is_empty()
            && b.hands.is_empty()))
        .then_some(b)
    }

    fn site(&self) -> String {
        format!("{}#{}", self.path, self.symbol)
    }
}

/// The rows a call hands back, by the name they are read under: the name before
/// the method (`user` of `src/db.ts#prisma.user.findUnique`), where that name is
/// a member of something or a binding of a module. None of a call with no
/// receiver (a plain function says nothing of what it reads) and of a method of
/// a local or a parameter (`result.json()`: the name is the body's own word,
/// not the name of what is read).
fn rows_of(callee: &str) -> Option<String> {
    // A path holds dots of its own: the names start after `#`, or after the
    // prefix of a callee that has no canonical name (`param:`, `local:`).
    let (names, bound) = match callee.split_once('#') {
        Some((_, names)) => (names, true),
        None => (callee.split_once(':').map_or(callee, |(_, n)| n), false),
    };
    let mut parts = names.rsplit('.');
    let _method = parts.next()?;
    let receiver = parts.next()?.trim_end_matches("()");
    if !bound && parts.next().is_none() {
        return None;
    }
    (!receiver.is_empty() && receiver != "this").then(|| receiver.to_ascii_lowercase())
}

/// The bodies that send rows whole where another withholds a field of them.
/// `entries` are the entry points (path, symbol): what one of them returns is
/// what the caller is sent.
pub fn read(repo: &RepoFacts, entries: &BTreeSet<(String, String)>) -> Vec<WholeRow> {
    let mut out = bodies(repo, entries);
    out.extend(classes(repo, entries));
    out.sort();
    out
}

/// What the bodies say: one sends whole what a call handed back, another
/// withholds a field of the same rows.
fn bodies(repo: &RepoFacts, entries: &BTreeSet<(String, String)>) -> Vec<WholeRow> {
    let mut bodies: BTreeMap<String, Body> = BTreeMap::new();
    for f in &repo.files {
        if crate::roles::is_test_path(&f.path) {
            continue;
        }
        for s in &f.symbols {
            if let Some(b) = Body::read(&f.path, s.name.clone(), s.line, &s.controls) {
                bodies.insert(format!("{}#{}", f.path, s.name), b);
            }
            for m in &s.members {
                let name = format!("{}.{}", s.name, m.name);
                if let Some(b) = Body::read(&f.path, name.clone(), s.line, &m.unread) {
                    bodies.insert(format!("{}#{name}", f.path), b);
                }
            }
        }
    }
    if !bodies.values().any(|b| !b.withholds.is_empty()) {
        return Vec::new();
    }
    // The calls a callee stands for, each with the fields withheld on the way: a
    // function of the repository that returns the whole of what a call gave
    // stands for that call. One that returns no whole stands for nothing.
    fn stands_for(
        bodies: &BTreeMap<String, Body>,
        callee: &str,
        depth: usize,
    ) -> Vec<(String, BTreeSet<String>)> {
        // A method reached through an instance is written `Class().method`.
        let key = callee.replace("().", ".");
        let Some(b) = bodies.get(callee).or_else(|| bodies.get(&key)) else {
            return vec![(callee.to_string(), BTreeSet::new())];
        };
        if depth >= MAX_DEPTH {
            return Vec::new();
        }
        let mut out = Vec::new();
        for r in &b.returns {
            for (call, mut withheld) in stands_for(bodies, r, depth + 1) {
                withheld.extend(
                    b.withholds
                        .iter()
                        .filter(|(c, _)| c == r)
                        .map(|(_, f)| f.clone()),
                );
                out.push((call, withheld));
            }
        }
        out
    }
    // What a function withholds of what it is handed at a position, and the
    // calls each body hands it there.
    let of_param = |function: &str, at: &str| -> Vec<&String> {
        let key = function.replace("().", ".");
        bodies
            .get(function)
            .or_else(|| bodies.get(&key))
            .into_iter()
            .flat_map(|b| b.withholds.iter())
            .filter(|(c, _)| c.strip_prefix("param ") == Some(at))
            .map(|(_, f)| f)
            .collect()
    };
    // Rows -> field -> the places that withhold it.
    let mut withheld: BTreeMap<String, BTreeMap<String, BTreeSet<String>>> = BTreeMap::new();
    for b in bodies.values() {
        // A function handed a row and withholding a field of it withholds it of
        // the rows each call hands it.
        for (function, at, call) in &b.hands {
            for field in of_param(function, at) {
                for (call, _) in stands_for(&bodies, call, 0) {
                    if let Some(rows) = rows_of(&call) {
                        withheld
                            .entry(rows)
                            .or_default()
                            .entry(field.clone())
                            .or_default()
                            .insert(function.clone());
                    }
                }
            }
        }
        for (callee, field) in b.withholds.iter().filter(|(c, _)| !c.starts_with("param ")) {
            for (call, _) in stands_for(&bodies, callee, 0) {
                if let Some(rows) = rows_of(&call) {
                    withheld
                        .entry(rows)
                        .or_default()
                        .entry(field.clone())
                        .or_default()
                        .insert(b.site());
                }
            }
        }
    }
    let mut out: BTreeMap<(String, String, String), (WholeRow, BTreeSet<String>)> = BTreeMap::new();
    for b in bodies.values() {
        let entry = entries.contains(&(b.path.clone(), b.symbol.clone()));
        let sent = b.sends.iter().chain(b.returns.iter().filter(|_| entry));
        for callee in sent {
            for (call, mut kept_back) in stands_for(&bodies, callee, 0) {
                let Some(rows) = rows_of(&call) else {
                    continue;
                };
                let Some(fields) = withheld.get(&rows) else {
                    continue;
                };
                kept_back.extend(
                    b.withholds
                        .iter()
                        .filter(|(c, _)| c == callee)
                        .map(|(_, f)| f.clone()),
                );
                // What a function the body hands these rows withholds of them
                // (`scrub(user); res.json(user)`).
                kept_back.extend(
                    b.hands
                        .iter()
                        .filter(|(_, _, given)| given == callee)
                        .flat_map(|(function, at, _)| of_param(function, at))
                        .cloned(),
                );
                let here = b.site();
                // A field this body withholds is not one it sends; one only this
                // body withholds of other rows it reads says nothing of these.
                let missing: Vec<(&String, &BTreeSet<String>)> = fields
                    .iter()
                    .filter(|(f, at)| !kept_back.contains(*f) && at.iter().any(|s| *s != here))
                    .collect();
                if missing.is_empty() {
                    continue;
                }
                let sites: BTreeSet<&String> = missing
                    .iter()
                    .flat_map(|(_, at)| at.iter())
                    .filter(|s| **s != here)
                    .collect();
                let (row, at) = out
                    .entry((b.path.clone(), b.symbol.clone(), rows.clone()))
                    .or_insert_with(|| {
                        (
                            WholeRow {
                                path: b.path.clone(),
                                line: b.line,
                                symbol: b.symbol.clone(),
                                rows: rows.clone(),
                                from: callee.clone(),
                                fields: Vec::new(),
                                withheld_at: Vec::new(),
                                withheld_count: 0,
                            },
                            BTreeSet::new(),
                        )
                    });
                for (f, _) in &missing {
                    if !row.fields.contains(f) {
                        row.fields.push((*f).clone());
                    }
                }
                row.fields.sort();
                at.extend(sites.into_iter().cloned());
            }
        }
    }
    out.into_values()
        .map(|(mut row, at)| {
            row.withheld_count = at.len();
            row.withheld_at = at.into_iter().take(SHOWN).collect();
            row
        })
        .collect()
}

/// How many bases a class is followed through.
const MAX_BASES: usize = 8;

/// A class of the repository, with what its bases give it.
struct Class<'a> {
    path: &'a str,
    sym: &'a Symbol,
    /// The classes of the repository it extends, nearest first, itself not among
    /// them.
    bases: Vec<String>,
    /// What it extends that is no class of the repository (`pkg:rest_framework#
    /// serializers.ModelSerializer`): what kind of class it is.
    roots: BTreeSet<String>,
}

fn meta<'a>(sym: &'a Symbol, key: &'a str) -> impl Iterator<Item = &'a str> {
    sym.meta
        .iter()
        .filter_map(move |m| m.strip_prefix(key)?.strip_prefix('='))
}

/// The fields a class body declares: what it binds that is no method.
fn declared(sym: &Symbol) -> impl Iterator<Item = &str> {
    sym.declares
        .iter()
        .filter_map(|d| d.split_once('=').map(|(name, _)| name))
        .filter(|name| !name.is_empty() && !sym.members.iter().any(|m| m.name == *name))
}

/// What the classes say (Python): a class over a model that takes the whole of
/// it where another of its kind withholds a field, and a route whose declared
/// response is the class its rows are read of where another route's is that
/// class with fields left out.
fn classes(repo: &RepoFacts, entries: &BTreeSet<(String, String)>) -> Vec<WholeRow> {
    let symbols: BTreeMap<String, (&str, &Symbol)> = repo
        .files
        .iter()
        .filter(|f| !crate::roles::is_test_path(&f.path))
        .flat_map(|f| {
            f.symbols
                .iter()
                .filter(|s| s.kind == SymbolKind::Class)
                .map(move |s| (format!("{}#{}", f.path, s.name), (f.path.as_str(), s)))
        })
        .collect();
    let classes: BTreeMap<&str, Class> = symbols
        .iter()
        .map(|(key, (path, sym))| {
            let (mut bases, mut roots) = (Vec::new(), BTreeSet::new());
            let mut next: Vec<&Symbol> = vec![sym];
            while let Some(s) = next.pop() {
                for w in s.wraps.iter().filter(|w| w.kind == WrapKind::Extends) {
                    match symbols.get(&w.wrapper) {
                        Some((_, base)) => {
                            if w.wrapper != *key
                                && !bases.contains(&w.wrapper)
                                && bases.len() < MAX_BASES
                            {
                                bases.push(w.wrapper.clone());
                                next.push(base);
                            }
                        }
                        None => {
                            roots.insert(w.wrapper.clone());
                        }
                    }
                }
            }
            (
                key.as_str(),
                Class {
                    path,
                    sym,
                    bases,
                    roots,
                },
            )
        })
        .collect();
    // A class with the classes it extends, itself first.
    let line = |key: &str| -> Vec<&Class> {
        classes
            .get(key)
            .into_iter()
            .flat_map(|c| {
                std::iter::once(c).chain(c.bases.iter().filter_map(|b| classes.get(b.as_str())))
            })
            .collect()
    };
    // What a class never gives back of its fields, by how they are declared.
    let hidden = |key: &str| -> BTreeSet<&str> {
        line(key)
            .into_iter()
            .flat_map(|c| meta(c.sym, "hidden"))
            .collect()
    };
    let mut out: Vec<WholeRow> = Vec::new();
    let mut list = |c: &Class,
                    line_no: u32,
                    symbol: &str,
                    rows: &str,
                    from: &str,
                    missing: BTreeMap<&str, BTreeSet<String>>| {
        if missing.is_empty() {
            return;
        }
        let at: BTreeSet<&String> = missing.values().flatten().collect();
        out.push(WholeRow {
            path: c.path.to_string(),
            line: line_no,
            symbol: symbol.to_string(),
            rows: rows.to_string(),
            from: from.to_string(),
            fields: missing.keys().map(|f| f.to_string()).collect(),
            withheld_at: at.iter().take(SHOWN).map(|s| s.to_string()).collect(),
            withheld_count: at.len(),
        });
    };

    // A class over a model. Model -> the classes over it.
    let mut over: BTreeMap<&str, Vec<(&str, &Class)>> = BTreeMap::new();
    for (key, c) in &classes {
        if let Some(model) = meta(c.sym, "model").next() {
            over.entry(model).or_default().push((key, c));
        }
    }
    for (model, group) in &over {
        // What each class of the group withholds of the model: what `exclude`
        // names, and a field of the model it declares as never given back (a
        // field of its own that takes input says nothing of the model).
        let of_model: BTreeSet<&str> = line(model)
            .into_iter()
            .flat_map(|c| declared(c.sym))
            .collect();
        let left: Vec<BTreeSet<&str>> = group
            .iter()
            .map(|(key, c)| {
                meta(c.sym, "exclude")
                    .chain(hidden(key).into_iter().filter(|f| of_model.contains(f)))
                    .collect()
            })
            .collect();
        for (i, (_, c)) in group.iter().enumerate() {
            let all = meta(c.sym, "fields").any(|f| f == "*");
            if !all && meta(c.sym, "exclude").next().is_none() {
                continue;
            }
            let mut missing: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
            for (j, (other, o)) in group.iter().enumerate() {
                // Of the same kind: a form says nothing of what a serializer gives.
                let kin = c.roots.is_empty() && o.roots.is_empty()
                    || c.roots.intersection(&o.roots).next().is_some();
                if i == j || !kin {
                    continue;
                }
                for f in left[j].difference(&left[i]) {
                    missing.entry(f).or_default().insert(other.to_string());
                }
            }
            let from = match all {
                true => "fields = \"__all__\"",
                false => "exclude",
            };
            list(c, c.sym.line, &c.sym.name, model, from, missing);
        }
    }

    // The classes rows are read of, with their fields: a model's own, and what
    // its bases declare.
    let tables: BTreeMap<String, BTreeSet<&str>> = repo
        .models
        .iter()
        .filter_map(|m| {
            let key = format!("{}#{}", m.path, m.name);
            let c = classes.get(key.as_str())?;
            let fields = m
                .fields
                .iter()
                .map(String::as_str)
                .chain(
                    c.bases
                        .iter()
                        .filter_map(|b| classes.get(b.as_str()))
                        .flat_map(|b| declared(b.sym)),
                )
                .collect();
            Some((key, fields))
        })
        .collect();
    if tables.is_empty() {
        return out;
    }
    // The responses routes declare: the class, and the classes the declaring
    // bodies read rows of.
    let mut declared_by: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut senders: Vec<(&str, &Symbol, &str, &str)> = Vec::new();
    for f in &repo.files {
        if crate::roles::is_test_path(&f.path) {
            continue;
        }
        for s in &f.symbols {
            let mut said = false;
            for r in &s.responses {
                if r.via != ResponseVia::Declared || r.model.is_empty() {
                    continue;
                }
                said = true;
                if tables.contains_key(&r.model) {
                    senders.push((&f.path, s, &r.model, "response_model"));
                    continue;
                }
                let reads = declared_by.entry(&r.model).or_default();
                reads.extend(s.controls.iter().filter_map(|c| {
                    c.strip_prefix(ROWS)
                        .map(|rows| rows.split('\t').next().unwrap_or(rows))
                }));
            }
            // What a route with no declared response is annotated to return is
            // its response.
            if !said
                && tables.contains_key(&s.returns_type)
                && entries.contains(&(f.path.clone(), s.name.clone()))
            {
                senders.push((&f.path, s, &s.returns_type, "the return annotation"));
            }
        }
    }
    // Table -> field -> the declared responses that are the table with the field
    // left out.
    let mut withheld: BTreeMap<&str, BTreeMap<&str, BTreeSet<String>>> = BTreeMap::new();
    for (response, reads) in &declared_by {
        let Some(r) = classes.get(response) else {
            continue;
        };
        let kept: BTreeSet<&str> = line(response)
            .into_iter()
            .flat_map(|c| declared(c.sym))
            .collect::<BTreeSet<_>>()
            .difference(&hidden(response))
            .copied()
            .collect();
        if kept.is_empty() {
            continue;
        }
        for (table, fields) in &tables {
            let t = &classes[table.as_str()];
            // The same thing with fields left out: every field is the table's,
            // and the two share a base or the response is declared where the
            // table's rows are read.
            let related = r.bases.iter().any(|b| t.bases.contains(b))
                || r.bases.contains(table)
                || reads.contains(table.as_str());
            if !related || !kept.is_subset(fields) {
                continue;
            }
            for f in fields.difference(&kept) {
                withheld
                    .entry(table)
                    .or_default()
                    .entry(f)
                    .or_default()
                    .insert(response.to_string());
            }
        }
    }
    for (path, s, table, from) in senders {
        let Some(fields) = withheld.get(table) else {
            continue;
        };
        let kept_back = hidden(table);
        let missing: BTreeMap<&str, BTreeSet<String>> = fields
            .iter()
            .filter(|(f, _)| !kept_back.contains(*f))
            .map(|(f, at)| (*f, at.clone()))
            .collect();
        let c = Class {
            path,
            sym: s,
            bases: Vec::new(),
            roots: BTreeSet::new(),
        };
        list(&c, s.line, &s.name, table, from, missing);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_are_named_by_what_stands_before_the_method() {
        assert_eq!(
            rows_of("src/db.ts#prisma.user.findUnique").as_deref(),
            Some("user")
        );
        assert_eq!(
            rows_of("param:ctx.prisma.User.findMany").as_deref(),
            Some("user")
        );
        assert_eq!(
            rows_of("pkg:@prisma/client#PrismaClient().note.update").as_deref(),
            Some("note")
        );
        assert_eq!(rows_of("local:tx.user.update").as_deref(), Some("user"));
        assert_eq!(
            rows_of("src/models.ts#User.findOne").as_deref(),
            Some("user")
        );
        // A method of a local is the body's own word for something.
        assert_eq!(rows_of("local:result.json"), None);
        assert_eq!(rows_of("param:res.json"), None);
        // A plain function, and a method of the class itself, name no rows.
        assert_eq!(rows_of("src/users.ts#findUser"), None);
        assert_eq!(rows_of("local:this.load"), None);
    }
}
