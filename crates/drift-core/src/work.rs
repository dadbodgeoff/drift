//! How much work this process did, by kind: tree walks, files read, parses, scans,
//! config and policy loads. Counted always (an atomic add each, nothing else) and read
//! only by the hook trace (`DRIFT_HOOK_TRACE`), so that a test can pin what a hook does
//! by counts, which do not vary between machines as times do.

use std::sync::atomic::{AtomicU64, Ordering};

/// A kind of work counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Work {
    /// A walk of a repository's tree ([`crate::ingest::walk`]).
    Walk,
    /// A source file read from disk to know its content ([`crate::ingest::read_source_lang`]).
    SourceRead,
    /// A file parsed and lowered on a stack sized for it ([`crate::stack::with_stack_for`]):
    /// a source file whose facts the fact cache did not have, or a linter config.
    Parse,
    /// A scan of the whole repository.
    FullScan,
    /// A scan of the facts of one file.
    FileScan,
    /// `.drift/config.yaml` read from disk.
    ConfigLoad,
    /// `.drift/conventions.yaml` read from disk.
    PolicyLoad,
}

const KINDS: [(Work, &str); 7] = [
    (Work::Walk, "walks"),
    (Work::SourceRead, "source_reads"),
    (Work::Parse, "parses"),
    (Work::FullScan, "full_scans"),
    (Work::FileScan, "file_scans"),
    (Work::ConfigLoad, "config_loads"),
    (Work::PolicyLoad, "policy_loads"),
];

static COUNTS: [AtomicU64; KINDS.len()] = [const { AtomicU64::new(0) }; KINDS.len()];

fn slot(w: Work) -> usize {
    KINDS.iter().position(|(k, _)| *k == w).unwrap_or(0)
}

/// Count one piece of work of kind `w`.
pub fn note(w: Work) {
    COUNTS[slot(w)].fetch_add(1, Ordering::Relaxed);
}

/// How many of `w` this process did so far.
pub fn count(w: Work) -> u64 {
    COUNTS[slot(w)].load(Ordering::Relaxed)
}

/// Every count, by name, in a fixed order.
pub fn counts() -> Vec<(&'static str, u64)> {
    KINDS.iter().map(|(w, name)| (*name, count(*w))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_is_counted_apart() {
        let before = count(Work::PolicyLoad);
        let walks = count(Work::Walk);
        note(Work::PolicyLoad);
        note(Work::PolicyLoad);
        assert_eq!(count(Work::PolicyLoad), before + 2);
        assert!(count(Work::Walk) >= walks);
        let names: Vec<&str> = counts().into_iter().map(|(n, _)| n).collect();
        assert_eq!(names.len(), KINDS.len());
        assert!(names.contains(&"full_scans"));
    }
}
