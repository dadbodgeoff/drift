//! S22: what a reviewer sees before trusting a failed check. A rule that fails a build
//! must be one the person looking at the red check can verify without running Drift, on
//! every surface they meet: the text `drift check` prints, the GitHub annotations and job
//! summary, and `drift card`. Each says, with the same labels:
//!
//! 1. the rule in one sentence, and where it came from (`source`: mined, promoted by a
//!    person, or proposed from a map);
//! 2. the evidence a person accepted beside the evidence now (`accepted at 38 of 40;
//!    today 38 of 42, 1 not checked`), and what changed since;
//! 3. who accepted it and when: nothing, since the repository records neither (the
//!    policy keeps no name or date, the review log is local and keeps no person);
//! 4. where it holds: members that follow it, nearest the violation first, and the one
//!    to copy;
//! 5. the violation, `path:line`, and what the unit does instead;
//! 6. how to dispute it: the `drift-ignore` comment where one can work, the command that
//!    marks the unit fine, and the commands that demote or reject the rule;
//! 7. what was not checked: members Drift could not read, counted apart.
//!
//! A rule accepted by a Drift that kept no accepted evidence says only what it reads
//! now, with no placeholder. Before S22 none of these lines existed (the evidence was
//! `38/40` as mining refreshes it, with no "accepted at", no nearby holders, no "instead"
//! and no `--exempt` command), so every assertion below fails on the earlier code.
//!
//! The text and GitHub assertions need `drift check` to call `pr::print_trust` and
//! `pr::github_output_with` (two hunks in `main.rs`, listed in the S22 report).

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
/// A route wrapped in something Drift cannot read (its import resolves to no file):
/// whether it follows the rule is unknown, so it is not checked, never a violation.
const UNREAD: &str = "import { guard } from \"./nowhere\";\n\nexport const GET = guard(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift` with its exit code, stdout and stderr.
fn drift(root: &Path, args: &[&str], env: &[(&str, &Path)]) -> (i32, String, String) {
    let mut cmd = Command::new(&*BIN);
    cmd.env("DRIFT_TEST_UNSHOWN", "1");
    cmd.args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// What the tests read back about the repository they built.
struct Built {
    dir: tempfile::TempDir,
    /// The accepted rule: routes in `app/api` are wrapped in `withAuth()`.
    id: String,
    /// The new violation's file: next to a route that follows the rule.
    violator: String,
    /// The route next to it, which follows the rule: the nearest member to name.
    neighbour: String,
}

/// 40 route files in `app/api`, 38 wrapped in `withAuth` (the 2 others baselined), the
/// rule accepted in block mode. With `refreshed`, `drift init` runs again after the
/// acceptance, which keeps the evidence the person accepted beside the policy; without
/// it, the policy is as a Drift from before kept it. Then a new unguarded route is added
/// next to one that follows the rule, and a route whose wrapper Drift cannot read.
fn repo(refreshed: bool) -> Built {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    let (code, _, err) = drift(r, &["init"], &[]);
    assert_eq!(code, 0, "{err}");
    let (_, census, _) = drift(r, &["census", "--json"], &[]);
    let census: Value = serde_json::from_str(&census).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule_kind"] == "wrapped_by:call")
        .unwrap_or_else(|| panic!("the wrapper rule is learned: {census}"))["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(drift(r, &["review", "--block", &id], &[]).0, 0);
    let policy = || std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    if refreshed {
        let (code, _, err) = drift(r, &["init"], &[]);
        assert_eq!(code, 0, "{err}");
        assert!(policy().contains("accepted_evidence"), "{}", policy());
    } else {
        assert!(!policy().contains("accepted_evidence"), "{}", policy());
    }
    // The example to copy is named apart: the neighbour is another route.
    let (_, json, _) = drift(r, &["check", "--format", "json"], &[]);
    let json: Value = serde_json::from_str(&json).unwrap();
    let example = json["violations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id.as_str())
        .map(|v| v["example"].as_str().unwrap().to_string())
        .unwrap_or_default();
    let n = if example.starts_with("app/api/r05/") {
        6
    } else {
        5
    };
    let neighbour = format!("app/api/r{n:02}/route.ts");
    let violator = format!("app/api/r{n:02}/extra/route.ts");
    write(r, &violator, UNGUARDED);
    write(r, "app/api/r07/odd/route.ts", UNREAD);
    Built {
        dir,
        id,
        violator,
        neighbour,
    }
}

/// `(holders, total)` of the violation's evidence (`38/40`), as mining refreshes it.
fn evidence(r: &Path, id: &str) -> (String, String) {
    let (_, json, _) = drift(r, &["check", "--format", "json"], &[]);
    let json: Value = serde_json::from_str(&json).unwrap();
    let ev = json["violations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id)
        .unwrap_or_else(|| panic!("a violation of {id}: {json}"))["evidence"]
        .as_str()
        .unwrap()
        .to_string();
    let (h, t) = ev.split_once('/').unwrap();
    (h.to_string(), t.to_string())
}

/// `today H of M, N not checked`, as the check's standing of `id` has it, with N ≥ 1.
fn today(r: &Path, id: &str) -> String {
    let (_, json, _) = drift(r, &["check", "--format", "json"], &[]);
    let json: Value = serde_json::from_str(&json).unwrap();
    let s = json["standing"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap_or_else(|| panic!("a standing of {id}: {json}"))
        .clone();
    let n = s["not_checked"].as_u64().unwrap();
    assert!(n >= 1, "the unread route is not checked: {s}");
    format!(
        "today {} of {}, {n} not checked",
        s["holders"], s["members"]
    )
}

#[test]
fn each_surface_says_what_a_failed_check_rests_on() {
    let b = repo(true);
    let r = b.dir.path();
    let id = b.id.as_str();
    let (h, t) = evidence(r, id);
    let accepted = format!("accepted at {h} of {t}");
    let now = today(r, id);
    let source = "mined from the code, accepted by a person";
    let near = format!("{}:3 GET", b.neighbour);
    let here = format!("{}:1 GET: it is not wrapped in withAuth()", b.violator);
    let comment = format!("// drift-ignore {id}: <reason>");
    let exempt = format!(
        // Quoted as shell words: the member holds `#`, the reason placeholder `<`.
        "drift review --exempt {id} --member '{}#GET' --reason '<why>'",
        b.violator
    );
    let advise = format!("drift review --advise {id}");
    let reject = format!("drift review --reject {id}");

    // The text `drift check` prints: its first line as before, then the basis.
    let (code, text, err) = drift(r, &["check"], &[]);
    assert_eq!(code, 1, "the new route blocks: {text}{err}");
    assert!(text.starts_with("drift: 1 new violation(s) ("), "{text}");
    let at = text
        .find("drift: what each rule that reported a new violation rests on:\n")
        .unwrap_or_else(|| panic!("{text}"));
    let basis = &text[at..];
    for want in [
        format!("[{id}] "),
        format!("  source       {source}\n"),
        format!("  evidence     {accepted}; {now}\n"),
        "  not checked  1 member(s) Drift could not read, never reported: it is wrapped in ".to_string(),
        format!("  here         {here}\n"),
        format!("    holds near it  {near}"),
        format!("    exception  add `{comment}` above the declaration\n"),
        format!("    exception  a person runs `{exempt}`\n"),
        format!("  wrong rule   a person runs `{advise}` keeps it as advice"),
        format!("`{reject}` drops it\n"),
    ] {
        assert!(basis.contains(&want), "{want:?} in:\n{basis}");
    }
    // The unread route is counted, never listed as a violation.
    assert!(!text.contains("app/api/r07/odd/route.ts:"), "{text}");

    // GitHub: the annotation's first lines as before, then the basis; the job summary.
    let summary_dir = tempfile::tempdir().unwrap();
    let summary = summary_dir.path().join("summary.md");
    let (code, out, err) = drift(
        r,
        &["check", "--format", "github"],
        &[("GITHUB_STEP_SUMMARY", &summary)],
    );
    assert_eq!(code, 1, "{out}{err}");
    let line = out
        .lines()
        .find(|l| l.starts_with(&format!("::error file={},line=1,title=drift {id}::", b.violator)))
        .unwrap_or_else(|| panic!("{out}"));
    for want in [
        "does not follow it.%0ACopy ".to_string(),
        "%0ABlock mode: this fails the check.%0A".to_string(),
        format!("%0ASource: {source}.%0A"),
        format!("%0AEvidence: {accepted}; {now}.%0A"),
        "%0ANot checked: 1 member(s) Drift could not read, never reported: ".to_string(),
        "%0AHere: it is not wrapped in withAuth().%0A".to_string(),
        format!("%0AHolds near it: {near}"),
        format!("`{comment}`"),
        format!("%0AException: a person runs `{exempt}`."),
        format!("%0AWrong rule: a person runs `{advise}` keeps it as advice"),
    ] {
        assert!(line.contains(&want), "{want:?} in:\n{line}");
    }
    // The summary line is the last line, as before: no line of its own was added.
    assert!(
        out.lines()
            .last()
            .is_some_and(|l| l.starts_with("drift: 1 new violation(s), 1 in block mode")),
        "{out}"
    );
    let md = std::fs::read_to_string(&summary).unwrap();
    assert!(md.starts_with("## Drift\n"), "{md}");
    let at = md.find("\n### What each rule rests on\n").unwrap_or_else(|| panic!("{md}"));
    let rests = &md[at..];
    for want in [
        format!("**`{id}`** "),
        format!("- Source: {source}\n"),
        format!("- Evidence: {accepted}; {now}\n"),
        "- Not checked: 1 member\\(s\\) Drift could not read, never reported: ".to_string(),
        "- Copy: `".to_string(),
        format!("- Here: `{}:1 GET`: it is not wrapped in withAuth\\(\\)", b.violator),
        format!(". Holds near it: `{near}`"),
        format!(". Exception: add `{comment}` above the declaration, or a person runs `{exempt}`"),
        format!("- Wrong rule: `{advise}` keeps it as advice"),
        format!("`{reject}` drops it\n"),
    ] {
        assert!(rests.contains(&want), "{want:?} in:\n{rests}");
    }

    // `drift card` of the file: its violation, with the same labels.
    let (code, card, err) = drift(r, &["--no-cache", "card", &b.violator], &[]);
    assert_eq!(code, 0, "{err}");
    let at = card
        .find("Violations here (new: not in drift.lock, no drift-ignore), and what each rule rests on:\n")
        .unwrap_or_else(|| panic!("{card}"));
    let section = &card[at..];
    for want in [
        format!("  [{id}] "),
        format!("    source: {source}\n"),
        format!("    evidence: {accepted}; {now}\n"),
        "    not checked: 1 member(s) Drift could not read, never reported: ".to_string(),
        format!("    here: {here}\n"),
        format!("    holds near it: {near}"),
        "    copy: ".to_string(),
        format!("    exception: add `{comment}` above the declaration\n"),
        format!("    exception: a person runs `{exempt}`\n"),
        // The card is what agents run: it names no command that demotes the rule.
        "    wrong rule: say so to a person, who decides it with `drift review`\n".to_string(),
    ] {
        assert!(section.contains(&want), "{want:?} in:\n{section}");
    }
    // Before what is not known, which stays the card's last line.
    assert!(card.trim_end().lines().last().unwrap().starts_with("Not known: "), "{card}");

    // Nothing here says who accepted the rule or when: the repository records neither.
    for surface in [basis, line, rests, section] {
        assert!(!surface.contains("accepted on") && !surface.contains("accepted by:"), "{surface}");
    }
}

/// A rule accepted by a Drift that kept no accepted evidence: every surface says what it
/// reads now, and nothing in place of what it does not know.
#[test]
fn a_rule_accepted_before_its_evidence_was_kept_says_only_what_is_read_now() {
    let b = repo(false);
    let r = b.dir.path();
    let id = b.id.as_str();
    let now = today(r, id);

    let (code, text, _) = drift(r, &["check"], &[]);
    assert_eq!(code, 1, "{text}");
    assert!(text.contains(&format!("\n  evidence     {now}\n")), "{text}");
    assert!(!text.contains("accepted at"), "{text}");

    let summary_dir = tempfile::tempdir().unwrap();
    let summary = summary_dir.path().join("summary.md");
    let (_, out, _) = drift(
        r,
        &["check", "--format", "github"],
        &[("GITHUB_STEP_SUMMARY", &summary)],
    );
    assert!(out.contains(&format!("%0AEvidence: {now}.%0A")), "{out}");
    assert!(!out.contains("accepted at"), "{out}");
    let md = std::fs::read_to_string(&summary).unwrap();
    assert!(md.contains(&format!("- Evidence: {now}\n")), "{md}");
    assert!(!md.contains("accepted at"), "{md}");

    let (_, card, _) = drift(r, &["--no-cache", "card", &b.violator], &[]);
    assert!(card.contains(&format!("    evidence: {now}\n")), "{card}");
    assert!(!card.contains("accepted at"), "{card}");
}
