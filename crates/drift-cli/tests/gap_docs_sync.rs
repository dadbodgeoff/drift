//! The wiki keeps up with the code. Each test reads a real source of truth (the built
//! binary's `--help`, the constants the readers and the policy use, the CLI's own exit
//! codes and read-only tool list) and fails when a page in `docs/wiki/` falls behind:
//! a command or a long flag `--help` prints that the Command Reference does not name,
//! an exit code its table does not list, a lowering or policy version the wiki states
//! wrongly, or a list of auto-approved MCP tools that is not the one the hook uses.
//! Hidden flags (clap `hide`) are exempt: `--help` does not print them.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn page(name: &str) -> String {
    let p = repo().join("docs/wiki").join(name);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// A page's `## ` sections: heading text and body.
fn sections(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        if let Some(h) = line.strip_prefix("## ") {
            out.push((h.trim().to_string(), String::new()));
        } else if let Some((_, body)) = out.last_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    out
}

fn section<'a>(secs: &'a [(String, String)], heading: &str) -> Option<&'a str> {
    secs.iter()
        .find(|(h, _)| h == heading)
        .map(|(_, b)| b.as_str())
}

fn help(path: &[String]) -> String {
    let out = Command::new(&*BIN)
        .args(path)
        .arg("--help")
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success(), "{path:?} --help failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

/// The subcommands a help text lists under `Commands:` (clap's own `help` left out).
fn subcommands(help: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut lines = help.lines().skip_while(|l| l.trim_end() != "Commands:");
    lines.next();
    for l in lines {
        if l.is_empty() || !l.starts_with("  ") {
            break;
        }
        // A command's own line is indented by two; a wrapped description by more.
        if l.as_bytes().get(2).is_some_and(|b| *b != b' ') {
            let name = l.split_whitespace().next().unwrap_or_default();
            if name != "help" {
                out.push(name.to_string());
            }
        }
    }
    out
}

/// The long flags a help text lists under `Options:`. A flag's own line is indented by at
/// most six (`  -h, --help`, `      --root <ROOT>`); descriptions sit deeper.
fn long_flags(help: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut lines = help.lines().skip_while(|l| l.trim_end() != "Options:");
    lines.next();
    for l in lines {
        if !l.is_empty() && !l.starts_with(' ') {
            break;
        }
        let indent = l.len() - l.trim_start().len();
        let t = l.trim_start();
        if indent > 6 || !t.starts_with('-') {
            continue;
        }
        for w in t.split_whitespace() {
            let w = w.trim_end_matches(',');
            if let Some(name) = w.strip_prefix("--") {
                let name: String = name
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                    .collect();
                out.insert(format!("--{name}"));
            } else if !w.starts_with('-') {
                break;
            }
        }
    }
    out
}

/// Whether `text` names `flag` in code (`` `--flag``), not only a longer flag it begins.
fn names_flag(text: &str, flag: &str) -> bool {
    let needle = format!("`{flag}");
    text.match_indices(&needle).any(|(i, _)| {
        text[i + needle.len()..]
            .chars()
            .next()
            .is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '-'))
    })
}

/// Every subcommand path `drift --help` reaches, nested ones too, with its help text.
fn walk(path: Vec<String>, out: &mut Vec<(Vec<String>, String)>) {
    let text = help(&path);
    for sub in subcommands(&text) {
        let mut p = path.clone();
        p.push(sub);
        walk(p, out);
    }
    out.push((path, text));
}

/// Pins: every command and every long flag `--help` prints is named in the Command
/// Reference. A top-level command has its own `## drift <cmd>` section and a row in
/// "Commands at a glance"; a nested one has its own section or is named in its
/// parent's. Each flag is named in the section of its command (or the nearest parent
/// section that has one); a global flag of `drift --help` may be named in the Synopsis
/// instead.
#[test]
fn command_reference_names_every_command_and_flag() {
    let doc = page("Command-Reference.md");
    let secs = sections(&doc);
    let synopsis = section(&secs, "Synopsis").expect("a Synopsis section");
    let glance = section(&secs, "Commands at a glance").expect("a Commands at a glance section");
    let mut all = Vec::new();
    walk(Vec::new(), &mut all);
    assert!(
        all.len() > 10,
        "the walk found too few commands: {}",
        all.len()
    );
    let global = all
        .iter()
        .find(|(p, _)| p.is_empty())
        .map(|(_, h)| long_flags(h))
        .unwrap();
    assert!(global.contains("--root"), "{global:?}");
    let mut missing = Vec::new();
    for (path, text) in &all {
        let flags = long_flags(text);
        if path.is_empty() {
            for f in &flags {
                if !names_flag(synopsis, f) {
                    missing.push(format!("drift {f} (global option, in Synopsis)"));
                }
            }
            continue;
        }
        let full = path.join(" ");
        // The section that documents this command: its own, else the nearest parent's.
        let mut own = None;
        for n in (1..=path.len()).rev() {
            if let Some(b) = section(&secs, &format!("drift {}", path[..n].join(" "))) {
                own = Some((n, b));
                break;
            }
        }
        let Some((depth, body)) = own else {
            missing.push(format!("drift {full}: no section"));
            continue;
        };
        if path.len() == 1 && depth != 1 {
            missing.push(format!("drift {full}: no `## drift {full}` section"));
        }
        if depth < path.len() && !body.contains(&format!("drift {full}")) {
            missing.push(format!("drift {full}: not named in its parent's section"));
        }
        if path.len() == 1 && !glance.contains(&format!("(#drift-{full})")) {
            missing.push(format!("drift {full}: no row in Commands at a glance"));
        }
        for f in &flags {
            let ok = names_flag(body, f) || (global.contains(f) && names_flag(synopsis, f));
            if !ok {
                missing.push(format!("drift {full} {f}"));
            }
        }
    }
    assert!(
        missing.is_empty(),
        "docs/wiki/Command-Reference.md is behind `--help`:\n  {}",
        missing.join("\n  ")
    );
}

/// The exit codes the CLI's own source returns: `ExitCode::SUCCESS` and `FAILURE`,
/// `ExitCode::from(<n>)`, `process::exit(<n>)`, and the `u8` constants whose name says
/// exit (`EXIT_PENDING`, the closed-pipe `PIPE_EXIT`).
fn defined_exit_codes() -> BTreeSet<u32> {
    fn digits_after(s: &str, pat: &str, out: &mut BTreeSet<u32>) {
        for (i, _) in s.match_indices(pat) {
            let d: String = s[i + pat.len()..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            if let Ok(n) = d.parse() {
                out.insert(n);
            }
        }
    }
    fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                rs_files(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    rs_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let mut codes = BTreeSet::new();
    for f in files {
        let src = std::fs::read_to_string(&f).unwrap();
        if src.contains("ExitCode::SUCCESS") {
            codes.insert(0);
        }
        if src.contains("ExitCode::FAILURE") {
            codes.insert(1);
        }
        digits_after(&src, "ExitCode::from(", &mut codes);
        digits_after(&src, "process::exit(", &mut codes);
        for line in src.lines() {
            let l = line.trim();
            if l.contains("EXIT") && (l.starts_with("pub const ") || l.starts_with("const ")) {
                digits_after(l, ": u8 = ", &mut codes);
            }
            if l.contains("EXIT") && l.starts_with("static ") {
                digits_after(l, "AtomicU8::new(", &mut codes);
            }
        }
    }
    codes
}

/// Pins: the Command Reference's exit-code table lists exactly the exit codes the CLI
/// defines, so a new one (`drift upgrade`'s 3, the closed pipe's 141) cannot go
/// unlisted, and a code the CLI no longer returns cannot stay.
#[test]
fn exit_code_table_lists_every_code_the_cli_defines() {
    let doc = page("Command-Reference.md");
    let secs = sections(&doc);
    let table = section(&secs, "Exit codes").expect("an Exit codes section");
    let listed: BTreeSet<u32> = table
        .lines()
        .filter_map(|l| l.strip_prefix("| ")?.split(' ').next()?.parse().ok())
        .collect();
    let defined = defined_exit_codes();
    assert!(defined.len() > 2, "too few exit codes found: {defined:?}");
    assert_eq!(
        listed, defined,
        "docs/wiki/Command-Reference.md `## Exit codes` lists {listed:?}; the CLI defines {defined:?}"
    );
}

/// The numbers that follow `word` (and, optionally, `/JavaScript`) and a space in `line`.
fn numbers_after(line: &str, word: &str) -> Vec<u32> {
    let mut out = Vec::new();
    for (i, _) in line.match_indices(word) {
        let rest = &line[i + word.len()..];
        let rest = rest.strip_prefix("/JavaScript").unwrap_or(rest);
        let Some(rest) = rest.strip_prefix(' ') else {
            continue;
        };
        let d: String = rest.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(n) = d.parse() {
            out.push(n);
        }
    }
    out
}

/// The `<N>` of each parser tag `<prefix><N>-` (`ts-l86-0.1.0-dev`) in `text`.
fn tags(text: &str, prefix: &str) -> Vec<u32> {
    let mut out = Vec::new();
    for (i, _) in text.match_indices(prefix) {
        if text[..i]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        {
            continue;
        }
        let rest = &text[i + prefix.len()..];
        let d: String = rest.chars().take_while(char::is_ascii_digit).collect();
        if !d.is_empty() && rest[d.len()..].starts_with('-') {
            out.push(d.parse().unwrap());
        }
    }
    out
}

/// Pins: every lowering version the wiki states (the parser tags `ts-l<N>-`,
/// `py-l<N>-`, and "TypeScript N" / "Python N" on a line about lowering versions)
/// is the readers' `LOWERING_VERSION`.
#[test]
fn wiki_lowering_versions_are_the_readers() {
    let ts = drift_ts::lower::LOWERING_VERSION;
    let py = drift_py::lower::LOWERING_VERSION;
    let mut seen_ts = 0;
    let mut seen_py = 0;
    let mut wrong = Vec::new();
    let dir = repo().join("docs/wiki");
    let mut names: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .collect();
    names.sort();
    for p in names {
        let text = std::fs::read_to_string(&p).unwrap();
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        for (n, line) in text.lines().enumerate() {
            let mut check = |found: Vec<u32>, want: u32, lang: &str, seen: &mut usize| {
                for v in found {
                    *seen += 1;
                    if v != want {
                        wrong.push(format!(
                            "{name}:{}: {lang} {v}, the code is at {want}",
                            n + 1
                        ));
                    }
                }
            };
            check(tags(line, "ts-l"), ts, "TypeScript", &mut seen_ts);
            check(tags(line, "py-l"), py, "Python", &mut seen_py);
            if line.to_ascii_lowercase().contains("lowering version") {
                check(
                    numbers_after(line, "TypeScript"),
                    ts,
                    "TypeScript",
                    &mut seen_ts,
                );
                check(numbers_after(line, "Python"), py, "Python", &mut seen_py);
            }
        }
    }
    assert!(
        seen_ts > 0 && seen_py > 0,
        "the wiki states no lowering version"
    );
    assert!(
        wrong.is_empty(),
        "stale lowering versions:\n  {}",
        wrong.join("\n  ")
    );
}

/// Pins: the policy format version the Configuration Reference and Versioning and
/// Upgrades state ("above N in this build", "(reads up to N)") is
/// `drift_mine::policy::POLICY_VERSION`.
#[test]
fn wiki_policy_version_is_the_codes() {
    let want = drift_mine::policy::POLICY_VERSION;
    for name in ["Configuration-Reference.md", "Versioning-and-Upgrades.md"] {
        let text = page(name);
        let mut found = Vec::new();
        for pat in ["above ", "(reads up to "] {
            for (i, _) in text.match_indices(pat) {
                let rest = &text[i + pat.len()..];
                let d: String = rest.chars().take_while(char::is_ascii_digit).collect();
                let tail = &rest[d.len()..];
                let stated = if pat == "above " {
                    tail.starts_with(" in this build")
                } else {
                    tail.starts_with(')')
                };
                if stated && let Ok(n) = d.parse::<u32>() {
                    found.push(n);
                }
            }
        }
        assert!(!found.is_empty(), "{name} states no policy version");
        assert!(
            found.iter().all(|n| *n == want),
            "{name} states policy version {found:?}; the code writes up to {want}"
        );
    }
}

/// `READ_ONLY_TOOLS` as `crates/drift-cli/src/lookup.rs` declares it (the CLI is a
/// binary, so a test cannot import it).
fn read_only_tools() -> Vec<String> {
    let src = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lookup.rs"))
        .unwrap();
    let anchor = "pub const READ_ONLY_TOOLS: &[&str] = &[";
    let start = src.find(anchor).expect("READ_ONLY_TOOLS in lookup.rs") + anchor.len();
    let body = &src[start..];
    let body = &body[..body.find("];").expect("the end of READ_ONLY_TOOLS")];
    body.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect()
}

/// The backticked `drift_*` names in `text`.
fn tool_names(text: &str) -> Vec<String> {
    text.split('`')
        .skip(1)
        .step_by(2)
        .filter(|w| {
            w.starts_with("drift_") && w.chars().all(|c| c.is_ascii_lowercase() || c == '_')
        })
        .map(str::to_string)
        .collect()
}

/// The text after `anchor` in the first line that holds it, to the end of that sentence.
fn sentence_after<'a>(text: &'a str, line_has: &str, anchor: &str) -> &'a str {
    let line = text
        .lines()
        .find(|l| l.contains(line_has))
        .unwrap_or_else(|| panic!("no line with {line_has:?}"));
    let rest = &line[line.find(anchor).unwrap_or_else(|| panic!("no {anchor:?}")) + anchor.len()..];
    rest.find(". ").map_or(rest, |i| &rest[..i])
}

/// Pins: the MCP tools the Hooks Reference says the PreToolUse hook approves, and the
/// read-only tools the MCP Reference lists, are `READ_ONLY_TOOLS`, the list the hook and
/// `drift export claude-settings` use (checked against that command's real output).
#[test]
fn wiki_auto_approved_tools_are_read_only_tools() {
    let truth: BTreeSet<String> = read_only_tools().into_iter().collect();
    assert!(!truth.is_empty());
    let dir = tempfile::tempdir().unwrap();
    let out = Command::new(&*BIN)
        .arg("--root")
        .arg(dir.path())
        .args(["export", "claude-settings"])
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    let settings = String::from_utf8(out.stdout).unwrap();
    let exported: BTreeSet<String> = settings
        .split('"')
        .filter_map(|w| w.strip_prefix("mcp__drift__"))
        .map(str::to_string)
        .collect();
    assert_eq!(
        exported, truth,
        "READ_ONLY_TOOLS as parsed is not what the CLI uses"
    );

    let hooks = page("Hooks-Reference.md");
    let approved = tool_names(sentence_after(
        &hooks,
        "| `mcp__*drift*__drift_*` |",
        "without a prompt:",
    ));
    assert_eq!(
        approved.len(),
        truth.len(),
        "Hooks-Reference lists a tool twice or misses one: {approved:?}"
    );
    assert_eq!(
        approved.into_iter().collect::<BTreeSet<_>>(),
        truth,
        "docs/wiki/Hooks-Reference.md: the tools the hook approves"
    );

    let mcp = page("MCP-Reference.md");
    let read = tool_names(sentence_after(&mcp, " only read: ", " only read: "));
    assert_eq!(
        read.len(),
        truth.len(),
        "MCP-Reference lists a tool twice or misses one: {read:?}"
    );
    assert_eq!(
        read.into_iter().collect::<BTreeSet<_>>(),
        truth,
        "docs/wiki/MCP-Reference.md: the tools that only read"
    );
}
