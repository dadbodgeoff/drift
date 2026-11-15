//! Names with non-ASCII letters: setting a release-stage prefix aside must not slice a
//! name inside a character (`créerUnÉlément`: byte 9 is inside `É`). Every name is
//! invented.

use drift_core::{FileFacts, RepoFacts, Symbol, SymbolKind};
use drift_mine::mine::{MineOptions, Rule, mine_unshown as mine, name_matches};

fn func(path: &str, name: &str) -> FileFacts {
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        symbols: vec![Symbol {
            name: name.into(),
            kind: SymbolKind::Function,
            exported_as: vec![name.into()],
            line: 1,
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn stage_prefixes_are_set_aside_on_character_boundaries() {
    // Both prefix lengths (9 and 13 bytes) fall inside a character of these names.
    for name in ["créerUnÉlément", "réglerLaQualitéÉlevée", "experimentalé_x"] {
        assert!(!name_matches(name, "build*"), "{name}");
    }
    assert!(name_matches("unstable_buildÉtat", "build*") == name_matches("buildÉtat", "build*"));
    assert!(name_matches("EXPERIMENTAL_buildState", "build*"));
    assert!(!name_matches("unstable_", "build*"));
}

#[test]
fn a_role_with_a_non_ascii_name_is_mined() {
    let mut files: Vec<FileFacts> = (0..30)
        .map(|i| {
            func(
                &format!("src/actions/thing{i}.ts"),
                &format!("buildThing{i}"),
            )
        })
        .collect();
    files.push(func("src/actions/creer.ts", "créerUnÉlément"));
    // Functions elsewhere, named otherwise: the pattern is rarer outside the role.
    files
        .extend((0..30).map(|i| func(&format!("src/lib/value{i}.ts"), &format!("formatValue{i}"))));
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    let cs = mine(&r, &MineOptions { max_per_repo: 200 }).candidates;
    let named = cs
        .iter()
        .find(|c| matches!(&c.rule, Rule::Named { pattern } if pattern == "build*"))
        .unwrap_or_else(|| {
            panic!(
                "functions in src/actions are named build*: {:?}",
                cs.iter()
                    .map(|c| (&c.role.dir, &c.rule))
                    .collect::<Vec<_>>()
            )
        });
    assert!(
        named.outliers.iter().any(|o| o.symbol == "créerUnÉlément"),
        "{:?}",
        named.outliers
    );
}
