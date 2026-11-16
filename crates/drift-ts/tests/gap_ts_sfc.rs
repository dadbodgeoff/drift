//! Single-file components (Vue, Svelte, Astro): their script blocks are read as one
//! module each, at the lines and columns of the file, into the listed reading only.
//! Before, `.vue`, `.svelte` and `.astro` files were never walked: none of these
//! facts existed.

use std::fs;
use std::path::Path;

use drift_core::{RepoFacts, SkipReason};
use drift_ts::lower::RawFile;
use drift_ts::sfc::{Kind, Script, extract, lower_component_on_stack};
use drift_ts::{ScanOptions, scan};

fn lower(path: &str, text: &str) -> RawFile {
    lower_component_on_stack(path, text).expect("stack")
}

fn specs(raw: &RawFile) -> Vec<&str> {
    let mut s: Vec<&str> = raw.imports.iter().map(|i| i.spec.as_str()).collect();
    s.sort();
    s
}

fn line_of(raw: &RawFile, symbol: &str) -> u32 {
    raw.symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("no symbol {symbol}: {:?}", raw.symbols))
        .line
}

/// The script has the file's length and line breaks, each block's bytes where they
/// were, and nothing else but spaces (and the `;` that opens a later block).
fn assert_positions(text: &str, script: &Script) {
    assert_eq!(script.text.len(), text.len());
    let mut kept = vec![false; text.len()];
    for &(a, b) in &script.blocks {
        assert_eq!(&script.text[a..b], &text[a..b]);
        kept[a..b].iter_mut().for_each(|k| *k = true);
    }
    for (i, (o, n)) in text.bytes().zip(script.text.bytes()).enumerate() {
        if o == b'\n' || o == b'\r' {
            assert_eq!(o, n, "line break at {i}");
        } else if !kept[i] {
            assert!(n == b' ' || n == b';', "byte {i} kept outside the blocks");
        }
    }
}

const VUE: &str = r#"<template>
  <div :title="'<script>'" v-if="a > b">
    <!-- <script>alert(1)</script> -->
    <template v-if="x"><span>{{ count }}</span></template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
export default defineComponent({ name: 'Counter' })
</script>

<script setup lang="ts">
import { api } from './api'
const props = defineProps<{ id: string }>()
function load() {
  return api.fetchItem(props.id)
}
</script>

<style scoped>
.a { color: red }
</style>
"#;

/// Pins: both Vue blocks are one module (the setup block's bindings beside the
/// other's default export); the template, a script tag in a comment or an attribute
/// value and the style are not read; lines are the file's.
#[test]
fn vue_reads_both_script_blocks_as_one_module_at_the_files_lines() {
    let script = extract(Kind::Vue, VUE).expect("delimited");
    assert!(script.typescript);
    assert_eq!(script.blocks.len(), 2);
    assert_positions(VUE, &script);
    let raw = lower("src/Counter.vue", VUE);
    assert!(raw.skip.is_none() && raw.parse_ok, "{raw:?}");
    assert_eq!(specs(&raw), ["./api", "vue"]);
    assert!(raw.exports.iter().any(|e| e.name == "default"));
    assert_eq!(line_of(&raw, "load"), 16);
    // Nothing of the comment's script is read.
    assert!(!script.text.contains("alert"));
}

const SVELTE: &str = r#"<script context="module" lang="ts">
  export const prerender = true;
  export function helper(x: number) { return x * 2 }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { getUser } from '$lib/api';
  export let name: string;
  let user = null;
  onMount(async () => { user = await getUser(name) });
</script>

<svelte:head><script>window.dataLayer = [];</script></svelte:head>
<h1 class={name ? "a" : "b"}>{name} {"<script>"} {a<b}</h1>
{#if user}<p>{user.name}</p>{/if}
<style>h1 { color: red }</style>
"#;

/// Pins: the module script and the instance script are read, an instance `export`
/// is a property (not a module export), and a script inside an element of the
/// markup (`<svelte:head>`) or a string of an expression is no block.
#[test]
fn svelte_reads_the_module_and_instance_scripts() {
    let script = extract(Kind::Svelte, SVELTE).expect("delimited");
    assert!(script.typescript);
    assert_eq!(script.blocks.len(), 2);
    assert_eq!(script.text.len(), SVELTE.len());
    assert!(!script.text.contains("dataLayer"));
    let raw = lower("src/routes/+page.svelte", SVELTE);
    assert!(raw.skip.is_none() && raw.parse_ok, "{raw:?}");
    assert_eq!(specs(&raw), ["$lib/api", "svelte"]);
    let mut exports: Vec<&str> = raw.exports.iter().map(|e| e.name.as_str()).collect();
    exports.sort();
    assert_eq!(exports, ["helper", "prerender"]);
    assert_eq!(line_of(&raw, "helper"), 3);
}

const ASTRO: &str = r#"---
import Layout from '../layouts/Layout.astro';
import { db } from '../lib/db';
const user = await db.user.find(Astro.params.id);
if (!user) return Astro.redirect('/404');
---
<Layout title={user.name > "" ? "x" : "y"}>
  <h1>{user.name}</h1>
  <script>
    import { track } from '../lib/track';
    track('view');
  </script>
  <script is:inline>window.inline = 1</script>
</Layout>
"#;

/// Pins: the frontmatter (with its top-level `return`) and a bundled script are
/// read; an `is:inline` script is markup.
#[test]
fn astro_reads_the_frontmatter_and_bundled_scripts() {
    let script = extract(Kind::Astro, ASTRO).expect("delimited");
    assert_eq!(script.blocks.len(), 2);
    assert_positions(ASTRO, &script);
    assert!(!script.text.contains("window.inline"));
    let raw = lower("src/pages/[id].astro", ASTRO);
    assert!(raw.skip.is_none() && raw.parse_ok, "{raw:?}");
    assert_eq!(
        specs(&raw),
        ["../layouts/Layout.astro", "../lib/db", "../lib/track"]
    );
}

/// Pins: an Astro script is a module of its own: one that declares a name the
/// frontmatter declares is left out, not read as the same binding.
#[test]
fn an_astro_script_whose_names_collide_is_left_out() {
    let text = "---\nimport { a } from './a';\nconst title = a();\n---\n<script>\nimport { b } from './b';\nconst title = b();\n</script>\n<script>\nimport { c } from './c';\nc();\n</script>\n";
    let raw = lower("src/pages/x.astro", text);
    assert!(raw.parse_ok, "{raw:?}");
    assert_eq!(specs(&raw), ["./a", "./c"]);
}

/// Pins: a byte order mark and CRLF line breaks keep the file's lines.
#[test]
fn bom_and_crlf_keep_lines() {
    let text = "\u{feff}<script setup>\r\nimport { x } from './x'\r\n\r\nfunction f() {\r\n  return x()\r\n}\r\n</script>\r\n<template><p>{{ f() }}</p></template>\r\n";
    let script = extract(Kind::Vue, text).expect("delimited");
    assert_positions(text, &script);
    let raw = lower("src/A.vue", text);
    assert!(raw.parse_ok, "{raw:?}");
    assert_eq!(line_of(&raw, "f"), 4);
}

/// Pins: a file whose blocks cannot be delimited with certainty is skipped with its
/// reason, never read with a guess.
#[test]
fn undelimited_blocks_are_skipped_with_a_reason() {
    let cases = [
        ("a.vue", "<script>\nconst a = 1\n"),
        (
            "b.vue",
            "<script setup>const a = 1</script>\n<script setup>const b = 2</script>\n",
        ),
        ("c.vue", "<script lang=\"coffee\">a = 1</script>\n"),
        (
            "d.vue",
            "<script lang=\"ts\">export default {}</script>\n<script setup>const b = 2</script>\n",
        ),
        (
            "e.svelte",
            "<div><span></div>\n<script>let a = 1</script>\n",
        ),
        ("f.astro", "---\nconst a = 1\n<p>{a}</p>\n"),
        ("g.vue", "<template><div title=\"x></template>\n"),
    ];
    for (path, text) in cases {
        let raw = lower(path, text);
        assert_eq!(raw.skip, Some(SkipReason::ComponentScript), "{path}");
    }
}

fn repo(dir: &Path, files: &[(&str, &str)]) -> RepoFacts {
    for (path, text) in files {
        let p = dir.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

const FILES: &[(&str, &str)] = &[
    (
        "src/api.ts",
        "export function fetchItem(id: string) {\n  return fetch(`/api/items/${id}`);\n}\n",
    ),
    (
        "src/Widget.vue",
        "<script setup lang=\"ts\">\nimport { fetchItem } from './api'\nfunction run(code: string) {\n  fetchItem(code)\n  return eval(code)\n}\n</script>\n<template><button @click=\"run('1')\">go</button></template>\n",
    ),
    (
        "src/main.ts",
        "import Widget from './Widget.vue';\nexport function mount() {\n  return Widget;\n}\n",
    ),
    ("src/Broken.svelte", "<script>\nlet a = 1\n"),
];

/// Pins: a component is in the listed reading with its imports resolved and its
/// calls linked to what it imports; a `.ts` import of it resolves to it; a component
/// that cannot be delimited is skipped there with its reason; and what mining reads
/// (`files`, `skipped`) is what a scan that walks no component reads.
#[test]
fn components_are_listed_only_and_mining_reads_the_same() {
    let with = tempfile::tempdir().expect("tempdir");
    let r = repo(with.path(), FILES);
    assert!(r.files.iter().all(|f| !f.path.ends_with(".vue")));
    let widget = r
        .listed_files
        .iter()
        .find(|f| f.path == "src/Widget.vue")
        .expect("listed");
    assert!(widget.parse_ok);
    assert!(
        widget.imports.iter().any(|i| i.module == "src/api.ts"),
        "{:?}",
        widget.imports
    );
    let run = widget
        .symbols
        .iter()
        .find(|s| s.name == "run")
        .expect("run");
    assert_eq!(run.line, 3);
    assert!(run.sinks.iter().any(|s| s == "eval"), "{:?}", run.sinks);
    assert!(
        run.calls.iter().any(|c| c == "src/api.ts#fetchItem"),
        "{:?}",
        run.calls
    );
    let main = r.files.iter().find(|f| f.path == "src/main.ts").unwrap();
    assert!(main.imports.iter().any(|i| i.module == "src/Widget.vue"));
    assert_eq!(
        r.listed_skipped
            .iter()
            .map(|s| (s.path.as_str(), s.reason))
            .collect::<Vec<_>>(),
        [("src/Broken.svelte", SkipReason::ComponentScript)]
    );
    assert!(r.skipped.is_empty(), "{:?}", r.skipped);
    let listed = r.listed();
    assert!(listed.files.iter().any(|f| f.path == "src/Widget.vue"));
    assert!(listed.skipped.iter().any(|s| s.path == "src/Broken.svelte"));

    // The same repository with its components left out of the walk (as the
    // measured build walked it): mining's input is the same.
    let without = tempfile::tempdir().expect("tempdir");
    let mut files = FILES.to_vec();
    files.push((".ignore", "*.vue\n*.svelte\n"));
    let w = repo(without.path(), &files);
    assert!(w.listed_files.is_empty() && w.listed_skipped.is_empty());
    assert_eq!(
        serde_json::to_string(&w.files).unwrap(),
        serde_json::to_string(&r.files).unwrap()
    );
    assert_eq!(w.skipped, r.skipped);
}
