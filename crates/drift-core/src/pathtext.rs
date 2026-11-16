//! Paths as text, read the way a given system reads them.
//!
//! A hook decides whether a path a shell command names is the repository's `.drift/` by
//! comparing it with the root. `std::path` reads a path only as the system it runs on
//! does, so how Windows reads one (a drive, a `\\?\` verbatim prefix, a UNC share, `/`
//! and `\` both separators, names equal whatever their case or a trailing dot) could be
//! checked nowhere but on Windows, and a Git Bash path (`/c/repo`) was read as `C:\c\repo`.
//! Here the system is an argument ([`Style`]): tests on Linux pin the Windows reading,
//! and callers that touch the file system pass [`Style::HOST`].

/// Which system's rules a path is read by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    /// `/` separates names, and names compare exactly.
    Posix,
    /// `/` and `\` separate names; a path is anchored at a drive (`C:\`), a share
    /// (`\\server\share\`) or a verbatim prefix (`\\?\`); names compare as Windows opens
    /// them: without case, and without a trailing dot or space.
    Windows,
}

impl Style {
    /// The style of the system Drift runs on.
    pub const HOST: Style = if cfg!(windows) {
        Style::Windows
    } else {
        Style::Posix
    };

    fn is_sep(self, c: char) -> bool {
        c == '/' || (self == Style::Windows && c == '\\')
    }
}

/// An absolute path, lexically normal (no `.`, no `..`, no empty name): what it is
/// anchored at and the names under that.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AbsPath {
    style: Style,
    /// Posix: empty (the root). Windows: `C:` (the letter upper case), `\\server\share`,
    /// or `\\?\<name>` for a verbatim prefix that is neither (a volume).
    anchor: String,
    names: Vec<String>,
}

impl AbsPath {
    /// `text` when it is an absolute path in `style`, else `None`: a relative path, and
    /// on Windows a path the text alone cannot place (`C:x`, relative to that drive's
    /// own directory; `\x` and `/tmp`, on the current drive or, from Git Bash, under
    /// Git's own install). Git Bash's `/c/repo` is `C:\repo`. `..` takes off a name but
    /// never the anchor, as the system does.
    pub fn parse(text: &str, style: Style) -> Option<AbsPath> {
        let at = |anchor: String| AbsPath {
            style,
            anchor,
            names: Vec::new(),
        };
        if style == Style::Posix {
            let mut p = at(String::new());
            p.push_text(text.strip_prefix('/')?);
            return Some(p);
        }
        if let Some(v) = text.strip_prefix(r"\\?\") {
            // Verbatim: only `\` separates, and every name is taken as written.
            let (head, rest) = v.split_once('\\').unwrap_or((v, ""));
            let (mut p, rest) = if head.eq_ignore_ascii_case("UNC") {
                let mut parts = rest.splitn(3, '\\');
                let (server, share) = (parts.next()?, parts.next()?);
                if server.is_empty() || share.is_empty() {
                    return None;
                }
                (
                    at(format!(r"\\{server}\{share}")),
                    parts.next().unwrap_or(""),
                )
            } else if let Some(drive) = drive(head).filter(|_| head.len() == 2) {
                (at(drive), rest)
            } else if head.is_empty() {
                return None;
            } else {
                (at(format!(r"\\?\{head}")), rest)
            };
            p.names = rest
                .split('\\')
                .filter(|n| !n.is_empty())
                .map(String::from)
                .collect();
            return Some(p);
        }
        let b = text.as_bytes();
        let sep = |i: usize| b.get(i).is_some_and(|&c| style.is_sep(c as char));
        if sep(0) && sep(1) {
            // A share, `\\server\share\…` or `//server/share/…`; `\\.\` (devices) is not read.
            let mut parts = text[2..].splitn(3, |c| style.is_sep(c));
            let (server, share) = (parts.next()?, parts.next()?);
            if server.is_empty() || share.is_empty() || server == "." || server == "?" {
                return None;
            }
            let mut p = at(format!(r"\\{server}\{share}"));
            p.push_text(parts.next().unwrap_or(""));
            return Some(p);
        }
        if let Some(drive) = drive(text) {
            // `C:\x` and `C:/x`; `C:` and `C:x` name the drive's current directory.
            if !sep(2) {
                return None;
            }
            let mut p = at(drive);
            p.push_text(&text[2..]);
            return Some(p);
        }
        let git_bash_drive = b.first() == Some(&b'/')
            && b.get(1).is_some_and(u8::is_ascii_alphabetic)
            && (b.len() == 2 || b[2] == b'/');
        if git_bash_drive {
            // Git Bash: `/c/x` is `C:\x`.
            let mut p = at(format!("{}:", (b[1] as char).to_ascii_uppercase()));
            p.push_text(&text[2..]);
            return Some(p);
        }
        None
    }

    /// `word` as an absolute path: itself when absolute, else under `cwd`. `None` when
    /// it cannot be known: relative with no `cwd`, or a Windows path [`Self::parse`]
    /// cannot place.
    pub fn resolve(cwd: Option<&AbsPath>, word: &str, style: Style) -> Option<AbsPath> {
        if let Some(p) = Self::parse(word, style) {
            return Some(p);
        }
        let placed_elsewhere =
            style == Style::Windows && (word.starts_with(['/', '\\']) || drive(word).is_some());
        if placed_elsewhere {
            return None;
        }
        let mut p = cwd?.clone();
        p.push_text(word);
        Some(p)
    }

    /// Lay the names of the relative path `text` on this one.
    fn push_text(&mut self, text: &str) {
        let style = self.style;
        for name in text.split(|c| style.is_sep(c)) {
            match name {
                "" | "." => {}
                ".." => {
                    self.names.pop();
                }
                n => self.names.push(n.to_string()),
            }
        }
    }

    /// Add one name, taken as written.
    pub fn push(&mut self, name: &str) {
        self.names.push(name.to_string());
    }

    pub fn names(&self) -> &[String] {
        &self.names
    }

    /// This path with only its first `n` names.
    pub fn ancestor(&self, n: usize) -> AbsPath {
        AbsPath {
            names: self.names[..n.min(self.names.len())].to_vec(),
            ..self.clone()
        }
    }

    /// The names of this path below `root` when it is `root` or under it, compared as its
    /// style compares them ([`same_name`]).
    pub fn under(&self, root: &AbsPath) -> Option<&[String]> {
        let style = self.style;
        let anchor = match style {
            Style::Posix => self.anchor == root.anchor,
            Style::Windows => self.anchor.to_lowercase() == root.anchor.to_lowercase(),
        };
        let inside = style == root.style
            && anchor
            && self.names.len() >= root.names.len()
            && root
                .names
                .iter()
                .zip(&self.names)
                .all(|(a, b)| same_name(a, b, style));
        inside.then(|| &self.names[root.names.len()..])
    }

    /// The path as its system spells it (`/a/b`, `C:\a\b`, `\\server\share\a`).
    pub fn to_native(&self) -> String {
        match self.style {
            Style::Posix => format!("/{}", self.names.join("/")),
            Style::Windows => format!("{}\\{}", self.anchor, self.names.join("\\")),
        }
    }
}

/// `C:` for a text that starts with a drive letter and a colon.
fn drive(text: &str) -> Option<String> {
    let b = text.as_bytes();
    (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
        .then(|| format!("{}:", (b[0] as char).to_ascii_uppercase()))
}

/// Whether two file names name the same file in `style`. Windows opens a name without
/// regard to case and drops a trailing dot or space (`DRIFT.LOCK` and `drift.lock.` are
/// `drift.lock`), so a name that differs only so is the same file there.
pub fn same_name(a: &str, b: &str, style: Style) -> bool {
    match style {
        Style::Posix => a == b,
        Style::Windows => {
            let fold = |n: &str| {
                let t = n.trim_end_matches(['.', ' ']);
                (if t.is_empty() { n } else { t }).to_lowercase()
            };
            fold(a) == fold(b)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(s: &str) -> Option<String> {
        AbsPath::parse(s, Style::Windows).map(|p| p.to_native())
    }

    /// Pins every form a Windows path takes reading as one: both separators, the drive
    /// letter's case, `\\?\` verbatim, a share, and Git Bash's `/c/`.
    #[test]
    fn windows_forms_read_as_one_path() {
        for s in [
            r"C:\repo\.drift",
            "C:/repo/.drift",
            r"c:\repo\x\..\.drift\.",
            r"\\?\C:\repo\.drift",
            "/c/repo/.drift",
            r"C:\\repo\\.drift",
        ] {
            assert_eq!(win(s).as_deref(), Some(r"C:\repo\.drift"), "{s}");
        }
        for s in [
            r"\\server\share\repo",
            "//server/share/repo",
            r"\\?\UNC\server\share\repo",
        ] {
            assert_eq!(win(s).as_deref(), Some(r"\\server\share\repo"), "{s}");
        }
        assert_eq!(
            win(r"\\?\Volume{0a}\repo").as_deref(),
            Some(r"\\?\Volume{0a}\repo")
        );
        // What the text alone cannot place.
        for s in [
            "C:repo",
            "C:",
            r"\repo",
            "/tmp/x",
            r"\\.\C:\x",
            "repo",
            "",
            r"\\server",
        ] {
            assert_eq!(win(s), None, "{s}");
        }
        // `..` never climbs above the anchor.
        assert_eq!(win(r"C:\..\..\x").as_deref(), Some(r"C:\x"));
    }

    /// Pins the Posix reading: `\` is part of a name and `/c/x` is a directory `c`.
    #[test]
    fn posix_reads_only_slash() {
        let p = AbsPath::parse(r"/c/repo\.drift", Style::Posix).unwrap();
        assert_eq!(p.names(), ["c", r"repo\.drift"]);
        assert_eq!(AbsPath::parse(r"C:\repo", Style::Posix), None);
        assert_eq!(p.to_native(), r"/c/repo\.drift");
    }

    /// Pins resolution against a working directory, and what stays unknown.
    #[test]
    fn relative_words_resolve_against_the_directory() {
        let cwd = AbsPath::parse(r"C:\repo\src", Style::Windows).unwrap();
        let r = |w: &str| AbsPath::resolve(Some(&cwd), w, Style::Windows).map(|p| p.to_native());
        assert_eq!(r(r"..\drift.lock").as_deref(), Some(r"C:\repo\drift.lock"));
        assert_eq!(r("../.drift/x").as_deref(), Some(r"C:\repo\.drift\x"));
        assert_eq!(r("D:/x").as_deref(), Some(r"D:\x"));
        assert_eq!(r("/tmp/x"), None);
        assert_eq!(r("C:x"), None);
        assert_eq!(AbsPath::resolve(None, "x", Style::Windows), None);
        let posix = AbsPath::parse("/repo", Style::Posix).unwrap();
        assert_eq!(
            AbsPath::resolve(Some(&posix), "a/../b", Style::Posix).map(|p| p.to_native()),
            Some("/repo/b".to_string())
        );
    }

    /// Pins comparison: a Windows path is under its root whatever the case, the spelling
    /// of the anchor or a trailing dot; a Posix one only exactly.
    #[test]
    fn under_compares_as_the_system_opens_files() {
        let root = AbsPath::parse(r"\\?\C:\Repo", Style::Windows).unwrap();
        let p = AbsPath::parse("c:/repo./.DRIFT/x", Style::Windows).unwrap();
        assert_eq!(p.under(&root).unwrap(), [".DRIFT", "x"]);
        assert!(same_name(".DRIFT", ".drift", Style::Windows));
        assert!(same_name("drift.lock. ", "drift.lock", Style::Windows));
        assert!(!same_name("drift.lockx", "drift.lock", Style::Windows));
        assert!(!same_name(".DRIFT", ".drift", Style::Posix));
        let other = AbsPath::parse(r"D:\Repo\.drift", Style::Windows).unwrap();
        assert_eq!(other.under(&root), None);
        let share = AbsPath::parse(r"\\?\UNC\srv\Share\repo", Style::Windows).unwrap();
        let q = AbsPath::parse("//SRV/share/repo/drift.lock", Style::Windows).unwrap();
        assert_eq!(q.under(&share).unwrap(), ["drift.lock"]);
        let proot = AbsPath::parse("/Repo", Style::Posix).unwrap();
        let pp = AbsPath::parse("/repo/.drift", Style::Posix).unwrap();
        assert_eq!(pp.under(&proot), None);
        assert_eq!(pp.ancestor(1).to_native(), "/repo");
    }
}
