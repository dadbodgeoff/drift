//! The agent verifier: an optional second admission source for suggestion-tier
//! conventions (eval/study/PLAN-PAR.md, workstream E and decision D10.3). EXPERIMENTAL and
//! unvalidated: off by default (`agents.verify: off` in `.drift/conventions.yaml`).
//!
//! Drift makes no network or model call. The host agent does: the MCP tool
//! `drift_verify_card` hands it a card's verification [`Payload`] (the card, three holder
//! excerpts and up to five outlier excerpts of about 18 lines, built as the R6 prototype
//! built them, with the frozen prompt v3), the agent runs that prompt three times and
//! sends the three JSON replies back, and Drift decides with R6's frozen rule
//! ([`decide`]): a sample passes when `intended` is true and its outlier verdicts count
//! more violations than exceptions (or count neither); the card passes when 2 of the 3
//! samples do. `show` and `confidence` are not read (R6 froze the rule without them).
//!
//! The verdict is cached in [`CACHE_FILE`], keyed by convention id and the payload's
//! content hash ([`Payload::content_hash`]: the prompt and every byte of the message, so
//! a changed rule, evidence, outlier list or excerpt makes it stale). A stale entry is
//! ignored; the card is then not verified until the agent verifies it again.
//!
//! With `agents.verify: on`, a suggestion is shown to agents when the family table admits
//! it **or** a fresh cached verdict passes ([`WithVerifier`]). [STRICT] The default tier
//! never reaches the verifier ([`crate::admission::decide_card`]), nor does any
//! convention that is not an accepted suggestion, nor a wiring rule ([`eligible`]).
//! R6 found the verifier would hide 19 of 30 accepted default-tier security rules.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use drift_core::RepoFacts;
use drift_core::ingest::Lang;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::admission::{Admission, Decision, Reason};
use crate::check::{Scope, check};
use crate::context::RepoContext;
use crate::mine::{MIN_BLOCK_ROLE_SIZE, Rule};
use crate::policy::{Convention, ConventionsFile, Lock, Status, Switch};
use crate::roles::units;
use crate::tier::Tier;

/// Where verdicts are cached, relative to the repository root.
pub const CACHE_FILE: &str = ".drift/verify-cache.json";
/// The frozen R6 prompt (`eval/study/research/2026-11-07/r6-verifier-prompt-v3.txt`,
/// sha256 8298c26d…). Never edited: a new prompt is a new version and a new D10.3 check.
pub const PROMPT: &str = include_str!("../data/verifier-prompt-v3.txt");
pub const PROMPT_VERSION: &str = "v3";
/// Samples the host agent runs, and the majority that passes a card (2 of 3).
pub const SAMPLES: usize = 3;
const CACHE_SCHEMA: u32 = 1;
/// Outliers listed on the card, and excerpted (R6: 30 and 5).
const CARD_OUTLIERS: usize = 30;
const CARD_EXEMPT: usize = 10;
const EXCERPT_OUTLIERS: usize = 5;
const EXCERPT_HOLDERS: usize = 3;
/// Excerpt window around the member's line, and the longest line kept (R6).
const BEFORE: usize = 3;
const AFTER: usize = 15;
const LINE_CAP: usize = 160;
/// Largest source file read for an excerpt, and largest cache read.
const MAX_SOURCE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 16 * 1024 * 1024;

/// One outlier verdict of a sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutlierVerdict {
    Violation,
    Exception,
    Ignore,
}

/// One sample: the prompt's JSON reply.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    pub intended: bool,
    pub outliers: Vec<OutlierVerdict>,
    /// Read by people only: the frozen rule decides from `intended` and `outliers`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why: Option<String>,
}

impl Sample {
    /// R6's mechanical rule for one sample: intended, and violations outnumber exceptions
    /// among the outlier verdicts (or neither was counted).
    pub fn passes(&self) -> bool {
        let count = |w| self.outliers.iter().filter(|o| **o == w).count();
        let (v, e) = (
            count(OutlierVerdict::Violation),
            count(OutlierVerdict::Exception),
        );
        self.intended && (v + e == 0 || v > e)
    }

    /// A sample as the host agent sends it: the reply's JSON object, or the reply's text
    /// holding one (from its first `{` to its last `}`, as R6 read replies). Anything
    /// else, a missing or mistyped `intended` or `outliers`, or an outlier verdict other
    /// than `violation`, `exception` or `ignore`, is an error: nothing is cached.
    pub fn parse(v: &Value) -> anyhow::Result<Self> {
        let obj = match v {
            Value::Object(_) => v.clone(),
            Value::String(s) => {
                let (Some(a), Some(b)) = (s.find('{'), s.rfind('}')) else {
                    anyhow::bail!("a verdict is not a JSON object");
                };
                anyhow::ensure!(a < b, "a verdict is not a JSON object");
                serde_json::from_str(&s[a..=b])
                    .map_err(|e| anyhow::anyhow!("a verdict is not valid JSON ({e})"))?
            }
            _ => anyhow::bail!("a verdict must be the reply's JSON object (or its text)"),
        };
        anyhow::ensure!(
            obj.get("intended").is_some_and(Value::is_boolean),
            "a verdict has no boolean `intended`"
        );
        anyhow::ensure!(
            obj.get("outliers").is_some_and(Value::is_array),
            "a verdict has no `outliers` list"
        );
        let mut s: Sample = serde_json::from_value(obj).map_err(|e| {
            anyhow::anyhow!(
                "a verdict does not match the prompt's reply shape ({e}): `outliers` holds only \"violation\", \"exception\" or \"ignore\""
            )
        })?;
        if let Some(w) = &mut s.why {
            *w = w.chars().take(400).collect();
        }
        Ok(s)
    }
}

/// The card's verdict from its samples ([`decide`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Outcome {
    /// Samples that pass ([`Sample::passes`]).
    pub passes: usize,
    pub samples: usize,
    /// At least 2 of the 3.
    pub pass: bool,
}

/// R6's frozen decision: exactly [`SAMPLES`] samples, and the card passes when a strict
/// majority of them passes (2 of 3).
pub fn decide(samples: &[Sample]) -> anyhow::Result<Outcome> {
    anyhow::ensure!(
        samples.len() == SAMPLES,
        "expected {SAMPLES} verdicts (one per sample), got {}",
        samples.len()
    );
    let passes = samples.iter().filter(|s| s.passes()).count();
    Ok(Outcome {
        passes,
        samples: samples.len(),
        pass: passes * 2 > samples.len(),
    })
}

/// [`CACHE_FILE`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Cache {
    pub schema: u32,
    /// Convention id -> its latest verdict.
    pub entries: BTreeMap<String, Entry>,
}

/// One cached verdict.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    /// [`Payload::content_hash`] of the card that was verified.
    pub content_hash: String,
    pub prompt: String,
    pub verdicts: Vec<Sample>,
    /// Recorded for people; [`Cache::fresh`] recomputes it from `verdicts`.
    pub passes: usize,
    pub pass: bool,
    /// Seconds since the Unix epoch.
    pub at: u64,
}

impl Cache {
    /// The cache at `root`; empty when there is none, or when it cannot be read or parsed
    /// (then nothing is verified).
    pub fn load(root: &Path) -> Self {
        drift_core::fsutil::read_regular_to_string(&root.join(CACHE_FILE), MAX_CACHE_BYTES)
            .ok()
            .and_then(|t| serde_json::from_str::<Cache>(&t).ok())
            .filter(|c| c.schema == CACHE_SCHEMA)
            .unwrap_or_default()
    }

    pub fn save(&self, root: &Path) -> anyhow::Result<()> {
        let mut text = serde_json::to_string_pretty(self)?;
        text.push('\n');
        crate::policy::write_no_follow(root, Path::new(CACHE_FILE), text.as_bytes())
    }

    /// Record the verdict for `id`'s card `content_hash`, replacing any earlier one.
    pub fn record(
        &mut self,
        id: &str,
        content_hash: &str,
        verdicts: Vec<Sample>,
        at: u64,
    ) -> anyhow::Result<Outcome> {
        let o = decide(&verdicts)?;
        self.schema = CACHE_SCHEMA;
        self.entries.insert(
            id.to_string(),
            Entry {
                content_hash: content_hash.to_string(),
                prompt: PROMPT_VERSION.to_string(),
                verdicts,
                passes: o.passes,
                pass: o.pass,
                at,
            },
        );
        Ok(o)
    }

    /// The verdict for `id`'s card as it is now (`content_hash`): `None` when there is none,
    /// it was for another card content or prompt (stale), or its verdicts are not 3 valid
    /// samples. The outcome is recomputed from the verdicts, never read from `pass`.
    pub fn fresh(&self, id: &str, content_hash: &str) -> Option<Outcome> {
        let e = self.entries.get(id)?;
        if e.content_hash != content_hash || e.prompt != PROMPT_VERSION {
            return None;
        }
        decide(&e.verdicts).ok()
    }
}

/// Why `c` cannot be verified, or `None` when it can: only accepted suggestion-tier
/// conventions that are not wiring rules [STRICT].
pub fn ineligible(c: &Convention) -> Option<&'static str> {
    if c.tier() == Tier::Default {
        Some(
            "it is in the default tier, which reaches agents once a person accepts it and is never verified",
        )
    } else if c.status != Status::Accepted {
        Some("only accepted conventions are checked, so only they can be verified")
    } else if c.rule.is_wiring() {
        Some("experimental wiring rules are not verified")
    } else if c.rule.is_practice() {
        Some(
            "a promoted practice is checked by the classifier that draws the practice map, not from a role's members, and is not verified",
        )
    } else {
        None
    }
}

/// [`ineligible`] is `None`.
pub fn eligible(c: &Convention) -> bool {
    ineligible(c).is_none()
}

/// A member whose code is excerpted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Member {
    pub path: String,
    pub symbol: String,
    pub line: u32,
}

/// What `drift_verify_card` gives the host agent for one card.
#[derive(Debug, Clone, Serialize)]
pub struct Payload {
    pub id: String,
    pub prompt_version: &'static str,
    /// blake3 of the prompt and the message: what a cached verdict is keyed by.
    pub content_hash: String,
    pub samples: usize,
    /// The frozen prompt v3: the system prompt of each sample.
    pub system_prompt: &'static str,
    /// The user turn of each sample: the card and its excerpts.
    pub message: String,
    /// The rule statement (the card's summary).
    pub rule: String,
    /// The members excerpted in `message`: the example first.
    pub holders: Vec<Member>,
    pub outliers: Vec<Member>,
    /// Every legacy outlier of the card (the card lists at most 30; 5 are excerpted).
    pub outliers_total: usize,
}

/// The content hash of a payload's message under the frozen prompt.
pub fn content_hash(message: &str) -> String {
    let mut h = blake3::Hasher::new();
    h.update(b"drift-verify\0");
    h.update(PROMPT_VERSION.as_bytes());
    h.update(b"\0");
    h.update(PROMPT.as_bytes());
    h.update(b"\0");
    h.update(message.as_bytes());
    h.finalize().to_hex().to_string()
}

/// The payloads of the conventions `ids` of `policy` (those [`eligible`]), from the
/// repository's facts as they are now and the files under `root`. One check of the whole
/// repository finds each card's outliers and exempt members, as `drift check` does.
///
/// The outliers are the card's legacy outliers: its current violations that `lock`
/// baselines (people baseline them when they accept a convention). A new violation is
/// what the convention then checks, not part of the card, so it does not make a verified
/// card stale and hide it from the agent that broke it. Any other change to the card
/// (rule, summary, evidence, example, exempt members, a legacy outlier fixed) or to an
/// excerpted line does.
pub fn payloads(
    root: &Path,
    repo: &RepoFacts,
    policy: &ConventionsFile,
    lock: &Lock,
    ids: &BTreeSet<&str>,
) -> BTreeMap<String, Payload> {
    let wanted: Vec<&Convention> = policy
        .conventions
        .iter()
        .filter(|c| ids.contains(c.id.as_str()) && eligible(c))
        .collect();
    if wanted.is_empty() {
        return BTreeMap::new();
    }
    let report = check(repo, policy, lock, Scope::Accepted, None);
    let all = units(repo, &policy.file_kinds);
    let ctx = RepoContext::new(repo, &all);
    // The directory's own name, however `root` is spelled (`.`, a relative path).
    let repo_name = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf())
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut files = Files::new(root);
    let mut out = BTreeMap::new();
    for c in wanted {
        let mut outliers: Vec<Member> = report
            .violations
            .iter()
            .filter(|v| v.id == c.id && v.baselined)
            .map(|v| Member {
                path: v.path.clone(),
                symbol: v.symbol.clone(),
                line: v.line,
            })
            .collect();
        outliers.sort_by(|a, b| (&a.path, a.line, &a.symbol).cmp(&(&b.path, b.line, &b.symbol)));
        outliers.dedup();
        let exempt: Vec<_> = report.exempt.iter().filter(|e| e.id == c.id).collect();
        let not_holders: BTreeSet<(&str, &str)> = outliers
            .iter()
            .map(|o| (o.path.as_str(), o.symbol.as_str()))
            .chain(exempt.iter().map(|e| (e.path.as_str(), e.symbol.as_str())))
            .collect();
        let mut example: Option<Member> = None;
        let mut holders: Vec<Member> = Vec::new();
        // A merged card's members are read in the part they are members of.
        let parts = c.role.parts();
        for u in &all {
            let Some(role) = parts
                .iter()
                .find(|p| u.in_convention_role(p, c.selector_version))
            else {
                continue;
            };
            let (path, name) = (u.path(), u.name().to_string());
            if not_holders.contains(&(path.as_str(), name.as_str()))
                || !c.rule.applies_in(Some(role), &u.view, &ctx)
                || !c.rule.holds_in(Some(role), &u.view, &ctx)
            {
                continue;
            }
            let m = Member {
                line: u.line(),
                symbol: name,
                path,
            };
            if example.is_none() && format!("{}#{}", m.path, m.symbol) == c.example {
                example = Some(m);
            } else {
                holders.push(m);
            }
        }
        let example = example.unwrap_or_else(|| {
            let (path, symbol) = c.example.split_once('#').unwrap_or((&c.example, ""));
            Member {
                path: path.to_string(),
                symbol: symbol.to_string(),
                line: 1,
            }
        });
        let picked = pick_holders(&c.id, &example, holders, &outliers);
        let shown = spread(outliers.len(), EXCERPT_OUTLIERS);

        let mut parts: Vec<String> = Vec::new();
        parts.push(fenced(
            &format!(
                "### Holder 1 (the example): {}#{}",
                example.path, example.symbol
            ),
            &files.excerpt(&example.path, example.line),
        ));
        for (i, h) in picked.iter().enumerate() {
            parts.push(fenced(
                &format!(
                    "### Holder {}: {} (another member that follows the rule)",
                    i + 2,
                    h.path
                ),
                &files.excerpt(&h.path, h.line),
            ));
        }
        for (j, &oi) in shown.iter().enumerate() {
            let o = &outliers[oi];
            parts.push(fenced(
                &format!("### Outlier {}: {}:{} {}", j + 1, o.path, o.line, o.symbol),
                &files.excerpt(&o.path, o.line),
            ));
        }
        if outliers.is_empty() {
            parts.push("### Outliers: none (every member follows the rule)".to_string());
        }
        let message = format!(
            "Repository: {repo_name}\n\n## The card (as the tool prints it)\n```text\n{}\n```\n\n## Code excerpts\n{}",
            card_block(c, &outliers, &exempt),
            parts.join("\n\n")
        );
        let mut holders = vec![example];
        holders.extend(picked);
        out.insert(
            c.id.clone(),
            Payload {
                id: c.id.clone(),
                prompt_version: PROMPT_VERSION,
                content_hash: content_hash(&message),
                samples: SAMPLES,
                system_prompt: PROMPT,
                rule: c.summary.clone(),
                holders,
                outliers: shown.iter().map(|&i| outliers[i].clone()).collect(),
                outliers_total: outliers.len(),
                message,
            },
        );
    }
    out
}

/// Two more holders after the example, one per file, in an order fixed by the card's id
/// (R6: a hash of the card and the path): first from files with no outlier, then any other.
pub(crate) fn pick_holders(
    id: &str,
    example: &Member,
    holders: Vec<Member>,
    outliers: &[Member],
) -> Vec<Member> {
    let outlier_files: BTreeSet<&str> = outliers.iter().map(|o| o.path.as_str()).collect();
    let mut by_file: BTreeMap<String, Member> = BTreeMap::new();
    for h in holders {
        if h.path == example.path {
            continue;
        }
        by_file.entry(h.path.clone()).or_insert(h);
    }
    let key = |m: &Member| {
        blake3::hash(format!("{id}{}", m.path).as_bytes())
            .to_hex()
            .to_string()
    };
    let mut files: Vec<Member> = by_file.into_values().collect();
    files.sort_by_cached_key(|m| (outlier_files.contains(m.path.as_str()), key(m)));
    files.truncate(EXCERPT_HOLDERS - 1);
    files
}

/// The indices of `k` of `n` items spread evenly, first and last included, as R6 chose
/// outliers (Python's `round`, half to even, on `j * (n - 1) / (k - 1)`).
fn spread(n: usize, k: usize) -> Vec<usize> {
    let k = k.min(n);
    let den = k.saturating_sub(1).max(1);
    let mut out: Vec<usize> = (0..k)
        .map(|j| {
            let num = j * n.saturating_sub(1);
            let (q, r) = (num / den, num % den);
            if 2 * r > den || (2 * r == den && q % 2 == 1) {
                q + 1
            } else {
                q
            }
        })
        .collect();
    out.dedup();
    out
}

/// The card as `drift census` prints a proposal (without its rank, tier and agents lines),
/// as R6 showed it: at most 30 outliers and 10 exempt members.
fn card_block(c: &Convention, outliers: &[Member], exempt: &[&crate::check::Exemption]) -> String {
    let e = &c.evidence;
    let mut s = format!(
        "[{}] {}\n    evidence: {}/{} (lower bound {:.2}, lift {:.1}){}",
        c.id,
        c.summary,
        e.holders,
        e.total,
        e.lower_bound,
        e.lift,
        if e.role_size() >= MIN_BLOCK_ROLE_SIZE {
            ""
        } else {
            "  [advise only: small role]"
        }
    );
    if !e.split.is_empty() {
        let parts: Vec<String> = e
            .split
            .iter()
            .map(|(w, n)| format!("{} {n}", w.rsplit('#').next().unwrap_or(w)))
            .collect();
        s.push_str(&format!("\n    split:    {}", parts.join(", ")));
    }
    s.push_str(&format!("\n    example:  {}", c.example));
    for o in outliers.iter().take(CARD_OUTLIERS) {
        s.push_str(&format!(
            "\n    outlier:  {}:{} {}",
            o.path, o.line, o.symbol
        ));
    }
    if outliers.len() > CARD_OUTLIERS {
        s.push_str(&format!(
            "\n    … and {} more outliers",
            outliers.len() - CARD_OUTLIERS
        ));
    }
    for x in exempt.iter().take(CARD_EXEMPT) {
        s.push_str(&format!(
            "\n    exempt:   {}:{} {} ({})",
            x.path, x.line, x.symbol, x.reason
        ));
    }
    if exempt.len() > CARD_EXEMPT {
        s.push_str(&format!(
            "\n    … and {} more exempt",
            exempt.len() - CARD_EXEMPT
        ));
    }
    s
}

fn fenced(head: &str, body: &str) -> String {
    format!("```text\n{head}\n{body}\n```")
}

/// Source files read once each.
struct Files<'r> {
    root: &'r Path,
    read: BTreeMap<String, Option<Vec<String>>>,
}

impl<'r> Files<'r> {
    fn new(root: &'r Path) -> Self {
        Self {
            root,
            read: BTreeMap::new(),
        }
    }

    /// Lines `line - 3` to `line + 15` of `rel`, numbered and capped at 160 characters
    /// each, as R6 excerpted them.
    fn excerpt(&mut self, rel: &str, line: u32) -> String {
        let root = self.root;
        let lines = self.read.entry(rel.to_string()).or_insert_with(|| {
            drift_core::fsutil::read_regular(&root.join(rel), MAX_SOURCE_BYTES)
                .ok()
                .map(|b| {
                    String::from_utf8_lossy(&b)
                        .split('\n')
                        .map(String::from)
                        .collect()
                })
        });
        let Some(lines) = lines else {
            return "(file not readable)".to_string();
        };
        let ln = (line as usize).max(1);
        let lo = ln.saturating_sub(BEFORE).max(1);
        let hi = lines.len().min(ln + AFTER);
        (lo..=hi)
            .map(|i| {
                let t = &lines[i - 1];
                let t = if t.chars().count() > LINE_CAP {
                    format!("{} …", t.chars().take(LINE_CAP).collect::<String>())
                } else {
                    t.clone()
                };
                format!("{i:>5}  {t}")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Where an eligible suggestion stands with the verifier, for people and agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// A fresh cached verdict passes.
    Passed,
    /// A fresh cached verdict does not pass.
    NotPassed,
    /// A cached verdict is for another content of the card: ignored.
    Stale,
    /// No cached verdict.
    Unverified,
}

/// [`State`] with the counts of a fresh verdict: `check --format json` `conventions[].verify`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VerifyStatus {
    pub state: State,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passes: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<usize>,
    /// `verified by agent (2/3)`, `not verified (agent verdict 1/3)`,
    /// `not verified (the card changed since it was verified)`, `not verified`.
    pub text: String,
}

/// The verifier's status of every [`eligible`] convention, or `None` when
/// `agents.verify` is off. `facts` is called (once) only when a cached verdict has to be
/// compared with its card as it is now; when it fails (or `drift.lock` cannot be read),
/// every cached verdict counts as stale.
pub fn statuses<R: std::borrow::Borrow<RepoFacts>>(
    root: &Path,
    policy: &ConventionsFile,
    facts: impl FnOnce() -> Option<R>,
) -> Option<BTreeMap<String, VerifyStatus>> {
    if policy.agents.verify != Switch::On {
        return None;
    }
    let cache = Cache::load(root);
    let elig: Vec<&Convention> = policy.conventions.iter().filter(|c| eligible(c)).collect();
    let cached: BTreeSet<&str> = elig
        .iter()
        .map(|c| c.id.as_str())
        .filter(|id| cache.entries.contains_key(*id))
        .collect();
    let built = if cached.is_empty() {
        BTreeMap::new()
    } else {
        facts()
            .zip(Lock::load(root).ok())
            .map(|(f, lock)| payloads(root, f.borrow(), policy, &lock, &cached))
            .unwrap_or_default()
    };
    Some(
        elig.into_iter()
            .map(|c| {
                let st = match (cache.entries.get(&c.id), built.get(&c.id)) {
                    (None, _) => status(State::Unverified, None),
                    (Some(_), Some(p)) => match cache.fresh(&c.id, &p.content_hash) {
                        Some(o) if o.pass => status(State::Passed, Some(o)),
                        Some(o) => status(State::NotPassed, Some(o)),
                        None => status(State::Stale, None),
                    },
                    (Some(_), None) => status(State::Stale, None),
                };
                (c.id.clone(), st)
            })
            .collect(),
    )
}

fn status(state: State, o: Option<Outcome>) -> VerifyStatus {
    let text = match (state, o) {
        (State::Passed, Some(o)) => format!("verified by agent ({}/{})", o.passes, o.samples),
        (State::NotPassed, Some(o)) => {
            format!("not verified (agent verdict {}/{})", o.passes, o.samples)
        }
        (State::Stale, _) => "not verified (the card changed since it was verified)".to_string(),
        _ => "not verified".to_string(),
    };
    VerifyStatus {
        state,
        passes: o.map(|o| o.passes),
        samples: o.map(|o| o.samples),
        text,
    }
}

/// What agents are told about `c` ([`crate::admission::convention_view`]), with the
/// verifier's `statuses` when `agents.verify` is on ([`statuses`]).
pub fn convention_view(
    c: &Convention,
    statuses: Option<&BTreeMap<String, VerifyStatus>>,
) -> Decision {
    match statuses {
        Some(statuses) => crate::admission::decide_convention(
            &WithVerifier {
                base: crate::admission::admission(),
                statuses,
            },
            c,
        ),
        None => crate::admission::convention_view(c),
    }
}

/// The family table (or any source) plus the verifier: a suggestion is shown when `base`
/// shows it, or when its card has a fresh passing verdict. Built only with
/// `agents.verify: on`; the default tier never reaches it ([`crate::admission::decide_card`]).
pub struct WithVerifier<'a> {
    pub base: &'a dyn Admission,
    pub statuses: &'a BTreeMap<String, VerifyStatus>,
}

impl Admission for WithVerifier<'_> {
    fn decide(&self, rule: &Rule, lang: Lang) -> Decision {
        self.base.decide(rule, lang)
    }

    fn decide_card(&self, id: &str, rule: &Rule, lang: Lang) -> Decision {
        let d = self.base.decide_card(id, rule, lang);
        if d.shown {
            return d;
        }
        match self.statuses.get(id) {
            Some(s) if s.state == State::Passed => Decision {
                shown: true,
                reason: Reason::Verified,
                source: format!(
                    "{CACHE_FILE} (agent verifier, prompt {PROMPT_VERSION}, 2 of {SAMPLES} samples)"
                ),
                text: format!("shown to agents ({})", s.text),
                ..d
            },
            _ => d,
        }
    }

    fn describe(&self) -> Value {
        serde_json::json!({
            "kind": "family_table_or_verifier",
            "family_table": self.base.describe(),
            "verifier": {
                "file": CACHE_FILE,
                "prompt": PROMPT_VERSION,
                "samples": SAMPLES,
                "experimental": true,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admission::{Missing, decide_card, decide_convention};
    use crate::mine::Evidence;
    use crate::policy::{AgentsSettings, Mode};
    use crate::roles::RoleSelector;
    use drift_core::{SymbolKind, WrapKind};
    use serde_json::json;

    fn sample(intended: bool, o: &[&str]) -> Sample {
        Sample::parse(&json!({"intended": intended, "outliers": o, "show": true, "confidence": 80}))
            .unwrap()
    }

    #[test]
    fn one_sample_passes_as_r6_froze_it() {
        // intended && (violations > exceptions, or none counted); `ignore` is not counted.
        assert!(sample(true, &[]).passes());
        assert!(sample(true, &["ignore", "ignore"]).passes());
        assert!(sample(true, &["violation", "exception", "violation"]).passes());
        assert!(!sample(true, &["violation", "exception"]).passes());
        assert!(!sample(true, &["exception", "ignore"]).passes());
        assert!(!sample(false, &[]).passes());
        assert!(!sample(false, &["violation"]).passes());
        // `show` and `confidence` are not read.
        let mut s = sample(true, &["violation"]);
        s.show = Some(false);
        s.confidence = Some(0.0);
        assert!(s.passes());
    }

    #[test]
    fn two_of_three_samples_pass_a_card() {
        let (y, n) = (sample(true, &["violation"]), sample(false, &["violation"]));
        let o = decide(&[y.clone(), y.clone(), n.clone()]).unwrap();
        assert_eq!((o.passes, o.samples, o.pass), (2, 3, true));
        let o = decide(&[y.clone(), n.clone(), n.clone()]).unwrap();
        assert_eq!((o.passes, o.pass), (1, false));
        assert!(decide(&[y.clone(), y.clone(), y.clone()]).unwrap().pass);
        assert!(!decide(&[n.clone(), n.clone(), n.clone()]).unwrap().pass);
        // Exactly three samples [STRICT]: two that pass are not a verdict.
        assert!(decide(&[y.clone(), y.clone()]).is_err());
        assert!(decide(&[y.clone(), y.clone(), y.clone(), n]).is_err());
    }

    #[test]
    fn verdicts_are_read_strictly() {
        // The reply's text is read from its first `{` to its last `}`.
        let s = Sample::parse(&json!("Sure:\n```json\n{\"intended\": true, \"outliers\": [\"violation\"], \"why\": \"x\"}\n```")).unwrap();
        assert!(s.passes());
        for bad in [
            json!({"outliers": []}),
            json!({"intended": "yes", "outliers": []}),
            json!({"intended": true}),
            json!({"intended": true, "outliers": ["maybe"]}),
            json!({"intended": true, "outliers": "violation"}),
            json!("no json here"),
            json!(3),
        ] {
            assert!(Sample::parse(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn outliers_are_spread_as_r6_chose_them() {
        assert_eq!(spread(0, 5), Vec::<usize>::new());
        assert_eq!(spread(1, 5), vec![0]);
        assert_eq!(spread(3, 5), vec![0, 1, 2]);
        // Python: sorted({round(j * 6 / 4) for j in range(5)}) == [0, 2, 3, 4, 6].
        assert_eq!(spread(7, 5), vec![0, 2, 3, 4, 6]);
        // sorted({round(j * 31 / 4) for j in range(5)}) == [0, 8, 16, 23, 31].
        assert_eq!(spread(32, 5), vec![0, 8, 16, 23, 31]);
    }

    #[test]
    fn a_cached_verdict_is_for_one_card_content() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".drift")).unwrap();
        let (y, n) = (sample(true, &["violation"]), sample(false, &[]));
        let mut c = Cache::default();
        let o = c
            .record("D-1", "h1", vec![y.clone(), n.clone(), y.clone()], 7)
            .unwrap();
        assert!(o.pass);
        c.save(dir.path()).unwrap();
        let c = Cache::load(dir.path());
        assert_eq!(c.fresh("D-1", "h1").map(|o| o.passes), Some(2));
        // Another content hash, another id, another prompt: stale or absent.
        assert_eq!(c.fresh("D-1", "h2"), None);
        assert_eq!(c.fresh("D-2", "h1"), None);
        let mut other = c.clone();
        other.entries.get_mut("D-1").unwrap().prompt = "v2".into();
        assert_eq!(other.fresh("D-1", "h1"), None);
        // An edited `pass` cannot pass a card: the outcome is recomputed from the verdicts.
        let mut edited = c.clone();
        let e = edited.entries.get_mut("D-1").unwrap();
        e.verdicts = vec![n.clone(), n.clone(), y.clone()];
        assert!(e.pass);
        assert_eq!(edited.fresh("D-1", "h1").map(|o| o.pass), Some(false));
        edited.entries.get_mut("D-1").unwrap().verdicts.pop();
        assert_eq!(edited.fresh("D-1", "h1"), None);
        // A cache that does not parse, or of another schema, holds nothing.
        std::fs::write(dir.path().join(CACHE_FILE), "{").unwrap();
        assert!(Cache::load(dir.path()).entries.is_empty());
        std::fs::write(dir.path().join(CACHE_FILE), r#"{"schema":2,"entries":{}}"#).unwrap();
        assert_eq!(Cache::load(dir.path()).schema, 0);
    }

    #[test]
    fn the_hash_covers_the_prompt_and_every_byte_of_the_message() {
        let a = content_hash("Repository: x\n\ncard");
        assert_eq!(a, content_hash("Repository: x\n\ncard"));
        assert_ne!(a, content_hash("Repository: x\n\ncard "));
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn the_prompt_is_r6s_frozen_v3() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../eval/study/research/2026-11-07/r6-verifier-prompt-v3.txt");
        assert_eq!(PROMPT, std::fs::read_to_string(p).unwrap());
        // blake3 of the file whose sha256 is 8298c26d… (eval/study/research/2026-11-07/r6-findings.md).
        assert_eq!(
            blake3::hash(PROMPT.as_bytes()).to_hex().to_string(),
            PINNED_PROMPT_BLAKE3
        );
    }

    const PINNED_PROMPT_BLAKE3: &str =
        "56104b98b3bb0a790208dd998d781986bb6f5ed702a4baa6949731fa4aa13e5a";

    fn conv(id: &str, rule: Rule, total: usize, example: &str) -> Convention {
        Convention {
            id: id.into(),
            status: Status::Accepted,
            mode: Mode::Advise,
            summary: String::new(),
            role: RoleSelector {
                package: String::new(),
                dir: "src".into(),
                file: "-".into(),
                entry: "-".into(),
                kind: SymbolKind::Function,
                variety: None,
                export_name: None,
                member_kind: None,
                shape: None,
                also: vec![],
            },
            rule,
            evidence: Evidence {
                holders: total,
                total,
                lower_bound: 0.9,
                lift: 2.0,
                split: vec![],
                role_members: None,
                python_members: None,
            },
            example: example.into(),
            selector_version: crate::policy::SELECTOR_VERSION,
            agents: None,
            exceptions: Vec::new(),
            different_kind: Vec::new(),
            promoted_from_hidden: false,
            promoted_from_practice: None,
        }
    }

    fn call_wrapper() -> Rule {
        Rule::WrappedBy {
            kind: WrapKind::Call,
            any_of: vec!["src/auth.ts#withAuth".into()],
        }
    }

    fn passed() -> VerifyStatus {
        status(
            State::Passed,
            Some(Outcome {
                passes: 2,
                samples: 3,
                pass: true,
            }),
        )
    }

    /// An admission source that fails the test if asked about a card.
    struct Panics;
    impl Admission for Panics {
        fn decide(&self, _: &Rule, _: Lang) -> Decision {
            panic!("asked about a rule")
        }
        fn decide_card(&self, id: &str, _: &Rule, _: Lang) -> Decision {
            panic!("asked about card {id}")
        }
        fn describe(&self) -> Value {
            Value::Null
        }
    }

    #[test]
    fn the_verifier_admits_a_suggestion_with_a_fresh_pass() {
        let sug = conv(
            "D-s",
            Rule::Named {
                pattern: "*Service".into(),
            },
            30,
            "src/a.ts#AService",
        );
        assert_eq!(sug.tier(), Tier::Suggestion);
        let mut st = BTreeMap::new();
        let v = WithVerifier {
            base: &Missing,
            statuses: &st,
        };
        assert!(!decide_convention(&v, &sug).shown);
        st.insert("D-s".to_string(), passed());
        let v = WithVerifier {
            base: &Missing,
            statuses: &st,
        };
        let d = decide_convention(&v, &sug);
        assert_eq!((d.shown, d.reason), (true, Reason::Verified));
        assert_eq!(d.text, "shown to agents (verified by agent (2/3))");
        assert!(
            d.source.starts_with(".drift/verify-cache.json"),
            "{}",
            d.source
        );
        for s in [State::NotPassed, State::Stale, State::Unverified] {
            st.insert("D-s".to_string(), status(s, None));
            let v = WithVerifier {
                base: &Missing,
                statuses: &st,
            };
            assert!(!decide_convention(&v, &sug).shown, "{s:?}");
        }
    }

    /// [STRICT] The default tier never reaches the verifier: not a source's `decide_card`,
    /// not the cache, not `drift_verify_card`.
    #[test]
    fn the_default_tier_is_never_verified() {
        let def = conv("D-d", call_wrapper(), 30, "src/a.ts#GET");
        assert_eq!(def.tier(), Tier::Default);
        let d = decide_convention(&Panics, &def);
        assert_eq!((d.shown, d.reason), (true, Reason::DefaultTier));
        // With no person's decision it is a block candidate (decision D13), still without
        // asking the source.
        let d = decide_card(&Panics, &def.id, &def.rule, Tier::Default, Lang::TypeScript);
        assert_eq!((d.shown, d.reason), (false, Reason::Candidate));
        // A verifier that would fail it (a cached fail for its id) changes nothing.
        let mut st = BTreeMap::new();
        st.insert("D-d".to_string(), status(State::NotPassed, None));
        let v = WithVerifier {
            base: &Panics,
            statuses: &st,
        };
        assert!(decide_convention(&v, &def).shown);
        assert!(ineligible(&def).is_some());
        // A proposed default-tier card is a candidate even with a pass cached for its id:
        // only a person's accept shows it.
        let mut cand = def.clone();
        cand.status = Status::Proposed;
        let mut st = BTreeMap::new();
        st.insert("D-d".to_string(), status(State::Passed, None));
        let v = WithVerifier {
            base: &Panics,
            statuses: &st,
        };
        let d = decide_convention(&v, &cand);
        assert_eq!((d.shown, d.reason), (false, Reason::Candidate));
        // Nor is anything not accepted, nor a wiring rule.
        let mut p = conv(
            "D-p",
            Rule::Named {
                pattern: "*Service".into(),
            },
            30,
            "src/a.ts#A",
        );
        p.status = Status::Proposed;
        assert!(ineligible(&p).is_some());
        // With verify on, statuses list only the eligible: never the default tier.
        let policy = ConventionsFile {
            version: 1,
            engine: "t".into(),
            file_kinds: Default::default(),
            suggestion_cap: None,
            agents: AgentsSettings { verify: Switch::On },
            review_log: Default::default(),
            packages: Vec::new(),
            conventions: vec![
                def.clone(),
                p,
                conv(
                    "D-s",
                    Rule::Named {
                        pattern: "*Service".into(),
                    },
                    30,
                    "src/a.ts#A",
                ),
            ],
        };
        let dir = tempfile::tempdir().unwrap();
        let st = statuses(dir.path(), &policy, || -> Option<RepoFacts> {
            panic!("no cached verdict: no scan")
        })
        .unwrap();
        assert_eq!(st.keys().collect::<Vec<_>>(), vec!["D-s"]);
        assert_eq!(st["D-s"].state, State::Unverified);
        // Off (the default): no statuses at all.
        let off = ConventionsFile {
            agents: AgentsSettings::default(),
            review_log: Default::default(),
            packages: Vec::new(),
            ..policy
        };
        assert!(statuses(dir.path(), &off, || -> Option<RepoFacts> { panic!("off") }).is_none());
    }

    #[test]
    fn verify_is_off_unless_set_and_reads_off_or_on() {
        let yaml = |extra: &str| {
            format!(
                "version: 1\nengine: t\nfile_kinds:\n  literal_stems: []\n  suffixes: []\n{extra}conventions: []\n"
            )
        };
        let parse = |t: &str| serde_saphyr::from_str::<ConventionsFile>(t);
        assert_eq!(parse(&yaml("")).unwrap().agents.verify, Switch::Off);
        assert_eq!(
            parse(&yaml("agents:\n  verify: on\n"))
                .unwrap()
                .agents
                .verify,
            Switch::On
        );
        assert_eq!(
            parse(&yaml("agents:\n  verify: off\n"))
                .unwrap()
                .agents
                .verify,
            Switch::Off
        );
        assert!(parse(&yaml("agents:\n  verify: maybe\n")).is_err());
        // Saved only when set, and kept by `drift init`'s merge.
        let mut f = parse(&yaml("agents:\n  verify: on\n")).unwrap();
        let text = serde_saphyr::to_string(&f).unwrap();
        // Written quoted (`on` is a boolean in YAML 1.1), read back either way.
        assert!(text.contains("agents:\n  verify: \"on\"\n"), "{text}");
        assert_eq!(parse(&text).unwrap().agents.verify, Switch::On);
        f = ConventionsFile::merge(Some(f), "t", Default::default(), &[]);
        assert_eq!(f.agents.verify, Switch::On);
        f.agents.verify = Switch::Off;
        assert!(!serde_saphyr::to_string(&f).unwrap().contains("agents:"));
    }
}
