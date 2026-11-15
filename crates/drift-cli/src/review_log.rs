//! The review log (round 9, G): an opt-in, local-only record of the decisions maintainers
//! make in `drift review` (and in the Studio, which runs it), exportable as a study file
//! (`drift review --export-log FILE`, read by `eval/study/maintainer-log.mjs`). It is the
//! real-maintainer evidence decision D10.3 asks for before any external precision claim.
//!
//! - **Opt-in.** Nothing is recorded unless `review_log: on` is in `.drift/conventions.yaml`
//!   (`drift review --set-log on`) or a run passes `--log`. Off, no file is created and
//!   every output is what it was.
//! - **Local only.** The log is a file under `.drift/review-log/` (with a `.gitignore` of
//!   `*`, so `git add -A` never commits it). Drift sends nothing anywhere: no network, no
//!   telemetry. A study file exists only when a person exports one, to a path they choose.
//! - **What it holds.** Per event: the time, the convention id, its rule kind, family,
//!   tier and language, its evidence (holders, members, outliers, Wilson lower bound,
//!   lift), the decision (or `shown`, with the card's rank, admission decision and
//!   verifier status), the status and mode before and after, and Drift's version and
//!   commit. Never source code, file contents, the repository's name or remote, or who
//!   the person is. A reviewer's exception adds the member (`path#symbol`) and reason.
//! - **Export.** Ids, members and the example are replaced by keyed hashes (blake3, keyed
//!   with a random salt kept in `.drift/review-log/salt`, one per repository, so exports
//!   of two repositories cannot be joined) and a reason by its length, unless the person
//!   passes `--include-paths`.
//! - **Storage.** JSON lines, appended under an exclusive lock on `.drift/review-log/lock`
//!   (the CLI and the Studio's runs of it may write at once), never through a symbolic
//!   link, rotated at [`MAX_LOG_BYTES`] into one older file, so the log stays under twice
//!   that.
//! - **Ids across `drift init` runs (round 9, D).** Hysteresis keeps an accepted
//!   convention's id, so its entries stay its own. A merged card (`role.also`) has a new id,
//!   the hash of its merged selector; entries logged under its parts' earlier ids are not
//!   rewritten: each part's id is `convention_id(part, rule)` for a part of the card's
//!   `role.parts()`, which is how a study joins them.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use drift_mine::admission::Decision;
use drift_mine::check::CheckReport;
use drift_mine::policy::{Convention, ConventionsFile, Mode, Status, Switch};
use drift_mine::rank;
use drift_mine::tier::{self, Tier};
use drift_mine::verify::{State, VerifyStatus};
use serde_json::{Map, Value, json};

/// The log's directory, under the repository root.
pub const DIR: &str = ".drift/review-log";
const LOG: &str = "log.jsonl";
const OLD: &str = "log.1.jsonl";
const SALT: &str = "salt";
const LOCK: &str = "lock";
/// The log is rotated (into one older file, replacing it) before it would grow past this.
pub const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;
/// The `schema` of an exported study file, and its version.
pub const EXPORT_SCHEMA: &str = "drift-review-log";
pub const EXPORT_VERSION: u32 = 1;
/// The version of one logged event's shape.
const EVENT_VERSION: u32 = 1;
/// The version of an answered question's `question` record ([`ReviewLog::answered`]).
const QUESTION_VERSION: u32 = 1;
/// Set by the Studio for the runs it makes, so the log says where a decision was made.
/// Anything else (or nothing) is the CLI.
pub const VIA_ENV: &str = "DRIFT_REVIEW_VIA";
/// Labelled cards a family record needs before the Studio's Block is the red,
/// record-backed one (`RECORD_MIN_CARDS` in apps/studio conventions.ts).
const RECORD_MIN_CARDS: u32 = 10;

/// A convention's state before a decision: what the decision event records as `before`.
#[derive(Debug, Clone)]
pub struct Before {
    status: Status,
    mode: Mode,
    agents: Decision,
}

/// The events of one `drift review` run, written together once its decisions are saved.
pub struct ReviewLog {
    root: PathBuf,
    on: bool,
    via: &'static str,
    /// Each proposed convention's place in the review queue (1-based) and whether the
    /// queue lists it without `--all`.
    ranks: BTreeMap<String, (usize, bool)>,
    verify: Option<BTreeMap<String, VerifyStatus>>,
    events: Vec<Value>,
}

impl ReviewLog {
    /// The log of a run on `policy` (as it is before any decision): on when the policy
    /// says `review_log: on` or `forced` (`--log`). `facts` is called only when the log is
    /// on, `agents.verify` is on and a cached verdict has to be checked against its card.
    pub fn new<R: std::borrow::Borrow<drift_core::RepoFacts>>(
        root: &Path,
        policy: &ConventionsFile,
        forced: bool,
        interactive: bool,
        cap: rank::SuggestionCap,
        facts: impl FnOnce() -> Option<R>,
    ) -> Self {
        let on = forced || policy.review_log == Switch::On;
        let via = if std::env::var(VIA_ENV).is_ok_and(|v| v == "studio") {
            "studio"
        } else if interactive {
            "interactive"
        } else {
            "cli"
        };
        let mut ranks = BTreeMap::new();
        let mut verify = None;
        if on {
            let mut proposed: Vec<&Convention> = policy
                .conventions
                .iter()
                .filter(|c| c.status == Status::Proposed)
                .collect();
            tier::order_by_tier(&mut proposed, |c| c.tier());
            for p in rank::place(&proposed, cap) {
                ranks.insert(p.item.id.clone(), (p.rank, p.shown));
            }
            verify = drift_mine::verify::statuses(root, policy, facts);
        }
        Self {
            root: root.to_path_buf(),
            on,
            via,
            ranks,
            verify,
            events: Vec::new(),
        }
    }

    pub fn on(&self) -> bool {
        self.on
    }

    /// What agents are told about `c` now (the verifier included when it is on).
    fn agents(&self, c: &Convention) -> Decision {
        drift_mine::verify::convention_view(c, self.verify.as_ref())
    }

    /// `c` as it is now, for a later [`Self::decision`].
    pub fn before(&self, c: &Convention) -> Before {
        Before {
            status: c.status,
            mode: c.mode,
            agents: self.agents(c),
        }
    }

    /// The fields every event about `c` has.
    fn card(
        &self,
        event: &str,
        decision: &str,
        c: &Convention,
        agents: &Decision,
    ) -> Map<String, Value> {
        let e = &c.evidence;
        let mut m = Map::new();
        m.insert("v".into(), json!(EVENT_VERSION));
        m.insert("ts".into(), json!(now_utc()));
        m.insert("event".into(), json!(event));
        m.insert("decision".into(), json!(decision));
        m.insert("via".into(), json!(self.via));
        m.insert("id".into(), json!(c.id));
        m.insert("rule_kind".into(), json!(tier::rule_kind(&c.rule)));
        m.insert("family".into(), json!(rank::family(&c.rule)));
        m.insert("tier".into(), json!(c.tier().as_str()));
        m.insert("language".into(), json!(tier::language_code(c.language())));
        m.insert(
            "evidence".into(),
            json!({
                "holders": e.holders,
                "total": e.total,
                "members": e.role_size(),
                "outliers": e.total.saturating_sub(e.holders),
                "wilson": round4(e.lower_bound),
                "lift": round4(e.lift),
            }),
        );
        let (rank, listed) = match self.ranks.get(&c.id) {
            Some((r, l)) => (json!(r), json!(l)),
            None => (Value::Null, Value::Null),
        };
        m.insert("rank".into(), rank);
        m.insert("listed".into(), listed);
        m.insert("agents".into(), agents_json(agents));
        m.insert(
            "verify".into(),
            match self.verify.as_ref().and_then(|v| v.get(&c.id)) {
                Some(s) => json!(state_name(s.state)),
                None => Value::Null,
            },
        );
        m.insert("example".into(), json!(c.example));
        m.insert(
            "drift".into(),
            json!({
                "version": env!("CARGO_PKG_VERSION"),
                "commit": option_env!("DRIFT_BUILD_COMMIT"),
            }),
        );
        m
    }

    /// A card shown to the person (`--list`, `--show`, interactive review, a Studio card
    /// opened: `--shown`), with how many outliers it lists now when a report is at hand.
    pub fn shown(&mut self, c: &Convention, report: Option<&CheckReport>) {
        if !self.on {
            return;
        }
        let agents = self.agents(c);
        let mut m = self.card("shown", "shown", c, &agents);
        m.insert(
            "status".into(),
            json!({ "status": c.status, "mode": c.mode }),
        );
        if let Some(r) = report {
            let now = r.violations.iter().filter(|v| v.id == c.id).count();
            m.insert("outliers_now".into(), json!(now));
        }
        self.events.push(Value::Object(m));
    }

    /// A decision on `c` (as it is after it): `accept`, `reject`, `block`, `force_block`,
    /// `advise`, `show_to_agents`, `skip`, `exempt` or `unexempt`. `member` and `reason`
    /// for an exception.
    pub fn decision(
        &mut self,
        decision: &str,
        before: &Before,
        c: &Convention,
        member: Option<&str>,
        reason: Option<&str>,
    ) {
        if !self.on {
            return;
        }
        // The admission decision as it stood when the person decided (a person's
        // `agents: show` or a forced block would otherwise read as its own reason).
        let mut m = self.card("decision", decision, c, &before.agents);
        m.insert(
            "before".into(),
            json!({ "status": before.status, "mode": before.mode }),
        );
        m.insert(
            "after".into(),
            json!({
                "status": c.status,
                "mode": c.mode,
                "shown_to_agents": self.agents(c).shown,
            }),
        );
        if decision == "force_block" && c.tier() == Tier::Suggestion {
            // As the Studio offers it: the red "Block anyway" only on a known record of at
            // least half accepted, else the neutral "Block…".
            let backed = matches!(
                (before.agents.accepted, before.agents.n),
                (Some(a), Some(n)) if n >= RECORD_MIN_CARDS && a * 2 >= n
            );
            m.insert(
                "block".into(),
                json!(if backed { "record_backed" } else { "neutral" }),
            );
        }
        if let Some(member) = member {
            m.insert("member".into(), json!(member));
        }
        if let Some(reason) = reason {
            m.insert("reason".into(), json!(reason));
        }
        self.events.push(Value::Object(m));
    }

    /// A block candidate's question answered (`drift review --answer`, interactive y, b, d,
    /// n; the Studio): `decision` is what it did (`accept`, `block`, `reject`), and the
    /// event's `question` says what was asked and answered: how many holders and flagged
    /// members the person saw, and how many flagged members they set apart as a different
    /// kind. `set_apart_members` names those (`path#symbol`, hashed on export), and
    /// `kept_flagged_members` the entry points under an auth or validation rule they did
    /// not confirm, which stay flagged. The flags a person did not set apart are the
    /// maintainer's "these are the same kind": flag precision as maintainers judge it.
    pub fn answered(
        &mut self,
        before: &Before,
        c: &Convention,
        q: &drift_mine::calibrate::Question,
        answer: &str,
        decision: &str,
        diff: Option<&drift_mine::calibrate::Different>,
    ) {
        if !self.on {
            return;
        }
        self.decision(decision, before, c, None, None);
        let Some(Value::Object(m)) = self.events.last_mut() else {
            return;
        };
        let (covered, kept, files, confirmed) = match diff {
            Some(d) => (
                d.covered.clone(),
                d.kept.clone(),
                d.files.len(),
                d.files.iter().map(|(_, e)| e.len()).sum::<usize>(),
            ),
            None => (Vec::new(), Vec::new(), 0, 0),
        };
        m.insert(
            "question".into(),
            json!({
                "v": QUESTION_VERSION,
                "answer": answer,
                "auth_or_validation": q.auth_or_validation,
                "holders_shown": q.holders.len(),
                "flagged": q.flagged_total,
                "flagged_files": q.flagged.len(),
                "set_apart": covered.len(),
                "set_apart_files": files,
                "entry_confirmed": confirmed,
                "kept_flagged": kept.len(),
                "needs_confirmation": q
                    .flagged
                    .iter()
                    .flat_map(|f| &f.members)
                    .filter(|f| f.needs_confirmation)
                    .count(),
            }),
        );
        if !covered.is_empty() {
            m.insert("set_apart_members".into(), json!(covered));
        }
        if !kept.is_empty() {
            m.insert("kept_flagged_members".into(), json!(kept));
        }
    }

    /// Mark the event just recorded as about a card mining withheld (`drift review
    /// --hidden`): why it was withheld, its family in the show table, and whether this
    /// event promoted it (accepted it into the policy). The study counts promotions per
    /// family from these.
    pub fn mark_hidden(&mut self, w: &drift_mine::mine::WithheldCard, promoted: bool) {
        if !self.on {
            return;
        }
        if let Some(Value::Object(m)) = self.events.last_mut() {
            m.insert(
                "hidden".into(),
                json!({
                    "reason": w.reason.code(),
                    "show_family": drift_mine::show::family_name(&w.candidate.rule),
                    "promoted": promoted,
                }),
            );
        }
    }

    /// How many events this run recorded so far.
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// Append this run's events. A log that cannot be written is said on stderr; the
    /// decisions themselves are already saved.
    pub fn flush(self) {
        if !self.on || self.events.is_empty() {
            return;
        }
        let mut text = String::new();
        for e in &self.events {
            text.push_str(&e.to_string());
            text.push('\n');
        }
        if let Err(e) = append(&self.root, text.as_bytes(), MAX_LOG_BYTES) {
            eprintln!("drift: the review log was not written: {e:#}");
        }
    }
}

fn agents_json(d: &Decision) -> Value {
    json!({
        "shown": d.shown,
        "reason": d.reason,
        "family": d.family,
        "accepted": d.accepted,
        "n": d.n,
    })
}

fn state_name(s: State) -> &'static str {
    match s {
        State::Passed => "passed",
        State::NotPassed => "not_passed",
        State::Stale => "stale",
        State::Unverified => "unverified",
    }
}

fn round4(x: f64) -> f64 {
    (x * 10_000.0).round() / 10_000.0
}

/// Now, as `2026-11-07T12:34:56Z`.
fn now_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    utc(secs)
}

/// `secs` since the epoch as an RFC 3339 UTC time (civil from days, H. Hinnant).
pub(crate) fn utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

// ---------- the files ----------

/// `root/.drift/review-log`, refusing a symbolic link on the way (a repository can commit
/// `.drift -> ~`): the log is never written through one. Created (with its `.gitignore`)
/// when `create`.
fn log_dir(root: &Path, create: bool) -> anyhow::Result<PathBuf> {
    let dir = root.join(DIR);
    for p in [root.join(".drift"), dir.clone()] {
        if std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
            bail!(
                "{} is a symbolic link: the review log is never written through one",
                p.display()
            );
        }
    }
    if create {
        std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        // `create_new` never follows a link and never overwrites what is there.
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(".gitignore"))
        {
            let _ = f.write_all(
                b"# Created by drift: the review log is local and never leaves this machine.\n*\n",
            );
        }
    }
    Ok(dir)
}

/// Open `path` without following a link at it (`O_NOFOLLOW`; elsewhere a link is refused
/// first), refusing anything but a regular file (a FIFO is opened non-blocking, so it
/// cannot hang the open).
fn open_no_follow(path: &Path, opts: &mut std::fs::OpenOptions) -> anyhow::Result<std::fs::File> {
    if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        bail!("{} is a symbolic link: refused", path.display());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let f = opts
        .open(path)
        .with_context(|| format!("opening {}", path.display()))?;
    if !f.metadata()?.is_file() {
        bail!("{} is not a regular file: refused", path.display());
    }
    Ok(f)
}

/// An exclusive (or shared) lock on the log, held until the file is dropped.
fn lock(dir: &Path, exclusive: bool) -> anyhow::Result<std::fs::File> {
    let f = open_no_follow(
        &dir.join(LOCK),
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true),
    )?;
    if exclusive {
        f.lock()?;
    } else {
        f.lock_shared()?;
    }
    Ok(f)
}

/// Append `bytes` (whole lines) to the log at `root`, under the lock: first rotated into
/// the older file when it would pass `max`; the salt made on the first write.
pub(crate) fn append(root: &Path, bytes: &[u8], max: u64) -> anyhow::Result<()> {
    let dir = log_dir(root, true)?;
    let _lock = lock(&dir, true)?;
    salt_in(&dir, true)?;
    let log = dir.join(LOG);
    let len = match std::fs::symlink_metadata(&log) {
        Ok(m) if m.file_type().is_symlink() => {
            bail!("{} is a symbolic link: refused", log.display())
        }
        Ok(m) => m.len(),
        Err(_) => 0,
    };
    if len > 0 && len + bytes.len() as u64 > max {
        // `rename` replaces the older file (a link there too) without following it.
        std::fs::rename(&log, dir.join(OLD)).context("rotating the review log")?;
    }
    let mut f = open_no_follow(&log, std::fs::OpenOptions::new().append(true).create(true))?;
    f.write_all(bytes)
        .with_context(|| format!("writing {}", log.display()))?;
    Ok(())
}

/// The repository's salt (32 random bytes, hex), made when `create` and missing.
fn salt_in(dir: &Path, create: bool) -> anyhow::Result<Option<[u8; 32]>> {
    let p = dir.join(SALT);
    if let Ok(mut f) = open_no_follow(&p, std::fs::OpenOptions::new().read(true)) {
        let mut text = String::new();
        (&mut f).take(256).read_to_string(&mut text)?;
        return parse_salt(text.trim())
            .map(Some)
            .with_context(|| format!("{} is not a salt Drift wrote", p.display()));
    }
    if !create {
        return Ok(None);
    }
    let mut salt = [0u8; 32];
    getrandom::fill(&mut salt).map_err(|e| anyhow::anyhow!("no random salt: {e}"))?;
    let hex: String = salt.iter().map(|b| format!("{b:02x}")).collect();
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&p)
        .with_context(|| format!("creating {}", p.display()))?;
    f.write_all(format!("{hex}\n").as_bytes())?;
    Ok(Some(salt))
}

fn parse_salt(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

/// The log's events, oldest first (the older file, then the current one), and how many
/// lines could not be read (a line cut short by a full disk, a hand edit).
fn read_events(dir: &Path) -> anyhow::Result<(Vec<Map<String, Value>>, usize)> {
    let mut events = Vec::new();
    let mut skipped = 0;
    for name in [OLD, LOG] {
        let p = dir.join(name);
        let Ok(mut f) = open_no_follow(&p, std::fs::OpenOptions::new().read(true)) else {
            continue;
        };
        let mut text = String::new();
        (&mut f)
            .take(2 * MAX_LOG_BYTES)
            .read_to_string(&mut text)
            .with_context(|| format!("reading {}", p.display()))?;
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            match serde_json::from_str::<Value>(line) {
                Ok(Value::Object(m)) => events.push(m),
                _ => skipped += 1,
            }
        }
    }
    Ok((events, skipped))
}

/// A keyed hash of `text` (blake3 keyed with the repository's salt), 16 hex digits.
fn hashed(salt: &[u8; 32], what: &str, text: &str) -> String {
    let mut h = blake3::Hasher::new_keyed(salt);
    h.update(what.as_bytes());
    h.update(&[0]);
    h.update(text.as_bytes());
    let hex = h.finalize().to_hex();
    format!("h:{}", &hex[..16])
}

/// The study file of the log at `root`: every event, with ids, members and examples
/// hashed and reasons replaced by their length unless `include_paths`.
pub fn export(root: &Path, include_paths: bool) -> anyhow::Result<Value> {
    let dir = log_dir(root, false)?;
    let none = || {
        anyhow::anyhow!(
            "no review log in {DIR}: turn it on with `drift review --set-log on` (or pass --log), review, then export"
        )
    };
    if !dir.is_dir() {
        return Err(none());
    }
    let _lock = lock(&dir, false)?;
    let salt = salt_in(&dir, false)?.ok_or_else(none)?;
    let (events, skipped) = read_events(&dir)?;
    if events.is_empty() && skipped == 0 {
        return Err(none());
    }
    let events: Vec<Value> = events
        .into_iter()
        .map(|e| Value::Object(export_event(e, &salt, include_paths)))
        .collect();
    Ok(json!({
        "schema": EXPORT_SCHEMA,
        "schema_version": EXPORT_VERSION,
        "exported_at": now_utc(),
        // The same for every export of this repository, unrelated to anything about it:
        // lets the study count repositories without knowing which they are.
        "repo": hashed(&salt, "repo", ""),
        "include_paths": include_paths,
        "drift": {
            "version": env!("CARGO_PKG_VERSION"),
            "commit": option_env!("DRIFT_BUILD_COMMIT"),
        },
        "skipped_lines": skipped,
        "events": events,
    }))
}

/// Fields an exported event keeps as they are: none of them names a path or symbol.
const KEPT: &[&str] = &[
    "v",
    "ts",
    "event",
    "decision",
    "via",
    "rule_kind",
    "family",
    "tier",
    "language",
    "evidence",
    "rank",
    "listed",
    "agents",
    "verify",
    "status",
    "before",
    "after",
    "block",
    "outliers_now",
    "question",
    "hidden",
    "drift",
];

/// Fields of an exported event that list members (`path#symbol`): each hashed as a
/// `member` is, so they join with the exceptions' members, unless `include_paths`.
const MEMBER_LISTS: &[&str] = &["set_apart_members", "kept_flagged_members"];

fn export_event(e: Map<String, Value>, salt: &[u8; 32], include_paths: bool) -> Map<String, Value> {
    let mut out = Map::new();
    for (k, v) in e {
        if KEPT.contains(&k.as_str()) {
            out.insert(k, v);
            continue;
        }
        if MEMBER_LISTS.contains(&k.as_str()) {
            let list: Vec<Value> = v
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|m| {
                            let m = m.as_str().unwrap_or_default();
                            if include_paths {
                                json!(m)
                            } else {
                                json!(hashed(salt, "member", m))
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            out.insert(k, Value::Array(list));
            continue;
        }
        let text = v.as_str().unwrap_or_default().to_string();
        match k.as_str() {
            _ if include_paths && ["id", "member", "example", "reason"].contains(&k.as_str()) => {
                out.insert(k, v);
            }
            "id" | "member" | "example" => {
                out.insert(k.clone(), json!(hashed(salt, &k, &text)));
            }
            "reason" => {
                out.insert("reason_chars".into(), json!(text.chars().count()));
            }
            // Anything else (a newer Drift's field, a hand edit) is left out.
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_dates() {
        assert_eq!(utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc(1_793_965_296), "2026-11-06T11:41:36Z");
    }

    #[test]
    fn rotates_at_the_cap_and_keeps_one_older_file() {
        let dir = tempfile::tempdir().unwrap();
        let line = |i: usize| format!("{{\"n\":{i}}}\n");
        for i in 0..30 {
            append(dir.path(), line(i).as_bytes(), 64).unwrap();
        }
        let d = dir.path().join(DIR);
        let cur = std::fs::read_to_string(d.join(LOG)).unwrap();
        let old = std::fs::read_to_string(d.join(OLD)).unwrap();
        assert!(cur.len() <= 64 && old.len() <= 64, "{cur:?} {old:?}");
        assert!(cur.ends_with(&line(29)), "{cur}");
        let (events, skipped) = read_events(&d).unwrap();
        assert_eq!(skipped, 0);
        let ns: Vec<u64> = events.iter().map(|e| e["n"].as_u64().unwrap()).collect();
        assert!(ns.windows(2).all(|w| w[1] == w[0] + 1), "{ns:?}");
        assert_eq!(*ns.last().unwrap(), 29);
        assert!(
            std::fs::read_to_string(d.join(".gitignore"))
                .unwrap()
                .contains("\n*\n")
        );
        assert!(parse_salt(std::fs::read_to_string(d.join(SALT)).unwrap().trim()).is_some());
    }

    /// Writers in parallel (threads here; processes in tests/review_log.rs), rotating
    /// often: every line whole, none lost.
    #[test]
    fn concurrent_appends_never_tear_or_lose_a_line() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let threads: Vec<_> = (0..8)
            .map(|t| {
                let root = root.clone();
                std::thread::spawn(move || {
                    for i in 0..50 {
                        let pad = "x".repeat(200);
                        let l = format!("{{\"t\":{t},\"i\":{i},\"pad\":\"{pad}\"}}\n");
                        append(&root, l.as_bytes(), 1 << 20).unwrap();
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        let (events, skipped) = read_events(&root.join(DIR)).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(events.len(), 400);
    }

    #[cfg(unix)]
    #[test]
    fn never_writes_through_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".drift")).unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join(DIR)).unwrap();
        assert!(append(dir.path(), b"{}\n", 1024).is_err());
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
        // A link at the log file itself.
        let dir = tempfile::tempdir().unwrap();
        append(dir.path(), b"{}\n", 1024).unwrap();
        let victim = outside.path().join("victim");
        std::fs::write(&victim, "keep").unwrap();
        let log = dir.path().join(DIR).join(LOG);
        std::fs::remove_file(&log).unwrap();
        std::os::unix::fs::symlink(&victim, &log).unwrap();
        assert!(append(dir.path(), b"{}\n", 1024).is_err());
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep");
    }

    #[test]
    fn export_hashes_what_names_code_unless_asked() {
        let dir = tempfile::tempdir().unwrap();
        let e = json!({
            "v": 1, "event": "decision", "decision": "exempt", "id": "D-abcdef",
            "member": "app/api/ping/route.ts#GET", "reason": "health check",
            "example": "app/a/route.ts#GET", "family": "Call wrappers", "secret_new_field": "x"
        });
        append(dir.path(), format!("{e}\n").as_bytes(), MAX_LOG_BYTES).unwrap();
        let out = export(dir.path(), false).unwrap().to_string();
        for raw in [
            "D-abcdef",
            "app/",
            "GET",
            "health check",
            "secret_new_field",
        ] {
            assert!(!out.contains(raw), "{raw} in {out}");
        }
        assert!(out.contains("\"reason_chars\":12"), "{out}");
        assert!(out.contains("Call wrappers"), "{out}");
        let raw = export(dir.path(), true).unwrap().to_string();
        assert!(raw.contains("app/api/ping/route.ts#GET") && raw.contains("health check"));
        // Another repository's salt: its hashes differ.
        let other = tempfile::tempdir().unwrap();
        append(other.path(), format!("{e}\n").as_bytes(), MAX_LOG_BYTES).unwrap();
        let a = export(dir.path(), false).unwrap();
        let b = export(other.path(), false).unwrap();
        assert_ne!(a["events"][0]["id"], b["events"][0]["id"]);
        assert_ne!(a["repo"], b["repo"]);
        assert_eq!(a["repo"], export(dir.path(), false).unwrap()["repo"]);
    }
}
