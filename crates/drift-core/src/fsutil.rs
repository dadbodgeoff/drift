//! Writing files in a directory a repository may have planted links in.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

/// Write `bytes` to `path` atomically: into the temp file `tmp_name` next to it,
/// then renamed into place, so readers never see a torn file.
///
/// Whatever already has the temp name is removed first and the temp is created
/// with `create_new` (`O_CREAT | O_EXCL`), so a link planted at the temp name is
/// removed, never followed, and nothing outside is truncated. The rename then
/// replaces a link at `path` instead of following it. On failure the temp file
/// is removed.
pub fn write_atomic(path: &Path, tmp_name: &str, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let tmp = dir.join(tmp_name);
    let _ = fs::remove_file(&tmp);
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .and_then(|mut f| f.write_all(bytes))
        .and_then(|()| fs::rename(&tmp, path));
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written
}

/// The most [`read_regular`] reads of a configuration file Drift does not analyse
/// as source (`package.json`, `tsconfig.json`, `.gitattributes`, its own policy): far
/// above any real one, low enough that a hostile one cannot exhaust memory.
pub const MAX_CONFIG_BYTES: u64 = 64 * 1024 * 1024;

/// Read the regular file at `path` (a link to one is followed), refusing what a
/// repository can plant to hang or exhaust a reader: a FIFO, a device such as
/// `/dev/zero` or `/dev/stdin`, a socket or a directory, and a file of more than
/// `limit` bytes. The file is opened non-blocking and checked on the open
/// descriptor, so a FIFO never blocks the open and a swap after a check is caught.
/// Refusals are `InvalidInput` errors; callers treat them as an unreadable file.
pub fn read_regular(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    use std::io::Read;
    let mut opts = fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NONBLOCK);
    }
    let file = opts.open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    if meta.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "file too large",
        ));
    }
    let mut bytes = Vec::with_capacity(usize::try_from(meta.len()).unwrap_or(0));
    // A file that grows while read (or lies about its size) still stops at the limit.
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "file too large",
        ));
    }
    Ok(bytes)
}

/// [`read_regular`] of UTF-8 text (`InvalidData` when it is not UTF-8).
pub fn read_regular_to_string(path: &Path, limit: u64) -> io::Result<String> {
    String::from_utf8(read_regular(path, limit)?)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.json");
        write_atomic(&p, ".a.tmp", b"one").unwrap();
        write_atomic(&p, ".a.tmp", b"two").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        assert!(!dir.path().join(".a.tmp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_a_link_at_the_temp_name_or_the_target() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let victim = outside.path().join("victim");
        fs::write(&victim, "keep").unwrap();
        // A link planted where the temp file goes, and one at the target itself.
        symlink(&victim, dir.path().join(".a.tmp")).unwrap();
        symlink(&victim, dir.path().join("a.json")).unwrap();
        write_atomic(&dir.path().join("a.json"), ".a.tmp", b"forged").unwrap();
        assert_eq!(fs::read_to_string(&victim).unwrap(), "keep");
        let meta = fs::symlink_metadata(dir.path().join("a.json")).unwrap();
        assert!(
            meta.file_type().is_file(),
            "the link at the target was replaced"
        );
        assert_eq!(fs::read(dir.path().join("a.json")).unwrap(), b"forged");
        // A dangling link at the temp name: its target is never created.
        let missing = outside.path().join("created");
        fs::remove_file(dir.path().join(".a.tmp")).ok();
        symlink(&missing, dir.path().join(".a.tmp")).unwrap();
        write_atomic(&dir.path().join("a.json"), ".a.tmp", b"x").unwrap();
        assert!(!missing.exists());
    }

    #[test]
    fn reads_regular_files_and_links_to_them() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.json");
        fs::write(&p, "{}").unwrap();
        assert_eq!(read_regular(&p, 10).unwrap(), b"{}");
        assert_eq!(read_regular_to_string(&p, 2).unwrap(), "{}");
        let err = read_regular(&p, 1).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&p, dir.path().join("l.json")).unwrap();
            assert_eq!(read_regular(&dir.path().join("l.json"), 10).unwrap(), b"{}");
        }
        assert!(read_regular(dir.path(), 10).is_err(), "a directory");
        assert!(read_regular(&dir.path().join("missing"), 10).is_err());
    }

    /// A FIFO or a link to a device would block or never end: refused at once.
    #[cfg(unix)]
    #[test]
    fn refuses_fifos_and_devices_without_blocking() {
        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("package.json");
        let made = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .is_ok_and(|s| s.success());
        if made {
            let err = read_regular(&fifo, MAX_CONFIG_BYTES).unwrap_err();
            assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
        }
        let zero = dir.path().join(".gitattributes");
        std::os::unix::fs::symlink("/dev/zero", &zero).unwrap();
        let err = read_regular(&zero, MAX_CONFIG_BYTES).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
