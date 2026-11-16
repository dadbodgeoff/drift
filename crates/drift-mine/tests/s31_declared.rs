//! Rules the repository declares (`drift_mine::declared`, stream S31): an import
//! restriction a lint configuration scopes to a folder is read from the facts, checked
//! against the code with the existing layering rule, and offered as a proposal labelled
//! "declared in `<file>`", with the files that follow it, break it and were not read.
//! Every name is invented.

use drift_core::{
    FileFacts, Import, LintConfig, LintRule, RepoFacts, ScopedLintRules, SkipReason, Skipped,
};
use drift_mine::check::{Scope, check};
use drift_mine::declared::{DECLARED, declared, declared_id, proposal_lines};
use drift_mine::from_map::{LAYERING, MinedRule, layering};
use drift_mine::mine::Rule;
use drift_mine::policy::{ConventionsFile, Lock, Mode, Status};
use drift_mine::roles::FileKinds;

fn file(path: &str, imports: &[String]) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        package: String::new(),
        parse_ok: true,
        imports: imports
            .iter()
            .map(|m| Import {
                module: m.clone(),
                names: vec!["x".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect(),
        ..Default::default()
    }
}

/// A `biome.json` whose one `overrides` entry restricts imports for `dir`, as the scan
/// records it: the options as a sorted bag of strings, messages and keys included.
fn biome(dir: &str, options: &[&str]) -> LintConfig {
    let mut options: Vec<String> = options.iter().map(|s| s.to_string()).collect();
    options.sort();
    LintConfig {
        path: "biome.json".into(),
        tool: "biome".into(),
        inherits: false,
        rules: vec![],
        scoped: vec![ScopedLintRules {
            dirs: vec![dir.into()],
            rules: vec![LintRule {
                rule: "no-restricted-imports".into(),
                level: "error".into(),
                options,
            }],
        }],
    }
}

/// `core/` (`n` files, each importing a sibling) below `ui/screens/` (12 files, each
/// importing `core/c1.ts`), plus `extra`, with `lint`.
fn layered(n: usize, extra: Vec<FileFacts>, lint: Vec<LintConfig>) -> RepoFacts {
    let mut files = Vec::new();
    for i in 0..n {
        files.push(file(
            &format!("core/c{i}.ts"),
            &[format!("core/c{}.ts", (i + 1) % n)],
        ));
    }
    for i in 0..12 {
        files.push(file(
            &format!("ui/screens/s{i}.tsx"),
            &["core/c1.ts".to_string()],
        ));
    }
    files.extend(extra);
    let mut r = RepoFacts {
        files,
        lint,
        ..Default::default()
    };
    r.normalize();
    r
}

const SCREENS: &[&str] = &[
    "../ui/screens/**",
    "group",
    "message",
    "patterns",
    "core should not import the screens.",
];

/// Pins the proposal: a restriction the code follows becomes one proposal, the existing
/// layering rule, labelled declared, proposed, advising, shown to no agent, with the
/// right counts. Before this stream the restriction was read only as a veto on mining.
#[test]
fn a_declared_restriction_the_code_follows_is_proposed_with_its_counts() {
    // 20 importing files: fewer than a layering proposal from the map needs (35), so
    // nothing else says it.
    let r = layered(20, vec![], vec![biome("core", SCREENS)]);
    let kinds = FileKinds::learn(&r);
    assert!(layering(&r, &kinds, &[]).is_empty());
    let d = declared(&r, &kinds, &[]);
    assert_eq!(d.proposals.len(), 1, "{d:#?}");
    assert!(d.also.is_empty(), "{:?}", d.also);
    let p = &d.proposals[0];
    let c = &p.convention;
    assert_eq!(
        c.rule,
        Rule::Avoids {
            signal: "import:ui/screens".into()
        }
    );
    assert_eq!((c.role.package.as_str(), c.role.dir.as_str()), ("", "core"));
    assert_eq!(c.from_map.as_deref(), Some(DECLARED));
    assert_eq!((c.status, c.mode), (Status::Proposed, Mode::Advise));
    assert_eq!(
        c.agents, None,
        "nothing reaches an agent until a person accepts it"
    );
    assert_eq!(c.id, declared_id(&c.role, "ui/screens"));
    assert_eq!(
        c.summary,
        "Code in core does not import ui/screens, as biome.json declares (none of 20 files do)"
    );
    let e = &p.declared;
    assert_eq!(e.configs, vec!["biome.json".to_string()]);
    assert_eq!(e.written, vec!["../ui/screens/**".to_string()]);
    assert_eq!(e.level, "error");
    assert_eq!(
        (e.in_scope, e.follows, e.breaks, e.not_read),
        (20, 20, 0, 0)
    );
    assert_eq!((c.evidence.holders, c.evidence.total), (20, 20));
    let lines = proposal_lines(c, e);
    assert!(lines[0].contains("declared in biome.json"), "{lines:?}");
    assert!(
        lines[0].contains("could not be read (never reported)"),
        "{lines:?}"
    );
}

/// Pins that `drift check` reads an accepted declared proposal with no change: it holds
/// today and reports a new file of `core/` that imports the screens.
#[test]
fn the_checker_evaluates_an_accepted_declared_rule() {
    let r = layered(20, vec![], vec![biome("core", SCREENS)]);
    let kinds = FileKinds::learn(&r);
    let mut accepted = declared(&r, &kinds, &[]).proposals[0].convention.clone();
    accepted.status = Status::Accepted;
    let id = accepted.id.clone();
    let mut policy = ConventionsFile::merge(None, "test", kinds, &[]);
    policy.conventions.push(accepted);
    let today = check(&r, &policy, &Lock::default(), Scope::Accepted, None);
    assert!(
        !today.violations.iter().any(|v| v.id == id),
        "{:?}",
        today.violations
    );
    let after = layered(
        20,
        vec![file("core/c20.ts", &["ui/screens/s2.tsx".to_string()])],
        vec![biome("core", SCREENS)],
    );
    let report = check(&after, &policy, &Lock::default(), Scope::Accepted, None);
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.id == id && v.path == "core/c20.ts"),
        "{:?}",
        report.violations
    );
}

/// Pins that a declared rule the code breaks is still shown, with the breaks counted and
/// named, and that its id does not move with the count.
#[test]
fn a_declared_restriction_the_code_breaks_is_shown_with_the_breaks() {
    let breaking: Vec<FileFacts> = (20..23)
        .map(|i| file(&format!("core/c{i}.ts"), &["ui/screens/s2.tsx".to_string()]))
        .collect();
    let r = layered(20, breaking, vec![biome("core", SCREENS)]);
    let d = declared(&r, &FileKinds::learn(&r), &[]);
    assert_eq!(d.proposals.len(), 1, "{d:#?}");
    let p = &d.proposals[0];
    let e = &p.declared;
    assert_eq!((e.in_scope, e.follows, e.breaks), (23, 20, 3));
    assert_eq!(
        e.breaking,
        vec!["core/c20.ts", "core/c21.ts", "core/c22.ts"]
    );
    assert!(
        p.convention.summary.ends_with("(3 of 23 files do today)"),
        "{}",
        p.convention.summary
    );
    let lines = proposal_lines(&p.convention, e).join("\n");
    assert!(lines.contains("broken in 3 file(s) today"), "{lines}");
    let clean = layered(20, vec![], vec![biome("core", SCREENS)]);
    assert_eq!(
        declared(&clean, &FileKinds::learn(&clean), &[]).proposals[0]
            .convention
            .id,
        p.convention.id
    );
}

/// Pins "unknown is never a violation": a file Drift could not read is counted as not
/// read, never as a break, even when the part it read imports the screens.
#[test]
fn a_file_not_read_is_neither_a_follower_nor_a_break() {
    let mut half = file("core/c20.ts", &["ui/screens/s2.tsx".to_string()]);
    half.parse_ok = false;
    let r = layered(20, vec![half], vec![biome("core", SCREENS)]);
    let d = declared(&r, &FileKinds::learn(&r), &[]);
    let e = &d.proposals[0].declared;
    assert_eq!((e.follows, e.breaks, e.not_read), (20, 0, 1), "{e:?}");
}

/// Pins that "not read" is counted as a layering proposal counts it: a file with an
/// import Drift could not resolve (it may land in the screens) is not read, never a
/// follower; and a production file the scan skipped whole (here a generated one) is not
/// read either. Before, the first counted as following and the second was left out.
#[test]
fn an_unresolved_import_or_a_skipped_file_is_not_read() {
    let open = file("core/c20.ts", &["unresolved:@/screens/s2".to_string()]);
    let mut r = layered(20, vec![open], vec![biome("core", SCREENS)]);
    r.skipped.push(Skipped {
        path: "core/schema.ts".into(),
        reason: SkipReason::Generated,
    });
    let d = declared(&r, &FileKinds::learn(&r), &[]);
    let e = &d.proposals[0].declared;
    assert_eq!(
        (e.in_scope, e.follows, e.breaks, e.not_read),
        (21, 20, 0, 2),
        "{e:?}"
    );
}

/// Pins that a configuration Drift could not read to the end gives nothing, never a
/// guess: one the scan could not parse (listed with no settings), one whose restriction
/// names only some names of a module, and an allow-list.
#[test]
fn an_unreadable_configuration_yields_nothing() {
    let unparsed = LintConfig {
        path: "biome.json".into(),
        tool: "biome".into(),
        ..Default::default()
    };
    let r = layered(20, vec![], vec![unparsed]);
    let d = declared(&r, &FileKinds::learn(&r), &[]);
    assert!(
        d.proposals.is_empty() && d.also.is_empty() && d.not_expressed.is_empty(),
        "{d:#?}"
    );

    let partial = biome(
        "core",
        &["../ui/screens/**", "importNames", "Screen", "paths", "name"],
    );
    let r = layered(20, vec![], vec![partial]);
    let d = declared(&r, &FileKinds::learn(&r), &[]);
    assert!(d.proposals.is_empty(), "{d:#?}");
    assert_eq!(d.not_expressed.len(), 1, "{d:#?}");
    assert_eq!(d.not_expressed[0].why, "partial");

    let allow = biome("core", &["!../ui/screens/**", "../**", "group"]);
    let r = layered(20, vec![], vec![allow]);
    let d = declared(&r, &FileKinds::learn(&r), &[]);
    assert!(d.proposals.is_empty(), "{d:#?}");
    assert_eq!(d.not_expressed[0].why, "allow_list");
}

/// Pins that a restriction Drift cannot express is listed with why: a package outside
/// the repository, and a relative path that names no folder.
#[test]
fn what_cannot_be_expressed_is_listed_with_why() {
    let r = layered(
        20,
        vec![],
        vec![biome("core", &["@other/server", "../nowhere/**", "group"])],
    );
    let d = declared(&r, &FileKinds::learn(&r), &[]);
    assert!(d.proposals.is_empty(), "{d:#?}");
    let whys: Vec<&str> = d.not_expressed.iter().map(|n| n.why).collect();
    assert!(whys.contains(&"package"), "{whys:?}");
    assert!(whys.contains(&"no_folder"), "{whys:?}");
}

/// Pins the duplicate test: a restriction a layering proposal from the map already
/// states is attached to it ("also declared in"), not proposed a second time; one a mined
/// convention states is attached to that one.
#[test]
fn a_restriction_equal_to_a_layering_proposal_is_attached() {
    // 40 importing files: a layering proposal from the map says "core never imports
    // ui/screens".
    let r = layered(40, vec![], vec![biome("core", SCREENS)]);
    let kinds = FileKinds::learn(&r);
    let ps = layering(&r, &kinds, &[]);
    assert_eq!(ps.len(), 1, "{ps:#?}");
    let d = declared(&r, &kinds, &[]);
    assert!(d.proposals.is_empty(), "{d:#?}");
    assert_eq!(d.also.len(), 1, "{d:#?}");
    assert_eq!(d.also[0].id, ps[0].convention.id);
    assert_eq!(d.also[0].by, LAYERING);
    assert_eq!(d.also[0].configs, vec!["biome.json".to_string()]);
    let notes = drift_mine::declared::notes(&d);
    assert!(
        notes[0].lines[0].contains("also declared in biome.json"),
        "{:?}",
        notes[0].lines
    );

    let mined = [MinedRule {
        id: "D-000001",
        role: &ps[0].convention.role,
        rule: &ps[0].convention.rule,
    }];
    let d = declared(&r, &kinds, &mined);
    assert!(d.proposals.is_empty(), "{d:#?}");
    assert_eq!((d.also[0].id.as_str(), d.also[0].by), ("D-000001", "mined"));
}
