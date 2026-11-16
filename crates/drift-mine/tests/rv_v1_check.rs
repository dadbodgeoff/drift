//! Review fix v1 (enforcement core, PR 148 area 1): what `drift check` decides of an
//! accepted mined rule's members.
//!
//! - Item 1: a change that breaks enough members never makes the rule that catches it
//!   stale, and staleness never demotes a violation that is not in the lock.
//! - Item 2: a member of a file that did not parse is not checked, counted once, never
//!   breaking.
//! - Item 3: moved legacy debt is listed, and `Lock::follow_moves` rewrites its lines so a
//!   later edit of it keeps it legacy.
//! - Item 4: a lock entry in a file that did not parse is never called fixed.
//! - Item 5: the lock's fingerprint is the violation's own unit's, when a model shares its
//!   `path#symbol`.
//!
//! The fixtures are not any dev repository's code.

use drift_core::{FileFacts, Model, RepoFacts, Symbol, SymbolKind, Wrap, WrapKind};
use drift_mine::check::{Scope, baseline, check};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Mode, Status};

const PKG: &str = "worker";
const JOBS: &str = "worker/src/jobs";
const DEFINE: &str = "worker/src/jobs/lib/define-job.ts#defineJob";

fn sym(name: &str, wrapped: bool) -> Symbol {
    let mut s = Symbol {
        name: name.into(),
        kind: SymbolKind::Function,
        exported_as: vec![name.into()],
        line: 1,
        ..Default::default()
    };
    if wrapped {
        s.wraps.push(Wrap {
            wrapper: DEFINE.into(),
            kind: WrapKind::Call,
        });
    }
    s
}

fn file(path: &str, package: &str, symbols: Vec<Symbol>) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: package.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols,
        ..Default::default()
    }
}

fn bare(i: usize) -> String {
    format!("{JOBS}/sync/bare-{i}.ts")
}

/// `wrapped` jobs wrapped in `defineJob()`, `bare` jobs wrapped in nothing, 60 plain
/// functions in another package (so the rule has lift); `edit` changes the files last.
fn jobs(wrapped: usize, bare_n: usize, edit: impl FnOnce(&mut Vec<FileFacts>)) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..wrapped {
        let dir = ["billing", "email", "sync"][i % 3];
        files.push(file(
            &format!("{JOBS}/{dir}/job-{i}.ts"),
            PKG,
            vec![sym("default", true)],
        ));
    }
    for i in 0..bare_n {
        files.push(file(&bare(i), PKG, vec![sym("default", false)]));
    }
    files.push(file(
        "worker/src/jobs/lib/define-job.ts",
        PKG,
        vec![sym("defineJob", false)],
    ));
    for i in 0..60 {
        files.push(file(
            &format!("api/src/util/u{i}.ts"),
            "api",
            vec![sym(&format!("util{i}"), false)],
        ));
    }
    edit(&mut files);
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

fn policy(r: &RepoFacts) -> ConventionsFile {
    let cs = mine(r, &MineOptions { max_per_repo: 200 }).candidates;
    let c: Candidate = cs
        .iter()
        .find(|c| {
            matches!(&c.rule, Rule::WrappedBy { kind: WrapKind::Call, any_of }
                if any_of.iter().any(|a| a == DEFINE))
        })
        .cloned()
        .expect("the defineJob rule is mined");
    let mut p = ConventionsFile::merge(None, "test", Default::default(), std::slice::from_ref(&c));
    p.conventions[0].status = Status::Accepted;
    p.conventions[0].mode = Mode::Block;
    p
}

/// Item 1, the reviewer's scenario: an accepted rule with one legacy break; a change adds
/// 15 jobs without the wrapper, so 45 of 61 follow it (under 75%). Before the fix the
/// rule went stale, every violation advised and the check passed. Now the new breaks
/// count as following for staleness: the rule is not stale and the 15 block.
#[test]
fn a_change_that_breaks_enough_members_still_blocks() {
    let before = jobs(45, 1, |_| {});
    let p = policy(&before);
    let lock = baseline(&before, &p);
    let after = jobs(45, 16, |_| {});
    let report = check(&after, &p, &lock, Scope::Accepted, None);
    let s = &report.standing[0];
    assert_eq!(s.stale, None, "{s:?}");
    assert_eq!(s.mode, "block");
    assert_eq!(report.blocking().count(), 15);
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.baselined && v.path == bare(0))
    );
}

/// Item 2: a member in a file the parser reported errors in is counted once, as not
/// checked, and never as breaking (before, it was both).
#[test]
fn a_member_of_a_file_that_did_not_parse_is_counted_once() {
    let r = jobs(45, 2, |files| {
        for f in files.iter_mut().filter(|f| f.path == bare(1)) {
            f.parse_ok = false;
        }
    });
    let p = policy(&jobs(45, 2, |_| {}));
    let report = check(&r, &p, &Lock::default(), Scope::Accepted, None);
    let paths: Vec<&str> = report.violations.iter().map(|v| v.path.as_str()).collect();
    assert_eq!(paths, [bare(0).as_str()]);
    let s = &report.standing[0];
    assert_eq!((s.holders, s.not_checked, s.members), (45, 1, 47), "{s:?}");
    assert!(
        s.not_checked_why.keys().any(|w| w.contains("parse errors")),
        "{s:?}"
    );
}

/// Item 4: a legacy member error recovery dropped from a file that did not parse is not
/// fixed: removing its line would bring the violation back as new.
#[test]
fn a_lock_entry_in_a_file_that_did_not_parse_is_not_fixed() {
    let before = jobs(45, 2, |_| {});
    let p = policy(&before);
    let lock = baseline(&before, &p);
    let r = jobs(45, 2, |files| {
        for f in files.iter_mut().filter(|f| f.path == bare(1)) {
            f.parse_ok = false;
            f.symbols.clear();
        }
    });
    let report = check(&r, &p, &lock, Scope::Accepted, None);
    assert!(
        report.fixed.iter().all(|f| !f.contains(&bare(1))),
        "{:?}",
        report.fixed
    );
}

/// Item 3: a legacy job whose file moved is held by its fingerprint and listed as moved;
/// once `follow_moves` rewrites its lines, an edit of it (a new call, so a new
/// fingerprint) keeps it legacy, and the old place is not listed as fixed.
#[test]
fn moved_debt_is_listed_and_its_lines_follow_it() {
    let before = jobs(45, 1, |_| {});
    let p = policy(&before);
    let mut lock = baseline(&before, &p);
    let moved_to = format!("{JOBS}/email/legacy.ts");
    let moved = jobs(45, 1, |files| {
        for f in files.iter_mut().filter(|f| f.path == bare(0)) {
            f.path = moved_to.clone();
        }
    });
    let report = check(&moved, &p, &lock, Scope::Accepted, None);
    assert_eq!(report.blocking().count(), 0, "{:?}", report.violations);
    assert_eq!(report.moved.len(), 1, "{:?}", report.moved);
    assert_eq!(report.moved[0].from, format!("{}#default", bare(0)));
    assert_eq!(report.moved[0].to, format!("{moved_to}#default"));

    assert_eq!(lock.follow_moves(&report.moved), 1);
    assert!(lock.contains(&p.conventions[0].id, &format!("{moved_to}#default")));
    assert!(!lock.contains(&p.conventions[0].id, &format!("{}#default", bare(0))));

    let edited = jobs(45, 1, |files| {
        for f in files.iter_mut().filter(|f| f.path == bare(0)) {
            f.path = moved_to.clone();
            f.symbols[0].calls.push("api/src/util/u1.ts#util1".into());
        }
    });
    let report = check(&edited, &p, &lock, Scope::Accepted, None);
    assert_eq!(report.blocking().count(), 0, "{:?}", report.violations);
    assert!(report.moved.is_empty(), "{:?}", report.moved);
    assert!(report.fixed.is_empty(), "{:?}", report.fixed);
}

/// Item 5: a model that shares the `path#symbol` of a violation's unit does not give the
/// lock its fingerprint (`baseline` keyed units by `path#symbol`, and the last one won).
#[test]
fn the_lock_fingerprint_is_the_violations_own_unit() {
    let plain = jobs(45, 1, |_| {});
    let p = policy(&plain);
    let mut r = plain.clone();
    r.models.push(Model {
        path: bare(0),
        name: "default".into(),
        source: "sql".into(),
        line: 40,
        fields: vec!["id".into()],
    });
    let id = p.conventions[0].id.clone();
    let member = format!("{}#default", bare(0));
    let print = |lock: &Lock| -> Vec<String> {
        lock.entries
            .iter()
            .filter(|(i, _)| *i == id)
            .filter_map(|(_, k)| Lock::split_fingerprint(k))
            .filter(|(_, m)| *m == member)
            .map(|(fp, _)| fp.to_string())
            .collect()
    };
    // The fingerprint of the symbol, read where no model shares its key.
    let want = print(&baseline(&plain, &p));
    assert_eq!(want.len(), 1);
    assert_eq!(print(&baseline(&r, &p)), want);
}
