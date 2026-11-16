//! `drift setup` as one flow, for a person's first run: what Drift read, then each
//! decision asked once, in plain words, then what was decided and written, the command
//! that changes each decision later, and the one command to run in CI.
//!
//! The decisions, in this order:
//!
//! 1. The proposals, one at a time, most useful first: the mined conventions in the
//!    order `drift review` asks them (the default tier, then the best suggestions), then
//!    the practices from the map, then layering from the map, each labelled as the rest
//!    of the product labels it.
//! 2. Which compose file is deployed, only where the compose files that describe one
//!    service disagree about how exposed its routes are: the deployment questions
//!    `drift setup --list` asks ([`setup::Setup::questions`]), recorded under
//!    `security.not_deployed` as they always are. Asked before the baseline, not after
//!    it: a compose file left out changes which routes are reachable, and so what the
//!    baseline holds.
//! 3. The security baseline (`drift security --write-baseline`).
//! 4. The agent integrations Drift writes itself: the AGENTS.md block (`drift export
//!    agents-md`) and the Claude Code permission entries (`drift export
//!    claude-settings`). The Claude Code plugin is installed by Claude Code, so it is
//!    named, not asked.
//!
//! Nothing is accepted, recorded, written or shown to an agent without a person's yes.
//! Enter skips: it writes nothing and the question is asked again next time. A "no" is
//! recorded where the product records one (a proposal rejected in the conventions file,
//! a compose file as deployed, and a `setup:` line for the baseline and each agent
//! integration, [`setup::declined_id`]), so a later run asks only what is still
//! undecided. Every rule accepted here advises. Each decision is recorded by the code
//! the single commands use: `drift init` (run first where there is no conventions file),
//! `drift review`'s accept and reject ([`from_map_cli::accept_ids`] for a practice from
//! the map), [`setup::Setup::answer`], the writers of `drift security --write-baseline`
//! and `drift export`.
//!
//! Three ways to run it ([`How`]): asking on a reader (a terminal, or `--guided`), from
//! a script (`--yes-to`, `--no-to`), or not at all (no terminal and no answers, or an
//! agent's run): then nothing is written and every question is printed with the flag
//! that answers it. Text from the repository (paths, symbols, summaries) is escaped as
//! the other prompts escape it ([`sanitize`]).

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::path::Path;

use anyhow::{Context, bail};
use drift_core::RepoFacts;
use drift_mine::mine::DEFAULT_MAX_PER_REPO;
use drift_mine::policy::{
    CONFIG_FILE, CONVENTIONS_FILE, Convention, ConventionsFile, LOCK_FILE, Lock, Mode, Status,
};
use drift_mine::ratchet;
use drift_mine::report::sanitize;
use drift_mine::security::{Exposure, Inventory};

use crate::from_map_cli;
use crate::setup::{self, Setup};

/// How the flow gets its answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum How {
    /// One question at a time on the reader (a terminal, or `--guided`).
    Ask,
    /// From `--yes-to` and `--no-to`; what they do not name is skipped.
    Scripted,
    /// Nothing is asked and nothing written: each question is printed with the flag
    /// that answers it.
    Dry,
}

/// The answers of a scripted run: the keys said yes to and no to. A key is a
/// proposal's id (`D-…`), a deployment question's id (`S-…`: yes, only for tests),
/// `baseline`, `agents-md` or `claude-settings`.
#[derive(Debug, Clone, Default)]
pub struct Script {
    yes: BTreeSet<String>,
    no: BTreeSet<String>,
}

impl Script {
    /// Refused, with nothing changed, when a key is in both lists.
    pub fn new(yes: &[String], no: &[String]) -> anyhow::Result<Script> {
        let clean = |l: &[String]| -> BTreeSet<String> {
            l.iter()
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
                .collect()
        };
        let (yes, no) = (clean(yes), clean(no));
        let both: Vec<&str> = yes.intersection(&no).map(String::as_str).collect();
        if !both.is_empty() {
            bail!(
                "{} given to both --yes-to and --no-to; nothing was changed",
                both.join(", ")
            );
        }
        Ok(Script { yes, no })
    }
}

/// The question keys of the baseline and the agent integrations.
pub const BASELINE: &str = "baseline";
pub const AGENTS_MD: &str = "agents-md";
pub const CLAUDE_SETTINGS: &str = "claude-settings";

/// The file the agents block is written to, and the Claude Code settings file.
const AGENTS_FILE: &str = "AGENTS.md";
const SETTINGS_FILE: &str = ".claude/settings.json";

/// The one command to run in CI.
const CI_COMMAND: &str = "drift check --diff-base origin/main";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Answer {
    Yes,
    No,
    Skip,
    /// Skip this and the rest of the proposals.
    Stop,
}

/// Where the answers come from, and which keys of a script were asked.
struct Asker<'a> {
    how: How,
    input: &'a mut dyn BufRead,
    script: &'a Script,
    used: BTreeSet<String>,
    /// The reader ended: every question left is skipped.
    ended: bool,
}

impl Asker<'_> {
    /// The answer to the question `key`; `choices` says what each answer does.
    fn ask(&mut self, key: &str, choices: &str, out: &mut dyn Write) -> anyhow::Result<Answer> {
        match self.how {
            How::Dry => {
                let key = crate::promote::shell_word(key);
                writeln!(
                    out,
                    "  Would ask: {choices}. From a script: --yes-to {key} or --no-to {key}."
                )?;
                Ok(Answer::Skip)
            }
            How::Scripted => {
                let a = if self.script.yes.contains(key) {
                    Answer::Yes
                } else if self.script.no.contains(key) {
                    Answer::No
                } else {
                    Answer::Skip
                };
                if a != Answer::Skip {
                    self.used.insert(key.to_string());
                }
                writeln!(
                    out,
                    "  {}",
                    match a {
                        Answer::Yes => "Answered yes (--yes-to).",
                        Answer::No => "Answered no (--no-to).",
                        _ => "Skipped: neither --yes-to nor --no-to names it.",
                    }
                )?;
                Ok(a)
            }
            How::Ask => {
                if self.ended {
                    return Ok(Answer::Skip);
                }
                write!(out, "  {choices} > ")?;
                out.flush()?;
                let mut line = String::new();
                if self.input.read_line(&mut line)? == 0 {
                    writeln!(out)?;
                    self.ended = true;
                    return Ok(Answer::Skip);
                }
                Ok(match line.trim().to_ascii_lowercase().as_str() {
                    "y" | "yes" => Answer::Yes,
                    "n" | "no" => Answer::No,
                    "q" | "quit" => Answer::Stop,
                    "" | "s" | "skip" => Answer::Skip,
                    _ => {
                        writeln!(out, "  Not one of the choices: skipped.")?;
                        Answer::Skip
                    }
                })
            }
        }
    }

    /// Keys the script named that no question asked.
    fn unused(&self) -> Vec<&str> {
        self.script
            .yes
            .iter()
            .chain(self.script.no.iter())
            .filter(|k| !self.used.contains(*k))
            .map(String::as_str)
            .collect()
    }
}

/// What the end of the run says.
#[derive(Debug, Default)]
struct Summary {
    /// One line per decision taken in this run, with the command that changes it.
    decided: Vec<String>,
    /// What was asked and skipped: asked again next time.
    skipped: Vec<String>,
    /// What an earlier run or command decided, not asked again.
    kept: Vec<String>,
    /// Files written, by path.
    written: BTreeSet<String>,
    /// The keys answered whose answer was not recorded (the line that says why is
    /// printed where it happened).
    not_recorded: Vec<String>,
}

fn s(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// Repository text as a prompt shows it.
fn shown(text: &str) -> String {
    sanitize(text, 240)
}

/// `drift setup`'s guided flow ([`How`]). Writes to `out` only; reads answers from
/// `input` ([`How::Ask`]) or `script` ([`How::Scripted`]). `no_from_map`: proposals
/// from the map are off, as `drift init --no-from-map` has them (none asked, none
/// written). Returns the keys a person answered whose answer was not recorded (each said
/// in the output, with why): a script fails on them, as nothing it named may pass
/// unrecorded in silence.
pub(crate) fn run(
    cli: &crate::Cli,
    how: How,
    script: &Script,
    no_from_map: bool,
    input: &mut dyn BufRead,
    out: &mut dyn Write,
) -> anyhow::Result<Vec<String>> {
    let root: &Path = &cli.root;
    // On stderr, so nothing read or piped from stdout changes.
    eprintln!("Reading the repository (this can take a minute on a large one)...");
    // No fact cache is written either: a run whose every answer is Enter leaves every
    // file as it was (`drift init`, run on a person's first answer, keeps its own).
    let mut facts = crate::read_only_facts(cli)?;
    let mut ask = Asker {
        how,
        input,
        script,
        used: BTreeSet::new(),
        ended: false,
    };
    let mut sum = Summary::default();
    if how == How::Dry {
        writeln!(
            out,
            "This run asks nothing and writes nothing (no terminal and no --yes-to or --no-to, or an agent's run): it prints what `drift setup` would ask.\n"
        )?;
    }

    // Where there is no conventions file yet, the proposals are what `drift init` would
    // write, in memory: `drift init` runs only once a person answers one of them, so a
    // run that skips every question writes nothing.
    let existing = ConventionsFile::load(root)?;
    let fresh = existing.is_none();
    let mut policy = match existing {
        Some(p) => p,
        None => planned(root, &facts, no_from_map),
    };
    // A key no question has is a typo, not a skip: refused before anything is written.
    if how == How::Scripted {
        known_keys(script, &policy, &Setup::new(root, &facts)?)?;
    }

    // What Drift read.
    let mut inv = crate::security_inventory(cli, root, &facts);
    writeln!(out, "What Drift read")?;
    for line in read_lines(&facts, &inv) {
        writeln!(out, "  {line}")?;
    }

    // The proposals.
    writeln!(out, "\nProposals")?;
    if fresh {
        writeln!(
            out,
            "  There is no {CONVENTIONS_FILE} yet: these are what `drift init` would propose. A yes or a no to one runs `drift init` first (it writes {CONVENTIONS_FILE} and {LOCK_FILE}, every convention a proposal, none accepted); skipping every one writes nothing."
        )?;
    }
    proposals(
        cli,
        fresh,
        no_from_map,
        &mut facts,
        &mut policy,
        &mut ask,
        &mut sum,
        out,
    )?;

    // From here on the config is read and written through drift setup's own record.
    let mut config = Setup::new(root, &facts)?;

    // Which compose file is deployed.
    if deployment(&mut config, &inv, &mut ask, &mut sum, out)? {
        // An answer moved routes: the baseline is counted on what Drift reads now.
        inv = crate::security_inventory(cli, root, &facts);
    }

    // The security baseline.
    baseline(root, &facts, &inv, &mut config, &mut ask, &mut sum, out)?;

    // Agents.
    agents(root, &mut config, &mut ask, &mut sum, out)?;

    // The questions this flow does not ask.
    let others = config
        .questions(false)
        .iter()
        .filter(|q| !matches!(q.kind, setup::Kind::Deployment))
        .count();
    done(&sum, how, others, &ask.unused(), out)?;
    Ok(sum.not_recorded)
}

/// Refuses, with nothing changed, a key of `script` that names no question this flow
/// has: no convention of `policy` (proposed or decided), no compose file's question, and
/// none of [`BASELINE`], [`AGENTS_MD`], [`CLAUDE_SETTINGS`]. A key that names a question
/// decided already is not refused: it is reported as not used.
fn known_keys(script: &Script, policy: &ConventionsFile, config: &Setup<'_>) -> anyhow::Result<()> {
    let mut known: BTreeSet<String> = policy.conventions.iter().map(|c| c.id.clone()).collect();
    known.extend(
        config
            .questions(true)
            .into_iter()
            .filter(|q| matches!(q.kind, setup::Kind::Deployment))
            .map(|q| q.id),
    );
    known.extend([BASELINE, AGENTS_MD, CLAUDE_SETTINGS].map(str::to_string));
    let unknown: Vec<String> = script
        .yes
        .iter()
        .chain(&script.no)
        .filter(|k| !known.contains(*k))
        .map(String::as_str)
        .map(shown)
        .collect();
    if !unknown.is_empty() {
        bail!(
            "--yes-to or --no-to names {}, which is no question of `drift setup`: a proposal's id, a compose file's question id, {BASELINE}, {AGENTS_MD} or {CLAUDE_SETTINGS} (`drift setup` with no terminal prints each with its key). Nothing was changed.",
            unknown.join(", ")
        );
    }
    Ok(())
}

/// At most five lines: the files by language, the entry points and how many have a
/// guard Drift found, and what Drift could not read.
fn read_lines(facts: &RepoFacts, inv: &Inventory) -> Vec<String> {
    let mut out = vec![crate::read_line(facts, None)];
    let entries: Vec<&drift_mine::security::EntryRow> =
        inv.entry_points.iter().filter(|e| !e.local).collect();
    if entries.is_empty() {
        out.push("Entry points: none found in what Drift read.".to_string());
    } else {
        let guarded = entries.iter().filter(|e| !e.guards.is_empty()).count();
        let unread = entries
            .iter()
            .filter(|e| e.guards.is_empty() && !e.opaque.is_empty())
            .count();
        let none = entries.len() - guarded - unread;
        out.push(format!(
            "Entry points: {} a caller can reach; {guarded} with a guard Drift found, {none} with none in what it read, {unread} whose guard it could not read.",
            entries.len()
        ));
    }
    let mut left: BTreeMap<String, usize> = BTreeMap::new();
    for sk in &facts.skipped {
        let why = serde_json::to_value(sk.reason)
            .ok()
            .and_then(|v| v.as_str().map(|w| w.replace('_', " ")))
            .unwrap_or_else(|| "left out".to_string());
        *left.entry(why).or_default() += 1;
    }
    let unparsed = facts.files.iter().filter(|f| !f.parse_ok).count();
    let mut parts: Vec<String> = Vec::new();
    if !left.is_empty() {
        let n: usize = left.values().sum();
        let why: Vec<String> = left.iter().map(|(w, k)| format!("{k} {w}")).collect();
        parts.push(format!("{n} file{} left out ({})", s(n), why.join(", ")));
    }
    if unparsed > 0 {
        parts.push(format!("{unparsed} file{} that did not parse", s(unparsed)));
    }
    if parts.is_empty() {
        out.push("Not read: nothing; every file Drift looked at was parsed.".to_string());
    } else {
        out.push(format!(
            "Not read: {}. What they hold is unknown: never counted as following or breaking a rule.",
            parts.join("; ")
        ));
    }
    out
}

/// The conventions file `drift init` would write for the repository as it is, in
/// memory only: what a run that writes nothing shows as the proposals. Mined as
/// `drift census` mines (which is `drift init`'s mining where there is no conventions
/// file), with the proposals from the map `drift init` adds (none with `no_from_map`,
/// as `drift init --no-from-map` adds none).
fn planned(root: &Path, facts: &RepoFacts, no_from_map: bool) -> ConventionsFile {
    let roles = (
        drift_mine::policy::test_roles(root, false),
        drift_mine::policy::kind_roles(root, false),
    );
    let (mut mined, accepted) = crate::census_mine(root, facts, DEFAULT_MAX_PER_REPO, roles);
    let python = drift_mine::policy::python_proposals(root, false);
    crate::withhold_python(python, &mut mined, &accepted);
    let (mut policy, _) = ConventionsFile::merge_carrying(
        None,
        &crate::engine(),
        mined.kinds.clone(),
        &mined.candidates,
    );
    // As `drift init` keeps them: no wiring convention while the feature is off.
    if !crate::wiring::enabled(root).unwrap_or(false) {
        policy.conventions.retain(|c| !c.rule.is_wiring());
    }
    // What it collected beside the proposals is `drift init`'s report, not asked here.
    let _ = from_map_cli::for_init(root, facts, &mut policy, python.on(), no_from_map);
    policy
}

/// `drift init`, run as its own command (its report is not this flow's): the policy
/// and the lock it writes are what every later question reads.
fn run_init(cli: &crate::Cli, no_from_map: bool) -> anyhow::Result<()> {
    let exe = std::env::current_exe().context("finding the drift binary to run `drift init`")?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--root").arg(&cli.root);
    if cli.no_cache {
        cmd.arg("--no-cache");
    }
    cmd.arg("init");
    if no_from_map {
        cmd.arg("--no-from-map");
    }
    let done = cmd
        .stdin(std::process::Stdio::null())
        .output()
        .context("running `drift init`")?;
    if !done.status.success() {
        bail!(
            "`drift init` failed, so none of your answers was recorded:\n{}",
            String::from_utf8_lossy(&done.stderr).trim_end()
        );
    }
    Ok(())
}

/// One proposal as it is asked.
struct Card {
    id: String,
    /// Where it came from, in the product's words.
    from: String,
    lines: Vec<String>,
    /// What is a proposal from the map of any kind: accepted through
    /// `from_map_cli::accept_ids`, which records what breaks it today in the lock.
    from_map: bool,
    /// The command that promotes it later, for a practice (`drift review --accept`
    /// does not write a declined practice as `drift practices promote` writes it).
    promote: Option<String>,
}

/// Each undecided proposal, one at a time; the decisions are recorded at the end of
/// the step, as `drift review` records them. `fresh`: there is no conventions file yet,
/// and `policy` is what `drift init` would write ([`planned`]).
#[allow(clippy::too_many_arguments)]
fn proposals(
    cli: &crate::Cli,
    fresh: bool,
    no_from_map: bool,
    facts: &mut RepoFacts,
    policy: &mut ConventionsFile,
    ask: &mut Asker<'_>,
    sum: &mut Summary,
    out: &mut dyn Write,
) -> anyhow::Result<()> {
    let root: &Path = &cli.root;
    let cap = drift_mine::rank::resolve_cap(false, None, policy.suggestion_cap).0;
    let (mined, cap_note) = crate::review_queue(policy, cap);
    let undecided = |kind: Option<&str>| -> Vec<String> {
        policy
            .conventions
            .iter()
            .filter(|c| from_map_cli::undecided(c))
            .filter(|c| match kind {
                Some(k) => c.from_map.as_deref() == Some(k),
                None => c.from_map.as_deref() != Some(from_map_cli::PRACTICE),
            })
            .map(|c| c.id.clone())
            .collect()
    };
    // None while proposals from the map are off: `drift init --no-from-map` drops them.
    let (practices, layering) = if no_from_map {
        (Vec::new(), Vec::new())
    } else {
        // Layering (and any other kind from the map), after the practices.
        (undecided(Some(from_map_cli::PRACTICE)), undecided(None))
    };
    let decided_before = policy
        .conventions
        .iter()
        .filter(|c| c.status != Status::Proposed)
        .count();
    if decided_before > 0 {
        sum.kept.push(format!(
            "{decided_before} convention{} decided earlier (`drift review --list` lists what is still proposed)",
            s(decided_before)
        ));
    }
    if mined.is_empty() && practices.is_empty() && layering.is_empty() {
        writeln!(out, "  Nothing to decide: no proposal is waiting.")?;
        return Ok(());
    }
    // What the cards read: the check of every proposal (its outliers, and those Drift
    // could not read), the practice map (a practice's follows and differs).
    let report = if mined.is_empty() && layering.is_empty() {
        None
    } else {
        Some(crate::review_report_on(cli, facts, policy)?)
    };
    let map =
        (!practices.is_empty()).then(|| crate::practices::report_units_kept(root, facts, None));
    let lock = Lock::load(root)?;
    let mut cards: Vec<Card> = Vec::new();
    for id in mined.iter().chain(practices.iter()).chain(layering.iter()) {
        let Some(c) = policy.conventions.iter().find(|c| &c.id == id) else {
            continue;
        };
        let card = match c.from_map.as_deref() {
            None => report
                .as_ref()
                .map(|r| mined_card(c, r, &lock, policy_is_new(root))),
            Some(from_map_cli::PRACTICE) => map.as_ref().and_then(|m| practice_card(c, m)),
            Some(_) => report.as_ref().map(|r| layering_card(c, r)),
        };
        match card {
            Some(card) => cards.push(card),
            None => writeln!(
                out,
                "  [{}] {}: no longer qualifies as the code stands; left as proposed (`drift init` drops it).",
                shown(&c.id),
                shown(&c.summary)
            )?,
        }
    }
    writeln!(
        out,
        "  {} waiting, one at a time. Nothing is accepted unless you say yes; every rule accepted here advises (`drift check` reports a new violation of it and fails nothing).",
        cards.len()
    )?;
    if let Some(note) = cap_note {
        writeln!(out, "  {note}")?;
    }
    let mut accept: Vec<String> = Vec::new();
    let mut decline: Vec<String> = Vec::new();
    let mut skipped = 0;
    let mut stop = false;
    let of = cards.len();
    for (k, card) in cards.iter().enumerate() {
        writeln!(
            out,
            "\n  [{} of {of}] {} ({})",
            k + 1,
            shown(&card.id),
            card.from
        )?;
        for l in &card.lines {
            writeln!(out, "    {l}")?;
        }
        if stop {
            skipped += 1;
            writeln!(out, "  Skipped.")?;
            continue;
        }
        let answer = ask.ask(
            &card.id,
            "y = accept (advise), n = decline (not offered again), Enter = skip for now, q = skip the rest",
            out,
        )?;
        match answer {
            Answer::Yes => accept.push(card.id.clone()),
            Answer::No => decline.push(card.id.clone()),
            Answer::Skip => skipped += 1,
            Answer::Stop => {
                skipped += 1;
                stop = true;
            }
        }
    }
    if skipped > 0 {
        sum.skipped
            .push(format!("{skipped} proposal{}", s(skipped)));
    }
    if ask.how == How::Dry || (accept.is_empty() && decline.is_empty()) {
        return Ok(());
    }
    // A person answered: only now is `drift init` run where there was no conventions
    // file, and the answers are recorded in what it wrote.
    if fresh {
        run_init(cli, no_from_map)?;
        sum.written.insert(CONVENTIONS_FILE.to_string());
        sum.written.insert(LOCK_FILE.to_string());
        writeln!(
            out,
            "\n  Ran `drift init`: it wrote {CONVENTIONS_FILE} and {LOCK_FILE}, every convention a proposal, none accepted. Your answers are recorded in them."
        )?;
        *policy = ConventionsFile::load(root)?
            .with_context(|| format!("`drift init` wrote no {CONVENTIONS_FILE}"))?;
        let proposed: BTreeSet<String> = policy
            .conventions
            .iter()
            .filter(|c| c.status == Status::Proposed)
            .map(|c| c.id.clone())
            .collect();
        let gone: Vec<String> = accept
            .iter()
            .chain(&decline)
            .filter(|id| !proposed.contains(*id))
            .map(String::as_str)
            .map(shown)
            .collect();
        if !gone.is_empty() {
            writeln!(
                out,
                "  Not recorded: `drift init` did not propose {} as shown here. `drift setup` asks about what it proposed.",
                gone.join(", ")
            )?;
            sum.not_recorded.extend(
                accept
                    .iter()
                    .chain(&decline)
                    .filter(|id| !proposed.contains(*id))
                    .cloned(),
            );
            accept.retain(|id| proposed.contains(id));
            decline.retain(|id| proposed.contains(id));
        }
    }
    // A proposal from the map is accepted by the code `drift review --accept` runs:
    // what breaks it today recorded in the lock (a practice first written as `drift
    // practices promote` writes it); one that no longer qualifies stays proposed.
    let map_ids: Vec<String> = accept
        .iter()
        .filter(|id| cards.iter().any(|c| &c.id == *id && c.from_map))
        .cloned()
        .collect();
    if !map_ids.is_empty() {
        let repo = facts.clone();
        let lists = [map_ids.as_slice()];
        match from_map_cli::accept_ids(root, || Ok(repo), policy, &lists, &[]) {
            Ok(lines) => {
                for l in lines {
                    writeln!(out, "  {l}")?;
                }
                sum.written.insert(LOCK_FILE.to_string());
            }
            Err(e) => {
                writeln!(out, "  Not accepted: {e:#}")?;
                sum.not_recorded.extend(map_ids.iter().cloned());
                accept.retain(|id| !map_ids.contains(id));
            }
        }
    }
    for id in &accept {
        let Some(c) = policy.get_mut(id) else {
            continue;
        };
        c.status = Status::Accepted;
        c.mode = Mode::Advise;
        let from = cards
            .iter()
            .find(|c| &c.id == id)
            .map_or_else(String::new, |c| c.from.clone());
        let (shown_id, word) = (shown(id), crate::promote::shell_word(id));
        sum.decided.push(format!(
            "Accepted {shown_id} ({from}), advising. Undo: `drift review --reject {word}`; to have it fail a check: `drift review --block {word}`."
        ));
    }
    for id in &decline {
        let Some(c) = policy.get_mut(id) else {
            continue;
        };
        c.status = Status::Rejected;
        c.mode = Mode::Advise;
        let word = crate::promote::shell_word(id);
        let later = cards
            .iter()
            .find(|c| &c.id == id)
            .and_then(|c| c.promote.clone())
            .unwrap_or_else(|| format!("drift review --accept {word}"));
        sum.decided.push(format!(
            "Declined {}: rejected in {CONVENTIONS_FILE}, not offered again. To accept it later: `{later}`.",
            shown(id)
        ));
    }
    // What the person was shown when they accepted is kept beside each, as `drift
    // review` keeps it.
    policy.freeze_accepted_now();
    policy.save(root)?;
    sum.written.insert(CONVENTIONS_FILE.to_string());
    Ok(())
}

/// Whether there is no lock yet (a run that writes nothing, before `drift init`).
fn policy_is_new(root: &Path) -> bool {
    !root.join(LOCK_FILE).exists()
}

/// What `drift check` reports of `c` now: the units that differ, and how many it could
/// not read to the end (`unsure`: never a violation, never counted as differing). A
/// unit the neighbour gate held back is neither.
fn checked<'r>(
    c: &Convention,
    report: &'r drift_mine::check::CheckReport,
) -> (Vec<&'r drift_mine::check::Violation>, usize) {
    let flagged = report.violations.iter().filter(|v| v.id == c.id);
    let unread = flagged.clone().filter(|v| v.unsure).count();
    let differ = flagged
        .filter(|v| !v.unsure && !v.suppressed_neighbour)
        .collect();
    (differ, unread)
}

/// The first unit that differs, as a card shows it.
fn first_differ(differ: &[&drift_mine::check::Violation]) -> String {
    match differ.first() {
        Some(v) => format!(
            "Differs: {}:{} {}",
            shown(&v.path),
            v.line,
            shown(&v.symbol)
        ),
        None => "Differs: none in the code now.".to_string(),
    }
}

/// A mined proposal: its outliers as `drift review` shows them now.
fn mined_card(
    c: &Convention,
    report: &drift_mine::check::CheckReport,
    lock: &Lock,
    no_lock: bool,
) -> Card {
    let (differ, unread) = checked(c, report);
    // Member lines only: a fingerprint line is the second key of one of them.
    let recorded = lock
        .entries
        .iter()
        .filter(|(id, key)| id == &c.id && Lock::split_fingerprint(key).is_none())
        .count();
    let mut lines = vec![
        format!("Rule: {}", shown(&c.summary)),
        format!(
            "Evidence: {} of {} follow it, {} differ, {unread} not read (never reported).",
            c.evidence.holders,
            c.evidence.total,
            differ.len()
        ),
        format!("Follows: {}", shown(&c.example)),
        first_differ(&differ),
        format!(
            "Agents, once accepted: {}.",
            drift_mine::admission::convention_view(c).text
        ),
    ];
    lines.push(if no_lock {
        "If accepted: it advises; what differs today is recorded in drift.lock by `drift init`, so only new code is reported."
            .to_string()
    } else {
        format!(
            "If accepted: it advises; the {recorded} that differ{} today {} in drift.lock already, so only new code is reported.",
            if recorded == 1 { "s" } else { "" },
            if recorded == 1 { "is" } else { "are" }
        )
    });
    Card {
        id: c.id.clone(),
        from: format!("mined, tier: {}", c.describe_tier()),
        lines,
        from_map: false,
        promote: None,
    }
}

/// A practice from the map: what it stands for now ([`from_map_cli::recompute`]);
/// `None` when it no longer qualifies.
fn practice_card(c: &Convention, map: &drift_mine::practices::PracticesReport) -> Option<Card> {
    let cand = from_map_cli::recompute(map, c)?;
    let ex = |e: &drift_mine::practices::Example| {
        format!("{}:{} {}", shown(&e.path), e.line, shown(&e.symbol))
    };
    let lines = vec![
        format!("Rule: {}", shown(&c.summary)),
        format!(
            "Evidence: {} follow it, {} differ, {} not read (never reported).",
            cand.follows,
            cand.exceptions.len(),
            cand.unknown
        ),
        match &cand.example {
            Some(e) => format!("Follows: {}", ex(e)),
            None => "Follows: no unit to name.".to_string(),
        },
        match cand.exceptions.first() {
            Some(e) => format!("Differs: {}", ex(e)),
            None => "Differs: none.".to_string(),
        },
        format!(
            "If accepted: it advises, written as `drift practices promote` writes it (the {} that differ today recorded in drift.lock), and agents are told it as a rule.",
            cand.exceptions.len()
        ),
    ];
    Some(Card {
        id: c.id.clone(),
        from:
            "from the map, not mined: a practice; it did not go through the miner's measured gates"
                .to_string(),
        lines,
        from_map: true,
        promote: Some(crate::promote::command(&cand)),
    })
}

/// Layering from the map: a layer whose files never import a target; what differs and
/// what could not be read as `drift check` reports them now.
fn layering_card(c: &Convention, report: &drift_mine::check::CheckReport) -> Card {
    let (differ, unread) = checked(c, report);
    let kind = c
        .from_map
        .as_deref()
        .unwrap_or(drift_mine::from_map::LAYERING);
    Card {
        id: c.id.clone(),
        from: format!(
            "from the map, not mined: {kind}; it did not go through the miner's measured gates"
        ),
        lines: vec![
            format!("Rule: {}", shown(&c.summary)),
            format!(
                "Evidence: {} of the {} files there that import code of this repository follow it, {} differ, {unread} not read (never reported).",
                c.evidence.holders,
                c.evidence.total,
                differ.len()
            ),
            format!("Follows: {}", shown(&c.example)),
            first_differ(&differ),
            // What `from_map_cli::accept_ids` records on a yes: what breaks it today.
            match differ.len() {
                0 => "If accepted: it advises; nothing differs today, so any new code against it is reported.".to_string(),
                n => format!(
                    "If accepted: it advises; the {n} that differ{} today {} recorded in drift.lock, so only new code is reported.",
                    if n == 1 { "s" } else { "" },
                    if n == 1 { "is" } else { "are" }
                ),
            },
        ],
        from_map: true,
        promote: None,
    }
}

/// The routes whose compose files disagree about how exposed they are, by the
/// description that decides (the most exposed, listed first): (file, exposure, routes).
fn disagreeing(inv: &Inventory) -> Vec<(String, Exposure, usize)> {
    let mut by: BTreeMap<(String, Exposure), usize> = BTreeMap::new();
    for e in inv.entry_points.iter().filter(|e| !e.local) {
        let Some(first) = e.descriptions.first() else {
            continue;
        };
        if e.descriptions.iter().any(|d| d.exposure != first.exposure) {
            *by.entry((first.compose.clone(), first.exposure))
                .or_default() += 1;
        }
    }
    by.into_iter().map(|((f, x), n)| (f, x, n)).collect()
}

/// Which compose file is deployed, asked only where compose files disagree. True when
/// an answer was written (the inventory changes).
fn deployment(
    config: &mut Setup<'_>,
    inv: &Inventory,
    ask: &mut Asker<'_>,
    sum: &mut Summary,
    out: &mut dyn Write,
) -> anyhow::Result<bool> {
    let disagree = disagreeing(inv);
    if disagree.is_empty() {
        return Ok(false);
    }
    writeln!(out, "\nWhich compose file is deployed")?;
    for (file, exposure, n) in &disagree {
        writeln!(
            out,
            "  {n} route{} read as {} because `{}` says so; another description of the same code says less. Where they disagree, the most exposed decides.",
            s(*n),
            setup::reach(*exposure),
            shown(file)
        )?;
    }
    let asked: Vec<setup::Question> = config
        .questions(false)
        .into_iter()
        .filter(|q| matches!(q.kind, setup::Kind::Deployment))
        .collect();
    let waiting = asked
        .iter()
        .filter(|q| q.status == setup::Status::Proposed)
        .count();
    if waiting > 0 {
        writeln!(
            out,
            "  {waiting} answer{} an agent gave wait{} for you: `drift setup --review`.",
            s(waiting),
            if waiting == 1 { "s" } else { "" }
        )?;
    }
    let open: Vec<setup::Question> = asked
        .into_iter()
        .filter(|q| q.status != setup::Status::Proposed)
        .collect();
    if open.is_empty() {
        let answered = config
            .questions(true)
            .iter()
            .filter(|q| matches!(q.kind, setup::Kind::Deployment) && q.answered.is_some())
            .count();
        if answered > 0 {
            writeln!(
                out,
                "  Answered earlier: {answered} compose file{}. `drift setup --list --all` shows the answers; `drift setup --forget <id>` asks one again.",
                s(answered)
            )?;
            sum.kept.push(format!(
                "{answered} compose file{} answered earlier",
                s(answered)
            ));
        } else {
            writeln!(
                out,
                "  Nothing to ask: leaving any one of these files out moves no route on its own. Drift keeps assuming the most exposed description decides. A file that only serves tests can be listed under `security.not_deployed` in {CONFIG_FILE}."
            )?;
        }
        return Ok(false);
    }
    let mut wrote = false;
    for mut q in open {
        config.count(&mut q);
        let Some(file) = q.deployment_file().map(str::to_string) else {
            continue;
        };
        writeln!(out, "\n  {} ({})", shown(&file), q.id)?;
        for p in &q.text {
            writeln!(out, "    {}", sanitize(p, 600))?;
        }
        if let Some(c) = q.choices.iter().find(|c| c.answer == "tests-only") {
            writeln!(
                out,
                "    If it is only for tests or local development: {}",
                sanitize(&c.effect, 600)
            )?;
        }
        let answer = ask.ask(
            &q.id,
            &format!(
                "Is `{}` only for tests or local development? y = yes, Drift leaves it out; n = no, it deploys (recorded); Enter = skip for now",
                shown(&file)
            ),
            out,
        )?;
        let given = match answer {
            Answer::Yes => "tests-only",
            Answer::No => "deploys",
            Answer::Skip | Answer::Stop => {
                sum.skipped
                    .push(format!("whether {} deploys", shown(&file)));
                continue;
            }
        };
        match config.answer(&q.id, given, &setup::Given::person()) {
            Ok(said) => {
                writeln!(out, "  -> {said}")?;
                wrote = true;
                sum.written.insert(CONFIG_FILE.to_string());
                sum.decided.push(format!(
                    "{}: {}. Undo: `drift setup --forget {}`.",
                    shown(&file),
                    if given == "tests-only" {
                        "only for tests, left out of what is deployed"
                    } else {
                        "deploys"
                    },
                    q.id
                ));
            }
            Err(e) => {
                writeln!(out, "  -> not answered: {e:#}")?;
                sum.not_recorded.push(q.id.clone());
            }
        }
    }
    Ok(wrote)
}

/// The security baseline: what it is, how many findings it would hold, and whether to
/// write it.
fn baseline(
    root: &Path,
    facts: &RepoFacts,
    inv: &Inventory,
    config: &mut Setup<'_>,
    ask: &mut Asker<'_>,
    sum: &mut Summary,
    out: &mut dyn Write,
) -> anyhow::Result<()> {
    writeln!(out, "\nSecurity baseline")?;
    let id = setup::declined_id(BASELINE);
    match ratchet::load_baseline(root) {
        Err(e) => {
            writeln!(
                out,
                "  {} cannot be read ({e}): not asked.",
                ratchet::SECURITY_LOCK
            )?;
            return Ok(());
        }
        Ok(Some(_)) => {
            writeln!(
                out,
                "  {} is there: `drift check` reports a finding that is not in it. Not asked.",
                ratchet::SECURITY_LOCK
            )?;
            sum.kept.push(format!(
                "the security baseline ({})",
                ratchet::SECURITY_LOCK
            ));
            return Ok(());
        }
        Ok(None) if config.declined(BASELINE) => {
            writeln!(
                out,
                "  You said no earlier (recorded as {id}): not asked. `drift setup --forget {id}` asks again."
            )?;
            sum.kept
                .push(format!("no security baseline (said no earlier, {id})"));
            return Ok(());
        }
        Ok(None) => {}
    }
    let found = crate::baseline_findings(root, facts, inv)?;
    let mut by_kind: BTreeMap<&str, usize> = BTreeMap::new();
    for (kind, _) in found.keys() {
        *by_kind.entry(kind.as_str()).or_default() += 1;
    }
    let kinds: Vec<String> = ratchet::KINDS
        .iter()
        .filter_map(|(k, _)| by_kind.get(k).map(|n| format!("{n} {k}")))
        .collect();
    writeln!(
        out,
        "  The security baseline ({}) records the security findings Drift reads today, so that `drift check` reports only the ones that appear later. It accepts today's findings as they are and fixes none of them. While it exists, `drift check` fails when a finding that is not in it appears, of every kind but {} (those only advise until you set them to fail), as `drift security --write-baseline` writes it.",
        ratchet::SECURITY_LOCK,
        ratchet::ADVISE_FIRST.join(", ")
    )?;
    writeln!(
        out,
        "  Today: {}.",
        if found.is_empty() {
            "no finding; with a baseline, any later one is reported".to_string()
        } else {
            format!(
                "{} ({})",
                crate::count(found.len(), "finding"),
                kinds.join(", ")
            )
        }
    )?;
    let answer = ask.ask(
        BASELINE,
        "Record them, so that only new ones are reported? y = yes, n = no (not asked again), Enter = not now",
        out,
    )?;
    match answer {
        Answer::Yes => match write_baseline(root, &found) {
            Ok(()) => {
                writeln!(
                    out,
                    "  -> wrote {} ({}).",
                    ratchet::SECURITY_LOCK,
                    crate::count(found.len(), "finding")
                )?;
                sum.written.insert(ratchet::SECURITY_LOCK.to_string());
                sum.decided.push(format!(
                    "Security baseline written ({}). To go without it: delete {}; `drift security --write-baseline` writes it again from what is there then.",
                    crate::count(found.len(), "finding"),
                    ratchet::SECURITY_LOCK
                ));
            }
            Err(e) => {
                writeln!(out, "  -> not written: {e:#}")?;
                sum.not_recorded.push(BASELINE.to_string());
            }
        },
        Answer::No => {
            let id = config.record_declined(BASELINE, "whether to write the security baseline")?;
            writeln!(out, "  -> no baseline; recorded as {id} in {CONFIG_FILE}.")?;
            sum.written.insert(CONFIG_FILE.to_string());
            sum.decided.push(format!(
                "No security baseline (recorded as {id}). To write it later: `drift security --write-baseline`; `drift setup --forget {id}` asks again."
            ));
        }
        Answer::Skip | Answer::Stop => sum.skipped.push("the security baseline".to_string()),
    }
    Ok(())
}

/// What `drift security --write-baseline` writes: every finding, every kind failing
/// but those that advise first. Written as `drift upgrade` writes the same file: never
/// through a symbolic link that leads outside the repository, and replaced whole (a
/// temporary file renamed over it), so a committed link cannot have a yes write
/// elsewhere and an interrupted write leaves the old file.
fn write_baseline(root: &Path, found: &ratchet::Findings) -> anyhow::Result<()> {
    let fail = ratchet::default_fail();
    drift_mine::policy::write_no_follow(
        root,
        Path::new(ratchet::SECURITY_LOCK),
        ratchet::render_lock_with(found, &fail).as_bytes(),
    )
}

/// The agent integrations Drift writes: what each tells the agent, and whether to
/// write it.
fn agents(
    root: &Path,
    config: &mut Setup<'_>,
    ask: &mut Asker<'_>,
    sum: &mut Summary,
    out: &mut dyn Write,
) -> anyhow::Result<()> {
    writeln!(out, "\nAgents")?;
    // What agents are shown: accepted conventions their admission shows.
    let shown_rules = crate::project::Project::open_for_agents(root)
        .map(|p| p.accepted().count())
        .unwrap_or(0);
    let agents_path = root.join(AGENTS_FILE);
    let agents_text = std::fs::read_to_string(&agents_path).unwrap_or_default();
    let settings_path = root.join(SETTINGS_FILE);
    let settings_text = std::fs::read_to_string(&settings_path).unwrap_or_default();
    let entries = crate::lookup::claude_settings("drift");
    // Written already only when the file reads as JSON and merging the entries changes
    // nothing: a file that does not read is not written either (both sides would be
    // nothing), and asking says why a yes cannot write it.
    let settings_there = !settings_text.trim().is_empty()
        && serde_json::from_str::<serde_json::Value>(&settings_text)
            .ok()
            .is_some_and(|v| {
                crate::lookup::merge_settings(&settings_text, &entries).as_ref() == Some(&v)
            });
    let integrations: [(&str, bool, String, String); 2] = [
        (
            AGENTS_MD,
            agents_text.contains(crate::export::START),
            format!(
                "{AGENTS_FILE}: a block between Drift's markers (the rest of the file is kept) that every agent reading {AGENTS_FILE} is given: {}, and to run `drift card <file>` before searching how the code does something. Nothing only proposed is in it. `drift export agents-md --write {AGENTS_FILE}` refreshes it after `drift review`.",
                match shown_rules {
                    0 => "no rule yet (none accepted that agents are shown)".to_string(),
                    n => format!(
                        "the {} agents are shown",
                        crate::count(n, "accepted convention")
                    ),
                }
            ),
            format!("Write the Drift block to {AGENTS_FILE}?"),
        ),
        (
            CLAUDE_SETTINGS,
            settings_there,
            format!(
                "{SETTINGS_FILE}: lets Claude Code run Drift's read-only lookups (drift card, map, example, check, practices) and its read-only MCP tools without asking each time. It tells the agent no rule; the rest of the file is kept."
            ),
            format!("Add Drift's read-only lookups to {SETTINGS_FILE}?"),
        ),
    ];
    for (key, there, what, question) in integrations {
        let id = setup::declined_id(key);
        if there {
            writeln!(out, "  {what}")?;
            writeln!(out, "  Already written: not asked.")?;
            sum.kept.push(format!("{key} (already written)"));
            continue;
        }
        if config.declined(key) {
            writeln!(
                out,
                "  {key}: you said no earlier (recorded as {id}): not asked. `drift setup --forget {id}` asks again."
            )?;
            sum.kept.push(format!("no {key} (said no earlier, {id})"));
            continue;
        }
        writeln!(out, "  {what}")?;
        let answer = ask.ask(
            key,
            &format!("{question} y = yes, n = no (not asked again), Enter = not now"),
            out,
        )?;
        match answer {
            Answer::Yes => {
                let wrote = if key == AGENTS_MD {
                    crate::project::Project::open_for_agents(root).and_then(|p| {
                        let block = crate::export::block(&p);
                        crate::write_out(
                            root,
                            &agents_path,
                            crate::export::splice(&agents_text, &block).as_bytes(),
                        )
                    })
                } else {
                    write_settings(root, &settings_path, &settings_text, &entries)
                };
                match wrote {
                    Ok(()) => {
                        let file = if key == AGENTS_MD {
                            AGENTS_FILE
                        } else {
                            SETTINGS_FILE
                        };
                        writeln!(out, "  -> wrote {file}.")?;
                        sum.written.insert(file.to_string());
                        sum.decided.push(if key == AGENTS_MD {
                            format!(
                                "{AGENTS_FILE} has the Drift block. Refresh it after `drift review`: `drift export agents-md --write {AGENTS_FILE}`; to take it out, delete the lines between the drift markers."
                            )
                        } else {
                            format!(
                                "{SETTINGS_FILE} lets Claude Code run Drift's read-only lookups unprompted. To take them out, remove the drift entries under permissions.allow."
                            )
                        });
                    }
                    Err(e) => {
                        writeln!(out, "  -> not written: {e:#}")?;
                        sum.not_recorded.push(key.to_string());
                    }
                }
            }
            Answer::No => {
                let id = config.record_declined(key, &format!("about {key}"))?;
                writeln!(out, "  -> not written; recorded as {id} in {CONFIG_FILE}.")?;
                sum.written.insert(CONFIG_FILE.to_string());
                sum.decided.push(format!(
                    "No {key} (recorded as {id}). `drift setup --forget {id}` asks again."
                ));
            }
            Answer::Skip | Answer::Stop => sum.skipped.push(key.to_string()),
        }
    }
    writeln!(
        out,
        "  The Claude Code plugin (its hooks tell the agent the accepted rules before it writes a file, advise after an edit, and stop the end of a turn only for a rule in block mode) is installed by Claude Code, not by Drift: `claude plugin marketplace add dadbodgeoff/drift`, then `claude plugin install drift@drift`."
    )?;
    Ok(())
}

/// What `drift export claude-settings --write` writes.
fn write_settings(
    root: &Path,
    path: &Path,
    existing: &str,
    entries: &serde_json::Value,
) -> anyhow::Result<()> {
    let merged = crate::lookup::merge_settings(existing, entries)
        .with_context(|| format!("{} is not a JSON object; nothing written", path.display()))?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)?;
    }
    let mut text = serde_json::to_string_pretty(&merged)?;
    text.push('\n');
    crate::write_out(root, path, text.as_bytes())
}

/// The end: what was decided and written, how to change each, and the one command
/// for CI.
fn done(
    sum: &Summary,
    how: How,
    others: usize,
    unused: &[&str],
    out: &mut dyn Write,
) -> anyhow::Result<()> {
    writeln!(out, "\nDone")?;
    if how == How::Dry {
        writeln!(
            out,
            "  Nothing was changed. To answer from a script (a person's run): drift setup --by person --yes-to <keys> --no-to <keys>, with DRIFT_SETUP_PERSON=1 where there is no terminal. What neither names is skipped."
        )?;
    }
    if !sum.decided.is_empty() {
        writeln!(out, "  Decided now:")?;
        for d in &sum.decided {
            writeln!(out, "    {d}")?;
        }
    }
    if !sum.kept.is_empty() {
        writeln!(out, "  Decided before, not asked: {}.", sum.kept.join("; "))?;
    }
    if !sum.skipped.is_empty() && how != How::Dry {
        writeln!(
            out,
            "  Skipped, asked again by the next `drift setup`: {}.",
            sum.skipped.join(", ")
        )?;
    }
    if others > 0 {
        writeln!(
            out,
            "  {} more question{} only you can answer (Terraform, checks Drift could not prove): `drift setup --interactive`.",
            others,
            s(others)
        )?;
    }
    if !unused.is_empty() {
        writeln!(
            out,
            "  Not asked, so not used: {} (decided already, or no such question now).",
            unused.join(", ")
        )?;
    }
    if !sum.not_recorded.is_empty() {
        let keys: Vec<String> = sum.not_recorded.iter().map(|k| shown(k)).collect();
        writeln!(
            out,
            "  Answered but not recorded: {} (each line above says why). Nothing of these was changed; run `drift setup` again once it can be{}.",
            keys.join(", "),
            if how == How::Scripted {
                format!(
                    ". This run exits {} so a script does not take it for done",
                    crate::upgrade::EXIT_PENDING
                )
            } else {
                String::new()
            }
        )?;
    }
    if sum.written.is_empty() {
        if how != How::Dry {
            writeln!(out, "  Nothing written.")?;
        }
    } else {
        let files: Vec<&str> = sum.written.iter().map(String::as_str).collect();
        writeln!(
            out,
            "  Written: {}. Commit them: git add {}",
            files.join(", "),
            files.join(" ")
        )?;
    }
    writeln!(
        out,
        "  In CI: {CI_COMMAND} (it fails only on a new violation of a rule in block mode, or a security finding the baseline does not hold, of a kind it sets to fail)."
    )?;
    Ok(())
}
