use std::collections::HashSet;

use sha2::{Digest, Sha256};

use crate::{Fact, FactKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectDataAccessRule {
    pub convention_id: String,
    pub forbidden_imports: Vec<String>,
    pub severity: Severity,
    pub enforcement_mode: EnforcementMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectDataAccessViolation {
    pub convention_id: String,
    pub file_path: String,
    pub import_name: String,
    pub import_source: String,
    pub line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnforcementMode {
    Off,
    Brief,
    Warn,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnforcementResult {
    None,
    Warn,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleFinding {
    pub convention_id: String,
    pub fingerprint: String,
    pub title: String,
    pub message: String,
    pub severity: Severity,
    pub enforcement_result: EnforcementResult,
    pub file_path: String,
    pub import_name: String,
    pub import_source: String,
    pub line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaselineStatus {
    Active,
    Resolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineViolation {
    pub convention_id: String,
    pub fingerprint: String,
    pub status: BaselineStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FindingStatus {
    New,
    PreExisting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifiedFinding {
    pub finding: RuleFinding,
    pub status: FindingStatus,
}

pub fn detect_direct_data_access_imports(
    facts: &[Fact],
    rule: &DirectDataAccessRule,
) -> Vec<DirectDataAccessViolation> {
    let api_route_files: HashSet<&str> = facts
        .iter()
        .filter(|fact| fact.kind == FactKind::FileRoleDetected && fact.name == "api_route")
        .map(|fact| fact.file_path.as_str())
        .collect();

    facts
        .iter()
        .filter(|fact| fact.kind == FactKind::ImportUsed)
        .filter(|fact| api_route_files.contains(fact.file_path.as_str()))
        .filter_map(|fact| {
            let import_source = fact.value.as_ref()?;
            if !is_forbidden_import(import_source, &rule.forbidden_imports) {
                return None;
            }

            Some(DirectDataAccessViolation {
                convention_id: rule.convention_id.clone(),
                file_path: fact.file_path.clone(),
                import_name: fact.name.clone(),
                import_source: import_source.clone(),
                line: fact.start_line,
            })
        })
        .collect()
}

pub fn materialize_direct_data_access_findings(
    facts: &[Fact],
    rule: &DirectDataAccessRule,
) -> Vec<RuleFinding> {
    detect_direct_data_access_imports(facts, rule)
        .into_iter()
        .map(|violation| RuleFinding {
            fingerprint: direct_data_access_fingerprint(&violation),
            title: "API route imports data access directly".to_string(),
            message: format!(
                "{} imports {} from {} directly; route modules should delegate through the accepted service/data-access layer.",
                violation.file_path, violation.import_name, violation.import_source
            ),
            severity: rule.severity,
            enforcement_result: enforcement_result_for(rule.enforcement_mode),
            convention_id: violation.convention_id,
            file_path: violation.file_path,
            import_name: violation.import_name,
            import_source: violation.import_source,
            line: violation.line,
        })
        .collect()
}

pub fn classify_findings_against_baseline(
    findings: Vec<RuleFinding>,
    baseline: &[BaselineViolation],
) -> Vec<ClassifiedFinding> {
    let active_baseline: HashSet<(&str, &str)> = baseline
        .iter()
        .filter(|violation| violation.status == BaselineStatus::Active)
        .map(|violation| {
            (
                violation.convention_id.as_str(),
                violation.fingerprint.as_str(),
            )
        })
        .collect();

    findings
        .into_iter()
        .map(|finding| {
            let status = if active_baseline
                .contains(&(finding.convention_id.as_str(), finding.fingerprint.as_str()))
            {
                FindingStatus::PreExisting
            } else {
                FindingStatus::New
            };

            ClassifiedFinding { finding, status }
        })
        .collect()
}

fn is_forbidden_import(import_source: &str, forbidden_imports: &[String]) -> bool {
    forbidden_imports
        .iter()
        .any(|forbidden| import_source == forbidden || import_source.contains(forbidden))
}

fn direct_data_access_fingerprint(violation: &DirectDataAccessViolation) -> String {
    let normalized_path = violation.file_path.replace('\\', "/");
    let mut hasher = Sha256::new();
    hasher.update(b"direct-data-access-v1\0");
    hasher.update(violation.convention_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(normalized_path.as_bytes());
    hasher.update(b"\0");
    hasher.update(violation.import_name.as_bytes());
    hasher.update(b"\0");
    hasher.update(violation.import_source.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn enforcement_result_for(mode: EnforcementMode) -> EnforcementResult {
    match mode {
        EnforcementMode::Off | EnforcementMode::Brief => EnforcementResult::None,
        EnforcementMode::Warn => EnforcementResult::Warn,
        EnforcementMode::Block => EnforcementResult::Block,
    }
}
