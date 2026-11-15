//! Guard positions, as a matrix: position x provenance x framework.
//!
//! The rule under test: what stands at a guard position and is not recognised is
//! never read as nothing. It is the guard only where a body of the repository is read
//! to refuse every request without identity, or where it is a call of a library guard
//! in a call shape on the closed list (`drift_mine::guard_lists`); it is nothing only
//! where a body of the repository is read to the end and never refuses, or where it
//! is on the closed list of what never authenticates; anything else is unknown.
//!
//! Every cell is a route covered by the position and a sibling route the position
//! does not cover, read on both surfaces: the practice map's authentication and the
//! inventory of `drift security`, which must agree. The fixtures are generated from
//! the tables of each framework: a new position or a new library is one line.
//!
//! `DRIFT_MATRIX_DUMP=<file>` appends one line per cell (framework, position, thing,
//! class, expected, practice map, inventory, sibling) for counting states.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use super::{Files, authn, inventory, write};

mod express;
mod fastify;
mod hono;
mod nest;
mod next;
mod trpc;

pub use express::EXPRESS;
pub use fastify::FASTIFY;
pub use hono::HONO;
pub use nest::NEST;
pub use next::NEXT_WRAPPERS;
pub use trpc::TRPC_ROUTERS;

/// What a thing at a guard position is to the route it covers.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Is {
    /// It refuses every request without identity: authentication is `known`, the
    /// inventory names a guard.
    Guard,
    /// It was read and refuses no one: `none`, "no guard".
    Nothing,
    /// Neither is proven: `unknown`, "guard unknown".
    Unknown,
}

impl Is {
    fn state(self) -> &'static str {
        match self {
            Is::Guard => "known",
            Is::Nothing => "none",
            Is::Unknown => "unknown",
        }
    }
}

/// What stands at the position: its provenance class (`a` to `i`, as the module
/// documentation of `drift_mine::guard_lists` names them), a name for the cell, the
/// expression, and what it is.
pub struct Thing {
    pub class: char,
    pub name: &'static str,
    pub expr: &'static str,
    pub is: Is,
}

pub const fn thing(class: char, name: &'static str, expr: &'static str, is: Is) -> Thing {
    Thing {
        class,
        name,
        expr,
        is,
    }
}

/// A guard position: the statements that put `@G@` there for the route `covered` and
/// leave the route `sibling` outside it. `@N@` is the cell's number, `@P@` its path
/// prefix (`/c7`).
pub struct Position {
    pub name: &'static str,
    pub code: &'static str,
    pub covered: &'static str,
    pub sibling: &'static str,
    /// What the position makes of a thing, where that is not the thing itself: a
    /// position Drift does not read through leaves every route it covers unknown.
    pub reads: fn(&Thing) -> Is,
}

/// The position is read through: the thing decides.
pub fn itself(t: &Thing) -> Is {
    t.is
}

/// The path the thing is given for is not evaluated (a parameter in it): it may run
/// for the route, whatever it is.
pub fn may_cover(_: &Thing) -> Is {
    Is::Unknown
}

/// A framework's side of the matrix.
pub struct Framework {
    pub name: &'static str,
    /// What `@I@` stands for in a position's code: the imports of a file each cell
    /// writes for itself.
    pub imports: &'static str,
    /// The files every fixture has (`package.json`, the guards of the repository).
    pub files: &'static [(&'static str, &'static str)],
    /// The file the cells are written in, what it starts with and ends with.
    pub file: &'static str,
    pub head: &'static str,
    pub tail: &'static str,
    pub things: &'static [Thing],
    pub positions: &'static [Position],
    /// The method the cells' routes are listed under.
    pub method: &'static str,
}

/// One surface's state of a route: `known`, `none`, `unknown`, or `absent`.
fn map_state(authn: &BTreeMap<String, (String, String)>, route: &str) -> String {
    match authn.get(route) {
        None => "absent".to_string(),
        Some((assignment, key)) => {
            // Known by what turns no one away (a session read, a public marker) is no
            // guard.
            let enforced = key.split('+').any(|piece| {
                !["identifies:", "opens:", "service_auth:"]
                    .iter()
                    .any(|m| piece.starts_with(m))
            });
            match assignment.as_str() {
                "known" if !enforced => "none".to_string(),
                a => a.to_string(),
            }
        }
    }
}

fn inventory_state(inv: &BTreeMap<String, (Vec<String>, Vec<String>)>, route: &str) -> String {
    match inv.get(route) {
        None => "absent",
        Some((guards, _)) if !guards.is_empty() => "known",
        Some((_, opaque)) if !opaque.is_empty() => "unknown",
        Some(_) => "none",
    }
    .to_string()
}

fn fill(template: &str, n: usize, expr: &str) -> String {
    template
        .replace("@G@", expr)
        .replace("@N@", &n.to_string())
        .replace("@P@", &format!("/c{n}"))
}

/// Runs one framework's matrix: a repository per position, every thing in it. Returns
/// the number of cells, and what failed.
pub fn run(f: &Framework) -> (usize, Vec<String>) {
    let mut failures = Vec::new();
    let mut dump = String::new();
    let mut cells = 0;
    for p in f.positions {
        let mut files: Files = f
            .files
            .iter()
            .map(|(path, body)| ((*path).to_string(), (*body).to_string()))
            .collect();
        let mut source = f.head.to_string();
        for (n, t) in f.things.iter().enumerate() {
            let _ = writeln!(source, "// {} {}", t.class, t.name);
            source += &fill(&p.code.replace("@I@", f.imports), n, t.expr);
        }
        source += f.tail;
        // A line `//// <path>` starts a file of its own (a Next.js route file per
        // cell); what comes before the first one is the framework's file.
        let mut at = f.file.to_string();
        let mut text = String::new();
        for line in source.lines() {
            match line.strip_prefix("//// ") {
                Some(path) => {
                    if !at.is_empty() && !text.trim().is_empty() {
                        files.insert(std::mem::take(&mut at), std::mem::take(&mut text));
                    }
                    at = path.trim().to_string();
                    text.clear();
                }
                None => {
                    text += line;
                    text.push('\n');
                }
            }
        }
        if !at.is_empty() && !text.trim().is_empty() {
            files.insert(at, text);
        }
        let dir = write(&files);
        // `DRIFT_MATRIX_KEEP=<dir>` keeps a copy of each fixture, to read by hand.
        if let Ok(keep) = std::env::var("DRIFT_MATRIX_KEEP") {
            for (rel, body) in &files {
                let to = std::path::Path::new(&keep)
                    .join(f.name)
                    .join(p.name)
                    .join(rel);
                std::fs::create_dir_all(to.parent().unwrap()).unwrap();
                std::fs::write(to, body).unwrap();
            }
        }
        // A position that lists no route at all has no unit to read: every cell of
        // it is absent, and fails as such.
        let inv = inventory(dir.path());
        let map = if inv.is_empty() {
            BTreeMap::new()
        } else {
            authn(dir.path())
        };
        for (n, t) in f.things.iter().enumerate() {
            cells += 1;
            let what = format!("{} / {} / {} {}", f.name, p.name, t.class, t.name);
            // A route template that names its method (`MUTATION c7in`) is its key.
            let key = |route: String| match route.contains(' ') {
                true => route,
                false => format!("{} {route}", f.method),
            };
            let covered = key(fill(p.covered, n, ""));
            let sibling = key(fill(p.sibling, n, ""));
            let want = (p.reads)(t);
            let (m, i) = (map_state(&map, &covered), inventory_state(&inv, &covered));
            let (sm, si) = (map_state(&map, &sibling), inventory_state(&inv, &sibling));
            let _ = writeln!(
                dump,
                "{}\t{}\t{}\t{}\t{}\t{m}\t{i}\t{sm}\t{si}",
                f.name,
                p.name,
                t.name,
                t.class,
                want.state()
            );
            if m != want.state() {
                failures.push(format!(
                    "{what}: the practice map says {m} of {covered} ({:?}), expected {}",
                    map.get(&covered),
                    want.state()
                ));
            }
            if i != m {
                failures.push(format!(
                    "{what}: the inventory says {i} of {covered} ({:?}), the practice map {m}",
                    inv.get(&covered)
                ));
            }
            // The sibling is outside the position: nothing guards it.
            if sm != "none" || si != "none" {
                failures.push(format!(
                    "{what}: the sibling {sibling} reads {sm} / {si} ({:?} / {:?}), expected none",
                    map.get(&sibling),
                    inv.get(&sibling)
                ));
            }
        }
    }
    if let Ok(path) = std::env::var("DRIFT_MATRIX_DUMP") {
        use std::io::Write as _;
        let mut out = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        out.write_all(dump.as_bytes()).unwrap();
    }
    (cells, failures)
}

/// Asserts a framework's matrix, every failing cell at once.
pub fn check(f: &Framework) {
    let (cells, failures) = run(f);
    assert_eq!(
        cells,
        f.positions.len() * f.things.len(),
        "{}: every cell is read",
        f.name
    );
    assert!(
        failures.is_empty(),
        "{}: {} of {cells} cells fail\n{}",
        f.name,
        failures.len(),
        failures.join("\n")
    );
}
