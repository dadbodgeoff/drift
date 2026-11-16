//! S15b, item 6 (audit 5 G4): `drift map --json` shows what layering rests on. The
//! area graph and its one-way pairs come from `from_map::area_graph`, built as the
//! layering proposals build their graph; the map's entry-point figures say what they
//! count.

use drift_core::{FileFacts, Import, RepoFacts, Symbol, SymbolKind};
use drift_mine::from_map::{AreaEdge, OneWayPair, area_graph};
use drift_mine::roles::FileKinds;

fn file(path: &str, imports: &[&str]) -> FileFacts {
    let name = path
        .rsplit('/')
        .next()
        .unwrap()
        .trim_end_matches(".ts")
        .to_string();
    FileFacts {
        path: path.into(),
        lang: "ts".into(),
        parse_ok: true,
        imports: imports
            .iter()
            .map(|m| Import {
                module: (*m).into(),
                names: vec!["x".into()],
                type_only: false,
                load: Default::default(),
            })
            .collect(),
        symbols: vec![Symbol {
            name: name.clone(),
            kind: SymbolKind::Function,
            exported_as: vec![name],
            line: 1,
            ..Default::default()
        }],
        ..Default::default()
    }
}

/// `web/pages` (10 files, 6 of which import `lib/util`) over `lib/util` (10 files that
/// import nothing of `web`): one edge, one one-way pair. Before S15b nothing outside
/// `from_map::layering` could read either.
#[test]
fn the_area_graph_has_the_edge_and_the_one_way_pair() {
    let mut files = Vec::new();
    for i in 0..10 {
        let imports: &[&str] = if i < 6 { &["lib/util/u0.ts"] } else { &[] };
        files.push(file(&format!("web/pages/p{i}.ts"), imports));
        files.push(file(&format!("lib/util/u{i}.ts"), &[]));
    }
    let mut r = RepoFacts {
        files,
        ..Default::default()
    };
    r.normalize();
    let g = area_graph(&r, &FileKinds::default());
    assert_eq!(
        g.edges,
        vec![AreaEdge {
            from: "web/pages".into(),
            to: "lib/util".into(),
            files: 6,
        }]
    );
    assert_eq!(
        g.one_way,
        vec![OneWayPair {
            layer: "lib/util".into(),
            never_imports: "web/pages".into(),
            target_files: 10,
            reverse_files: 6,
            through: None,
        }]
    );
    let v = serde_json::to_value(&g).unwrap();
    assert_eq!(v["one_way"][0]["never_imports"], "web/pages");
    assert!(v["one_way"][0].get("through").is_none());
}
