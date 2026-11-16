//! Reading and writing Drift's own files (`drift.lock`, `.drift/security.lock`,
//! `.drift/conventions.yaml`, `.drift/config.yaml`, the feedback marks, files a person
//! names to `--write`) only where the repository holds them.
//!
//! A repository can commit a symbolic link in place of any of them. Written through,
//! `.drift/conventions.yaml -> ~/.bashrc` overwrites the target; read through,
//! `.drift/security.lock -> /somewhere/else` makes `drift check` compare against a file
//! the change does not control and reviewers never see, so the gate decides on
//! nothing the pull request shows. Both are refused the same way: a link that stays
//! inside the repository (`CLAUDE.md -> AGENTS.md`) is followed, any other link on the
//! way is an error naming it, and a final link to nothing is an error too (a link is a
//! link: replacing it with a regular file would silently drop what a person set up,
//! and reading it as "no file" would silently drop a baseline). A refusal is an
//! error, never an empty file: the gate that reads it fails closed.
//!
//! Links are checked with `symlink_metadata`, which works on Windows too (a junction
//! reads as a link there); the tests that build links run on unix only.

use std::path::{Path, PathBuf};

use anyhow::Context;

/// Why a link is refused when it leaves the repository.
const OUTSIDE: &str = "that leads outside the repository";

/// Where `base/rel` really is (`base` is the repository root), for Drift to `verb`
/// (`read`, `write`) it: `base/rel` itself when no component of `rel` is a symbolic
/// link, else the link's destination when it stays inside `base`. An error names the
/// link and says why when it leads outside, or when `rel`'s final component is a link
/// to nothing.
pub fn resolve(base: &Path, rel: &Path, verb: &str) -> anyhow::Result<PathBuf> {
    let target = base.join(rel);
    let is_link = |p: &Path| std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink());
    let link = rel
        .ancestors()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| base.join(p))
        .find(|p| is_link(p));
    let Some(link) = link else {
        return Ok(target);
    };
    let refuse = |why: &str| {
        let after = if verb == "read" && why == OUTSIDE {
            ", so a check would compare against a file the repository does not hold"
        } else {
            ""
        };
        anyhow::anyhow!(
            "refusing to {verb} {}: {} is a symbolic link {why}{after}. Replace it with a regular file or directory.",
            target.display(),
            link.display()
        )
    };
    let root = base.canonicalize().map_err(|_| refuse(OUTSIDE))?;
    let resolved = match target.canonicalize() {
        Ok(p) => p,
        // The final component is a link to nothing: neither replaced nor read as absent.
        Err(_) if is_link(&target) => return Err(refuse("to a file that does not exist")),
        // A file not written yet in a directory reached through a link: where the
        // directory really is decides.
        Err(_) => match (target.parent(), target.file_name()) {
            (Some(dir), Some(name)) => dir.canonicalize().map_err(|_| refuse(OUTSIDE))?.join(name),
            _ => return Err(refuse(OUTSIDE)),
        },
    };
    if !resolved.starts_with(&root) {
        return Err(refuse(OUTSIDE));
    }
    Ok(resolved)
}

/// The text of Drift's file `base/rel`, `None` when there is none. A link that leaves
/// the repository, or a final link to nothing, is refused ([`resolve`]); anything else
/// that cannot be read is an error too, never an empty file: a FIFO or a link to
/// `/dev/zero` is refused without blocking or exhausting memory
/// ([`drift_core::fsutil::read_regular`]), as is text that is not UTF-8.
pub fn read(base: &Path, rel: &Path) -> anyhow::Result<Option<String>> {
    let p = resolve(base, rel, "read")?;
    match drift_core::fsutil::read_regular_to_string(&p, drift_core::fsutil::MAX_CONFIG_BYTES) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("reading {}", base.join(rel).display())),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    // Pins: a link inside the repository is followed, one leading out or to nothing
    // is refused for reading and writing, and no link at all reads as it always did.
    #[test]
    fn links_inside_are_followed_and_others_refused() {
        let repo = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let r = repo.path();
        std::fs::write(r.join("AGENTS.md"), "a").unwrap();
        symlink("AGENTS.md", r.join("CLAUDE.md")).unwrap();
        assert_eq!(
            read(r, Path::new("CLAUDE.md")).unwrap().as_deref(),
            Some("a")
        );
        assert_eq!(read(r, Path::new("none")).unwrap(), None);

        std::fs::write(out.path().join("x"), "outside").unwrap();
        symlink(out.path().join("x"), r.join("drift.lock")).unwrap();
        let e = format!("{:#}", read(r, Path::new("drift.lock")).unwrap_err());
        assert!(
            e.contains("refusing to read") && e.contains("leads outside"),
            "{e}"
        );

        symlink(r.join("missing"), r.join("dangling")).unwrap();
        for verb in ["read", "write"] {
            let e = format!("{:#}", resolve(r, Path::new("dangling"), verb).unwrap_err());
            assert!(e.contains("does not exist"), "{e}");
        }
    }
}
