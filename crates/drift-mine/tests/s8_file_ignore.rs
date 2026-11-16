//! Stream S8, audit 6 G3: a `drift-ignore` comment can cover a violation of a file-level
//! rule. Before, `Unit::suppressions` gave files nothing, so a header comment above a
//! layering break, or one on the import's own line, changed nothing and the check still
//! failed, while the agent was told to add one. Every name is invented.

use drift_core::{FileFacts, Import, RepoFacts};
use drift_mine::check::{CheckReport, Scope, check, locate_imports};
use drift_mine::mine::{Candidate, MineOptions, Rule, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Status};
use drift_mine::roles::{header_suppressions, suppressions_at};

fn file(path: &str, imports: &[&str]) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        imports: imports
            .iter()
            .map(|m| Import {
                module: (*m).into(),
                names: vec!["x".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect(),
        ..Default::default()
    }
}

/// `kit/` (60 files) sits below `views/forms`, as in `layer11.rs`; with `k60`, a new
/// `kit/k60.ts` imports a form.
fn layered(k60: bool) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..60 {
        let imports: &[&str] = if i == 0 { &["views/forms/f3.tsx"] } else { &[] };
        files.push(file(&format!("kit/k{i}.ts"), imports));
    }
    for i in 0..12 {
        files.push(file(&format!("views/forms/f{i}.tsx"), &["kit/k2.ts"]));
    }
    if k60 {
        files.push(file("kit/k60.ts", &["kit/k1.ts", "views/forms/f2.tsx"]));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

/// The layering rule, mined before `kit/k60.ts` was written, accepted.
fn policy() -> ConventionsFile {
    let cs: Vec<Candidate> = mine(&layered(false), &MineOptions { max_per_repo: 200 })
        .candidates
        .into_iter()
        .filter(|c| matches!(&c.rule, Rule::Avoids { signal } if signal == "import:views/forms"))
        .collect();
    assert_eq!(cs.len(), 1, "kit avoids views/forms");
    let mut p = ConventionsFile::merge(None, "test", Default::default(), &cs);
    for c in &mut p.conventions {
        c.status = Status::Accepted;
    }
    p
}

/// The report for `kit/k60.ts` written as `text`, its imports located and its comments read.
/// Checked against the lock `init` wrote before `kit/k60.ts` existed: `kit/k0.ts`, the
/// rule's outlier when it was mined, is baselined there, so the one new violation is
/// k60's (with no lock, k0's old break counted as new too).
fn checked(r: &RepoFacts, p: &ConventionsFile, text: &str) -> CheckReport {
    let lock = drift_mine::check::baseline(&layered(false), p);
    let mut report = check(r, p, &lock, Scope::Accepted, None);
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("kit")).unwrap();
    std::fs::write(dir.path().join("kit/k60.ts"), text).unwrap();
    locate_imports(&mut report, dir.path());
    report
}

fn k60(report: &CheckReport) -> &drift_mine::check::Violation {
    report
        .violations
        .iter()
        .find(|v| v.path == "kit/k60.ts")
        .expect("k60 breaks the rule")
}

#[test]
fn a_header_comment_suppresses_a_layering_violation() {
    let r = layered(true);
    let p = policy();
    let id = p.conventions[0].id.clone();
    let body = "import { k1 } from \"./k1\";\n\nimport { Form } from \"@/views/forms/f2\";\n";
    // No comment: the violation is new.
    let plain = checked(&r, &p, body);
    assert!(!k60(&plain).suppressed);
    assert_eq!(plain.new_violations().count(), 1);
    // A header comment with a reason covers the whole file.
    let header = format!("// drift-ignore {id}: the kit preview renders a real form\n{body}");
    let report = checked(&r, &p, &header);
    assert!(k60(&report).suppressed, "{:?}", k60(&report));
    assert_eq!(report.new_violations().count(), 0);
    // Without a reason it covers nothing: every exception is explained.
    let bare = format!("// drift-ignore {id}\n{body}");
    assert!(!k60(&checked(&r, &p, &bare)).suppressed);
    // Another convention's id covers nothing.
    let other = format!("// drift-ignore D-000000: not this rule\n{body}");
    assert!(!k60(&checked(&r, &p, &other)).suppressed);
    // A comment below the first line of code is not the header.
    let late = format!("{body}// drift-ignore {id}: too late\n");
    assert!(!k60(&checked(&r, &p, &late)).suppressed);
}

#[test]
fn a_comment_on_the_offending_import_suppresses_it() {
    let r = layered(true);
    let p = policy();
    let id = p.conventions[0].id.clone();
    let trailing = format!(
        "import {{ k1 }} from \"./k1\";\n\nimport {{ Form }} from \"@/views/forms/f2\"; // drift-ignore {id}: preview only\n"
    );
    assert!(k60(&checked(&r, &p, &trailing)).suppressed);
    let above = format!(
        "import {{ k1 }} from \"./k1\";\n// drift-ignore {id}: preview only\nimport {{ Form }} from \"@/views/forms/f2\";\n"
    );
    assert!(k60(&checked(&r, &p, &above)).suppressed);
    // On another import's line it covers nothing.
    let elsewhere = format!(
        "import {{ k1 }} from \"./k1\"; // drift-ignore {id}: wrong line\n\nimport {{ Form }} from \"@/views/forms/f2\";\n"
    );
    assert!(!k60(&checked(&r, &p, &elsewhere)).suppressed);
}

#[test]
fn headers_are_read_in_every_comment_form() {
    let id = "D-abc123";
    for text in [
        format!("#!/usr/bin/env node\n// drift-ignore {id}: a script\nrun();\n"),
        format!("\"use client\";\n/* drift-ignore {id}: a client island */\nexport {{}};\n"),
        format!("/**\n * Kit preview.\n * drift-ignore {id}: a preview\n */\nexport {{}};\n"),
        format!("# drift-ignore {id}: a settings module\nimport os\n"),
        format!("-- drift-ignore {id}: a seed\ncreate table t (id int);\n"),
    ] {
        assert_eq!(header_suppressions(&text), [id], "{text}");
    }
    assert!(header_suppressions(&format!("x();\n// drift-ignore {id}: late\n")).is_empty());
    assert!(header_suppressions("{ \"name\": \"t\" }").is_empty());
    assert_eq!(
        suppressions_at(&format!("a();\n// drift-ignore {id}: why\nb();\n"), 3),
        [id]
    );
    assert!(suppressions_at(&format!("// drift-ignore {id}: why\na();\nb();\n"), 3).is_empty());
}
