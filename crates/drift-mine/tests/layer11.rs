//! Layering advice names the import that breaks the rule (round 11,
//! eval/study/research/2026-11-09/layer11.md, pilot gap G4). Every name is invented.

use drift_core::{FileFacts, Import, RepoFacts};
use drift_mine::check::{Scope, check, find_import, locate_imports};
use drift_mine::mine::{Candidate, MineOptions, Rule, agent_summary, mine_unshown as mine};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::report::{AgentAt, agent_message};

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

fn repo(files: Vec<FileFacts>) -> RepoFacts {
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    r
}

fn mined(r: &RepoFacts) -> Vec<Candidate> {
    mine(r, &MineOptions { max_per_repo: 200 }).candidates
}

fn accept_all(cs: &[Candidate]) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "test", Default::default(), cs);
    for c in &mut p.conventions {
        c.status = Status::Accepted;
    }
    p
}

/// `kit/` (60 files) sits below `views/forms`: every forms file imports kit, and one
/// kit file imports a form.
fn layered(extra: Vec<FileFacts>) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..60 {
        let imports: &[&str] = if i == 0 { &["views/forms/f3.tsx"] } else { &[] };
        files.push(file(&format!("kit/k{i}.ts"), imports));
    }
    for i in 0..12 {
        files.push(file(&format!("views/forms/f{i}.tsx"), &["kit/k2.ts"]));
    }
    files.extend(extra);
    repo(files)
}

#[test]
fn a_layering_violation_names_its_import_and_line() {
    let cs = mined(&layered(vec![]));
    assert!(
        cs.iter()
            .any(|c| matches!(&c.rule, Rule::Avoids { signal } if signal == "import:views/forms")),
        "kit avoids views/forms"
    );
    let p = accept_all(&cs);
    let after = layered(vec![file(
        "kit/k60.ts",
        &["kit/k1.ts", "views/forms/f2.tsx"],
    )]);
    let mut report = check(&after, &p, &Lock::default(), Scope::Accepted, None);
    let dir = std::env::temp_dir().join(format!("drift-layer11-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("kit")).unwrap();
    std::fs::write(
        dir.join("kit/k60.ts"),
        "import { k1 } from \"./k1\";\n\nimport { Form } from \"@/views/forms/f2\";\n",
    )
    .unwrap();
    locate_imports(&mut report, &dir);
    std::fs::remove_dir_all(&dir).ok();
    let v = report
        .violations
        .iter()
        .find(|v| v.path == "kit/k60.ts")
        .expect("k60 breaks the rule");
    let hit = v.import.as_ref().expect("the import is named");
    assert_eq!(hit.module, "views/forms/f2.tsx");
    assert_eq!(hit.specifier, "@/views/forms/f2");
    assert_eq!((hit.line, v.line), (3, 3));
    // The agent's lines name the import, not a holder to copy, and leave out the clause.
    let text = agent_message(&[v], AgentAt::Edit);
    assert!(
        text.contains("at   kit/k60.ts:3 imports '@/views/forms/f2'"),
        "{text}"
    );
    assert!(!text.contains("  like "), "{text}");
    assert!(!text.contains("declared dependencies"), "{text}");
    // A file not found keeps the module, and line 1.
    let mut report = check(&after, &p, &Lock::default(), Scope::Accepted, None);
    locate_imports(
        &mut report,
        std::path::Path::new("/nonexistent-drift-layer11"),
    );
    let v = report
        .violations
        .iter()
        .find(|v| v.path == "kit/k60.ts")
        .unwrap();
    assert_eq!(
        v.import.as_ref().unwrap().describe(),
        "imports views/forms/f2.tsx"
    );
    assert_eq!(v.line, 1);
}

#[test]
fn agent_summaries_drop_only_the_layering_clause() {
    assert_eq!(
        agent_summary(
            "files in kit/** do not import from views/** (declared dependencies, and lazy loads of peer or optional dependencies, excepted)"
        ),
        "files in kit/** do not import from views/**"
    );
    assert_eq!(
        agent_summary("handlers call auth()"),
        "handlers call auth()"
    );
}

#[test]
fn imports_are_found_by_relative_and_aliased_specifiers() {
    let text =
        "import { a } from \"react\";\nimport { useBoard } from '@/screens/board/board-context';\n";
    assert_eq!(
        find_import(text, "parts/h1.tsx", "screens/board/board-context.ts"),
        Some((2, "@/screens/board/board-context".to_string()))
    );
    let text = "const x = require(\"../screens/board\");\n";
    assert_eq!(
        find_import(text, "parts/h1.tsx", "screens/board/index.ts"),
        Some((1, "../screens/board".to_string()))
    );
    assert_eq!(
        find_import(
            "import x from './other';\n",
            "parts/h1.tsx",
            "screens/board/index.ts"
        ),
        None
    );
}
