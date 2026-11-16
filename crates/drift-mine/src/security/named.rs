//! Where the code of a directory names a service as a host ([`super::named_in_files`]),
//! looked through once for every name asked of it: each client of a service that is
//! built from the same code asks it of the same files (four applications built from
//! the repository's root ask it of every service they send to).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Text files looked through at most under one directory.
const MAX_FILES: usize = 3000;
/// Text kept at most for one directory, so a later question need not read a file
/// again. A file past it is read again each time it is asked of.
const MAX_KEPT: usize = 64 * 1024 * 1024;
/// The extensions of the files looked through (and every `.env*` file).
const TEXT: &[&str] = &[
    "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "py", "toml", "yaml", "yml", "env", "conf",
];

/// The text files under one directory, in the walk's order, read as far as the
/// questions asked of them needed: a later question reads only what no earlier one did.
pub(super) struct Walked {
    walk: ignore::Walk,
    /// The walk has ended.
    done: bool,
    /// Each text file read so far, with its text in lower case.
    files: Vec<(PathBuf, Text)>,
    /// The bytes of text kept in `files`, and the most that may be ([`MAX_KEPT`]).
    kept: usize,
    max_kept: usize,
    /// The directory has more than [`MAX_FILES`] text files.
    more: bool,
    /// The first file (by its place in `files`) that names each name asked so far as
    /// a host, or none.
    first: HashMap<String, Option<usize>>,
}

/// The text of one file of the walk.
enum Text {
    /// In lower case.
    Kept(String),
    /// Larger than 256 KiB, or it cannot be read: it names nothing.
    Unread,
    /// Read once and not kept ([`MAX_KEPT`]): read again where it is asked of.
    Again,
}

impl Walked {
    pub(super) fn new(root: &Path, dir: &str) -> Self {
        let walk = ignore::WalkBuilder::new(root.join(dir))
            .follow_links(false)
            .hidden(false)
            .git_global(false)
            .git_exclude(false)
            .require_git(false)
            .filter_entry(|e| e.file_name() != "node_modules" && e.file_name() != ".git")
            .sort_by_file_path(|a, b| a.cmp(b))
            .build();
        Walked {
            walk,
            done: false,
            files: Vec::new(),
            kept: 0,
            max_kept: MAX_KEPT,
            more: false,
            first: HashMap::new(),
        }
    }

    /// Reads the next text file of the walk; false at its end or past [`MAX_FILES`].
    fn read_next(&mut self) -> bool {
        if self.done || self.more {
            return false;
        }
        for e in self.walk.by_ref().filter_map(Result::ok) {
            let path = e.path();
            let text_file = path
                .extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| TEXT.contains(&x))
                || path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(".env"));
            if !text_file || !path.is_file() {
                continue;
            }
            if self.files.len() >= MAX_FILES {
                self.more = true;
                return false;
            }
            let text = match super::read_small(path).map(|t| t.to_lowercase()) {
                None => Text::Unread,
                Some(t) if self.kept + t.len() > self.max_kept => Text::Again,
                Some(t) => {
                    self.kept += t.len();
                    Text::Kept(t)
                }
            };
            self.files.push((path.to_path_buf(), text));
            return true;
        }
        self.done = true;
        false
    }

    /// Where a file of the directory names one of `names` as a host: `<file> names
    /// it` for the first in the walk's order, or that the directory has more files
    /// than are looked through, which counts as naming it. None when no file does.
    ///
    /// The first file that names any of them is the first of the files that name each
    /// one, and each service's names are asked again by every client: each name's is
    /// found once.
    pub(super) fn named(&mut self, root: &Path, dir: &str, names: &[String]) -> Option<String> {
        let at = names
            .iter()
            .filter(|n| !n.is_empty())
            .filter_map(|n| self.first_naming(std::slice::from_ref(n)))
            .min();
        if let Some(i) = at {
            let path = &self.files[i].0;
            let rel = path.strip_prefix(root).unwrap_or(path);
            return Some(format!(
                "{} names it",
                rel.to_string_lossy().replace('\\', "/")
            ));
        }
        // None of the files read names it: whether there are more than are looked
        // through is known at the walk's end.
        while self.read_next() {}
        self.more
            .then(|| format!("{dir} has more files than Drift looks through for its name"))
    }

    /// The first file that names the one name of `one` (not empty) as a host, read as
    /// far as needed.
    fn first_naming(&mut self, one: &[String]) -> Option<usize> {
        if let Some(&kept) = self.first.get(one[0].as_str()) {
            return kept;
        }
        let mut i = 0;
        let found = loop {
            if i == self.files.len() && !self.read_next() {
                break None;
            }
            let names = match &self.files[i] {
                (_, Text::Kept(t)) => super::names_host_lowered(t, one),
                (_, Text::Unread) => false,
                (path, Text::Again) => {
                    super::read_small(path).is_some_and(|t| super::names_host(&t, one))
                }
            };
            if names {
                break Some(i);
            }
            i += 1;
        };
        self.first.insert(one[0].clone(), found);
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins: one walk asked for several services' names, in any order, answers each as
    /// a walk made for that question alone does (the first file that names any of
    /// them, by the walk's order); and a name nothing names leaves the answer to the
    /// file count. The same holds where the text of a file is not kept.
    #[test]
    fn a_walk_asked_again_answers_as_a_fresh_one() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("app/src")).unwrap();
        std::fs::write(root.join("app/a.ts"), "fetch(\"http://WORKER:8000/x\")").unwrap();
        std::fs::write(root.join("app/src/b.py"), "URL = \"http://api:8000\"").unwrap();
        std::fs::write(root.join("app/src/c.json"), "{\"to\": \"redis://cache\"}").unwrap();
        std::fs::write(root.join("app/src/d.md"), "http://docs:80").unwrap();
        let names = |n: &[&str]| n.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let questions = [
            names(&["cache"]),
            names(&["api", "worker"]),
            names(&["api"]),
            names(&["docs"]),
            names(&["", "nobody"]),
            names(&[]),
            names(&["cache", "api"]),
        ];
        let fresh = |n: &[String]| Walked::new(root, "app").named(root, "app", n);
        assert_eq!(fresh(&questions[1]).as_deref(), Some("app/a.ts names it"));
        assert_eq!(
            fresh(&questions[2]).as_deref(),
            Some("app/src/b.py names it")
        );
        assert_eq!(fresh(&questions[3]), None);
        // The last two keep little or none of the text, and read a file again where asked.
        for (order, max_kept) in [(false, MAX_KEPT), (true, MAX_KEPT), (false, 30), (true, 0)] {
            let mut walked = Walked::new(root, "app");
            walked.max_kept = max_kept;
            let asked: Vec<&Vec<String>> = if order {
                questions.iter().rev().collect()
            } else {
                questions.iter().collect()
            };
            for n in asked {
                assert_eq!(walked.named(root, "app", n), fresh(n), "{n:?}");
            }
        }
    }
}
