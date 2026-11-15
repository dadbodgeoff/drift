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
//! A fact for a person to read: the field may be withheld elsewhere for a reason
//! that does not hold here (another caller, another purpose). TypeScript and
//! JavaScript only; a serializer or a response model that chooses the fields
//! outside the body is not read.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::RepoFacts;
use drift_core::controls::{ARG_VALUE, RETURNS_WHOLE, SENDS_WHOLE, WITHHOLDS};
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
    /// The rows, by the name the code reads them under (`user`).
    pub rows: String,
    /// The call that handed them back, as the body writes it.
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
