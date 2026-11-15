//! The security inventory's example chain for a client leak (where to cut) follows a
//! re-export only for the names asked of the barrel, as the leak itself does: a
//! client that imports `Button` from a barrel re-exporting the database module, and
//! reaches the database through other code, is shown that other code.

use std::fs;
use std::path::Path;

use drift_mine::security::inventory;
use drift_ts::{ScanOptions, scan};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let p = root.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
}

fn example(files: &[(&str, &str)]) -> Vec<String> {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), files);
    let (facts, _) = scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let inv = inventory(&facts);
    let group = inv
        .client_leaks
        .iter()
        .find(|g| g.reaches == "lib/db.ts")
        .unwrap_or_else(|| panic!("no leak to lib/db.ts: {:?}", inv.client_leaks));
    group.example.clone()
}

const LIB: &[(&str, &str)] = &[
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
        "export { Button } from \"./button\";\nexport { db } from \"./db\";\n",
    ),
    (
        "lib/both-star.ts",
        "export * from \"./db\";\nexport * as server from \"./db\";\nexport { Button } from \"./button\";\n",
    ),
    (
        "lib/uses.ts",
        "import { db } from \"./named\";\nexport const q = () => db;\n",
    ),
];

#[test]
fn leak_chains_follow_reexports_name_by_name() {
    let with = |client: &str| {
        let mut files = LIB.to_vec();
        files.push(("c/a.tsx", client));
        example(&files)
    };
    // The name asked is forwarded from the database module: the chain goes through
    // the barrel.
    assert_eq!(
        with("\"use client\";\nimport { db } from \"../lib/index\";\n"),
        ["c/a.tsx", "lib/index.ts", "lib/db.ts"]
    );
    // So is a namespace re-export of it, next to `export *` from it.
    assert_eq!(
        with("\"use client\";\nimport { server } from \"../lib/both-star\";\n"),
        ["c/a.tsx", "lib/both-star.ts", "lib/db.ts"]
    );
    // A namespace import of a barrel asks for all of it.
    assert_eq!(
        with("\"use client\";\nimport * as lib from \"../lib/index\";\nexport const l = lib;\n"),
        ["c/a.tsx", "lib/index.ts", "lib/db.ts"]
    );
    // `Button` is not: the chain is the longer one through code that uses `db`,
    // not the shorter one through the barrel (`export *` and named re-exports alike).
    for barrel in ["index", "named"] {
        assert_eq!(
            with(&format!(
                "\"use client\";\nimport {{ Button }} from \"../lib/{barrel}\";\nimport {{ q }} from \"../lib/uses\";\n"
            )),
            ["c/a.tsx", "lib/uses.ts", "lib/named.ts", "lib/db.ts"],
            "{barrel}"
        );
    }
}
