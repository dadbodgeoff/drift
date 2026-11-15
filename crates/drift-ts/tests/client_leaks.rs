//! Client leaks through re-exports. A module a file imports only to re-export from it
//! (`export { x } from`, `export * from`, `export * as ns from`) is followed for the
//! names forwarded from it, not as a whole: a `"use client"` file importing `Button`
//! from a barrel that also re-exports the database module does not reach the
//! database, and one importing `db` does. `export *` from a module whose exports are
//! unknown (a package) is followed for every name not exported otherwise. A full scan
//! and a single-file scan (what the hooks run) agree.

use std::fs;
use std::path::Path;

use drift_core::{FileFacts, RepoFacts};
use drift_ts::{ScanOptions, scan, scan_file};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let p = root.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

const FILES: &[(&str, &str)] = &[
    ("package.json", r#"{ "name": "root" }"#),
    (
        "lib/db.ts",
        "import \"server-only\";\nexport const db = 1;\n",
    ),
    ("lib/button.ts", "export const Button = 1;\n"),
    (
        "lib/index.ts",
        "export * from \"./button\";\nexport * from \"./db\";\n",
    ),
    (
        "lib/named.ts",
        "export { Button } from \"./button\";\nexport { db as database } from \"./db\";\n",
    ),
    (
        "lib/ns.ts",
        "export * as server from \"./db\";\nexport { Button } from \"./button\";\n",
    ),
    ("lib/nested.ts", "export * from \"./index\";\n"),
    (
        "lib/pkg.ts",
        "export * from \"server-only\";\nexport { Button } from \"./button\";\n",
    ),
    (
        "lib/prisma.ts",
        "export { PrismaClient, Role } from \"@prisma/client\";\n",
    ),
    (
        "lib/uses.ts",
        "import { db } from \"./index\";\nexport const q = () => db;\n",
    ),
    (
        "lib/uses-button.ts",
        "import { Button } from \"./index\";\nexport const b = () => Button;\n",
    ),
    (
        "lib/local-pkg.ts",
        "export const Button = 1;\nexport * from \"server-only\";\n",
    ),
    (
        "lib/lazy.ts",
        "export { Button } from \"./button\";\nexport { db } from \"./db\";\nexport function load() {\n  return require(\"./db\");\n}\n",
    ),
    (
        "lib/both.ts",
        "import { db } from \"../lib/db\";\nexport { db as d2 } from \"./db\";\nexport const z = () => db;\n",
    ),
    (
        "lib/actions.ts",
        "\"use server\";\nexport * from \"./db\";\n",
    ),
];

/// Client files and the leaks each must report.
const CLIENTS: &[(&str, &str, &[&str])] = &[
    (
        "c/button.tsx",
        "import { Button } from \"../lib/index\";",
        &[],
    ),
    (
        "c/db.tsx",
        "import { db } from \"../lib/index\";",
        &["lib/db.ts"],
    ),
    (
        "c/named-button.tsx",
        "import { Button } from \"../lib/named\";",
        &[],
    ),
    (
        "c/named-db.tsx",
        "import { database } from \"../lib/named\";",
        &["lib/db.ts"],
    ),
    (
        "c/ns-button.tsx",
        "import { Button } from \"../lib/ns\";",
        &[],
    ),
    (
        "c/ns.tsx",
        "import { server } from \"../lib/ns\";",
        &["lib/db.ts"],
    ),
    // A namespace or side-effect import of a barrel loads all it forwards.
    (
        "c/star-import.tsx",
        "import * as lib from \"../lib/index\";\nexport const l = lib;",
        &["lib/db.ts"],
    ),
    ("c/side.tsx", "import \"../lib/index\";", &["lib/db.ts"]),
    (
        "c/nested-button.tsx",
        "import { Button } from \"../lib/nested\";",
        &[],
    ),
    (
        "c/nested-db.tsx",
        "import { db } from \"../lib/nested\";",
        &["lib/db.ts"],
    ),
    (
        "c/pkg-button.tsx",
        "import { Button } from \"../lib/pkg\";",
        &[],
    ),
    (
        "c/pkg-other.tsx",
        "import { other } from \"../lib/pkg\";",
        &["pkg:server-only"],
    ),
    ("c/role.tsx", "import { Role } from \"../lib/prisma\";", &[]),
    (
        "c/prisma.tsx",
        "import { PrismaClient } from \"../lib/prisma\";",
        &["pkg:@prisma/client"],
    ),
    // A name the module declares itself is not one it forwards.
    (
        "c/local-pkg.tsx",
        "import { Button } from \"../lib/local-pkg\";",
        &[],
    ),
    // A module the file's own code loads too is no re-export only.
    (
        "c/lazy.tsx",
        "import { Button } from \"../lib/lazy\";",
        &["lib/db.ts"],
    ),
    // ... nor one its code imports under another specifier.
    (
        "c/both.tsx",
        "import { z } from \"../lib/both\";",
        &["lib/db.ts"],
    ),
    // Code that uses a forwarded server name is server-only as a whole.
    (
        "c/uses.tsx",
        "import { q } from \"../lib/uses\";",
        &["lib/db.ts"],
    ),
    (
        "c/uses-button.tsx",
        "import { b } from \"../lib/uses-button\";",
        &[],
    ),
    // `"use server"` files are boundaries, re-exporting or not.
    (
        "c/action.tsx",
        "import { db } from \"../lib/actions\";",
        &[],
    ),
    // A client file's own re-exports are in its bundle.
    (
        "c/reexports.tsx",
        "export * from \"../lib/db\";",
        &["lib/db.ts"],
    ),
    (
        "c/reexport-button.tsx",
        "export { Button } from \"../lib/index\";",
        &[],
    ),
];

#[test]
fn client_leaks_follow_reexports_name_by_name() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), FILES);
    for (path, body, _) in CLIENTS {
        write(dir.path(), &[(path, &format!("\"use client\";\n{body}\n"))]);
    }
    let cache = dir.path().join(".cache");
    let opts = ScanOptions {
        cache_dir: Some(cache),
        threads: 1,
    };
    let (full, _) = scan(dir.path(), &opts).unwrap();
    for (path, _, leaks) in CLIENTS {
        assert_eq!(file(&full, path).client_leaks, *leaks, "{path}");
        let one = scan_file(dir.path(), &opts, path)
            .unwrap()
            .expect("single-file scan");
        assert_eq!(&one.files[0], file(&full, path), "{path}");
    }
}
