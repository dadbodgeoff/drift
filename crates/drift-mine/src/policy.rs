//! Policy files: `.drift/conventions.yaml` (what a person approved) and
//! `drift.lock` (legacy violations that never block).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::mine::{Candidate, Evidence, Rule};
use crate::roles::{FileKinds, RoleSelector};

/// The newest `.drift/conventions.yaml` format this Drift reads and writes.
/// 1: one package (every file written before workspaces). 2: adds
/// [`ConventionsFile::packages`], the workspace packages the policy was mined over;
/// written only for a repository of several packages, so a single-package policy is
/// still written as version 1, byte for byte. A version-1 file needs no migration: it
/// reads as a policy without `packages` (each convention's scope is its role's
/// `package`, as it always was), and the next `drift init` in a workspace writes
/// version 2. 3: a convention holds a form a Drift that reads up to 2 would read as a
/// narrower or wider rule than it is, and check wrongly ([`misread_before_forms`]: a
/// promoted practice that accepts a mechanism whole or any enforcing way). Written only
/// when one is there ([`written_version`]), so every other file is written as before,
/// byte for byte; such a Drift refuses a version-3 file instead of checking it wrong.
pub const POLICY_VERSION: u32 = 3;
/// The format of a policy without [`ConventionsFile::packages`].
pub const POLICY_VERSION_SINGLE: u32 = 1;
/// The format of a policy with [`ConventionsFile::packages`] and no form of
/// [`POLICY_VERSION_FORMS`].
pub const POLICY_VERSION_PACKAGES: u32 = 2;
/// The format of a policy holding a form an older Drift would misread
/// ([`misread_before_forms`]), with or without packages.
pub const POLICY_VERSION_FORMS: u32 = 3;

/// How a convention's role selector is read ([`Convention::selector_version`]).
/// 1: as written before reserved exports had roles of their own: a selector without
/// [`RoleSelector::export_name`] also holds the exports of a reserved name at its
/// place. 2: exports of a reserved name are only in roles that name it; a selector
/// without [`RoleSelector::member_kind`] also holds the members of every member kind
/// at its place. 3: members of a member kind (a Python class's framework lineage) are
/// only in roles that name it ([`crate::roles::Legacy`]).
pub const SELECTOR_VERSION: u32 = 3;

/// The selector version a new convention on `role` is written with: a test role
/// ([`crate::shapes`]) is version 4 (a Drift that knows no shape reads its selector as
/// a production place, which holds no test unit, so it matches nothing there); every
/// other role keeps [`SELECTOR_VERSION`].
pub fn selector_version_of(role: &RoleSelector) -> u32 {
    if role.shape.is_some() {
        crate::shapes::SHAPE_SELECTOR_VERSION
    } else {
        SELECTOR_VERSION
    }
}

fn legacy_selector() -> u32 {
    1
}

fn is_legacy_selector(v: &u32) -> bool {
    *v <= 1
}
pub const CONVENTIONS_FILE: &str = ".drift/conventions.yaml";
pub const LOCK_FILE: &str = "drift.lock";
/// Optional settings: `.drift/config.yaml`.
pub const CONFIG_FILE: &str = ".drift/config.yaml";
/// Environment variable naming experimental features to turn on (comma-separated),
/// in addition to the config file's `experimental` list.
pub const EXPERIMENTAL_ENV: &str = "DRIFT_EXPERIMENTAL";
/// The experimental feature that mines wiring rules (registries and co-change).
pub const WIRING_FEATURE: &str = "wiring";

/// The experimental feature that forms and mines test roles ([`crate::shapes`]).
pub const TEST_ROLES_FEATURE: &str = "test_roles";

/// The experimental feature that forms and mines kind roles ([`crate::shapes`]).
pub const KIND_ROLES_FEATURE: &str = "kind_roles";

/// The experimental feature that mines and checks over every entry point Drift
/// lists ([`drift_core::RepoFacts::listed`]), where mining reads those of the last
/// measured build: the routes `drift security` and the practice map read become
/// members of the roles conventions are mined for and checked in. The precision
/// of what mining proposes over them was not measured.
pub const LISTED_ENTRY_POINTS_FEATURE: &str = "listed_entry_points";

/// Experimental features Drift knows.
pub const KNOWN_FEATURES: &[&str] = &[
    WIRING_FEATURE,
    INTRA_PACKAGE_LAYERING_FEATURE,
    TEST_ROLES_FEATURE,
    KIND_ROLES_FEATURE,
    LISTED_ENTRY_POINTS_FEATURE,
];

/// Whether every command reads the listed entry points of the repository at `root`
/// ([`LISTED_ENTRY_POINTS_FEATURE`]): in the config's `experimental` list or in
/// [`EXPERIMENTAL_ENV`]. Off by default, and off when the config cannot be read
/// [STRICT].
pub fn listed_entry_points(root: &Path) -> bool {
    DriftConfig::load(root).is_ok_and(|c| c.enabled(LISTED_ENTRY_POINTS_FEATURE))
}

/// The experimental feature that mines and checks layering between areas inside one
/// workspace package ([`crate::workspace::intra_package_layering`]). Off by default: on the
/// build set its cards were 1 ACCEPT, 6 WRONG and 1 TRIVIAL, so it is not admitted under
/// the fold rule (eval/study/research/2026-11-09/monorepo11.md).
pub const INTRA_PACKAGE_LAYERING_FEATURE: &str = "intra_package_layering";

/// Whether kind roles are formed for the repository at `root` ([`crate::shapes`]): the
/// study flag (`census --kind-roles`), or `kind_roles` in the config's `experimental`
/// list or in [`EXPERIMENTAL_ENV`]. Off by default, and off when the config cannot be
/// read [STRICT].
pub fn kind_roles(root: &Path, flag: bool) -> bool {
    flag || DriftConfig::load(root).is_ok_and(|c| c.enabled(KIND_ROLES_FEATURE))
}

/// Whether test roles are formed for the repository at `root` ([`crate::shapes`],
/// selector version 4): the study flag (`census --test-roles`), or `test_roles` in the
/// config's `experimental` list or in [`EXPERIMENTAL_ENV`]. Off by default, and off when
/// the config cannot be read [STRICT].
pub fn test_roles(root: &Path, flag: bool) -> bool {
    flag || DriftConfig::load(root).is_ok_and(|c| c.enabled(TEST_ROLES_FEATURE))
}

/// `.drift/config.yaml`: settings people choose. Every field is optional.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriftConfig {
    /// Experimental features to turn on: `wiring` mines and checks "registered in"
    /// and co-change rules (suggestion tier).
    #[serde(default)]
    pub experimental: Vec<String>,
    /// `proposals: {python: off}`: mine no Python proposals (decision D13-py: on unless
    /// a person turns them off, [`python_proposals`]).
    #[serde(default)]
    pub proposals: ProposalSettings,
    /// `security: {internal: [dirs], public: [dirs]}`: where entry points are reachable
    /// from, for `drift security` ([`SecuritySettings`]).
    #[serde(default)]
    pub security: SecuritySettings,
    /// `packages: {roots, include, exclude}`: which directories are workspace packages
    /// and which are mined and checked ([`crate::workspace::PackageSettings`]).
    #[serde(default)]
    pub packages: crate::workspace::PackageSettings,
    /// `agents: {brief: on|off}`: what the agent hooks add on their own ([`AgentConfig`]).
    #[serde(default)]
    pub agents: AgentConfig,
    /// `practices: {<concern>: {<canonical>: <label>}}`: instruments a person names for
    /// a concern of the practice map ([`crate::practices::Declared`]), the first source
    /// of their classification.
    #[serde(default)]
    pub practices: crate::practices::Declared,
    /// Whose word each symbol of [`Self::practices`] rests on, by symbol: what
    /// `drift setup` recorded of the answer that declared it ([`declared_by`]).
    /// Not a setting.
    #[serde(skip)]
    pub declared_by: std::collections::BTreeMap<String, String>,
    /// What Drift did not understand (an unknown key, an unknown feature): said on
    /// stderr, never an error, so other tools' or newer Drifts' keys are harmless.
    #[serde(skip)]
    pub warnings: Vec<String>,
}

impl DriftConfig {
    /// The config at `root`, or the default when there is none. Unknown keys and
    /// features are warnings ([`Self::warnings`]); YAML Drift cannot parse at all,
    /// or an `experimental` that is not a list of names, is an error.
    pub fn load(root: &Path) -> anyhow::Result<Self> {
        let p = root.join(CONFIG_FILE);
        let Some(text) = read_policy_file(&p)? else {
            return Ok(Self::default());
        };
        Self::parse(&text, &p.display().to_string())
    }

    /// The config written as `text` ([`Self::load`] reads the file and parses it so);
    /// `shown` names it in errors.
    pub fn parse(text: &str, shown: &str) -> anyhow::Result<Self> {
        let p = std::path::PathBuf::from(shown);
        if text.trim().is_empty() {
            return Ok(Self::default());
        }
        let v: serde_json::Value =
            serde_saphyr::from_str(text).with_context(|| format!("parsing {}", p.display()))?;
        let mut out = Self::default();
        let Some(map) = v.as_object() else {
            anyhow::bail!("{}: expected a mapping of settings", p.display());
        };
        for (k, v) in map {
            if k == "experimental" {
                out.experimental = serde_json::from_value(v.clone()).with_context(|| {
                    format!(
                        "{}: `experimental` must be a list of feature names",
                        p.display()
                    )
                })?;
            } else if k == "proposals" {
                out.proposals = ProposalSettings::read(v, &mut out.warnings);
            } else if k == "security" {
                out.security = SecuritySettings::read(v, &mut out.warnings);
            } else if k == "packages" {
                out.packages = crate::workspace::PackageSettings::read(v, &mut out.warnings);
            } else if k == "agents" {
                out.agents = AgentConfig::read(v, &mut out.warnings);
            } else if k == "practices" {
                out.practices = read_practices(v, &mut out.warnings);
            } else if k == "setup" {
                // What `drift setup` recorded of the answers it was given: read by
                // `drift setup` alone, from the file.
            } else {
                out.warnings
                    .push(format!("{CONFIG_FILE}: unknown setting `{k}` (ignored)"));
            }
        }
        for f in &out.experimental {
            if !KNOWN_FEATURES.contains(&f.as_str()) {
                out.warnings.push(format!(
                    "{CONFIG_FILE}: unknown experimental feature `{f}` (known: {})",
                    KNOWN_FEATURES.join(", ")
                ));
            }
        }
        out.security.on_agents_word = agents_word(text, &v, &out.security.not_deployed);
        out.declared_by = declared_by(&v, &out.practices);
        Ok(out)
    }

    /// Whether `feature` is on, here or in [`EXPERIMENTAL_ENV`].
    pub fn enabled(&self, feature: &str) -> bool {
        self.experimental.iter().any(|f| f == feature)
            || std::env::var(EXPERIMENTAL_ENV)
                .is_ok_and(|v| v.split(',').any(|f| f.trim() == feature))
    }
}

/// YAML `text` as a value, as Drift's config reader reads it (`drift setup` checks that
/// an edit reads back as the settings it means).
pub fn yaml_value(text: &str) -> anyhow::Result<serde_json::Value> {
    Ok(serde_saphyr::from_str(text)?)
}

/// [`DriftConfig::agents`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentConfig {
    /// The session brief at SessionStart (packages with their entry points, and
    /// `drift card` as the first stop): on unless `brief: off`.
    pub brief: bool,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self { brief: true }
    }
}

impl AgentConfig {
    /// Reads `agents:`; anything not understood is a warning and leaves the default.
    fn read(v: &serde_json::Value, warnings: &mut Vec<String>) -> Self {
        let mut out = Self::default();
        let Some(map) = v.as_object() else {
            warnings.push(format!(
                "{CONFIG_FILE}: `agents` must be a mapping such as `agents: {{brief: off}}` (ignored)"
            ));
            return out;
        };
        for (k, v) in map {
            match (k.as_str(), v) {
                ("brief", serde_json::Value::String(s)) if s == "on" => out.brief = true,
                ("brief", serde_json::Value::String(s)) if s == "off" => out.brief = false,
                ("brief", serde_json::Value::Bool(b)) => out.brief = *b,
                ("brief", _) => warnings.push(format!(
                    "{CONFIG_FILE}: `agents.brief` must be `on` or `off` (ignored: the brief stays on)"
                )),
                _ => warnings.push(format!(
                    "{CONFIG_FILE}: unknown setting `agents.{k}` (ignored)"
                )),
            }
        }
        out
    }
}

/// Reads `practices:`: a mapping of concern ids ([`crate::practices::CONCERNS`]) to
/// mappings of canonical references to labels. Anything else is a warning and ignored.
fn read_practices(v: &serde_json::Value, warnings: &mut Vec<String>) -> crate::practices::Declared {
    let mut out = crate::practices::Declared::new();
    let Some(map) = v.as_object() else {
        warnings.push(format!(
            "{CONFIG_FILE}: `practices` must be a mapping such as `practices: {{authn: {{\"lib/auth.ts#withAuth\": \"withAuth\"}}}}` (ignored)"
        ));
        return out;
    };
    for (concern, labels) in map {
        if crate::practices::concern_title(concern).is_none() {
            warnings.push(format!(
                "{CONFIG_FILE}: unknown concern `practices.{concern}` (ignored)"
            ));
            continue;
        }
        let Some(labels) = labels.as_object() else {
            warnings.push(format!(
                "{CONFIG_FILE}: `practices.{concern}` must map references to labels (ignored)"
            ));
            continue;
        };
        for (canonical, label) in labels {
            match label.as_str() {
                Some(l) if !l.trim().is_empty() => {
                    out.entry(concern.clone())
                        .or_default()
                        .insert(canonical.clone(), l.to_string());
                }
                _ => warnings.push(format!(
                    "{CONFIG_FILE}: `practices.{concern}` label of `{canonical}` must be text (ignored)"
                )),
            }
        }
    }
    out
}

/// [`DriftConfig::security`]: directories (repo-relative, a package or any directory)
/// whose entry points are reachable only from inside the deployment (`internal`: behind
/// a gateway, a private network, a job runner) or from the internet (`public`). Said by
/// a person, so it wins over what compose files suggest; the longest directory wins
/// between the two lists. `drift security` reports the exposure and names its source.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecuritySettings {
    #[serde(default)]
    pub internal: Vec<String>,
    #[serde(default)]
    pub public: Vec<String>,
    /// Files or directories of deployment descriptions that are in the repository
    /// and deploy nothing (a compose file of the end-to-end tests, Terraform kept
    /// for reference): Drift leaves them out of the boundary, and says so.
    #[serde(default)]
    pub not_deployed: Vec<String>,
    /// What a person says of the repository's Terraform ([`TerraformTie`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub terraform: Vec<TerraformTie>,
    /// The entries of `not_deployed` that rest only on an agent's answer to `drift
    /// setup` that no person confirmed ([`agents_word`]): they count only where they
    /// make Drift more cautious, judged each time the boundary is read
    /// ([`crate::security::Boundaries::load_with`]). Not a setting: read from what
    /// `drift setup` wrote.
    #[serde(skip)]
    pub on_agents_word: Vec<String>,
}

/// Whose word each symbol declared under `practices:` rests on, from what `drift setup`
/// recorded under `setup:` of the answer `guard:<symbol>`: `a person` (answered in
/// `drift setup`, or an agent's proposal a person confirmed: the same word), `an
/// agent, not confirmed by a person`; a line of `.drift/config.yaml` no answer is
/// recorded for was written by hand.
pub fn declared_by(
    v: &serde_json::Value,
    practices: &crate::practices::Declared,
) -> std::collections::BTreeMap<String, String> {
    let records = v.get("setup").and_then(|s| s.as_object());
    let mut out = std::collections::BTreeMap::new();
    for symbol in practices.values().flat_map(|t| t.keys()) {
        let record = records
            .into_iter()
            .flat_map(|m| m.values())
            .find(|r| r.get("answer").and_then(|a| a.as_str()) == Some(&format!("guard:{symbol}")));
        let s = |k: &str| {
            record
                .and_then(|r| r.get(k))
                .and_then(|x| x.as_str())
                .unwrap_or_default()
        };
        let word = match (record.is_some(), s("by"), s("confirmed_by")) {
            (false, ..) => "a line of .drift/config.yaml no answer of `drift setup` records",
            (true, "agent", "person") => "a person",
            (true, "agent", _) => "an agent, not confirmed by a person",
            (true, ..) => "a person",
        };
        out.insert(symbol.clone(), word.to_string());
    }
    out
}

/// The id `drift setup` gives the question about `subject` of `kind` (`deployment`,
/// `terraform`, `terraform-none`, `check`): `S-` and 4 hex digits.
pub fn setup_id(kind: &str, subject: &str) -> String {
    let h = blake3::hash(format!("{kind}\0{subject}").as_bytes());
    format!("S-{}", &h.to_hex()[..4])
}

/// The entries of `security.not_deployed` in the config `text` that rest only on an
/// agent's answer no person confirmed: the line is the one `drift setup` wrote for
/// the agent's "only for tests" (`# drift setup <id> ...` above `- "<file>"`), the
/// record under `setup:` says `by: agent` and no `confirmed_by: person`, and nothing
/// else in the list names the same entry.
pub fn agents_word(text: &str, v: &serde_json::Value, not_deployed: &[String]) -> Vec<String> {
    let Some(setup) = v.get("setup").and_then(|s| s.as_object()) else {
        return Vec::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    let written = |id: &str, p: &str| {
        let line = format!("- {}", serde_json::to_string(p).unwrap_or_default());
        lines.windows(2).any(|w| {
            w[0].trim_start()
                .starts_with(&format!("# drift setup {id} "))
                && w[1].trim() == line
        })
    };
    let mut out: Vec<String> = Vec::new();
    for p in not_deployed {
        let id = setup_id("deployment", p);
        let Some(r) = setup.get(&id) else {
            continue;
        };
        let s = |k: &str| r.get(k).and_then(|x| x.as_str()).unwrap_or_default();
        if s("by") == "agent"
            && s("confirmed_by") != "person"
            && s("answer") == "tests-only"
            && not_deployed.iter().filter(|x| *x == p).count() == 1
            && written(&id, p)
            && !out.contains(p)
        {
            out.push(p.clone());
        }
    }
    out
}

/// One entry of `security.terraform`: `{target: <module dir>[#aws_lb_target_group.<name>],
/// code: <dir>}`. A person's statement that the target group (every target group of the
/// module when none is named) forwards to the code in `code`, and that requests from
/// outside reach that code, in what this Terraform deploys, only through load-balancer
/// rules that forward to that target. Drift then reads the listener rules of the
/// repository's Terraform for the routes of `code` ([`crate::terraform`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerraformTie {
    /// The directory of the Terraform module, repo-relative.
    pub module: String,
    /// The `aws_lb_target_group` resource of the module, when one is named.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// The code directory, repo-relative; "" is the whole repository.
    pub code: String,
}

/// A path of the config as Drift compares it: no `./`, no `/` at the end, `.` the root.
fn config_dir(d: &str) -> Option<String> {
    let d = d.trim().trim_start_matches("./").trim_end_matches('/');
    match d {
        ".." => None,
        "." => Some(String::new()),
        d => Some(d.to_string()),
    }
}

impl SecuritySettings {
    /// Reads `security:`; a value that is not a mapping of lists of paths is a warning.
    pub fn read(v: &serde_json::Value, warnings: &mut Vec<String>) -> Self {
        let mut out = Self::default();
        let Some(map) = v.as_object() else {
            warnings.push(format!(
                "{CONFIG_FILE}: `security` must be a mapping with `internal` and `public` lists of directories (ignored)"
            ));
            return out;
        };
        for (k, v) in map {
            if k == "terraform" {
                out.terraform = Self::ties(v, warnings);
                continue;
            }
            let list = match k.as_str() {
                "internal" => &mut out.internal,
                "public" => &mut out.public,
                "not_deployed" => &mut out.not_deployed,
                _ => {
                    warnings.push(format!(
                        "{CONFIG_FILE}: unknown `security` setting `{k}` (ignored)"
                    ));
                    continue;
                }
            };
            match v.as_array() {
                Some(items) if items.iter().all(|i| i.is_string()) => {
                    list.extend(items.iter().filter_map(|i| {
                        let d = i
                            .as_str()?
                            .trim()
                            .trim_start_matches("./")
                            .trim_end_matches('/');
                        (d != "..").then(|| {
                            if d == "." {
                                String::new()
                            } else {
                                d.to_string()
                            }
                        })
                    }));
                }
                _ => warnings.push(format!(
                    "{CONFIG_FILE}: `security.{k}` must be a list of directories (ignored)"
                )),
            }
        }
        out
    }
}

impl SecuritySettings {
    /// Reads `security.terraform`; an entry that is not `{target, code}` is a warning.
    fn ties(v: &serde_json::Value, warnings: &mut Vec<String>) -> Vec<TerraformTie> {
        let mut out = Vec::new();
        let shape = format!(
            "{CONFIG_FILE}: `security.terraform` must be a list of `{{target: <module dir>[#aws_lb_target_group.<name>], code: <dir>}}`"
        );
        let Some(items) = v.as_array() else {
            warnings.push(format!("{shape} (ignored)"));
            return out;
        };
        for item in items {
            let text = |key: &str| item.get(key).and_then(|v| v.as_str());
            let known = item
                .as_object()
                .is_some_and(|o| o.keys().all(|k| k == "target" || k == "code"));
            let (Some(target), Some(code), true) = (text("target"), text("code"), known) else {
                warnings.push(format!("{shape} (an entry is ignored)"));
                continue;
            };
            let (module, group) = match target.split_once('#') {
                Some((module, resource)) => (module, Some(resource)),
                None => (target, None),
            };
            // A named resource is a target group, by its name alone.
            let group = match group.map(|g| g.trim().strip_prefix("aws_lb_target_group.")) {
                Some(Some(name))
                    if !name.is_empty()
                        && name
                            .chars()
                            .all(|c| c.is_alphanumeric() || c == '_' || c == '-') =>
                {
                    Some(name.to_string())
                }
                Some(_) => {
                    warnings.push(format!(
                        "{shape}: `{target}` names something else after `#` (the entry is ignored)"
                    ));
                    continue;
                }
                None => None,
            };
            let (Some(module), Some(code)) = (config_dir(module), config_dir(code)) else {
                warnings.push(format!("{shape} (an entry is ignored)"));
                continue;
            };
            out.push(TerraformTie {
                module,
                group,
                code,
            });
        }
        out
    }
}

/// [`DriftConfig::proposals`]: which mined proposals a person turned off, or said to keep on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProposalSettings {
    /// Python mined proposals: `on` unless set to `off` (decision D13-py); `None` when not set.
    #[serde(default)]
    pub python: Option<Switch>,
}

impl ProposalSettings {
    /// `proposals` as written. [STRICT] Only what Drift can read is a person's setting:
    /// `off` (or YAML's `false`) turns Python proposals off and `on` (or `true`) says the
    /// default. Anything else (another value, a `proposals` that is not a mapping, an
    /// unknown key) is not set, so the default stands, with a warning that says so.
    fn read(v: &serde_json::Value, warnings: &mut Vec<String>) -> Self {
        let mut out = Self::default();
        let Some(map) = v.as_object() else {
            warnings.push(format!(
                "{CONFIG_FILE}: `proposals` must be a mapping such as `proposals: {{python: off}}` (ignored: Python proposals stay on)"
            ));
            return out;
        };
        for (k, v) in map {
            if k != "python" {
                warnings.push(format!(
                    "{CONFIG_FILE}: unknown setting `proposals.{k}` (ignored)"
                ));
                continue;
            }
            match v {
                serde_json::Value::String(s) if s == "on" => out.python = Some(Switch::On),
                serde_json::Value::Bool(true) => out.python = Some(Switch::On),
                serde_json::Value::String(s) if s == "off" => out.python = Some(Switch::Off),
                serde_json::Value::Bool(false) => out.python = Some(Switch::Off),
                _ => warnings.push(format!(
                    "{CONFIG_FILE}: `proposals.python` must be `on` or `off` (ignored: Python proposals stay on; write `off` to turn them off)"
                )),
            }
        }
        out
    }
}

/// Where the Python proposals setting comes from ([`python_proposals`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PythonProposals {
    /// On: the default (decision D13-py), with no `proposals.python` in
    /// `.drift/config.yaml`; also when the config cannot be read, or its setting is not
    /// understood [STRICT].
    Default,
    /// On: `proposals: {python: on}` in `.drift/config.yaml` (the default, said).
    Config,
    /// On: `drift census --python-proposals` (the study's view), whatever the config says.
    Flag,
    /// Off: `proposals: {python: off}` in `.drift/config.yaml`, a person's opt-out.
    Off,
}

impl PythonProposals {
    pub fn on(self) -> bool {
        self != Self::Off
    }
}

/// Whether Drift mines Python proposals for the repository at `root` (decision D13-py,
/// eval/study/PLAN-R11.md §3, closed by the dev5-py-check,
/// eval/study/runs/dev5-py/dev5-check.md): on unless a person turns them off with
/// `proposals: {python: off}` in `.drift/config.yaml`; the study's census flag (`flag`)
/// is on whatever the config says. Off, mining proposes no Python convention
/// ([`crate::mine::withhold_python`]) and a Python proposal an earlier run wrote is
/// dropped when `.drift/conventions.yaml` is read; what a person decided (accepted,
/// rejected, `agents: show`) is kept and checked as before. Python facts, `check`, the
/// security inventory and everything else are unaffected. [STRICT] Only an `off` Drift
/// can read turns them off: a config that cannot be read, or a setting it does not
/// understand, is no opt-out, so nothing is withheld or dropped on its account
/// (`census` and `init` still fail on an unreadable config, through the wiring switch).
pub fn python_proposals(root: &Path, flag: bool) -> PythonProposals {
    if flag {
        return PythonProposals::Flag;
    }
    match DriftConfig::load(root).map(|c| c.proposals.python) {
        Ok(Some(Switch::Off)) => PythonProposals::Off,
        Ok(Some(Switch::On)) => PythonProposals::Config,
        Ok(None) | Err(_) => PythonProposals::Default,
    }
}

/// Whether a convention read from `.drift/conventions.yaml` stays when Python proposals
/// are off: anything a person decided, and every non-Python convention.
fn python_kept(c: &Convention) -> bool {
    c.status != Status::Proposed
        || c.agents.is_some()
        || c.language() != drift_core::ingest::Lang::Python
}

/// Write `base/rel` (`base` is the repository root) without ever writing
/// through a symbolic link that leaves the repository: a repository can commit
/// `.drift/conventions.yaml -> ~/.bashrc`, and a plain write would overwrite the
/// target. A link that stays inside (`CLAUDE.md -> AGENTS.md`) is written at its
/// destination; any other link on the way is refused (an error). The file is
/// written with `drift_core::fsutil::write_atomic`, which never follows a link.
pub fn write_no_follow(base: &Path, rel: &Path, contents: &[u8]) -> anyhow::Result<()> {
    let target = base.join(rel);
    let link = rel
        .ancestors()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| base.join(p))
        .find(|p| std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()));
    let target = match link {
        None => target,
        Some(link) => {
            let refuse = || {
                anyhow::anyhow!(
                    "refusing to write {}: {} is a symbolic link that leads outside the \
                     repository. Replace it with a regular file or directory.",
                    target.display(),
                    link.display()
                )
            };
            let root = base.canonicalize().map_err(|_| refuse())?;
            let resolved = match target.canonicalize() {
                Ok(p) => p,
                // A dangling final link: resolve its directory; the link is replaced.
                Err(_) => match (target.parent(), target.file_name()) {
                    (Some(dir), Some(name)) => dir.canonicalize().map_err(|_| refuse())?.join(name),
                    _ => return Err(refuse()),
                },
            };
            if !resolved.starts_with(&root) {
                return Err(refuse());
            }
            resolved
        }
    };
    let dir = target.parent().unwrap_or(base);
    std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let tmp = format!(".{name}.{}.tmp", std::process::id());
    drift_core::fsutil::write_atomic(&target, &tmp, contents)
        .with_context(|| format!("writing {}", target.display()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Approved by a person: checked. (Declared first so accepted conventions sort first.)
    Accepted,
    /// Mined, not yet reviewed. Only ever advises.
    Proposed,
    /// Rejected by a person: never proposed again.
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Reported to agents and in CI, never fails anything.
    Advise,
    /// New violations fail `drift check` (and, later, block the agent's turn).
    Block,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Convention {
    pub id: String,
    pub status: Status,
    pub mode: Mode,
    /// Human summary, regenerated on each `init`.
    pub summary: String,
    pub role: RoleSelector,
    pub rule: Rule,
    pub evidence: Evidence,
    /// `path#symbol` to copy from.
    pub example: String,
    /// How [`Convention::role`] is read ([`SELECTOR_VERSION`]). A selector is frozen:
    /// a convention written before reserved exports (no field, version 1) or member
    /// kinds (version 2) had roles of their own keeps checking the members it checked,
    /// reserved exports and members of every kind included
    /// ([`crate::roles::Unit::in_convention_role`]), whatever mining forms today. Only
    /// a convention first written now gets the current version. Not part of the id.
    #[serde(
        default = "legacy_selector",
        skip_serializing_if = "is_legacy_selector"
    )]
    pub selector_version: u32,
    /// A person's decision about showing this convention to agents, overriding its rule
    /// family's admission ([`crate::admission`]): `show` shows it to agents (hooks, MCP,
    /// `drift check` text, AGENTS.md) whatever its family's track record. Absent: the
    /// family decides (default-tier conventions are always shown). Set by
    /// `drift review --show-to-agents <id>` or `a` in interactive review. Not part of the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents: Option<AgentsChoice>,
    /// Outliers a reviewer marked as legitimate exceptions, each with a short reason
    /// ("fine because…"), sorted by member, one per member. `drift check`, the hooks, MCP
    /// and PR mode list such a member as exempt (code `reviewed`) instead of reporting it
    /// as a violation; nothing else changes: not the tier, the mode, the evidence or
    /// which members other conventions check [STRICT]. Set by `drift review --exempt` and
    /// the Studio. Absent when empty, so a policy without exceptions is written as before.
    /// Not part of the id.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exceptions: Vec<Exception>,
    /// Files whose members a person said are a different kind of thing than the ones the
    /// rule is about (the one-question calibration of `drift review`, answer "No, these are
    /// different"): a structural exemption, a path list, so `drift check` applies it
    /// deterministically (exemption code [`crate::check::DIFFERENT_KIND`]). [STRICT] It never
    /// covers an entry point under an auth or validation rule
    /// ([`crate::calibrate::auth_or_validation`]) unless the person confirmed that entry
    /// point by name ([`DifferentKind::entry_points`]). Sorted by path, one per path. Absent
    /// when empty, so a policy without one is written as before. Not part of the id.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub different_kind: Vec<DifferentKind>,
    /// A person promoted this card from the ones mining withheld (`drift review --hidden
    /// --answer`, [`crate::show::Withheld`]): it was never proposed, and is written as that
    /// person's decision (accepted, or rejected so it is not asked again). From then on it
    /// follows the normal tier and agent rules: being promoted shows it to no agent by
    /// itself. Absent when false, so every other convention is written as before. Not
    /// part of the id.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub promoted_from_hidden: bool,
    /// A person promoted this convention from the practice map (`drift practices
    /// promote`, [`crate::practices::promote`]): the id of the variant it was promoted
    /// from (`P-…`). Its rule is a [`Rule::Practice`]. Absent for every other
    /// convention, so they are written as before. Not part of the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promoted_from_practice: Option<String>,
    /// Drift proposed this convention from one of its maps, not from mining: which
    /// fact it rests on (`practice`: a place of the practice map that qualifies for
    /// promotion, proposed for a person to accept; `layering`: a pair of layers of the
    /// structure map where one never imports the other; `manifest`: a workspace
    /// package that imports only what its manifest declares). Such a proposal goes
    /// through none of mining's gates and changes none of mining's output; like every
    /// proposal, nothing checks it until a person accepts it. Absent for every mined
    /// or hand-promoted convention, so they are written as before. Not part of the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_map: Option<String>,
    /// The evidence as it stood when a person accepted the convention: `drift init`
    /// refreshes [`Convention::evidence`] on every run, so without this nobody can tell
    /// that the role a block was accepted on has since shrunk or changed. Frozen the
    /// first time a run meets the convention accepted ([`ConventionsFile::merge`], and
    /// [`Convention::freeze_accepted_evidence`] for a command that accepts), and carried
    /// with the decision when its id changes. Absent until then, so every file written
    /// before is written as before. Not part of the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_evidence: Option<AcceptedEvidence>,
}

/// What a person saw when they accepted a convention ([`Convention::accepted_evidence`]):
/// the role's size, how many of the members the rule is about followed it, and the
/// confidence Drift had.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AcceptedEvidence {
    /// Members of the role ([`Evidence::role_size`]): the size the block floor reads.
    pub role_size: usize,
    /// Members that followed the rule, of `total`.
    pub holders: usize,
    pub total: usize,
    pub lower_bound: f64,
}

impl AcceptedEvidence {
    pub fn of(e: &Evidence) -> Self {
        AcceptedEvidence {
            role_size: e.role_size(),
            holders: e.holders,
            total: e.total,
            lower_bound: e.lower_bound,
        }
    }
}

/// A file a person set apart from its convention as a different kind of thing
/// ([`Convention::different_kind`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DifferentKind {
    /// The repo-relative path of the file, as `drift check` prints it.
    pub path: String,
    /// Entry points of the file (symbols) the person confirmed, one by one and apart from
    /// setting the file apart, under an auth or validation rule: only these entry points
    /// are covered. Absent when none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entry_points: Vec<String>,
}

/// A path as [`DifferentKind::path`] names it: repo-relative, without `.` or `..`
/// segments, no control characters. Refused otherwise.
pub fn different_kind_path(text: &str) -> anyhow::Result<String> {
    // Windows: `\` is a separator there, never part of a name (on Unix it may be one),
    // and `:` is never in a relative path (`C:/x`).
    #[cfg(windows)]
    let owned = text.replace('\\', "/");
    #[cfg(windows)]
    let text = owned.as_str();
    if text.is_empty()
        || text.len() > 1024
        || text.contains('#')
        || text.chars().any(char::is_control)
        || text.starts_with('/')
        || text.contains('\\')
        || (cfg!(windows) && text.contains(':'))
        || text
            .split('/')
            .any(|p| p == ".." || p == "." || p.is_empty())
    {
        anyhow::bail!(
            "expected a repo-relative file path (as `drift review --json` lists a flagged member's `path`), got {:?}",
            text.chars().take(80).collect::<String>()
        );
    }
    Ok(text.to_string())
}

/// A member a reviewer marked as a legitimate exception to its convention
/// ([`Convention::exceptions`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Exception {
    /// `path#symbol`, as `drift.lock` keys members: it survives the member moving within
    /// its file. A move or a rename is followed through the fingerprint the lock keeps
    /// beside the member's line ([`carry_moved_exceptions`]).
    pub member: String,
    /// Why it is fine, in the reviewer's words: one line, at most
    /// [`MAX_EXCEPTION_REASON`] characters. Echoed to agents only through
    /// [`crate::report::sanitize`].
    pub reason: String,
}

/// Longest reason a reviewer may give for an exception ([`Exception::reason`]).
pub const MAX_EXCEPTION_REASON: usize = 120;

/// A reviewer's reason as it is stored: whitespace collapsed to single spaces and
/// trimmed. Refused when empty, when it holds other control characters, or when it is
/// longer than [`MAX_EXCEPTION_REASON`] characters.
pub fn exception_reason(text: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        !text.chars().any(|c| c.is_control() && !c.is_whitespace()),
        "the reason holds control characters"
    );
    let reason = text.split_whitespace().collect::<Vec<_>>().join(" ");
    anyhow::ensure!(!reason.is_empty(), "give a reason: why this member is fine");
    let n = reason.chars().count();
    anyhow::ensure!(
        n <= MAX_EXCEPTION_REASON,
        "the reason has {n} characters; keep it to {MAX_EXCEPTION_REASON} (it is shown to agents)"
    );
    Ok(reason)
}

/// A member as an exception names it: `path#symbol` with a repo-relative path, as
/// `drift check` and `drift.lock` print members. Refused otherwise.
pub fn exception_member(text: &str) -> anyhow::Result<String> {
    // Windows: `\` in the path is a separator there, never part of a name (on Unix it
    // may be one), and `:` is never in a relative path (`C:/x`).
    #[cfg(windows)]
    let owned = match text.split_once('#') {
        Some((path, symbol)) => format!("{}#{symbol}", path.replace('\\', "/")),
        None => text.to_string(),
    };
    #[cfg(windows)]
    let text = owned.as_str();
    let bad = || {
        anyhow::anyhow!(
            "expected a member as path#symbol (as `drift review --show <id>` and `drift check` print it), got {:?}",
            text.chars().take(80).collect::<String>()
        )
    };
    let (path, symbol) = text.split_once('#').ok_or_else(bad)?;
    if path.is_empty()
        || symbol.is_empty()
        || text.len() > 1024
        || text.chars().any(char::is_control)
        || path.starts_with('/')
        || path.contains('\\')
        || (cfg!(windows) && path.contains(':'))
        || path
            .split('/')
            .any(|p| p == ".." || p == "." || p.is_empty())
    {
        return Err(bad());
    }
    Ok(text.to_string())
}

impl Convention {
    /// Keep the evidence as it is now as what the person accepted
    /// ([`Convention::accepted_evidence`]), unless it was kept already: for a command that
    /// records an acceptance.
    pub fn freeze_accepted_evidence(&mut self) {
        if self.accepted_evidence.is_none() {
            self.accepted_evidence = Some(AcceptedEvidence::of(&self.evidence));
        }
    }

    /// The exception a reviewer recorded for `member` (`path#symbol`), if any.
    pub fn exception(&self, member: &str) -> Option<&Exception> {
        self.exceptions.iter().find(|e| e.member == member)
    }

    /// Record (or replace the reason of) the exception for `member`, keeping the list
    /// sorted by member with one entry per member.
    pub fn set_exception(&mut self, member: &str, reason: &str) {
        match self
            .exceptions
            .binary_search_by(|e| e.member.as_str().cmp(member))
        {
            Ok(i) => self.exceptions[i].reason = reason.to_string(),
            Err(i) => self.exceptions.insert(
                i,
                Exception {
                    member: member.to_string(),
                    reason: reason.to_string(),
                },
            ),
        }
    }

    /// Remove the exception for `member`; false when there was none.
    pub fn remove_exception(&mut self, member: &str) -> bool {
        let before = self.exceptions.len();
        self.exceptions.retain(|e| e.member != member);
        self.exceptions.len() != before
    }

    /// The file `path` as this convention's person set it apart, if they did.
    pub fn different_kind_at(&self, path: &str) -> Option<&DifferentKind> {
        self.different_kind.iter().find(|d| d.path == path)
    }

    /// Set the file `path` apart as a different kind, covering the entry points
    /// `confirmed` too (added to those already confirmed), keeping the list sorted by path
    /// with one entry per path.
    pub fn set_different_kind(&mut self, path: &str, confirmed: &[String]) {
        let i = match self
            .different_kind
            .binary_search_by(|d| d.path.as_str().cmp(path))
        {
            Ok(i) => i,
            Err(i) => {
                self.different_kind.insert(
                    i,
                    DifferentKind {
                        path: path.to_string(),
                        entry_points: Vec::new(),
                    },
                );
                i
            }
        };
        let d = &mut self.different_kind[i];
        d.entry_points.extend(confirmed.iter().cloned());
        d.entry_points.sort();
        d.entry_points.dedup();
    }
}

/// [`Convention::agents`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentsChoice {
    /// Shown to agents whatever the rule family's admission.
    Show,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConventionsFile {
    pub version: u32,
    /// Engine that mined these conventions. A newer engine re-mines only on `drift init`.
    pub engine: String,
    /// Frozen file-kind vocabulary used by role selectors.
    pub file_kinds: FileKinds,
    /// How many suggestion-tier conventions `drift review`, `drift init`, `drift census`
    /// and the Studio show by default (a number, or `all`); absent: 5
    /// ([`crate::rank`]). Presentation only: `check`, hooks, MCP and exports read every
    /// accepted convention whatever this says. Set by hand; `drift init` keeps it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestion_cap: Option<crate::rank::SuggestionCap>,
    /// Settings about agents: `agents.verify: on` lets the host agent verify suggestions
    /// ([`crate::verify`]; experimental, off by default). Set by hand; `drift init` keeps it.
    #[serde(default, skip_serializing_if = "AgentsSettings::is_default")]
    pub agents: AgentsSettings,
    /// `review_log: on`: `drift review` (and the Studio, which runs it) records each review
    /// decision and each card it shows in a local log under `.drift/review-log/` (round 9,
    /// G; the study's real-maintainer evidence). Off unless set, and absent when off, so a
    /// policy that never turned it on is written byte for byte as before. Nothing is ever
    /// sent anywhere. Set with `drift review --set-log on|off`; `drift init` keeps it.
    #[serde(default, skip_serializing_if = "Switch::is_off")]
    pub review_log: Switch,
    /// Version 2: the workspace packages (repo-relative directories, "" the root) the
    /// conventions were mined over, sorted; empty (not written) in a single-package
    /// repository. Each convention's scope is its role's `package` (a merged card of
    /// sibling packages: each part's); the hooks and MCP find the package of a file
    /// from this list ([`crate::workspace::package_of`]). Rewritten by `drift init`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub packages: Vec<String>,
    pub conventions: Vec<Convention>,
}

/// [`ConventionsFile::agents`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentsSettings {
    /// Whether a suggestion the host agent verified (`drift_verify_card`, a cached pass
    /// for the card as it is now) is shown to agents. `off` unless set.
    #[serde(default)]
    pub verify: Switch,
}

impl AgentsSettings {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// `off` | `on`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Switch {
    #[default]
    Off,
    On,
}

impl Switch {
    pub fn is_off(&self) -> bool {
        *self == Self::Off
    }
}

/// The text of the policy file at `p`, `None` when there is none. Anything else
/// that cannot be read is an error, never an empty policy: a FIFO or a link to
/// `/dev/zero` (which a pull request can commit in place of `drift.lock`) is
/// refused without blocking or exhausting memory
/// ([`drift_core::fsutil::read_regular`]), as is text that is not UTF-8.
fn read_policy_file(p: &Path) -> anyhow::Result<Option<String>> {
    match drift_core::fsutil::read_regular_to_string(p, drift_core::fsutil::MAX_CONFIG_BYTES) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("reading {}", p.display())),
    }
}

/// The one field read before the rest of a policy ([`ConventionsFile::load`]).
#[derive(Deserialize)]
struct VersionOnly {
    version: u32,
}

/// A policy written in a format newer than this Drift reads ([`POLICY_VERSION`]): the
/// error [`ConventionsFile::load`] returns for it, so a caller that hides other
/// policy errors from agents (they can quote the file) can still say this one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewerPolicy {
    /// The policy file, as the error names it.
    pub path: String,
    /// The format it says it is in.
    pub version: u32,
}

impl NewerPolicy {
    /// The error as an agent's hook or tool says it: no path (the hook's message is
    /// cut at 200 characters), no text of the file.
    pub fn for_agents(&self) -> String {
        format!(
            "{CONVENTIONS_FILE} was written by a newer Drift (format {}): upgrade Drift (`drift --version` shows this one); no convention is shown to agents until then",
            self.version
        )
    }
}

impl std::fmt::Display for NewerPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} was written by a newer Drift (policy format {}; this Drift reads up to {POLICY_VERSION}). Upgrade Drift to the version that wrote it (`drift --version` shows the one installed here; every machine and CI that reads this repository needs it), or restore the file from before that change",
            self.path, self.version
        )
    }
}

impl std::error::Error for NewerPolicy {}

/// The format `f` is written in: the oldest that holds everything in it, so a file
/// with none of a newer format's forms is written as before, byte for byte, and stays
/// readable by every Drift that read it. Without packages, version 1 (a file a person
/// hand-wrote as 0 keeps it, as it always did); with packages, 2; with a form of
/// version 3 ([`misread_before_forms`]), 3 either way. Decided from the content on
/// every write, as the selector version is per convention
/// ([`selector_version_of`]): a file whose last such form is removed goes back down.
pub fn written_version(f: &ConventionsFile) -> u32 {
    let base = if f.packages.is_empty() {
        f.version.min(POLICY_VERSION_SINGLE)
    } else {
        POLICY_VERSION_PACKAGES
    };
    if f.conventions.iter().any(misread_before_forms) {
        base.max(POLICY_VERSION_FORMS)
    } else {
        base
    }
}

/// Whether a Drift that reads up to [`POLICY_VERSION_PACKAGES`] would read `c` as a
/// different rule than it is: serde skips a field it does not know, so such a Drift
/// would parse the file, check the rule without the field, and (when it writes the
/// file back, `drift init`, `drift review`) drop it. Whatever the status: a proposal or
/// a rejection read wrong is rewritten wrong too.
///
/// Raising the version (the file is refused, "written by a newer Drift"):
/// - a practice's `any_mechanism`: without it the rule is its `any_of` alone, often
///   empty, so every unit of the place that uses the mechanism by another instrument
///   is reported as a violation;
/// - a practice's `any_enforcing`: the same, for every enforcing way not named;
/// - a practice's place of a kind other than a package or a directory
///   ([`place_of_a_new_kind`]): read as the whole directory, a wider place.
///
/// Not raising it, because a Drift that skips them checks exactly the same rules:
/// - [`Convention::from_map`]: says where a proposal came from. A proposal is checked
///   by nobody until a person accepts it; an accepted one is checked by its rule
///   (layering is `Rule::Avoids`, which every such Drift knows). Such a Drift has no
///   staleness to exempt it from ([`crate::check`]'s `settle` reads it only for that).
///   Rewritten by it, the label is lost: the proposal reads as mined, and an accepted
///   one can later be called stale, which only ever moves it to advise.
/// - [`Convention::accepted_evidence`]: a record of what a person saw, read by
///   nothing that decides a violation. Rewritten by such a Drift, it is lost and the
///   next `drift init` freezes the evidence of that day instead.
pub fn misread_before_forms(c: &Convention) -> bool {
    match &c.rule {
        Rule::Practice {
            any_mechanism,
            any_enforcing,
            ..
        } => !any_mechanism.is_empty() || *any_enforcing || place_of_a_new_kind(c),
        _ => false,
    }
}

/// Whether the promoted practice `c` holds in a place of a kind a Drift that reads up
/// to [`POLICY_VERSION_PACKAGES`] does not know: anything but a package or one
/// directory of it. Such a Drift reads a practice's place from its role's package and
/// directory only ([`crate::practices::promote::place_of`]), so it would check one
/// file's or one route prefix's practice over the whole directory.
fn place_of_a_new_kind(c: &Convention) -> bool {
    matches!(
        &c.rule,
        Rule::Practice { in_file, under_route, .. } if in_file.is_some() || under_route.is_some()
    )
}

impl ConventionsFile {
    pub fn load(root: &Path) -> anyhow::Result<Option<Self>> {
        let p = root.join(CONVENTIONS_FILE);
        if !p.exists() {
            return Ok(None);
        }
        let Some(text) = read_policy_file(&p)? else {
            return Ok(None);
        };
        // The version first, read alone: a newer Drift's file can hold a rule type or a
        // shape this one cannot parse, and the person needs to hear "upgrade", not a
        // parse error. Where even the version cannot be read, the full parse says why.
        // Read alone only when the full parse fails: a file that parses has the same
        // `version` field, which the check below reads, so the answer is the same with
        // one parse instead of two.
        let f: Self = match serde_saphyr::from_str(&text) {
            Ok(f) => f,
            Err(e) => {
                if let Ok(v) = serde_saphyr::from_str::<VersionOnly>(&text)
                    && v.version > POLICY_VERSION
                {
                    return Err(anyhow::Error::new(NewerPolicy {
                        path: p.display().to_string(),
                        version: v.version,
                    }));
                }
                return Err(e).with_context(|| format!("parsing {}", p.display()));
            }
        };
        if f.version > POLICY_VERSION {
            return Err(anyhow::Error::new(NewerPolicy {
                path: p.display().to_string(),
                version: f.version,
            }));
        }
        let mut f = f;
        // Wiring rules are experimental suggestions: they advise, whatever the file
        // says, until they have been blind-labelled.
        for c in &mut f.conventions {
            if c.rule.is_wiring() {
                c.mode = Mode::Advise;
            }
            // Exceptions in a deterministic order, one per member (the first written wins),
            // whatever order a hand edit left them in.
            c.exceptions.sort_by(|a, b| a.member.cmp(&b.member));
            c.exceptions.dedup_by(|b, a| a.member == b.member);
            // The same for the files set apart as a different kind.
            c.different_kind.sort_by(|a, b| a.path.cmp(&b.path));
            c.different_kind.dedup_by(|b, a| a.path == b.path);
            for d in &mut c.different_kind {
                d.entry_points.sort();
                d.entry_points.dedup();
            }
        }
        // A proposal the show policy hides (`crate::show`), written by an older Drift, is
        // gone: no surface reads it, and the next write of the file leaves it out. What a
        // person decided is kept.
        f.conventions.retain(crate::show::convention_kept);
        // Python proposals a person turned off (decision D13-py).
        if !python_proposals(root, false).on() {
            f.conventions.retain(python_kept);
        }
        Ok(Some(f))
    }

    pub fn save(&self, root: &Path) -> anyhow::Result<()> {
        let mut this = std::borrow::Cow::Borrowed(self);
        let version = written_version(self);
        if version != self.version {
            this.to_mut().version = version;
        }
        let header = "# Drift conventions: mined from this codebase, approved by people.\n\
                      # status: proposed | accepted | rejected    mode: advise | block\n\
                      # Edit status/mode by hand or with `drift review`. Agents must not edit this file.\n";
        let body = serde_saphyr::to_string(this.as_ref())?;
        write_no_follow(
            root,
            Path::new(CONVENTIONS_FILE),
            format!("{header}{body}").as_bytes(),
        )
    }

    /// Merge freshly mined candidates into this file, keeping every human decision.
    pub fn merge(
        existing: Option<Self>,
        engine: &str,
        kinds: FileKinds,
        candidates: &[Candidate],
    ) -> Self {
        Self::merge_carrying(existing, engine, kinds, candidates).0
    }

    /// [`ConventionsFile::merge`], and the new cards that descend from an old one:
    /// `(old id, new id)` pairs, sorted. A convention's id hashes its role and rule
    /// ([`crate::mine::convention_id`]), so a mined rule that gains an alternative (a
    /// second wrapper beside the first) comes back under a new id. Where a new
    /// candidate's role is an accepted or proposed convention's and its rule is that
    /// convention's with alternatives added ([`gains_alternatives`]), and mining no
    /// longer proposes the old one, the new card is a proposal like any other, and the
    /// old card stays as it is: nobody accepted the added alternative, so the narrower
    /// rule a person accepted stays the one checked and shown to agents until a person
    /// decides the wider one. The new card takes over the old one's exceptions (a
    /// reviewer's "fine because…" about a member), nothing that enforces; `drift init`
    /// copies the old id's lock lines to it ([`Lock::copy_lines`]), so its legacy debt
    /// is the old one's and nothing written since is baselined under the new id. The
    /// ids themselves are computed as they always were: changing that would orphan
    /// every decision made.
    pub fn merge_carrying(
        existing: Option<Self>,
        engine: &str,
        kinds: FileKinds,
        candidates: &[Candidate],
    ) -> (Self, Vec<(String, String)>) {
        let mut carried: Vec<(String, String)> = Vec::new();
        let mined: BTreeSet<&str> = candidates.iter().map(|c| c.id.as_str()).collect();
        let mut by_id: BTreeMap<String, Convention> = BTreeMap::new();
        let keep_kinds = existing.as_ref().map(|e| e.file_kinds.clone());
        let suggestion_cap = existing.as_ref().and_then(|e| e.suggestion_cap);
        let agents = existing.as_ref().map(|e| e.agents).unwrap_or_default();
        let review_log = existing.as_ref().map(|e| e.review_log).unwrap_or_default();
        let packages = existing
            .as_ref()
            .map(|e| e.packages.clone())
            .unwrap_or_default();
        if let Some(e) = existing {
            for c in e.conventions {
                by_id.insert(c.id.clone(), c);
            }
        }
        for cand in candidates {
            let summary = cand.summary();
            match by_id.get_mut(&cand.id) {
                // A promoted practice is a person's, written from the practice map:
                // mining never proposes one (its id cannot be a mined one's), and its
                // summary is never rewritten from the rule. Kept as it is.
                Some(c) if c.rule.is_practice() => {}
                Some(c) => {
                    // Refresh evidence; never touch status, mode or how the frozen
                    // selector is read. What the person accepted stays beside it: the
                    // evidence as the file had it, the first time a run meets it
                    // accepted.
                    if c.status == Status::Accepted {
                        c.freeze_accepted_evidence();
                    }
                    c.summary = summary;
                    c.evidence = cand.evidence.clone();
                    c.example = cand.example.clone();
                }
                None => {
                    let exceptions = carried_exceptions(&by_id, cand);
                    let from = by_id
                        .values()
                        .find(|c| {
                            c.status != Status::Rejected
                                && !c.rule.is_practice()
                                && c.role == cand.role
                                && !mined.contains(c.id.as_str())
                                && gains_alternatives(&c.rule, &cand.rule)
                        })
                        .map(|c| c.id.clone());
                    let mut new = Convention {
                        id: cand.id.clone(),
                        status: Status::Proposed,
                        mode: Mode::Advise,
                        summary,
                        role: cand.role.clone(),
                        rule: cand.rule.clone(),
                        evidence: cand.evidence.clone(),
                        example: cand.example.clone(),
                        selector_version: selector_version_of(&cand.role),
                        agents: None,
                        exceptions,
                        // [STRICT] Not carried to a new card: what a person set
                        // apart was set apart from the card they saw.
                        different_kind: Vec::new(),
                        promoted_from_hidden: false,
                        promoted_from_practice: None,
                        from_map: None,
                        accepted_evidence: None,
                    };
                    if let Some(old) = from.as_ref().and_then(|id| by_id.get(id)) {
                        // The same card with more ways to hold it. [RULE 4] What the
                        // person accepted was the narrower rule: it stays, and the wider
                        // one is theirs to decide. Only the exceptions come along.
                        new.exceptions.extend(old.exceptions.iter().cloned());
                        new.exceptions.sort_by(|a, b| a.member.cmp(&b.member));
                        new.exceptions.dedup_by(|b, a| a.member == b.member);
                        carried.push((old.id.clone(), cand.id.clone()));
                    }
                    by_id.insert(cand.id.clone(), new);
                }
            }
        }
        // Order: accepted first, then proposed, then rejected. A decided convention is
        // ordered by id alone, so a run that only refreshes evidence moves no line of
        // what people decided, and a diff or a merge of two branches shows only what
        // changed. Proposals stay strongest first, the order `drift review` reads
        // them in: their evidence is rewritten on every run anyway.
        let mut conventions: Vec<Convention> = by_id.into_values().collect();
        conventions.sort_by(|a, b| {
            a.status
                .cmp(&b.status)
                .then_with(|| match (a.status, b.status) {
                    (Status::Proposed, Status::Proposed) => {
                        b.evidence.lower_bound.total_cmp(&a.evidence.lower_bound)
                    }
                    _ => std::cmp::Ordering::Equal,
                })
                .then(a.id.cmp(&b.id))
        });
        carried.sort();
        let merged = Self {
            version: POLICY_VERSION_SINGLE,
            engine: engine.to_string(),
            // Keep the frozen vocabulary once it exists, so selectors stay stable.
            file_kinds: keep_kinds.unwrap_or(kinds),
            suggestion_cap,
            agents,
            review_log,
            packages,
            conventions,
        };
        (merged, carried)
    }

    /// The `(role, rule)` of every accepted convention: what hysteresis keeps when
    /// `drift init` mines again ([`crate::mine::mine_keeping`]). Not a promoted practice:
    /// mining never drafts one, so there is nothing to keep, and its role is only a place.
    /// Not a convention proposed from a map ([`Convention::from_map`]) either: mining did
    /// not draft it, and mining is frozen, so accepting one must not change what is mined
    /// (a layering convention's id is mining's id for its role and rule, so keeping it
    /// would keep a mined draft the caps drop).
    pub fn accepted_rules(&self) -> Vec<(RoleSelector, Rule)> {
        self.conventions
            .iter()
            .filter(|c| c.status == Status::Accepted && !c.rule.is_practice())
            .filter(|c| c.from_map.is_none())
            .map(|c| (c.role.clone(), c.rule.clone()))
            .collect()
    }

    /// The policy as `check` reads each member: a merged card's convention
    /// ([`RoleSelector::also`]) once per part, each with the part's role and the card's
    /// id, status, mode, evidence and summary. So every member is judged, and its
    /// exemptions looked up, in the role it is a member of, exactly as a card per part
    /// would judge it, and a sibling convention of that role shares its exemptions as
    /// mining does. Borrowed when no convention is merged.
    pub fn by_part(&self) -> std::borrow::Cow<'_, Self> {
        if self.conventions.iter().all(|c| c.role.also.is_empty()) {
            return std::borrow::Cow::Borrowed(self);
        }
        let mut out = self.clone();
        out.conventions = self
            .conventions
            .iter()
            .flat_map(|c| {
                c.role
                    .parts()
                    .into_iter()
                    .map(move |role| Convention { role, ..c.clone() })
            })
            .collect();
        std::borrow::Cow::Owned(out)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Convention> {
        self.conventions.iter_mut().find(|c| c.id == id)
    }

    /// For a command where a person accepts (`drift review`, just before it writes the
    /// file): keep, beside each accepted convention that has no record yet, the evidence
    /// as the file has it now, which is what the person was shown when they accepted it
    /// ([`Convention::accepted_evidence`]). The same record [`ConventionsFile::merge`]
    /// keeps the first time a run meets it accepted, made at the moment of acceptance
    /// instead, so a `drift init` that refreshes the evidence first cannot change what
    /// the person saw. A record already kept is never replaced; promoted practices are
    /// left as `merge` leaves them.
    pub fn freeze_accepted_now(&mut self) {
        for c in &mut self.conventions {
            if c.status == Status::Accepted && !c.rule.is_practice() {
                c.freeze_accepted_evidence();
            }
        }
    }

    /// Add `c`, a card a person promoted from the withheld ones (`drift review --hidden`):
    /// marked [`Convention::promoted_from_hidden`], placed after the conventions of its
    /// status (the file's order is otherwise unchanged). A convention of that id already
    /// in the file is replaced.
    pub fn add_promoted(&mut self, mut c: Convention) {
        c.promoted_from_hidden = true;
        self.conventions.retain(|x| x.id != c.id);
        let at = self
            .conventions
            .iter()
            .position(|x| x.status > c.status)
            .unwrap_or(self.conventions.len());
        self.conventions.insert(at, c);
    }
}

impl Convention {
    /// A freshly mined card as a proposal, as `drift init` writes a new one (no
    /// exceptions carried over).
    pub fn proposed_from(cand: &Candidate) -> Self {
        Convention {
            id: cand.id.clone(),
            status: Status::Proposed,
            mode: Mode::Advise,
            summary: cand.summary(),
            role: cand.role.clone(),
            rule: cand.rule.clone(),
            evidence: cand.evidence.clone(),
            example: cand.example.clone(),
            selector_version: SELECTOR_VERSION,
            agents: None,
            exceptions: Vec::new(),
            different_kind: Vec::new(),
            promoted_from_hidden: false,
            promoted_from_practice: None,
            from_map: None,
            accepted_evidence: None,
        }
    }
}

/// Whether `new` is `old` with alternatives added and nothing else changed: a wrapper
/// rule of the same kind whose wrappers are a strict superset of `old`'s
/// ([`ConventionsFile::merge_carrying`]). A rule that drops an alternative, or changes
/// in any other way, is another rule: a person decides it anew.
pub fn gains_alternatives(old: &Rule, new: &Rule) -> bool {
    match (old, new) {
        (
            Rule::WrappedBy {
                kind: k0,
                any_of: a0,
            },
            Rule::WrappedBy {
                kind: k1,
                any_of: a1,
            },
        ) => k0 == k1 && a1.len() > a0.len() && a0.iter().all(|w| a1.contains(w)),
        _ => false,
    }
}

/// The reviewer's exceptions a new card takes over from the conventions it replaces
/// when sibling cards merge or a merged card comes apart ([`RoleSelector::also`]), so a
/// "fine because…" follows the member: a merged card takes every exception of the
/// conventions on its parts with its rule (the union; for a member named twice, the
/// least id's reason); a card on one part takes those of the merged cards with its rule
/// that cover its role, for the members it lists (outliers and exempt members). Sorted by
/// member, one per member. Empty for any other new card.
fn carried_exceptions(by_id: &BTreeMap<String, Convention>, cand: &Candidate) -> Vec<Exception> {
    let parts = cand.role.parts();
    let mut out: Vec<Exception> = Vec::new();
    for c in by_id.values() {
        if c.rule != cand.rule || c.exceptions.is_empty() {
            continue;
        }
        let from_part =
            !cand.role.also.is_empty() && c.role.also.is_empty() && parts.contains(&c.role);
        let from_card = cand.role.also.is_empty()
            && !c.role.also.is_empty()
            && c.role.parts().contains(&cand.role);
        if from_part {
            out.extend(c.exceptions.iter().cloned());
        } else if from_card {
            let listed = |m: &str| {
                cand.outliers
                    .iter()
                    .map(|o| format!("{}#{}", o.path, o.symbol))
                    .chain(
                        cand.exempt
                            .iter()
                            .map(|e| format!("{}#{}", e.path, e.symbol)),
                    )
                    .any(|k| k == m)
            };
            out.extend(c.exceptions.iter().filter(|e| listed(&e.member)).cloned());
        }
    }
    // `by_id` is ordered by id, so the least id's reason comes first.
    out.sort_by(|a, b| a.member.cmp(&b.member));
    out.dedup_by(|b, a| a.member == b.member);
    out
}

/// Baselined violations: `<convention id> <path#symbol>`, one per line, sorted.
///
/// Agents only ever remove lines (by fixing code); people add them. That makes
/// `merge=union` in `.gitattributes` safe for concurrent branches.
///
/// Below each line a baseline writes now, a comment line keys the same violation by
/// what it is rather than where it is: `#~ <convention id> <fingerprint> <path#symbol>`
/// ([`crate::roles::Unit::fingerprint`]; in memory, the key [`Lock::fingerprint_key`]).
/// When the member is known to be gone from its `path#symbol` (its file moved, or was
/// renamed) and exactly one new violation of the same convention is the same unit by
/// its fingerprint and name, that violation is the old debt, still baselined
/// ([`Lock::baseline_moved`]). It is a comment because a Drift that knows no
/// fingerprint skips comments; as a plain line, an older Drift read it as a member that
/// is never current, listed it as fixed and counted it as a second violation. The
/// form `<convention id> ~<fingerprint> <path#symbol>` is still read. Each line stands
/// alone, so `merge=union` stays safe; a lock written before has no fingerprint lines
/// and works as it always did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Lock {
    pub entries: BTreeSet<(String, String)>,
}

impl Lock {
    pub fn load(root: &Path) -> anyhow::Result<Self> {
        let p = root.join(LOCK_FILE);
        let Some(text) = read_policy_file(&p)? else {
            return Ok(Self::default());
        };
        let mut entries = BTreeSet::new();
        for line in text.lines() {
            let line = line.trim();
            // A fingerprint line, `#~ <id> <fingerprint> <path#symbol>`: a comment, so a
            // Drift that knows no fingerprint skips it ([`Lock`]).
            if let Some(rest) = line.strip_prefix("#~") {
                let mut parts = rest.trim().splitn(3, ' ');
                if let (Some(id), Some(fp), Some(member)) =
                    (parts.next(), parts.next(), parts.next())
                {
                    let key = Self::fingerprint_key(fp, member.trim());
                    if !id.is_empty() && Self::split_fingerprint(&key).is_some() {
                        entries.insert((id.to_string(), key));
                    }
                }
                continue;
            }
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // `<id> <path#symbol>`, or a fingerprint line written as
            // `<id> ~<fingerprint> <path#symbol>` (read, never written).
            if let Some((id, key)) = line.split_once(' ') {
                entries.insert((id.to_string(), key.trim().to_string()));
            }
        }
        Ok(Self { entries })
    }

    pub fn save(&self, root: &Path) -> anyhow::Result<()> {
        let mut out = String::from(
            "# drift.lock: legacy violations that never block. Fix code to remove lines.\n",
        );
        // Each member line, then its fingerprint lines as comments, `#~ <id>
        // <fingerprint> <path#symbol>`, sorted: an older Drift skips them, and a person
        // removing a member line sees its fingerprint line right below it. A fingerprint
        // line whose member line is gone baselines nothing ([`Lock::baseline_moved`]) and
        // is not written.
        let mut prints: BTreeMap<(&str, &str), Vec<&str>> = BTreeMap::new();
        for (id, key) in &self.entries {
            if let Some((fp, member)) = Self::split_fingerprint(key) {
                prints.entry((id.as_str(), member)).or_default().push(fp);
            }
        }
        for (id, key) in &self.entries {
            if Self::split_fingerprint(key).is_some() {
                continue;
            }
            out.push_str(id);
            out.push(' ');
            out.push_str(key);
            out.push('\n');
            for fp in prints
                .get(&(id.as_str(), key.as_str()))
                .into_iter()
                .flatten()
            {
                out.push_str(&format!("#~ {id} {fp} {key}\n"));
            }
        }
        write_no_follow(root, Path::new(LOCK_FILE), out.as_bytes())
    }

    pub fn contains(&self, id: &str, key: &str) -> bool {
        self.entries.contains(&(id.to_string(), key.to_string()))
    }

    /// The key of the fingerprint line of `member` (`path#symbol`):
    /// `~<fingerprint> <member>`. A member key never starts with `~` followed by a
    /// fingerprint and a space ([`exception_member`] keeps a path before `#`).
    pub fn fingerprint_key(fingerprint: &str, member: &str) -> String {
        format!("~{fingerprint} {member}")
    }

    /// `(fingerprint, member)` of a fingerprint line's key; `None` for a member line.
    pub fn split_fingerprint(key: &str) -> Option<(&str, &str)> {
        let (fp, member) = key.strip_prefix('~')?.split_once(' ')?;
        (!fp.is_empty() && fp.bytes().all(|b| b.is_ascii_hexdigit()) && !member.is_empty())
            .then_some((fp, member))
    }

    /// The member a key names: the key itself, or a fingerprint line's member.
    pub fn member_of(key: &str) -> &str {
        Self::split_fingerprint(key).map_or(key, |(_, m)| m)
    }

    /// Whether any line is a fingerprint line: without one, nothing can have moved.
    pub fn has_fingerprints(&self) -> bool {
        self.entries
            .iter()
            .any(|(_, k)| Self::split_fingerprint(k).is_some())
    }

    /// How many violations the lock baselines: its member lines (a fingerprint line
    /// is the second key of one of them, not another violation).
    pub fn members(&self) -> usize {
        self.entries
            .iter()
            .filter(|(_, k)| Self::split_fingerprint(k).is_none())
            .count()
    }

    /// The lock that baselines `violations`: a member line for each, and its fingerprint
    /// line where `fingerprint` gives one (the unit's, [`crate::roles::Unit::fingerprint`]).
    pub fn baselining(
        violations: &[crate::check::Violation],
        fingerprint: impl Fn(&crate::check::Violation) -> Option<String>,
    ) -> Self {
        let mut entries = BTreeSet::new();
        for v in violations {
            let member = format!("{}#{}", v.path, v.symbol);
            if let Some(fp) = fingerprint(v) {
                entries.insert((v.id.clone(), Self::fingerprint_key(&fp, &member)));
            }
            entries.insert((v.id.clone(), member));
        }
        Self { entries }
    }

    /// Mark baselined each violation that is old debt moved, and return the
    /// `(id, new path#symbol) -> old path#symbol` of each. A violation is the debt of a
    /// lock member that moved only when Drift read both ends: the member is gone (not in
    /// `present`, which holds every unit there is and every member of a file Drift could
    /// not read; the caller decides moves only with the whole repository's facts), its
    /// member line is still in the lock (a fingerprint line a person left behind
    /// baselines nothing), and it is the same unit: the same convention, the same
    /// fingerprint (`fingerprints`, by `(id, path#symbol)`, [`crate::roles::Unit::fingerprint`],
    /// which holds its kind) and the same name ([`move_name`]). And only where that is
    /// one to one: exactly one gone member and exactly one violation not baselined by
    /// its own line. Two of either is a copy, or a deletion beside a new violation that
    /// reads the same: which is the old one cannot be told, so every one of them is new.
    /// The outcome does not depend on the order of `violations`.
    pub fn baseline_moved(
        &self,
        violations: &mut [crate::check::Violation],
        fingerprints: &BTreeMap<(String, String), String>,
        present: &BTreeSet<String>,
    ) -> BTreeMap<(String, String), String> {
        let mut taken: BTreeMap<(String, String), String> = BTreeMap::new();
        // (id, fingerprint, name) -> the members gone from the code that had it.
        let mut gone: BTreeMap<(String, String, String), Vec<String>> = BTreeMap::new();
        for (id, key) in &self.entries {
            let Some((fp, member)) = Self::split_fingerprint(key) else {
                continue;
            };
            // Still there: its own line covers it, or it was fixed. Or its member line
            // was removed by a person: the debt is not baselined any more.
            if present.contains(member) || !self.contains(id, member) {
                continue;
            }
            gone.entry((id.clone(), fp.to_string(), move_name(member)))
                .or_default()
                .push(member.to_string());
        }
        if gone.is_empty() {
            return taken;
        }
        // The violations that could be one of them, by the same key.
        let mut new: BTreeMap<(String, String, String), Vec<usize>> = BTreeMap::new();
        for (i, v) in violations.iter().enumerate() {
            if v.baselined {
                continue;
            }
            let key = format!("{}#{}", v.path, v.symbol);
            let Some(fp) = fingerprints.get(&(v.id.clone(), key.clone())) else {
                continue;
            };
            let k = (v.id.clone(), fp.clone(), move_name(&key));
            if gone.contains_key(&k) {
                new.entry(k).or_default().push(i);
            }
        }
        // A member with two fingerprint lines (its code changed between baselines) is
        // taken once.
        let mut used: BTreeSet<(String, String)> = BTreeSet::new();
        for (k, at) in &new {
            let (Some(from), [i]) = (gone.get(k), at.as_slice()) else {
                continue;
            };
            let [member] = from.as_slice() else {
                continue;
            };
            if !used.insert((k.0.clone(), member.clone())) {
                continue;
            }
            let v = &mut violations[*i];
            v.baselined = true;
            taken.insert(
                (v.id.clone(), format!("{}#{}", v.path, v.symbol)),
                member.clone(),
            );
        }
        taken
    }

    /// Rewrite the lines of each legacy violation that moved ([`crate::check::CheckReport::moved`])
    /// to where it is now: its member line and fingerprint lines under the old
    /// `path#symbol` give way to a member line and the matched fingerprint under the
    /// new one. Held by its fingerprint alone, moved debt turned new at the first edit
    /// that changed the fingerprint, and the old line was listed as fixed. A move whose
    /// old line is gone, or whose new place already has a line, is left as it is.
    /// Returns how many moved.
    pub fn follow_moves(&mut self, moved: &[crate::check::MovedDebt]) -> usize {
        let mut n = 0;
        for m in moved {
            if !self.contains(&m.id, &m.from) || self.contains(&m.id, &m.to) {
                continue;
            }
            self.entries.retain(|(id, key)| *id != m.id || Self::member_of(key) != m.from);
            self.entries.insert((m.id.clone(), m.to.clone()));
            self.entries
                .insert((m.id.clone(), Self::fingerprint_key(&m.fingerprint, &m.to)));
            n += 1;
        }
        n
    }

    /// Copy every line of convention `from` to `to`, keeping `from`'s: a new card whose
    /// rule is `from`'s with alternatives added ([`ConventionsFile::merge_carrying`])
    /// has the same legacy debt, so `drift init` does not baseline it anew, while `from`
    /// keeps its decision and its lines.
    pub fn copy_lines(&mut self, from: &str, to: &str) {
        let copied: Vec<String> = self
            .entries
            .iter()
            .filter(|(id, _)| id == from)
            .map(|(_, key)| key.clone())
            .collect();
        for key in copied {
            self.entries.insert((to.to_string(), key));
        }
    }

    /// Move every line of convention `from` to `to`: the decision moved
    /// ([`ConventionsFile::merge_carrying`]), and its legacy violations with it.
    pub fn rename(&mut self, from: &str, to: &str) {
        let moved: Vec<(String, String)> = self
            .entries
            .iter()
            .filter(|(id, _)| id == from)
            .cloned()
            .collect();
        for (id, key) in moved {
            self.entries.remove(&(id, key.clone()));
            self.entries.insert((to.to_string(), key));
        }
    }
}

/// What of a unit's `path#symbol` a move keeps ([`Lock::baseline_moved`]): its name, and
/// for a file unit ([`crate::roles::FILE_UNIT`]), whose name says nothing, the file's
/// own name. A symbol that moves to another file keeps its name; a file that moves to
/// another directory keeps its file name. A rename is not followed: it is reported new.
fn move_name(member: &str) -> String {
    let (path, name) = member.split_once('#').unwrap_or(("", member));
    if name == crate::roles::FILE_UNIT {
        format!("{name} {}", path.rsplit('/').next().unwrap_or(path))
    } else {
        name.to_string()
    }
}

/// The exceptions of `conventions` that follow a member that moved: for each move
/// [`Lock::baseline_moved`] took (`moved`, `(id, new path#symbol) -> old path#symbol`),
/// the reviewer's exception of the old member covers exactly the violation it moved to,
/// as if the reviewer had named its new place (unless that one has an exception of its
/// own). Returns a copy of each convention that gained one, with the exception added
/// under the violation's `path#symbol` and the reviewer's reason; nothing is written
/// back, so the policy file keeps the member the reviewer named. A reviewer's exception
/// for a member the lock has no fingerprint for (one marked fine after it was
/// baselined, or a lock written before fingerprints) does not follow it.
pub fn carry_moved_exceptions(
    conventions: &[&Convention],
    moved: &BTreeMap<(String, String), String>,
) -> Vec<Convention> {
    let mut out: Vec<Convention> = Vec::new();
    if moved.is_empty() {
        return out;
    }
    let mut done: BTreeSet<&str> = BTreeSet::new();
    for c in conventions {
        if c.exceptions.is_empty() || !done.insert(c.id.as_str()) {
            continue;
        }
        let mut gained = (*c).clone();
        let mut changed = false;
        for ((id, key), old) in moved {
            if *id != c.id || gained.exception(key).is_some() {
                continue;
            }
            if let Some(e) = c.exception(old) {
                gained.set_exception(key, &e.reason);
                changed = true;
            }
        }
        if changed {
            out.push(gained);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{SymbolKind, WrapKind};

    fn cand(id: &str, lb: f64) -> Candidate {
        Candidate {
            id: id.into(),
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
            rule: Rule::WrappedBy {
                kind: WrapKind::Call,
                any_of: vec!["lib/auth.ts#withAuth".into()],
            },
            // A default-tier call wrapper (20 members): the show policy keeps it.
            evidence: Evidence {
                holders: 19,
                total: 20,
                lower_bound: lb,
                lift: 2.0,
                split: vec![],
                role_members: None,
                python_members: None,
            },
            score: 1.0,
            example: "app/a/route.ts#GET".into(),
            outliers: vec![],
            can_block: false,
            wiring: None,
            exempt: vec![],
            inherited: vec![],
            derived: vec![],
        }
    }

    #[test]
    fn merge_keeps_human_decisions_and_refreshes_evidence() {
        let first = ConventionsFile::merge(
            None,
            "e1",
            FileKinds::default(),
            &[cand("D-aaaaaa", 0.8), cand("D-bbbbbb", 0.9)],
        );
        let mut edited = first.clone();
        edited.get_mut("D-aaaaaa").unwrap().status = Status::Accepted;
        edited.get_mut("D-aaaaaa").unwrap().mode = Mode::Block;
        edited.get_mut("D-bbbbbb").unwrap().status = Status::Rejected;
        let again = ConventionsFile::merge(
            Some(edited),
            "e2",
            FileKinds::default(),
            &[cand("D-aaaaaa", 0.85), cand("D-cccccc", 0.7)],
        );
        let ids: Vec<_> = again
            .conventions
            .iter()
            .map(|c| (c.id.as_str(), c.status, c.mode))
            .collect();
        assert_eq!(
            ids,
            [
                ("D-aaaaaa", Status::Accepted, Mode::Block),
                ("D-cccccc", Status::Proposed, Mode::Advise),
                ("D-bbbbbb", Status::Rejected, Mode::Advise),
            ]
        );
        assert_eq!(again.conventions[0].evidence.lower_bound, 0.85);
    }

    /// A proposal the show policy hides (`crate::show`) is gone when the file is read, so
    /// no surface sees it; what a person decided is kept.
    #[test]
    fn a_hidden_proposal_is_dropped_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let mut hidden = cand("D-aaaaaa", 0.8);
        hidden.rule = Rule::Calls {
            callee: "lib/log.ts#log".into(),
        };
        let mut accepted = hidden.clone();
        accepted.id = "D-bbbbbb".into();
        accepted.role.dir = "lib".into();
        let mut f = ConventionsFile::merge(
            None,
            "e1",
            FileKinds::default(),
            &[hidden, accepted, cand("D-cccccc", 0.9)],
        );
        f.get_mut("D-bbbbbb").unwrap().status = Status::Accepted;
        f.save(dir.path()).unwrap();
        let mut ids: Vec<String> = ConventionsFile::load(dir.path())
            .unwrap()
            .unwrap()
            .conventions
            .into_iter()
            .map(|c| c.id)
            .collect();
        ids.sort();
        assert_eq!(ids, ["D-bbbbbb", "D-cccccc"]);
    }

    #[test]
    fn yaml_and_lock_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let f = ConventionsFile::merge(None, "e1", FileKinds::default(), &[cand("D-aaaaaa", 0.8)]);
        f.save(dir.path()).unwrap();
        assert_eq!(ConventionsFile::load(dir.path()).unwrap().unwrap(), f);
        let mut lock = Lock::default();
        lock.entries
            .insert(("D-aaaaaa".into(), "app/b/route.ts#GET".into()));
        lock.save(dir.path()).unwrap();
        assert_eq!(Lock::load(dir.path()).unwrap(), lock);
    }

    /// A pull request can commit `drift.lock` or the conventions as a link to
    /// `/dev/zero` (read until memory ran out) or leave a FIFO there (blocked):
    /// both are errors at once, never an empty lock that hides legacy violations
    /// or passes them.
    #[cfg(unix)]
    #[test]
    fn planted_policy_files_are_errors_not_hangs() {
        for rel in [LOCK_FILE, CONVENTIONS_FILE, CONFIG_FILE] {
            for fifo in [true, false] {
                let dir = tempfile::tempdir().unwrap();
                let p = dir.path().join(rel);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                if fifo {
                    let made = std::process::Command::new("mkfifo")
                        .arg(&p)
                        .status()
                        .is_ok_and(|s| s.success());
                    if !made {
                        continue;
                    }
                } else {
                    std::os::unix::fs::symlink("/dev/zero", &p).unwrap();
                }
                let root = dir.path().to_path_buf();
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    let errs = [
                        Lock::load(&root).is_err(),
                        ConventionsFile::load(&root).is_err(),
                        DriftConfig::load(&root).is_err(),
                    ];
                    let _ = tx.send(errs);
                });
                let errs = rx
                    .recv_timeout(std::time::Duration::from_secs(20))
                    .unwrap_or_else(|_| panic!("{rel} (fifo: {fifo}) hung"));
                let which = [LOCK_FILE, CONVENTIONS_FILE, CONFIG_FILE]
                    .iter()
                    .position(|f| *f == rel)
                    .unwrap();
                assert_eq!(
                    errs.iter().filter(|e| **e).count(),
                    1,
                    "{rel} (fifo: {fifo}): {errs:?}"
                );
                assert!(errs[which], "{rel} (fifo: {fifo})");
            }
        }
    }

    /// No exceptions: the file is written as before (no `exceptions` key). With some,
    /// they are written sorted by member, one per member, and read back as written.
    #[test]
    fn exceptions_are_absent_when_empty_and_sorted_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let mut f =
            ConventionsFile::merge(None, "e1", FileKinds::default(), &[cand("D-aaaaaa", 0.8)]);
        f.save(dir.path()).unwrap();
        let plain = std::fs::read_to_string(dir.path().join(CONVENTIONS_FILE)).unwrap();
        assert!(!plain.contains("exceptions"), "{plain}");
        let c = f.get_mut("D-aaaaaa").unwrap();
        c.set_exception("app/z/route.ts#GET", "public");
        c.set_exception("app/b/route.ts#GET", "health check");
        c.set_exception("app/z/route.ts#GET", "public by design");
        assert_eq!(
            c.exceptions
                .iter()
                .map(|e| (e.member.as_str(), e.reason.as_str()))
                .collect::<Vec<_>>(),
            [
                ("app/b/route.ts#GET", "health check"),
                ("app/z/route.ts#GET", "public by design")
            ]
        );
        f.save(dir.path()).unwrap();
        let text = std::fs::read_to_string(dir.path().join(CONVENTIONS_FILE)).unwrap();
        assert!(text.contains("exceptions:"), "{text}");
        assert_eq!(ConventionsFile::load(dir.path()).unwrap().unwrap(), f);
        // Removing the last one writes the file as it was.
        let c = f.get_mut("D-aaaaaa").unwrap();
        assert!(c.remove_exception("app/b/route.ts#GET"));
        assert!(c.remove_exception("app/z/route.ts#GET"));
        assert!(!c.remove_exception("app/z/route.ts#GET"));
        f.save(dir.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(CONVENTIONS_FILE)).unwrap(),
            plain
        );
        // A hand edit in any order, with a duplicate: read sorted, the first one kept.
        let edited = plain.replace(
            "  example: app/a/route.ts#GET\n",
            "  example: app/a/route.ts#GET\n  exceptions:\n  - member: b.ts#x\n    reason: two\n  - member: a.ts#x\n    reason: one\n  - member: b.ts#x\n    reason: dup\n",
        );
        assert_ne!(edited, plain, "{plain}");
        std::fs::write(dir.path().join(CONVENTIONS_FILE), edited).unwrap();
        let back = ConventionsFile::load(dir.path()).unwrap().unwrap();
        let got: Vec<_> = back.conventions[0]
            .exceptions
            .iter()
            .map(|e| (e.member.as_str(), e.reason.as_str()))
            .collect();
        assert_eq!(got, [("a.ts#x", "one"), ("b.ts#x", "two")]);
    }

    /// `review_log`: absent when off, so a policy that never turned it on is written byte
    /// for byte as before; `on` written as `review_log: on`, read back, and kept by
    /// `drift init`'s merge.
    #[test]
    fn review_log_is_absent_when_off_and_kept_by_merge() {
        let dir = tempfile::tempdir().unwrap();
        let mut f =
            ConventionsFile::merge(None, "e1", FileKinds::default(), &[cand("D-aaaaaa", 0.8)]);
        f.save(dir.path()).unwrap();
        let plain = std::fs::read_to_string(dir.path().join(CONVENTIONS_FILE)).unwrap();
        assert!(!plain.contains("review_log"), "{plain}");
        f.review_log = Switch::On;
        f.save(dir.path()).unwrap();
        let on = std::fs::read_to_string(dir.path().join(CONVENTIONS_FILE)).unwrap();
        assert!(on.contains("\nreview_log: \"on\"\n"), "{on}");
        let back = ConventionsFile::load(dir.path()).unwrap().unwrap();
        assert_eq!(back.review_log, Switch::On);
        // As a person writes it, unquoted.
        let hand = on.replace("review_log: \"on\"", "review_log: on");
        std::fs::write(dir.path().join(CONVENTIONS_FILE), hand).unwrap();
        let back = ConventionsFile::load(dir.path()).unwrap().unwrap();
        assert_eq!(back.review_log, Switch::On);
        let again = ConventionsFile::merge(
            Some(back),
            "e2",
            FileKinds::default(),
            &[cand("D-aaaaaa", 0.8)],
        );
        assert_eq!(again.review_log, Switch::On);
        f.review_log = Switch::Off;
        f.save(dir.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(CONVENTIONS_FILE)).unwrap(),
            plain
        );
    }

    #[test]
    fn exception_text_is_checked() {
        assert_eq!(
            exception_reason("  generated\n client  ").unwrap(),
            "generated client"
        );
        assert!(exception_reason("   ").is_err());
        assert!(exception_reason("bell\u{7}").is_err());
        assert!(exception_reason(&"x".repeat(MAX_EXCEPTION_REASON)).is_ok());
        assert!(exception_reason(&"x".repeat(MAX_EXCEPTION_REASON + 1)).is_err());
        assert_eq!(exception_member("a/b.ts#C.m").unwrap(), "a/b.ts#C.m");
        assert_eq!(exception_member("a.ts##priv").unwrap(), "a.ts##priv");
        for bad in [
            "a.ts",
            "#x",
            "a.ts#",
            "/a.ts#x",
            "../a.ts#x",
            "a//b.ts#x",
            "a.ts#x\ny",
        ] {
            assert!(exception_member(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn missing_policy_files_are_not_errors() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Lock::load(dir.path()).unwrap(), Lock::default());
        assert!(ConventionsFile::load(dir.path()).unwrap().is_none());
        assert!(DriftConfig::load(dir.path()).is_ok());
    }

    /// Decision D13-py: Python proposals are on by default. Only an `off` Drift can read
    /// turns them off; the census flag is on whatever the config says.
    #[test]
    fn python_proposals_are_on_unless_a_person_turns_them_off() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let config = |text: &str| {
            let p = root.join(CONFIG_FILE);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        };
        // No config, an empty one, and one that says nothing of proposals.
        assert_eq!(python_proposals(root, false), PythonProposals::Default);
        for text in ["", "experimental: []\n", "proposals: {}\n"] {
            config(text);
            assert_eq!(
                python_proposals(root, false),
                PythonProposals::Default,
                "{text}"
            );
        }
        for text in ["proposals: {python: off}\n", "proposals: {python: false}\n"] {
            config(text);
            assert_eq!(
                python_proposals(root, false),
                PythonProposals::Off,
                "{text}"
            );
            assert!(!python_proposals(root, false).on(), "{text}");
            // The study's flag is on over a person's `off`.
            assert_eq!(
                python_proposals(root, true),
                PythonProposals::Flag,
                "{text}"
            );
            assert!(DriftConfig::load(root).unwrap().warnings.is_empty());
        }
        for text in ["proposals: {python: on}\n", "proposals: {python: true}\n"] {
            config(text);
            assert_eq!(
                python_proposals(root, false),
                PythonProposals::Config,
                "{text}"
            );
            assert!(DriftConfig::load(root).unwrap().warnings.is_empty());
        }
        // [STRICT] What Drift does not understand is no opt-out: the default, with a warning.
        for (text, warning) in [
            (
                "proposals: {python: never}\n",
                "`proposals.python` must be `on` or `off` (ignored: Python proposals stay on",
            ),
            (
                "proposals: {python: [off]}\n",
                "`proposals.python` must be `on` or `off` (ignored: Python proposals stay on",
            ),
            (
                "proposals: off\n",
                "`proposals` must be a mapping such as `proposals: {python: off}` (ignored: Python proposals stay on)",
            ),
            (
                "proposals: {pyhton: off}\n",
                "unknown setting `proposals.pyhton` (ignored)",
            ),
        ] {
            config(text);
            assert_eq!(
                python_proposals(root, false),
                PythonProposals::Default,
                "{text}"
            );
            let warnings = DriftConfig::load(root).unwrap().warnings;
            assert_eq!(warnings.len(), 1, "{text}: {warnings:?}");
            assert!(warnings[0].contains(warning), "{text}: {warnings:?}");
        }
        // [STRICT] Nor is a config that cannot be read, even one with an `off` in it.
        config("proposals: {python: off}\nexperimental: [\n");
        assert!(DriftConfig::load(root).is_err());
        assert_eq!(python_proposals(root, false), PythonProposals::Default);
        assert!(python_proposals(root, false).on());
    }

    /// Off, a Python proposal an earlier run wrote is dropped on read and a person's
    /// decision is kept; on (the default, and a config that cannot be read), nothing is.
    #[test]
    fn only_a_readable_off_drops_python_proposals_on_read() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let python = |id: &str| {
            let mut c = cand(id, 0.9);
            c.example = "app/a.py#f".into();
            c
        };
        let mut f = ConventionsFile::merge(
            None,
            "e1",
            FileKinds::default(),
            &[
                python("D-aaaaaa"),
                python("D-bbbbbb"),
                cand("D-cccccc", 0.9),
            ],
        );
        f.get_mut("D-bbbbbb").unwrap().status = Status::Accepted;
        f.save(root).unwrap();
        let ids = || -> Vec<String> {
            let mut ids: Vec<String> = ConventionsFile::load(root)
                .unwrap()
                .unwrap()
                .conventions
                .into_iter()
                .map(|c| c.id)
                .collect();
            ids.sort();
            ids
        };
        let all = ["D-aaaaaa", "D-bbbbbb", "D-cccccc"];
        assert_eq!(ids(), all, "no config");
        let config = root.join(CONFIG_FILE);
        std::fs::write(&config, "proposals: {python: off}\n").unwrap();
        assert_eq!(ids(), ["D-bbbbbb", "D-cccccc"], "off");
        std::fs::write(&config, "proposals: {python: on}\n").unwrap();
        assert_eq!(ids(), all, "on");
        std::fs::write(&config, "proposals: {python: off}\nexperimental: [\n").unwrap();
        assert_eq!(ids(), all, "a config that cannot be read");
    }
}
