use std::collections::{HashMap, HashSet};

use crate::RuleFinding;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDiff {
    pub files: Vec<DiffFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffFile {
    pub path: String,
    pub changed_lines: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffScope {
    ChangedHunks,
    ChangedFiles,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffStatus {
    NewInDiff,
    TouchedExisting,
    OutsideDiff,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffClassifiedFinding {
    pub finding: RuleFinding,
    pub diff_status: DiffStatus,
}

pub fn parse_unified_diff(input: &str) -> ParsedDiff {
    let mut files = Vec::new();
    let mut current_file: Option<DiffFile> = None;
    let mut current_new_line: Option<usize> = None;

    for line in input.lines() {
        if let Some(path) = line.strip_prefix("+++ ") {
            if let Some(file) = current_file.take() {
                files.push(file);
            }

            let normalized = normalize_diff_path(path);
            current_file = normalized.map(|path| DiffFile {
                path,
                changed_lines: Vec::new(),
            });
            current_new_line = None;
            continue;
        }

        if let Some(header) = line.strip_prefix("@@ ") {
            current_new_line = parse_hunk_new_start(header);
            continue;
        }

        let Some(new_line) = current_new_line.as_mut() else {
            continue;
        };

        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }

        if line.starts_with('+') {
            if let Some(file) = current_file.as_mut() {
                file.changed_lines.push(*new_line);
            }
            *new_line += 1;
        } else if line.starts_with('-') {
            continue;
        } else if line.starts_with(' ') {
            *new_line += 1;
        }
    }

    if let Some(file) = current_file {
        files.push(file);
    }

    ParsedDiff { files }
}

pub fn classify_findings_against_diff(
    findings: Vec<RuleFinding>,
    diff: &ParsedDiff,
    scope: DiffScope,
) -> Vec<DiffClassifiedFinding> {
    let changed_files: HashSet<&str> = diff.files.iter().map(|file| file.path.as_str()).collect();
    let changed_lines_by_file: HashMap<&str, HashSet<usize>> = diff
        .files
        .iter()
        .map(|file| {
            (
                file.path.as_str(),
                file.changed_lines.iter().copied().collect::<HashSet<_>>(),
            )
        })
        .collect();

    findings
        .into_iter()
        .map(|finding| {
            let diff_status = match scope {
                DiffScope::Full => DiffStatus::TouchedExisting,
                DiffScope::ChangedFiles => {
                    if changed_files.contains(finding.file_path.as_str()) {
                        DiffStatus::TouchedExisting
                    } else {
                        DiffStatus::OutsideDiff
                    }
                }
                DiffScope::ChangedHunks => changed_hunk_status(&finding, &changed_lines_by_file),
            };

            DiffClassifiedFinding {
                finding,
                diff_status,
            }
        })
        .collect()
}

fn changed_hunk_status(
    finding: &RuleFinding,
    changed_lines_by_file: &HashMap<&str, HashSet<usize>>,
) -> DiffStatus {
    let Some(lines) = changed_lines_by_file.get(finding.file_path.as_str()) else {
        return DiffStatus::OutsideDiff;
    };

    if lines.contains(&finding.line) {
        DiffStatus::NewInDiff
    } else {
        DiffStatus::TouchedExisting
    }
}

fn parse_hunk_new_start(header: &str) -> Option<usize> {
    let new_range = header
        .split_whitespace()
        .find(|part| part.starts_with('+'))?;
    let start = new_range
        .trim_start_matches('+')
        .split(',')
        .next()
        .unwrap_or_default();
    start.parse::<usize>().ok()
}

fn normalize_diff_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed == "/dev/null" {
        return None;
    }

    let without_prefix = trimmed
        .strip_prefix("b/")
        .or_else(|| trimmed.strip_prefix("a/"))
        .unwrap_or(trimmed);
    Some(without_prefix.to_string())
}
