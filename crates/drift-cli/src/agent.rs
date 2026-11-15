//! Claude Code hook handler: `drift hook claude <event>`.
//!
//! Contract (code.claude.com/docs/en/hooks): the event JSON arrives on stdin;
//! we always exit 0 and answer with JSON on stdout, so a crash is never read as
//! a block. Per-edit checks only advise. The end of the turn (`Stop`) is the one
//! place that blocks, and only for *new* violations of accepted conventions in
//! block mode, with a loop guard.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use drift_mine::check::Exemption;
use drift_mine::check::Violation;
use drift_mine::policy::{Convention, LOCK_FILE, Mode};
use drift_mine::report::{AgentAt, agent_message, agent_unsure_message, exempt_message, sanitize};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::derived::Derived;
use crate::project::{
    NewFileRules, Project, blocks, find_root, is_suggestion, link_under_drift, rule_line,
};

/// Most blocks per session before Drift steps aside and leaves findings for review.
pub const MAX_BLOCKS_PER_SESSION: u32 = 3;
/// Most rules injected before one new file is written.
const MAX_PRIMED: usize = 4;
/// Of those, most suggestion-tier rules: default-tier rules come first.
const MAX_PRIMED_SUGGESTIONS: usize = 2;

/// The rules to prime with, in tier order (default first, then suggestions, each
/// in the order given): at most [`MAX_PRIMED`] in all, of which at most
/// [`MAX_PRIMED_SUGGESTIONS`] suggestions. Returns the chosen items and how many were left out.
fn pick_primed<T>(mut items: Vec<(bool, T)>) -> (Vec<T>, usize) {
    // `false` (not a suggestion) sorts first; the sort is stable.
    items.sort_by_key(|(sugg, _)| *sugg);
    let total = items.len();
    let mut suggestions = 0;
    let mut out = Vec::new();
    for (sugg, item) in items {
        if out.len() == MAX_PRIMED {
            break;
        }
        if sugg {
            if suggestions == MAX_PRIMED_SUGGESTIONS {
                break;
            }
            suggestions += 1;
        }
        out.push(item);
    }
    let left = total - out.len();
    (out, left)
}

/// The lines before a list of rules for an agent: what `(suggestion)` and `(blocks)`
/// mean, and that a rule that advises needs no action where it does not fit. Only a
/// rule that blocks is offered the `drift-ignore` way out.
pub fn rules_note(rules: &[&Convention]) -> String {
    let mut out = String::new();
    if rules.iter().any(|c| is_suggestion(c)) {
        out.push_str("(suggestion) marks a weaker convention: advice only.\n");
    }
    if rules.iter().any(|c| blocks(c)) {
        out.push_str("(blocks) marks a rule whose new violation blocks the end of the turn; for an intentional exception, add `// drift-ignore <id>: <reason>` above the declaration.\n");
    }
    if rules.iter().any(|c| !blocks(c)) {
        out.push_str(if rules.iter().any(|c| blocks(c)) {
            "The others advise: follow them where they fit; where one does not fit this file, no action is needed.\n"
        } else {
            "These advise: follow them where they fit; where one does not fit this file, no action is needed.\n"
        });
    }
    out
}

/// Largest stdin payload read (tool inputs can be large).
const MAX_INPUT_BYTES: u64 = 16 * 1024 * 1024;

/// Per-session hook state, in `.drift/cache/sessions/<session_id>.json`.
///
/// The baseline is recorded once, when the session first starts, and never
/// recomputed: on `resume` and `compact` Claude Code fires SessionStart again
/// with the same session id, and the violations the agent introduced earlier
/// must stay "new".
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct SessionState {
    /// Violation keys that existed when the session started (not the agent's doing).
    baseline: BTreeSet<String>,
    /// False while no baseline has been recorded (a hook ran before SessionStart).
    /// State written before this field existed always had a baseline.
    #[serde(default = "yes")]
    has_baseline: bool,
    /// Findings already reported as advice this session.
    advised: BTreeSet<String>,
    /// Exempt members already named to the person (Stop's `systemMessage`). Kept apart
    /// from `advised`, which is what the agent was told: the person hears about each
    /// exemption the session adds even when PostToolUse told the agent first.
    #[serde(default)]
    told_person: BTreeSet<String>,
    /// Conventions whose rules were already injected before a new file was written, and
    /// practice recipes already given (`recipe:<id>`).
    primed: BTreeSet<String>,
    /// The practice map's recipes, computed when SessionStart scans (no later hook
    /// scans for them). Omitted when none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    recipes: Vec<HookRecipe>,
    blocks: u32,
    last_block: BTreeSet<String>,
    /// Files edited since the last Stop, recorded only while wiring rules are
    /// accepted: Stop checks wiring for these and nothing else.
    #[serde(default)]
    edited: BTreeSet<String>,
    /// Wiring advice from the last Stop, given to the agent with the next prompt
    /// (Stop itself never blocks for advice).
    #[serde(default)]
    pending: Option<String>,
    /// Keys of the violations reported as unsure when the baseline was recorded (their
    /// files depend on a file not parsed for lack of stack). A record only: they are
    /// not in `baseline` and are never folded in, so one that becomes certain blocks
    /// like any new violation (the loop guard steps aside on a repeat), and Stop says
    /// it was unsure at the start.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    unsure_at_start: BTreeSet<String>,
    /// Keys of `unsure_at_start` that have blocked once, with the BLAKE3 of the
    /// violation's own file when it blocked. While that file is byte-identical, the
    /// key blocks no more and does not count toward the loop guard (later Stops list
    /// it as advice); once the file changes it blocks like any new violation, and a
    /// Stop where the violation is gone drops the key.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    unsure_blocked: BTreeMap<String, String>,
    /// [`tree_stamp`] of the tree at the last Stop that had nothing to say: a Stop on the
    /// same tree (no edit since, by any tool, the shell included) says nothing again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    clean_stamp: Option<String>,
    /// Practice departures the code had when SessionStart scanned
    /// ([`drift_mine::practices::Departure::keys`]): not the agent's doing. `None` while
    /// no scan has recorded them (a hook ran before SessionStart, or state written
    /// before this field existed): PostToolUse then says nothing about practices,
    /// since it could not tell the agent's units from the ones already there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    practice_baseline: Option<BTreeSet<String>>,
    /// Practice departures PostToolUse told the agent about (the same keys): each is
    /// said once. Apart from `advised`, whose keys are violations of conventions.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    practice_advised: BTreeSet<String>,
    /// Security facts the code had when SessionStart scanned
    /// ([`drift_mine::introduced::security_keys`]: risky operations, entry points
    /// reaching one, client files reaching server-only code): not the agent's doing.
    /// `None` as `practice_baseline` is: PostToolUse then says nothing about them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    security_baseline: Option<BTreeSet<String>>,
    /// Security facts PostToolUse told the agent an edit introduced (the same keys):
    /// each is said once.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    security_advised: BTreeSet<String>,
    /// Keys an edited file's own facts showed as new and a full scan found nothing to
    /// say about (a risky operation in a file the inventory leaves out, an import that
    /// is no production edge of the package graph, by file and module:
    /// [`import_seen`]): the next edit of the file does not pay for the scan again.
    /// Never told to anyone.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    facts_seen: BTreeSet<String>,
    /// The production edges of the package graph when SessionStart scanned
    /// ([`drift_mine::introduced::edge_keys`]: which package depends on which, as
    /// `drift map` lists them). `None` as `practice_baseline` is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    edge_baseline: Option<BTreeSet<String>>,
    /// The package directories of that scan: what lets PostToolUse read, from the
    /// edited file's imports alone, which packages they land in.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    package_dirs: BTreeSet<String>,
    /// Files PostToolUse found entry points in that the SessionStart index does not
    /// list (a route written this session): the next edit of one scans the repository
    /// at once ([`scans_repository`]). Only ever a way to choose the first scan.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    entry_files: BTreeSet<String>,
    /// Package edges PostToolUse told the agent an edit made (the same keys as
    /// `edge_baseline`): each is said once.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    edge_advised: BTreeSet<String>,
    /// Keys of `practice_advised`, `security_advised` and `edge_advised` a Stop has
    /// looked at again ([`still_standing`]): the Stop after the agent is told something
    /// scans once to say what still stands, and the Stops after it do not.
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    stop_told: BTreeSet<String>,
}

fn yes() -> bool {
    true
}

impl SessionState {
    /// Forget what the conversation has seen (after `/clear`), keep what the code is.
    fn reset_context(&mut self) {
        self.pending = None;
        self.advised.clear();
        self.practice_advised.clear();
        self.security_advised.clear();
        self.edge_advised.clear();
        self.facts_seen.clear();
        self.stop_told.clear();
        self.primed.clear();
        self.blocks = 0;
        self.last_block.clear();
        self.unsure_blocked.clear();
    }
}

/// Written at SessionEnd(`clear`), read by the SessionStart(`clear`) that follows.
#[derive(Debug, Serialize, Deserialize)]
struct ClearHandoff {
    /// Seconds since the Unix epoch.
    at: u64,
    baseline: BTreeSet<String>,
    /// [`SessionState::unsure_at_start`].
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    unsure_at_start: BTreeSet<String>,
    /// [`SessionState::practice_baseline`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    practice_baseline: Option<BTreeSet<String>>,
    /// [`SessionState::security_baseline`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    security_baseline: Option<BTreeSet<String>>,
    /// [`SessionState::edge_baseline`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    edge_baseline: Option<BTreeSet<String>>,
    /// [`SessionState::package_dirs`].
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    package_dirs: BTreeSet<String>,
}

/// A handoff older than this is ignored (the next session is not the cleared one's successor).
const HANDOFF_MAX_AGE_SECS: u64 = 300;
/// Session state files untouched for this long are deleted at startup.
const SESSION_MAX_AGE_SECS: u64 = 30 * 24 * 3600;
/// A temp file older than this was left by a writer that died before renaming it.
const TMP_MAX_AGE_SECS: u64 = 3600;
const HANDOFF_FILE: &str = "clear-handoff.json";

fn key(v: &Violation) -> String {
    format!("{} {}#{}", v.id, v.path, v.symbol)
}

fn sessions_dir(root: &Path) -> PathBuf {
    root.join(".drift").join("cache").join("sessions")
}

fn session_path(root: &Path, session_id: &str) -> PathBuf {
    let safe: String = session_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    let name = if safe.is_empty() {
        "default".to_string()
    } else {
        safe
    };
    sessions_dir(root).join(format!("{name}.json"))
}

/// `None` when the state is missing or unreadable: callers fail open.
fn load_state(path: &Path) -> Option<SessionState> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
}

/// Best effort, atomic (temp file + rename): hooks for parallel tool calls can
/// run at the same time, and a reader must never see a torn file.
/// Never through a symbolic link under `.drift/`: a repository could point one
/// outside itself (see `project::cache_dir`).
fn write_json<T: Serialize>(path: &Path, value: &T) {
    if link_under_drift(path).is_some() {
        return;
    }
    let Some(dir) = path.parent() else { return };
    let _ = std::fs::create_dir_all(dir);
    // Session state stays in `.drift/cache/sessions` when DRIFT_CACHE_DIR moves the
    // fact cache elsewhere: keep it out of `git add -A` there too.
    if let Some(cache) = dir.parent() {
        crate::project::ignore_in_git(cache);
    }
    let Ok(b) = serde_json::to_vec(value) else {
        return;
    };
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let tmp = format!(".{name}.{}.tmp", std::process::id());
    let _ = drift_core::fsutil::write_atomic(path, &tmp, &b);
}

fn save_state(path: &Path, s: &SessionState) {
    write_json(path, s);
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Take (and remove) a recent `/clear` handoff, if any.
fn take_handoff(dir: &Path) -> Option<ClearHandoff> {
    let path = dir.join(HANDOFF_FILE);
    let h: Option<ClearHandoff> = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    if link_under_drift(&path).is_none() {
        let _ = std::fs::remove_file(&path);
    }
    let h = h?;
    (now_secs().saturating_sub(h.at) <= HANDOFF_MAX_AGE_SECS).then_some(h)
}

/// Delete session files nobody has touched for a month.
fn prune_sessions(dir: &Path) {
    if link_under_drift(dir).is_some() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let age = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map_or(0, |d| d.as_secs());
        let path = e.path();
        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("");
        // Old state files, and temp files left by a writer killed before its rename.
        let stale = match ext {
            "json" => age > SESSION_MAX_AGE_SECS,
            "tmp" => age > TMP_MAX_AGE_SECS,
            _ => false,
        };
        if stale {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Entry point. Returns the JSON to print (or `None` for no output).
pub fn handle(event: &str) -> Option<Value> {
    let mut buf = Vec::new();
    if std::io::stdin()
        .take(MAX_INPUT_BYTES)
        .read_to_end(&mut buf)
        .is_err()
    {
        return None;
    }
    let input: Value = serde_json::from_slice(&buf).unwrap_or(Value::Null);
    let started = std::time::Instant::now();
    let out = match handle_event(event, &input) {
        Ok(v) => v,
        // Fail open: tell the person, never block the agent because Drift broke.
        Err(e) => Some(
            json!({ "systemMessage": format!("drift: hook error, skipped ({})", sanitize(&format!("{e:#}"), 200)) }),
        ),
    };
    trace::write(event, started.elapsed(), out.is_some());
    out
}

/// The hook path log (PLAN-R14 D1): with `DRIFT_HOOK_TRACE=<file>` set, each hook
/// appends one JSON line with the event, the path it took (`single_file`,
/// `full_scan:<reason>`, `skipped:<reason>`, `none` when it scanned nothing), whether it
/// answered, and how long it took. Off by default; it changes no behaviour, and a file
/// that cannot be written is ignored. For the perf record and the daemon decision.
pub mod trace {
    use std::cell::RefCell;
    use std::time::Duration;

    pub const ENV: &str = "DRIFT_HOOK_TRACE";

    thread_local! {
        static PATH: RefCell<Option<String>> = const { RefCell::new(None) };
    }

    /// The path this hook took. The first call wins: the cheapest answer is the one
    /// the hook gave.
    pub fn took(path: &str) {
        PATH.with(|p| {
            let mut p = p.borrow_mut();
            if p.is_none() {
                *p = Some(path.to_string());
            }
        });
    }

    pub fn write(event: &str, took_time: Duration, answered: bool) {
        let Some(file) = std::env::var_os(ENV).filter(|f| !f.is_empty()) else {
            return;
        };
        let path = PATH
            .with(|p| p.borrow().clone())
            .unwrap_or_else(|| "none".to_string());
        let line = serde_json::json!({
            "event": event,
            "path": path,
            "answered": answered,
            "ms": took_time.as_millis() as u64,
        });
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(file)
        {
            use std::io::Write;
            let _ = writeln!(f, "{line}");
        }
    }
}

fn handle_event(event: &str, input: &Value) -> anyhow::Result<Option<Value>> {
    let cwd = input
        .get("cwd")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or(std::env::current_dir()?);
    // A relative tool path names a file from the session's directory, whichever
    // policy root answers for it.
    let input = &absolute_tool_path(input, &cwd);
    // A command that changes Drift's policy is a person's, in any repository: answered
    // before the policy is looked up, since `drift init` is how a repository gets one.
    if event == "PreToolUse"
        && input.get("tool_name").and_then(Value::as_str) == Some("Bash")
        && let Some(out) = deny_policy_change(input)
    {
        trace::took("none:policy_change");
        return Ok(Some(out));
    }
    // The policy nearest the edited file, else the one above the session's directory:
    // an agent started at a monorepo's root that edits `frontend/x.ts` is held to the
    // conventions that cover that file, wherever its `.drift/` is.
    let Some(root) = policy_root(input, &cwd) else {
        // No conventions in this project: Drift stays silent, but for the session brief,
        // read as `drift card` reads (nothing is written into the repository).
        if event == "SessionStart" {
            trace::took("full_scan:brief_without_policy");
            return Ok(brief_without_policy(&cwd));
        }
        trace::took("skipped:no_policy");
        return Ok(None);
    };
    let session = input
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or("default");
    let state_path = session_path(&root, session);
    // Before searches and Drift's own read-only tools: no project, no scan (this runs
    // before every one).
    if event == "PreToolUse" {
        match input.get("tool_name").and_then(Value::as_str) {
            Some("Grep" | "Glob") => return Ok(search_hint(input, &root, &cwd, &state_path)),
            Some(t) if crate::lookup::read_only_tool(t) => return Ok(Some(crate::lookup::allow())),
            _ => {}
        }
    }
    drift_mine::workspace::configure(&root);
    // Shell commands need no project: answer before loading it, since this runs
    // before every command the agent runs.
    if event == "PreToolUse" && input.get("tool_name").and_then(Value::as_str) == Some("Bash") {
        return Ok(bash_pre_tool_use(input, &root, &cwd));
    }
    // Before an edit of a file that exists, only the deny for Drift's own files has
    // anything to say: no policy, lock or verify state is read for it.
    if event == "PreToolUse"
        && let Some(out) = pre_tool_use_existing(input, &root)
    {
        return Ok(out);
    }
    let project = Project::open_for_agents(&root)?;

    match event {
        "SessionStart" => session_start(&project, input, &state_path),
        "SessionEnd" => {
            session_end(&project, input, &state_path);
            Ok(None)
        }
        "PreToolUse" => pre_tool_use(&project, input, &state_path),
        "PostToolUse" => post_tool_use(&project, input, &state_path),
        "Stop" => stop(&project, input, &state_path),
        "UserPromptSubmit" => Ok(user_prompt_submit(&state_path)),
        // Subagents get advice through PostToolUse; blocking them risks nested loops.
        _ => Ok(None),
    }
}

/// The directory holding the `.drift/conventions.yaml` that governs this event: the
/// nearest one above the tool's file (relative paths resolve against `cwd`), else the
/// nearest one above `cwd` ([`find_root`]).
pub(crate) fn policy_root(input: &Value, cwd: &Path) -> Option<PathBuf> {
    tool_path(input)
        .map(|p| {
            let p = PathBuf::from(p);
            if p.is_absolute() { p } else { cwd.join(p) }
        })
        .and_then(|p| p.parent().and_then(find_root))
        .or_else(|| find_root(cwd))
}

/// `input` with a relative `tool_input` file path made absolute against `cwd`.
fn absolute_tool_path(input: &Value, cwd: &Path) -> Value {
    let mut input = input.clone();
    if let Some(ti) = input.get_mut("tool_input").and_then(Value::as_object_mut) {
        for k in ["file_path", "notebook_path", "path"] {
            if let Some(Value::String(p)) = ti.get_mut(k)
                && Path::new(p.as_str()).is_relative()
            {
                *p = cwd.join(p.as_str()).to_string_lossy().into_owned();
            }
        }
    }
    input
}

fn tool_path(input: &Value) -> Option<String> {
    let ti = input.get("tool_input")?;
    ti.get("file_path")
        .or_else(|| ti.get("notebook_path"))
        .or_else(|| ti.get("path"))
        .and_then(Value::as_str)
        .map(String::from)
}

/// Record the baseline once per session. `resume` and `compact` (same session id)
/// keep the state as it is. `/clear` ends the session and starts a new one: the
/// code the cleared conversation wrote is still this working session's doing, so
/// its baseline carries over (through the SessionEnd handoff, or directly when the
/// id is reused), while advice, priming and the block counter start again because
/// the new conversation has not seen them. `startup` and `fork` with no state for
/// the id record a fresh baseline from the current tree.
fn session_start(p: &Project, input: &Value, state_path: &Path) -> anyhow::Result<Option<Value>> {
    let source = input
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("startup");
    let dir = sessions_dir(&p.root);
    let mut note = None;
    // The facts, when it scans: left for the exit to free (see [`edit_facts`]).
    let mut scanned = std::mem::ManuallyDrop::new(None::<drift_core::RepoFacts>);
    // Without a session id every session shares one state file: a new one starts fresh.
    let anonymous = input.get("session_id").and_then(Value::as_str).is_none();
    let existing = load_state(state_path).filter(|_| !(anonymous && source == "startup"));
    match existing {
        Some(mut state) if state.has_baseline => {
            if source == "clear" {
                state.reset_context();
                save_state(state_path, &state);
                // Not needed: do not leave it for another session to pick up.
                let _ = take_handoff(&dir);
            }
        }
        pending => {
            if source == "startup" {
                prune_sessions(&dir);
            }
            // A hook that ran before SessionStart may have left advice or priming.
            let mut state = pending.unwrap_or_default();
            let inherited = if source == "clear" {
                take_handoff(&dir)
            } else {
                None
            };
            state.baseline = match inherited {
                Some(h) => {
                    state.unsure_at_start = h.unsure_at_start;
                    state.practice_baseline = h.practice_baseline;
                    state.security_baseline = h.security_baseline;
                    state.edge_baseline = h.edge_baseline;
                    state.package_dirs = h.package_dirs;
                    h.baseline
                }
                None => {
                    let facts: &drift_core::RepoFacts = scanned.insert(p.scan(false)?);
                    // The inventory and the conventions check beside the practice map:
                    // none of the three reads what another finds.
                    let kept = derived(p, facts);
                    let ((security, report), practices) = crate::card::beside(
                        || (security_keys(p, facts, kept.as_ref()), p.check(facts, None)),
                        || practice_report(p, facts, kept.as_ref()),
                    );
                    state.recipes = hook_recipes(facts, &practices);
                    state.practice_baseline = Some(
                        drift_mine::practices::departures(&practices, None)
                            .iter()
                            .flat_map(|d| d.keys())
                            .collect(),
                    );
                    state.security_baseline = Some(security);
                    state.edge_baseline = Some(drift_mine::introduced::edge_keys(
                        &drift_mine::map::package_graph(facts),
                    ));
                    state.package_dirs = facts.files.iter().map(|f| f.package.clone()).collect();
                    if let Some(n) = unchecked_note(&report) {
                        note = Some(n);
                    }
                    if matches!(source, "resume" | "compact" | "clear") {
                        // The session existed (a `clear` without a handoff: SessionEnd
                        // missing or too long ago), so its state was lost: the agent's
                        // own changes must not become baseline.
                        let touched = changed_since_head(&p.root);
                        state.unsure_at_start = report.unsure().map(key).collect();
                        let (b, n) = fallback_baseline(&report, touched.as_ref());
                        note = Some(match note {
                            Some(u) => format!("{n}\n{u}"),
                            None => n,
                        });
                        b
                    } else {
                        // Unsure violations are never baselined: whether they were there
                        // cannot be told, so once certain they count like new ones.
                        state.unsure_at_start = report.unsure().map(key).collect();
                        report
                            .new_violations()
                            .map(key)
                            .chain(report.exempt.iter().map(Exemption::key))
                            .collect()
                    }
                }
            };
            state.has_baseline = true;
            save_state(state_path, &state);
        }
    }
    // The index of the search hints and the brief: from this scan, else the last one
    // (a resumed session), else from a scan made for it.
    let built = |facts: &drift_core::RepoFacts| {
        let index = crate::lookup::HintIndex::build(facts);
        write_json(&dir.join(crate::lookup::INDEX_FILE), &index);
        index
    };
    let index = match &*scanned {
        Some(facts) => Some(built(facts)),
        None => crate::lookup::HintIndex::load(&dir).or_else(|| {
            p.scan(false)
                .ok()
                .map(|facts| built(&std::mem::ManuallyDrop::new(facts)))
        }),
    };
    // One brief, one cap (PLAN-R14 C2), both parts behind `agents.brief`: the practices
    // brief for the package of the session's directory first (once; its recipes are
    // recorded in `primed`), then the structure part in what is left of the cap.
    let on = brief_on(&p.root);
    let brief = if on {
        let cwd = input.get("cwd").and_then(Value::as_str).map(PathBuf::from);
        let rel = cwd
            .and_then(|c| p.rel(&c.to_string_lossy()))
            .unwrap_or_default();
        let mut state = load_state(state_path).unwrap_or_default();
        let b = session_brief(&mut state, &rel);
        if b.is_some() {
            save_state(state_path, &state);
        }
        b.map(|b| b.trim_end().to_string())
    } else {
        None
    };
    let used = brief.as_ref().map_or(0, |b| b.len() + 1);
    let structure = index
        .filter(|_| on)
        .and_then(|i| i.brief(crate::lookup::BRIEF_MAX_BYTES.saturating_sub(used)));
    // The file the brief names is not named again by a search hint this session.
    if let Some((_, named)) = &structure
        && let Some(mut state) = load_state(state_path)
        && state.primed.insert(format!("hint:{named}"))
    {
        save_state(state_path, &state);
    }
    let accepted = p.accepted().count();
    let verify = verify_hint(p);
    // One message: the practices brief, then the structure brief in what is left of the
    // cap, then the count line and the verify hint.
    let parts: Vec<String> = brief
        .into_iter()
        .chain(structure.map(|(text, _)| text))
        .chain((accepted > 0).then(|| session_start_context(p)))
        .chain(verify)
        .collect();
    if parts.is_empty() {
        return Ok(note.map(|n| json!({ "systemMessage": n })));
    }
    let context = parts.join("\n");
    let mut out = json!({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    });
    if let Some(n) = note {
        out["systemMessage"] = json!(n);
    }
    Ok(Some(out))
}

/// `agents.brief` in `.drift/config.yaml` (on unless `off`; an unreadable config leaves it on).
fn brief_on(root: &Path) -> bool {
    drift_mine::policy::DriftConfig::load(root).map_or(true, |c| c.agents.brief)
}

/// The session brief for a repository with no `.drift/conventions.yaml` (PLAN-R14 C2):
/// its git work tree above `cwd` (never the home directory), scanned read-only as `drift
/// card` scans (the fact cache only where `DRIFT_CACHE_DIR` points). Writes nothing.
fn brief_without_policy(cwd: &Path) -> Option<Value> {
    let root = cwd
        .ancestors()
        .find(|d| d.join(".git").exists())?
        .to_path_buf();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if home.is_some_and(|h| h == root) || !brief_on(&root) {
        return None;
    }
    let opts = crate::scan::ScanOptions {
        cache_dir: std::env::var_os("DRIFT_CACHE_DIR").map(PathBuf::from),
        threads: 0,
    };
    let facts = crate::scan::scan(&root, &opts).ok()?.0;
    let (brief, _) =
        crate::lookup::HintIndex::build(&facts).brief(crate::lookup::BRIEF_MAX_BYTES)?;
    Some(json!({
        "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": brief }
    }))
}

/// With `agents.verify: on` (experimental), what SessionStart adds when accepted
/// suggestions are hidden from agents until verified: that it may verify them, and which.
fn verify_hint(p: &Project) -> Option<String> {
    let n = p.unverified.len();
    if n == 0 {
        return None;
    }
    let mut ids: Vec<String> = p
        .unverified
        .iter()
        .take(5)
        .map(|id| sanitize(id, 16))
        .collect();
    if n > 5 {
        ids.push(format!("{} more", n - 5));
    }
    Some(format!(
        "Drift (experimental): {n} accepted suggestion(s) are hidden from you until verified ({}). You may call the MCP tool drift_verify_card with one id to verify it; this is optional.",
        ids.join(", ")
    ))
}

/// What SessionStart tells the agent: how many accepted conventions block at the end
/// of a turn (their mode as checked: a small role or a wiring rule advises whatever the
/// policy says) and how many only advise. With none blocking it never says more about
/// blocking than "0 block".
fn session_start_context(p: &Project) -> String {
    let accepted = p.accepted().count();
    let blocking = p
        .accepted()
        .filter(|c| drift_mine::check::effective_mode(c) == "block")
        .count();
    let advise = accepted - blocking;
    let head = if blocking == 0 {
        format!(
            "Drift: this repo's {accepted} accepted conventions advise only (0 block at end of turn)."
        )
    } else {
        format!(
            "Drift: {blocking} of this repo's {accepted} accepted conventions block at end of turn (a new violation stops the turn from ending), {advise} advise."
        )
    };
    format!(
        "{head} Before creating a file, run `drift example <path>` to see which existing file to copy. Run drift with DRIFT_AGENT=1 set: your runs are then an agent's, on a terminal too."
    )
}

/// The baseline to use when a session's state is lost: the current violations,
/// except of a language with any file changed since HEAD, or untracked (a source
/// file, or the config that decides how its modules resolve), since such an edit can
/// change any other file's verdict: then none of that language. Without git, every
/// current violation. Unsure violations are never baselined. Also the message
/// telling the person.
fn fallback_baseline(
    report: &drift_mine::check::CheckReport,
    touched: Option<&BTreeSet<String>>,
) -> (BTreeSet<String>, String) {
    let tainted = touched.map(touched_languages).unwrap_or_default();
    let baseline: BTreeSet<String> = report
        .new_violations()
        .filter(|v| !tainted.contains(&is_python_side(&v.path)))
        .map(key)
        // Exempt members of a tainted language are left out like its violations, so the
        // person is told about them as new.
        .chain(
            report
                .exempt
                .iter()
                .filter(|e| !tainted.contains(&is_python_side(&e.path)))
                .map(Exemption::key),
        )
        .collect();
    let left_out: Vec<&str> = [(false, "JavaScript/TypeScript"), (true, "Python")]
        .into_iter()
        .filter(|(py, _)| tainted.contains(py))
        .map(|(_, name)| name)
        .collect();
    let violations = baseline
        .iter()
        .filter(|k| !k.starts_with("exempt "))
        .count();
    let note = format!(
        "drift: this session's state was missing; {} current violation(s) were taken as its baseline{}. Run `drift check` to see them.",
        violations,
        if left_out.is_empty() {
            String::new()
        } else {
            format!(
                ", none of them {}: a file of that language changed since HEAD or is untracked (any such file counts, even a `.json` data file for JS/TS), and such an edit can change any file's verdict, so all of its violations count",
                left_out.join(" or ")
            )
        }
    );
    (baseline, note)
}

/// Whether `path` is Python's (a module or a Python manifest) rather than JS/TS's.
fn is_python_side(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let ext = name.rsplit_once('.').map_or("", |(_, e)| e);
    drift_core::ingest::PYTHON_EXTENSIONS.contains(&ext)
        || matches!(
            name,
            "pyproject.toml" | "setup.cfg" | "setup.py" | "requirements.txt"
        )
}

/// The languages (`true` for Python) with a file among `touched` that can change
/// verdicts: a source file, or module-resolution config. For JS/TS any `.json` counts
/// (`package.json`, a tsconfig and whatever its `extends` reaches); for Python,
/// `pyproject.toml`, `setup.cfg` and `setup.py` (`__init__.py` is a source file).
fn touched_languages(touched: &BTreeSet<String>) -> BTreeSet<bool> {
    touched
        .iter()
        .filter_map(|p| {
            let name = p.rsplit('/').next().unwrap_or(p);
            let ext = name.rsplit_once('.').map_or("", |(_, e)| e);
            if drift_core::ingest::PYTHON_EXTENSIONS.contains(&ext)
                || matches!(name, "pyproject.toml" | "setup.cfg" | "setup.py")
            {
                Some(true)
            } else if drift_core::ingest::SOURCE_EXTENSIONS.contains(&ext)
                || matches!(ext, "json" | "jsonc")
            {
                Some(false)
            } else {
                None
            }
        })
        .collect()
}

/// On `/clear`, hand the baseline to the session that replaces this one.
fn session_end(p: &Project, input: &Value, state_path: &Path) {
    if input.get("reason").and_then(Value::as_str) != Some("clear") {
        return;
    }
    if let Some(mut state) = load_state(state_path).filter(|s| s.has_baseline) {
        let h = ClearHandoff {
            at: now_secs(),
            baseline: state.baseline.clone(),
            unsure_at_start: state.unsure_at_start.clone(),
            practice_baseline: state.practice_baseline.clone(),
            security_baseline: state.security_baseline.clone(),
            edge_baseline: state.edge_baseline.clone(),
            package_dirs: state.package_dirs.clone(),
        };
        write_json(&sessions_dir(&p.root).join(HANDOFF_FILE), &h);
        // The MCP server outlives `/clear` with the old session id: what it reads as
        // already given must be what the new conversation has seen, which is nothing.
        state.reset_context();
        save_state(state_path, &state);
    }
}

/// The Claude Code session an MCP server was started for: `CLAUDE_CODE_SESSION_ID`,
/// which Claude Code sets for the servers it starts and which is the `session_id` its
/// hooks receive. `None` elsewhere (another client, a shell).
pub fn mcp_session() -> Option<String> {
    std::env::var("CLAUDE_CODE_SESSION_ID")
        .ok()
        .filter(|s| !s.trim().is_empty())
}

/// Conventions whose rules the agent of `session` was already given: primed before it
/// wrote a new file, or listed by `drift_rules_for`. Empty when the session's hooks
/// have recorded no state.
pub fn given_rules(root: &Path, session: &str) -> BTreeSet<String> {
    load_state(&session_path(root, session))
        .map(|s| s.primed)
        .unwrap_or_default()
}

/// Record `ids` as given to the agent of `session` (so the next prime, or the next
/// `drift_rules_for`, does not repeat them), in the state its hooks keep. Never creates
/// that state: without hooks there is no prime to share it with, and a state written
/// here before SessionStart would have no baseline.
pub fn note_given(root: &Path, session: &str, ids: &[String]) {
    let path = session_path(root, session);
    let Some(mut state) = load_state(&path).filter(|s| s.has_baseline) else {
        return;
    };
    let before = state.primed.len();
    state.primed.extend(ids.iter().cloned());
    if state.primed.len() != before {
        save_state(&path, &state);
    }
}

/// PreToolUse for a file tool, answered without the project: `Some(deny)` for Drift's
/// own files, `Some(None)` for a file that exists (priming is for new files only) or a
/// path outside the repository, `None` when the project is needed (a new file).
fn pre_tool_use_existing(input: &Value, root: &Path) -> Option<Option<Value>> {
    let Some(path) = tool_path(input) else {
        return Some(None);
    };
    let root = root.canonicalize().ok()?;
    let Some(rel) = crate::project::rel_in(&root, &path) else {
        return Some(None);
    };
    if rel.starts_with(".drift/") || rel == LOCK_FILE {
        return Some(Some(deny_drift_file(&rel)));
    }
    root.join(&rel).exists().then_some(None)
}

fn deny_drift_file(rel: &str) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": format!(
                "{rel} is Drift's policy or state (conventions, lock, fact cache, sessions) and is changed by Drift and people only (`drift review`). Fix the code instead, or add `// drift-ignore <id>: <reason>` above the declaration."
            ),
        }
    })
}

/// Before a Grep or Glob that hunts for how a concern is handled, where Drift has entry
/// points: one line naming `drift card <file>`, once per file per session. Reads the
/// SessionStart index and the session state only; never blocks the search.
fn search_hint(input: &Value, root: &Path, cwd: &Path, state_path: &Path) -> Option<Value> {
    let index = crate::lookup::HintIndex::load(&sessions_dir(root))?;
    let (line, target) = crate::lookup::hint(&index, input, root, cwd)?;
    let mut state = load_state(state_path).unwrap_or_default();
    // Said once per file per session, beside the rules primed (PLAN-R14 C3).
    if !state.primed.insert(format!("hint:{target}")) {
        return None;
    }
    save_state(state_path, &state);
    Some(json!({
        "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": line }
    }))
}

fn pre_tool_use(p: &Project, input: &Value, state_path: &Path) -> anyhow::Result<Option<Value>> {
    let Some(path) = tool_path(input) else {
        return Ok(None);
    };
    let Some(rel) = p.rel(&path) else {
        return Ok(None);
    };
    if rel.starts_with(".drift/") || rel == LOCK_FILE {
        return Ok(Some(deny_drift_file(&rel)));
    }
    // Before a new file is written, tell the agent the rules for its role, once per role.
    let is_new = !p.root.join(&rel).exists();
    // Rules are about what Drift reads: a new `.md` or `.json` hears nothing (PLAN-R14 C3).
    if !is_new || !crate::scan::read_by_drift(&rel) {
        return Ok(None);
    }
    let mut state = load_state(state_path).unwrap_or_default();
    // Write carries the whole new file: rules are chosen by what it declares.
    let content = input
        .get("tool_input")
        .and_then(|t| t.get("content"))
        .and_then(Value::as_str);
    let fresh = |c: &&Convention| !state.primed.contains(&c.id);
    let shown_rel = sanitize(&rel, 160);
    let mut text = String::new();
    let mut shown = Vec::new();
    // (condition, convention): the condition is set when the content is unknown.
    let lines: Vec<(Option<String>, &Convention)> = match p.rules_for_new_file(&rel, content, true)
    {
        NewFileRules::Matched(convs) => convs.into_iter().map(|c| (None, c)).collect(),
        NewFileRules::Grouped(groups) => groups
            .into_iter()
            .flat_map(|(when, convs)| {
                let when = when.unwrap_or_else(|| "any file".to_string());
                convs.into_iter().map(move |c| (Some(when.clone()), c))
            })
            .collect(),
    };
    let grouped = lines.iter().any(|(w, _)| w.is_some());
    let lines: Vec<_> = lines.into_iter().filter(|(_, c)| fresh(c)).collect();
    // The recipe of the new file's kind, from the session's state: no scan here.
    let practice = new_file_recipe(&mut state, &rel);
    if lines.is_empty() {
        let Some(line) = practice else {
            return Ok(None);
        };
        save_state(state_path, &state);
        return Ok(Some(json!({
            "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": format!("{line}\n") }
        })));
    }
    // In a workspace the file is named with its package (`x.ts in package frontend`);
    // the openings stay as the Studio reads them.
    let header = {
        let shown_rel = match p.package_label(&rel) {
            Some(pkg) => format!("{shown_rel} in package {}", sanitize(&pkg, 120)),
            None => shown_rel.clone(),
        };
        if grouped {
            format!(
                "drift: conventions for new files at {shown_rel}, by what the file contains (N/M: members of the rule's role that follow it):\n"
            )
        } else {
            format!(
                "drift: conventions for files like {shown_rel} (N/M: members of the rule's role that follow it):\n"
            )
        }
    };
    text.push_str(&header);
    let (picked, left) = pick_primed(
        lines
            .into_iter()
            .map(|(when, c)| (is_suggestion(c), (when, c)))
            .collect(),
    );
    text.push_str(&rules_note(
        &picked.iter().map(|(_, c)| *c).collect::<Vec<_>>(),
    ));
    for (when, c) in picked {
        let prefix = when.map(|w| format!("{w}: ")).unwrap_or_default();
        text.push_str(&format!("- {prefix}{}\n", rule_line(c)));
        shown.push(c.id.clone());
    }
    if left > 0 {
        text.push_str(&format!("+{left} more: run `drift example {shown_rel}`\n"));
    }
    if let Some(line) = practice {
        text.push_str(&format!("{line}\n"));
    }
    state.primed.extend(shown);
    save_state(state_path, &state);
    Ok(Some(json!({
        "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": text }
    })))
}

/// One recipe of the practice map as the hooks keep it in the session's state
/// (computed at SessionStart from the facts it scans; no hook scans for it later).
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
struct HookRecipe {
    /// The recipe id (`E-…`): what dedupe keys on.
    id: String,
    /// The package ("" the root).
    package: String,
    /// The agent's line: known primary variants only, each with `path:line` to copy.
    text: String,
    /// File stems of the package's entry points of the recipe's kind (`route`, `page`):
    /// a new file with one of them is of that kind.
    stems: Vec<String>,
    /// Where files of any name are entry points of the recipe's kind, as `dir/*.ext`
    /// (`app/api/v2/*.py`: a directory of FastAPI routers, each named for what it
    /// serves): a new file there is of that kind whatever its stem. See
    /// [`entry_dirs`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    dirs: Vec<String>,
    /// What the preview concerns add for a new file of the kind (the package's logger,
    /// config read and data access, where its tests are; each marked `(preview)`):
    /// said with the recipe before such a file is written, not in the session's brief,
    /// whose room is the primary lines'. Empty when nothing is known.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    preview: String,
}

/// Stems kept per recipe.
const RECIPE_STEMS: usize = 8;

/// Directories kept per recipe.
const RECIPE_DIRS: usize = 64;

/// The fewest entry-point files that make a directory one of entry points
/// ([`entry_dirs`]): one `route.ts` beside its helpers does not.
const ENTRY_DIR_FILES: usize = 2;

/// `dir/*.ext` for the path `rel` (`*.ext` at the root); `None` without an extension.
fn dir_pattern(rel: &str) -> Option<String> {
    let (dir, name) = rel.rsplit_once('/').unwrap_or(("", rel));
    let (_, ext) = name.rsplit_once('.')?;
    Some(if dir.is_empty() {
        format!("*.{ext}")
    } else {
        format!("{dir}/*.{ext}")
    })
}

/// The directories of `package` whose files are entry points of `kind`, as
/// [`dir_pattern`]s: at least [`ENTRY_DIR_FILES`] of the directory's files of an
/// extension hold one, and they are most of its files of that extension (tests and
/// `__init__` aside). Sorted; at most [`RECIPE_DIRS`].
fn entry_dirs(facts: &drift_core::RepoFacts, package: &str, kind: &str) -> Vec<String> {
    // pattern -> (files with an entry point of the kind, files)
    let mut seen: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for f in facts.files.iter().filter(|f| {
        f.package == package
            && !drift_mine::roles::is_test_path(&f.path)
            && !f.path.ends_with("__init__.py")
    }) {
        let Some(pattern) = dir_pattern(&f.path) else {
            continue;
        };
        let n = seen.entry(pattern).or_default();
        n.1 += 1;
        if f.listed_entry_points().iter().any(|e| e.kind == kind) {
            n.0 += 1;
        }
    }
    seen.into_iter()
        .filter(|(_, (entry, all))| *entry >= ENTRY_DIR_FILES && entry * 2 > *all)
        .map(|(pattern, _)| pattern)
        .take(RECIPE_DIRS)
        .collect()
}

/// The recipes agents may be told (lead decision, round 13): the report's recipes with
/// a known primary variant, each with the stems of the files of its kind.
fn hook_recipes(
    facts: &drift_core::RepoFacts,
    r: &drift_mine::practices::PracticesReport,
) -> Vec<HookRecipe> {
    r.recipes
        .iter()
        .filter_map(|rc| {
            let text = drift_mine::practices::agent_recipe(rc)?;
            let mut stems: Vec<String> = facts
                .files
                .iter()
                .filter(|f| {
                    f.package == rc.package
                        && f.listed_entry_points().iter().any(|e| e.kind == rc.role)
                })
                .filter_map(|f| {
                    f.path
                        .rsplit('/')
                        .next()?
                        .split('.')
                        .next()
                        .map(str::to_string)
                })
                .collect::<BTreeSet<String>>()
                .into_iter()
                .collect();
            stems.truncate(RECIPE_STEMS);
            Some(HookRecipe {
                id: rc.id.clone(),
                package: rc.package.clone(),
                text,
                stems,
                dirs: entry_dirs(facts, &rc.package, &rc.role),
                preview: drift_mine::practices::agent_recipe_preview(rc).unwrap_or_default(),
            })
        })
        .collect()
}

/// The deepest recipe package `rel` is in ("" for the root).
fn recipe_package<'a>(recipes: &'a [HookRecipe], rel: &str) -> &'a str {
    recipes
        .iter()
        .map(|r| r.package.as_str())
        .filter(|p| p.is_empty() || rel.starts_with(&format!("{p}/")))
        .max_by_key(|p| p.len())
        .unwrap_or_default()
}

/// `recipe:<id>` in the session's `primed`: the recipe was given.
fn recipe_key(id: &str) -> String {
    format!("recipe:{id}")
}

/// The SessionStart brief (at most `AGENT_CHARS`): the recipes of the package of the
/// session's directory `cwd_rel`, each with a file to copy, marked as given. `None`
/// when nothing is known there.
fn session_brief(state: &mut SessionState, cwd_rel: &str) -> Option<String> {
    let pkg = recipe_package(&state.recipes, &format!("{cwd_rel}/")).to_string();
    let mut out = format!(
        "drift: practices in {} (facts, not rules; each names a file to copy):\n",
        sanitize(if pkg.is_empty() { "." } else { &pkg }, 120)
    );
    let head = out.len();
    let mut given = Vec::new();
    for r in state.recipes.iter().filter(|r| r.package == pkg) {
        if out.len() + r.text.len() + 3 > drift_mine::practices::AGENT_CHARS {
            break;
        }
        out.push_str(&format!("- {}\n", r.text));
        given.push(recipe_key(&r.id));
    }
    if out.len() == head {
        return None;
    }
    state.primed.extend(given);
    Some(out)
}

/// The PreToolUse hint for a new file `rel` (lead decision, round 13): the recipe of its
/// kind in its package, once per session. A file is of a recipe's kind when it is named
/// as the package's entry-point files are (`route.ts`) or is written where files of any
/// name are entry points (`app/api/v2/*.py`). Silent for a test file, a file of no
/// recipe's kind (docs, styles, config), a recipe already given, or where nothing is
/// known.
fn new_file_recipe(state: &mut SessionState, rel: &str) -> Option<String> {
    if drift_mine::roles::is_test_path(rel) {
        return None;
    }
    let pkg = recipe_package(&state.recipes, rel);
    let stem = rel.rsplit('/').next()?.split('.').next()?;
    let pattern = dir_pattern(rel).filter(|_| stem != "__init__");
    let of_kind = |r: &&HookRecipe| {
        r.package == pkg
            && (r.stems.iter().any(|s| s == stem)
                || pattern.as_ref().is_some_and(|p| r.dirs.contains(p)))
    };
    let r = state.recipes.iter().find(of_kind)?;
    let key = recipe_key(&r.id);
    if state.primed.contains(&key) {
        return None;
    }
    let mut line = format!(
        "drift: practices for {} (facts, not rules): {}",
        sanitize(rel, 160),
        r.text
    );
    if !r.preview.is_empty() {
        line.push_str("; ");
        line.push_str(&r.preview);
    }
    state.primed.insert(key);
    Some(line)
}

/// The practice map with every unit listed, as the hooks read it: SessionStart for the
/// recipes and the departures the code starts with, PostToolUse for an edited file's.
///
/// Read back from the results kept for these facts (`kept`, [`derived`]) when an
/// earlier hook, `drift check` or `drift card` built it from the same facts.
fn practice_report(
    p: &Project,
    facts: &drift_core::RepoFacts,
    kept: Option<&Derived>,
) -> drift_mine::practices::PracticesReport {
    crate::practices::report_units_kept(&p.root, facts, kept)
}

/// Where the results derived from `facts` are kept between hooks
/// ([`crate::derived`]): in the fact cache's directory, when there is one.
fn derived(p: &Project, facts: &drift_core::RepoFacts) -> Option<Derived> {
    Derived::of(crate::project::cache_dir(&p.root, false), facts)
}

/// What an agent is told about `rel`'s departures, one line each in `lines`
/// ([`drift_mine::practices::Departure::line`]); `shown` is `rel` made safe to print.
pub(crate) fn departures_message(shown: &str, lines: &[String]) -> String {
    format!(
        "drift: {shown} departs from the practices around it (facts, not rules; nothing is blocked):\n{}\nIf that is intended, carry on and say so; `drift card {shown}` has the rest.\n",
        lines.join("\n")
    )
}

/// What an agent is told the edit of `rel` introduced, one line each in `lines`
/// ([`drift_mine::introduced::introduced`]); `shown` is `rel` made safe to print.
fn introduced_message(shown: &str, lines: &[String]) -> String {
    format!(
        "drift: {shown} now does what it did not at session start (facts, not rules; nothing is blocked):\n{}\nIf that is intended, carry on and say so; `drift security {shown}` has the rest.\n",
        lines.join("\n")
    )
}

/// Package edges of one message before "and N more".
const MAX_EDGES: usize = 3;

/// What an agent is told when the edit of `rel` made its package depend on another it
/// did not depend on when the session started ([`drift_mine::introduced::new_edges`]):
/// one sentence an edge, with the line of the import when `line_of` finds it in the
/// file as written and, when the other package already depends on this one, that the
/// two now depend on each other. `shown` is the file made safe to print.
fn edges_message(
    shown: &str,
    edges: &[drift_mine::introduced::NewEdge],
    line_of: &dyn Fn(&drift_mine::introduced::NewEdge) -> Option<u32>,
) -> String {
    use drift_mine::introduced::{module_name, package_name};
    use std::fmt::Write as _;
    let mut out = String::new();
    for e in edges.iter().take(MAX_EDGES) {
        let (from, to) = (package_name(&e.from), package_name(&e.to));
        let module = module_name(&e.module);
        let at = match line_of(e) {
            Some(n) => format!("the import of {module} is at line {n}"),
            None => format!("the import is of {module}"),
        };
        let back = match e.back {
            0 => String::new(),
            n => format!(
                "; {to} already depends on {from} ({n} of its files import{} it), so the two now depend on each other",
                if n == 1 { "s" } else { "" }
            ),
        };
        let _ = writeln!(
            out,
            "drift: {shown} makes {from} depend on {to}, which it did not depend on at session start (facts, not rules; nothing is blocked): {at}{back}."
        );
    }
    if edges.len() > MAX_EDGES {
        let rest: Vec<String> = edges[MAX_EDGES..]
            .iter()
            .map(|e| package_name(&e.to))
            .collect();
        let _ = writeln!(out, "and {} more: {}.", rest.len(), rest.join(", "));
    }
    out.push_str("If that is intended, carry on and say so; `drift map` lists what each package depends on.\n");
    out
}

/// The security inventory as `drift security` builds it, with the deployment boundary
/// the repository states: what SessionStart records and PostToolUse compares.
fn security_inventory(
    p: &Project,
    facts: &drift_core::RepoFacts,
) -> drift_mine::security::Inventory {
    drift_mine::security::inventory_with(facts, drift_mine::security::Boundaries::load(&p.root))
}

/// The keys of [`security_inventory`] ([`drift_mine::introduced::security_keys`]): what
/// SessionStart records and Stop compares. Read back from the results kept for these
/// facts and this boundary when an earlier hook read the inventory of the same facts.
fn security_keys(
    p: &Project,
    facts: &drift_core::RepoFacts,
    kept: Option<&Derived>,
) -> BTreeSet<String> {
    use drift_mine::introduced::security_keys as keys;
    let boundaries = drift_mine::security::Boundaries::load(&p.root);
    match serde_json::to_vec(&boundaries) {
        Ok(more) => crate::derived::get_or(kept, crate::derived::SECURITY_KEYS, &more, || {
            keys(&drift_mine::security::inventory_with(facts, boundaries))
        }),
        Err(_) => keys(&drift_mine::security::inventory_with(facts, boundaries)),
    }
}

/// What the PostToolUse hook says about the file just written beyond the conventions
/// check, from facts Drift has whatever is accepted. Advice only: nothing here blocks,
/// and each fact is said once per session.
///
/// - Practices: the file's entry points do a concern another way than the entry points
///   around them ([`drift_mine::practices::departures`]), with a unit to copy.
/// - Security: the file now has a risky operation, an entry point reaching one, or
///   client code reaching server-only code, that the code did not have when the
///   session started ([`drift_mine::introduced::introduced`]).
/// - Packages: an import of the file makes its package depend on a package it did not
///   depend on when the session started ([`drift_mine::introduced::new_edges`]).
///
/// Silent for a test file, for what the session started with, and while no SessionStart
/// scan has recorded what the code started with. `own` gives the one-file scan of `rel`
/// (made once, shared with the conventions check): the repository is scanned only when
/// it shows something to look up (an entry point, or a risky operation, client leak or
/// import of another package not yet known), so an edit of any other file costs no more
/// than that one-file scan. When `own`'s scan was of the whole repository already (its
/// flag), those are the facts read: the repository is not scanned twice.
fn edit_facts<'f>(
    p: &Project,
    rel: &str,
    state_path: &Path,
    own: &dyn Fn() -> Option<(&'f drift_core::RepoFacts, bool)>,
) -> Option<String> {
    if drift_mine::roles::is_test_path(rel) {
        return None;
    }
    let state = load_state(state_path)?;
    if state.practice_baseline.is_none()
        && state.security_baseline.is_none()
        && state.edge_baseline.is_none()
    {
        return None;
    }
    let (own, whole) = own()?;
    let file = own.files.iter().find(|f| f.path == rel)?;
    let has_entries = !file.listed_entry_points().is_empty();
    let practices = has_entries && state.practice_baseline.is_some();
    // The file's own risky operations and leaks the session has not met.
    let own_keys: Vec<String> = match &state.security_baseline {
        Some(base) => drift_mine::introduced::file_keys(file)
            .into_iter()
            .filter(|k| {
                !base.contains(k)
                    && !state.security_advised.contains(k)
                    && !state.facts_seen.contains(k)
            })
            .collect(),
        None => Vec::new(),
    };
    let security = state.security_baseline.is_some() && (has_entries || !own_keys.is_empty());
    // The packages the file's imports land in that its own did not depend on, as far
    // as the file's facts tell: the graph of the whole repository decides. An import
    // already looked up is not again; another of the same packages is.
    let own_edges: Vec<(String, String)> = match &state.edge_baseline {
        Some(base) => {
            drift_mine::introduced::candidate_imports(file, &own.packages, &state.package_dirs)
                .into_iter()
                .filter(|(k, module)| {
                    !base.contains(k)
                        && !state.edge_advised.contains(k)
                        && !state.facts_seen.contains(&import_seen(rel, module))
                })
                .collect()
        }
        None => Vec::new(),
    };
    if !(practices || security || !own_edges.is_empty()) {
        return None;
    }
    // The repository's facts: the scan already made, when it was of the repository.
    // A scan made here is left for the exit to free: a hook is a process that ends
    // with its answer, and freeing the facts of a large repository takes tens of
    // milliseconds nobody waits on otherwise.
    let scanned;
    let facts: &drift_core::RepoFacts = if whole {
        own
    } else {
        scanned = std::mem::ManuallyDrop::new(p.scan(false).ok()?);
        &scanned
    };
    // The inventory beside the practice map: neither reads what the other finds.
    // Both read every listing of the facts: one copy for the two.
    let listed = crate::card::Listed::of(facts);
    let (inventory, (kept, departures)) = crate::card::beside(
        || security.then(|| security_inventory(p, listed.get())),
        || {
            // The map is kept for the Stop of this turn, and read back when this
            // edit left every fact as an earlier hook found it.
            let kept = practices.then(|| derived(p, facts)).flatten();
            let departures = practices.then(|| {
                drift_mine::practices::departures(
                    &crate::practices::report_units_kept_of(&p.root, facts, &listed, kept.as_ref()),
                    Some(rel),
                )
            });
            (kept, departures)
        },
    );
    // So are the keys of this inventory.
    if let (Some(kept), Some(inv)) = (&kept, &inventory)
        && let Ok(more) = serde_json::to_vec(&inv.boundaries)
    {
        kept.put(
            crate::derived::SECURITY_KEYS,
            &more,
            &drift_mine::introduced::security_keys(inv),
        );
    }
    let targets = (!own_edges.is_empty())
        .then(|| drift_mine::map::file_targets(facts, rel))
        .flatten();
    // Read again after the scans: hooks for parallel edits save the same state.
    let mut state = load_state(state_path)?;
    let shown = sanitize(rel, 160);
    let mut text = String::new();
    let mut changed = false;
    if let (Some(found), Some(baseline)) = (departures, state.practice_baseline.clone()) {
        let mut lines = Vec::new();
        for d in &found {
            let keys = d.keys();
            if keys
                .iter()
                .all(|k| baseline.contains(k) || state.practice_advised.contains(k))
            {
                continue;
            }
            state.practice_advised.extend(keys);
            lines.push(format!("- {}", d.line()));
        }
        if !lines.is_empty() {
            changed = true;
            text.push_str(&departures_message(&shown, &lines));
        }
    }
    if let (Some(inv), Some(baseline)) = (inventory, state.security_baseline.clone()) {
        let found = drift_mine::introduced::introduced(&inv, rel, &|k: &str| {
            baseline.contains(k) || state.security_advised.contains(k)
        });
        for k in own_keys {
            if !found.keys.contains(&k) {
                changed |= state.facts_seen.insert(k);
            }
        }
        if !found.lines.is_empty() {
            changed = true;
            state.security_advised.extend(found.keys);
            text.push_str(&introduced_message(&shown, &found.lines));
        }
    }
    if let (Some((from, targets)), Some(baseline)) = (targets, state.edge_baseline.clone()) {
        let found = drift_mine::introduced::new_edges(
            &from,
            &targets,
            &drift_mine::map::package_graph(facts),
            &|k: &str| baseline.contains(k) || state.edge_advised.contains(k),
        );
        if !found.is_empty() {
            changed = true;
            state.edge_advised.extend(
                found
                    .iter()
                    .map(|e| drift_mine::introduced::edge_key(&e.from, &e.to)),
            );
            let written = std::fs::read_to_string(p.root.join(rel)).unwrap_or_default();
            let line_of = |e: &drift_mine::introduced::NewEdge| {
                let name = facts.packages.iter().find(|k| k.path == e.to);
                drift_mine::introduced::import_line(
                    &written,
                    rel,
                    &e.module,
                    name.map(|k| k.name.as_str()),
                )
            };
            text.push_str(&edges_message(&shown, &found, &line_of));
        }
    }
    // A file with entry points the SessionStart index does not list: its next edit
    // scans the repository at once.
    if has_entries && !hinted(p, rel) {
        changed |= state.entry_files.insert(rel.to_string());
    }
    // What the file's imports pointed at and the graph does not hold: not looked up
    // again for that file and module.
    for (k, module) in own_edges {
        if !state.edge_advised.contains(&k) {
            changed |= state.facts_seen.insert(import_seen(rel, &module));
        }
    }
    if changed {
        save_state(state_path, &state);
    }
    (!text.is_empty()).then_some(text)
}

/// The key of [`SessionState::facts_seen`] for the import of `module` by `rel`, which
/// may make a package edge the graph does not hold.
fn import_seen(rel: &str, module: &str) -> String {
    format!("import|{rel}|{module}")
}

/// Whether the SessionStart index lists `rel` among the files with entry points.
fn hinted(p: &Project, rel: &str) -> bool {
    crate::lookup::HintIndex::load(&sessions_dir(&p.root))
        .is_some_and(|i| i.entries.iter().any(|e| e.path == rel))
}

/// Whether the PostToolUse of `rel` is sure to read the whole repository if the file
/// still has the entry points it had when last looked at: [`edit_facts`] builds the
/// practice map or the inventory for every file with entry points once a session has
/// its baselines. Then the one-file scan first would only be thrown away. This
/// chooses which scan is made first and nothing else: a one-file scan gives a file
/// the facts a full scan gives it, so the answer is the same either way. For a file
/// that has since lost its entry points the full scan is more than was needed.
fn scans_repository(p: &Project, rel: &str, state_path: &Path) -> bool {
    if drift_mine::roles::is_test_path(rel) {
        return false;
    }
    let Some(state) = load_state(state_path) else {
        return false;
    };
    if state.practice_baseline.is_none() && state.security_baseline.is_none() {
        return false;
    }
    state.entry_files.contains(rel) || hinted(p, rel)
}

/// A PostToolUse answer: what the conventions check says, then what the practice map,
/// the security inventory and the package graph say ([`edit_facts`]), either or both.
fn post_tool_answer(conventions: Option<String>, practices: Option<String>) -> Option<Value> {
    let text = match (conventions, practices) {
        (None, None) => return None,
        (Some(c), None) => c,
        (None, Some(p)) => p,
        (Some(mut c), Some(p)) => {
            if !c.ends_with('\n') {
                c.push('\n');
            }
            c.push_str(&p);
            c
        }
    };
    Some(json!({
        "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": text }
    }))
}

fn post_tool_use(p: &Project, input: &Value, state_path: &Path) -> anyhow::Result<Option<Value>> {
    let Some(path) = tool_path(input) else {
        return Ok(None);
    };
    let Some(rel) = p.rel(&path) else {
        return Ok(None);
    };
    // One scan for both, made when the first of them needs it: what the file's own
    // facts say is worth looking up in the whole repository, and the conventions check.
    // Of the file alone, unless the repository is sure to be scanned for it anyway
    // ([`scans_repository`]): then of the repository at once, and never twice. The
    // facts are left for the exit to free (see [`edit_facts`]).
    let own = std::mem::ManuallyDrop::new(std::cell::OnceCell::new());
    let scan = || {
        own.get_or_init(|| {
            if scans_repository(p, &rel, state_path) {
                trace::took("full_scan:entry_points");
                p.scan(false).map(|facts| (facts, true))
            } else {
                p.scan_for_file(&rel)
            }
        })
    };
    let practices = edit_facts(p, &rel, state_path, &|| {
        scan().as_ref().ok().map(|(facts, whole)| (facts, *whole))
    });
    if p.accepted().next().is_none() {
        return Ok(post_tool_answer(None, practices));
    }
    // Wiring rules are judged at Stop, on the files edited this turn.
    if p.accepted().any(|c| c.rule.is_wiring()) {
        let mut state = load_state(state_path).unwrap_or_default();
        if state.edited.insert(rel.clone()) {
            save_state(state_path, &state);
        }
    }
    scan();
    let (facts, _) = std::mem::ManuallyDrop::into_inner(own)
        .into_inner()
        .expect("scanned above")?;
    let facts = std::mem::ManuallyDrop::new(facts);
    let only: BTreeSet<String> = [rel.clone()].into();
    let report = p.check(&facts, Some(&only));
    let shown_rel = sanitize(&rel, 160);
    // Not parsed: say so, to the agent and the person. Silence would read as clean.
    if report.unchecked.contains(&rel) {
        return Ok(Some(json!({
            "systemMessage": format!("drift: {shown_rel} was not checked: {NO_STACK}. Run `drift check` with more memory to check it."),
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": format!("drift: {shown_rel} was NOT checked against the accepted conventions ({NO_STACK}). Do not assume it follows them; `drift example {shown_rel}` names a file to copy."),
            }
        })));
    }
    // Read again after the scan, not reused from above: hooks for parallel edits save
    // the same state, and what they wrote meanwhile must not be lost.
    let mut state = load_state(state_path).unwrap_or_default();
    // A one-file scan has none of the registries: wiring findings here would be noise,
    // certain or unsure.
    let unseen = |v: &&Violation| {
        v.wire.is_none() && !state.baseline.contains(&key(v)) && !state.advised.contains(&key(v))
    };
    let fresh: Vec<&Violation> = report.new_violations().filter(unseen).collect();
    let unsure: Vec<&Violation> = report.unsure().filter(unseen).collect();
    let exempt = fresh_exempt(&report, &state, &state.advised);
    if fresh.is_empty() && unsure.is_empty() && exempt.is_empty() {
        return Ok(post_tool_answer(None, practices));
    }
    for v in fresh.iter().chain(&unsure) {
        state.advised.insert(key(v));
    }
    for e in &exempt {
        state.advised.insert(e.key());
    }
    save_state(state_path, &state);
    let mut text = agent_message(&fresh, AgentAt::Edit);
    // In a workspace, which package's conventions these are (after the advice, so the
    // message opens as it always has).
    if let Some(pkg) = p.package_label(&rel).filter(|_| !fresh.is_empty()) {
        text.push_str(&format!(
            "({shown_rel} is in package {}: these are its conventions.)\n",
            sanitize(&pkg, 120)
        ));
    }
    if !unsure.is_empty() {
        let u = drift_mine::unchecked::Unchecked::of(&facts);
        let on: Vec<&str> = u
            .dependents
            .get(&rel)
            .into_iter()
            .flatten()
            .map(String::as_str)
            .collect();
        text.push_str(&agent_unsure_message(&unsure, &on));
    }
    text.push_str(&exempt_message(&exempt));
    Ok(post_tool_answer(Some(text), practices))
}

/// Wiring advice queued by the last Stop, for the agent at the start of its next turn.
fn user_prompt_submit(state_path: &Path) -> Option<Value> {
    let mut state = load_state(state_path)?;
    let text = state.pending.take()?;
    save_state(state_path, &state);
    Some(json!({
        "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": text }
    }))
}

/// Whether a file at `rel` could be a member of the wiring rule `c`'s role, or
/// is a file the rule reads (its registry, a mirrored key file). Conservative: a
/// role directory with abstracted segments matches any file in the package.
fn wiring_relevant(c: &drift_mine::policy::Convention, rel: &str) -> bool {
    use drift_mine::mine::Rule;
    match &c.rule {
        Rule::RegisteredIn { path, .. } if !path.is_empty() && path == rel => return true,
        Rule::MirrorsKeys { from, to } => return from == rel || to == rel,
        _ => {}
    }
    let r = &c.role;
    let in_pkg = if r.package.is_empty() {
        Some(rel)
    } else {
        rel.strip_prefix(r.package.as_str())
            .and_then(|x| x.strip_prefix('/'))
    };
    let Some(rest) = in_pkg else { return false };
    r.dir == "." || r.dir.contains(['*', '[', '(']) || rest.starts_with(&format!("{}/", r.dir))
}

/// Why a file was not checked, in one clause.
const NO_STACK: &str = "no thread stack large enough to parse it could be reserved, an address-space or memory limit on this run";

/// The person-facing note for files not checked, if any.
fn unchecked_note(report: &drift_mine::check::CheckReport) -> Option<String> {
    if report.unchecked.is_empty() {
        return None;
    }
    let shown: Vec<String> = report
        .unchecked
        .iter()
        .take(3)
        .map(|p| sanitize(p, 160))
        .collect();
    Some(format!(
        "drift: {} file(s) not checked ({}{}): no thread stack large enough to parse them could be reserved (an address-space or memory limit). Their violations are unknown; run `drift check` with more memory.",
        report.unchecked.len(),
        shown.join(", "),
        if report.unchecked.len() > 3 {
            ", ..."
        } else {
            ""
        }
    ))
}

/// Files, or pairs of packages, named in one part of the Stop line.
const MAX_STANDING: usize = 3;

/// Up to [`MAX_STANDING`] of `names` (sorted, safe to print), then `, ...`.
fn some_of(names: &BTreeSet<String>) -> String {
    let mut shown: Vec<String> = names.iter().take(MAX_STANDING).cloned().collect();
    if names.len() > MAX_STANDING {
        shown.push("...".to_string());
    }
    shown.join(", ")
}

/// Whether PostToolUse told the agent a fact ([`edit_facts`]) no Stop has looked at
/// again.
fn told_since_last_stop(state: &SessionState) -> bool {
    state
        .practice_advised
        .iter()
        .chain(&state.security_advised)
        .chain(&state.edge_advised)
        .any(|k| !state.stop_told.contains(k))
}

/// What the person is told when a turn ends: of the facts PostToolUse told the agent
/// about its edits ([`edit_facts`]), those the code still has, in one line (how many,
/// and where). The agent was told each as it made it; the person sees none of that, and
/// this is the line that says what was left as it is. Never a block.
///
/// Said at the Stop that follows the telling, when something told since the Stop
/// before still stands; it then counts everything told in the conversation that still
/// stands. `facts` is the scan the conventions' Stop made, when it made one.
fn still_standing(
    p: &Project,
    state_path: &Path,
    facts: Option<drift_core::RepoFacts>,
) -> Option<String> {
    use drift_mine::introduced as intro;
    if !told_since_last_stop(&load_state(state_path)?) {
        return None;
    }
    // Left for the exit to free (see [`edit_facts`]).
    let facts = std::mem::ManuallyDrop::new(match facts {
        Some(f) => f,
        None => p.scan(false).ok()?,
    });
    // Read again after the scan, as PostToolUse does.
    let mut state = load_state(state_path)?;
    let mut parts = Vec::new();
    let (mut total, mut fresh) = (0, false);
    // What the code has now, each read only when something of its kind was told: the
    // inventory beside the practice map, neither reading what the other finds.
    let kept = derived(p, &facts);
    let (security_now, practices_now) = crate::card::beside(
        || (!state.security_advised.is_empty()).then(|| security_keys(p, &facts, kept.as_ref())),
        || {
            (!state.practice_advised.is_empty()).then(|| {
                drift_mine::practices::departures(&practice_report(p, &facts, kept.as_ref()), None)
                    .iter()
                    .flat_map(|d| d.keys())
                    .collect::<BTreeSet<String>>()
            })
        },
    );
    if let Some(now) = practices_now {
        let base = state.practice_baseline.clone().unwrap_or_default();
        let standing: Vec<&String> = state
            .practice_advised
            .iter()
            .filter(|k| now.contains(*k) && !base.contains(*k))
            .collect();
        if !standing.is_empty() {
            // `practice|<concern>|<path>|<symbol>|<variant>`.
            let files: BTreeSet<String> = standing
                .iter()
                .filter_map(|k| k.split('|').nth(2))
                .map(|f| sanitize(f, 160))
                .collect();
            total += standing.len();
            fresh |= standing.iter().any(|k| !state.stop_told.contains(*k));
            parts.push(format!(
                "{} practice departure(s) in {}",
                standing.len(),
                some_of(&files)
            ));
        }
    }
    if let Some(now) = security_now {
        let base = state.security_baseline.clone().unwrap_or_default();
        // A guard taken off is told with the reach it uncovers, which the code may
        // have started with: that part is not the session's.
        let told = |k: &str| state.security_advised.contains(k) && !base.contains(k);
        let (n, files) = intro::still_there(&now, &told);
        let files: BTreeSet<String> = files.iter().map(|f| sanitize(f, 160)).collect();
        if n > 0 {
            total += n;
            fresh |= now.iter().any(|k| told(k) && !state.stop_told.contains(k));
            parts.push(format!(
                "{n} security fact(s) new since session start in {}",
                some_of(&files)
            ));
        }
    }
    if !state.edge_advised.is_empty() {
        let now = intro::edge_keys(&drift_mine::map::package_graph(&facts));
        let standing: Vec<&String> = state
            .edge_advised
            .iter()
            .filter(|k| now.contains(*k))
            .collect();
        if !standing.is_empty() {
            let dir = |d: &str| {
                if d.is_empty() {
                    ".".to_string()
                } else {
                    sanitize(d, 120)
                }
            };
            let pairs: BTreeSet<String> = standing
                .iter()
                .filter_map(|k| intro::edge_ends(k))
                .map(|(from, to)| format!("{} -> {}", dir(from), dir(to)))
                .collect();
            total += standing.len();
            fresh |= standing.iter().any(|k| !state.stop_told.contains(*k));
            parts.push(format!(
                "{} new package edge(s) ({})",
                standing.len(),
                some_of(&pairs)
            ));
        }
    }
    // Looked at, standing or not: the next Stop does not scan for them again.
    let told: Vec<String> = state
        .practice_advised
        .iter()
        .chain(&state.security_advised)
        .chain(&state.edge_advised)
        .cloned()
        .collect();
    state.stop_told.extend(told);
    save_state(state_path, &state);
    fresh.then(|| {
        format!(
            "drift: {total} fact(s) the agent was told about this session's edits still stand (facts, not rules; nothing is blocked): {}. `drift card <file>`, `drift security <file>` and `drift map` show them.",
            parts.join("; ")
        )
    })
}

/// Stop: what the accepted conventions say ([`stop_conventions`]), then, when the turn
/// is not sent back to the agent, the line about what it was told and left
/// ([`still_standing`]), after any other message to the person.
fn stop(p: &Project, input: &Value, state_path: &Path) -> anyhow::Result<Option<Value>> {
    // Looked at first, so that the trace names the scan this Stop pays for.
    let told = load_state(state_path).is_some_and(|s| told_since_last_stop(&s));
    if told {
        trace::took("full_scan:told_facts");
    }
    // The facts, when it scans: left for the exit to free (see [`edit_facts`]).
    let mut scanned = std::mem::ManuallyDrop::new(None);
    let out = stop_conventions(p, input, state_path, &mut scanned)?;
    // A blocked turn goes on: what stands is said when it ends.
    if !told || out.as_ref().is_some_and(|o| o.get("decision").is_some()) {
        return Ok(out);
    }
    let scanned = std::mem::ManuallyDrop::into_inner(scanned);
    let Some(line) = still_standing(p, state_path, scanned) else {
        return Ok(out);
    };
    let mut out = out.unwrap_or_else(|| json!({}));
    let message = match out.get("systemMessage").and_then(Value::as_str) {
        Some(m) => format!("{}\n{line}", m.trim_end()),
        None => line,
    };
    out["systemMessage"] = json!(message);
    Ok(Some(out))
}

/// The conventions' part of Stop. `scanned` receives the facts when it scans.
fn stop_conventions(
    p: &Project,
    input: &Value,
    state_path: &Path,
    scanned: &mut Option<drift_core::RepoFacts>,
) -> anyhow::Result<Option<Value>> {
    // Wiring rules (experimental) need the whole repository, so they are judged here,
    // at the end of a turn, and only for the files that turn edited: a turn without
    // a relevant edit costs no scan.
    let has_block = p.accepted().any(|c| c.mode == Mode::Block);
    let wiring: Vec<_> = p.accepted().filter(|c| c.rule.is_wiring()).collect();
    let mut edited = if wiring.is_empty() {
        BTreeSet::new()
    } else {
        load_state(state_path).map(|s| s.edited).unwrap_or_default()
    };
    let had_edits = !edited.is_empty();
    edited.retain(|f| wiring.iter().any(|c| wiring_relevant(c, f)));
    if !has_block && edited.is_empty() {
        if had_edits && let Some(mut state) = load_state(state_path) {
            state.edited.clear();
            save_state(state_path, &state);
        }
        trace::took("skipped:nothing_blocks");
        return Ok(None);
    }
    // Blocking rules and nothing changed since a Stop that had nothing to say: nothing
    // to say again. The stamp is of every file the scan could read, so an edit made from
    // the shell counts as one. Wiring rules are judged on edits, so they always check.
    let stamp = (has_block && wiring.is_empty())
        .then(|| tree_stamp(&p.root))
        .flatten();
    if let Some(st) = &stamp
        && load_state(state_path)
            .is_some_and(|s| s.has_baseline && s.clean_stamp.as_ref() == Some(st))
    {
        trace::took("skipped:no_change");
        return Ok(None);
    }
    trace::took(if has_block {
        "full_scan:block_mode_stop"
    } else {
        "full_scan:wiring_edits"
    });
    let facts: &drift_core::RepoFacts = scanned.insert(p.scan(false)?);
    // Without blocking rules only the edited files matter.
    let only = (!has_block).then(|| edited.clone());
    let report = p.check(facts, only.as_ref());
    let mut state = load_state(state_path).unwrap_or_default();
    state.edited.clear();
    if state.has_baseline {
        let out = stop_with_state(&p.root, &report, input, state_path, state, &edited);
        let out = with_note(out, unchecked_note(&report));
        // Silent: remember the tree it was silent on (the state as Stop saved it).
        if out.is_none()
            && let Some(st) = stamp
            && let Some(mut s) = load_state(state_path)
        {
            s.clean_stamp = Some(st);
            save_state(state_path, &s);
        }
        return Ok(out);
    }
    // No baseline: SessionStart never ran, or the state is unreadable or was
    // deleted mid-session (`rm -rf .drift/cache`). Fail open for code the agent
    // has not touched: violations in files unchanged since HEAD become the
    // baseline, those in changed or untracked files still count. Without git,
    // everything there now becomes the baseline. Either way the person is told.
    let touched = changed_since_head(&p.root);
    let (baseline, note) = fallback_baseline(&report, touched.as_ref());
    state.baseline = baseline;
    state.has_baseline = true;
    state.unsure_at_start = report.unsure().map(key).collect();
    let out = stop_with_state(&p.root, &report, input, state_path, state, &edited);
    let out = with_note(out, Some(note)).expect("a note");
    Ok(with_note(Some(out), unchecked_note(&report)))
}

/// A digest of the tree as a scan sees it: the path and `stat` stamp (size, mtime,
/// ctime, inode) of every file the walk visits that is not ignored, whatever its kind
/// (sources, configs, manifests, `.drift/` policy and lock), and the paths skipped.
/// Building it is a walk with `stat`s: no file is read or parsed.
/// Two equal stamps mean no file a check reads has changed. `None` when the walk fails.
pub(crate) fn tree_stamp(root: &Path) -> Option<String> {
    let w = drift_core::ingest::walk(root, 0, &|_: &str| true).ok()?;
    let mut h = blake3::Hasher::new();
    for c in w.sources.iter().chain(&w.config).chain(&w.python.sources) {
        let s = c.stamp;
        h.update(c.rel_path.as_bytes());
        for n in [s.size, s.mtime_ns, s.ctime_ns, s.ino] {
            h.update(&n.to_le_bytes());
        }
        h.update(&[0]);
    }
    for k in w.skipped.iter().chain(&w.python.skipped) {
        h.update(k.path.as_bytes());
        h.update(&[1]);
    }
    // The policy whatever its size (the walk lists files of at most 1 MiB).
    for f in [
        drift_mine::policy::CONVENTIONS_FILE,
        LOCK_FILE,
        ".drift/config.yaml",
        ".drift/verify-cache.json",
    ] {
        let s = std::fs::metadata(root.join(f))
            .map(|m| drift_core::ingest::FileStamp::of(&m))
            .unwrap_or_default();
        for n in [s.size, s.mtime_ns, s.ctime_ns, s.ino] {
            h.update(&n.to_le_bytes());
        }
    }
    Some(h.finalize().to_hex().to_string())
}

/// `out` with `note` prepended to its `systemMessage` (an output of its own when
/// there is none).
fn with_note(out: Option<Value>, note: Option<String>) -> Option<Value> {
    let Some(note) = note else { return out };
    let mut out = out.unwrap_or_else(|| json!({}));
    let message = match out.get("systemMessage").and_then(Value::as_str) {
        Some(m) => format!("{note}\n{m}"),
        None => note,
    };
    out["systemMessage"] = json!(message);
    Some(out)
}

/// Repo-relative paths changed since `HEAD` or untracked, or `None` without git.
fn changed_since_head(root: &Path) -> Option<BTreeSet<String>> {
    let git = |args: &[&str]| -> Option<Vec<u8>> {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        out.status.success().then_some(out.stdout)
    };
    let mut paths = BTreeSet::new();
    for out in [
        git(&[
            "diff",
            "--name-only",
            "--relative",
            "--no-renames",
            "-z",
            "HEAD",
        ])?,
        git(&["ls-files", "--others", "--exclude-standard", "-z"])?,
    ] {
        paths.extend(
            out.split(|b| *b == 0)
                .filter(|p| !p.is_empty())
                .map(|p| String::from_utf8_lossy(p).into_owned()),
        );
    }
    Some(paths)
}

fn stop_with_state(
    root: &Path,
    report: &drift_mine::check::CheckReport,
    input: &Value,
    state_path: &Path,
    mut state: SessionState,
    edited: &BTreeSet<String>,
) -> Option<Value> {
    // A violation unsure at the start blocks once; after that it is advice only, and
    // neither keeps the turn from ending nor uses up the loop guard's budget, while
    // its file is the one it blocked in. Gone, it is forgotten.
    let candidates: Vec<&Violation> = report
        .blocking()
        .filter(|v| !state.baseline.contains(&key(v)))
        .collect();
    let now: BTreeSet<String> = candidates.iter().map(|v| key(v)).collect();
    state.unsure_blocked.retain(|k, _| now.contains(k));
    let mut hashes: BTreeMap<String, String> = BTreeMap::new();
    let (repeat, blocking): (Vec<&Violation>, Vec<&Violation>) =
        candidates.into_iter().partition(|v| {
            state.unsure_blocked.get(&key(v)).is_some_and(|then| {
                let h = hashes
                    .entry(v.path.clone())
                    .or_insert_with(|| file_hash(root, &v.path));
                !then.is_empty() && h == then
            })
        });
    let advice = (!repeat.is_empty()).then(|| {
        format!(
            "drift: {} violation(s) that were unsure at session start are still there ({}); they may predate the session, and drift blocked on them once. Run `drift check` to see them.",
            repeat.len(),
            repeat
                .iter()
                .take(3)
                .map(|v| format!("{} {}", sanitize(&v.id, 16), sanitize(&v.path, 160)))
                .collect::<Vec<_>>()
                .join(", ")
        )
    });
    let out = stop_blocking(root, report, blocking, input, state_path, state, edited);
    with_note(out, advice)
}

/// BLAKE3 of the file at `rel`, or empty when it cannot be read (never matches).
fn file_hash(root: &Path, rel: &str) -> String {
    std::fs::read(root.join(rel))
        .map(|b| drift_core::ingest::hash_bytes(&b))
        .unwrap_or_default()
}

fn stop_blocking(
    root: &Path,
    report: &drift_mine::check::CheckReport,
    blocking: Vec<&Violation>,
    input: &Value,
    state_path: &Path,
    mut state: SessionState,
    edited: &BTreeSet<String>,
) -> Option<Value> {
    let current: BTreeSet<String> = blocking.iter().map(|v| key(v)).collect();
    // Wiring advice: something the agent added this turn is not registered where
    // all its siblings are. Advice only (it never blocks or continues the turn),
    // said once per finding: to the person now, to the agent with the next prompt.
    // Also when this Stop blocks on another rule: the edits are cleared now, so it
    // would never be said otherwise.
    let unwired: Vec<&Violation> = report
        .new_violations()
        .filter(|v| v.wire.is_some() && edited.contains(&v.path))
        .filter(|v| !state.baseline.contains(&key(v)) && !state.advised.contains(&key(v)))
        .collect();
    let advice = (!unwired.is_empty()).then(|| {
        format!(
            "drift: code added in the last turn may not be wired up yet (advice; ignore it if that is intentional).\n{}",
            agent_message(&unwired, AgentAt::Edit)
        )
    });
    for v in &unwired {
        state.advised.insert(key(v));
    }
    if advice.is_some() {
        state.pending.clone_from(&advice);
    }
    // Members the agent's code added that a convention is not about: told once, to the
    // person, so a wrong exemption is reviewable. Never a reason to block.
    let exempt = fresh_exempt(report, &state, &state.told_person);
    let note = exempt_message(&exempt);
    for e in &exempt {
        state.told_person.insert(e.key());
    }
    let with_note = |mut out: Value| {
        if !note.is_empty() {
            let m = match out.get("systemMessage").and_then(Value::as_str) {
                Some(m) => format!("{m}\n{}", note.trim_end()),
                None => note.trim_end().to_string(),
            };
            out["systemMessage"] = json!(m);
        }
        out
    };
    if current.is_empty() {
        state.last_block.clear();
        save_state(state_path, &state);
        return match advice {
            Some(text) => Some(with_note(json!({ "systemMessage": text }))),
            None => (!note.is_empty()).then(|| with_note(json!({}))),
        };
    }
    let stop_hook_active = input
        .get("stop_hook_active")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let not_shrinking = !state.last_block.is_empty() && current.len() >= state.last_block.len();
    let guard = state.blocks >= MAX_BLOCKS_PER_SESSION
        || current == state.last_block
        || (stop_hook_active && not_shrinking);
    if guard {
        // Step aside: the person decides; `drift check` (and CI, where set up) still fails.
        state.last_block = current.clone();
        save_state(state_path, &state);
        let ids: Vec<String> = blocking
            .iter()
            .map(|v| sanitize(&v.id, 16))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let why = if state.blocks >= MAX_BLOCKS_PER_SESSION {
            format!("it already blocked {MAX_BLOCKS_PER_SESSION} times this session")
        } else {
            "no progress since its last block".to_string()
        };
        let mut message = format!(
            "drift: {} unresolved violation(s) of {} left for review: drift stopped blocking the end of the turn ({why}). They are in block mode: `drift check` still fails on them, and so do Drift's pre-commit hook and GitHub Action where they are set up.",
            blocking.len(),
            ids.join(", ")
        );
        if let Some(a) = &advice {
            message = format!("{message}\n{a}");
        }
        return Some(with_note(json!({ "systemMessage": message })));
    }
    state.blocks += 1;
    state.last_block = current;
    let were_unsure: Vec<(String, String)> = blocking
        .iter()
        .filter(|v| state.unsure_at_start.contains(&key(v)))
        .map(|v| (key(v), file_hash(root, &v.path)))
        .collect();
    let were_unsure_n = were_unsure.len();
    state.unsure_blocked.extend(were_unsure);
    save_state(state_path, &state);
    let mut out =
        json!({ "decision": "block", "reason": agent_message(&blocking, AgentAt::EndOfTurn) });
    // Beside the block, to the person: which were unsure at session start (#32), then
    // the wiring advice (#38); the exemption note follows (#45).
    let mut notes: Vec<String> = Vec::new();
    if were_unsure_n > 0 {
        notes.push(format!(
            "drift: {were_unsure_n} of these were unsure at session start (their files read a file that could not be parsed then), so they may predate the session; drift blocks on them once, and lists them as advice after that while their files stay as they are."
        ));
    }
    if let Some(a) = advice {
        notes.push(a);
    }
    if !notes.is_empty() {
        out["systemMessage"] = json!(notes.join("\n"));
    }
    Some(with_note(out))
}

/// Exempt members not there when the session started and not yet in `told` (what the
/// agent, or the person, has already been told).
fn fresh_exempt<'r>(
    report: &'r drift_mine::check::CheckReport,
    state: &SessionState,
    told: &BTreeSet<String>,
) -> Vec<&'r Exemption> {
    report
        .exempt
        .iter()
        .filter(|e| !state.baseline.contains(&e.key()) && !told.contains(&e.key()))
        .collect()
}

/// Deny a shell command that looks like it writes under `<root>/.drift/` or to
/// `<root>/drift.lock`, the way Write and Edit are denied there. Relative paths
/// resolve against the hook's `cwd`.
fn bash_pre_tool_use(input: &Value, root: &Path, cwd: &Path) -> Option<Value> {
    let command = input
        .get("tool_input")
        .and_then(|t| t.get("command"))
        .and_then(Value::as_str)?;
    let Some(op) = shell_write_to_drift(command, root, cwd) else {
        // `drift card x` and the other read-only lookups run without a prompt.
        return crate::lookup::read_only_drift(command).then(crate::lookup::allow);
    };
    Some(json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": format!(
                "This command looks like it writes under .drift/ or to drift.lock ({}). They are Drift's policy and state (conventions, lock, fact cache, sessions) and are changed by Drift and people only (`drift review`). Reading them (cat, grep, drift check) is fine. Fix the code instead, or add `// drift-ignore <id>: <reason>` above the declaration.",
                sanitize(&op, 40)
            ),
        }
    }))
}

/// Deny a shell command that changes Drift's policy ([`shell_policy_change`]).
fn deny_policy_change(input: &Value) -> Option<Value> {
    let command = input
        .get("tool_input")
        .and_then(|t| t.get("command"))
        .and_then(Value::as_str)?;
    let what = shell_policy_change(command)?;
    Some(json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": format!(
                "Policy is changed by people: `{}` decides what Drift holds this repository and its agents to, so a person runs it, not an agent. Tell the person what you would change and why (the id, and what you read); they run the command. Read-only lookups (drift card, drift check, drift review --list or --show, drift setup --list) need no one.",
                sanitize(&what, 60)
            ),
        }
    }))
}

/// `drift review` options that decide something: a convention's status, mode or
/// agent visibility, an exception, a hidden card's answer, or the review log setting.
const REVIEW_DECISIONS: &[&str] = &[
    "accept",
    "reject",
    "block",
    "force",
    "advise",
    "show-to-agents",
    "exempt",
    "unexempt",
    "answer",
    "set-apart",
    "confirm-entry",
    "set-log",
];
/// `drift setup` options only a person may give (`--by` is judged by its value).
const SETUP_DECISIONS: &[&str] = &["confirm", "reject", "forget", "review"];
/// The variables a person sets to let `--by person` write without a terminal
/// ([`crate::setup::PERSON_ENV`]) and without typing the id
/// ([`crate::setup::PERSON_NONINTERACTIVE_ENV`]): an agent setting either changes policy.
const PERSON_VARS: &[&str] = &[
    crate::setup::PERSON_ENV,
    crate::setup::PERSON_NONINTERACTIVE_ENV,
];
/// The variables that say an agent runs the command ([`crate::setup::agent_env`]): an
/// agent unsetting them, or setting `DRIFT_AGENT` to anything but `1`, changes policy.
const AGENT_VARS: &[&str] = &[crate::setup::AGENT_ENV, crate::setup::CLAUDE_CODE_ENV];
/// Builtins whose operands assign or export variables.
const SHELL_SETTERS: &[&str] = &["export", "declare", "typeset", "readonly", "local", "read"];
/// Shells that run the string after `-c`.
const SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "ksh"];
/// Package runners that run the command after their options.
const RUNNERS: &[&str] = &["npx", "pnpx", "bunx"];
/// Package managers whose `exec`, `dlx`, `x` or `run` runs a package's command (and, but
/// for npm, a command named directly: `yarn drift init`).
const PACKAGE_MANAGERS: &[&str] = &["npm", "pnpm", "yarn", "bun"];
/// Options of a package runner that take a value (`npx -p @dadbodgeoff/drift drift init`).
const RUNNER_VALUED: &[&str] = &[
    "-p",
    "--package",
    "-w",
    "--workspace",
    "--registry",
    "--cache",
    "--prefix",
    "--userconfig",
    "-C",
    "--dir",
    "-F",
    "--filter",
];
/// Words that may open a simple command before its name: `{ drift init; }`,
/// `if true; then drift init; fi`, `! drift init`, `while ...; do drift init; done`.
const SHELL_RESERVED: &[&str] = &[
    "{", "}", "!", "if", "then", "elif", "else", "fi", "do", "done", "while", "until", "coproc",
];
/// Words that run the command after them, past their options and those options' values
/// (`sudo -u root drift init`, `timeout 5 drift init`, `nice -n 5 drift init`).
const POLICY_WRAPPERS: &[&str] = &[
    "sudo", "doas", "su", "env", "command", "builtin", "exec", "nohup", "nice", "time", "xargs",
    "timeout", "watch", "stdbuf", "setsid", "ionice", "script", "unbuffer", "expect", "spawn",
];
/// Wrappers that run the command on a pseudo-terminal, where Drift would take a missing
/// `--by` as a person's: `script`, `unbuffer`, `expect` (and its `spawn`).
const PTY_WRAPPERS: &[&str] = &["script", "unbuffer", "expect", "spawn"];

/// Best effort, never an approval: what in a shell command changes Drift's policy, which
/// is a person's to change: `drift init`, `drift review` with a decision
/// ([`REVIEW_DECISIONS`]), `drift setup` with [`SETUP_DECISIONS`] or, where it writes,
/// `--by` other than `agent`, `drift investigate` that records with `--by` other than
/// `agent`, `drift findings --branch` or `--force`, `drift export claude-settings
/// --write`, setting [`PERSON_VARS`], or unsetting what says an agent runs
/// ([`AGENT_VARS`]). On a pseudo-terminal (`script`, `unbuffer`, `expect`, `socat ...
/// pty`, Python's `pty`) or with the environment cleared (`env -i`, `env -u CLAUDECODE`),
/// a `drift setup` or `drift investigate` that writes without `--by agent` is a person's
/// too: Drift would take it as one. Sees every simple command of a list, pipeline,
/// subshell, compound command or function body, behind reserved words, assignments and
/// wrappers with their options (`env`, `sudo`, `timeout`, `xargs`, `watch`, ...), a path
/// to the binary, package runners (`npx`, `npm exec`, `pnpm dlx`, `yarn`), `cargo run
/// --`, `node <path to drift>`, the string of `sh -c`, `eval`, `script -c`, `expect -c`,
/// `su -c`, `env -S`, `socat EXEC:`/`SYSTEM:`, and the string literals of `python -c`. A
/// `--help` anywhere is never a change. What it cannot read (a command name that is an
/// expansion, a script file) is not judged: the person's usual prompt applies, since
/// only [`crate::lookup::read_only_drift`] approves.
fn shell_policy_change(cmd: &str) -> Option<String> {
    shell_policy_in(cmd, false)
}

/// [`shell_policy_change`]; `pty` where the command runs as a person's would.
fn shell_policy_in(cmd: &str, pty: bool) -> Option<String> {
    // `${DRIFT_SETUP_PERSON=1}` and `${DRIFT_SETUP_PERSON:=1}` assign it too.
    for var in PERSON_VARS {
        if ["=", ":="]
            .iter()
            .any(|op| cmd.contains(&format!("${{{var}{op}")))
        {
            return Some((*var).into());
        }
    }
    let toks = shell_tokens(cmd);
    let mut seg: Vec<&str> = Vec::new();
    let mut redirect = false;
    for t in toks.iter().chain(std::iter::once(&ShellTok::Sep)) {
        match t {
            ShellTok::Word(w) if !std::mem::take(&mut redirect) => {
                seg.push(w);
                continue;
            }
            ShellTok::Word(_) => continue,
            ShellTok::Redir { .. } => {
                redirect = true;
                continue;
            }
            _ => {}
        }
        if let Some(what) = policy_segment(&seg, pty) {
            return Some(what);
        }
        seg.clear();
    }
    None
}

/// `NAME=value` or `NAME+=value`: the name and the value.
fn assignment(w: &str) -> Option<(&str, &str)> {
    let (k, v) = w.split_once('=')?;
    let k = k.trim_end_matches('+');
    (!k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).then_some((k, v))
}

/// What setting `w` (an assignment, or a bare name an `export` names) changes, if anything.
fn sets_guarded(w: &str) -> Option<String> {
    let (k, v) = assignment(w).unwrap_or((w, "1"));
    if PERSON_VARS.contains(&k) {
        return Some(k.into());
    }
    (k == crate::setup::AGENT_ENV && v != "1").then(|| format!("{k}={v}"))
}

/// Whether `w` names Drift's command: `drift`, a path to it, or its package
/// (`@dadbodgeoff/drift`, either with `@<version>`).
fn drift_like(w: &str) -> bool {
    let base = w.rsplit('/').next().unwrap_or(w);
    base.split('@').next() == Some("drift")
}

/// Whether `w` names a command [`policy_segment`] reads.
fn names_command(w: &str) -> bool {
    let name = w.rsplit('/').next().unwrap_or(w);
    drift_like(w)
        || SHELLS.contains(&name)
        || POLICY_WRAPPERS.contains(&name)
        || RUNNERS.contains(&name)
        || PACKAGE_MANAGERS.contains(&name)
        || ["eval", "cargo", "node", "socat"].contains(&name)
        || name.starts_with("python")
}

/// Whether short option `a` (`-c`, `-qec`) holds the letter `c`, which takes a value.
fn short_flag(a: &str, c: char) -> bool {
    a.starts_with('-') && !a.starts_with("--") && a[1..].contains(c)
}

/// One simple command of [`shell_policy_change`]; `pty` as [`shell_policy_in`].
fn policy_segment(argv: &[&str], pty: bool) -> Option<String> {
    let mut i = 0;
    while let Some(w) = argv.get(i) {
        if SHELL_RESERVED.contains(w) {
            i += 1;
        } else if *w == "function" {
            // `function f { ...`: the name, then the body's first command.
            i += 2;
        } else if assignment(w).is_some() {
            if let Some(what) = sets_guarded(w) {
                return Some(what);
            }
            i += 1;
        } else {
            break;
        }
    }
    let first = argv.get(i)?;
    let name = first.rsplit('/').next().unwrap_or(first);
    let args = &argv[i + 1..];
    if SHELL_SETTERS.contains(&name) {
        return args.iter().find_map(|a| sets_guarded(a));
    }
    if name == "unset" {
        return args
            .iter()
            .find(|a| AGENT_VARS.contains(a))
            .map(|a| format!("unset {a}"));
    }
    if name == "printf" {
        let k = args.iter().position(|a| *a == "-v")?;
        return args.get(k + 1).and_then(|a| sets_guarded(a));
    }
    if SHELLS.contains(&name) {
        let script = args
            .iter()
            .position(|a| short_flag(a, 'c'))
            .and_then(|k| args.get(k + 1))?;
        return shell_policy_in(script, pty);
    }
    if name == "eval" {
        return shell_policy_in(&args.join(" "), pty);
    }
    if POLICY_WRAPPERS.contains(&name) {
        return wrapped(name, args, pty);
    }
    if name.starts_with("python") {
        return python_c(args, pty);
    }
    if name == "socat" {
        return socat(args, pty);
    }
    if RUNNERS.contains(&name) {
        return runner(args, pty);
    }
    if PACKAGE_MANAGERS.contains(&name) {
        let k = args.iter().position(|a| !a.starts_with('-'))?;
        return match args[k] {
            "exec" | "x" | "dlx" | "run" => runner(&args[k + 1..], pty),
            w if name != "npm" && drift_like(w) => drift_policy(&args[k + 1..], pty),
            _ => None,
        };
    }
    if name == "cargo" {
        return cargo_run(args, pty);
    }
    if name == "node" {
        // `node node_modules/.bin/drift init`.
        let k = args.iter().position(|a| !a.starts_with('-'))?;
        let script = args[k]
            .trim_end_matches(".js")
            .trim_end_matches(".cjs")
            .trim_end_matches(".mjs");
        return drift_like(script)
            .then(|| drift_policy(&args[k + 1..], pty))
            .flatten();
    }
    if drift_like(first) {
        return drift_policy(args, pty);
    }
    None
}

/// The command a wrapper runs: every variable it sets, a string it runs (`script -c`,
/// `expect -c`, `su -c`, `env -S`, all of `watch`'s words), then the first word past its
/// options that names a command ([`names_command`]); a `drift` that changes nothing
/// there may be an option's value (`sudo -u drift drift init`), so the words after it are
/// read too.
fn wrapped(name: &str, args: &[&str], pty: bool) -> Option<String> {
    let mut pty = pty || PTY_WRAPPERS.contains(&name);
    if let Some(what) = args
        .iter()
        .find_map(|a| assignment(a).and_then(|_| sets_guarded(a)))
    {
        return Some(what);
    }
    if name == "env" {
        // Without the variables that say an agent runs it, Drift may take it as a person's.
        pty |= args.iter().enumerate().any(|(k, a)| {
            ["-i", "-", "--ignore-environment"].contains(a)
                || (*a == "-u" || *a == "--unset")
                    && args.get(k + 1).is_some_and(|v| AGENT_VARS.contains(v))
                || a.strip_prefix("--unset=")
                    .or_else(|| a.strip_prefix("-u"))
                    .is_some_and(|v| AGENT_VARS.contains(&v))
        });
    }
    for (k, a) in args.iter().enumerate() {
        let string = match name {
            "script" if *a == "--command" || short_flag(a, 'c') => args.get(k + 1).copied(),
            "script" => a.strip_prefix("--command="),
            "expect" | "su" if short_flag(a, 'c') => args.get(k + 1).copied(),
            "su" => a.strip_prefix("--command="),
            "env" if *a == "-S" || *a == "--split-string" => args.get(k + 1).copied(),
            "env" => a
                .strip_prefix("--split-string=")
                .or_else(|| a.strip_prefix("-S").filter(|s| !s.is_empty())),
            _ => None,
        };
        if let Some(s) = string
            && let Some(what) = shell_policy_in(s, pty)
        {
            return Some(what);
        }
    }
    if name == "watch" {
        // `watch` runs its words through `sh -c`.
        let k = args
            .iter()
            .position(|a| !a.starts_with('-'))
            .unwrap_or(args.len());
        if let Some(what) = shell_policy_in(&args[k..].join(" "), pty) {
            return Some(what);
        }
    }
    let mut seen = args
        .iter()
        .enumerate()
        .filter(|(_, a)| !a.starts_with('-') && assignment(a).is_none() && names_command(a));
    seen.find_map(|(k, a)| {
        let said = policy_segment(&args[k..], pty);
        // Only a `drift` that says nothing lets the words after it be read.
        if said.is_none() && drift_like(a) {
            return None;
        }
        Some(said)
    })
    .flatten()
}

/// What a package runner runs (`npx`, `npm exec`, `pnpm dlx`): its `-c` string, or the
/// package after its options and their values; `@dadbodgeoff/drift` or `drift` is Drift.
fn runner(args: &[&str], pty: bool) -> Option<String> {
    let mut k = 0;
    while let Some(a) = args.get(k) {
        if *a == "-c" || *a == "--call" {
            if let Some(what) = args.get(k + 1).and_then(|s| shell_policy_in(s, pty)) {
                return Some(what);
            }
            k += 2;
        } else if let Some(s) = a.strip_prefix("--call=") {
            if let Some(what) = shell_policy_in(s, pty) {
                return Some(what);
            }
            k += 1;
        } else if RUNNER_VALUED.contains(a) {
            k += 2;
        } else if a.starts_with('-') {
            k += 1;
        } else if drift_like(a) {
            // A package named after `-p` that was not read as its value: read on.
            if let Some(what) = drift_policy(&args[k + 1..], pty) {
                return Some(what);
            }
            k += 1;
        } else {
            return policy_segment(&args[k..], pty);
        }
    }
    None
}

/// `cargo run [options] -- <args>`: Drift's own binary unless `--bin`, `--example` or
/// `--package` names another.
fn cargo_run(args: &[&str], pty: bool) -> Option<String> {
    let k = args
        .iter()
        .position(|a| !a.starts_with('-') && !a.starts_with('+'))?;
    if !["run", "r"].contains(&args[k]) {
        return None;
    }
    let rest = &args[k + 1..];
    let end = rest.iter().position(|a| *a == "--")?;
    let value = |names: &[&str]| {
        rest[..end].iter().enumerate().find_map(|(j, a)| {
            names.iter().find_map(|n| {
                if a == n {
                    rest.get(j + 1).copied()
                } else {
                    a.strip_prefix(&format!("{n}="))
                }
            })
        })
    };
    let ours = match (
        value(&["--bin"]),
        value(&["--example"]),
        value(&["-p", "--package"]),
    ) {
        (Some(bin), _, _) => bin == "drift",
        (None, Some(_), _) => false,
        (None, None, Some(p)) => p.starts_with("drift"),
        (None, None, None) => true,
    };
    ours.then(|| drift_policy(&rest[end + 1..], pty)).flatten()
}

/// `python -c '<script>'`: each string literal of the script as a command
/// (`os.system("drift init")`), and the literals in order as one command's words
/// (`pty.spawn(["drift", "init"])`, `subprocess.run(["sh", "-c", ...])`); on a
/// pseudo-terminal where it names `pty`. A literal naming a variable a person sets
/// changes policy (`os.environ["DRIFT_SETUP_PERSON"] = "1"`).
fn python_c(args: &[&str], pty: bool) -> Option<String> {
    let k = args.iter().position(|a| a.starts_with("-c"))?;
    let script = match &args[k][2..] {
        "" => *args.get(k + 1)?,
        attached => attached,
    };
    let pty = pty || script.contains("pty");
    let lits = string_literals(script);
    let words: Vec<&str> = lits.iter().map(String::as_str).collect();
    if let Some(v) = words.iter().find(|w| PERSON_VARS.contains(w)) {
        return Some((*v).into());
    }
    words
        .iter()
        .find_map(|w| shell_policy_in(w, pty))
        .or_else(|| {
            (0..words.len())
                .filter(|&j| names_command(words[j]))
                .find_map(|j| policy_segment(&words[j..], pty))
        })
}

/// The string literals of a Python script, best effort: quotes, triple quotes and
/// backslash escapes.
fn string_literals(script: &str) -> Vec<String> {
    let chars: Vec<char> = script.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let q = chars[i];
        if q == '#' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if q != '\'' && q != '"' {
            i += 1;
            continue;
        }
        let triple = chars.get(i + 1) == Some(&q) && chars.get(i + 2) == Some(&q);
        i += if triple { 3 } else { 1 };
        let mut lit = String::new();
        while i < chars.len() {
            let c = chars[i];
            if c == '\\' {
                lit.extend(chars.get(i + 1));
                i += 2;
                continue;
            }
            if c == q && (!triple || (chars.get(i + 1) == Some(&q) && chars.get(i + 2) == Some(&q)))
            {
                i += if triple { 3 } else { 1 };
                break;
            }
            lit.push(c);
            i += 1;
        }
        out.push(lit);
    }
    out
}

/// `socat ... EXEC:<command>` or `SYSTEM:<command>`, each address's options after the
/// first comma; on a pseudo-terminal where an address asks for one (`pty`).
fn socat(args: &[&str], pty: bool) -> Option<String> {
    let pty = pty || args.iter().any(|a| a.to_lowercase().contains("pty"));
    args.iter().find_map(|a| {
        let lower = a.to_lowercase();
        let n = ["exec:", "system:"]
            .iter()
            .find(|p| lower.starts_with(**p))?
            .len();
        let cmd = &a[n..];
        shell_policy_in(cmd.split(',').next().unwrap_or(cmd), pty)
            .or_else(|| shell_policy_in(cmd, pty))
    })
}

/// A Drift command line: what in it changes policy ([`shell_policy_change`]).
fn drift_policy(args: &[&str], pty: bool) -> Option<String> {
    // The subcommand, after the global options (`--root` takes a value).
    let mut k = 0;
    while let Some(a) = args.get(k) {
        if *a == "--root" {
            k += 2;
        } else if a.starts_with('-') {
            k += 1;
        } else {
            break;
        }
    }
    // `--help` anywhere before `--` prints help and changes nothing.
    if args
        .iter()
        .take_while(|a| **a != "--")
        .any(|a| *a == "--help" || *a == "-h")
    {
        return None;
    }
    let sub = *args.get(k)?;
    let opts = &args[k + 1..];
    let has = |names: &[&str]| {
        opts.iter().any(|o| {
            o.strip_prefix("--")
                .is_some_and(|o| names.contains(&o.split_once('=').map_or(o, |(f, _)| f)))
        })
    };
    let flag = |names: &[&str]| {
        opts.iter().find_map(|o| {
            let o = o.strip_prefix("--")?;
            let o = o.split_once('=').map_or(o, |(f, _)| f);
            names.contains(&o).then(|| format!("drift {sub} --{o}"))
        })
    };
    // `--by` other than `agent`, a value it cannot read included; none given, on a
    // pseudo-terminal, where Drift takes it as a person's.
    let by_person = || {
        let given = opts.iter().enumerate().find_map(|(j, o)| {
            let value = match o.strip_prefix("--by") {
                Some("") => opts.get(j + 1).copied().unwrap_or(""),
                Some(rest) => rest.strip_prefix('=')?,
                None => return None,
            };
            (value != "agent").then(|| format!("drift {sub} --by {value}"))
        });
        given.or_else(|| {
            (pty && !has(&["by"])).then(|| format!("drift {sub} on a terminal, without --by agent"))
        })
    };
    // What writes: an answer, a record, or (setup) asking one question at a time.
    let setup_writes =
        || has(&["answer", "answers", "interactive"]) || !has(&["list", "json", "agent-brief"]);
    match sub {
        "init" => Some("drift init".into()),
        "review" => flag(REVIEW_DECISIONS),
        "setup" => flag(SETUP_DECISIONS).or_else(|| setup_writes().then(by_person).flatten()),
        "investigate" => has(&["record", "answers"]).then(by_person).flatten(),
        // Only a person asks for a branch with an agent's patch, or replaces a file.
        "findings" => flag(&["branch", "force"]),
        // Writing the permission entries changes what an agent may run unprompted.
        "export" if opts.contains(&"claude-settings") => flag(&["write"]),
        _ => None,
    }
}

/// One token of a shell command, as far as [`shell_write_to_drift`] needs it.
#[derive(Debug, PartialEq)]
enum ShellTok {
    Word(String),
    /// `;`, `&&`, `||`, `|`, `&`, newline.
    Sep,
    /// A subshell opens: `(`, `$(`, an opening backquote.
    Open,
    /// A subshell closes: `)`, a closing backquote.
    Close,
    /// A redirection; `out` for `>`, `>>`, `>|`, `&>` (the next word is the target).
    Redir {
        out: bool,
    },
}

/// Split a command into words, separators, subshells and redirections. Quotes
/// and backslashes are removed as the shell would; expansions are left as text;
/// comments and here-document bodies are dropped.
fn shell_tokens(cmd: &str) -> Vec<ShellTok> {
    struct Lexer {
        toks: Vec<ShellTok>,
        word: String,
        quoted: bool,
        /// After `<<` or `<<-`: the next word is a here-document delimiter.
        heredoc_next: Option<bool>,
        /// Delimiters (and whether leading tabs are stripped) whose bodies start
        /// after the next newline.
        heredocs: Vec<(String, bool)>,
        in_backquote: bool,
    }
    impl Lexer {
        fn end_word(&mut self) {
            if !self.word.is_empty() || self.quoted {
                let w = std::mem::take(&mut self.word);
                if let Some(strip) = self.heredoc_next.take() {
                    self.heredocs.push((w.clone(), strip));
                }
                self.toks.push(ShellTok::Word(w));
            }
            self.quoted = false;
        }
        /// `2>`, `0<`: the digits name a descriptor, not an argument.
        fn drop_fd(&mut self) {
            if !self.quoted
                && !self.word.is_empty()
                && self.word.chars().all(|c| c.is_ascii_digit())
            {
                self.word.clear();
            }
        }
    }
    let mut lx = Lexer {
        toks: Vec::new(),
        word: String::new(),
        quoted: false,
        heredoc_next: None,
        heredocs: Vec::new(),
        in_backquote: false,
    };
    let mut chars = cmd.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            ' ' | '\t' => lx.end_word(),
            '\n' => {
                lx.end_word();
                lx.toks.push(ShellTok::Sep);
                // Here-document bodies are data, not commands: skip them.
                for (delim, strip) in std::mem::take(&mut lx.heredocs) {
                    loop {
                        let mut line = String::new();
                        let mut ended = true;
                        for c in chars.by_ref() {
                            if c == '\n' {
                                ended = false;
                                break;
                            }
                            line.push(c);
                        }
                        let l = if strip {
                            line.trim_start_matches('\t')
                        } else {
                            &line
                        };
                        if l == delim || ended {
                            break;
                        }
                    }
                }
            }
            '#' if lx.word.is_empty() && !lx.quoted => {
                // A comment, to the end of the line.
                while chars.peek().is_some_and(|&c| c != '\n') {
                    chars.next();
                }
            }
            '\'' => {
                lx.quoted = true;
                for c in chars.by_ref() {
                    if c == '\'' {
                        break;
                    }
                    lx.word.push(c);
                }
            }
            '"' => {
                lx.quoted = true;
                while let Some(c) = chars.next() {
                    match c {
                        '"' => break,
                        '\\' if chars.peek().is_some_and(|c| "\"\\$`".contains(*c)) => {
                            lx.word.extend(chars.next());
                        }
                        c => lx.word.push(c),
                    }
                }
            }
            '\\' => match chars.next() {
                Some('\n') | None => {}
                Some(c) => lx.word.push(c),
            },
            '$' if chars.peek() == Some(&'(') => {
                chars.next();
                lx.end_word();
                lx.toks.push(ShellTok::Open);
            }
            '>' => {
                lx.drop_fd();
                lx.end_word();
                if matches!(chars.peek(), Some('>' | '|' | '&')) {
                    chars.next();
                }
                lx.toks.push(ShellTok::Redir { out: true });
            }
            '&' if chars.peek() == Some(&'>') => {
                chars.next();
                if chars.peek() == Some(&'>') {
                    chars.next();
                }
                lx.end_word();
                lx.toks.push(ShellTok::Redir { out: true });
            }
            '<' => {
                lx.drop_fd();
                lx.end_word();
                let mut n = 1;
                while chars.peek() == Some(&'<') {
                    chars.next();
                    n += 1;
                }
                if n == 2 {
                    let strip = chars.peek() == Some(&'-');
                    if strip {
                        chars.next();
                    }
                    lx.heredoc_next = Some(strip);
                } else if chars.peek() == Some(&'&') {
                    chars.next();
                }
                lx.toks.push(ShellTok::Redir { out: false });
            }
            '(' => {
                lx.end_word();
                lx.toks.push(ShellTok::Open);
            }
            ')' => {
                lx.end_word();
                lx.toks.push(ShellTok::Close);
            }
            '`' => {
                lx.end_word();
                lx.toks.push(if lx.in_backquote {
                    ShellTok::Close
                } else {
                    ShellTok::Open
                });
                lx.in_backquote = !lx.in_backquote;
            }
            ';' | '|' | '&' => {
                lx.end_word();
                lx.toks.push(ShellTok::Sep);
            }
            c => lx.word.push(c),
        }
    }
    lx.end_word();
    lx.toks
}

/// A shell word as an absolute path, resolved lexically against `cwd`. `None`
/// when it cannot be known: `~`, an expansion, or a relative path while the
/// working directory is unknown.
fn shell_path(cwd: Option<&Path>, word: &str) -> Option<PathBuf> {
    if word.is_empty() || word.starts_with('~') || word.contains('$') {
        return None;
    }
    let p = Path::new(word);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd?.join(p)
    };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            c => out.push(c),
        }
    }
    Some(out)
}

/// Whether `path` (absolute, normalised) is `<root>/.drift`, under it, or
/// `<root>/drift.lock`. Resolved like [`Project::rel`]: the nearest existing
/// ancestor is canonicalised, so links into the repository count.
fn is_drift_state(root: &Path, path: &Path) -> bool {
    let mut existing = path;
    let mut rest = Vec::new();
    while !existing.exists() {
        let (Some(name), Some(parent)) = (existing.file_name(), existing.parent()) else {
            break;
        };
        rest.push(name);
        existing = parent;
    }
    let mut resolved = existing
        .canonicalize()
        .unwrap_or_else(|_| existing.to_path_buf());
    for part in rest.iter().rev() {
        resolved.push(part);
    }
    let Ok(rel) = resolved.strip_prefix(root) else {
        return false;
    };
    let mut parts = rel.components();
    match parts.next() {
        Some(std::path::Component::Normal(first)) if first == ".drift" => true,
        Some(std::path::Component::Normal(first)) if first == LOCK_FILE => parts.next().is_none(),
        _ => false,
    }
}

/// Commands that change every file they name.
const SHELL_WRITERS: &[&str] = &["rm", "rmdir", "mv", "tee", "truncate", "shred", "unlink"];
/// Commands that write only their destination (the last operand, or `-t DIR`).
const SHELL_COPIERS: &[&str] = &["cp", "ln", "install"];
/// Words that run the command after them.
const SHELL_WRAPPERS: &[&str] = &[
    "sudo", "doas", "env", "command", "builtin", "exec", "nohup", "nice", "time", "xargs",
];

/// `sed` and `perl` arguments: whether an in-place flag is given, and the file
/// operands (the script, inline or as the first operand, is not one).
fn in_place_files<'a>(name: &str, args: &[&'a str]) -> (bool, Vec<&'a str>) {
    // Short options that take no argument, so an `i` after them is still a flag.
    let (plain, with_arg, script) = if name == "sed" {
        ("nrEsuz", "l", "ef")
    } else {
        ("nplaswTtUWXcSv", "MmIxCdDF0l", "eE")
    };
    let mut in_place = false;
    let mut has_script = false;
    let mut operands = Vec::new();
    let mut it = args.iter();
    while let Some(&a) = it.next() {
        if a == "--" {
            operands.extend(it.by_ref().copied());
            break;
        }
        if let Some(long) = a.strip_prefix("--") {
            if long.starts_with("in-place") {
                in_place = true;
            } else if matches!(long, "expression" | "file") {
                has_script = true;
                it.next();
            } else if long.starts_with("expression=") || long.starts_with("file=") {
                has_script = true;
            }
            continue;
        }
        let Some(cluster) = a.strip_prefix('-').filter(|c| !c.is_empty()) else {
            operands.push(a);
            continue;
        };
        for (k, c) in cluster.char_indices() {
            let attached = !cluster[k + c.len_utf8()..].is_empty();
            if c == 'i' {
                // The rest of the cluster is the backup suffix.
                in_place = true;
                break;
            } else if script.contains(c) {
                has_script = true;
                if !attached {
                    it.next();
                }
                break;
            } else if with_arg.contains(c) {
                if !attached && !matches!(c, '0' | 'l') {
                    it.next();
                }
                break;
            } else if !plain.contains(c) {
                break;
            }
        }
    }
    if !has_script && !operands.is_empty() {
        operands.remove(0);
    }
    (in_place, operands)
}

/// Best effort: whether a shell command writes to `<root>/.drift` (or under it)
/// or to `<root>/drift.lock`, and how (`rm`, `redirection`, ...). A conservative
/// token scan, not a shell. It sees redirections (`>`, `>>`) into those paths,
/// and `rm`, `mv`, `tee`, `truncate`, `cp`/`ln` (destination), `sed -i`/`perl -i`
/// (files, not the script) and `dd of=` naming them. Paths resolve against
/// `cwd`, followed through `cd`, `pushd`/`popd` and subshells; a `cd` it cannot
/// resolve (`~`, `$DIR`, `cd -`) leaves the directory unknown, and relative
/// paths are then not judged. Here-document bodies are not commands. It does
/// not see paths built by expansion, commands inside quoted strings
/// (`sh -c '...'`), scripts, or programs that write on their own
/// (`git checkout`, `python`). The real backstop is elsewhere: the Action scans
/// with a fresh cache, and a git-tracked `.drift/cache` is ignored.
fn shell_write_to_drift(cmd: &str, root: &Path, cwd: &Path) -> Option<String> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut cur: Option<PathBuf> = Some(cwd.to_path_buf());
    let mut dirs: Vec<Option<PathBuf>> = Vec::new();
    let mut scopes: Vec<(Option<PathBuf>, Vec<Option<PathBuf>>)> = Vec::new();
    let toks = shell_tokens(cmd);
    let mut seg: Vec<&ShellTok> = Vec::new();
    for t in toks.iter().chain(std::iter::once(&ShellTok::Sep)) {
        if matches!(t, ShellTok::Word(_) | ShellTok::Redir { .. }) {
            seg.push(t);
            continue;
        }
        if let Some(op) = shell_segment(&seg, &root, &mut cur, &mut dirs) {
            return Some(op);
        }
        seg.clear();
        match t {
            ShellTok::Open => scopes.push((cur.clone(), dirs.clone())),
            ShellTok::Close => {
                if let Some((c, d)) = scopes.pop() {
                    cur = c;
                    dirs = d;
                }
            }
            _ => {}
        }
    }
    None
}

/// One simple command of [`shell_write_to_drift`]; updates the working directory.
fn shell_segment(
    seg: &[&ShellTok],
    root: &Path,
    cur: &mut Option<PathBuf>,
    dirs: &mut Vec<Option<PathBuf>>,
) -> Option<String> {
    let protected = |cur: &Option<PathBuf>, w: &str| {
        shell_path(cur.as_deref(), w).is_some_and(|p| is_drift_state(root, &p))
    };
    let mut argv: Vec<&str> = Vec::new();
    let mut it = seg.iter();
    while let Some(t) = it.next() {
        match t {
            ShellTok::Word(w) => argv.push(w),
            ShellTok::Redir { out } => {
                let Some(ShellTok::Word(target)) = it.next() else {
                    continue;
                };
                // `>&2`, `2>&-`: a descriptor, not a file.
                let fd = target.chars().all(|c| c.is_ascii_digit() || c == '-');
                if *out && !fd && protected(cur, target) {
                    return Some("redirection".into());
                }
            }
            _ => {}
        }
    }
    // Skip variable assignments and wrappers (with their options) to the command.
    let mut i = 0;
    while let Some(w) = argv.get(i) {
        let assignment = w.split_once('=').is_some_and(|(k, _)| {
            !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        });
        if assignment {
            i += 1;
        } else if SHELL_WRAPPERS.contains(w) {
            i += 1;
            while argv.get(i).is_some_and(|a| a.starts_with('-')) {
                i += 1;
            }
        } else {
            break;
        }
    }
    let first = argv.get(i)?;
    let name = first.rsplit('/').next().unwrap_or(first);
    let args = &argv[i + 1..];
    let operands: Vec<&str> = {
        let mut out = Vec::new();
        let mut rest = false;
        for &a in args {
            if rest || !a.starts_with('-') || a == "-" {
                out.push(a);
            } else if a == "--" {
                rest = true;
            }
        }
        out
    };
    let writes = match name {
        "cd" | "pushd" => {
            if name == "pushd" {
                dirs.push(cur.clone());
            }
            *cur = match operands.as_slice() {
                [one] if *one != "-" => shell_path(cur.as_deref(), one),
                _ => None,
            };
            false
        }
        "popd" => {
            *cur = dirs.pop().flatten();
            false
        }
        n if SHELL_WRITERS.contains(&n) => operands.iter().any(|a| protected(cur, a)),
        n if SHELL_COPIERS.contains(&n) => {
            let target = args.iter().enumerate().find_map(|(k, a)| {
                if *a == "-t" || *a == "--target-directory" {
                    args.get(k + 1).copied()
                } else {
                    a.strip_prefix("--target-directory=")
                        .or_else(|| a.strip_prefix("-t").filter(|r| !r.is_empty()))
                }
            });
            let dest = target.or(match operands.as_slice() {
                [_] if n == "ln" => Some("."),
                [_, .., last] => Some(*last),
                _ => None,
            });
            dest.is_some_and(|d| protected(cur, d))
        }
        "sed" | "perl" => {
            let (in_place, files) = in_place_files(name, args);
            in_place && files.iter().any(|a| protected(cur, a))
        }
        "dd" => args
            .iter()
            .filter_map(|a| a.strip_prefix("of="))
            .any(|d| protected(cur, d)),
        _ => false,
    };
    writes.then(|| name.to_string())
}

#[cfg(test)]
mod tests {

    fn recipe(id: &str, package: &str, stems: &[&str]) -> HookRecipe {
        HookRecipe {
            id: id.into(),
            package: package.into(),
            text: format!(
                "new http entry points in {package}: authn: withAuth (9 of 10; copy {package}/app/api/a/route.ts:4)"
            ),
            stems: stems.iter().map(|s| s.to_string()).collect(),
            dirs: Vec::new(),
            preview: String::new(),
        }
    }

    #[test]
    fn a_new_file_where_files_of_any_name_are_entry_points_gets_the_recipe() {
        let mut state = SessionState {
            recipes: vec![HookRecipe {
                dirs: vec!["svc/app/api/v2/*.py".into()],
                ..recipe("E-cccccc", "svc", &["fs", "runs"])
            }],
            ..SessionState::default()
        };
        // Not there, not that extension, the package marker, a test: silent.
        for rel in [
            "svc/app/services/widgets.py",
            "svc/app/api/v2/README.md",
            "svc/app/api/v2/__init__.py",
            "svc/app/api/v2/test_widgets.py",
        ] {
            assert_eq!(new_file_recipe(&mut state, rel), None, "{rel}");
        }
        let line = new_file_recipe(&mut state, "svc/app/api/v2/widgets.py").unwrap();
        assert!(
            line.starts_with("drift: practices for svc/app/api/v2/widgets.py (facts, not rules): "),
            "{line}"
        );
        // Once per session.
        assert_eq!(
            new_file_recipe(&mut state, "svc/app/api/v2/gadgets.py"),
            None
        );
        assert_eq!(dir_pattern("main.py").as_deref(), Some("*.py"));
        assert_eq!(dir_pattern("a/b/route.ts").as_deref(), Some("a/b/*.ts"));
        assert_eq!(dir_pattern("a/Makefile"), None);
    }

    #[test]
    fn practices_hooks_speak_once_and_only_where_a_recipe_is_known() {
        let mut state = SessionState {
            recipes: vec![
                recipe("E-aaaaaa", "apps/web", &["route"]),
                recipe("E-bbbbbb", "", &["handler"]),
            ],
            ..SessionState::default()
        };
        // A new file of a recipe's kind: the recipe and its file, once.
        let line = new_file_recipe(&mut state, "apps/web/app/api/x/route.ts").unwrap();
        assert!(line.starts_with("drift: practices for apps/web/app/api/x/route.ts (facts, not rules): new http entry points in apps/web: authn: "), "{line}");
        assert!(line.contains("route.ts:4"), "{line}");
        // Dedupe: the same recipe is not said twice in a session.
        assert_eq!(
            new_file_recipe(&mut state, "apps/web/app/api/y/route.ts"),
            None
        );
        // Silent for a test file, docs, styles and config (no recipe's kind).
        for rel in [
            "apps/web/app/api/z/route.test.ts",
            "apps/web/README.md",
            "apps/web/app/globals.css",
            "apps/web/next.config.js",
        ] {
            assert_eq!(new_file_recipe(&mut state, rel), None, "{rel}");
        }
        // Another package's recipe is its own.
        assert!(new_file_recipe(&mut state, "handler.ts").is_some());
        // Nothing known for a package: silent, never "unknown".
        let mut empty = SessionState::default();
        assert_eq!(
            new_file_recipe(&mut empty, "apps/web/app/api/x/route.ts"),
            None
        );
        assert_eq!(session_brief(&mut empty, "apps/web"), None);
    }

    #[test]
    fn the_session_brief_gives_the_package_recipes_and_marks_them_given() {
        let mut state = SessionState {
            recipes: vec![
                recipe("E-aaaaaa", "apps/web", &["route"]),
                recipe("E-bbbbbb", "", &["handler"]),
            ],
            ..SessionState::default()
        };
        let brief = session_brief(&mut state, "apps/web/app").unwrap();
        assert!(brief.starts_with("drift: practices in apps/web (facts, not rules; each names a file to copy):\n- new http entry points in apps/web"), "{brief}");
        assert!(!brief.contains("handler"), "{brief}");
        assert!(brief.len() <= drift_mine::practices::AGENT_CHARS);
        // Given at session start: the new-file hint does not repeat it.
        assert_eq!(
            new_file_recipe(&mut state, "apps/web/app/api/x/route.ts"),
            None
        );
        // An edit of an existing file is never primed (PreToolUse answers new files only).
    }
    use super::*;

    fn writes(cmd: &str) -> Option<String> {
        shell_write_to_drift(cmd, Path::new("/repo"), Path::new("/repo"))
    }

    #[test]
    fn shell_writes_under_drift_are_seen() {
        for cmd in [
            "echo x > .drift/cache/facts.json",
            "echo x >.drift/cache/facts.json",
            "cat a >> .drift/conventions.yaml",
            "printf x &> ./.drift/conventions.yaml",
            "echo '' 2> .drift/cache/x",
            "cat > \".drift/conventions.yaml\" <<EOF\nmode: block\nEOF",
            "cat <<'EOF' > .drift/conventions.yaml\nx\nEOF",
            "echo hi > /repo/.drift/x",
            "echo hi > src/../.drift/x",
            "cp /tmp/c.yaml .drift/conventions.yaml",
            "cp -r /tmp/cache .drift",
            "cp -t .drift/cache /tmp/a /tmp/b",
            "ln -sf /etc/passwd .drift/conventions.yaml",
            "cd .drift && ln -s /etc/passwd",
            "mv .drift/conventions.yaml /tmp/c",
            "rm -rf .drift/cache",
            "rm drift.lock",
            "rm -f /repo/drift.lock",
            "/bin/rm -f .drift/cache/sessions/s1.json",
            "sudo rm -rf .drift",
            "echo x | tee -a .drift/conventions.yaml",
            "sed -i 's/advise/block/' .drift/conventions.yaml",
            "sed -i.bak -e 's/a/b/' drift.lock",
            "sed -ni 's/a/b/p' drift.lock",
            "sed --in-place -e 's/a/b/' .drift/conventions.yaml",
            "perl -pi -e 's/a/b/' .drift/conventions.yaml",
            "perl -i.bak -pe 's/a/b/' drift.lock",
            "truncate -s 0 drift.lock",
            "dd if=/dev/zero of=.drift/cache/x",
            "git status; rm -r .drift/cache && drift check",
            "ls $(rm .drift/x)",
            "cd .drift && rm -rf cache",
            "cd .drift; echo x > conventions.yaml",
            "cd .drift && cd cache && rm -f x",
            "cd src && rm ../drift.lock",
            "cd /repo/.drift && rm conventions.yaml",
            "(cd /tmp) && rm .drift/x",
            "pushd /tmp && popd && rm .drift/x",
            "cat <<EOF\nrm x\nEOF\nrm .drift/x",
            "ls .drift/cache/* | xargs -0 rm .drift/x",
        ] {
            assert!(writes(cmd).is_some(), "{cmd}");
        }
    }

    #[test]
    fn reading_drift_from_the_shell_is_allowed() {
        for cmd in [
            "cat .drift/conventions.yaml",
            "drift check",
            "drift check --format sarif > /tmp/out.sarif",
            "cat .drift/conventions.yaml 2>/dev/null",
            "grep -n mode .drift/conventions.yaml > /tmp/modes 2>&1",
            "sed -n '1,20p' .drift/conventions.yaml",
            "sed 's/a/b/' .drift/conventions.yaml > /tmp/c",
            "cp .drift/conventions.yaml /tmp/backup.yaml",
            "ls -la .drift/cache",
            "git diff -- .drift/conventions.yaml drift.lock",
            "head drift.lock | wc -l",
            "rm -rf node_modules/.cache",
            "echo '.drift/ > x' > /tmp/note",
            "rm build/out.js # not .drift/x",
            "cd .drift && cat conventions.yaml && cd .. && rm tmp.txt",
            "echo x > src/drift.locked.ts",
            "cat my.drift/x > out.txt",
            "cd .drift && echo x 2>&1 >&2",
            // Review cases: only <root>/.drift and <root>/drift.lock are protected.
            "rm -rf tests/fixtures/app/.drift",
            "rm -rf /tmp/demo/.drift",
            "echo x > /tmp/demo/.drift/conventions.yaml",
            "rm packages/app/drift.lock",
            "rm -rf ~/.drift",
            "rm -rf $HOME/.drift/cache",
            // The sed and perl script is not a file; only a real -i is in-place.
            "sed -i '/.drift/d' .gitignore",
            "sed -i -e '/drift.lock/d' .gitattributes",
            "sed -i.bak 's#.drift/cache##' .gitignore",
            "perl -pi -e 's/.drift//' .gitignore",
            "perl -Mstrict -ne 'print' .drift/conventions.yaml",
            "perl -ne 'print if /mode/' .drift/conventions.yaml",
            "sed -E 's/a/b/' .drift/conventions.yaml",
            // Here-document bodies are data.
            "cat <<'EOF' > /tmp/notes.md\nrm -rf .drift/cache\necho x > .drift/conventions.yaml\nEOF",
            "cat <<-EOF > /tmp/notes.md\n\trm drift.lock\n\tEOF",
            "git commit -F - <<EOF\nsed -i s/a/b/ .drift/conventions.yaml\nEOF",
            // A subshell is a scope; popd and unresolvable cd leave .drift.
            "(cd .drift && cat conventions.yaml) && rm -f out.txt",
            "pushd .drift && cat conventions.yaml && popd && rm -f out.txt",
            "cd .drift && cd ~ && rm -f out.txt",
            "cd .drift && cd $OLDPWD && rm -f out.txt",
            "cd .drift && cd - && rm -f out.txt",
            "cd .drift && cd .. && echo x > out.txt",
            "cd .drift/cache && cd ../.. && rm -f out.txt",
            "cd .drift && cd ../src && rm -f out.txt",
            "$(cd .drift) && rm -f out.txt",
            // ln with one operand links into the current directory.
            "ln -s .drift/conventions.yaml",
            "ln -sf ../.drift/conventions.yaml",
        ] {
            assert_eq!(writes(cmd), None, "{cmd}");
        }
    }

    #[test]
    fn policy_changes_from_the_shell_are_seen() {
        for (cmd, what) in [
            ("drift review --reject D-x", "drift review --reject"),
            (
                "drift review --show-to-agents D-x",
                "drift review --show-to-agents",
            ),
            ("drift review --accept=D-x,D-y", "drift review --accept"),
            ("drift review --block D-x --force", "drift review --block"),
            ("drift review --advise D-x", "drift review --advise"),
            (
                "drift review --exempt D-x --member a.ts#f --reason r",
                "drift review --exempt",
            ),
            (
                "drift review --unexempt D-x --member a.ts#f",
                "drift review --unexempt",
            ),
            (
                "drift review --hidden --answer D-x=same",
                "drift review --answer",
            ),
            ("drift review --set-log on", "drift review --set-log"),
            ("drift setup --forget S-x", "drift setup --forget"),
            ("drift setup --confirm S-x", "drift setup --confirm"),
            ("drift setup --reject S-x", "drift setup --reject"),
            ("drift setup --review", "drift setup --review"),
            (
                "drift setup --answer S-x=yes --by person",
                "drift setup --by person",
            ),
            (
                "drift setup --answer S-x=yes --by=person",
                "drift setup --by person",
            ),
            (
                "drift setup --answer S-x=yes --by $WHO",
                "drift setup --by $WHO",
            ),
            (
                "drift investigate --record I-x=internal --by person",
                "drift investigate --by person",
            ),
            ("drift init", "drift init"),
            ("drift init --max 5", "drift init"),
            ("drift --root packages/app init", "drift init"),
            (
                "drift --no-cache review --accept D-x",
                "drift review --accept",
            ),
            (
                "DRIFT_SETUP_PERSON=1 drift setup --confirm S-x --by person",
                "DRIFT_SETUP_PERSON",
            ),
            (
                "DRIFT_SETUP_PERSON=1 drift setup --answer S-x=yes",
                "DRIFT_SETUP_PERSON",
            ),
            (
                "env DRIFT_SETUP_PERSON=1 drift setup --list",
                "DRIFT_SETUP_PERSON",
            ),
            ("env -i A=1 DRIFT_SETUP_PERSON=1 sh", "DRIFT_SETUP_PERSON"),
            ("export DRIFT_SETUP_PERSON=1", "DRIFT_SETUP_PERSON"),
            ("export DRIFT_SETUP_PERSON", "DRIFT_SETUP_PERSON"),
            ("declare -x DRIFT_SETUP_PERSON=1", "DRIFT_SETUP_PERSON"),
            ("read DRIFT_SETUP_PERSON <<< 1", "DRIFT_SETUP_PERSON"),
            ("DRIFT_SETUP_PERSON+=1 true", "DRIFT_SETUP_PERSON"),
            (": ${DRIFT_SETUP_PERSON:=1}", "DRIFT_SETUP_PERSON"),
            // Shell forms.
            (
                "cd packages/app && drift review --accept D-x",
                "drift review --accept",
            ),
            ("git pull; drift init", "drift init"),
            (
                "echo y | drift review --reject D-x",
                "drift review --reject",
            ),
            ("drift check || drift init", "drift init"),
            ("(cd x && drift init)", "drift init"),
            ("echo $(drift init)", "drift init"),
            (
                "./target/debug/drift review --accept D-x",
                "drift review --accept",
            ),
            ("/usr/local/bin/drift init", "drift init"),
            ("\"drift\" 'review' '--accept' D-x", "drift review --accept"),
            ("sudo -E drift init", "drift init"),
            ("time drift review --accept D-x", "drift review --accept"),
            (
                "echo D-x | xargs drift review --reject",
                "drift review --reject",
            ),
            (
                "npx @dadbodgeoff/drift review --accept D-x",
                "drift review --accept",
            ),
            ("npx -y @dadbodgeoff/drift@next init", "drift init"),
            ("sh -c 'drift review --accept D-x'", "drift review --accept"),
            ("bash -lc \"cd x && drift init\"", "drift init"),
            ("eval drift init", "drift init"),
            (
                "drift card a.ts 2>/dev/null; drift init > /tmp/out",
                "drift init",
            ),
            ("drift findings --branch F-x", "drift findings --branch"),
            ("drift findings --branch=F-x", "drift findings --branch"),
            (
                "drift export claude-settings --write .claude/settings.json",
                "drift export --write",
            ),
            (
                "drift export --write=.claude/settings.json claude-settings",
                "drift export --write",
            ),
            (
                "drift export --write .claude/settings.json claude-settings",
                "drift export --write",
            ),
        ] {
            assert_eq!(shell_policy_change(cmd).as_deref(), Some(what), "{cmd}");
        }
    }

    /// Every shell form that runs a command after other words: reserved words, compound
    /// commands, function bodies, wrappers with options that take values, package
    /// runners, `cargo run --`. Each is read to the Drift command it runs.
    #[test]
    fn every_shell_form_of_a_policy_change_is_seen() {
        for (cmd, what) in [
            (
                "{ DRIFT_SETUP_PERSON=1 drift setup --confirm I-x --by person; }",
                "DRIFT_SETUP_PERSON",
            ),
            ("{ drift init; }", "drift init"),
            ("if true; then drift init; fi", "drift init"),
            ("if drift init; then :; fi", "drift init"),
            ("while false; do drift init; done", "drift init"),
            ("until drift init; do :; done", "drift init"),
            (
                "for x in 1; do drift review --accept D-x; done",
                "drift review --accept",
            ),
            ("case x in x) drift init;; esac", "drift init"),
            ("! drift init", "drift init"),
            ("(drift init)", "drift init"),
            ("time drift init", "drift init"),
            ("command drift init", "drift init"),
            ("builtin drift init", "drift init"),
            ("exec -a x drift init", "drift init"),
            ("f(){ drift init; }; f", "drift init"),
            ("x() { drift init; }; x", "drift init"),
            ("function f { drift init; }", "drift init"),
            ("sudo -u root drift init", "drift init"),
            ("sudo -E -u x drift init", "drift init"),
            ("sudo -u drift drift init", "drift init"),
            ("doas drift init", "drift init"),
            ("doas -u x drift init", "drift init"),
            ("env -u FOO drift init", "drift init"),
            ("env -C /tmp drift init", "drift init"),
            ("env -S 'drift init'", "drift init"),
            ("timeout 5 drift init", "drift init"),
            ("timeout -s KILL 5 drift init", "drift init"),
            (
                "timeout 60 env DRIFT_SETUP_PERSON=1 drift setup --confirm I-x",
                "DRIFT_SETUP_PERSON",
            ),
            (
                "sudo -u me DRIFT_SETUP_PERSON=1 drift setup --confirm I-x",
                "DRIFT_SETUP_PERSON",
            ),
            ("nice -n 5 drift init", "drift init"),
            ("nice -5 drift init", "drift init"),
            ("nohup drift init &", "drift init"),
            ("xargs -n1 drift review --reject", "drift review --reject"),
            (
                "xargs -I {} drift review --reject {}",
                "drift review --reject",
            ),
            ("watch drift init", "drift init"),
            ("watch -n 1 drift init", "drift init"),
            ("watch 'drift init'", "drift init"),
            ("stdbuf -o0 drift init", "drift init"),
            ("su -c 'drift init' me", "drift init"),
            ("npm exec drift init", "drift init"),
            ("npm exec -- drift init", "drift init"),
            ("npm x drift init", "drift init"),
            ("pnpm exec drift init", "drift init"),
            ("pnpm dlx @dadbodgeoff/drift init", "drift init"),
            ("yarn drift init", "drift init"),
            ("yarn dlx @dadbodgeoff/drift init", "drift init"),
            ("bun x @dadbodgeoff/drift init", "drift init"),
            ("npx -p @dadbodgeoff/drift drift init", "drift init"),
            ("npx --package=@dadbodgeoff/drift drift init", "drift init"),
            ("npx --package @dadbodgeoff/drift drift init", "drift init"),
            ("npx -c 'drift init'", "drift init"),
            ("node node_modules/.bin/drift init", "drift init"),
            ("cargo run -- init", "drift init"),
            ("cargo run --release -- init", "drift init"),
            (
                "cargo run -p drift-cli -- review --accept D-x",
                "drift review --accept",
            ),
            ("cargo run --bin drift -- init", "drift init"),
            ("cargo +nightly run -- init", "drift init"),
            ("printf -v DRIFT_SETUP_PERSON 1", "DRIFT_SETUP_PERSON"),
            (
                "export DRIFT_SETUP_PERSON_NONINTERACTIVE=1",
                "DRIFT_SETUP_PERSON_NONINTERACTIVE",
            ),
            (
                "DRIFT_SETUP_PERSON_NONINTERACTIVE=1 drift setup --list",
                "DRIFT_SETUP_PERSON_NONINTERACTIVE",
            ),
            ("unset CLAUDECODE", "unset CLAUDECODE"),
            ("unset DRIFT_AGENT", "unset DRIFT_AGENT"),
            ("DRIFT_AGENT=0 drift setup --list", "DRIFT_AGENT=0"),
            (
                "drift findings --issue F-x --write a.md --force",
                "drift findings --force",
            ),
        ] {
            assert_eq!(shell_policy_change(cmd).as_deref(), Some(what), "{cmd}");
        }
        // What the reader cannot read is not judged (the person's usual prompt), never
        // approved.
        for cmd in [
            "$(echo drift) init",
            "bash script.sh",
            "python3 - <<EOF\nimport os\nEOF",
            "cargo run --bin other -- init",
            "cargo run --example demo -- init",
            "cargo test -- init",
            "npm run build",
        ] {
            assert_eq!(shell_policy_change(cmd), None, "{cmd}");
            assert!(!crate::lookup::read_only_drift(cmd), "{cmd}");
        }
    }

    /// On a pseudo-terminal (`script`, `unbuffer`, `expect`, `socat ... pty`, Python's
    /// `pty`) or with the agent's environment cleared, Drift would take a run without
    /// `--by` as a person's: a `drift setup` or `drift investigate` that writes there is a
    /// policy change, and so is every change the reader sees anywhere.
    #[test]
    fn a_pseudo_terminal_makes_a_missing_by_a_persons() {
        let on_terminal = |sub: &str| format!("drift {sub} on a terminal, without --by agent");
        for (cmd, what) in [
            (
                "script -qec \"drift setup --confirm S-1234\" /dev/null",
                "drift setup --confirm".to_string(),
            ),
            (
                "script -qc 'drift setup --answer S-x=yes' /dev/null",
                on_terminal("setup"),
            ),
            (
                "script --command 'drift investigate --record I-x=internal --reason r' /dev/null",
                on_terminal("investigate"),
            ),
            (
                "script -q /dev/null drift setup --answer S-x=yes",
                on_terminal("setup"),
            ),
            (
                "unbuffer drift setup --answer S-x=yes",
                on_terminal("setup"),
            ),
            ("unbuffer -p drift setup", on_terminal("setup")),
            (
                "expect -c 'spawn drift setup --answer S-x=yes; interact'",
                on_terminal("setup"),
            ),
            (
                "python3 -c 'import pty; pty.spawn([\"drift\", \"setup\", \"--answer\", \"S-x=yes\"])'",
                on_terminal("setup"),
            ),
            (
                "python -c \"import pty,os; os.environ['A']='1'; pty.spawn(['drift','setup','--confirm','I-x'])\"",
                "drift setup --confirm".to_string(),
            ),
            (
                "python3 -c 'import pty; pty.spawn([\"sh\", \"-c\", \"drift setup --answer S-x=yes\"])'",
                on_terminal("setup"),
            ),
            (
                "python3 -c 'import os; os.environ[\"DRIFT_SETUP_PERSON\"] = \"1\"'",
                "DRIFT_SETUP_PERSON".to_string(),
            ),
            (
                "socat - EXEC:'drift setup --answer S-x=yes',pty,stderr",
                on_terminal("setup"),
            ),
            (
                "socat -d pty,raw SYSTEM:\"drift setup --confirm I-x\"",
                "drift setup --confirm".to_string(),
            ),
            ("env -i drift setup --answer S-x=yes", on_terminal("setup")),
            (
                "env -u CLAUDECODE drift investigate --record I-x=internal --reason r",
                on_terminal("investigate"),
            ),
        ] {
            assert_eq!(shell_policy_change(cmd), Some(what), "{cmd}");
        }
        // `--by agent`, or a run that writes nothing, is an agent's there too.
        for cmd in [
            "script -qc 'drift setup --answer S-x=yes --by agent --reason r' /dev/null",
            "script -qc 'drift setup --list' /dev/null",
            "unbuffer drift investigate --json",
            "unbuffer drift card a.ts",
            "env -i drift setup --json",
        ] {
            assert_eq!(shell_policy_change(cmd), None, "{cmd}");
        }
    }

    /// A `--help` anywhere is never a change; nor is a run that only reads, `--by person`
    /// or not.
    #[test]
    fn help_and_read_only_runs_are_not_policy_changes() {
        for cmd in [
            "drift init --help",
            "drift init -h",
            "drift review --accept --help",
            "drift findings --branch --help",
            "drift setup --confirm I-x --help",
            "drift setup --list --by person",
            "drift setup --json --by person",
            "drift setup --agent-brief --by person",
            "drift investigate --json --by person",
            "drift investigate --list --by person",
            "drift investigate --by person",
        ] {
            assert_eq!(shell_policy_change(cmd), None, "{cmd}");
        }
        // What writes stays a change: `--help` after `--` is an argument.
        for (cmd, what) in [
            ("drift init -- --help", "drift init"),
            ("drift setup --by person", "drift setup --by person"),
            (
                "drift setup --answer S-x=yes --by person",
                "drift setup --by person",
            ),
            (
                "drift investigate --record I-x=internal --by person",
                "drift investigate --by person",
            ),
        ] {
            assert_eq!(shell_policy_change(cmd).as_deref(), Some(what), "{cmd}");
        }
    }

    #[test]
    fn lookups_and_agents_answers_are_not_policy_changes() {
        for cmd in [
            "drift card app/api/a/route.ts",
            "drift check",
            "drift check --include-hidden",
            "drift review --list",
            "drift review --show D-x --all-outliers",
            "drift review --hidden",
            "drift review --hidden --json",
            "drift review --json",
            "drift setup --list",
            "drift setup --json --evidence",
            "drift setup --agent-brief",
            "drift setup --answer S-x=no --reason r --evidence a.py:3",
            "drift setup --answer S-x=no --by agent --reason r",
            "drift setup --answers answers.json --by=agent",
            "drift investigate --json",
            "drift investigate --record I-x=not-a-check --reason r --evidence a.py:3",
            "drift practices --hints",
            "drift census --json --max 15",
            "drift findings --json",
            "drift findings",
            "drift findings --issue F-x",
            "drift findings --issue F-x --write /tmp/issue.md",
            "drift export claude-settings",
            "drift export claude-settings > /tmp/settings.json",
            "drift export agents-md --write AGENTS.md",
            "drift review --log",
            "drift review --shown D-x",
            "echo drift init",
            "grep -rn DRIFT_SETUP_PERSON src",
            "echo $DRIFT_SETUP_PERSON",
            "unset DRIFT_SETUP_PERSON",
            "cat <<EOF\ndrift init\nEOF",
            "drift card a.ts # drift init",
            "git commit -m 'drift review --accept D-x'",
            "drifter init",
            "ls > drift",
        ] {
            assert_eq!(shell_policy_change(cmd), None, "{cmd}");
        }
    }

    #[test]
    fn priming_lists_default_tier_first_and_caps_suggestions() {
        let items = vec![(true, "s1"), (false, "d1"), (true, "s2"), (true, "s3")];
        assert_eq!(pick_primed(items), (vec!["d1", "s1", "s2"], 1));
        let many: Vec<_> = (0..6).map(|i| (i >= 5, i)).collect();
        assert_eq!(pick_primed(many), (vec![0, 1, 2, 3], 2));
        assert_eq!(
            pick_primed(vec![(true, 1), (true, 2), (true, 3)]),
            (vec![1, 2], 1)
        );
    }
}
