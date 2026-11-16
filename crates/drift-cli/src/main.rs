//! `drift`: the convention lockfile for AI agents.

mod agent;
mod card;
mod derived;
mod export;
mod findings;
mod history;
mod lookup;
mod mcp;
mod pr;
mod practices;
mod project;
mod promote;
mod review_log;
mod scan;
mod setup;
mod wiring;
mod workspace;

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Instant;

use anyhow::{Context, bail};
use clap::{Parser, Subcommand, ValueEnum};
use drift_core::{RepoFacts, SymbolKind};
use drift_mine::check::{CheckReport, Scope};
use drift_mine::mine::{
    Candidate, DEFAULT_MAX_PER_REPO, MAX_PER_ROLE, MIN_BLOCK_ROLE_SIZE, MIN_LIFT,
    MIN_LIFT_EXTERNAL_CALL, MIN_LOWER_BOUND, MIN_ROLE_SIZE, MineOptions, Mined, Rule, WithheldCard,
    mine_keeping, mine_with_kinds,
};
use drift_mine::policy::{
    CONVENTIONS_FILE, Convention, ConventionsFile, LOCK_FILE, Lock, Mode, Status,
};
use drift_mine::rank;
use drift_mine::tier::{self, DEFAULT_RULE_KINDS, Tier};
use scan::{ScanOptions, scan};

#[derive(Parser)]
#[command(
    name = "drift",
    version,
    about = "Learn your codebase's conventions and check new code against the ones you approve",
    after_help = "Getting started: `drift init` proposes conventions (none is checked until you \
                  accept it), `drift review` accepts, blocks or rejects them, `drift check` reports \
                  new violations. `drift census` previews them without changing conventions or the lock. \
                  Each command's --help has examples."
)]
struct Cli {
    /// Repository root.
    #[arg(long, global = true, default_value = ".")]
    root: PathBuf,
    /// Disable the on-disk fact cache.
    #[arg(long, global = true)]
    no_cache: bool,
    #[command(subcommand)]
    command: Command,
}

/// How many suggestion-tier conventions a human view lists (`drift_mine::rank`). The
/// default tier is always listed in full; nothing is hidden from `check` or agents.
#[derive(clap::Args, Debug, Clone, Copy, Default)]
struct CapArgs {
    /// Suggestions to list, best first (default 5, or `suggestion_cap` in
    /// .drift/conventions.yaml). The default tier is always listed in full.
    #[arg(long, value_name = "N", conflicts_with = "all")]
    suggestions: Option<usize>,
    /// List every suggestion.
    #[arg(long)]
    all: bool,
}

impl CapArgs {
    fn resolve(
        self,
        policy: Option<rank::SuggestionCap>,
    ) -> (rank::SuggestionCap, rank::CapSource) {
        rank::resolve_cap(self.all, self.suggestions, policy)
    }
}

/// `drift review --set-log`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum LogSetting {
    On,
    Off,
}

// Parsed once per run: `review`'s many flags make it the largest variant, which costs nothing.
#[allow(clippy::large_enum_variant)]
#[derive(Subcommand)]
enum Command {
    /// Index the repository and print a summary (or the full fact index with --json).
    Scan {
        /// Print the full fact index as JSON to stdout instead of the summary.
        #[arg(long)]
        json: bool,
        /// Write the fact index as JSON to this file.
        #[arg(long)]
        out: Option<PathBuf>,
        /// Worker threads (0 = one per CPU).
        #[arg(long, default_value_t = 0)]
        threads: usize,
    },
    /// Print the facts for one file.
    Facts {
        /// Repo-relative path of the file.
        file: String,
    },
    /// Debugging output for parser development.
    #[command(hide = true)]
    Debug {
        #[arg(value_enum)]
        what: DebugKind,
    },
    /// Learn conventions and write them as proposals (advise mode) to .drift/conventions.yaml,
    /// plus drift.lock. Re-running keeps every decision and id, and adds new proposals.
    #[command(after_help = INIT_HELP)]
    Init {
        /// Maximum conventions proposed.
        #[arg(long, default_value_t = DEFAULT_MAX_PER_REPO)]
        max: usize,
        /// Relearn the file-kind vocabulary frozen in the conventions file (to adopt
        /// new kinds after an upgrade). Existing conventions keep their ids, but the
        /// files their roles cover may change.
        #[arg(long)]
        refresh_kinds: bool,
        /// Also say what was kept back and why: the candidates not proposed, each
        /// package's count or the reason it has none, and where agents meet what is
        /// known.
        #[arg(long)]
        explain: bool,
        #[command(flatten)]
        cap: CapArgs,
    },
    /// Show learned conventions with their evidence, without changing conventions or the lock.
    /// The default tier (may block once a person accepts it in block mode) is listed first,
    /// then suggestions.
    #[command(after_help = CENSUS_HELP)]
    Census {
        /// Maximum conventions shown.
        #[arg(long, default_value_t = DEFAULT_MAX_PER_REPO)]
        max: usize,
        /// Show every outlier instead of the first three.
        #[arg(long)]
        all_outliers: bool,
        /// Print the proposals as JSON (every outlier included). Writes no files.
        #[arg(long)]
        json: bool,
        /// Only list proposals of this tier (ranks stay those of the full list).
        #[arg(long, value_enum, default_value_t = TierFilter::All)]
        tier: TierFilter,
        /// With --json: also give each proposal the tier a pre-registered candidate
        /// decision would give it (`candidate`). Study use only: the tier, blocking and
        /// advice of every convention stay those of the shipped tier.
        #[arg(long, value_enum, requires = "json")]
        candidate: Option<CandidateTier>,
        /// Propose Python conventions whatever `proposals.python` in .drift/config.yaml
        /// says. They are on by default since decision D13-py was closed, so this changes
        /// a census only where a person turned them off (`proposals: {python: off}`). For
        /// the study's view; writes nothing.
        #[arg(long)]
        python_proposals: bool,
        /// Also form and mine test roles (selector version 4), as `test_roles` in the
        /// config's `experimental` list does: off by default. For the study; writes nothing.
        #[arg(long)]
        test_roles: bool,
        /// Also form and mine kind roles (selector version 4): roles of one structural
        /// kind (components, hooks, pydantic models, routers, ...) across the repository,
        /// as `kind_roles` in the config's `experimental` list does: off by default. For
        /// the study; writes nothing.
        #[arg(long)]
        kind_roles: bool,
        /// How much of the repository Drift maps: the seven coverage measures (parsed, in
        /// a package, in a structural role, imports resolved, entry points, under a mined
        /// and under a shown convention), the production and test maps apart, a table per
        /// package and the unmapped files by reason. With --json, as JSON. Writes nothing.
        #[arg(long)]
        coverage: bool,
        /// Mine over every entry point Drift lists, not only those the last measured
        /// build listed: the routes `drift security` and the practice map read
        /// (registered in a function, by a file-convention router, by a pattern list
        /// unpacked into `urlpatterns`) become members of the roles conventions are
        /// mined for. A preview of the next measured round: the precision of what it
        /// proposes was not measured, and nothing is written.
        #[arg(long, conflicts_with = "coverage")]
        listed: bool,
        /// List what each gate of mining dropped instead of the proposals: how many per
        /// gate, then the candidates (role, rule, holders of members, the gate's threshold
        /// and the candidate's value, whether the target is the repository's or a
        /// dependency's), strongest first. `--why GATE` (`universal`, `wilson`, `lift`,
        /// `cap_avoid`, ...): only that gate. With --json, every dropped candidate.
        /// Observation only: what is proposed is exactly what `census` proposes.
        #[arg(
            long,
            value_name = "GATE",
            num_args = 0..=1,
            default_missing_value = "",
            conflicts_with = "coverage"
        )]
        why: Option<String>,
        #[command(flatten)]
        cap: CapArgs,
    },
    /// Answer the few questions only you can answer (which compose files are test
    /// stacks, which Terraform target group sends requests to a service, whether a
    /// helper is your check), one at a time; the answers go to .drift/config.yaml.
    /// Without a terminal, lists the questions with the command that answers each.
    #[command(after_help = SETUP_HELP)]
    Setup {
        /// Print the open questions, each with the command that answers it, and change
        /// nothing.
        #[arg(long)]
        list: bool,
        /// Print the open questions as JSON (schema `drift-setup-questions`) and change
        /// nothing.
        #[arg(long)]
        json: bool,
        /// Answer a question: ID=ANSWER, as `--list` prints them (several: repeat it, or
        /// give several pairs; all in one run). `skip` changes nothing.
        #[arg(long, value_name = "ID=ANSWER", num_args = 1..)]
        answer: Vec<String>,
        /// Answer several questions in one run from a JSON file (`-` for standard
        /// input): a list of `{"id", "answer", "reason", "evidence": ["file:line"]}`.
        #[arg(long, value_name = "FILE")]
        answers: Option<PathBuf>,
        /// Take out what the answer to ID wrote, so the question is asked again.
        #[arg(long, value_name = "ID")]
        forget: Vec<String>,
        /// Ask (or list) every question again, the answered ones too.
        #[arg(long)]
        all: bool,
        /// Ask on standard input even when it is not a terminal (a person's run:
        /// with `--by person` and DRIFT_SETUP_PERSON=1 when standard input is not a
        /// terminal).
        #[arg(long)]
        interactive: bool,
        /// Who answers: `person` (the default when standard input is a terminal, unless
        /// CLAUDECODE is set or DRIFT_AGENT=1: an agent's environment) or `agent` (the
        /// default otherwise). An agent's answer takes effect only where it can make
        /// Drift more cautious; any other waits for a person (`--review`). Without a
        /// terminal, `person` writes only with DRIFT_SETUP_PERSON=1, set by the person
        /// who runs the script. A person's answer that makes a fact asks them to type
        /// its id on the terminal (/dev/tty), unless DRIFT_SETUP_PERSON_NONINTERACTIVE=1
        /// is set too, for a script a person runs.
        #[arg(long, value_name = "person|agent")]
        by: Option<String>,
        /// Why the answer is right, naming what was read: required of an agent.
        #[arg(long)]
        reason: Option<String>,
        /// With --answer: `file:line` of each place read to decide (repeat for more).
        /// With --json: give each question the excerpts a careful reader looks at.
        #[arg(long, value_name = "FILE:LINE", num_args = 0..)]
        evidence: Option<Vec<String>>,
        /// For a person: each answer an agent gave that waits, with its reason;
        /// confirm, reject or skip it (the first id typed once on the terminal, then
        /// `y` for each).
        #[arg(long)]
        review: bool,
        /// For a person: confirm the agent's answer to ID (repeat for more), typing the
        /// id on the terminal (/dev/tty, not standard input). A terminal is weak evidence
        /// of a person and no command-line tool can prove one: every confirmation is
        /// recorded with `confirmed_by` in .drift/config.yaml, so the review of the
        /// committed diff is the final check.
        #[arg(long, value_name = "ID")]
        confirm: Vec<String>,
        /// For a person: reject the agent's answer to ID, typing the id on the terminal;
        /// it is not asked again on the same evidence (repeat for more).
        #[arg(long, value_name = "ID")]
        reject: Vec<String>,
        /// Print the instructions an agent follows to answer the questions (Markdown),
        /// and change nothing.
        #[arg(long)]
        agent_brief: bool,
    },
    /// Every route Drift could not settle (authentication or authorization unknown or
    /// none, reach unknown or inside only), grouped by what would settle it, with the
    /// evidence to read; and the outcomes an agent or a person records for each. An
    /// outcome that would make a fact waits for a person (`drift setup --review`).
    #[command(after_help = INVESTIGATE_HELP)]
    Investigate {
        /// Print the open items, each with the command that records an outcome, and
        /// change nothing (the default).
        #[arg(long)]
        list: bool,
        /// Print the items as JSON (schema `drift-investigate`) and change nothing.
        #[arg(long)]
        json: bool,
        /// List every item, the settled ones too.
        #[arg(long)]
        all: bool,
        /// Only these items (with --json; repeat for more).
        #[arg(long, value_name = "ID")]
        item: Vec<String>,
        /// With --json: one page of the list in short, N items (1 to 200; schema
        /// `drift-investigate-page`, `next_offset` for the next page).
        #[arg(long, value_name = "N", requires = "json", conflicts_with_all = ["item", "evidence"], value_parser = clap::value_parser!(u16).range(1..=setup::investigate::PAGE_MAX as i64))]
        limit: Option<u16>,
        /// With --limit: the first item of the page (the `next_offset` a page gave).
        #[arg(long, value_name = "N", requires = "limit")]
        offset: Option<usize>,
        /// Record an outcome: ID=OUTCOME, as `--list` prints them (several: repeat it).
        #[arg(long, value_name = "ID=OUTCOME", num_args = 1..)]
        record: Vec<String>,
        /// Record several outcomes in one run from a JSON file (`-` for standard input):
        /// a list of `{"id", "outcome", "reason", "evidence": ["file:line"], ...}`.
        #[arg(long, value_name = "FILE")]
        answers: Option<PathBuf>,
        /// Who records: `person` (the default when standard input is a terminal, unless
        /// CLAUDECODE is set or DRIFT_AGENT=1) or `agent` (the default otherwise).
        #[arg(long, value_name = "person|agent")]
        by: Option<String>,
        /// Why, naming what was read: required of an agent (for a finding: why it is a
        /// gap; for a skip: the note the person reads).
        #[arg(long)]
        reason: Option<String>,
        /// With --record: `file:line` of each place read (repeat for more).
        /// With --json: give each item the excerpts a careful reader looks at.
        #[arg(long, value_name = "FILE:LINE", num_args = 0..)]
        evidence: Option<Vec<String>>,
        /// With --record of a finding: the routes it is about, of the item's (a part of
        /// the route or its handler's `file:line`; repeat for more). Without it, the routes
        /// whose files --evidence names; with neither, all the item's.
        #[arg(long, value_name = "ROUTE", num_args = 0..)]
        routes: Option<Vec<String>>,
        /// A finding's title.
        #[arg(long)]
        title: Option<String>,
        /// A finding's suggested fix, in words.
        #[arg(long)]
        fix: Option<String>,
        /// A finding's patch: a unified diff file the agent wrote (not applied).
        #[arg(long, value_name = "FILE")]
        patch: Option<PathBuf>,
        /// Print the instructions an agent follows to work through the items (Markdown),
        /// and change nothing.
        #[arg(long)]
        agent_brief: bool,
    },
    /// What an agent found while investigating: local findings (`.drift/findings/`) and
    /// gap reports (`.drift/gap-reports/`), both git-ignored and never posted. On a
    /// person's request: an issue draft, or a local branch with the agent's patch.
    #[command(after_help = FINDINGS_HELP)]
    Findings {
        /// Print them as JSON (schema `drift-findings`).
        #[arg(long)]
        json: bool,
        /// Print an issue draft (Markdown) for finding ID; nothing is posted.
        #[arg(long, value_name = "ID")]
        issue: Option<String>,
        /// With --issue: write the draft to this new file instead (never under `.drift/`,
        /// to `drift.lock`, or through a symbolic link).
        #[arg(long, value_name = "FILE", requires = "issue")]
        write: Option<PathBuf>,
        /// With --write: replace the file if it exists (a person's flag).
        #[arg(long, requires = "write")]
        force: bool,
        /// Make a local branch `drift/<id>` with the patch of finding ID, without
        /// touching the working tree; nothing is pushed.
        #[arg(long, value_name = "ID")]
        branch: Option<String>,
    },
    /// Accept, block, set to advise or reject conventions (interactive when no flags are
    /// given; interactive review shows proposals only).
    #[command(after_help = REVIEW_HELP)]
    Review {
        /// Accept these convention ids (comma-separated) in advise mode.
        #[arg(long, value_delimiter = ',')]
        accept: Vec<String>,
        /// Reject these convention ids (comma-separated).
        #[arg(long, value_delimiter = ',')]
        reject: Vec<String>,
        /// Accept these and set them to block (default-tier conventions; see --force). A
        /// promoted practice blocks only when a replay of the units last added to its
        /// place (git history) allows it; --force does not lift that.
        #[arg(long, value_delimiter = ',')]
        block: Vec<String>,
        /// With --block: also block suggestion-tier conventions. Roles with fewer
        /// than 15 members never block.
        #[arg(long, requires = "block")]
        force: bool,
        /// Set these to advise, keeping them accepted: the way back from --block.
        /// A proposed or rejected convention is accepted in advise mode.
        #[arg(long, value_delimiter = ',')]
        advise: Vec<String>,
        /// Accept these (keeping their mode) and show them to agents whatever their rule
        /// family's track record (`agents: show` in conventions.yaml). Accepting alone
        /// shows agents only the default tier and suggestions of an admitted family.
        #[arg(long, value_delimiter = ',')]
        show_to_agents: Vec<String>,
        /// Print the cards interactive review would ask about, each with its outliers,
        /// and change nothing.
        #[arg(long)]
        list: bool,
        /// Print these cards (any status) with their outliers, and change nothing.
        #[arg(long, value_delimiter = ',', value_name = "IDS")]
        show: Vec<String>,
        /// List every outlier on each card, not the first 5.
        #[arg(long)]
        all_outliers: bool,
        /// Mark an outlier of convention ID as a legitimate exception ("fine because…"):
        /// with --member and --reason. `drift check`, the hooks and CI then list it as
        /// exempt instead of as a violation; nothing else about the convention changes.
        #[arg(long, value_name = "ID", requires_all = ["member", "reason"])]
        exempt: Option<String>,
        /// Remove the exception of --member from convention ID.
        #[arg(long, value_name = "ID", requires = "member")]
        unexempt: Option<String>,
        /// With --exempt or --unexempt: the member, as path#symbol (`drift review --show
        /// <id>` prints it for each outlier).
        #[arg(long, value_name = "PATH#SYMBOL")]
        member: Option<String>,
        /// With --exempt: why the member is fine, in one line of at most 120 characters
        /// (agents see it).
        #[arg(long, value_name = "TEXT", requires = "exempt")]
        reason: Option<String>,
        /// Record this run's decisions and the cards it shows in the review log
        /// (`.drift/review-log/`, local only: nothing is ever sent), even when
        /// `review_log` is off in .drift/conventions.yaml.
        #[arg(long)]
        log: bool,
        /// Turn the review log on or off for every later `drift review` and the Studio
        /// (`review_log: on` in .drift/conventions.yaml; off unless set).
        #[arg(long, value_enum, value_name = "on|off")]
        set_log: Option<LogSetting>,
        /// Write the review log as a study file to PATH, for `eval/study/maintainer-log.mjs`.
        /// Convention ids, members and examples are replaced by hashes keyed with this
        /// repository's random salt, and reasons by their length, unless --include-paths.
        #[arg(long, value_name = "PATH")]
        export_log: Option<PathBuf>,
        /// With --export-log: keep convention ids, members (path#symbol), examples and
        /// reasons as they are.
        #[arg(long, requires = "export_log")]
        include_paths: bool,
        /// Only record in the review log that these cards were shown (the Studio does when
        /// it opens one); changes nothing, and records nothing while the log is off.
        #[arg(long, value_delimiter = ',', value_name = "IDS")]
        shown: Vec<String>,
        /// Print, as JSON, the one question each block candidate asks ("Are these the same
        /// kind of thing?"): the convention, its holders and the members it would flag, by
        /// file. Changes nothing.
        #[arg(long)]
        json: bool,
        /// Answer a block candidate's question: ID=same (accept it), ID=different (accept it
        /// with --set-apart's files exempt as a different kind) or ID=not-a-convention
        /// (reject it). Unanswered, a candidate stays one: no agent is shown it as a
        /// convention.
        #[arg(long, value_name = "ID=ANSWER")]
        answer: Option<String>,
        /// With --answer ID=different: the files (comma-separated) whose flagged members are
        /// a different kind of thing, as `--json` lists them. `drift check` exempts their
        /// members from this convention, by path.
        #[arg(long, value_delimiter = ',', value_name = "PATHS", requires = "answer")]
        set_apart: Vec<String>,
        /// With --set-apart: an entry point under an auth or validation rule (path#symbol,
        /// comma-separated) to set apart too. Without it such an entry point stays flagged.
        #[arg(
            long,
            value_delimiter = ',',
            value_name = "PATH#SYMBOL",
            requires = "set_apart"
        )]
        confirm_entry: Vec<String>,
        /// List the cards mining found and withheld (the show policy, or Python proposals
        /// off), with their evidence and why each was withheld. No agent is shown one as a
        /// convention (`drift card <file>` states the strong ones as facts about the code,
        /// not rules). Changes nothing. With --answer ID=same|different|not-a-convention a
        /// person promotes one: written to .drift/conventions.yaml as accepted by them
        /// (`promoted_from_hidden: true`; not-a-convention rejects it), after which it
        /// follows the normal tier and agent rules. With --json, each card's question.
        #[arg(long)]
        hidden: bool,
        #[command(flatten)]
        cap: CapArgs,
    },
    /// The file to copy from when writing new code like FILE.
    #[command(after_help = EXAMPLE_HELP)]
    Example {
        /// Repo-relative path of the file to write; it need not exist yet.
        file: String,
    },
    /// Check code against accepted conventions. Legacy violations in drift.lock never fail.
    /// Exits 1 when a new violation is in block mode (any new violation with --strict), 2 on
    /// error.
    #[command(after_help = CHECK_HELP)]
    Check {
        /// Only report these files (repo-relative).
        files: Vec<String>,
        /// Output format.
        #[arg(long, value_enum, default_value_t = Format::Text)]
        format: Format,
        /// Fail on any new violation, not only those in block mode, and when a file
        /// could not be checked (not parsed for lack of stack, in the tree or at the
        /// merge base); by default that fails open, with the files named.
        #[arg(long)]
        strict: bool,
        /// Report only violations introduced since the merge base with REF (a pull
        /// request's base branch, e.g. origin/main): in changed lines and added files.
        /// The merge base must be in the local history: in a shallow clone that lacks it
        /// this is an error (use `fetch-depth: 0` in CI; the GitHub Action deepens the
        /// clone itself).
        #[arg(long, value_name = "REF")]
        diff_base: Option<String>,
        /// Kept for scripts that pass it; it changes nothing. The text lists every new
        /// violation, those of accepted conventions not shown to agents marked so.
        #[arg(long, hide = true)]
        include_hidden: bool,
    },
    /// Security inventory: entry points and their guards, risky operations they
    /// reach, client code reaching server code or secrets, and environment reads.
    #[command(after_help = SECURITY_HELP)]
    Security {
        /// Only report these files (repo-relative).
        files: Vec<String>,
        /// Print the full inventory as JSON (FILES does not filter it).
        #[arg(long)]
        json: bool,
        /// Report only what the change since the merge base with this ref introduces:
        /// entry points lacking a guard their siblings share, unguarded entry points
        /// reaching a risky operation, risky operations and client leaks added, and
        /// entry points made internet-facing. Facts for a pull request; exit 0.
        #[arg(long, value_name = "REF")]
        diff_base: Option<String>,
        /// With --diff-base: GitHub Actions output (notice annotations, and a job
        /// summary when GITHUB_STEP_SUMMARY is set).
        #[arg(long, requires = "diff_base")]
        github: bool,
        /// With --diff-base: exit 1 when the change introduces any of these, by
        /// name, separated by commas: `unguarded-reaching` (an entry point where
        /// no guard was found reaching a risky operation), `no-guard` (a new entry
        /// point where no guard was found; one whose guard cannot be read is listed
        /// apart as guard unknown and never counted), `guard-gap` (an
        /// entry point lacking a guard its siblings share), `risky` (a risky
        /// operation), `leak` (a client leak), `public` (an entry point made
        /// internet-facing), or `any`. Off unless given: without it the run is
        /// facts for review and exits 0.
        #[arg(long, value_delimiter = ',', value_name = "KINDS")]
        fail_on: Vec<String>,
        /// Write the security baseline (`.drift/security.lock`): every finding of
        /// the inventory as it is now (entry points with no guard found, entry
        /// points lacking a guard or a scope their siblings share, entry points that
        /// check nothing of a signed-in caller, unguarded entry points reaching a
        /// risky operation, risky operations, client leaks), keyed
        /// by handler and route, never by line, with the inventory version that
        /// wrote it. Commit it: `drift check` and `--ratchet` report what is found
        /// later and is not in it. Every kind fails `drift check` but
        /// `unscoped-key`, which advises; with --fail-on, the kinds named fail too
        /// (kept when the baseline is written again).
        #[arg(long, conflicts_with_all = ["diff_base", "ratchet"])]
        write_baseline: bool,
        /// Report the findings that are not in the security baseline
        /// (`.drift/security.lock`), and those of it that are gone, with no commit
        /// to compare with. Exits 1 when a finding was added (with --fail-on, only
        /// for the kinds named: `unguarded-reaching`, `no-guard`, `guard-gap`,
        /// `scope-gap`, `no-authorization`, `unscoped-key`, `risky`, `whole-row`, `workflow`, `dependency`, `kubernetes`, `leak`, or `any`; without it, the kinds the baseline sets to fail): what the repository has today
        /// is accepted as it is, and nothing more of it comes in unseen.
        #[arg(long, conflicts_with = "diff_base")]
        ratchet: bool,
        /// Rows shown per section in text output (entry points with no wrapper or
        /// decorator: always the first 50; exceptions per shared guard: the first 10).
        #[arg(long, default_value_t = 20)]
        max: usize,
        /// Only the findings to look at first, ranked by what Drift read (default 10;
        /// 0 for all), repeats through one operation on one line; then how many more,
        /// and what was not ranked and why (a guard Drift could not read is never
        /// ranked). With --json, the inventory gains `top`. Changes no exit code.
        #[arg(
            long,
            value_name = "N",
            num_args = 0..=1,
            default_missing_value = "10",
            conflicts_with_all = ["diff_base", "ratchet", "write_baseline"]
        )]
        top: Option<usize>,
    },
    /// One file's place in the repository, for an agent about to touch it: package,
    /// entry points with their guards and exposure, risky operations, what its siblings
    /// of the same kind carry (and one to copy from), the accepted conventions covering
    /// it, what nearly all the code of its kind in its place does where no convention
    /// says so (facts, not rules; a file with no entry point gets these too), and what
    /// Drift does not know. The file need not exist yet.
    Card {
        /// Repo-relative path of the file (existing or planned).
        path: String,
        /// Print the card as JSON (schema 1), with every convention covering the file,
        /// accepted or proposed, with its status and mode, and its `regularities`
        #[arg(long)]
        json: bool,
    },
    /// The repository's structure: packages, layers, the package dependency graph,
    /// entry points and structural roles; or, for one file (--file), its package,
    /// layer, roles and typical peers; or one role (--role) and its typical members.
    /// Read-only: no convention is mined or written
    #[command(after_help = MAP_HELP)]
    Map {
        /// Describe one file (repo-relative): its package, layer and roles.
        #[arg(long, conflicts_with_all = ["package", "role", "files"])]
        file: Option<String>,
        /// Describe one package (its directory, `.` for the root package).
        #[arg(long, conflicts_with_all = ["role", "files"])]
        package: Option<String>,
        /// Describe one role by id (`R-xxxxxx`, from the overview or --file).
        #[arg(long, conflicts_with = "files")]
        role: Option<String>,
        /// Print the JSON.
        #[arg(long)]
        json: bool,
        /// Roles listed in the overview.
        #[arg(long, default_value_t = 25)]
        max: usize,
        /// Study: every file with its package, layer and role ids, as JSON (unbounded).
        #[arg(long, hide = true)]
        files: bool,
        /// Study, with --files: also which mined (every tier, hidden ones too) and which
        /// shown conventions cover each file.
        #[arg(long, hide = true, requires = "files")]
        conventions: bool,
        /// Study: leave test and kind roles out of the map (only the roles mining forms
        /// by default).
        #[arg(long, hide = true)]
        places_only: bool,
    },
    /// What the codebase does for each cross-cutting concern (authentication,
    /// authorization, errors, logging, API, validation, config, data access, testing):
    /// each variant with its share, where it is, what sets it apart, an example to copy,
    /// and what is unknown. Facts, not rules: read-only, exit 0. By default a recipe per
    /// kind of entry point and the findings; --all gives every concern's variant table.
    /// `drift practices promote` makes one way the rule for new code in one place.
    #[command(after_help = PRACTICES_HELP, args_conflicts_with_subcommands = true)]
    Practices {
        #[command(subcommand)]
        action: Option<PracticesAction>,
        /// Only this concern (`authn`, `authz`, `errors`, `logging`, `api`,
        /// `validation`, `config`, `data_access`, `testing`).
        #[arg(long)]
        concern: Option<String>,
        /// Only this package (its directory, `.` for the root package).
        #[arg(long)]
        package: Option<String>,
        /// Only the units of this file (repo-relative).
        #[arg(long)]
        path: Option<String>,
        /// Print the JSON (version 1).
        #[arg(long)]
        json: bool,
        /// Every concern's variant table, every variant (the default text is the recipe
        /// per kind of entry point and the findings).
        #[arg(long)]
        all: bool,
        /// With --json: every unit of each concern with its assignment (variant, none,
        /// or unknown and why), for measurement.
        #[arg(long, requires = "json")]
        units: bool,
        /// Only the `.drift/config.yaml` lines that would classify what Drift cannot
        /// tell alone (an in-repo logger, a wrapper it cannot read), as one block to
        /// merge by hand, with the units each line settles.
        #[arg(long, conflicts_with_all = ["json", "all"])]
        hints: bool,
    },
    /// Agent hook handler (reads the hook event JSON on stdin).
    #[command(after_help = HOOK_HELP)]
    Hook {
        #[arg(value_enum)]
        agent: Agent,
        /// Hook event name: SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop
        /// or SessionEnd.
        event: String,
    },
    /// Serve Drift's MCP tools over stdio.
    #[command(after_help = MCP_HELP)]
    Mcp,
    /// Export accepted conventions for agents.
    #[command(after_help = EXPORT_HELP)]
    Export {
        #[arg(value_enum)]
        what: ExportKind,
        /// File to update in place (between drift markers); prints to stdout when omitted.
        #[arg(long)]
        write: Option<PathBuf>,
    },
}

// Examples at the end of each command's --help.
const INIT_HELP: &str = "Examples:
  drift census          preview what init would propose (writes nothing)
  drift init            write the proposals to .drift/conventions.yaml, baseline drift.lock
  drift init --max 30   propose up to 30 conventions (the summary lists the default
                        tier and the 5 best suggestions; --all lists every one)

Next: `drift review` to accept, block or reject them, then commit
.drift/conventions.yaml and drift.lock.";

const CENSUS_HELP: &str = "Examples:
  drift census                    the default tier, then the 5 best suggestions
  drift census --all              every suggestion (--suggestions N: the N best)
  drift census --tier default     only those a person may set to block
  drift census --all-outliers     every outlier, not the first three
  drift census --why              what each gate of mining dropped, and why
  drift census --why wilson       only the rules below the lower bound
  drift census --json > census.json";

const SETUP_HELP: &str = "Examples:
  drift setup                          in a terminal: one question at a time; Enter skips
  drift setup --list                   the open questions, each with the command that answers it
  drift setup --json                   the same as data (schema drift-setup-questions)
  drift setup --answer S-1a2b=tests-only
                                       answer one (as --list prints it); skip changes nothing
  drift setup --forget S-1a2b          take out what that answer wrote
  drift setup --all                    ask the answered questions again too
  drift setup --answer S-1a2b=tie-1 --by agent --reason \"...\" --evidence infra/main.tf:12
                                       an agent's answer: it takes effect only where it makes
                                       Drift more cautious; any other waits for a person
  drift setup --review                 for a person: confirm or reject what an agent answered
  drift setup --confirm S-1a2b         (or --reject S-1a2b) the same for one, its id typed again
  drift setup --answers answers.json   several in one run: a JSON list of id, answer, reason, evidence
  drift setup --agent-brief            what an agent follows to answer them

Skip is always the default and writes nothing. Commit .drift/config.yaml so your teammates
get the same answers.

A person's word is typed at a terminal: --confirm, --reject, --review and a person's answer
that makes a fact ask for the id on /dev/tty (never standard input). Without --by, a run is
an agent's where CLAUDECODE is set or DRIFT_AGENT=1. A script a person runs sets
DRIFT_SETUP_PERSON=1, and DRIFT_SETUP_PERSON_NONINTERACTIVE=1 to skip typing the id; an
agent never sets them. A terminal is weak evidence of a person and no command-line tool
can prove one: every confirmation is recorded (confirmed_by in .drift/config.yaml), so the
review of the committed diff is the final check.";

const INVESTIGATE_HELP: &str = "Examples:
  drift investigate                    every route Drift could not settle, grouped by what would settle it
  drift investigate --json --evidence  the same as data (schema drift-investigate), with what to read
  drift investigate --json --evidence --item I-1a2b3c
                                       one item's evidence
  drift investigate --record I-1a2b3c=not-a-check --reason \"...\" --evidence app/svc.py:40
                                       an outcome; one that would make a fact waits for a person
  drift investigate --record I-1a2b3c=finding --title \"...\" --reason \"...\" --fix \"...\" --evidence app/svc.py:40
                                       a real gap: a local finding (drift findings), never posted
  drift investigate --answers outcomes.json
                                       several in one run
  drift investigate --agent-brief      what an agent follows to work through them
  drift setup --review                 for a person: confirm or reject what an agent proposed

Outcomes: guard:<file>#<symbol> and check:<tenant|owner|role>:<file>#<symbol> (proposals),
not-a-guard, not-a-check, reachable, internal (a proposal where Drift cannot tell),
finding, drift-gap, skip.";

const FINDINGS_HELP: &str = "Examples:
  drift findings                       the findings and gap reports written, local only
  drift findings --issue F-1a2b3c      an issue draft in Markdown; nothing is posted
  drift findings --issue F-1a2b3c --write issue.md
  drift findings --branch F-1a2b3c     a local branch with the agent's patch; nothing is pushed";

const REVIEW_HELP: &str = "Examples:
  drift review                               interactive: y accept, b block, a accept and show to agents, n reject, s skip, q quit
                                             (the default tier, then the 5 best suggestions); a block candidate
                                             asks one question: y yes, d no, these are different, n not a convention;
                                             then the practices that may be promoted: y advise, b block (after
                                             a history replay), n no (not asked again), s skip
  drift review --json                        each block candidate's question: holders, flagged members by file
  drift review --answer D-37416b=same        yes, the same kind of thing: accept it (=not-a-convention rejects it)
  drift review --answer D-37416b=different --set-apart lib/seed.ts
                                             accept it with these files exempt by path; an entry point under an
                                             auth or validation rule also needs --confirm-entry PATH#SYMBOL
  drift review --all                         interactive, every proposed suggestion
  drift review --accept D-37416b,D-04385a    accept (advise mode)
  drift review --block D-37416b              accept and block (default tier)
  drift review --advise D-37416b             back from block to advise, still accepted
  drift review --show-to-agents D-04385a     accept, and show to agents a suggestion
                                             whose rule family is below the admission bar
  drift review --reject D-04385a
  drift review --list                        the cards interactive review asks about, with
                                             their outliers (the first 5; --all-outliers)
  drift review --show D-37416b               one card with its outliers, any status
  drift review --exempt D-37416b --member app/api/ping/route.ts#GET --reason \"health check, public by design\"
                                             fine because...: check lists it as exempt, not
                                             as a violation (--unexempt with --member undoes it)
  drift review --set-log on                  record decisions and cards shown in .drift/review-log/
                                             (local only, never sent; off by default)
  drift review --export-log review-log.json  the log as a study file: ids, paths and symbols hashed
                                             (--include-paths keeps them)

Suggestions are listed best first by their evidence: the higher lower bound,
then fewer outliers, then the higher lift. `suggestion_cap: <N|all>` in
.drift/conventions.yaml changes how many are listed; none is hidden from
`drift check`, hooks or agents.

The ids are in .drift/conventions.yaml and in `drift census`. Commit
.drift/conventions.yaml afterwards: `drift check`, the hooks and CI read it.";

const EXAMPLE_HELP: &str = "Examples:
  drift example app/api/new-thing/route.ts
  drift example src/billing/billing.service.ts";

const CHECK_HELP: &str = "Examples:
  drift check                           new violations; exit 1 if one is in block mode
  drift check --strict                  exit 1 on any new violation, advise mode included
  drift check app/api/x/route.ts        only report this file
  drift check --diff-base origin/main   only what this branch introduces
  drift check --format sarif > drift.sarif

Intentional exception: `// drift-ignore <id>: <reason>` (`#` in Python)
directly above the declaration.";

const SECURITY_HELP: &str = "Examples:
  drift security                          the whole repository
  drift security app/api/export/route.ts  only rows for these files
  drift security --json                   the full inventory, for tools
  drift security --diff-base origin/main  only what this change introduces (a pull request)";

const MAP_HELP: &str = "Examples:
  drift map                               packages, layers, dependencies, entry points, roles
  drift map --package apps/web            one package
  drift map --file apps/web/lib/auth.ts   the file you are editing: package, layer, roles, peers
  drift map --role R-1a2b3c               one role and its typical members
  drift map --json                        the same, as JSON";

const PRACTICES_HELP: &str = "Examples:
  drift practices                          the recipe per kind of entry point, the findings
  drift practices --all                    every concern's variant table
  drift practices --concern authn --all    one concern
  drift practices --package apps/web       one package
  drift practices --json                   all of it, as JSON (version 1)
  drift practices --hints                  the config lines that classify what is unknown
  drift practices promote --list           the practices that may be made the rule for new code
  drift practices promote P-0f0acb --in app/api
                                           make one a convention (`drift practices promote --help`)

Facts, not rules: nothing here is enforced until a person promotes a practice
(`drift practices promote`). authn, authz, validation, errors and api make the recipe;
logging, config, data_access and testing are a preview.
Unknown units are counted against coverage, never hidden; a `practices:` line in
.drift/config.yaml (`practices: {authn: {\"lib/auth.ts#withAuth\": withAuth}}`) makes an
unclassified instrument known.";

const HOOK_HELP: &str =
    "The Claude Code plugin runs these (integrations/claude-code/hooks/hooks.json);
there is nothing to call by hand. To try one, pipe it the JSON Claude Code sends,
from the repository root:

  echo '{\"session_id\":\"try\",\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}' \\
    | drift hook claude SessionStart

Every hook exits 0; its answer, if any, is JSON on stdout.";

const MCP_HELP: &str = "Register it with an MCP client, from the repository root:
  claude mcp add drift -- drift mcp                    Claude Code, this machine only
  claude mcp add --scope project drift -- drift mcp    Claude Code, shared in .mcp.json

Other clients: {\"mcpServers\": {\"drift\": {\"command\": \"drift\", \"args\": [\"mcp\"]}}}
(add \"--root\", \"/path/to/repo\" to the args when the client does not start it there).
Tools that only read: drift_rules_for, drift_example, drift_check, drift_explain, drift_map,
drift_card, drift_security, drift_practices, drift_setup_questions, drift_investigate_items.
Tools that write: drift_setup_answer (an agent's answer to a setup question, in
.drift/config.yaml; only one that makes Drift more cautious takes effect, any other
waits for a person), drift_investigate_record (an agent's outcome for an open route,
under the same rule, and its local findings and gap reports under .drift/), and with
`agents.verify: on` drift_verify_card (verdicts, in .drift/verify-cache.json).
`drift export claude-settings` pre-approves the tools that only read.";

const EXPORT_HELP: &str = "Examples:
  drift export agents-md                     print the block
  drift export agents-md --write AGENTS.md   create AGENTS.md, or update the block in it
  drift export agents-md --write CLAUDE.md
  drift export claude-settings               print the permission entries
  drift export claude-settings --write .claude/settings.json

Re-run agents-md after `drift review`; only the text between the drift markers changes.
claude-settings adds `drift card`, `drift map`, `drift example`, `drift check`,
`drift practices` and the MCP tools that only read (server name `drift`) to
permissions.allow; with --write it merges them into the file (other settings are kept;
keys are written sorted). The Claude Code plugin approves the same lookups
from its PreToolUse hook, so this is for teams without the plugin, or for permission
modes in which a hook cannot approve a tool.";

/// What `drift practices` does besides printing the map.
#[derive(Subcommand)]
enum PracticesAction {
    /// Make a practice the rule for new code in one place: an accepted convention
    /// (advise mode, shown to agents), with the units that differ today recorded in
    /// drift.lock so only new code is reported. Exits 2, writing nothing, when the place
    /// does not qualify.
    #[command(after_help = promote::PROMOTE_HELP)]
    Promote(promote::PromoteArgs),
}

#[derive(Clone, Copy, ValueEnum)]
enum DebugKind {
    /// Every import specifier with its resolved module, as JSON lines.
    Imports,
    /// Every Python import (and imported name) with its resolution, as JSON lines.
    PyImports,
    /// Compare single-file (incremental) facts with a full scan, for a sample of files.
    Incremental,
}

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum TierFilter {
    /// Default-tier conventions only (those a person may set to block).
    Default,
    /// Suggestions only (advice; blocking one needs `drift review --block <id> --force`).
    Suggestion,
    /// Both tiers.
    All,
}

impl TierFilter {
    fn keeps(self, t: Tier) -> bool {
        match self {
            TierFilter::All => true,
            TierFilter::Default => t == Tier::Default,
            TierFilter::Suggestion => t == Tier::Suggestion,
        }
    }
}

/// A candidate tier `census --json --candidate` reports beside the shipped one.
#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum CandidateTier {
    /// Decision D8, pre-registered and not adopted (`eval/study/tier-d8-candidate.json`):
    /// D7 for TypeScript/JavaScript; Python call wrappers whose every alternative is a
    /// guard, and layering, with in-repo targets, in roles of 50 or more members.
    D8,
}

#[derive(Clone, Copy, ValueEnum)]
enum Agent {
    Claude,
}

#[derive(Clone, Copy, ValueEnum)]
enum ExportKind {
    /// A generated block for AGENTS.md or CLAUDE.md.
    AgentsMd,
    /// Claude Code permission entries (`.claude/settings.json`) that let Drift's
    /// read-only lookups run without a prompt.
    ClaudeSettings,
}

#[derive(Clone, Copy, ValueEnum)]
enum Format {
    Text,
    Json,
    /// SARIF 2.1.0, for GitHub code scanning and IDEs (new violations only).
    Sarif,
    /// GitHub Actions annotations (new violations only), plus a job summary when
    /// GITHUB_STEP_SUMMARY is set.
    Github,
}

use project::cache_dir;

/// The repo-relative paths `drift check FILES` reports, or `None` for every file.
/// A path may be repo-relative or absolute, with `./`, `..` or repeated slashes:
/// each is normalised as the hooks and MCP do, so `$PWD/src/a.ts` checks `src/a.ts`
/// instead of matching nothing and passing. A path outside the repository is an
/// error (nothing would be checked); the repository root itself means every file.
fn check_paths(root: &Path, files: &[String]) -> anyhow::Result<Option<BTreeSet<String>>> {
    if files.is_empty() {
        return Ok(None);
    }
    let canon = root
        .canonicalize()
        .with_context(|| format!("opening {}", root.display()))?;
    let mut only = BTreeSet::new();
    for f in files {
        let Some(rel) = project::rel_in(&canon, f) else {
            bail!(
                "{} is outside the repository {}: nothing was checked",
                drift_mine::report::sanitize(f, 160),
                canon.display()
            );
        };
        if rel.is_empty() {
            return Ok(None);
        }
        only.insert(rel);
    }
    Ok(Some(only))
}

/// Warn about each path given to `drift check` that names no file (missing, or a
/// directory): nothing is checked there, which would otherwise read as a pass.
/// Existing files Drift does not analyse (a README) stay quiet.
fn warn_unchecked_paths(root: &Path, facts: &RepoFacts, only: &BTreeSet<String>) {
    for note in unchecked_path_notes(root, facts, only) {
        eprintln!("drift: {note}");
    }
}

/// One line for each path in `only` that names no file Drift knows or that exists
/// (`drift check` warns with them, the MCP tools append them).
fn unchecked_path_notes(root: &Path, facts: &RepoFacts, only: &BTreeSet<String>) -> Vec<String> {
    let known: BTreeSet<&str> = facts
        .files
        .iter()
        .map(|f| f.path.as_str())
        .chain(facts.skipped.iter().map(|s| s.path.as_str()))
        .collect();
    only.iter()
        .filter(|rel| !known.contains(rel.as_str()) && !root.join(rel).is_file())
        .map(|rel| {
            let what = if root.join(rel).is_dir() {
                "is a directory (pass the files in it)"
            } else {
                "does not exist"
            };
            format!(
                "{} {what}: nothing checked there",
                drift_mine::report::sanitize(rel, 160)
            )
        })
        .collect()
}

fn engine() -> String {
    format!("drift {}", env!("CARGO_PKG_VERSION"))
}

fn load_facts(cli: &Cli, threads: usize) -> anyhow::Result<RepoFacts> {
    let opts = ScanOptions {
        cache_dir: cache_dir(&cli.root, cli.no_cache),
        threads,
    };
    Ok(scan(&cli.root, &opts)
        .with_context(|| format!("scanning {}", cli.root.display()))?
        .0)
}

/// The accepted conventions covering `rel`, as agents see them; none when the project
/// has no conventions file yet.
fn card_conventions(
    root: &Path,
    facts: &RepoFacts,
    rel: &str,
) -> anyhow::Result<Vec<drift_mine::card::ConventionLine>> {
    if ConventionsFile::load(root)?.is_none() {
        return Ok(Vec::new());
    }
    let project = project::Project::open_for_agents(root)?;
    Ok(mcp::card_conventions(&project, facts, rel, true))
}

/// The facts, for a command that writes nothing (`map`, `census --coverage`): the fact
/// cache is used only where `DRIFT_CACHE_DIR` points, as `census --json` does.
fn read_only_facts(cli: &Cli) -> anyhow::Result<RepoFacts> {
    let opts = ScanOptions {
        cache_dir: std::env::var_os("DRIFT_CACHE_DIR")
            .filter(|_| !cli.no_cache)
            .map(PathBuf::from),
        threads: 0,
    };
    Ok(scan(&cli.root, &opts)
        .with_context(|| format!("scanning {}", cli.root.display()))?
        .0)
}

/// Where `drift card` reads cached facts and keeps what it computes between runs
/// ([`derived`]), if anywhere: where `DRIFT_CACHE_DIR` points, else the project's own
/// cache directory when the project has a policy (`.drift/` is Drift's there, and
/// `drift check`, the hooks and the MCP card keep their cache in it). In a repository
/// without one the card writes nothing.
fn card_cache_dir(cli: &Cli) -> Option<PathBuf> {
    if cli.no_cache {
        return None;
    }
    if let Some(dir) = std::env::var_os("DRIFT_CACHE_DIR") {
        return Some(PathBuf::from(dir));
    }
    cli.root
        .join(CONVENTIONS_FILE)
        .is_file()
        .then(|| cache_dir(&cli.root, false))
        .flatten()
}

fn require_policy(root: &Path) -> anyhow::Result<ConventionsFile> {
    ConventionsFile::load(root)?
        .with_context(|| format!("no {CONVENTIONS_FILE}: run `drift init` first"))
}

/// Proposals in the order people see them: the default tier first, then
/// suggestions, each ranked as mined. The set is what mining chose; only the order changes.
fn tiered(mined: &Mined) -> Vec<&Candidate> {
    let mut v: Vec<&Candidate> = mined.candidates.iter().collect();
    tier::order_by_tier(&mut v, |c| c.tier());
    v
}

fn tier_counts(tiers: impl Iterator<Item = Tier>) -> (usize, usize) {
    tiers.fold((0, 0), |(d, s), t| match t {
        Tier::Default => (d + 1, s),
        Tier::Suggestion => (d, s + 1),
    })
}

fn tier_heading(t: Tier) -> &'static str {
    match t {
        Tier::Default => {
            "Default tier: block candidates, each reaches agents once you accept it, and may block once accepted (`drift review`, b)"
        }
        Tier::Suggestion => {
            "Suggestions: advice only; blocking one needs `drift review --block <id> --force`"
        }
    }
}

/// Print `(rank, candidate)` pairs with a heading for each tier.
fn print_tiered(shown: &[(usize, &Candidate)], all_outliers: bool) {
    let mut last = None;
    for (rank, c) in shown {
        let t = c.tier();
        if last != Some(t) {
            println!("{}\n", tier_heading(t));
            last = Some(t);
        }
        print_candidate(*rank, c, all_outliers);
        println!();
    }
}

fn print_candidate(rank: usize, c: &Candidate, all_outliers: bool) {
    let e = &c.evidence;
    println!("{:>2}. [{}] {}", rank, c.id, c.summary());
    println!(
        "    evidence: {}/{} (lower bound {:.2}, lift {:.1}){}",
        e.holders,
        e.total,
        e.lower_bound,
        e.lift,
        if c.can_block {
            ""
        } else {
            "  [advise only: small role]"
        }
    );
    println!("    tier:     {}", c.describe_tier());
    let agents = drift_mine::admission::candidate_view(c);
    if !agents.shown {
        println!("    agents:   {}", agents.text);
    }
    if !e.split.is_empty() {
        let parts: Vec<_> = e
            .split
            .iter()
            .map(|(w, n)| format!("{} {n}", w.rsplit('#').next().unwrap_or(w)))
            .collect();
        println!("    split:    {}", parts.join(", "));
    }
    if !c.derived.is_empty() {
        // Which wrappers count as the rule's, and what they are built on.
        let mut via: BTreeMap<(String, String), usize> = BTreeMap::new();
        for d in &c.derived {
            *via.entry((short_name(&d.wrapper), short_name(&d.from)))
                .or_default() += 1;
        }
        let parts: Vec<String> = via
            .into_iter()
            .map(|((w, f), n)| format!("{w} {n} (built on {f})"))
            .collect();
        println!("    derived:  {}", parts.join(", "));
    }
    println!("    example:  {}", c.example);
    if let Some(w) = &c.wiring {
        let r = &w.registry;
        let at = if r.line > 0 {
            format!("{}:{}", r.path, r.line)
        } else {
            r.path.clone()
        };
        let like = r
            .like
            .as_ref()
            .map(|l| format!(" (e.g. {} at line {})", l.name, l.line))
            .unwrap_or_default();
        let one_file = matches!(&c.rule, Rule::RegisteredIn { path, .. } if !path.is_empty());
        let lists = match w.lists {
            0 | 1 => String::new(),
            n if one_file => format!(", the fullest of {n} lists in the file"),
            n => format!(", nearest of {n} lists"),
        };
        println!("    registry: {} in {at}{like}{lists}", r.label);
    }
    let shown = if all_outliers {
        c.outliers.len()
    } else {
        c.outliers.len().min(3)
    };
    for o in &c.outliers[..shown] {
        println!("    outlier:  {}:{} {}", o.path, o.line, o.symbol);
    }
    if shown < c.outliers.len() {
        println!("    ... {} more outliers", c.outliers.len() - shown);
    }
    // Members the rule is not about, with Drift's reason: on the card, so a reviewer
    // can judge the exemption as well as the outliers.
    let shown = if all_outliers {
        c.exempt.len()
    } else {
        c.exempt.len().min(3)
    };
    for e in &c.exempt[..shown] {
        println!(
            "    exempt:   {}:{} {} ({})",
            e.path, e.line, e.symbol, e.reason
        );
    }
    if shown < c.exempt.len() {
        println!("    ... {} more exempt", c.exempt.len() - shown);
    }
}

/// `apps/web/lib/a.ts#client.inputSchema().action` -> `client.inputSchema().action`.
fn short_name(canonical: &str) -> String {
    canonical
        .rsplit_once('#')
        .map_or(canonical, |(_, n)| n)
        .to_string()
}

/// The largest role mining saw, other than the catch-all role of whole files, with
/// its member count: what a repository with no conventions is missing.
fn largest_role(
    facts: &RepoFacts,
    mined: &Mined,
) -> Option<(drift_mine::roles::RoleSelector, usize)> {
    let units = drift_mine::roles::units(facts, &mined.kinds);
    let mut sizes: BTreeMap<&drift_mine::roles::RoleSelector, usize> = BTreeMap::new();
    for u in &units {
        for r in u.roles.iter().filter(|r| r.kind != SymbolKind::Module) {
            *sizes.entry(r).or_default() += 1;
        }
    }
    sizes
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(r, n)| (r.clone(), n))
}

/// One line on why mining proposed nothing, naming the largest role it saw
/// other than the catch-all role of whole files.
fn no_conventions_reason(facts: &RepoFacts, mined: &Mined) -> String {
    let seen = match largest_role(facts, mined) {
        Some((r, n)) => format!(
            "the largest role here has {n} member{} ({})",
            if n == 1 { "" } else { "s" },
            r.describe()
        ),
        None => "no role of similar symbols was found here".to_string(),
    };
    format!(
        "No conventions found: roles need roughly 20+ similar symbols where one pattern \
         clearly dominates and is rarer elsewhere; {seen}."
    )
}

/// Version of the `census --json` shape.
const CENSUS_SCHEMA: u32 = 1;

/// `drift census --json`: the same proposals, ids, summaries and order as the text output.
/// Proposals agents would not be shown (W0 family admission, and every default-tier block
/// candidate, decision D13): every one is still listed for people.
fn hidden_from_agents(proposals: &[&Candidate]) -> usize {
    proposals
        .iter()
        .filter(|c| !drift_mine::admission::candidate_view(c).shown)
        .count()
}

/// Of those, the default tier's block candidates: they reach agents once a person accepts
/// them (decision D13).
fn block_candidates(proposals: &[&Candidate]) -> usize {
    proposals
        .iter()
        .filter(|c| {
            drift_mine::admission::candidate_view(c).reason
                == drift_mine::admission::Reason::Candidate
        })
        .count()
}

/// What `drift init` and `drift census` say about proposals agents are not shown: the
/// block candidates, then the suggestions below the admission bar.
fn agents_notes(proposals: &[&Candidate]) -> Vec<String> {
    let candidates = block_candidates(proposals);
    let below = hidden_from_agents(proposals) - candidates;
    let mut out = Vec::new();
    if candidates > 0 {
        out.push(candidate_note(candidates));
    }
    if below > 0 {
        out.push(hidden_note(below));
    }
    out
}

/// What `drift init` and `drift census` say about the default tier's block candidates.
fn candidate_note(n: usize) -> String {
    format!(
        "{n} default-tier proposal(s) are block candidates: not shown to agents until you accept them (`drift review --accept <id>`, or the Studio). People see them first."
    )
}

/// Where agents' decisions come from (`census --json` `agents.admission`): the family
/// table with its run, date and bar; null when there is none (then no suggestion is shown
/// to agents).
fn admission_source() -> serde_json::Value {
    drift_mine::admission::admission().describe()
}

fn census_json(
    root: &Path,
    facts: &RepoFacts,
    mined: &Mined,
    max: usize,
    filter: TierFilter,
    candidate: Option<CandidateTier>,
    (cap, cap_from): (rank::SuggestionCap, rank::CapSource),
) -> anyhow::Result<serde_json::Value> {
    use serde_json::{Value, json};
    let all_units = drift_mine::roles::units(facts, &mined.kinds);
    // Only for --candidate: the guard notion reads definitions, so it needs the context.
    let ctx = candidate.map(|_| drift_mine::context::RepoContext::new(facts, &all_units));
    let lines: BTreeMap<String, u32> = all_units.iter().map(|u| (u.key(), u.line())).collect();
    let unchecked = drift_mine::unchecked::Unchecked::of(facts);
    let ordered = tiered(mined);
    let (in_default, in_suggestion) = tier_counts(ordered.iter().map(|c| c.tier()));
    let hidden = hidden_from_agents(&ordered);
    let candidates = block_candidates(&ordered);
    // Every proposal, in the order the text lists them (default tier, then suggestions
    // best first); `shown_by_default` is false for a suggestion past the cap.
    let placed = rank::place(&ordered, cap);
    let (suggestions, listed) = rank::suggestion_counts(&placed);
    if drift_mine::funnel::on() {
        for p in placed.iter().filter(|p| filter.keeps(p.item.tier())) {
            let stage = if p.shown { "shown" } else { "not_listed" };
            drift_mine::funnel::card(p.item, stage);
        }
    }
    let mut proposals = Vec::with_capacity(placed.len());
    for placed in &placed {
        let c = *placed.item;
        if !filter.keeps(c.tier()) {
            continue;
        }
        let mut role = serde_json::to_value(&c.role)?;
        if let Value::Object(m) = &mut role {
            m.insert("members".into(), json!(c.evidence.role_size()));
        }
        let (path, symbol) = c.example.rsplit_once('#').unwrap_or((&c.example, ""));
        let mut p = json!({
            "id": c.id,
            "rank": placed.rank,
            "shown_by_default": placed.shown,
            "summary": c.summary(),
            "role": role,
            "rule": c.rule,
            "evidence": c.evidence,
            "rule_kind": tier::rule_kind(&c.rule),
            "tier": c.tier(),
            "tier_reason": c.tier_reason(),
            "language": tier::language_code(c.language()),
            "names_package": tier::names_package(&c.rule),
            // Whether agents are shown it (W0 family admission), and why.
            "agents": drift_mine::admission::candidate_view(c),
            "blockable": c.can_block,
            "example": {
                "path": path,
                "symbol": symbol,
                "line": lines.get(&c.example).copied().unwrap_or(1),
            },
            "outliers": c.outliers,
            "outliers_total": c.outliers.len(),
        });
        // Additive, only when set: members the rule is not about (with why), and
        // holders that hold it through a base's declaration.
        if let Value::Object(m) = &mut p {
            if !c.exempt.is_empty() {
                m.insert("exempt".into(), json!(c.exempt));
            }
            if !c.inherited.is_empty() {
                m.insert("inherited".into(), json!(c.inherited));
            }
            // Members whose verdict reads a file not parsed for lack of stack.
            let unsure = unchecked_members(&all_units, &unchecked, &c.role);
            if unsure > 0 {
                m.insert("unchecked_members".into(), json!(unsure));
            }
            if !c.derived.is_empty() {
                m.insert("derived".into(), json!(c.derived));
            }
            // What the callee's parameter type says about a `passes_key` rule's key.
            if let Some(k) = drift_mine::keytypes::key_type(facts, &c.rule) {
                m.insert("key_type".into(), json!(k));
            }
        }
        // --candidate d8 only: the tier decision D8's candidate would give (not adopted;
        // `tier` above is the one that applies), and whether every alternative of a call
        // wrapper is a guard (null for other rules).
        if let Some(ctx) = &ctx {
            let call = tier::rule_kind(&c.rule) == "wrapped_by:call";
            let guards =
                call && drift_mine::security::every_alternative_authenticates(ctx, &c.rule);
            let (members, lang) = (c.evidence.role_size(), c.language());
            p["candidate"] = json!({
                "decision": tier::D8_DECISION,
                "tier": tier::d8_candidate_tier(&c.rule, members, lang, guards),
                "reason": tier::d8_candidate_reason(&c.rule, members, lang, guards),
                "guards": call.then_some(guards),
            });
        }
        // Wiring rules only (experimental): the registry and a registered sibling.
        if let Some(w) = &c.wiring {
            p["wiring"] = serde_json::to_value(w)?;
        }
        proposals.push(p);
    }
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut out = json!({
        "schema": CENSUS_SCHEMA,
        "engine": engine(),
        "commit": option_env!("DRIFT_BUILD_COMMIT"),
        "root": root.to_string_lossy(),
        "units": mined.units,
        "roles": mined.roles_considered,
        "conventions": mined.candidates.len(),
        "shown": proposals.len(),
        "tiers": { "default": in_default, "suggestion": in_suggestion },
        // `hidden` counts every proposal agents are not shown (with the default tier's block
        // candidates, decision D13, counted in `candidates`, set below when there are any).
        "agents": { "hidden": hidden, "admission": admission_source() },
        // How many suggestions the human views list (`drift_mine::rank`); every proposal
        // is in `proposals` whatever this says.
        "suggestion_cap": {
            "cap": cap.limit(),
            "from": cap_from.name(),
            "suggestions": suggestions,
            "listed": listed,
        },
        "params": {
            "max": max,
            "max_per_role": MAX_PER_ROLE,
            "min_role_size": MIN_ROLE_SIZE,
            "min_block_role_size": MIN_BLOCK_ROLE_SIZE,
            "min_lower_bound": MIN_LOWER_BOUND,
            "min_lift": MIN_LIFT,
            "min_lift_external_call": MIN_LIFT_EXTERNAL_CALL,
            "tier": {
                "decision": tier::DECISION,
                "default_rule_kinds": DEFAULT_RULE_KINDS,
                "default_languages": tier::DEFAULT_LANGUAGES,
                "advise_only_languages": tier::ADVISE_ONLY_LANGUAGES,
                "target": tier::DEFAULT_TARGET,
                "min_members": MIN_BLOCK_ROLE_SIZE,
            },
            // What is shown at all (`drift_mine::show`): the frozen table, its run and
            // bar, and the families it admits per language; null without a table (then
            // no suggestion is proposed).
            "show": drift_mine::show::describe(),
        },
        "proposals": proposals,
        // Only when nothing was proposed: the largest role seen, so a first run can say
        // what is missing (roles need roughly 20+ similar symbols). Null otherwise.
        "largest_role": if mined.candidates.is_empty() {
            largest_role(facts, mined).map(|(r, n)| json!({ "role": r, "members": n, "summary": r.describe() }))
        } else {
            None
        },
    });
    // Only when there are any: how many of `agents.hidden` are block candidates, so a census
    // with no default-tier proposal is what it was before D13.
    if candidates > 0 {
        out["agents"]["candidates"] = json!(candidates);
    }
    // Only when set: files not parsed for lack of stack, left out of every count.
    if !unchecked.is_empty() {
        out["unchecked"] = json!(unchecked.files);
    }
    if candidate.is_some() {
        out["params"]["candidate"] = json!({
            "decision": tier::D8_DECISION,
            "status": "candidate (pre-registered, not adopted)",
            "default_rule_kinds": DEFAULT_RULE_KINDS,
            "default_languages": ["ts", "py"],
            "target": tier::DEFAULT_TARGET,
            "min_members": MIN_BLOCK_ROLE_SIZE,
            "py": { "min_members": tier::D8_MIN_MEMBERS_PY, "call_wrappers": "guards" },
        });
    }
    Ok(out)
}

/// Members of `role` in files that depend on a file not parsed for lack of stack.
fn unchecked_members(
    units: &[drift_mine::roles::Unit],
    unchecked: &drift_mine::unchecked::Unchecked,
    role: &drift_mine::roles::RoleSelector,
) -> usize {
    if unchecked.is_empty() {
        return 0;
    }
    units
        .iter()
        .filter(|u| {
            role.parts().iter().any(|p| u.roles.contains(p))
                && unchecked.depends_on(&u.path()).is_some()
        })
        .count()
}

/// The note `census` prints when files were not parsed for lack of stack.
fn census_unchecked_note(facts: &RepoFacts, mined: &Mined) -> Option<String> {
    let unchecked = drift_mine::unchecked::Unchecked::of(facts);
    let note = unchecked.note()?;
    let units = drift_mine::roles::units(facts, &mined.kinds);
    let affected = mined
        .candidates
        .iter()
        .filter(|c| unchecked_members(&units, &unchecked, &c.role) > 0)
        .count();
    let shown: Vec<&str> = unchecked.files.iter().take(5).map(String::as_str).collect();
    Some(format!(
        "drift: {note} They are left out of every count below ({}{}){}.\n",
        shown.join(", "),
        if unchecked.files.len() > 5 {
            ", ..."
        } else {
            ""
        },
        if affected > 0 {
            format!(
                "; {affected} proposal(s) have members whose verdict reads them (`unchecked_members` in --json)"
            )
        } else {
            String::new()
        }
    ))
}

fn print_convention_card(c: &Convention, report: &CheckReport, cap: OutlierCap) {
    println!();
    println!("[{}] {}", c.id, c.summary);
    if c.rule.is_practice() {
        // Counted by the practice map when it was promoted: no lower bound or lift.
        println!(
            "  evidence: {} of {} follow it",
            c.evidence.holders, c.evidence.total
        );
    } else {
        println!(
            "  evidence: {}/{} (lower bound {:.2}, lift {:.1})",
            c.evidence.holders, c.evidence.total, c.evidence.lower_bound, c.evidence.lift
        );
    }
    if let Some(origin) = promote::origin(c) {
        println!("  origin:   {origin}");
    }
    println!("  tier:     {}", c.describe_tier());
    println!(
        "  agents:   {}",
        drift_mine::admission::convention_view(c).text
    );
    println!("  example:  {}", c.example);
    for line in card_outlier_lines(c, report, cap) {
        println!("{line}");
    }
}

/// Outliers listed on a `drift review` card before `--all-outliers`.
const CARD_OUTLIERS: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutlierCap {
    First(usize),
    All,
}

/// A card's outliers as `drift check` sees them now (legacy, drift-ignored and unsure
/// ones marked), capped, with the command that lists them all and the one that marks one
/// fine; then the members a reviewer marked fine, with their reasons.
fn card_outlier_lines(c: &Convention, r: &CheckReport, cap: OutlierCap) -> Vec<String> {
    let mut out = Vec::new();
    let flagged: Vec<_> = r.violations.iter().filter(|v| v.id == c.id).collect();
    if c.status == Status::Rejected {
        // Nothing checks a rejected convention.
    } else if flagged.is_empty() {
        out.push("  outliers: none in the code now".to_string());
    } else {
        out.push(format!("  outliers: {} in the code now", flagged.len()));
        let shown = match cap {
            OutlierCap::First(n) => n,
            OutlierCap::All => usize::MAX,
        };
        for v in flagged.iter().take(shown) {
            let note = if v.baselined {
                "  (legacy, in drift.lock)"
            } else if v.suppressed {
                "  (drift-ignore)"
            } else if v.unsure {
                "  (unsure)"
            } else {
                ""
            };
            out.push(format!("    {}:{} {}{note}", v.path, v.line, v.symbol));
        }
        if flagged.len() > shown {
            out.push(format!(
                "    +{} more: `drift review --show {} --all-outliers` lists them all",
                flagged.len() - shown,
                c.id
            ));
        }
        out.push(format!(
            "  fine because...: `drift review --exempt {} --member {}#{} --reason \"<why>\"`",
            c.id, flagged[0].path, flagged[0].symbol
        ));
    }
    if !c.exceptions.is_empty() {
        out.push(format!(
            "  marked fine by a reviewer: {}",
            c.exceptions.len()
        ));
        for e in &c.exceptions {
            let now = r.exempt.iter().any(|x| {
                x.id == c.id
                    && x.code == drift_mine::check::REVIEWED
                    && format!("{}#{}", x.path, x.symbol) == e.member
            });
            let stale = if now || c.status == Status::Rejected {
                ""
            } else {
                "  (not an outlier now)"
            };
            out.push(format!("    {}: {}{stale}", e.member, e.reason));
        }
    }
    if !c.different_kind.is_empty() {
        out.push(format!(
            "  set apart as a different kind: {} file(s)",
            c.different_kind.len()
        ));
        for d in &c.different_kind {
            let confirmed = if d.entry_points.is_empty() {
                String::new()
            } else {
                format!("  (entry points confirmed: {})", d.entry_points.join(", "))
            };
            out.push(format!("    {}{confirmed}", d.path));
        }
    }
    out
}

/// Refuse ids that are not in the policy.
fn known_ids(policy: &ConventionsFile, ids: &[String]) -> anyhow::Result<()> {
    let unknown: Vec<&str> = ids
        .iter()
        .filter(|id| policy.conventions.iter().all(|c| &c.id != *id))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        bail!(
            "unknown convention {}, nothing was changed. The ids are in {CONVENTIONS_FILE} (`drift census` lists the proposals); `drift init` adds newly learned ones",
            unknown.join(", ")
        );
    }
    Ok(())
}

/// Write a file a person named (`export agents-md --write`, `review --export-log`), never
/// through a link that leaves the repo: AGENTS.md in a cloned repo may point anywhere. A
/// path inside the repo is checked from the root down, however it is spelled.
fn write_out(root: &Path, path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let abs = std::path::absolute(path)?;
    let root_abs = std::path::absolute(root)?;
    let (base, rel) = match abs.strip_prefix(&root_abs) {
        Ok(rel) if !rel.as_os_str().is_empty() => (root_abs.clone(), rel.to_path_buf()),
        _ => match (abs.parent(), abs.file_name()) {
            (Some(dir), Some(name)) => (dir.to_path_buf(), PathBuf::from(name)),
            _ => bail!("{} is not a file path", path.display()),
        },
    };
    drift_mine::policy::write_no_follow(&base, &rel, bytes)
}

/// `drift check` over every convention not rejected (proposed ones included), as review
/// shows outliers: what a card flags in the code now, with reviewers' exceptions applied.
fn review_outliers(cli: &Cli, policy: &ConventionsFile) -> anyhow::Result<CheckReport> {
    Ok(review_report(cli, policy)?.1)
}

/// [`review_outliers`], with the facts it was read from (for the candidates' questions).
fn review_report(cli: &Cli, policy: &ConventionsFile) -> anyhow::Result<(RepoFacts, CheckReport)> {
    let mut facts = load_facts(cli, 0)?;
    let report = review_report_on(cli, &mut facts, policy)?;
    Ok((facts, report))
}

/// [`review_report`] on facts already read.
fn review_report_on(
    cli: &Cli,
    facts: &mut RepoFacts,
    policy: &ConventionsFile,
) -> anyhow::Result<CheckReport> {
    let mut gated = policy.clone();
    wiring::gate(&cli.root, &mut gated, false)?;
    let lock = Lock::load(&cli.root)?;
    history::attach_key_files(&cli.root, &gated, facts);
    // A promoted practice is checked against the practice map: its outliers on a card are
    // the units that break it now.
    Ok(practices::check_with_practices(
        &cli.root,
        facts,
        &gated,
        &lock,
        Scope::All,
        None,
        None,
    ))
}

/// A block candidate's answer (`--answer ID=...`, interactive y / d / n).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Answer {
    Same,
    Different,
    NotAConvention,
}

impl Answer {
    fn name(self) -> &'static str {
        match self {
            Answer::Same => "same",
            Answer::Different => "different",
            Answer::NotAConvention => "not-a-convention",
        }
    }
}

/// `ID=same`, `ID=different` or `ID=not-a-convention`.
fn parse_answer(text: &str) -> anyhow::Result<(String, Answer)> {
    let (id, a) = text.split_once('=').unwrap_or((text, ""));
    let kind = match a.trim() {
        "same" => Answer::Same,
        "different" => Answer::Different,
        "not-a-convention" => Answer::NotAConvention,
        _ => bail!(
            "--answer takes ID=same, ID=different or ID=not-a-convention, not {text:?}; nothing was changed"
        ),
    };
    Ok((id.trim().to_string(), kind))
}

/// Apply a candidate's answer to `c` (its question checked first): the lines to print.
fn apply_answer(
    c: &mut Convention,
    kind: Answer,
    diff: Option<&drift_mine::calibrate::Different>,
) -> Vec<String> {
    let mut out = Vec::new();
    match kind {
        Answer::Same => {
            c.status = Status::Accepted;
            out.push(format!("{}: the same kind of thing: accepted", c.id));
        }
        Answer::NotAConvention => {
            c.status = Status::Rejected;
            out.push(format!("{}: not a convention: rejected", c.id));
        }
        Answer::Different => {
            let d = diff.expect("checked");
            for (path, confirmed) in &d.files {
                c.set_different_kind(path, confirmed);
            }
            c.status = Status::Accepted;
            out.push(format!(
                "{}: accepted, with {} file(s) set apart as a different kind ({} flagged member(s) exempt; `drift check` lists them as exempt, code different_kind)",
                c.id,
                d.files.len(),
                d.covered.len()
            ));
            if !d.kept.is_empty() {
                out.push(format!(
                    "  still flagged: {} (an entry point under an auth or validation rule is set apart only with --confirm-entry PATH#SYMBOL, the Studio's separate tick)",
                    d.kept.join(", ")
                ));
                out.push(format!(
                    "  to finish: answer again with the same --set-apart files and `--confirm-entry {}` for each of those you checked is a different kind",
                    d.kept[0]
                ));
            }
        }
    }
    out
}

/// `drift review --json`: the question of every block candidate.
fn questions_json(qs: &[drift_mine::calibrate::Question]) -> serde_json::Value {
    use drift_mine::calibrate as cal;
    serde_json::json!({
        "schema": cal::SCHEMA,
        "schema_version": cal::SCHEMA_VERSION,
        "question": cal::QUESTION,
        "answers": {
            "same": "Yes: accept the card (`drift review --answer ID=same`)",
            "different": "No, these are different: pick the files whose flagged members are a different kind; they are exempt by path and the card is accepted (`--answer ID=different --set-apart PATH,...`; an entry point marked needs_confirmation also needs `--confirm-entry PATH#SYMBOL`)",
            "not-a-convention": "Not a convention: reject the card (`--answer ID=not-a-convention`)",
        },
        "unanswered": "A candidate nobody answers stays a candidate: no agent is shown it as a convention.",
        "candidates": qs,
    })
}

/// Accept `c` (keeping its mode) and show it to agents: `agents: show`, unless agents are
/// shown it once accepted (the default tier, an admitted family), which needs no override.
fn show_to_agents_now(c: &mut Convention) {
    c.status = Status::Accepted;
    // Recorded whenever acceptance alone would not show it (also for a suggestion forced
    // to block, so setting it back to advise later keeps it shown).
    if !drift_mine::admission::accepted_view(c).shown {
        c.agents = Some(drift_mine::policy::AgentsChoice::Show);
    }
    println!(
        "{}: {}",
        c.id,
        drift_mine::admission::convention_view(c).text
    );
}

/// Whether a convention may be set to block. Small roles never block (the
/// statistical guard); suggestions block only on an explicit, forced decision.
#[derive(Debug, PartialEq, Eq)]
enum BlockGuard {
    Allowed,
    SmallRole,
    Suggestion,
    /// An experimental wiring rule: advises only, even with `--force`.
    Experimental,
}

fn block_guard(c: &Convention) -> BlockGuard {
    if c.rule.is_wiring() {
        BlockGuard::Experimental
    } else if c.evidence.role_size() < MIN_BLOCK_ROLE_SIZE {
        BlockGuard::SmallRole
    } else if c.tier() == Tier::Suggestion {
        BlockGuard::Suggestion
    } else {
        BlockGuard::Allowed
    }
}

fn run(cli: &Cli) -> anyhow::Result<ExitCode> {
    let root = &cli.root;
    drift_mine::workspace::configure(root);
    match &cli.command {
        Command::Scan { json, out, threads } => {
            let started = Instant::now();
            let opts = ScanOptions {
                cache_dir: cache_dir(root, cli.no_cache),
                threads: *threads,
            };
            let (facts, stats) =
                scan(root, &opts).with_context(|| format!("scanning {}", root.display()))?;
            let elapsed = started.elapsed();
            if let Some(out) = out {
                std::fs::write(out, serde_json::to_vec_pretty(&facts)?)
                    .with_context(|| format!("writing {}", out.display()))?;
            }
            if *json {
                let mut stdout = std::io::stdout().lock();
                serde_json::to_writer_pretty(&mut stdout, &facts)?;
                writeln!(stdout)?;
                return Ok(ExitCode::SUCCESS);
            }
            let symbols: usize = facts.files.iter().map(|f| f.symbols.len()).sum();
            let entry_points: usize = facts
                .files
                .iter()
                .map(|f| f.listed_entry_points().len())
                .sum();
            let imports: Vec<_> = facts.files.iter().flat_map(|f| &f.imports).collect();
            let unresolved = imports
                .iter()
                .filter(|i| i.module.starts_with("unresolved:"))
                .count();
            let internal = imports.iter().filter(|i| !i.module.contains(':')).count();
            eprintln!(
                "drift scan: {} files in {:.2}s",
                stats.files,
                elapsed.as_secs_f64()
            );
            eprintln!("  cache hits:      {}", stats.cache_hits);
            eprintln!("  parse errors:    {}", stats.parse_errors);
            let no_stack = facts.stack_unavailable().len();
            eprintln!(
                "  skipped:         {}{}",
                facts.skipped.len(),
                if no_stack > 0 {
                    format!(
                        " ({no_stack} not parsed for lack of stack: a run with more memory parses them)"
                    )
                } else {
                    String::new()
                }
            );
            eprintln!("  symbols:         {symbols}");
            eprintln!("  entry points:    {entry_points}");
            eprintln!(
                "  imports:         {} ({internal} in-repo, {unresolved} unresolved)",
                imports.len()
            );
        }
        Command::Debug {
            what: DebugKind::Imports,
        } => {
            let mut stdout = std::io::stdout().lock();
            for row in drift_ts::debug_imports(root)? {
                serde_json::to_writer(&mut stdout, &row)?;
                writeln!(stdout)?;
            }
        }
        Command::Debug {
            what: DebugKind::PyImports,
        } => {
            let mut stdout = std::io::stdout().lock();
            for row in drift_py::debug_imports(root)? {
                serde_json::to_writer(&mut stdout, &row)?;
                writeln!(stdout)?;
            }
        }
        Command::Debug {
            what: DebugKind::Incremental,
        } => {
            let opts = ScanOptions {
                cache_dir: cache_dir(root, false),
                threads: 0,
            };
            let full = load_facts(cli, 0)?;
            // Per language: every client file, file with entry points and file that
            // declares models, plus every 25th file.
            let mut sample: Vec<&drift_core::FileFacts> = Vec::new();
            for python in [false, true] {
                sample.extend(
                    full.files
                        .iter()
                        .filter(|f| (f.lang == "py") == python)
                        .enumerate()
                        .filter(|(i, f)| {
                            i % 25 == 0
                                || f.directives.iter().any(|d| d == "use client")
                                || !f.entry_points.is_empty()
                                || full.models.iter().any(|m| m.path == f.path)
                        })
                        .map(|(_, f)| f)
                        .take(400),
                );
            }
            // Roles too: a hook places a file's symbols in the roles a full scan does.
            let kinds = drift_mine::roles::FileKinds::learn(&full);
            type Roles = Vec<(String, Vec<drift_mine::roles::RoleSelector>)>;
            let roles_by_path = |facts: &drift_core::RepoFacts| {
                let mut by: std::collections::BTreeMap<String, Roles> = Default::default();
                for u in drift_mine::roles::units(facts, &kinds) {
                    by.entry(u.path()).or_default().push((u.key(), u.roles));
                }
                by
            };
            let full_roles = roles_by_path(&full);
            let mut bad = 0;
            let mut fallbacks = 0;
            for f in &sample {
                // `None`: this file's facts need a full scan (its classes extend, or
                // are extended by, other files' classes), which hooks then run.
                let Some(one) = scan::scan_file(root, &opts, &f.path)? else {
                    fallbacks += 1;
                    continue;
                };
                let models: Vec<_> = full.models.iter().filter(|m| m.path == f.path).collect();
                if one.files.first() != Some(*f)
                    || roles_by_path(&one).get(&f.path) != full_roles.get(&f.path)
                    || one.models.iter().collect::<Vec<_>>() != models
                    || one.packages != full.packages
                    || one.lint != full.lint
                {
                    bad += 1;
                    println!("mismatch: {}", f.path);
                }
            }
            println!(
                "checked {} files ({fallbacks} fall back to a full scan), {bad} mismatches",
                sample.len()
            );
            if bad > 0 {
                return Ok(ExitCode::from(1));
            }
        }
        Command::Facts { file } => {
            let facts = load_facts(cli, 0)?;
            let want = file.trim_start_matches("./");
            let Some(f) = facts.files.iter().find(|f| f.path == want) else {
                if facts.stack_unavailable().contains(&want) {
                    bail!(
                        "{want} was not parsed: no thread stack large enough for it could be reserved (an address-space or memory limit on this run); run again with more memory"
                    );
                }
                bail!("{want} was not scanned (not a source file, ignored, or skipped)");
            };
            let mut stdout = std::io::stdout().lock();
            serde_json::to_writer_pretty(&mut stdout, f)?;
            writeln!(stdout)?;
        }
        Command::Map {
            file,
            package,
            role,
            json,
            max,
            files,
            conventions,
            places_only,
        } => {
            // Read-only, as `census --json`: the fact cache only where DRIFT_CACHE_DIR points.
            let facts = read_only_facts(cli)?;
            let on = drift_mine::map::Mining {
                tests: drift_mine::policy::test_roles(root, false),
                kinds: drift_mine::policy::kind_roles(root, false),
            };
            let tests_mined = on;
            let kinds = map_kinds(root, &facts, !*places_only);
            let map = drift_mine::map::RepoMap::build(&facts, &kinds);
            let out = if *files {
                let mut v = drift_mine::map::files_view(&facts, &map);
                if *conventions {
                    map_conventions(root, &facts, &kinds, (on.tests, on.kinds), false, &mut v);
                    add_loc(root, &mut v);
                }
                v
            } else if let Some(f) = file {
                let canon = root
                    .canonicalize()
                    .with_context(|| format!("opening {}", root.display()))?;
                let rel = project::rel_in(&canon, f)
                    .with_context(|| format!("{f} is outside the repository"))?;
                drift_mine::map::file_view(&facts, &map, &rel, tests_mined)
            } else if let Some(id) = role {
                drift_mine::map::role_view(&map, id, tests_mined)
                    .with_context(|| format!("no role {id} in the map (`drift map` lists them)"))?
            } else {
                let p = package.as_deref().map(|p| {
                    if p == "." {
                        ""
                    } else {
                        p.trim_end_matches('/')
                    }
                });
                if let Some(p) = p {
                    anyhow::ensure!(
                        facts.files.iter().any(|f| f.package == p),
                        "no package `{p}` (the overview lists them)"
                    );
                }
                drift_mine::map::overview(
                    &facts,
                    &map,
                    p,
                    tests_mined,
                    drift_mine::map::Limits { roles: *max },
                )
            };
            let mut stdout = std::io::stdout().lock();
            if *json || *files {
                serde_json::to_writer_pretty(&mut stdout, &out)?;
                writeln!(stdout)?;
            } else {
                write!(stdout, "{}", drift_mine::map::render(&out))?;
            }
        }
        Command::Card { path, json } => {
            // The fact cache where the card may keep anything ([`card_cache_dir`]): in
            // a project with a policy, the cache `drift check` and the hooks keep, so a
            // card does not parse every file each time it is asked for; in a repository
            // without one, only where DRIFT_CACHE_DIR points, as `drift map`.
            // The facts are left for the exit to free, as `drift check` leaves them.
            let opts = ScanOptions {
                cache_dir: card_cache_dir(cli),
                threads: 0,
            };
            let facts = std::mem::ManuallyDrop::new(
                scan(&cli.root, &opts)
                    .with_context(|| format!("scanning {}", cli.root.display()))?
                    .0,
            );
            // `rel_in` resolves against the canonical root (links in the way to it).
            let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
            let rel = project::rel_in(&canonical, path)
                .with_context(|| format!("{path} is outside the repository"))?;
            anyhow::ensure!(
                !rel.is_empty(),
                "{path} names the repository root, not a file"
            );
            // The conventions agents are shown: the text card lists them, and no
            // regularity repeats one.
            let shown = card_conventions(root, &facts, &rel)?;
            // What mining finds is kept where the card may keep anything.
            let derived = derived::Derived::of(card_cache_dir(cli), &facts);
            if *json {
                // For people (the Studio): every convention covering the file, accepted
                // or proposed, not only those shown to agents. The regularities are
                // those of the text card.
                let conventions = match ConventionsFile::load(root)? {
                    Some(_) => {
                        mcp::card_conventions(&project::Project::open(root)?, &facts, &rel, false)
                    }
                    None => Vec::new(),
                };
                let (regularities, inv) = card::beside(
                    || card::regularities(root, &facts, &rel, &shown, derived.as_ref()),
                    || {
                        drift_mine::security::inventory_with(
                            &facts,
                            drift_mine::security::Boundaries::load(root),
                        )
                    },
                );
                let card = drift_mine::card::build(&facts, &inv, &rel, &conventions, &regularities);
                println!("{}", serde_json::to_string_pretty(&card)?);
                return Ok(ExitCode::SUCCESS);
            }
            print!(
                "{}",
                card::text(root, &facts, &rel, &shown, derived.as_ref())
            );
        }
        Command::Practices {
            action,
            concern,
            package,
            path,
            json,
            all,
            units,
            hints,
        } => {
            if let Some(PracticesAction::Promote(args)) = action {
                // It writes the policy, as `drift init` does: the fact cache as usual.
                return promote::run(root, || load_facts(cli, 0), args);
            }
            // Read-only, as `drift map`: the fact cache only where DRIFT_CACHE_DIR points.
            let facts = read_only_facts(cli)?;
            let rel = match path {
                Some(p) => {
                    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
                    Some(
                        project::rel_in(&canonical, p)
                            .with_context(|| format!("{p} is outside the repository"))?,
                    )
                }
                None => None,
            };
            let scope =
                practices::checked_scope(&facts, concern.as_deref(), package.as_deref(), rel)?;
            let mut r = practices::report_with(root, &facts, scope, *units)?;
            for w in practices::config_warnings(root, &facts) {
                eprintln!("drift practices: {w}");
            }
            let mut stdout = std::io::stdout().lock();
            if *json {
                serde_json::to_writer_pretty(&mut stdout, &r)?;
                writeln!(stdout)?;
            } else if *hints {
                let left_out = practices::without_answered(root, &mut r);
                write!(stdout, "{}", drift_mine::practices::config_hints(&r))?;
                for line in left_out {
                    writeln!(stdout, "{line}")?;
                }
            } else if *all {
                write!(stdout, "{}", drift_mine::practices::render(&r, true))?;
            } else {
                write!(stdout, "{}", drift_mine::practices::render_recipes(&r))?;
            }
        }
        Command::Security {
            files,
            json,
            max,
            diff_base,
            github,
            fail_on,
            write_baseline,
            ratchet,
            top,
        } => {
            const FAIL_ON: &[&str] = &[
                "unguarded-reaching",
                "no-guard",
                "guard-gap",
                "scope-gap",
                "no-authorization",
                "unscoped-key",
                "risky",
                "whole-row",
                "workflow",
                "dependency",
                "kubernetes",
                "leak",
                "public",
                "any",
            ];
            if let Some(unknown) = fail_on.iter().find(|k| !FAIL_ON.contains(&k.as_str())) {
                anyhow::bail!("--fail-on: `{unknown}` is none of {}", FAIL_ON.join(", "));
            }
            if !fail_on.is_empty() && diff_base.is_none() && !*ratchet && !*write_baseline {
                anyhow::bail!("--fail-on needs --diff-base, --ratchet or --write-baseline");
            }
            if *write_baseline && fail_on.iter().any(|k| k == "public") {
                anyhow::bail!(
                    "--fail-on public is read against a commit (--diff-base), not against the baseline"
                );
            }
            if diff_base.is_some()
                && let Some(k) = fail_on.iter().find(|k| {
                    matches!(
                        k.as_str(),
                        "scope-gap"
                            | "no-authorization"
                            | "unscoped-key"
                            | "whole-row"
                            | "workflow"
                            | "dependency"
                            | "kubernetes"
                    )
                })
            {
                anyhow::bail!(
                    "--fail-on {k} is read against the baseline (--ratchet), not against a commit"
                );
            }
            if *ratchet && fail_on.iter().any(|k| k == "public") {
                anyhow::bail!(
                    "--fail-on public is read against a commit (--diff-base), not against the baseline"
                );
            }
            let facts = load_facts(cli, 0)?;
            let mut inv = drift_mine::security::inventory_with(
                &facts,
                drift_mine::security::Boundaries::load(&cli.root),
            );
            inv.workflows = drift_mine::workflows::read(root);
            inv.dependencies = drift_mine::dependencies::read(root);
            inv.cluster = drift_mine::kubernetes::read(root);
            // Each shared guard, linked to the convention that says the same (accepted
            // or proposed), when the project has conventions. A policy that cannot be
            // read only loses the links: the inventory is the repository's, not the
            // policy's, so it is listed with one warning naming the error.
            let linked = (|| -> anyhow::Result<()> {
                if ConventionsFile::load(root)?.is_none() {
                    return Ok(());
                }
                let project = project::Project::open(root)?;
                drift_mine::security::link_conventions(
                    &mut inv,
                    &|path| {
                        let existing = facts.files.iter().find(|f| f.path == path);
                        project.conventions_for_path(
                            path,
                            existing,
                            Some(&mcp::models_in(&facts, path)),
                            false,
                        )
                    },
                    &project::blocks,
                );
                Ok(())
            })();
            if let Err(e) = linked {
                inv.warnings.push(format!(
                    "{CONVENTIONS_FILE} could not be read ({e:#}); shared guards are listed without the conventions they correspond to"
                ));
            }
            if let Some(base) = diff_base {
                let scope = pr::DiffScope::from_git(root, base)?;
                let before = scope.base_inventory(root)?;
                let regs =
                    drift_mine::security::regressions(&before, &inv, &|p| scope.touches(p), &|p| {
                        scope.old_path(p).to_string()
                    });
                let files = scope.added() + scope.changed();
                if !*json {
                    for w in &inv.warnings {
                        eprintln!("drift security: {w}");
                    }
                }
                if *json {
                    let mut v = serde_json::to_value(&regs)?;
                    v["diff"] = serde_json::json!({
                        "base": base,
                        "merge_base": scope.merge_base,
                        "files": files,
                    });
                    if !inv.warnings.is_empty() {
                        v["warnings"] = serde_json::json!(inv.warnings);
                    }
                    println!("{}", serde_json::to_string_pretty(&v)?);
                } else if *github {
                    let mut stdout = std::io::stdout().lock();
                    stdout.write_all(
                        drift_mine::security::github_regression_annotations(&regs).as_bytes(),
                    )?;
                    writeln!(
                        stdout,
                        "drift security: {} entry point(s) lacking a shared guard, {} where Drift found no guard in what it read reaching a risky operation, {} new entry point(s) where Drift found no guard ({} more whose guard is unknown), {} risky operation(s) added, {} new client leak(s), {} now internet-facing; facts for review, nothing fails",
                        regs.guard_gaps.len(),
                        regs.unguarded_reaching.len(),
                        regs.added_without_guard.len(),
                        regs.guard_unknown.len(),
                        regs.sinks.len(),
                        regs.leaks.len(),
                        regs.now_public.len()
                    )?;
                    if let Some(path) =
                        std::env::var_os("GITHUB_STEP_SUMMARY").filter(|p| !p.is_empty())
                    {
                        let md = drift_mine::security::regressions_summary(
                            &regs,
                            base,
                            &scope.merge_base,
                            files,
                        );
                        let mut f = std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&path)
                            .with_context(|| {
                                format!(
                                    "opening GITHUB_STEP_SUMMARY {}",
                                    Path::new(&path).display()
                                )
                            })?;
                        f.write_all(md.as_bytes())?;
                        f.write_all(b"\n")?;
                    }
                } else {
                    print!(
                        "{}",
                        drift_mine::security::render_regressions(
                            &regs,
                            base,
                            &scope.merge_base,
                            files,
                            Some(&cli.root)
                        )
                    );
                }
                // A person asked for the run to fail on what the change introduces
                // (`--fail-on`): counted by kind, said on stderr, exit 1.
                let on = |k: &str| fail_on.iter().any(|f| f == k || f == "any");
                let failing: Vec<(&str, usize)> = [
                    ("unguarded-reaching", regs.unguarded_reaching.len()),
                    ("no-guard", regs.added_without_guard.len()),
                    ("guard-gap", regs.guard_gaps.len()),
                    ("risky", regs.sinks.len()),
                    ("leak", regs.leaks.len()),
                    ("public", regs.now_public.len()),
                ]
                .into_iter()
                .filter(|(k, n)| on(k) && *n > 0)
                .collect();
                if !failing.is_empty() {
                    let said: Vec<String> =
                        failing.iter().map(|(k, n)| format!("{n} {k}")).collect();
                    eprintln!(
                        "drift security: failing as asked (--fail-on {}): this change introduces {}",
                        fail_on.join(","),
                        said.join(", ")
                    );
                    return Ok(ExitCode::from(1));
                }
                return Ok(ExitCode::SUCCESS);
            }
            if *write_baseline {
                let found = baseline_findings(root, &facts, &inv)?;
                // The kinds that fail: what the baseline set before (a person's
                // choice, kept), or every kind but those that advise first; and the
                // kinds named now.
                let mut fail = match drift_mine::ratchet::load_baseline(root)
                    .with_context(|| format!("reading {}", drift_mine::ratchet::SECURITY_LOCK))?
                {
                    Some(b) => b.fail_kinds(),
                    None => drift_mine::ratchet::default_fail(),
                };
                for k in fail_on {
                    if k == "any" {
                        fail.extend(
                            drift_mine::ratchet::KINDS
                                .iter()
                                .map(|(k, _)| (*k).to_string()),
                        );
                    } else {
                        fail.insert(k.clone());
                    }
                }
                let path = root.join(drift_mine::ratchet::SECURITY_LOCK);
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir)
                        .with_context(|| format!("creating {}", dir.display()))?;
                }
                std::fs::write(&path, drift_mine::ratchet::render_lock_with(&found, &fail))
                    .with_context(|| format!("writing {}", path.display()))?;
                let mut by_kind: BTreeMap<&str, usize> = BTreeMap::new();
                for (kind, _) in found.keys() {
                    *by_kind.entry(kind.as_str()).or_default() += 1;
                }
                println!(
                    "Wrote {} ({} finding(s)): {}",
                    drift_mine::ratchet::SECURITY_LOCK,
                    found.len(),
                    drift_mine::ratchet::KINDS
                        .iter()
                        .map(|(k, _)| format!("{} {k}", by_kind.get(k).copied().unwrap_or(0)))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                let advising: Vec<&str> = drift_mine::ratchet::KINDS
                    .iter()
                    .map(|(k, _)| *k)
                    .filter(|k| !fail.contains(*k))
                    .collect();
                println!(
                    "Commit it. `drift check` and `drift security --ratchet` exit 1 when a finding that is not in it appears{}.",
                    if advising.is_empty() {
                        String::new()
                    } else {
                        format!(
                            ", except of {}, which advise (`--write-baseline --fail-on <kind>` sets a kind to fail)",
                            advising.join(", ")
                        )
                    }
                );
                return Ok(ExitCode::SUCCESS);
            }
            if *ratchet {
                let Some(baseline) = drift_mine::ratchet::load_baseline(root)
                    .with_context(|| format!("reading {}", drift_mine::ratchet::SECURITY_LOCK))?
                else {
                    anyhow::bail!(
                        "no security baseline ({}): write one with `drift security --write-baseline`",
                        drift_mine::ratchet::SECURITY_LOCK
                    );
                };
                let found = baseline_findings(root, &facts, &inv)?;
                let result = drift_mine::ratchet::compare_with(&found, &baseline, None);
                if *json {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                } else {
                    for w in &inv.warnings {
                        eprintln!("drift security: {w}");
                    }
                    print!("{}", drift_mine::ratchet::render(&result, *max));
                }
                let on =
                    |k: &str| fail_on.is_empty() || fail_on.iter().any(|f| f == k || f == "any");
                // A kind the baseline lets advise fails only where the person names
                // it; what is new in this version of Drift never does.
                let named = |k: &str| fail_on.iter().any(|f| f == k || f == "any");
                let failing: Vec<String> = result
                    .added
                    .iter()
                    .filter(|(k, rows)| on(k) && !rows.is_empty())
                    .chain(
                        result
                            .advised
                            .iter()
                            .filter(|(k, rows)| named(k) && !rows.is_empty()),
                    )
                    .map(|(k, rows)| format!("{} {k}", rows.len()))
                    .collect();
                if !failing.is_empty() {
                    eprintln!(
                        "drift security: not in the baseline: {}",
                        failing.join(", ")
                    );
                    return Ok(ExitCode::from(1));
                }
                return Ok(ExitCode::SUCCESS);
            }
            // The findings to look at first ([`drift_mine::security_summary`]): ranked
            // facts for a person; nothing reads them to fail, so the exit code stays 0.
            if let Some(n) = top {
                let summary = security_summary(root, &facts, &inv);
                if *json {
                    let mut v = serde_json::to_value(&inv)?;
                    v["top"] = serde_json::to_value(summary.top(*n))?;
                    println!("{}", serde_json::to_string_pretty(&v)?);
                } else {
                    for w in &inv.warnings {
                        eprintln!("drift security: {w}");
                    }
                    print!("{}", drift_mine::security_summary::render(&summary, *n));
                }
                return Ok(ExitCode::SUCCESS);
            }
            if *json {
                println!("{}", serde_json::to_string_pretty(&inv)?);
            } else {
                let only: Option<BTreeSet<String>> = (!files.is_empty()).then(|| {
                    files
                        .iter()
                        .map(|f| f.trim_start_matches("./").to_string())
                        .collect()
                });
                print!(
                    "{}",
                    drift_mine::security::render_at(&inv, only.as_ref(), *max, Some(&cli.root))
                );
            }
        }
        Command::Census {
            max,
            all_outliers,
            json,
            tier: filter,
            candidate,
            python_proposals,
            test_roles,
            kind_roles,
            coverage,
            listed,
            why,
            cap,
        } => {
            let tests = drift_mine::policy::test_roles(root, *test_roles);
            let kind_roles = drift_mine::policy::kind_roles(root, *kind_roles);
            let shapes = (tests, kind_roles);
            if *coverage {
                let facts = read_only_facts(cli)?;
                let kinds = drift_mine::roles::FileKinds {
                    kind_roles,
                    ..map_kinds(root, &facts, true)
                };
                let map = drift_mine::map::RepoMap::build(&facts, &kinds);
                let mut v = drift_mine::map::files_view(&facts, &map);
                map_conventions(root, &facts, &kinds, shapes, *python_proposals, &mut v);
                add_loc(root, &mut v);
                let c = drift_mine::map::coverage(&v);
                if *json {
                    println!("{}", serde_json::to_string_pretty(&c)?);
                } else {
                    print!("{}", drift_mine::map::render_coverage(&c, *max));
                }
                return Ok(ExitCode::SUCCESS);
            }
            let cap = cap.resolve(policy_cap(root));
            let python = drift_mine::policy::python_proposals(root, *python_proposals);
            if let Some(gate) = why {
                return census_why(cli, root, gate, *max, shapes, python, *listed, *json);
            }
            if *json {
                // No side effects: the fact cache is used only where the caller points it.
                let opts = ScanOptions {
                    cache_dir: std::env::var_os("DRIFT_CACHE_DIR")
                        .filter(|_| !cli.no_cache)
                        .map(PathBuf::from),
                    threads: 0,
                };
                let mut facts = scan(root, &opts)
                    .with_context(|| format!("scanning {}", root.display()))?
                    .0;
                if *listed {
                    facts = facts.into_listed();
                }
                // The yield funnel (study only): counted while `DRIFT_FUNNEL` names a file.
                drift_mine::funnel::start();
                let (mut mined, accepted) = census_mine(root, &facts, *max, shapes);
                let wired = wiring::extend(root, &mut facts, &mut mined)?;
                let python_before = workspace::python_by_package(&mined);
                let withheld = withhold_python(python, &mut mined, &accepted);
                // The study's neighbour-gate readings (eval/study/neighbour.mjs), only when asked.
                // Every proposal the miner lets through, before the show policy: the
                // labelled cards include ones the product no longer shows (`shown` marks
                // the others).
                if let Some(p) = std::env::var_os(drift_mine::neighbour::STUDY_ENV) {
                    let all =
                        drift_mine::mine::mine_unshown(&facts, &MineOptions { max_per_repo: *max });
                    let shown: BTreeSet<&str> =
                        mined.candidates.iter().map(|c| c.id.as_str()).collect();
                    let v = drift_mine::neighbour::study(&facts, &all, &shown);
                    std::fs::write(&p, serde_json::to_vec(&v)?)
                        .with_context(|| format!("writing {}", Path::new(&p).display()))?;
                }
                let mut out = census_json(root, &facts, &mined, *max, *filter, *candidate, cap)?;
                if let (Some(p), Some(v)) = (
                    std::env::var_os(drift_mine::funnel::STUDY_ENV),
                    drift_mine::funnel::finish(),
                ) {
                    std::fs::write(&p, serde_json::to_vec_pretty(&v)?)
                        .with_context(|| format!("writing {}", Path::new(&p).display()))?;
                }
                if let Some(w) = &wired {
                    out["wiring"] = wiring::json(w);
                }
                // Only in a repository of several packages: the per-package report.
                if let Some((ws, rows)) =
                    workspace::report(root, &facts, &mined, &python_before, python.on())
                {
                    out["workspace"] = workspace::json(&ws, &rows);
                }
                // Only while Python proposals are off (a person's `proposals: {python: off}`):
                // how many were withheld. Absent when they are on (the default), so that
                // census is what it was before D13-py.
                if !python.on() {
                    out["python_proposals"] = python_proposals_json(withheld);
                }
                // New field: the cards mining withheld, by language, family and reason.
                out["withheld"] = withheld_json(&mined.withheld);
                let mut stdout = std::io::stdout().lock();
                serde_json::to_writer_pretty(&mut stdout, &out)?;
                writeln!(stdout)?;
                return Ok(ExitCode::SUCCESS);
            }
            let mut facts = load_facts(cli, 0)?;
            if *listed {
                let entries =
                    |f: &RepoFacts| -> usize { f.files.iter().map(|x| x.entry_points.len()).sum() };
                let measured = entries(&facts);
                facts = facts.into_listed();
                println!(
                    "Preview (--listed): mined over the {} entry points Drift lists, where the last measured build listed {measured}. The precision of what this proposes was not measured; nothing is written.\n",
                    entries(&facts)
                );
            }
            // Only the caps are recorded (`drift_mine::funnel`), to say when they cut a
            // default-tier rule; recording changes nothing mining proposes.
            drift_mine::funnel::record(Some(drift_mine::funnel::CAP_GATES));
            let (mut mined, accepted) = census_mine(root, &facts, *max, shapes);
            let cut = drift_mine::funnel::take_dropped();
            let wired = wiring::extend(root, &mut facts, &mut mined)?;
            let python_before = workspace::python_by_package(&mined);
            let withheld = withhold_python(python, &mut mined, &accepted);
            let packages = workspace::report(root, &facts, &mined, &python_before, python.on());
            let ordered = tiered(&mined);
            let (d, s) = tier_counts(ordered.iter().map(|c| c.tier()));
            let placed = rank::place(&ordered, cap.0);
            if let Some(n) = census_unchecked_note(&facts, &mined) {
                println!("{n}");
            }
            println!(
                "{} conventions from {} units in {} roles ({d} default tier, {s} suggestions)\n",
                mined.candidates.len(),
                mined.units,
                mined.roles_considered
            );
            for note in agents_notes(&ordered) {
                println!("{note}\n");
            }
            if withheld > 0 {
                println!("{}\n", python_off_note(withheld));
            }
            if let Some(n) = withheld_note(&mined.withheld) {
                println!("{n}\n");
            }
            if let Some((_, rows)) = &packages {
                println!("{}\n", workspace::lines(rows).join("\n"));
            }
            let shown: Vec<(usize, &Candidate)> = placed
                .iter()
                .filter(|p| p.shown && filter.keeps(p.item.tier()))
                .map(|p| (p.rank, *p.item))
                .collect();
            if *filter != TierFilter::All {
                println!("showing {} (--tier)\n", shown.len());
            }
            print_tiered(&shown, *all_outliers);
            if filter.keeps(Tier::Suggestion)
                && let Some(n) = capped_note(&placed, "census")
            {
                println!("{n}\n");
            }
            // Mining's caps can drop a default-tier rule (the `--suggestions` cap never
            // does): say so, only when they did.
            if filter.keeps(Tier::Default)
                && let Some(n) = drift_mine::funnel::cap_note(&cut, *max)
            {
                println!("{n}\n");
            }
            if mined.candidates.is_empty() {
                println!("{}", empty_reason(&facts, &mined));
            } else {
                println!("{CENSUS_NEXT}");
            }
            if let Some(w) = &wired {
                println!("{}", wiring::summary(w));
            }
            if let Some(n) = withheld_next(&mined.withheld) {
                println!("{n}");
            }
        }
        Command::Init {
            max,
            refresh_kinds,
            explain,
            cap,
        } => {
            let mut facts = load_facts(cli, 0)?;
            // Conventions and the lock are committed: never learn them, or baseline
            // violations, from facts that leave files out because of this process's
            // memory (a later run with room would see different violations).
            let unchecked = facts.stack_unavailable();
            if !unchecked.is_empty() {
                bail!(
                    "{} file(s) could not be parsed: no thread stack large enough for them could be reserved (an address-space or memory limit on this run). Nothing was written: conventions and {LOCK_FILE} learned without them would be wrong. Run `drift init` again with more memory (e.g. a higher `ulimit -v`).\n  {}",
                    unchecked.len(),
                    unchecked.join("\n  ")
                );
            }
            let mut existing = ConventionsFile::load(root)?;
            let opts = MineOptions { max_per_repo: *max };
            // Mine over the vocabulary the conventions are enforced with: the one
            // frozen in the conventions file, unless asked to relearn it.
            // Hysteresis: what a person accepted is kept where a small change would have
            // mining propose another convention in its place (`mine_keeping`).
            let accepted = existing
                .as_ref()
                .map(ConventionsFile::accepted_rules)
                .unwrap_or_default();
            let mut mined = match &existing {
                Some(e) if !*refresh_kinds => {
                    mine_keeping(&facts, &opts, e.file_kinds.clone(), &accepted)
                }
                Some(_) => mine_keeping(
                    &facts,
                    &opts,
                    drift_mine::roles::FileKinds::learn_with(
                        &facts,
                        drift_mine::policy::test_roles(root, false),
                        drift_mine::policy::kind_roles(root, false),
                    ),
                    &accepted,
                ),
                None => mine_with_kinds(
                    &facts,
                    &opts,
                    drift_mine::roles::FileKinds::learn_with(
                        &facts,
                        drift_mine::policy::test_roles(root, false),
                        drift_mine::policy::kind_roles(root, false),
                    ),
                ),
            };
            wiring::extend(root, &mut facts, &mut mined)?;
            let python = drift_mine::policy::python_proposals(root, false);
            let python_before = workspace::python_by_package(&mined);
            let withheld = withhold_python(python, &mut mined, &accepted);
            drop_decided(&mut mined, existing.as_ref());
            let packages = workspace::report(root, &facts, &mined, &python_before, python.on());
            if *refresh_kinds
                && let Some(e) = existing.as_mut()
                && e.file_kinds != mined.kinds
            {
                e.file_kinds = mined.kinds.clone();
                eprintln!(
                    "drift: file kinds relearned. Existing conventions keep their ids, but the \
                     files their roles cover may change: run `drift check` and review new \
                     violations of accepted conventions (they are not baselined)."
                );
            }
            let had = existing.is_some();
            // The conventions the policy already had: only a convention new to it has its
            // current violations baselined below.
            let known_ids: BTreeSet<String> = existing
                .as_ref()
                .map(|e| e.conventions.iter().map(|c| c.id.clone()).collect())
                .unwrap_or_default();
            let (mut policy, carried) = ConventionsFile::merge_carrying(
                existing,
                &engine(),
                mined.kinds.clone(),
                &mined.candidates,
            );
            // Version 2 in a workspace: the packages mined over (the hooks and MCP find a
            // file's package from them); none, and version 1, in a single package.
            policy.packages = packages
                .as_ref()
                .map(|(ws, _)| ws.packages.iter().map(|p| p.path.clone()).collect())
                .unwrap_or_default();
            // With the feature off, wiring conventions are not kept: one person's
            // experiment must not become everyone's check.
            if !wiring::enabled(root)? {
                let before = policy.conventions.len();
                policy.conventions.retain(|c| !c.rule.is_wiring());
                let n = before - policy.conventions.len();
                if n > 0 {
                    eprintln!("{}", wiring::off_note(n, "dropped"));
                }
            }
            policy.save(root)?;
            // Co-change rules accepted earlier compare key files mining did not read.
            history::attach_key_files(root, &policy, &mut facts);
            // Baseline only on first init; afterwards the lock only shrinks unless a person edits it.
            let mut lock = Lock::load(root)?;
            // Promoted practices kept from before are baselined as every convention is.
            let fresh = practices::baseline_with_practices(root, &facts, &policy);
            if had {
                // A decision that moved to a new id (its rule gained an alternative) takes
                // its legacy violations with it.
                for (from, to) in &carried {
                    lock.rename(from, to);
                }
                // Only a convention new to the policy gets its current violations
                // baselined; existing entries are kept. A convention the policy had is
                // never baselined again, not even once every line of its old debt is
                // fixed: a violation written since is new, not legacy. A line it already
                // has gains its fingerprint, so that debt follows a move from now on.
                let known: BTreeSet<&str> = known_ids
                    .iter()
                    .map(String::as_str)
                    .chain(carried.iter().map(|(_, to)| to.as_str()))
                    .collect();
                let add: Vec<_> = fresh
                    .entries
                    .iter()
                    .filter(|(id, key)| {
                        !known.contains(id.as_str())
                            || Lock::split_fingerprint(key)
                                .is_some_and(|(_, member)| lock.contains(id, member))
                    })
                    .cloned()
                    .collect();
                lock.entries.extend(add);
            } else {
                lock = fresh;
            }
            lock.save(root)?;
            let ordered = tiered(&mined);
            let (d, s) = tier_counts(ordered.iter().map(|c| c.tier()));
            // What was read, then what the code does and what to look at first: known
            // whatever was mined, so a repository with no convention to propose still
            // opens with something of its own.
            println!(
                "{}",
                read_line(&facts, packages.as_ref().map(|(_, rows)| rows.len()))
            );
            let map = practices::first_run(root, &facts);
            if !map.text.is_empty() {
                println!("\n{}", map.text.trim_end());
            }
            // The few security findings to look at first, from the inventory: facts, not
            // conventions, and nothing checks them ([`drift_mine::security_summary`]).
            {
                let inv = security_inventory(cli, root, &facts);
                let text = drift_mine::security_summary::render_first_run(&security_summary(
                    root, &facts, &inv,
                ));
                if !text.is_empty() {
                    println!("\n{}", text.trim_end());
                }
            }
            println!("\nConventions");
            // The default tier in full, then the best suggestions (`drift_mine::rank`).
            let placed = rank::place(&ordered, cap.resolve(policy.suggestion_cap).0);
            let top: Vec<(usize, &Candidate)> = placed
                .iter()
                .filter(|p| p.shown)
                .map(|p| (p.rank, *p.item))
                .collect();
            let kept_back = mined.withheld.len();
            // On a re-run the decisions already in the file are kept: say so, and
            // count as proposals only what is still to decide.
            let decided = if had {
                policy
                    .conventions
                    .iter()
                    .filter(|c| c.status != Status::Proposed)
                    .count()
            } else {
                0
            };
            let to_review = review_queue(&policy, cap.resolve(policy.suggestion_cap).0)
                .0
                .len();
            if mined.candidates.is_empty() {
                println!("  {}", empty_reason(&facts, &mined));
            } else {
                if decided == 0 {
                    println!(
                        "  {} proposed ({d} default tier, {}). Nothing is checked and no agent is told of one until you decide (`drift review`); an accepted convention advises unless you set it to block.",
                        mined.candidates.len(),
                        count(s, "suggestion")
                    );
                } else {
                    println!(
                        "  {} found ({d} default tier, {}). {} kept as you left {}; {}.",
                        mined.candidates.len(),
                        count(s, "suggestion"),
                        count(decided, "earlier decision"),
                        if decided == 1 { "it" } else { "them" },
                        if to_review == 0 {
                            "nothing new to decide".to_string()
                        } else {
                            format!(
                                "{to_review} still to decide, and nothing of those is checked and no agent is told of one until you do (`drift review`)"
                            )
                        }
                    );
                }
                if kept_back > 0 {
                    println!(
                        "  {} kept back from the list: `drift review --hidden` shows {} with the evidence.",
                        match kept_back {
                            1 => "1 weaker candidate was".to_string(),
                            n => format!("{n} weaker candidates were"),
                        },
                        if kept_back == 1 { "it" } else { "them" }
                    );
                }
                if let Some((_, rows)) = &packages {
                    let with = rows.iter().filter(|r| r.silent.is_none()).count();
                    if with < rows.len() {
                        println!(
                            "  They are in {with} of {} packages; `drift init --explain` says why each of the others has none.",
                            rows.len()
                        );
                    }
                }
                println!();
                print_tiered(&top, false);
                if let Some(n) = capped_note(&placed, "census") {
                    println!("{n}\n");
                }
            }
            if withheld > 0 {
                println!("  {}", python_off_note(withheld));
            }
            let kept = if decided > 0 {
                format!("; {} kept", count(decided, "earlier decision"))
            } else {
                String::new()
            };
            println!(
                "{}Wrote {CONVENTIONS_FILE} and {LOCK_FILE} ({}{kept}).",
                if mined.candidates.is_empty() {
                    "\n"
                } else {
                    ""
                },
                match lock.members() {
                    0 => "no existing violation to record".to_string(),
                    n => format!(
                        "{} recorded, so only new ones are reported",
                        count(n, "existing violation")
                    ),
                }
            );
            // The security baseline, offered where the repository has none: what it
            // would hold and the one command that writes it. Never written here:
            // writing it is what a person accepts. A repository with nothing to hold,
            // or whose inventory cannot be read, is told nothing.
            let security_offer: Option<drift_mine::ratchet::Findings> =
                match drift_mine::ratchet::load_baseline(root) {
                    Ok(None) => {
                        let inv = security_inventory(cli, root, &facts);
                        baseline_findings(root, &facts, &inv)
                            .ok()
                            .filter(|f| !f.is_empty())
                    }
                    _ => None,
                };
            if let Some(found) = &security_offer {
                let mut by_kind: BTreeMap<&str, usize> = BTreeMap::new();
                for (kind, _) in found.keys() {
                    *by_kind.entry(kind.as_str()).or_default() += 1;
                }
                let kinds: Vec<String> = drift_mine::ratchet::KINDS
                    .iter()
                    .filter_map(|(k, _)| by_kind.get(k).map(|n| format!("{n} {k}")))
                    .collect();
                println!(
                    "\nSecurity baseline: none yet. It would hold {} ({}), accepted as they are; new ones are reported by `drift check`. `drift security --write-baseline` writes it ({}); nothing was written.",
                    count(found.len(), "finding"),
                    kinds.join(", "),
                    drift_mine::ratchet::SECURITY_LOCK
                );
            }
            // One block of what to run next, each with what it is for; nothing where
            // there is nothing to do.
            let mut steps: Vec<String> = Vec::new();
            let mut next =
                |command: &str, what: String| steps.push(format!("  {command:<26} {what}"));
            if to_review > 0 {
                next(
                    "drift review",
                    format!("accept or reject the {}", count(to_review, "proposal")),
                );
            }
            if kept_back > 0 {
                next(
                    "drift review --hidden",
                    format!(
                        "the {}, with the evidence",
                        count(kept_back, "weaker candidate")
                    ),
                );
            }
            match setup::open_questions(root, &facts) {
                0 => {}
                1 => next("drift setup", "1 question only you can answer".into()),
                n => next("drift setup", format!("{n} questions only you can answer")),
            }
            if let Some((units, names)) = map.hints {
                next(
                    "drift practices --hints",
                    format!(
                        "the config lines for {} Drift cannot classify alone ({} of the map)",
                        count(names, "name"),
                        count(units, "unit")
                    ),
                );
            }
            if map.known {
                next(
                    "drift practices",
                    "the whole map, with a file to copy for each way".into(),
                );
                next(
                    "drift security",
                    "entry points, their guards and the risky operations they reach".into(),
                );
            }
            if !*explain && (kept_back > 0 || packages.is_some()) {
                next(
                    "drift init --explain",
                    match (kept_back > 0, packages.is_some()) {
                        (true, true) => "what was kept back and why, package by package",
                        (true, false) => "what was kept back and why",
                        _ => "what each package has, and why some have nothing proposed",
                    }
                    .into(),
                );
            }
            if let Some(found) = &security_offer {
                next(
                    "drift security --write-baseline",
                    format!(
                        "accept the {} as they are; `drift check` then reports new ones",
                        count(found.len(), "security finding")
                    ),
                );
            }
            if !steps.is_empty() {
                println!("\nNext\n{}", steps.join("\n"));
            }
            println!(
                "\nTip: add `drift.lock merge=union` to .gitattributes so branches never conflict on the lock."
            );
            if *explain {
                println!("\nExplained");
                for note in agents_notes(&ordered) {
                    println!("{note}");
                }
                if let Some(n) = withheld_note(&mined.withheld) {
                    println!("{n}");
                }
                if let Some((_, rows)) = &packages {
                    println!("{}", workspace::lines(rows).join("\n"));
                }
                if let Some(note) = &map.note {
                    println!("{note}");
                }
                if let Some(n) = withheld_next(&mined.withheld) {
                    println!("{n}");
                }
            }
        }
        Command::Setup {
            list,
            json,
            answer,
            answers,
            forget,
            all,
            interactive,
            by,
            reason,
            evidence,
            review,
            confirm,
            reject,
            agent_brief,
        } => {
            if *agent_brief {
                print!("{}", setup::AGENT_BRIEF);
                return Ok(ExitCode::SUCCESS);
            }
            let by = match by {
                Some(b) => setup::By::parse(b)?,
                None => setup::default_by(),
            };
            // A person's word is taken where a person is there to give it: a terminal,
            // or a script a person runs and says so (`DRIFT_SETUP_PERSON=1`). An agent
            // passing `--by person` is not enough.
            let writes = !answer.is_empty()
                || answers.is_some()
                || !forget.is_empty()
                || *review
                || !confirm.is_empty()
                || !reject.is_empty()
                || *interactive;
            setup::person_is_there(by, writes)?;
            let for_person = |what: &str| -> anyhow::Result<()> {
                if by == setup::By::Agent {
                    bail!(
                        "{what} is for a person: an agent's answers wait for one (run it in a terminal, or, for a script a person runs, with --by person and {}=1){}",
                        setup::PERSON_ENV,
                        if setup::agent_env() {
                            format!(
                                ". This run is an agent's: {} is set or {}=1",
                                setup::CLAUDE_CODE_ENV,
                                setup::AGENT_ENV
                            )
                        } else {
                            String::new()
                        }
                    );
                }
                Ok(())
            };
            if *review || !confirm.is_empty() || !reject.is_empty() {
                for_person(if *review {
                    "--review"
                } else if confirm.is_empty() {
                    "--reject"
                } else {
                    "--confirm"
                })?;
            }
            let terminal = std::io::stdin().is_terminal() && std::io::stdout().is_terminal();
            // The questions one at a time, in a terminal or with --interactive.
            let asks = answer.is_empty()
                && answers.is_none()
                && forget.is_empty()
                && !*json
                && !*list
                && (terminal || *interactive);
            if asks {
                for_person("asking one question at a time")?;
            }
            // Reading the repository comes before the first question and takes a while on
            // a large one: a person is told at once, on stderr, so nothing they read or
            // pipe from stdout changes.
            if asks || *review {
                eprintln!(
                    "Reading the repository to ask its questions (this can take a minute on a large one)..."
                );
            }
            let facts = read_only_facts(cli)?;
            let mut s = setup::Setup::new(root, &facts)?;
            let mut stdout = std::io::stdout().lock();
            if !confirm.is_empty() || !reject.is_empty() {
                for id in confirm {
                    let said = s.confirm(id.trim())?;
                    writeln!(stdout, "{}: confirmed: {said}", id.trim())?;
                }
                for id in reject {
                    if id.trim().starts_with(setup::investigate::PREFIX) {
                        s.check_removable(id.trim(), None)?;
                    }
                    let said = s.reject(id.trim())?;
                    writeln!(stdout, "{}: {said}", id.trim())?;
                }
                return Ok(ExitCode::SUCCESS);
            }
            if *review {
                let stdin = std::io::stdin();
                let mut input = stdin.lock();
                setup::review(&mut s, &mut input, &mut stdout)?;
                return Ok(ExitCode::SUCCESS);
            }
            if !answer.is_empty() || answers.is_some() || !forget.is_empty() {
                for id in forget {
                    s.forget(id, by)?;
                    writeln!(
                        stdout,
                        "{id}: forgotten; what it wrote is out of {}",
                        drift_mine::policy::CONFIG_FILE
                    )?;
                }
                let mut items: Vec<(String, String, setup::Given)> = Vec::new();
                for a in answer {
                    let Some((id, value)) = a.split_once('=') else {
                        bail!(
                            "--answer takes ID=ANSWER (as `drift setup --list` prints it), got {a:?}"
                        );
                    };
                    items.push((
                        id.trim().to_string(),
                        value.trim().to_string(),
                        setup::Given {
                            by,
                            reason: reason.clone().unwrap_or_default(),
                            evidence: evidence.clone().unwrap_or_default(),
                        },
                    ));
                }
                if let Some(file) = answers {
                    items.extend(setup::answers_file(file, by)?);
                }
                if let [(id, value, given)] = items.as_slice() {
                    let said = s.answer(id, value, given)?;
                    writeln!(stdout, "{id}: {said}")?;
                    return Ok(ExitCode::SUCCESS);
                }
                let mut failed = 0;
                for (id, said) in s.answer_many(&items) {
                    match said {
                        Ok(said) => writeln!(stdout, "{id}: {said}")?,
                        Err(e) => {
                            failed += 1;
                            eprintln!("drift: {id}: not answered: {e:#}");
                        }
                    }
                }
                let waiting = s.waiting();
                if waiting > 0 {
                    writeln!(
                        stdout,
                        "{waiting} answer{} by an agent wait{} for a person: `drift setup --review`.",
                        if waiting == 1 { "" } else { "s" },
                        if waiting == 1 { "s" } else { "" }
                    )?;
                }
                return Ok(if failed > 0 {
                    ExitCode::FAILURE
                } else {
                    ExitCode::SUCCESS
                });
            }
            if *json {
                serde_json::to_writer_pretty(
                    &mut stdout,
                    &s.listing_with(*all, evidence.is_some()),
                )?;
                writeln!(stdout)?;
            } else if !asks {
                write!(stdout, "{}", setup::list_text(&s.listing(*all)))?;
            } else {
                let stdin = std::io::stdin();
                let mut input = stdin.lock();
                setup::interactive(&mut s, *all, &mut input, &mut stdout)?;
            }
        }
        Command::Investigate {
            list: _,
            json,
            all,
            item,
            limit,
            offset,
            record,
            answers,
            by,
            reason,
            evidence,
            routes,
            title,
            fix,
            patch,
            agent_brief,
        } => {
            if *agent_brief {
                print!("{}", setup::investigate::AGENT_BRIEF);
                return Ok(ExitCode::SUCCESS);
            }
            let by = match by {
                Some(b) => setup::By::parse(b)?,
                None => setup::default_by(),
            };
            setup::person_is_there(by, !record.is_empty() || answers.is_some())?;
            // One scan, the fact cache reused unless --no-cache.
            let facts = {
                let opts = ScanOptions {
                    cache_dir: project::cache_dir(root, cli.no_cache),
                    threads: 0,
                };
                scan(root, &opts)
                    .with_context(|| format!("scanning {}", root.display()))?
                    .0
            };
            let mut s = setup::Setup::new(root, &facts)?;
            let mut stdout = std::io::stdout().lock();
            if !record.is_empty() || answers.is_some() {
                let patch = match patch {
                    Some(p) => std::fs::read_to_string(p)
                        .with_context(|| format!("reading {}", p.display()))?,
                    None => String::new(),
                };
                let mut items: Vec<setup::investigate::Recorded> = Vec::new();
                for a in record {
                    let Some((id, value)) = a.split_once('=') else {
                        bail!(
                            "--record takes ID=OUTCOME (as `drift investigate --list` prints it), got {a:?}"
                        );
                    };
                    items.push((
                        id.trim().to_string(),
                        value.trim().to_string(),
                        setup::Given {
                            by,
                            reason: reason.clone().unwrap_or_default(),
                            evidence: evidence.clone().unwrap_or_default(),
                        },
                        setup::investigate::Extra {
                            title: title.clone().unwrap_or_default(),
                            fix: fix.clone().unwrap_or_default(),
                            patch: patch.clone(),
                            routes: routes.clone().unwrap_or_default(),
                            ..Default::default()
                        },
                    ));
                }
                if let Some(file) = answers {
                    items.extend(setup::investigate::answers_file(file, by)?);
                }
                if let [(id, value, given, extra)] = items.as_slice() {
                    let said = s.record(id, value, given, extra)?;
                    writeln!(stdout, "{id}: {said}")?;
                    if s.waiting() > 0 {
                        writeln!(
                            stdout,
                            "{} answer{} by an agent wait{} for a person: `drift setup --review`.",
                            s.waiting(),
                            if s.waiting() == 1 { "" } else { "s" },
                            if s.waiting() == 1 { "s" } else { "" }
                        )?;
                    }
                    return Ok(ExitCode::SUCCESS);
                }
                let mut failed = 0;
                for (id, said) in s.record_many(&items) {
                    match said {
                        Ok(said) => writeln!(stdout, "{id}: {said}")?,
                        Err(e) => {
                            failed += 1;
                            eprintln!("drift: {id}: not recorded: {e:#}");
                        }
                    }
                }
                let waiting = s.waiting();
                if waiting > 0 {
                    writeln!(
                        stdout,
                        "{waiting} answer{} by an agent wait{} for a person: `drift setup --review`.",
                        if waiting == 1 { "" } else { "s" },
                        if waiting == 1 { "s" } else { "" }
                    )?;
                }
                return Ok(if failed > 0 {
                    ExitCode::FAILURE
                } else {
                    ExitCode::SUCCESS
                });
            }
            let listing = s.investigation(*all, evidence.is_some(), item)?;
            if let Some(limit) = limit {
                let page = listing.page(offset.unwrap_or(0), usize::from(*limit));
                serde_json::to_writer_pretty(&mut stdout, &page)?;
                writeln!(stdout)?;
            } else if *json {
                serde_json::to_writer_pretty(&mut stdout, &listing)?;
                writeln!(stdout)?;
            } else {
                write!(stdout, "{}", setup::investigate::list_text(&listing))?;
            }
        }
        Command::Findings {
            json,
            issue,
            write,
            force,
            branch,
        } => {
            let mut stdout = std::io::stdout().lock();
            if let Some(id) = issue {
                let draft = findings::issue(&findings::finding(root, id.trim())?);
                match write {
                    Some(file) => {
                        findings::write_issue(root, file, &draft, *force)?;
                        writeln!(
                            stdout,
                            "Wrote the issue draft to {}; nothing was posted.",
                            file.display()
                        )?;
                    }
                    None => write!(stdout, "{draft}")?,
                }
            } else if let Some(id) = branch {
                writeln!(stdout, "{}", findings::branch(root, id.trim())?)?;
            } else if *json {
                serde_json::to_writer_pretty(&mut stdout, &findings::listing(root))?;
                writeln!(stdout)?;
            } else {
                write!(stdout, "{}", findings::list_text(root))?;
            }
        }
        Command::Review {
            accept,
            reject,
            block,
            force,
            advise,
            show_to_agents,
            list,
            show,
            all_outliers,
            exempt,
            unexempt,
            member,
            reason,
            log,
            set_log,
            export_log,
            include_paths,
            shown,
            json,
            answer,
            set_apart,
            confirm_entry,
            hidden,
            cap,
        } => {
            let mut policy = require_policy(root)?;
            let decisions = !(accept.is_empty()
                && reject.is_empty()
                && block.is_empty()
                && advise.is_empty()
                && show_to_agents.is_empty());
            let modes = [
                decisions,
                *list,
                !show.is_empty(),
                exempt.is_some(),
                unexempt.is_some(),
                set_log.is_some(),
                export_log.is_some(),
                !shown.is_empty(),
                *json,
                answer.is_some(),
            ];
            if modes.iter().filter(|m| **m).count() > 1 {
                bail!(
                    "--list, --show, --exempt, --unexempt, --set-log, --export-log, --shown, --json and --answer each go alone, without decision flags (--accept, --block, ...); nothing was changed"
                );
            }
            if *hidden {
                // Only the answer and the JSON questions go with it (and --all-outliers,
                // --log, --set-apart, --confirm-entry).
                if modes.iter().filter(|m| **m).count() > usize::from(*json || answer.is_some()) {
                    bail!(
                        "--hidden goes alone, or with --answer ID=... or --json; nothing was changed"
                    );
                }
                return review_hidden(
                    cli,
                    &mut policy,
                    answer.as_deref(),
                    *json,
                    set_apart,
                    confirm_entry,
                    *all_outliers,
                    *log,
                );
            }
            if *json {
                let (facts, report) = review_report(cli, &policy)?;
                let ids: Vec<&str> = drift_mine::calibrate::candidates(&policy)
                    .iter()
                    .map(|c| c.id.as_str())
                    .collect();
                let qs = drift_mine::calibrate::questions(&facts, &policy, &report, &ids);
                println!("{}", serde_json::to_string_pretty(&questions_json(&qs))?);
                return Ok(ExitCode::SUCCESS);
            }
            if let Some(setting) = set_log {
                let want = match setting {
                    LogSetting::On => drift_mine::policy::Switch::On,
                    LogSetting::Off => drift_mine::policy::Switch::Off,
                };
                if policy.review_log != want {
                    policy.review_log = want;
                    policy.save(root)?;
                }
                match setting {
                    LogSetting::On => println!(
                        "review log on: drift review and the Studio record each decision and each card shown in {}/ (local only, never sent; not committed). `drift review --export-log FILE` writes a study file; `--set-log off` stops it.",
                        review_log::DIR
                    ),
                    LogSetting::Off => println!(
                        "review log off: nothing more is recorded. What {}/ holds is kept (delete it to remove it).",
                        review_log::DIR
                    ),
                }
                return Ok(ExitCode::SUCCESS);
            }
            if let Some(path) = export_log {
                let study = review_log::export(root, *include_paths)?;
                let n = study["events"].as_array().map_or(0, Vec::len);
                let mut text = serde_json::to_string_pretty(&study)?;
                text.push('\n');
                write_out(root, path, text.as_bytes())?;
                println!(
                    "wrote {n} review events to {}{}",
                    path.display(),
                    if *include_paths {
                        " (ids, members, examples and reasons as they are: --include-paths)"
                    } else {
                        " (ids, members and examples hashed with this repository's salt; reasons left out)"
                    }
                );
                return Ok(ExitCode::SUCCESS);
            }
            let interactive = !(decisions
                || *list
                || !show.is_empty()
                || exempt.is_some()
                || unexempt.is_some()
                || !shown.is_empty()
                || answer.is_some());
            let mut rlog = review_log::ReviewLog::new(
                root,
                &policy,
                *log,
                interactive,
                cap.resolve(policy.suggestion_cap).0,
                || load_facts(cli, 0).ok(),
            );
            if !shown.is_empty() {
                known_ids(&policy, shown)?;
                for id in shown {
                    if let Some(c) = policy.conventions.iter().find(|c| &c.id == id) {
                        rlog.shown(c, None);
                    }
                }
                if rlog.on() {
                    println!("recorded {} shown card(s) in the review log", rlog.len());
                } else {
                    println!(
                        "the review log is off: nothing recorded (`drift review --set-log on` turns it on)"
                    );
                }
                rlog.flush();
                return Ok(ExitCode::SUCCESS);
            }
            let more = if *all_outliers {
                OutlierCap::All
            } else {
                OutlierCap::First(CARD_OUTLIERS)
            };
            if *list || !show.is_empty() {
                if !*list {
                    known_ids(&policy, show)?;
                }
                let mut facts = load_facts(cli, 0)?;
                let ids = if *list {
                    let (ids, note) = review_queue(&policy, cap.resolve(policy.suggestion_cap).0);
                    println!("{} proposed conventions to review.", ids.len());
                    if let Some(n) = note {
                        println!("{n}");
                    }
                    // What mining withheld, so an empty queue says why it is empty.
                    if let Some(n) = withheld_note(&withheld_now(root, &facts, &policy)) {
                        println!("{n}");
                    }
                    // Promoted practices are never proposals: listed with where they came from.
                    for line in promote::listed(&policy) {
                        println!("{line}");
                    }
                    ids
                } else {
                    show.clone()
                };
                let report = review_report_on(cli, &mut facts, &policy)?;
                for id in &ids {
                    if let Some(c) = policy.conventions.iter().find(|c| &c.id == id) {
                        print_convention_card(c, &report, more);
                        rlog.shown(c, Some(&report));
                    }
                }
                rlog.flush();
                return Ok(ExitCode::SUCCESS);
            }
            if let Some(a) = answer {
                let (id, kind) = parse_answer(a)?;
                known_ids(&policy, std::slice::from_ref(&id))?;
                if !set_apart.is_empty() && kind != Answer::Different {
                    bail!("--set-apart goes with --answer {id}=different; nothing was changed");
                }
                let (facts, report) = review_report(cli, &policy)?;
                let Some(q) =
                    drift_mine::calibrate::questions(&facts, &policy, &report, &[id.as_str()])
                        .pop()
                else {
                    bail!(
                        "{id} is not a block candidate (a proposed default-tier convention): the question is asked of those only; use --accept or --reject; nothing was changed"
                    );
                };
                let files = set_apart
                    .iter()
                    .map(|p| drift_mine::policy::different_kind_path(p.trim_start_matches("./")))
                    .collect::<anyhow::Result<Vec<_>>>()
                    .context("nothing was changed")?;
                let confirm = confirm_entry
                    .iter()
                    .map(|m| drift_mine::policy::exception_member(m))
                    .collect::<anyhow::Result<Vec<_>>>()
                    .context("nothing was changed")?;
                let diff = match kind {
                    Answer::Different => Some(
                        drift_mine::calibrate::different(&q, &files, &confirm)
                            .context("nothing was changed")?,
                    ),
                    _ => None,
                };
                let c = policy.get_mut(&id).expect("known");
                let before = rlog.before(c);
                for line in apply_answer(c, kind, diff.as_ref()) {
                    println!("{line}");
                }
                let decision = if kind == Answer::NotAConvention {
                    "reject"
                } else {
                    "accept"
                };
                rlog.answered(&before, c, &q, kind.name(), decision, diff.as_ref());
                policy.save(root)?;
                rlog.flush();
                println!("{}", review_summary(&policy));
                return Ok(ExitCode::SUCCESS);
            }
            if let Some(id) = exempt {
                known_ids(&policy, std::slice::from_ref(id))?;
                let member = drift_mine::policy::exception_member(member.as_deref().unwrap_or(""))?;
                let reason = drift_mine::policy::exception_reason(reason.as_deref().unwrap_or(""))
                    .context("nothing was changed")?;
                let c = policy
                    .conventions
                    .iter()
                    .find(|c| &c.id == id)
                    .expect("known");
                if c.status == Status::Rejected {
                    bail!(
                        "{id} is rejected, so nothing checks it: no exception is needed; nothing was changed"
                    );
                }
                // Only an outlier as `drift check` sees it now (or one already marked fine).
                let report = review_outliers(cli, &policy)?;
                let flagged = report
                    .violations
                    .iter()
                    .any(|v| &v.id == id && format!("{}#{}", v.path, v.symbol) == member)
                    || report.exempt.iter().any(|e| {
                        &e.id == id
                            && e.code == drift_mine::check::REVIEWED
                            && format!("{}#{}", e.path, e.symbol) == member
                    });
                if !flagged {
                    bail!(
                        "{member} is not an outlier of {id} in the code now (`drift review --show {id}` lists them); nothing was changed"
                    );
                }
                let before = rlog.before(c);
                let c = policy.get_mut(id).expect("known");
                c.set_exception(&member, &reason);
                rlog.decision("exempt", &before, c, Some(&member), Some(&reason));
                policy.save(root)?;
                rlog.flush();
                println!(
                    "{id}: {member} marked fine ({reason}). `drift check` lists it as exempt, not as a violation; `drift review --unexempt {id} --member {member}` undoes it."
                );
                return Ok(ExitCode::SUCCESS);
            }
            if let Some(id) = unexempt {
                known_ids(&policy, std::slice::from_ref(id))?;
                let member = member.as_deref().unwrap_or("");
                let before = rlog.before(policy.get_mut(id).expect("known"));
                let c = policy.get_mut(id).expect("known");
                if !c.remove_exception(member) {
                    bail!("{id} has no exception for {member}; nothing was changed");
                }
                rlog.decision("unexempt", &before, c, Some(member), None);
                policy.save(root)?;
                rlog.flush();
                println!("{id}: {member} is checked again (exception removed).");
                return Ok(ExitCode::SUCCESS);
            }
            if !decisions {
                if !std::io::stdin().is_terminal() {
                    bail!(
                        "`drift review` needs a terminal; use --accept/--reject/--block/--advise in scripts (--list prints the cards)"
                    );
                }
                let cap = cap.resolve(policy.suggestion_cap).0;
                let (facts, report) = review_report(cli, &policy)?;
                let withheld = withheld_now(root, &facts, &policy);
                // Nothing to ask about: say so in one line, with where the withheld cards are.
                if review_queue(&policy, cap).0.is_empty() {
                    println!("{}", nothing_to_ask(&withheld));
                    // The practices that may be promoted are offered all the same.
                    let map = practices::report_units_kept(root, &facts, None);
                    drop(facts);
                    if promote::review_step(root, &map, &mut policy)? {
                        policy.save(root)?;
                        println!("{}", review_summary(&policy));
                    }
                    return Ok(ExitCode::SUCCESS);
                }
                if let Some(n) = withheld_note(&withheld) {
                    println!("{n}\n");
                }
                let ids: Vec<&str> = drift_mine::calibrate::candidates(&policy)
                    .iter()
                    .map(|c| c.id.as_str())
                    .collect();
                let questions: BTreeMap<String, drift_mine::calibrate::Question> =
                    drift_mine::calibrate::questions(&facts, &policy, &report, &ids)
                        .into_iter()
                        .map(|q| (q.id.clone(), q))
                        .collect();
                // After the proposals (unless the person quit), the practices that may
                // be promoted, one at a time.
                if review_interactive(&mut policy, cap, &report, &questions, more, &mut rlog)? {
                    let map = practices::report_units_kept(root, &facts, None);
                    drop(facts);
                    promote::review_step(root, &map, &mut policy)?;
                }
            } else {
                // Refuse before changing anything: an id that is not in the policy,
                // or one asked to both advise and block (or be rejected).
                let unknown: Vec<&str> = [accept, reject, block, advise, show_to_agents]
                    .into_iter()
                    .flatten()
                    .filter(|id| policy.conventions.iter().all(|c| &c.id != *id))
                    .map(String::as_str)
                    .collect();
                if !unknown.is_empty() {
                    bail!(
                        "unknown convention {}, nothing was changed. The ids are in {CONVENTIONS_FILE} (`drift census` lists the proposals); `drift init` adds newly learned ones",
                        unknown.join(", ")
                    );
                }
                let both: Vec<&str> = advise
                    .iter()
                    .filter(|id| block.contains(id) || reject.contains(id))
                    .map(String::as_str)
                    .collect();
                if !both.is_empty() {
                    bail!(
                        "{} given to --advise and to --block or --reject, nothing was changed",
                        both.join(", ")
                    );
                }
                let both: Vec<&str> = show_to_agents
                    .iter()
                    .filter(|id| reject.contains(id))
                    .map(String::as_str)
                    .collect();
                if !both.is_empty() {
                    bail!(
                        "{} given to --show-to-agents and to --reject, nothing was changed",
                        both.join(", ")
                    );
                }
                // Refuse before changing anything: a promoted practice blocks only through
                // the replay of recent history, which `--force` does not lift.
                for line in
                    promote::review_block(root, || load_facts(cli, 0), &policy, block, *force)?
                {
                    eprintln!("{line}");
                }
                // Refuse before changing anything: a suggestion blocks only when forced.
                let refused: Vec<String> = block
                    .iter()
                    .filter_map(|id| policy.conventions.iter().find(|c| &c.id == id))
                    .filter(|c| !c.rule.is_practice())
                    .filter(|c| !force && block_guard(c) == BlockGuard::Suggestion)
                    .map(|c| {
                        format!(
                            "{} is a {}: suggestions advise and do not block by default",
                            c.id,
                            c.describe_tier()
                        )
                    })
                    .collect();
                if !refused.is_empty() {
                    bail!(
                        "refusing to block, nothing was changed:\n  {}\nAccept with --accept to have it advise, or add --force to block it anyway.",
                        refused.join("\n  ")
                    );
                }
                // What each convention was before this run, for the review log.
                let befores: BTreeMap<String, review_log::Before> = policy
                    .conventions
                    .iter()
                    .filter(|_| rlog.on())
                    .map(|c| (c.id.clone(), rlog.before(c)))
                    .collect();
                let mut logged: Vec<(&str, &String)> = Vec::new();
                for (ids, status, mode) in [
                    (accept, Status::Accepted, None),
                    (reject, Status::Rejected, None),
                    (block, Status::Accepted, Some(Mode::Block)),
                    (advise, Status::Accepted, Some(Mode::Advise)),
                ] {
                    for id in ids {
                        let c = policy
                            .get_mut(id)
                            .with_context(|| format!("unknown convention {id}"))?;
                        logged.push(match (status, mode) {
                            (Status::Rejected, _) => ("reject", id),
                            (_, Some(Mode::Block)) if c.rule.is_practice() => ("block", id),
                            (_, Some(Mode::Block)) if block_guard(c) == BlockGuard::Suggestion => {
                                ("force_block", id)
                            }
                            (_, Some(Mode::Block)) => ("block", id),
                            (_, Some(Mode::Advise)) => ("advise", id),
                            _ => ("accept", id),
                        });
                        c.status = status;
                        if let Some(m) = mode {
                            match (m, block_guard(c)) {
                                (Mode::Block, BlockGuard::Experimental) => {
                                    eprintln!(
                                        "{id}: experimental wiring rules only advise: accepted as advise"
                                    );
                                    c.mode = Mode::Advise;
                                }
                                (Mode::Block, BlockGuard::SmallRole) => {
                                    eprintln!(
                                        "{id}: only {} examples: accepted as advise (blocking needs {MIN_BLOCK_ROLE_SIZE})",
                                        c.evidence.role_size()
                                    );
                                    c.mode = Mode::Advise;
                                }
                                // Through the replay above, not by tier.
                                (Mode::Block, _) if c.rule.is_practice() => c.mode = m,
                                (Mode::Block, BlockGuard::Suggestion) => {
                                    eprintln!("{id}: {} set to block (--force)", c.describe_tier());
                                    c.mode = m;
                                }
                                _ => c.mode = m,
                            }
                        }
                    }
                }
                for id in show_to_agents {
                    let c = policy
                        .get_mut(id)
                        .with_context(|| format!("unknown convention {id}"))?;
                    show_to_agents_now(c);
                    logged.push(("show_to_agents", id));
                }
                for (decision, id) in logged {
                    if let (Some(before), Some(c)) = (
                        befores.get(id),
                        policy.conventions.iter().find(|c| &c.id == id),
                    ) {
                        rlog.decision(decision, before, c, None, None);
                    }
                }
            }
            policy.save(root)?;
            rlog.flush();
            println!("{}", review_summary(&policy));
        }
        Command::Example { file } => {
            // An agent's question (SessionStart points it here): what agents are shown.
            let project = project::Project::open_for_agents(root)?;
            let facts = load_facts(cli, 0)?;
            // Repo-relative, or absolute (made so from a subdirectory: `nearest_policy`).
            let want = if Path::new(file.as_str()).is_absolute() {
                project
                    .rel(file)
                    .unwrap_or_else(|| file.trim_start_matches("./").to_string())
            } else {
                file.trim_start_matches("./").to_string()
            };
            let want = want.as_str();
            let print = |convs: &[&Convention], indent: &str| {
                for line in example_lines(convs) {
                    println!("{indent}{line}");
                }
            };
            match facts.files.iter().find(|f| f.path == want) {
                Some(target) => {
                    let models = mcp::models_in(&facts, want);
                    let convs =
                        project.conventions_for_path(want, Some(target), Some(&models), false);
                    print(&convs, "");
                    if convs.is_empty() {
                        println!("no learned role covers {want}");
                        if let Some(line) = card::copy_from(root, &facts, want) {
                            println!("{line}");
                        }
                    }
                }
                // Not written yet: which rules apply depends on what the file will declare.
                None => match project.rules_for_new_file(want, None, false) {
                    project::NewFileRules::Grouped(groups) if !groups.is_empty() => {
                        for (when, convs) in groups {
                            println!("{}:", when.as_deref().unwrap_or("any file"));
                            print(&convs, "  ");
                        }
                    }
                    _ => {
                        println!("no learned role covers {want}");
                        if let Some(line) = card::copy_from(root, &facts, want) {
                            println!("{line}");
                        }
                    }
                },
            }
        }
        Command::Hook {
            agent: Agent::Claude,
            event,
        } => {
            if let Some(out) = agent::handle(event) {
                println!("{out}");
            }
        }
        Command::Mcp => mcp::serve(root, cli.no_cache)?,
        Command::Export {
            what: ExportKind::AgentsMd,
            write,
        } => {
            // AGENTS.md is for agents: only what agents are shown.
            let project = project::Project::open_for_agents(root)?;
            let block = export::block(&project);
            match write {
                Some(path) => {
                    let existed = path.exists();
                    let existing = std::fs::read_to_string(path).unwrap_or_default();
                    write_out(root, path, export::splice(&existing, &block).as_bytes())?;
                    let verb = if existed { "updated" } else { "created" };
                    println!("{verb} {}", path.display());
                }
                None => println!("{block}"),
            }
        }
        Command::Export {
            what: ExportKind::ClaudeSettings,
            write,
        } => {
            let entries = lookup::claude_settings("drift");
            match write {
                Some(path) => {
                    let existed = path.exists();
                    let existing = std::fs::read_to_string(path).unwrap_or_default();
                    let merged =
                        lookup::merge_settings(&existing, &entries).with_context(|| {
                            format!("{} is not a JSON object; nothing written", path.display())
                        })?;
                    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
                        std::fs::create_dir_all(dir)?;
                    }
                    let mut text = serde_json::to_string_pretty(&merged)?;
                    text.push('\n');
                    write_out(root, path, text.as_bytes())?;
                    let verb = if existed { "updated" } else { "created" };
                    println!("{verb} {}", path.display());
                }
                None => println!("{}", serde_json::to_string_pretty(&entries)?),
            }
        }
        Command::Check {
            files,
            format,
            strict,
            diff_base,
            include_hidden: _,
        } => {
            let mut policy = require_policy(root)?;
            wiring::gate(root, &mut policy, true)?;
            let lock = Lock::load(root)?;
            // Before the scan, so a path outside the repository fails fast.
            let only = check_paths(root, files)?;
            // Before the scan, so a missing base fails fast.
            let scope = match diff_base {
                Some(base) => Some(pr::DiffScope::from_git(root, base)?),
                None => None,
            };
            // Left for the exit to free: the command ends with its report, and freeing
            // the facts of a large repository takes tens of milliseconds.
            let mut facts = std::mem::ManuallyDrop::new(load_facts(cli, 0)?);
            history::attach_key_files(root, &policy, &mut facts);
            if let Some(only) = &only {
                warn_unchecked_paths(root, &facts, only);
            }
            // The practice map of these facts, with units listed: built (or read back from
            // where it is kept) once, for the promoted practices and for the departures
            // listed after the report, and only when one of them asks for it.
            let map_kept = std::cell::OnceCell::new();
            let map = std::cell::OnceCell::new();
            let map_of = || {
                map.get_or_init(|| {
                    let kept = map_kept.get_or_init(|| {
                        derived::Derived::of(cache_dir(root, cli.no_cache), &facts)
                    });
                    practices::report_units_kept(root, &facts, kept.as_ref())
                })
            };
            let mut full = practices::check_with_map(
                &facts,
                &policy,
                &lock,
                Scope::Accepted,
                only.as_ref(),
                map_of,
            );
            drift_mine::check::locate_imports(&mut full, root);
            // Experimental: suggestions the host agent verified are shown to agents too.
            let verify = drift_mine::verify::statuses(root, &policy, || Some(&*facts));
            // New violations the diff did not introduce are not reported, but they are counted.
            let (report, outside, scope) = match scope {
                Some(mut s) => {
                    let mut r = s.filter(root, &full, &lock);
                    // A violation outside the diff that would fail the check may still be
                    // caused by it (a deleted wrapper, a changed re-export): then compare
                    // with the merge base. The common case never scans it.
                    let fails = |v: &&drift_mine::check::Violation| v.fails(*strict);
                    let kept: BTreeSet<_> = r.new_violations().collect();
                    if full
                        .new_violations()
                        .filter(fails)
                        .any(|v| !kept.contains(v))
                    {
                        s.check_base(root, &policy, &lock)?;
                        r = s.filter(root, &full, &lock);
                    }
                    // New in the whole tree, and neither reported nor listed as unsure here.
                    let listed: BTreeSet<(&str, &str, &str)> = r
                        .violations
                        .iter()
                        .map(|v| (v.id.as_str(), v.path.as_str(), v.symbol.as_str()))
                        .collect();
                    let outside = full
                        .new_violations()
                        .filter(|v| {
                            !listed.contains(&(v.id.as_str(), v.path.as_str(), v.symbol.as_str()))
                        })
                        .count();
                    (r, outside, Some(s))
                }
                None => (full, 0, None),
            };
            // The security baseline, where the repository committed one: a finding
            // that is not in it fails the check as a blocking violation does. The
            // baseline is the rule; writing it is what a person accepted.
            let security = check_security(cli, root, &facts, only.is_some(), scope.as_ref())?;
            let insecure = security
                .as_ref()
                .is_some_and(|s| s.added.values().any(|rows| !rows.is_empty()));
            // Wiring advice never fails, not even with `--strict`.
            let failing = report.new_violations().filter(|v| v.fails(*strict)).count();
            // Decided on what is reported (after the diff filter) and before any
            // output: a reader that goes away early must not turn blocking
            // violations into a pass.
            // `--strict` also fails a check that could not read every file (here or at the
            // merge base); by default that fails open, with the files named.
            let base_unchecked = scope.as_ref().map_or(&[][..], |s| s.base_unchecked());
            let unread = !report.unchecked.is_empty() || !base_unchecked.is_empty();
            let code = u8::from(failing > 0 || (*strict && unread) || insecure);
            PIPE_EXIT.store(code, Ordering::Relaxed);
            // What the practice map says of the files looked at: the files named, the
            // files the diff added or changed, or every file. Facts, not rules: listed
            // in every format, after the exit code is decided, and never part of it.
            let base_entries = std::cell::OnceCell::new();
            // With no security baseline, the merge base's inventory is read once: for
            // the security advice below, and for what the change adds.
            let advice_base: Option<drift_mine::security::Inventory> =
                match (&scope, &security) {
                    (Some(s), None) if only.is_none() => match s.base_inventory(root) {
                        Ok(inv) => Some(inv),
                        Err(e) => {
                            eprintln!(
                                "drift: security advice skipped: the merge base could not be read ({e:#})"
                            );
                            None
                        }
                    },
                    _ => None,
                };
            if let Some(inv) = &advice_base {
                let keys: pr::BaseEntries = inv
                    .entry_points
                    .iter()
                    .map(|e| {
                        (
                            e.path.clone(),
                            e.symbol.clone(),
                            e.method.clone(),
                            e.route.clone(),
                        )
                    })
                    .collect();
                let _ = base_entries.set(Some(keys));
            }
            let adds =
                |p: &str, line: u32, symbol: &str, method: Option<&str>, route: Option<&str>| {
                    scope.as_ref().is_some_and(|s| {
                        s.adds_entry(root, &base_entries, (p, line), (symbol, method, route))
                    })
                };
            // A unit the report lists as breaking a promoted practice is not listed again
            // as a departure of the same concern.
            let reported = practices::reported_practice_units(&report, &policy);
            let (departures, added) = practices::check_departures(
                &facts,
                map_of,
                |p| match (&scope, &only) {
                    (Some(s), _) => s.touches(p),
                    (None, Some(only)) => only.iter().any(|o| {
                        p == o
                            || p.strip_prefix(o.as_str())
                                .is_some_and(|rest| rest.starts_with('/'))
                    }),
                    (None, None) => true,
                },
                scope.is_some().then_some(&adds as practices::Adds<'_>),
                &reported,
            );
            // With no security baseline, what the change adds that the baseline would
            // hold: advice under its own heading, decided after the exit code and never
            // part of it.
            let advice: Vec<drift_mine::ratchet::Advice> = match (&scope, &advice_base) {
                (Some(s), Some(base)) => check_security_advice(cli, root, &facts, s, base),
                _ => Vec::new(),
            };
            match format {
                Format::Json => {
                    let mut stdout = std::io::stdout().lock();
                    let conventions = check_conventions(&policy, verify.as_ref());
                    let practices =
                        (!departures.is_empty() || !added.is_empty()).then_some(CheckPractices {
                            departures: &departures,
                            added: &added,
                        });
                    match &scope {
                        Some(s) => {
                            let mut v = serde_json::to_value(&report)?;
                            v["diff"] = s.json(outside);
                            v["conventions"] = serde_json::to_value(&conventions)?;
                            if let Some(p) = &practices {
                                v["practices"] = serde_json::to_value(p)?;
                            }
                            if let Some(sec) = &security {
                                v["security"] = serde_json::to_value(sec)?;
                            }
                            if !advice.is_empty() {
                                v["security_advice"] = serde_json::to_value(&advice)?;
                            }
                            serde_json::to_writer_pretty(&mut stdout, &v)?;
                        }
                        None => serde_json::to_writer_pretty(
                            &mut stdout,
                            &CheckJson {
                                report: &report,
                                conventions,
                                practices,
                                security: security.as_ref(),
                            },
                        )?,
                    }
                    writeln!(stdout)?;
                }
                Format::Sarif => {
                    // Paths from the git top level, where code scanning reads them, when
                    // `--root` is a subdirectory ([`project::at_git_top`]).
                    let prefix = project::git_prefix(root);
                    let report = project::at_git_top(&report, &prefix);
                    let base_unchecked: Vec<String> = base_unchecked
                        .iter()
                        .map(|p| format!("{prefix}{p}"))
                        .collect();
                    let new: Vec<_> = report.new_violations().collect();
                    let exempt: Vec<_> = report.exempt.iter().collect();
                    let mut log = drift_mine::report::sarif_with_exempt(
                        &new,
                        &exempt,
                        env!("CARGO_PKG_VERSION"),
                    );
                    // Files not checked, here or at the merge base, and unsure violations
                    // are notifications of the run, not results.
                    let at = |p: &str, line: u32| serde_json::json!([{ "physicalLocation": { "artifactLocation": { "uri": p }, "region": { "startLine": line.max(1) } } }]);
                    let mut notes: Vec<serde_json::Value> = Vec::new();
                    for p in &report.unchecked {
                        notes.push(serde_json::json!({
                            "level": "warning",
                            "message": { "text": "Not checked: no stack large enough to parse this file could be reserved (a memory limit), so its violations are unknown." },
                            "locations": at(p, 1),
                        }));
                    }
                    for p in &base_unchecked {
                        notes.push(serde_json::json!({
                            "level": "warning",
                            "message": { "text": "Not checked at the merge base: no stack large enough to parse this file could be reserved there, so whether the change caused violations in it, or in files that depend on it, is unknown." },
                            "locations": at(p, 1),
                        }));
                    }
                    for v in report.unsure() {
                        notes.push(serde_json::json!({
                            "level": "note",
                            "message": { "text": format!("Unsure [{}]: {} {} may not follow \"{}\"; it depends on a file that was not parsed, so it does not fail the check.", v.id, v.path, v.symbol, v.summary) },
                            "locations": at(&v.path, v.line),
                        }));
                    }
                    // What the practice map says is a fact about the run's files, not a
                    // result: code scanning would show a result as an alert to resolve.
                    for a in &added {
                        notes.push(serde_json::json!({
                            "level": "note",
                            "message": { "text": format!("Practice (a fact, not a rule; it does not fail the check): new entry point {}", a.line()) },
                            "locations": at(&format!("{prefix}{}", a.path), a.line),
                        }));
                    }
                    for d in &departures {
                        notes.push(serde_json::json!({
                            "level": "note",
                            "message": { "text": format!("Practice (a fact, not a rule; it does not fail the check): {}", d.line()) },
                            "locations": at(&format!("{prefix}{}", d.path), d.units.first().map_or(1, |u| u.line)),
                        }));
                    }
                    // Security advice with no baseline: a fact of the run, not a result.
                    for a in &advice {
                        let (path, line) = a.at.rsplit_once(':').unwrap_or((a.at.as_str(), "1"));
                        notes.push(serde_json::json!({
                            "level": "note",
                            "message": { "text": format!("Security advice [{}] (no baseline; it does not fail the check): {}: {}", a.kind, drift_mine::report::sanitize(&a.key, 300), drift_mine::report::sanitize(&a.read, 300)) },
                            "locations": at(&format!("{prefix}{path}"), line.parse().unwrap_or(1)),
                        }));
                    }
                    // Promoted practices that could not say all they hold: notifications
                    // of the run (no file to point at), never results.
                    for line in practices::practice_status_lines(&report, &policy) {
                        notes.push(serde_json::json!({
                            "level": "note",
                            "message": { "text": line.trim_start_matches("drift: ") },
                        }));
                    }
                    // What the security baseline does not hold fails the check: a
                    // result, so that code scanning shows why, under a rule per kind.
                    for (kind, rows) in security.iter().flat_map(|s| &s.added) {
                        let rule = format!("drift-security/{kind}");
                        if let Some(rules) =
                            log["runs"][0]["tool"]["driver"]["rules"].as_array_mut()
                            && !rules.iter().any(|r| r["id"] == rule.as_str())
                        {
                            rules.push(serde_json::json!({
                                "id": rule,
                                "shortDescription": { "text": format!("Security finding not in the baseline ({kind})") },
                                "defaultConfiguration": { "level": "error" },
                            }));
                        }
                        for a in rows {
                            let (path, line) =
                                a.at.rsplit_once(':').unwrap_or((a.at.as_str(), "1"));
                            if let Some(results) = log["runs"][0]["results"].as_array_mut() {
                                results.push(serde_json::json!({
                                    "ruleId": rule,
                                    "level": "error",
                                    "message": { "text": format!("Security [{kind}]: {} is not in the security baseline ({}).", drift_mine::report::sanitize(&a.key, 300), drift_mine::ratchet::SECURITY_LOCK) },
                                    "locations": at(&format!("{prefix}{path}"), line.parse().unwrap_or(1)),
                                }));
                            }
                        }
                    }
                    if !notes.is_empty() {
                        log["runs"][0]["invocations"] = serde_json::json!([{
                            "executionSuccessful": true,
                            "toolExecutionNotifications": notes,
                        }]);
                    }
                    let mut stdout = std::io::stdout().lock();
                    serde_json::to_writer_pretty(&mut stdout, &log)?;
                    writeln!(stdout)?;
                }
                Format::Text => {
                    if let Some(s) = &scope {
                        s.print_header(outside);
                    }
                    // People read this report too: what agents are not shown is listed
                    // and counted like the rest, marked so ([`print_report`]).
                    let hidden: BTreeSet<&str> = policy
                        .conventions
                        .iter()
                        .filter(|c| c.status == Status::Accepted)
                        .filter(|c| !drift_mine::verify::convention_view(c, verify.as_ref()).shown)
                        .map(|c| c.id.as_str())
                        .collect();
                    print_report(&report, &hidden, &practices::practice_concerns(&policy));
                    if *strict && unread {
                        println!("drift: --strict: files that were not checked fail the check");
                    }
                    // Promoted practices that are stale or could not read some units:
                    // said, never part of the exit code.
                    for line in practices::practice_status_lines(&report, &policy) {
                        println!("{line}");
                    }
                    print!("{}", drift_mine::practices::added_text(&added));
                    print!("{}", drift_mine::practices::departures_text(&departures));
                    if let Some(sec) = security.as_ref().filter(|s| s.has_news()) {
                        print!("\n{}", drift_mine::ratchet::render(sec, 20));
                    }
                    print!("{}", drift_mine::ratchet::render_advice(&advice));
                }
                Format::Github => {
                    // Annotations name files from the git top level ([`project::at_git_top`]).
                    let prefix = project::git_prefix(root);
                    pr::github_output(
                        &project::at_git_top(&report, &prefix),
                        scope.as_ref(),
                        &prefix,
                        outside,
                        *strict,
                        &departures,
                        &added,
                    )?;
                    for (kind, rows) in security.iter().flat_map(|s| &s.added) {
                        for a in rows {
                            let (path, line) =
                                a.at.rsplit_once(':').unwrap_or((a.at.as_str(), "1"));
                            println!(
                                "::error file={},line={},title={}::{}",
                                drift_mine::report::github_escape_property(&format!(
                                    "{prefix}{path}"
                                )),
                                drift_mine::report::github_escape_property(line),
                                drift_mine::report::github_escape_property(&format!(
                                    "drift security [{kind}]"
                                )),
                                drift_mine::report::github_escape_data(&format!(
                                    "{} is not in the security baseline ({})",
                                    a.key,
                                    drift_mine::ratchet::SECURITY_LOCK
                                ))
                            );
                        }
                    }
                    // Advice is said in the log, not as annotations: the practice
                    // notices above already point at new entry points.
                    print!("{}", drift_mine::ratchet::render_advice(&advice));
                }
            }
            return Ok(ExitCode::from(code));
        }
    }
    Ok(ExitCode::SUCCESS)
}

/// The authorization units of the practice map, listed ([`drift_mine::practices::UnitRow`]).
fn authz_units(
    root: &Path,
    facts: &RepoFacts,
) -> anyhow::Result<Vec<drift_mine::practices::UnitRow>> {
    let scope = practices::checked_scope(facts, Some("authz"), None, None)?;
    let report = practices::report_with(root, facts, scope, true)?;
    Ok(report
        .concerns
        .into_iter()
        .filter(|c| c.id == "authz")
        .flat_map(|c| c.units)
        .collect())
}

/// What the security baseline holds of the repository as it is now: the findings
/// of the inventory, the entry points the practice map reads as checking nothing of
/// a signed-in caller, and those it reads as taking a tenant or owner key nothing
/// checks ([`drift_mine::ratchet::add_unscoped`]).
fn baseline_findings(
    root: &Path,
    facts: &RepoFacts,
    inv: &drift_mine::security::Inventory,
) -> anyhow::Result<drift_mine::ratchet::Findings> {
    let mut found = drift_mine::ratchet::findings(inv, facts);
    let units = authz_units(root, facts)?;
    drift_mine::ratchet::add_unauthorized(&mut found, &units);
    drift_mine::ratchet::add_unscoped(&mut found, &units);
    Ok(found)
}

/// The security inventory of the repository as `drift security` reads it, with its
/// CI workflows, dependencies and Kubernetes manifests.
fn security_inventory(cli: &Cli, root: &Path, facts: &RepoFacts) -> drift_mine::security::Inventory {
    let mut inv = drift_mine::security::inventory_with(
        facts,
        drift_mine::security::Boundaries::load(&cli.root),
    );
    inv.workflows = drift_mine::workflows::read(root);
    inv.dependencies = drift_mine::dependencies::read(root);
    inv.cluster = drift_mine::kubernetes::read(root);
    inv
}

/// The inventory's findings ranked for a person ([`drift_mine::security_summary`]),
/// with the practice map's reading of each entry point's input validation (the map
/// is built with its units for that).
fn security_summary(
    root: &Path,
    facts: &RepoFacts,
    inv: &drift_mine::security::Inventory,
) -> drift_mine::security_summary::Summary {
    let opts = drift_mine::practices::Options {
        units: true,
        ..practices::options(root, facts, drift_mine::practices::Scope::default())
    };
    let map = drift_mine::practices::practices(facts, &opts);
    drift_mine::security_summary::summarize(
        inv,
        &drift_mine::security_summary::Readings::from_practices(&map),
    )
}

/// `drift check`: what the repository's security baseline does not hold
/// ([`drift_mine::ratchet`]), where the repository has one and the check is of the
/// whole tree or of a diff. `None` with no baseline, and where files are named (an
/// editor's or an agent's check of one file reads no inventory). Against a diff
/// (`scope`), a guard gap in a file the change did not touch is not the change's
/// ([`drift_mine::ratchet::Ratchet::outside_change`]).
fn check_security(
    cli: &Cli,
    root: &Path,
    facts: &RepoFacts,
    files_named: bool,
    scope: Option<&pr::DiffScope>,
) -> anyhow::Result<Option<drift_mine::ratchet::Ratchet>> {
    if files_named {
        return Ok(None);
    }
    let Some(baseline) = drift_mine::ratchet::load_baseline(root)
        .with_context(|| format!("reading {}", drift_mine::ratchet::SECURITY_LOCK))?
    else {
        return Ok(None);
    };
    let inv = security_inventory(cli, root, facts);
    let found = baseline_findings(root, facts, &inv)?;
    let touched = |p: &str| scope.is_some_and(|s| s.touches(p));
    Ok(Some(drift_mine::ratchet::compare_with(
        &found,
        &baseline,
        scope.map(|_| &touched as &dyn Fn(&str) -> bool),
    )))
}

/// `drift check --diff-base` where the repository has no security baseline: what
/// the change adds ([`drift_mine::ratchet::advise`]), against the merge base's
/// inventory `base`. Advice only: never part of the exit code.
fn check_security_advice(
    cli: &Cli,
    root: &Path,
    facts: &RepoFacts,
    scope: &pr::DiffScope,
    base: &drift_mine::security::Inventory,
) -> Vec<drift_mine::ratchet::Advice> {
    let head = security_inventory(cli, root, facts);
    let units = authz_units(root, facts).unwrap_or_else(|e| {
        eprintln!("drift: security advice: the practice map could not be read ({e:#}); unscoped keys are not said");
        Vec::new()
    });
    drift_mine::ratchet::advise(
        base,
        &head,
        &units,
        &|p| scope.touches(p),
        &|p| scope.old_path(p).to_string(),
    )
}

/// `drift check --format json`: the report's fields as before (`violations`, `fixed`),
/// then `conventions`. Flattened, so the report's own fields keep their order and bytes.
#[derive(serde::Serialize)]
struct CheckJson<'a> {
    #[serde(flatten)]
    report: &'a CheckReport,
    conventions: Vec<CheckConvention<'a>>,
    /// Omitted when nothing departs.
    #[serde(skip_serializing_if = "Option::is_none")]
    practices: Option<CheckPractices<'a>>,
    /// What the security baseline does not hold ([`check_security`]). Omitted where
    /// the repository has no baseline, and where files are named.
    #[serde(skip_serializing_if = "Option::is_none")]
    security: Option<&'a drift_mine::ratchet::Ratchet>,
}

/// `drift check --format json` `practices`: what the practice map says of the files
/// the check looked at. Facts, not rules: nothing here is a violation, and none of it
/// changes the exit code.
#[derive(serde::Serialize)]
struct CheckPractices<'a> {
    /// The concerns a file's entry points do differently from at least 80% of those
    /// around them ([`drift_mine::practices::departures`]).
    departures: &'a [drift_mine::practices::Departure],
    /// With `--diff-base`: the entry points the change adds where Drift found no
    /// sign-in guard, or cannot tell
    /// ([`drift_mine::practices::added_entries`]). Omitted when empty.
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    added: &'a [drift_mine::practices::AddedEntry],
}

/// One convention of the policy as `drift check` evaluates it: what a reader of the
/// report needs that `conventions.yaml` does not store. `tier` and `effective_mode` are
/// computed, never stored: a role under `MIN_BLOCK_ROLE_SIZE` members advises even when
/// the policy says `mode: block`.
#[derive(serde::Serialize)]
struct CheckConvention<'a> {
    id: &'a str,
    status: Status,
    /// The mode in `conventions.yaml`.
    mode: Mode,
    /// The mode the convention is checked with once accepted (`block` or `advise`).
    effective_mode: &'static str,
    tier: Tier,
    /// Why the convention is a suggestion (`language_advise`, `rule_kind_d7`, `rule_kind`,
    /// `names_package` or `small_role`); `null` in the default tier. Same as `census --json`.
    tier_reason: Option<&'static str>,
    /// The language the tier reads (`ts` or `py`; decision D7: `py` when any member of
    /// the role is Python). Same as `census --json`.
    language: &'static str,
    /// Whether the rule names a symbol from outside the repository (a package, built-in or
    /// unresolved symbol). Same as `census --json`.
    names_package: bool,
    rule_kind: &'static str,
    /// Role members (`evidence.role_size()`: the role's size, also when the rule is
    /// about only some of them).
    members: usize,
    /// Whether the role is large enough to block at all.
    blockable: bool,
    /// Whether agents are shown it (W0 family admission, a person's `agents: show`, or a
    /// forced block), and why. Same shape as `census --json` `agents`.
    agents: drift_mine::admission::Decision,
    /// With `agents.verify: on` (experimental), an accepted suggestion's standing with the
    /// agent verifier ([`drift_mine::verify::VerifyStatus`]); absent otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    verify: Option<drift_mine::verify::VerifyStatus>,
}

/// Every convention in the policy, in policy order. `verify`: the verifier's statuses
/// when `agents.verify` is on ([`drift_mine::verify::statuses`]).
fn check_conventions<'a>(
    policy: &'a ConventionsFile,
    verify: Option<&BTreeMap<String, drift_mine::verify::VerifyStatus>>,
) -> Vec<CheckConvention<'a>> {
    policy
        .conventions
        .iter()
        .map(|c| CheckConvention {
            id: &c.id,
            status: c.status,
            mode: c.mode,
            effective_mode: drift_mine::check::effective_mode(c),
            tier: c.tier(),
            tier_reason: c.tier_reason(),
            language: tier::language_code(c.language()),
            names_package: tier::names_package(&c.rule),
            rule_kind: tier::rule_kind(&c.rule),
            members: c.evidence.role_size(),
            blockable: c.evidence.role_size() >= MIN_BLOCK_ROLE_SIZE,
            agents: drift_mine::verify::convention_view(c, verify),
            verify: verify.and_then(|v| v.get(&c.id)).cloned(),
        })
        .collect()
}

/// What `drift init` and `drift census` say when suggestions are not shown to agents.
fn hidden_note(hidden: usize) -> String {
    let bar = match drift_mine::admission::table() {
        Some(t) => format!(
            "the admission bar is {} labelled cards accepted",
            t.bar.text()
        ),
        None => "there is no admission table".to_string(),
    };
    format!(
        "{hidden} suggestion(s) are not shown to agents: their rule family is below the admission bar ({bar}). People still see them (`--all` lists those past the suggestion cap); `drift review --show-to-agents <id>` shows one to agents anyway."
    )
}

/// The census's last line: it wrote nothing, and what writes the proposals.
const CENSUS_NEXT: &str = "Preview only: nothing was written. Next: `drift init` writes these to .drift/conventions.yaml as proposals (keeping decisions already made), then `drift review` decides them.";

/// After the new violations `drift check` lists, when one is in block mode: what to do
/// about each.
const CHECK_NEXT: &str = "Fix: make the code follow the `like` example. Intentional exception: add `// drift-ignore <id>: <reason>` (`#` in Python) directly above the declaration. Wrong convention: `drift review --advise <id>` or `--reject <id>`.";

/// After the new violations `drift check` lists, when all of them advise: nothing has
/// to be done, and a suppression comment is not needed for advice.
const CHECK_NEXT_ADVICE: &str = "Advice: follow a convention where it fits the code; where it does not, no action is needed (no change, no comment). Wrong convention: `drift review --reject <id>`.";

/// `drift review`'s last line: the policy's counts, with how many accepted
/// conventions block as checked (a role under the block minimum advises).
fn review_summary(policy: &ConventionsFile) -> String {
    let count = |s: Status| policy.conventions.iter().filter(|c| c.status == s).count();
    let blocking = policy
        .conventions
        .iter()
        .filter(|c| c.status == Status::Accepted)
        .filter(|c| drift_mine::check::effective_mode(c) == "block")
        .count();
    let hidden = policy
        .conventions
        .iter()
        .filter(|c| c.status == Status::Accepted)
        .filter(|c| !drift_mine::admission::shown_to_agents(c))
        .count();
    let hidden = if hidden > 0 {
        format!(" ({hidden} accepted not shown to agents: rule family below the admission bar)")
    } else {
        String::new()
    };
    format!(
        "{} accepted ({blocking} block), {} proposed, {} rejected{hidden}",
        count(Status::Accepted),
        count(Status::Proposed),
        count(Status::Rejected)
    )
}

/// `drift example`'s lines: each example file once, default tier first, with every
/// convention it is the example of (so a shared example never hides a blocking rule).
fn example_lines(convs: &[&Convention]) -> Vec<String> {
    let mut convs = convs.to_vec();
    drift_mine::tier::order_by_tier(&mut convs, |c| c.tier());
    let mut out: Vec<(&str, Vec<String>)> = Vec::new();
    for c in convs {
        let rule = format!("[{}] {}", c.id, c.summary);
        match out.iter_mut().find(|(e, _)| *e == c.example) {
            Some((_, summaries)) => summaries.push(rule),
            None => out.push((&c.example, vec![rule])),
        }
    }
    out.into_iter()
        .map(|(e, summaries)| format!("{e}  ({})", summaries.join("; ")))
        .collect()
}

/// `drift check`'s text: every new violation, those of an accepted convention agents
/// are not shown (`hidden`) marked so; agent visibility hides nothing from people.
/// `practice`: the concern of each promoted practice, by convention id: its violation's
/// fix is to do that concern the way its example does.
fn print_report(r: &CheckReport, hidden: &BTreeSet<&str>, practice: &BTreeMap<&str, &str>) {
    let new: Vec<_> = r.new_violations().collect();
    let legacy = r.violations.iter().filter(|v| v.baselined).count();
    let suppressed: Vec<_> = r.suppressed().filter(|v| !v.baselined).collect();
    let also = if suppressed.is_empty() {
        String::new()
    } else {
        format!(", {} suppressed by drift-ignore", suppressed.len())
    };
    let checked = if r.unchecked.is_empty() {
        ""
    } else {
        " in the files checked"
    };
    if new.is_empty() {
        println!("drift: no new violations{checked} ({legacy} legacy, baselined{also})");
    } else {
        println!(
            "drift: {} new violation(s) ({legacy} legacy, baselined{also})",
            new.len()
        );
        for v in new {
            println!("[{}] {} ({})", v.id, v.summary, v.evidence);
            match &v.import {
                Some(hit) => println!("  at   {}:{} {}", v.path, v.line, hit.describe()),
                None => println!("  at   {}:{} {}", v.path, v.line, v.symbol),
            }
            // A layering violation has a file to copy too: one of its role that imports
            // nothing it should not.
            println!("  like {}", v.example);
            if let Some(w) = &v.wire {
                println!("  fix  {}", w.describe(&v.symbol));
            }
            if let Some(concern) = practice.get(v.id.as_str()) {
                println!(
                    "  fix  handle {} the way the `like` example does",
                    mcp::concern_words(concern)
                );
            }
            let notes: Vec<&str> = [
                (v.tier == Tier::Suggestion).then_some("suggestion"),
                hidden
                    .contains(v.id.as_str())
                    .then_some("not shown to agents"),
            ]
            .into_iter()
            .flatten()
            .collect();
            if notes.is_empty() {
                println!("  mode {}", v.mode);
            } else {
                println!("  mode {} ({})", v.mode, notes.join("; "));
            }
        }
        if r.new_violations().any(|v| v.mode == "block") {
            println!("{CHECK_NEXT}");
        } else {
            println!("{CHECK_NEXT_ADVICE}");
        }
    }
    if !r.suppressed_neighbour.is_empty() {
        println!(
            "drift: {} warning(s) held back by the neighbour gate: each member is nearer the members its convention sets apart than the ones that hold it (`suppressed_neighbour` in `drift check --format json`)",
            r.suppressed_neighbour.len()
        );
        for h in r.suppressed_neighbour.iter().take(MAX_EXEMPT_LISTED) {
            println!(
                "  held [{}] {}:{} {} (nearest set apart {}, {}; nearest holder {})",
                h.id, h.path, h.line, h.symbol, h.nearest_apart, h.apart_code, h.nearest_holder
            );
        }
        if r.suppressed_neighbour.len() > MAX_EXEMPT_LISTED {
            println!(
                "  +{} more: `drift check --format json` lists them all (`suppressed_neighbour`)",
                r.suppressed_neighbour.len() - MAX_EXEMPT_LISTED
            );
        }
    }
    if !r.exempt.is_empty() {
        println!(
            "drift: {} member(s) not checked: their convention is not about them",
            r.exempt.len()
        );
        for e in r.exempt.iter().take(MAX_EXEMPT_LISTED) {
            println!(
                "  exempt [{}] {}:{} {} ({})",
                e.id, e.path, e.line, e.symbol, e.reason
            );
        }
        if r.exempt.len() > MAX_EXEMPT_LISTED {
            println!(
                "  +{} more: `drift check --format json` lists them all (`exempt`)",
                r.exempt.len() - MAX_EXEMPT_LISTED
            );
        }
    }
    if !r.fixed.is_empty() {
        println!(
            "{} lock entries are fixed and can be removed from {LOCK_FILE}",
            r.fixed.len()
        );
    }
    let unsure: Vec<_> = r.unsure().collect();
    if !unsure.is_empty() {
        println!(
            "drift: {} violation(s) not counted as new (unsure): their files depend on a file that was not checked, here or at the merge base, so the verdict may change once it is",
            unsure.len()
        );
        for v in unsure {
            println!("[{}] {} ({})", v.id, v.summary, v.evidence);
            println!("  at   {}:{} {}", v.path, v.line, v.symbol);
        }
    }
    if !r.unchecked.is_empty() {
        println!(
            "drift: {} file(s) NOT CHECKED: no thread stack large enough to parse them could be reserved (an address-space or memory limit on this run). Their violations are unknown, not absent; run `drift check` with more memory to check them:",
            r.unchecked.len()
        );
        for p in &r.unchecked {
            println!("  {p}");
        }
    }
    // What the accepted mined rules could not say, as the promoted practices' status
    // lines say it: members not checked, rules gone stale, a mode that is not the file's.
    // None of it changes the exit code by itself.
    for s in &r.standing {
        if s.not_checked > 0 {
            println!(
                "drift: [{}] {} of {} member(s) not checked: Drift could not read what decides the rule for them, and never reports what it cannot read ({} follow it)",
                s.id, s.not_checked, s.members, s.holders
            );
            let mut why: Vec<(&String, &usize)> = s.not_checked_why.iter().collect();
            why.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
            for (reason, n) in why.iter().take(MAX_WHY_LISTED) {
                println!("  why  {reason} ({n})");
            }
            if why.len() > MAX_WHY_LISTED {
                println!(
                    "  +{} more reasons: `drift check --format json` lists them all (`standing`)",
                    why.len() - MAX_WHY_LISTED
                );
            }
        }
        if let Some(stale) = &s.stale {
            println!(
                "drift: [{}] mined rule is stale: {stale}, so it advises until a person looks: `drift review --advise {}` keeps it as advice, `drift review --reject {}` drops it",
                s.id, s.id, s.id
            );
        }
        if let Some(note) = &s.mode_note {
            println!("drift: [{}] {note}", s.id);
        }
    }
}

/// Reasons a mined rule's members were not checked, listed before pointing to the JSON.
const MAX_WHY_LISTED: usize = 3;

/// Exempt members `drift check` lists in its text report before pointing to the JSON.
const MAX_EXEMPT_LISTED: usize = 10;

/// The proposed conventions interactive review asks about, in order: the default tier in
/// policy order, then the best `cap` suggestions (`drift_mine::rank`); and the note on
/// the suggestions left out, if any.
fn review_queue(
    policy: &ConventionsFile,
    cap: rank::SuggestionCap,
) -> (Vec<String>, Option<String>) {
    let mut proposed: Vec<&Convention> = policy
        .conventions
        .iter()
        .filter(|c| c.status == Status::Proposed)
        .collect();
    tier::order_by_tier(&mut proposed, |c| c.tier());
    let placed = rank::place(&proposed, cap);
    let ids = placed
        .iter()
        .filter(|p| p.shown)
        .map(|p| p.item.id.clone())
        .collect();
    (ids, capped_note(&placed, "review"))
}

/// The line a human view prints when the cap left suggestions out.
fn capped_note<T>(placed: &[rank::Placed<'_, T>], command: &str) -> Option<String> {
    let (all, listed) = rank::suggestion_counts(placed);
    (listed < all).then(|| {
        format!(
            "Showing {listed} of {all} suggestions, best first by their evidence (lower bound, then fewer outliers, then lift); {} more: `drift {command} --all` lists every one, `suggestion_cap` in {CONVENTIONS_FILE} sets how many. The cap hides none from `drift check` or agents (what agents see is the family admission's).",
            all - listed
        )
    })
}

/// `suggestion_cap` in the policy at `root`, for `census` (which needs no policy): a
/// policy that cannot be read leaves the default, with a warning.
/// What `census` mines: as `init` would propose it, with the hysteresis of the
/// conventions already accepted in `.drift/conventions.yaml` when there is one
/// ([`mine_keeping`]); a policy Drift cannot read is ignored here (`init` says why).
/// What `census` proposes, with the accepted conventions' `(role, rule)` that hysteresis
/// kept.
/// The vocabulary `drift map` reads roles with: the one frozen in the conventions file
/// when there is one (so the map's roles are those `check` enforces), else learned; with
/// test roles and kind roles (described, mined or not) unless the study leaves them out.
fn map_kinds(root: &Path, facts: &RepoFacts, shapes: bool) -> drift_mine::roles::FileKinds {
    let base = match ConventionsFile::load(root) {
        Ok(Some(p)) => p.file_kinds,
        _ => drift_mine::roles::FileKinds::learn(facts),
    };
    drift_mine::roles::FileKinds {
        tests: shapes,
        kind_roles: shapes,
        ..base
    }
}

/// `drift map --files --conventions` (study): for each file row of `v`, the ids of the
/// mined conventions whose role holds one of its units (`mined`: every tier, the ones
/// the show policy hides too, as `mine_before_show` proposes them) and of the shown
/// ones (`shown`: what `census --json --max 15` lists as shown by default, Python
/// proposals and test roles as the repository's settings say).
fn map_conventions(
    root: &Path,
    facts: &RepoFacts,
    kinds: &drift_mine::roles::FileKinds,
    (tests, kind_roles): (bool, bool),
    python_flag: bool,
    v: &mut serde_json::Value,
) {
    let all = drift_mine::mine::mine_before_show(
        facts,
        &MineOptions {
            max_per_repo: 10_000,
        },
        drift_mine::roles::FileKinds {
            tests,
            kind_roles,
            ..kinds.clone()
        },
        &[],
    );
    let (mut mined, accepted) = census_mine(root, facts, DEFAULT_MAX_PER_REPO, (tests, kind_roles));
    withhold_python(
        drift_mine::policy::python_proposals(root, python_flag),
        &mut mined,
        &accepted,
    );
    let ordered = tiered(&mined);
    let cap = rank::resolve_cap(false, None, policy_cap(root)).0;
    let shown: Vec<&Candidate> = rank::place(&ordered, cap)
        .into_iter()
        .filter(|p| p.shown)
        .map(|p| *p.item)
        .collect();
    let units = drift_mine::roles::all_units(facts, &all.kinds);
    let mut by_file: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, u) in units.iter().enumerate() {
        by_file.entry(u.path()).or_default().push(i);
    }
    let covering = |cands: &[&Candidate], path: &str| -> Vec<String> {
        let Some(us) = by_file.get(path) else {
            return vec![];
        };
        cands
            .iter()
            .filter(|c| us.iter().any(|&i| units[i].in_role(&c.role)))
            .map(|c| c.id.clone())
            .collect()
    };
    let all_refs: Vec<&Candidate> = all.candidates.iter().collect();
    // Cards and the files they cover, by how their role is keyed (kind, path, package).
    let mut by_keying: BTreeMap<&str, [BTreeSet<String>; 2]> = BTreeMap::new();
    let mut cards: BTreeMap<(&str, usize), usize> = BTreeMap::new();
    for (i, set) in [&all_refs, &shown].into_iter().enumerate() {
        for c in set.iter() {
            *cards
                .entry((drift_mine::funnel::keying(&c.role), i))
                .or_default() += 1;
        }
    }
    if let Some(rows) = v["files"].as_array_mut() {
        for row in rows {
            let path = row["path"].as_str().unwrap_or_default().to_string();
            let m = covering(&all_refs, &path);
            let s = covering(&shown, &path);
            for (i, ids) in [&m, &s].into_iter().enumerate() {
                for id in ids {
                    let c = all_refs.iter().chain(shown.iter()).find(|c| &c.id == id);
                    if let Some(c) = c {
                        by_keying
                            .entry(drift_mine::funnel::keying(&c.role))
                            .or_default()[i]
                            .insert(path.clone());
                    }
                }
            }
            row["mined"] = serde_json::json!(m);
            row["shown"] = serde_json::json!(s);
        }
    }
    let keyings: BTreeSet<&str> = cards
        .keys()
        .map(|(k, _)| *k)
        .chain(by_keying.keys().copied())
        .collect();
    v["conventions"] = serde_json::json!({
        "mined": all.candidates.len(),
        "shown": shown.len(),
        "by_keying": keyings.iter().map(|k| (k.to_string(), serde_json::json!({
            "mined_cards": cards.get(&(*k, 0)).copied().unwrap_or(0),
            "shown_cards": cards.get(&(*k, 1)).copied().unwrap_or(0),
            "files_mined": by_keying.get(k).map_or(0, |s| s[0].len()),
            "files_shown": by_keying.get(k).map_or(0, |s| s[1].len()),
        }))).collect::<serde_json::Map<_, _>>(),
    });
}

/// Physical lines of each file row of `v` (`loc`), read from the working tree.
fn add_loc(root: &Path, v: &mut serde_json::Value) {
    if let Some(rows) = v["files"].as_array_mut() {
        for row in rows {
            let path = row["path"].as_str().unwrap_or_default();
            let loc = std::fs::read(root.join(path)).map_or(0, |b| {
                let n = b.iter().filter(|&&c| c == b'\n').count();
                n + usize::from(!b.is_empty() && b.last() != Some(&b'\n'))
            });
            row["loc"] = serde_json::json!(loc);
        }
    }
}

fn census_mine(
    root: &Path,
    facts: &RepoFacts,
    max: usize,
    (tests, kind_roles): (bool, bool),
) -> (Mined, Vec<(drift_mine::roles::RoleSelector, Rule)>) {
    let opts = MineOptions { max_per_repo: max };
    let policy = ConventionsFile::load(root).ok().flatten();
    let accepted = policy
        .as_ref()
        .map(ConventionsFile::accepted_rules)
        .unwrap_or_default();
    let kinds = drift_mine::roles::FileKinds::learn_with(facts, tests, kind_roles);
    let mut mined = if accepted.is_empty() {
        mine_with_kinds(facts, &opts, kinds)
    } else {
        mine_keeping(facts, &opts, kinds, &accepted)
    };
    drop_decided(&mut mined, policy.as_ref());
    (mined, accepted)
}

/// `drift census --why [GATE]`: mine as `census` does, with every gate's dropped
/// candidates recorded (`drift_mine::funnel`), and print the funnel instead of the
/// proposals: how many reached each stage, how many each gate dropped, then the dropped
/// candidates by gate, strongest first (with --json, all of them). Only `gate`'s when it
/// names one (`""`: every gate). Observation only: mining is what it is without the record.
#[allow(clippy::too_many_arguments)]
fn census_why(
    cli: &Cli,
    root: &Path,
    gate: &str,
    max: usize,
    shapes: (bool, bool),
    python: drift_mine::policy::PythonProposals,
    listed: bool,
    json: bool,
) -> anyhow::Result<ExitCode> {
    let only = (!gate.is_empty()).then_some(gate);
    if let Some(g) = only
        && drift_mine::funnel::gate(g).is_none()
    {
        let names: Vec<&str> = drift_mine::funnel::GATES.iter().map(|g| g.name).collect();
        bail!("no gate is named `{g}`; the gates are: {}", names.join(", "));
    }
    let mut facts = load_facts(cli, 0)?;
    if listed {
        facts = facts.into_listed();
    }
    drift_mine::funnel::start_counting();
    drift_mine::funnel::record(None);
    let (mut mined, accepted) = census_mine(root, &facts, max, shapes);
    let mut rows = drift_mine::funnel::take_dropped();
    let _ = withhold_python(python, &mut mined, &accepted);
    let counts = drift_mine::funnel::finish();
    // The show policy's and Python's withheld cards, with their reason as the gate.
    rows.extend(
        mined
            .withheld
            .iter()
            .map(|w| drift_mine::funnel::dropped_card(&w.candidate, w.reason)),
    );
    drift_mine::funnel::sort(&mut rows);
    if json {
        let v = drift_mine::funnel::why_json(counts.as_ref(), &rows, only);
        println!("{}", serde_json::to_string_pretty(&v)?);
    } else {
        let per_gate = if only.is_some() { 50 } else { 10 };
        print!(
            "{}",
            drift_mine::funnel::why_text(counts.as_ref(), &rows, only, per_gate)
        );
    }
    Ok(ExitCode::SUCCESS)
}

/// Decision D13-py: with Python proposals off, remove every Python proposal (wiring ones
/// included) but those a person accepted, after all mining; how many were withheld.
fn withhold_python(
    python: drift_mine::policy::PythonProposals,
    mined: &mut Mined,
    accepted: &[(drift_mine::roles::RoleSelector, Rule)],
) -> usize {
    if python.on() {
        0
    } else {
        drift_mine::mine::withhold_python(mined, accepted)
    }
}

/// `census --json` `python_proposals`, while Python proposals are off.
fn python_proposals_json(withheld: usize) -> serde_json::Value {
    serde_json::json!({
        "enabled": false,
        "decision": "D13-py",
        "withheld": withheld,
        "opt_in": "proposals: {python: on} in .drift/config.yaml (census: --python-proposals)",
    })
}

/// What `census` and `init` say when Python proposals were withheld.
fn python_off_note(n: usize) -> String {
    format!(
        "{n} Python proposal(s) not made: Python mined proposals are turned off in .drift/config.yaml (`proposals: {{python: off}}`). Remove that setting, or set it to `on`, to make them; conventions you accepted, Python facts and `drift security` are unaffected."
    )
}

/// Withheld cards by language, family and reason, with their counts: what `init`, `census`
/// and `review` report ([`Mined::withheld`]).
fn withheld_groups(
    withheld: &[WithheldCard],
) -> BTreeMap<(&'static str, String, drift_mine::show::Withheld), usize> {
    let mut by = BTreeMap::new();
    for w in withheld {
        let c = &w.candidate;
        *by.entry((
            tier::language_code(c.language()),
            drift_mine::show::family_name(&c.rule),
            w.reason,
        ))
        .or_default() += 1;
    }
    by
}

/// `census --json` `withheld`: how many mined cards were withheld (not proposed, never
/// shown to agents), by language, family and reason. A new field: every other field of
/// census is what it was.
fn withheld_json(withheld: &[WithheldCard]) -> serde_json::Value {
    let by: Vec<serde_json::Value> = withheld_groups(withheld)
        .into_iter()
        .map(|((language, family, reason), n)| {
            serde_json::json!({
                "language": language,
                "family": family,
                "reason": reason.code(),
                "n": n,
            })
        })
        .collect();
    serde_json::json!({
        "total": withheld.len(),
        "by": by,
        "review": "drift review --hidden",
    })
}

fn language_name(code: &str) -> &'static str {
    if code == "py" { "Python" } else { "TypeScript" }
}

/// What `init`, `census` and `review` say about the withheld cards; `None` when there are
/// none.
fn withheld_note(withheld: &[WithheldCard]) -> Option<String> {
    if withheld.is_empty() {
        return None;
    }
    let parts: Vec<String> = withheld_groups(withheld)
        .into_iter()
        .map(|((lang, family, reason), n)| {
            format!("{} {family} {n} ({})", language_name(lang), reason.text())
        })
        .collect();
    Some(format!(
        "{} mined card(s) withheld by the show policy (not proposed; not shown as conventions to agents, hooks, MCP, exports or SARIF; `drift card <file>` states the strong ones as facts, not rules): {}. `drift review --hidden` lists them for people, with their evidence; a person can promote one.",
        withheld.len(),
        parts.join(", ")
    ))
}

/// What interactive `drift review` says when no convention is proposed: so a newcomer
/// does not read "nothing found" where mining withheld cards for a person to review.
fn nothing_to_ask(withheld: &[WithheldCard]) -> String {
    if withheld.is_empty() {
        return "0 proposed conventions to review.".to_string();
    }
    format!(
        "0 proposed conventions to review, but mining withheld {} card(s) (the show policy keeps cards with a weak track record from agents): `drift review --hidden` lists them with their evidence, and `drift review --hidden --answer <id>=same` promotes one.",
        withheld.len()
    )
}

/// The closing line of `init` and `census` when mining withheld cards: how many, and
/// the commands that list, promote and show one to agents; `None` when there are none.
fn withheld_next(withheld: &[WithheldCard]) -> Option<String> {
    if withheld.is_empty() {
        return None;
    }
    Some(format!(
        "Next for the {} withheld card(s): `drift review --hidden` lists them with their evidence, and `drift review --hidden --answer <id>=same` promotes one. A promoted card whose rule family is below the admission bar reaches agents only after `drift review --show-to-agents <id>`.",
        withheld.len()
    ))
}

/// Why a human view lists no convention: the withheld cards when mining found any, else
/// what the repository is missing ([`no_conventions_reason`]).
fn empty_reason(facts: &RepoFacts, mined: &Mined) -> String {
    if mined.withheld.is_empty() {
        no_conventions_reason(facts, mined)
    } else {
        format!(
            "No conventions shown: Drift found {} and none has a track record strong enough to propose. `drift review --hidden` shows {} with the evidence, for you to decide.",
            count(mined.withheld.len(), "candidate"),
            if mined.withheld.len() == 1 {
                "it"
            } else {
                "them"
            }
        )
    }
}

/// `1 file`, `3 files`.
fn count(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// The first line of `drift init`: what was read.
fn read_line(facts: &RepoFacts, packages: Option<usize>) -> String {
    let python = facts.files.iter().filter(|f| f.lang == "py").count();
    let other = facts.files.len() - python;
    let of = match (python, other) {
        (0, 0) => String::new(),
        (_, 0) => " of Python".to_string(),
        (0, _) => " of TypeScript and JavaScript".to_string(),
        _ => format!(" ({other} of TypeScript and JavaScript, {python} of Python)"),
    };
    let packages = match packages {
        Some(n) if n > 1 => format!(" in {n} packages"),
        _ => String::new(),
    };
    format!(
        "Drift read {}{of}{packages}. Nothing left this machine.",
        count(facts.files.len(), "file")
    )
}

/// Leave out of `mined.withheld` the cards a person already decided (in `policy`, e.g. one
/// rejected from `drift review --hidden`): they are not withheld from anyone.
fn drop_decided(mined: &mut Mined, policy: Option<&ConventionsFile>) {
    if let Some(p) = policy {
        mined
            .withheld
            .retain(|w| p.conventions.iter().all(|c| c.id != w.candidate.id));
    }
}

/// The cards mining withholds now, for `drift review`: mined as `drift init` would on this
/// policy (its frozen file kinds, hysteresis on its accepted conventions, the default
/// `--max`), Python ones too while Python proposals are off, less those a person decided.
fn withheld_now(root: &Path, facts: &RepoFacts, policy: &ConventionsFile) -> Vec<WithheldCard> {
    let accepted = policy.accepted_rules();
    let opts = MineOptions::default();
    let mut mined = mine_keeping(facts, &opts, policy.file_kinds.clone(), &accepted);
    withhold_python(
        drift_mine::policy::python_proposals(root, false),
        &mut mined,
        &accepted,
    );
    drop_decided(&mut mined, Some(policy));
    mined.withheld
}

fn policy_cap(root: &Path) -> Option<rank::SuggestionCap> {
    match ConventionsFile::load(root) {
        Ok(p) => p.and_then(|p| p.suggestion_cap),
        Err(e) => {
            eprintln!(
                "drift: {e:#}; listing the default {} suggestions",
                rank::DEFAULT_SUGGESTION_CAP
            );
            None
        }
    }
}

fn review_interactive(
    policy: &mut ConventionsFile,
    cap: rank::SuggestionCap,
    report: &CheckReport,
    questions: &BTreeMap<String, drift_mine::calibrate::Question>,
    outliers: OutlierCap,
    rlog: &mut review_log::ReviewLog,
) -> anyhow::Result<bool> {
    if !std::io::stdin().is_terminal() {
        bail!("`drift review` needs a terminal; use --accept/--reject/--block/--advise in scripts");
    }
    // Whether the person quit (or the input ended): then nothing more is asked.
    let mut quit = false;
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    // Default tier first, in policy order, then the best suggestions.
    let (ids, note) = review_queue(policy, cap);
    println!(
        "{} proposed conventions. y = accept, b = accept and block, a = accept and show to agents, n = reject, s = skip, q = quit",
        ids.len()
    );
    if let Some(n) = &note {
        println!("{n}");
    }
    println!(
        "Suggestions advise; blocking one asks you to confirm. A suggestion whose rule family is below the admission bar is not shown to agents unless you answer a."
    );
    if !questions.is_empty() {
        println!(
            "Block candidates ask one question: {} y = yes (accept), d = no, these are different (pick the files that are), n = not a convention (reject); b = yes, and block. Unanswered, a candidate stays one: no agent is shown it as a convention.",
            drift_mine::calibrate::QUESTION
        );
    }
    for id in ids {
        let Some(c) = policy.get_mut(&id) else {
            continue;
        };
        if let Some(q) = questions.get(&id) {
            print_question(c, q);
            rlog.shown(c, Some(report));
            let mut read = |prompt: &str| -> anyhow::Result<Option<String>> {
                print!("{prompt}");
                std::io::stdout().flush()?;
                Ok(lines.next().transpose()?)
            };
            let Some(line) = read("  [y/d/n/b/s/q] > ")? else {
                quit = true;
                break;
            };
            let before = rlog.before(c);
            match line.trim() {
                "y" => {
                    apply_answer(c, Answer::Same, None);
                    println!("  accepted");
                    rlog.answered(&before, c, q, "same", "accept", None);
                }
                "b" => {
                    c.status = Status::Accepted;
                    match block_guard(c) {
                        BlockGuard::Allowed => c.mode = Mode::Block,
                        BlockGuard::SmallRole => println!(
                            "  only {} examples: accepted as advise (blocking needs {MIN_BLOCK_ROLE_SIZE})",
                            c.evidence.role_size()
                        ),
                        _ => println!("  accepted as advise"),
                    }
                    let d = if c.mode == Mode::Block {
                        "block"
                    } else {
                        "accept"
                    };
                    rlog.answered(&before, c, q, "same", d, None);
                }
                "n" => {
                    apply_answer(c, Answer::NotAConvention, None);
                    println!("  rejected");
                    rlog.answered(&before, c, q, "not-a-convention", "reject", None);
                }
                "d" => {
                    let Some(diff) = pick_different(q, &mut read)? else {
                        println!("  skipped: it stays a candidate");
                        rlog.decision("skip", &before, c, None, None);
                        continue;
                    };
                    for l in apply_answer(c, Answer::Different, Some(&diff)) {
                        println!("  {l}");
                    }
                    rlog.answered(&before, c, q, "different", "accept", Some(&diff));
                }
                "q" => {
                    quit = true;
                    break;
                }
                _ => {
                    println!("  skipped: it stays a candidate");
                    rlog.decision("skip", &before, c, None, None);
                }
            }
            continue;
        }
        print_convention_card(c, report, outliers);
        rlog.shown(c, Some(report));
        print!("  [y/b/a/n/s/q] > ");
        std::io::stdout().flush()?;
        let Some(line) = lines.next() else {
            quit = true;
            break;
        };
        let mut confirm = |prompt: &str| -> anyhow::Result<String> {
            print!("{prompt}");
            std::io::stdout().flush()?;
            Ok(lines.next().transpose()?.unwrap_or_default())
        };
        let before = rlog.before(c);
        let answer = line?;
        let answer = answer.trim();
        if !review_answer(c, answer, &mut confirm)? {
            quit = true;
            break;
        }
        rlog.decision(interactive_decision(answer, c), &before, c, None, None);
    }
    // Accepted conventions are not shown again; say how to undo a block.
    let blocking = policy
        .conventions
        .iter()
        .filter(|c| {
            c.status == Status::Accepted && drift_mine::check::effective_mode(c) == "block"
        })
        .count();
    if blocking > 0 {
        println!(
            "{blocking} accepted conventions block. `drift review --advise <id>` sets one back to advise."
        );
    }
    Ok(!quit)
}

/// A block candidate's card as its question shows it: the convention, two or three members
/// that follow it, and every member it would flag, numbered by file.
fn print_question(c: &Convention, q: &drift_mine::calibrate::Question) {
    println!();
    println!("[{}] {}", c.id, c.summary);
    println!(
        "  evidence: {}/{} (lower bound {:.2}, lift {:.1})",
        c.evidence.holders, c.evidence.total, c.evidence.lower_bound, c.evidence.lift
    );
    println!("  tier:     {}", c.describe_tier());
    println!(
        "  agents:   {}",
        drift_mine::admission::convention_view(c).text
    );
    for line in question_lines(q) {
        println!("{line}");
    }
}

/// The holders and flagged files of a question, as interactive review prints them.
fn question_lines(q: &drift_mine::calibrate::Question) -> Vec<String> {
    let mut out = vec!["  follows it:".to_string()];
    for (i, h) in q.holders.iter().enumerate() {
        let note = if i == 0 { "  (the example)" } else { "" };
        out.push(format!("    {}:{} {}{note}", h.path, h.line, h.symbol));
    }
    if q.flagged.is_empty() {
        out.push("  would flag: none in the code now".to_string());
    } else {
        out.push(format!(
            "  would flag: {} in {} file(s)",
            q.flagged_total,
            q.flagged.len()
        ));
        for (i, f) in q.flagged.iter().enumerate() {
            let members: Vec<String> = f
                .members
                .iter()
                .map(|m| {
                    let entry = if m.needs_confirmation {
                        ", entry point"
                    } else {
                        ""
                    };
                    format!("{} (line {}{entry})", m.symbol, m.line)
                })
                .collect();
            out.push(format!("    {}  {}: {}", i + 1, f.path, members.join(", ")));
        }
    }
    if !q.set_apart.is_empty() {
        out.push(format!("  set apart already: {}", q.set_apart.join(", ")));
    }
    out.push(format!("  {}", drift_mine::calibrate::QUESTION));
    out
}

/// "No, these are different": which files, by their numbers, and a separate confirmation
/// for the entry points under an auth or validation rule among them. None (the card is
/// skipped and stays a candidate) when nothing is picked.
fn pick_different(
    q: &drift_mine::calibrate::Question,
    read: &mut dyn FnMut(&str) -> anyhow::Result<Option<String>>,
) -> anyhow::Result<Option<drift_mine::calibrate::Different>> {
    if q.flagged.is_empty() {
        println!("  it flags nothing now: nothing to set apart");
        return Ok(None);
    }
    let reply =
        read("  which files hold a different kind? numbers (1,3 or 1-3, or all; Enter: none) > ")?
            .unwrap_or_default();
    let Some(picked) = parse_picks(reply.trim(), q.flagged.len()) else {
        if !reply.trim().is_empty() {
            println!("  not a list of file numbers 1 to {}", q.flagged.len());
        }
        return Ok(None);
    };
    let files: Vec<String> = picked.iter().map(|&i| q.flagged[i].path.clone()).collect();
    let entries: Vec<String> = picked
        .iter()
        .flat_map(|&i| {
            let f = &q.flagged[i];
            f.members
                .iter()
                .filter(|m| m.needs_confirmation)
                .map(move |m| format!("{}#{}", f.path, m.symbol))
        })
        .collect();
    let mut confirm = Vec::new();
    if !entries.is_empty() {
        println!(
            "  {} of these are entry points under an auth or validation rule: {}",
            entries.len(),
            entries.join(", ")
        );
        let r = read("  setting them apart leaves them unchecked. Type `confirm` to set them apart too; Enter keeps them flagged > ")?
            .unwrap_or_default();
        if r.trim() == "confirm" {
            confirm = entries;
        }
    }
    Ok(Some(drift_mine::calibrate::different(q, &files, &confirm)?))
}

/// File numbers (1-based, `1,3`, `2-4`, `all`) as 0-based indices below `n`, sorted, none
/// twice; None when empty or not such a list.
fn parse_picks(text: &str, n: usize) -> Option<Vec<usize>> {
    if text.is_empty() {
        return None;
    }
    if text == "all" {
        return Some((0..n).collect());
    }
    let mut out = BTreeSet::new();
    for part in text.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let (a, b) = part.split_once('-').unwrap_or((part, part));
        let (a, b): (usize, usize) = (a.trim().parse().ok()?, b.trim().parse().ok()?);
        if a == 0 || b < a || b > n {
            return None;
        }
        out.extend(a - 1..b);
    }
    (!out.is_empty()).then(|| out.into_iter().collect())
}

/// The review log's name for an interactive answer to `c` (after it): `b` on a suggestion
/// confirmed with `block` is a forced block (declined, an accept); anything but y, b, a and
/// n is a skip.
fn interactive_decision(answer: &str, c: &Convention) -> &'static str {
    match answer {
        "y" => "accept",
        "a" => "show_to_agents",
        "b" if block_guard(c) == BlockGuard::Suggestion => {
            if c.mode == Mode::Block {
                "force_block"
            } else {
                // Asked to confirm, and declined: accepted as advice.
                "accept"
            }
        }
        "b" => "block",
        "n" => "reject",
        _ => "skip",
    }
}

/// Apply one interactive answer to `c`. `confirm` shows a prompt and reads the
/// reply. Returns false to stop reviewing.
fn review_answer(
    c: &mut Convention,
    answer: &str,
    confirm: &mut dyn FnMut(&str) -> anyhow::Result<String>,
) -> anyhow::Result<bool> {
    match answer {
        "y" => {
            c.status = Status::Accepted;
            let agents = drift_mine::admission::convention_view(c);
            if !agents.shown {
                println!(
                    "  accepted, {}: `a` (or `drift review --show-to-agents {}`) shows it to agents",
                    agents.text, c.id
                );
            }
        }
        "a" => show_to_agents_now(c),
        "b" => {
            c.status = Status::Accepted;
            match block_guard(c) {
                BlockGuard::Allowed => c.mode = Mode::Block,
                BlockGuard::SmallRole => println!(
                    "  only {} examples: accepted as advise (blocking needs {MIN_BLOCK_ROLE_SIZE})",
                    c.evidence.role_size()
                ),
                BlockGuard::Experimental => {
                    println!("  experimental wiring rules only advise: accepted as advise")
                }
                BlockGuard::Suggestion => {
                    let reply = confirm(&format!(
                        "  this is a {}: suggestions advise. Type `block` to block it anyway, Enter to accept it as advice > ",
                        c.describe_tier()
                    ))?;
                    if reply.trim() == "block" {
                        c.mode = Mode::Block;
                    } else {
                        println!("  accepted as advise");
                    }
                }
            }
        }
        "n" => c.status = Status::Rejected,
        "q" => return Ok(false),
        _ => {}
    }
    Ok(true)
}

/// A withheld card's lines on a `drift review --hidden` card: the evidence view of normal
/// review ([`card_outlier_lines`]), with the commands that only work on a card in the
/// policy pointed at `--hidden`, then why it was withheld and how to promote it.
fn hidden_card_lines(
    c: &Convention,
    w: &WithheldCard,
    report: &CheckReport,
    cap: OutlierCap,
) -> Vec<String> {
    let mut out = vec![
        String::new(),
        format!("[{}] {}", c.id, c.summary),
        format!(
            "  evidence: {}/{} (lower bound {:.2}, lift {:.1})",
            c.evidence.holders, c.evidence.total, c.evidence.lower_bound, c.evidence.lift
        ),
        format!("  tier:     {}", c.describe_tier()),
        format!(
            "  withheld: {} ({} {})",
            w.reason.text(),
            language_name(tier::language_code(c.language())),
            drift_mine::show::family_name(&c.rule)
        ),
        // What agents are told of it now (a strong one is a fact on the card of a file
        // in its role, never a convention), and what they would be told were a person
        // to promote it: the normal rules.
        format!(
            "  agents:   {} while withheld; if promoted, {}",
            if drift_mine::card::stated(&c.evidence, &c.rule) {
                "a fact on `drift card`, not a convention,"
            } else {
                "never"
            },
            drift_mine::admission::accepted_view(c).text
        ),
        format!("  example:  {}", c.example),
    ];
    let more = format!("`drift review --show {} --all-outliers`", c.id);
    for line in card_outlier_lines(c, report, cap) {
        if line.starts_with("  fine because...") {
            continue;
        }
        out.push(line.replace(&more, "`drift review --hidden --all-outliers`"));
    }
    out.push(format!(
        "  promote:  `drift review --hidden --answer {id}=same` (accept), `{id}=different --set-apart PATHS` (accept, those files set apart) or `{id}=not-a-convention` (reject)",
        id = c.id
    ));
    out
}

/// `drift review --hidden`: the cards mining withheld, which are conventions for no one
/// (`drift card` states the strong ones as facts, [`card::regularities`]). Lists them (or,
/// with `json`, their questions) and changes nothing; with `answer`, a person promotes
/// one into the policy as their decision ([`ConventionsFile::add_promoted`]).
#[allow(clippy::too_many_arguments)]
fn review_hidden(
    cli: &Cli,
    policy: &mut ConventionsFile,
    answer: Option<&str>,
    json: bool,
    set_apart: &[String],
    confirm_entry: &[String],
    all_outliers: bool,
    log: bool,
) -> anyhow::Result<ExitCode> {
    let root = &cli.root;
    // Refuse a malformed answer before reading the repository.
    let answer = answer.map(parse_answer).transpose()?;
    if let Some((id, kind)) = &answer
        && !set_apart.is_empty()
        && *kind != Answer::Different
    {
        bail!("--set-apart goes with --answer {id}=different; nothing was changed");
    }
    let mut facts = load_facts(cli, 0)?;
    let cards = withheld_now(root, &facts, policy);
    // The policy with the withheld cards added as proposals, for their outliers and
    // questions only: never saved.
    let mut view = policy.clone();
    view.conventions.extend(
        cards
            .iter()
            .map(|w| Convention::proposed_from(&w.candidate)),
    );
    let report = review_report_on(cli, &mut facts, &view)?;
    let card = |id: &str| {
        view.conventions
            .iter()
            .find(|c| c.id == id)
            .expect("in the view")
    };
    let mut rlog =
        review_log::ReviewLog::new(root, policy, log, false, rank::SuggestionCap::All, || {
            Some(&facts)
        });
    if json {
        let wanted: Vec<&Convention> = cards.iter().map(|w| card(&w.candidate.id)).collect();
        let qs = drift_mine::calibrate::questions_of(&facts, &view, &report, wanted);
        let mut out = questions_json(&qs);
        out["hidden"] = serde_json::json!(true);
        out["answer_with"] =
            serde_json::json!("drift review --hidden --answer ID=same|different|not-a-convention");
        out["withheld"] = withheld_json(&cards);
        if let Some(list) = out["candidates"].as_array_mut() {
            for q in list {
                if let Some(w) = cards.iter().find(|w| q["id"] == w.candidate.id.as_str()) {
                    q["withheld"] = serde_json::json!({
                        "reason": w.reason.code(),
                        "family": drift_mine::show::family_name(&w.candidate.rule),
                        "language": tier::language_code(w.candidate.language()),
                    });
                }
            }
        }
        println!("{}", serde_json::to_string_pretty(&out)?);
        return Ok(ExitCode::SUCCESS);
    }
    let Some((id, kind)) = answer else {
        let cap = if all_outliers {
            OutlierCap::All
        } else {
            OutlierCap::First(CARD_OUTLIERS)
        };
        match withheld_note(&cards) {
            None => println!(
                "No mined card is withheld: every card mining found is proposed (`drift review --list`)."
            ),
            Some(n) => println!(
                "{n}\nNone is a convention unless you promote it: no hook, MCP rule, export or SARIF report lists one, and nothing checks one. `drift card <file>` states the strong ones as facts about the code, not rules."
            ),
        }
        for w in &cards {
            let c = card(&w.candidate.id);
            for line in hidden_card_lines(c, w, &report, cap) {
                println!("{line}");
            }
            rlog.shown(c, Some(&report));
            rlog.mark_hidden(w, false);
        }
        rlog.flush();
        return Ok(ExitCode::SUCCESS);
    };
    let Some(w) = cards.iter().find(|w| w.candidate.id == id) else {
        bail!(
            "{id} is not a card mining withholds now (`drift review --hidden` lists them; a convention already in {CONVENTIONS_FILE} is decided with --accept, --reject or --answer); nothing was changed"
        );
    };
    let files = set_apart
        .iter()
        .map(|p| drift_mine::policy::different_kind_path(p.trim_start_matches("./")))
        .collect::<anyhow::Result<Vec<_>>>()
        .context("nothing was changed")?;
    let confirm = confirm_entry
        .iter()
        .map(|m| drift_mine::policy::exception_member(m))
        .collect::<anyhow::Result<Vec<_>>>()
        .context("nothing was changed")?;
    let Some(q) =
        drift_mine::calibrate::questions_of(&facts, &view, &report, vec![card(&id)]).pop()
    else {
        bail!("{id}: its question could not be built; nothing was changed");
    };
    let diff = match kind {
        Answer::Different => Some(
            drift_mine::calibrate::different(&q, &files, &confirm)
                .context("nothing was changed")?,
        ),
        _ => None,
    };
    let mut c = card(&id).clone();
    let before = rlog.before(&c);
    let lines = apply_answer(&mut c, kind, diff.as_ref());
    let promoted = c.status == Status::Accepted;
    // [STRICT] Baselined like a card `drift init` adds: its current violations are legacy,
    // so promoting a card never fails a check on code that was there before.
    let mut lock = Lock::load(root)?;
    if promoted {
        let mut alone = policy.clone();
        alone.conventions = vec![c.clone()];
        lock.entries
            .extend(practices::baseline_with_practices(root, &facts, &alone).entries);
    }
    c.promoted_from_hidden = true;
    let decision = if kind == Answer::NotAConvention {
        "reject"
    } else {
        "accept"
    };
    rlog.answered(&before, &c, &q, kind.name(), decision, diff.as_ref());
    rlog.mark_hidden(w, promoted);
    let agents = drift_mine::admission::convention_view(&c);
    policy.add_promoted(c);
    policy.save(root)?;
    if promoted {
        lock.save(root)?;
    }
    rlog.flush();
    for line in lines {
        println!("{line}");
    }
    if promoted {
        println!(
            "{id}: promoted from the withheld cards: in {CONVENTIONS_FILE} as accepted by you (promoted_from_hidden: true), its current outliers baselined in {LOCK_FILE}. It now follows the normal tier and agent rules: {}.",
            agents.text
        );
    } else {
        println!(
            "{id}: in {CONVENTIONS_FILE} as rejected by you (promoted_from_hidden: true), so it is not listed again."
        );
    }
    println!("{}", review_summary(policy));
    Ok(ExitCode::SUCCESS)
}

/// Exit code when stdout turns out to be a closed pipe (`drift census | head`):
/// 141, which is 128 + SIGPIPE, as a shell reports for `yes | head`, so
/// `pipefail` sees it. `drift check` stores its own result here before it writes
/// anything, so blocking violations still fail when the reader goes away.
static PIPE_EXIT: AtomicU8 = AtomicU8::new(141);

/// Nearest scope from any directory in the repository: `check`, `review`, `example` and
/// `export` run without `--root` in a directory with no `.drift/conventions.yaml` (a
/// package of a monorepo, a folder inside it) use the nearest policy above it, and
/// their file arguments, relative to the working directory, are made absolute so they
/// still name the same files. With `--root`, or with a policy here, nothing changes.
fn nearest_policy(cli: &mut Cli) {
    let needs_policy = matches!(
        cli.command,
        Command::Check { .. }
            | Command::Review { .. }
            | Command::Example { .. }
            | Command::Export { .. }
    );
    if !needs_policy || cli.root != Path::new(".") || Path::new(CONVENTIONS_FILE).is_file() {
        return;
    }
    let Ok(cwd) = std::env::current_dir() else {
        return;
    };
    let Some(root) = project::find_root(&cwd) else {
        return;
    };
    let abs = |f: &mut String| {
        if Path::new(f.as_str()).is_relative() {
            *f = cwd.join(f.as_str()).to_string_lossy().into_owned();
        }
    };
    match &mut cli.command {
        Command::Check { files, .. } => files.iter_mut().for_each(abs),
        Command::Example { file } => abs(file),
        _ => {}
    }
    cli.root = root;
}

/// Whether this build of drift has the subcommand `name` (`practices` arrives with the
/// practice map): agent text names a command only when it exists.
pub(crate) fn has_command(name: &str) -> bool {
    <Cli as clap::CommandFactory>::command()
        .find_subcommand(name)
        .is_some()
}

fn main() -> ExitCode {
    // `println!` panics when stdout is a closed pipe: exit quietly with the pipe code.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info.payload_as_str().unwrap_or_default();
        if msg.starts_with("failed printing to stdout") && msg.contains("Broken pipe") {
            std::process::exit(i32::from(PIPE_EXIT.load(Ordering::Relaxed)));
        }
        // A parse that ran out of its memory budget: the file is skipped as too
        // costly and reported as such, not a crash.
        if info
            .location()
            .is_some_and(|l| drift_ts::arena::is_over_budget_panic(msg, l.file()))
        {
            return;
        }
        default_hook(info)
    }));
    fn is_broken_pipe(e: &anyhow::Error) -> bool {
        e.chain().any(|c| {
            c.downcast_ref::<std::io::Error>()
                .is_some_and(|io| io.kind() == std::io::ErrorKind::BrokenPipe)
                || c.downcast_ref::<serde_json::Error>()
                    .and_then(serde_json::Error::io_error_kind)
                    == Some(std::io::ErrorKind::BrokenPipe)
        })
    }
    let mut cli = Cli::parse();
    nearest_policy(&mut cli);
    match run(&cli) {
        Ok(code) => code,
        // `drift census | head`: the reader went away, which is not an error.
        Err(e) if is_broken_pipe(&e) => ExitCode::from(PIPE_EXIT.load(Ordering::Relaxed)),
        Err(e) => {
            eprintln!("drift: {e:#}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{SymbolKind, WrapKind};
    use drift_mine::mine::{Evidence, Rule};
    use drift_mine::roles::RoleSelector;

    fn conv(rule: Rule, total: usize) -> Convention {
        Convention {
            id: "D-aaaaaa".into(),
            status: Status::Proposed,
            mode: Mode::Advise,
            summary: String::new(),
            role: RoleSelector {
                package: String::new(),
                dir: "app".into(),
                file: "route".into(),
                entry: "http".into(),
                kind: SymbolKind::Function,
                variety: None,
                export_name: None,
                member_kind: None,
                shape: None,
                also: vec![],
            },
            rule,
            evidence: Evidence {
                holders: total - 1,
                total,
                lower_bound: 0.8,
                lift: 2.0,
                split: vec![],
                role_members: None,
                python_members: None,
            },
            example: "app/a/route.ts#GET".into(),
            selector_version: drift_mine::policy::SELECTOR_VERSION,
            agents: None,
            exceptions: Vec::new(),
            different_kind: Vec::new(),
            promoted_from_hidden: false,
            promoted_from_practice: None,
            from_map: None,
            accepted_evidence: None,
        }
    }

    fn wrapper() -> Rule {
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec!["lib/auth.ts#withAuth".into()],
        }
    }

    fn calls() -> Rule {
        Rule::Calls {
            callee: "lib/log.ts#log".into(),
        }
    }

    /// Answer `b` to one card, replying `reply` if asked to confirm. Returns the
    /// resulting (status, mode) and whether confirmation was asked.
    fn answer_b(mut c: Convention, reply: &str) -> (Status, Mode, bool) {
        let mut asked = false;
        let mut confirm = |_: &str| {
            asked = true;
            Ok(reply.to_string())
        };
        assert!(review_answer(&mut c, "b", &mut confirm).unwrap());
        (c.status, c.mode, asked)
    }

    /// Interactive review asks about every proposed default-tier convention, in policy
    /// order, then the best proposed suggestions; decided ones are not asked about.
    #[test]
    fn review_queue_lists_the_default_tier_then_the_best_suggestions() {
        let mk = |id: &str, rule: Rule, lb: f64, status: Status| {
            let mut c = conv(rule, 40);
            c.id = id.into();
            c.evidence.lower_bound = lb;
            c.status = status;
            c
        };
        let policy = ConventionsFile {
            version: 1,
            engine: String::new(),
            file_kinds: Default::default(),
            suggestion_cap: None,
            agents: Default::default(),
            review_log: Default::default(),
            packages: Vec::new(),
            conventions: vec![
                mk("D-000001", calls(), 0.70, Status::Proposed),
                mk("D-000002", wrapper(), 0.60, Status::Proposed),
                mk("D-000003", calls(), 0.90, Status::Proposed),
                mk("D-000004", calls(), 0.95, Status::Accepted),
                mk("D-000005", wrapper(), 0.90, Status::Proposed),
                mk("D-000006", calls(), 0.80, Status::Proposed),
            ],
        };
        let (ids, note) = review_queue(&policy, rank::SuggestionCap::Top(2));
        assert_eq!(ids, ["D-000002", "D-000005", "D-000003", "D-000006"]);
        let note = note.unwrap();
        assert!(note.starts_with("Showing 2 of 3 suggestions"), "{note}");
        assert!(note.contains("`drift review --all`"), "{note}");
        let (ids, note) = review_queue(&policy, rank::SuggestionCap::All);
        assert_eq!(ids.len(), 5);
        assert!(note.is_none());
        let (ids, _) = review_queue(&policy, rank::SuggestionCap::Top(0));
        assert_eq!(
            ids,
            ["D-000002", "D-000005"],
            "the default tier is never capped"
        );
    }

    #[test]
    fn example_names_every_convention_of_a_shared_example_default_tier_first() {
        let mut suggestion = conv(calls(), 40);
        suggestion.id = "D-000001".into();
        suggestion.summary = "handlers call log()".into();
        let mut default = conv(wrapper(), 40);
        default.id = "D-000002".into();
        default.summary = "handlers are wrapped in withAuth()".into();
        let mut other = conv(calls(), 40);
        other.summary = "pages call track()".into();
        other.example = "app/b/page.tsx#Page".into();
        // In policy order the suggestion comes first and used to hide the wrapper rule.
        assert_eq!(
            example_lines(&[&suggestion, &default, &other]),
            [
                "app/a/route.ts#GET  ([D-000002] handlers are wrapped in withAuth(); [D-000001] handlers call log())",
                "app/b/page.tsx#Page  ([D-aaaaaa] pages call track())",
            ]
        );
    }

    /// The review log's name for each interactive answer: `b` on a suggestion is a forced
    /// block only once confirmed (declined, an accept), on the default tier a block.
    #[test]
    fn interactive_answers_are_logged_by_what_they_did() {
        let mut sugg = conv(calls(), 40);
        assert_eq!(block_guard(&sugg), BlockGuard::Suggestion);
        sugg.mode = Mode::Block;
        assert_eq!(interactive_decision("b", &sugg), "force_block");
        sugg.mode = Mode::Advise;
        assert_eq!(interactive_decision("b", &sugg), "accept");
        let def = conv(wrapper(), 40);
        assert_eq!(interactive_decision("b", &def), "block");
        assert_eq!(interactive_decision("y", &def), "accept");
        assert_eq!(interactive_decision("a", &def), "show_to_agents");
        assert_eq!(interactive_decision("n", &def), "reject");
        assert_eq!(interactive_decision("s", &def), "skip");
        assert_eq!(interactive_decision("", &def), "skip");
    }

    #[test]
    fn review_summary_counts_what_blocks_as_checked() {
        let mut blocks = conv(wrapper(), 40);
        blocks.status = Status::Accepted;
        blocks.mode = Mode::Block;
        // A small role advises whatever its mode says.
        let mut small = conv(wrapper(), 10);
        small.status = Status::Accepted;
        small.mode = Mode::Block;
        let mut rejected = conv(calls(), 40);
        rejected.status = Status::Rejected;
        let policy = ConventionsFile {
            version: 1,
            engine: String::new(),
            file_kinds: drift_mine::roles::FileKinds::default(),
            suggestion_cap: None,
            agents: Default::default(),
            review_log: Default::default(),
            packages: Vec::new(),
            conventions: vec![blocks, small, rejected, conv(calls(), 40)],
        };
        assert_eq!(
            review_summary(&policy),
            "2 accepted (1 block), 1 proposed, 1 rejected (1 accepted not shown to agents: rule family below the admission bar)"
        );
        // A person's `agents: show` (and a forced block) count as shown.
        let mut policy = policy;
        policy.conventions[1].agents = Some(drift_mine::policy::AgentsChoice::Show);
        assert_eq!(
            review_summary(&policy),
            "2 accepted (1 block), 1 proposed, 1 rejected"
        );
    }

    #[test]
    fn interactive_review_blocks_suggestions_only_when_confirmed() {
        use Mode::{Advise, Block};
        use Status::Accepted;
        assert_eq!(answer_b(conv(wrapper(), 40), ""), (Accepted, Block, false));
        assert_eq!(answer_b(conv(calls(), 40), ""), (Accepted, Advise, true));
        assert_eq!(answer_b(conv(calls(), 40), "y"), (Accepted, Advise, true));
        assert_eq!(
            answer_b(conv(calls(), 40), "block"),
            (Accepted, Block, true)
        );
        // Small roles never block, whatever the tier.
        assert_eq!(
            answer_b(conv(wrapper(), 10), "block"),
            (Accepted, Advise, false)
        );
        assert_eq!(
            answer_b(conv(calls(), 10), "block"),
            (Accepted, Advise, false)
        );
        let mut c = conv(calls(), 40);
        assert!(review_answer(&mut c, "y", &mut |_| unreachable!()).unwrap());
        assert_eq!((c.status, c.mode), (Accepted, Advise));
    }

    #[test]
    fn check_json_conventions_carry_tier_and_effective_mode() {
        let mut small = conv(wrapper(), 10);
        small.id = "D-000001".into();
        small.status = Status::Accepted;
        small.mode = Mode::Block;
        let mut big = conv(wrapper(), 40);
        big.id = "D-000002".into();
        big.status = Status::Accepted;
        big.mode = Mode::Block;
        let mut forced = conv(calls(), 40);
        forced.id = "D-000003".into();
        forced.status = Status::Accepted;
        forced.mode = Mode::Block;
        let proposed = conv(calls(), 40);
        let mut package = conv(
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of: vec!["pkg:express#Router".into()],
            },
            40,
        );
        package.id = "D-000005".into();
        // D7: a decorator rule (default under D5) and any Python convention are suggestions.
        let mut decorator = conv(
            Rule::WrappedBy {
                kind: WrapKind::Decorator,
                any_of: vec!["src/auth.ts#Authed".into()],
            },
            40,
        );
        decorator.id = "D-000006".into();
        let mut python = conv(
            Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of: vec!["app/auth.py#login_required".into()],
            },
            40,
        );
        python.id = "D-000007".into();
        python.example = "app/views.py#index".into();
        let policy = ConventionsFile {
            version: 1,
            engine: String::new(),
            file_kinds: Default::default(),
            suggestion_cap: None,
            agents: Default::default(),
            review_log: Default::default(),
            packages: Vec::new(),
            conventions: vec![small, big, forced, proposed, package, decorator, python],
        };
        let v = serde_json::to_value(check_conventions(&policy, None)).unwrap();
        let row = |i: usize| {
            let r = &v[i];
            (
                r["id"].as_str().unwrap().to_string(),
                r["mode"].as_str().unwrap().to_string(),
                r["effective_mode"].as_str().unwrap().to_string(),
                r["tier"].as_str().unwrap().to_string(),
                r["blockable"].as_bool().unwrap(),
            )
        };
        let s = |x: &str| x.to_string();
        // A small role advises even though the policy says block.
        assert_eq!(
            row(0),
            (
                s("D-000001"),
                s("block"),
                s("advise"),
                s("suggestion"),
                false
            )
        );
        assert_eq!(
            row(1),
            (s("D-000002"), s("block"), s("block"), s("default"), true)
        );
        // A suggestion set to block with --force keeps blocking.
        assert_eq!(
            row(2),
            (s("D-000003"), s("block"), s("block"), s("suggestion"), true)
        );
        assert_eq!(v[3]["status"], "proposed");
        assert_eq!(v[3]["effective_mode"], "advise");
        assert_eq!(v[1]["rule_kind"], "wrapped_by:call");
        assert_eq!(v[1]["members"], 40);
        // D7's tier and its reason, as in `census --json`.
        let reasons: Vec<_> = (0..7)
            .map(|i| (v[i]["tier_reason"].clone(), v[i]["names_package"].clone()))
            .collect();
        let r = |x: Option<&str>, p: bool| (serde_json::json!(x), serde_json::json!(p));
        assert_eq!(
            reasons,
            vec![
                r(Some("small_role"), false),
                r(None, false),
                r(Some("rule_kind"), false),
                r(Some("rule_kind"), false),
                r(Some("names_package"), true),
                r(Some("rule_kind_d7"), false),
                r(Some("language_advise"), false),
            ]
        );
        assert_eq!(v[4]["tier"], "suggestion");
        assert_eq!(v[5]["tier"], "suggestion");
        assert_eq!(v[6]["tier"], "suggestion");
    }

    #[test]
    fn block_guard_extends_the_small_role_guard() {
        assert_eq!(block_guard(&conv(wrapper(), 15)), BlockGuard::Allowed);
        assert_eq!(block_guard(&conv(wrapper(), 14)), BlockGuard::SmallRole);
        assert_eq!(block_guard(&conv(calls(), 14)), BlockGuard::SmallRole);
        assert_eq!(block_guard(&conv(calls(), 40)), BlockGuard::Suggestion);
    }

    #[test]
    fn file_numbers_are_parsed_strictly() {
        assert_eq!(parse_picks("1,3", 3), Some(vec![0, 2]));
        assert_eq!(parse_picks("3, 1-2 ,1", 3), Some(vec![0, 1, 2]));
        assert_eq!(parse_picks("all", 2), Some(vec![0, 1]));
        for bad in ["", "0", "4", "2-1", "x", "1;2", "-1", ","] {
            assert_eq!(parse_picks(bad, 3), None, "{bad:?}");
        }
    }

    fn question(needs: bool) -> drift_mine::calibrate::Question {
        use drift_mine::calibrate::{Flagged, FlaggedFile, Question};
        let flagged = |path: &str, symbol: &str| FlaggedFile {
            path: path.into(),
            members: vec![Flagged {
                symbol: symbol.into(),
                line: 1,
                needs_confirmation: needs,
                legacy: true,
            }],
        };
        Question {
            id: "D-000001".into(),
            summary: "s".into(),
            rule_kind: "wrapped_by:call",
            family: "Call wrappers",
            holders_total: 28,
            members: 30,
            holders: Vec::new(),
            flagged: vec![flagged("a/x.ts", "GET"), flagged("a/y.ts", "GET")],
            flagged_total: 2,
            auth_or_validation: needs,
            set_apart: Vec::new(),
        }
    }

    /// Interactive "No, these are different": files by number; [STRICT] an entry point
    /// under an auth or validation rule needs the separate `confirm`, else stays flagged.
    #[test]
    fn interactive_different_asks_a_separate_confirmation_for_entry_points() {
        let answer = |q: &drift_mine::calibrate::Question, replies: &[&str]| {
            let mut it = replies.iter().map(|s| s.to_string());
            pick_different(q, &mut |_| Ok(it.next())).unwrap()
        };
        let d = answer(&question(false), &["2"]).unwrap();
        assert_eq!(d.files, [("a/y.ts".to_string(), vec![])]);
        assert!(d.kept.is_empty());
        // Nothing picked, or not a list: skipped (None), nothing written.
        assert!(answer(&question(false), &[""]).is_none());
        assert!(answer(&question(false), &["9"]).is_none());
        // Entry points: declined (Enter or anything but `confirm`), they stay flagged.
        for no in ["", "yes", "y"] {
            let d = answer(&question(true), &["1,2", no]).unwrap();
            assert!(d.files.is_empty() && d.covered.is_empty(), "{no:?}: {d:?}");
            assert_eq!(d.kept, ["a/x.ts#GET", "a/y.ts#GET"]);
        }
        let d = answer(&question(true), &["1", "confirm"]).unwrap();
        assert_eq!(d.files, [("a/x.ts".to_string(), vec!["GET".to_string()])]);
        assert_eq!(d.covered, ["a/x.ts#GET"]);
    }
}
