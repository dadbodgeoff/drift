//! The hooks' reading of Windows paths and programs, pinned on every system: each case
//! gives the Windows form through the functions' inputs (a `C:\repo` root as text, read
//! in [`Style::Windows`] without the file system), so Linux CI holds what a native
//! Windows checkout does. Before, a shell write named `/c/repo/drift.lock` (Git Bash),
//! `.DRIFT/x`, `drift.lock.` or run by `rm.exe` was let through there, and so was a
//! policy change run as `drift.exe` or under `cmd /c` or `powershell -Command`.

use super::*;

fn win(cmd: &str, root: &str) -> Option<String> {
    let root = AbsPath::parse(root, Style::Windows).unwrap();
    let how = ShellPaths {
        style: Style::Windows,
        real: false,
    };
    shell_writes(cmd, &root, Some(root.clone()), how)
}

/// Pins the deny: every spelling of the root and of `.drift`/`drift.lock` a Windows
/// shell command may use, from Git Bash (the shell Claude Code runs there).
#[test]
fn windows_shell_writes_under_drift_are_seen() {
    for root in [r"C:\repo", r"\\?\C:\repo", "c:/Repo", "/c/repo"] {
        for cmd in [
            "echo x > .drift/cache/facts.json",
            r"echo x > '.drift\cache\facts.json'",
            "rm -rf C:/repo/.drift",
            r"rm -rf 'C:\repo\.drift\cache'",
            r#"rm -f "c:\REPO\drift.lock""#,
            "rm -f /c/repo/drift.lock",
            r"rm -rf '\\?\C:\repo\.drift'",
            "rm .DRIFT/conventions.yaml",
            "rm drift.lock.",
            "rm 'Drift.Lock '",
            "cd /c/repo/src && rm ../drift.lock",
            r"cd 'C:\repo\.drift' && rm conventions.yaml",
            "cd .drift; echo x > conventions.yaml",
            "rm.exe -rf .drift/cache",
            "/usr/bin/rm.exe -f drift.lock",
            r"'C:\Program Files\Git\usr\bin\rm.exe' -f drift.lock",
            "sed.exe -i s/a/b/ .drift/conventions.yaml",
        ] {
            assert!(win(cmd, root).is_some(), "{root}: {cmd}");
        }
    }
    // A share, as canonicalisation spells one (`\\?\UNC\…`) and as a command does.
    for cmd in [
        "rm -rf //server/share/repo/.drift",
        r"rm -rf '\\server\share\repo\.drift'",
        r"rm -f '\\?\UNC\SERVER\share\repo\drift.lock'",
    ] {
        assert!(win(cmd, r"\\?\UNC\server\share\repo").is_some(), "{cmd}");
    }
}

/// Pins what stays allowed: other drives, other repositories, reads, and paths Windows
/// places elsewhere (Git Bash's `/tmp` is under Git's own install; `C:x` is relative to
/// a directory the command does not name), which are not judged.
#[test]
fn windows_reads_and_other_places_are_allowed() {
    for cmd in [
        "cat .drift/conventions.yaml",
        "rm -rf /c/other/.drift",
        "rm -rf D:/repo/.drift",
        "rm -rf /tmp/.drift",
        "rm -rf C:repo/.drift",
        "rm -rf tests/fixtures/app/.drift",
        r"rm -rf 'C:\repo\tests\.drift'",
        "rm drift.lockfile",
        "cp .drift/conventions.yaml /c/backup.yaml",
        "cd /tmp && rm -rf .drift",
    ] {
        assert_eq!(win(cmd, r"C:\repo"), None, "{cmd}");
    }
}

/// Pins the difference: on Linux `\` is part of a name and names keep their case, so
/// what Windows reads as `.drift` is another file there.
#[test]
fn posix_reads_backslashes_and_case_as_names() {
    let posix = |cmd: &str| {
        let root = AbsPath::parse("/repo", Style::Posix).unwrap();
        let how = ShellPaths {
            style: Style::Posix,
            real: false,
        };
        shell_writes(cmd, &root, Some(root.clone()), how)
    };
    for cmd in [
        r"rm '.drift\x'",
        "rm .DRIFT/x",
        "rm drift.lock.",
        "rm -rf /c/repo/.drift",
    ] {
        assert_eq!(posix(cmd), None, "{cmd}");
        assert!(win(cmd, "/c/repo").is_some(), "{cmd}");
    }
}

/// Pins the Write and Edit deny on a repository path, as each system opens files.
#[test]
fn drift_state_names_fold_as_windows_opens_files() {
    let names = |rel: &str, style| state_names(&rel.split('/').collect::<Vec<_>>(), style);
    for rel in [
        ".DRIFT/conventions.yaml",
        "DRIFT.LOCK",
        "drift.lock.",
        ".drift",
    ] {
        assert!(names(rel, Style::Windows), "{rel}");
    }
    for rel in [".DRIFT/conventions.yaml", "DRIFT.LOCK", "drift.lock."] {
        assert!(!names(rel, Style::Posix), "{rel}");
    }
    for rel in ["src/drift.lock", "drift.lockx", "a/.drift/x", ""] {
        assert!(!names(rel, Style::Windows), "{rel}");
    }
    assert!(drift_state_rel(".drift/conventions.yaml") && drift_state_rel("drift.lock"));
}

/// Pins the policy deny for Windows programs: `drift.exe` and the npm `.cmd` shim by
/// any path, and the line `cmd /c` or PowerShell runs.
#[test]
fn windows_policy_changes_are_seen() {
    for (cmd, what) in [
        ("drift.exe init", "drift init"),
        ("drift.cmd review --accept D-x", "drift review --accept"),
        (
            "C:/Users/me/.cargo/bin/drift.exe review --accept D-x",
            "drift review --accept",
        ),
        (r"'C:\Users\me\.cargo\bin\drift.EXE' init", "drift init"),
        ("npx.cmd @dadbodgeoff/drift init", "drift init"),
        ("cmd //c drift init", "drift init"),
        (
            r#"cmd.exe /C "drift review --reject D-x""#,
            "drift review --reject",
        ),
        ("powershell -Command \"drift init\"", "drift init"),
        (
            "pwsh -c 'drift review --accept D-x'",
            "drift review --accept",
        ),
        ("powershell.exe -NoProfile -comm drift init", "drift init"),
    ] {
        assert_eq!(shell_policy_change(cmd).as_deref(), Some(what), "{cmd}");
    }
    for cmd in [
        "drift.exe check",
        "cmd /c drift card a.ts",
        "pwsh -c 'drift check'",
        "cmd /c dir",
    ] {
        assert_eq!(shell_policy_change(cmd), None, "{cmd}");
    }
    assert_eq!(program_name(r"C:\Git\usr\bin\rm.exe"), "rm");
    assert_eq!(program_name(".exe"), ".exe");
    assert_eq!(program_name("drift@next"), "drift@next");
}
