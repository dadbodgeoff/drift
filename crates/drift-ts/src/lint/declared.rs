//! The import restrictions of a JavaScript or TypeScript ESLint configuration, every
//! block of it, each where it is written ([`drift_core::LintConfig::declared`]).
//!
//! The reading of a configuration for mining ([`super::read_config`]'s `rules`) keeps
//! only what applies to every file, as it was measured. A restriction scoped to some
//! files is the team writing a layering rule down ("`src/server/**` does not import
//! `../client/*`"), which the practice map can propose (`drift_mine::declared`), so
//! it is listed here apart, where mining never reads it.
//!
//! Only what is written as a literal is read. A block's place is the literal folders of
//! its `files` globs (`src/server/**`, `packages/app/**/*.ts`), relative to the
//! configuration's folder as ESLint reads them; a block without `files` (or with a
//! catch-all one) covers the configuration's folder. What the reading cannot vouch for
//! is said on the entry ([`drift_core::DeclaredLint::limits`]), never guessed:
//!
//! - `ignores`: the block leaves some files out (`ignores`, `excludedFiles`, a `!`
//!   glob);
//! - `computed`: the block is an argument of a call Drift does not know to hand it
//!   back unchanged (only `defineConfig` and `globalIgnores` of `eslint/config` and
//!   `config` of `typescript-eslint` are);
//! - `overridden`: a later block sets the same rule for part of the folder, or for
//!   files Drift cannot place;
//! - `unread_after`: a later part of the configuration was not read (a binding
//!   imported from another file, a plugin's preset, a call that builds blocks), and may
//!   change it.
//!
//! A later block that sets the rule for the whole folder replaces it: only the later
//! one is listed (and nothing, when the later one is `off`).

use std::collections::BTreeSet;

use drift_core::{DECLARED_IMPORTS, DeclaredLint};
use oxc_ast::ast::ObjectExpression;

use super::{catch_all_files, expr_strings, find_prop};

/// Most entries listed per configuration (a hostile config cannot grow the facts).
const MAX_ENTRIES: usize = 256;

/// Where a block applies.
#[derive(Clone, Default)]
pub(super) struct Place {
    /// The folders, repo-relative.
    dirs: Vec<String>,
    /// It also applies to files no folder names (`**/*.test.ts`, a computed `files`).
    anywhere: bool,
    limits: BTreeSet<&'static str>,
}

struct Entry {
    seq: usize,
    /// `None`: files no folder names ([`Place::anywhere`]).
    dir: Option<String>,
    level: String,
    line: u32,
    options: BTreeSet<String>,
    limits: BTreeSet<&'static str>,
}

/// The restrictions of one configuration, in the order ESLint applies them.
pub(super) struct Listing {
    line_starts: Vec<u32>,
    base: String,
    legacy: bool,
    place: Place,
    /// Order of settings and unread parts.
    seq: usize,
    /// Inside a call that is not known to hand its arguments back unchanged.
    computed: usize,
    last_unread: Option<usize>,
    entries: Vec<Entry>,
}

impl Listing {
    /// For the configuration at the folder `base` whose text is `text`; `legacy`: an
    /// `.eslintrc.*` (whose `overrides` are read), else a flat config.
    pub(super) fn new(text: &str, base: &str, legacy: bool) -> Listing {
        let mut line_starts = vec![0u32];
        for (i, b) in text.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push(u32::try_from(i + 1).unwrap_or(u32::MAX));
            }
        }
        Listing {
            line_starts,
            base: base.to_string(),
            legacy,
            place: Place {
                dirs: vec![base.to_string()],
                ..Place::default()
            },
            seq: 0,
            computed: 0,
            last_unread: None,
            entries: Vec::new(),
        }
    }

    pub(super) fn legacy(&self) -> bool {
        self.legacy
    }

    fn next(&mut self) -> usize {
        self.seq += 1;
        self.seq
    }

    /// A part of the configuration Drift does not read.
    pub(super) fn unread(&mut self) {
        let s = self.next();
        self.last_unread = Some(s);
    }

    pub(super) fn enter_computed(&mut self) {
        self.computed += 1;
    }

    pub(super) fn leave_computed(&mut self) {
        self.computed = self.computed.saturating_sub(1);
    }

    /// Enters a flat config block (`{ files, ignores, rules }`); gives back the place
    /// to [`Self::leave`] it for.
    pub(super) fn enter_block(&mut self, o: &ObjectExpression) -> Place {
        let outer = self.place.clone();
        let ignores = find_prop(o, "ignores").is_some();
        match find_prop(o, "files") {
            Some(files) if !catch_all_files(&files.value) => {
                let mut globs = BTreeSet::new();
                expr_strings(&files.value, &mut globs);
                self.place = self.place_of(&globs, &outer);
                if ignores {
                    self.place.limits.insert("ignores");
                }
            }
            _ if ignores && o.properties.len() > 1 => {
                // `{ ignores, rules }`: every file but those (a block of `ignores`
                // alone ignores files globally and sets nothing).
                self.place.limits.insert("ignores");
            }
            _ => {}
        }
        outer
    }

    /// Enters an `overrides` entry of a legacy configuration (`{ files, excludedFiles,
    /// rules }`).
    pub(super) fn enter_override(&mut self, o: &ObjectExpression) -> Place {
        let outer = self.place.clone();
        let mut globs = BTreeSet::new();
        if let Some(files) = find_prop(o, "files") {
            expr_strings(&files.value, &mut globs);
        }
        self.place = self.place_of(&globs, &outer);
        if find_prop(o, "excludedFiles").is_some() {
            self.place.limits.insert("ignores");
        }
        outer
    }

    pub(super) fn leave(&mut self, outer: Place) {
        self.place = outer;
    }

    /// The place of a block whose `files` are `globs`. A glob names a folder when its
    /// literal segments are followed by `**` (`src/server/**`, `src/server/**/*.ts`);
    /// any other (`*.test.ts`, `src/a.ts`, `src/*.ts`) covers files Drift does not
    /// place as a folder. No glob read (a computed `files`) is the same.
    fn place_of(&self, globs: &BTreeSet<String>, outer: &Place) -> Place {
        let mut place = Place {
            dirs: Vec::new(),
            anywhere: globs.is_empty(),
            limits: outer.limits.clone(),
        };
        for g in globs {
            if g.starts_with('!') {
                place.limits.insert("ignores");
                continue;
            }
            match folder_glob(&self.base, g) {
                Some(d) => place.dirs.push(d),
                None => place.anywhere = true,
            }
        }
        place.dirs.sort();
        place.dirs.dedup();
        place
    }

    /// `no-restricted-imports` set to `level` (`off`, `warn`, `error`) at the byte
    /// `offset` with `options`, in the current place.
    pub(super) fn set(&mut self, offset: u32, level: String, options: BTreeSet<String>) {
        if self.entries.len() >= MAX_ENTRIES {
            self.unread();
            return;
        }
        let line = u32::try_from(self.line_starts.partition_point(|&s| s <= offset)).unwrap_or(0);
        let mut limits = self.place.limits.clone();
        if self.computed > 0 {
            limits.insert("computed");
        }
        let mut dirs: Vec<Option<String>> = self.place.dirs.iter().cloned().map(Some).collect();
        if self.place.anywhere {
            dirs.push(None);
        }
        for dir in dirs {
            let seq = self.next();
            self.entries.push(Entry {
                seq,
                dir,
                level: level.clone(),
                line,
                options: options.clone(),
                limits: limits.clone(),
            });
        }
    }

    /// What is listed: each setting at `warn` or `error` for a folder that no later
    /// setting replaces, with its limits.
    pub(super) fn finish(self) -> Vec<DeclaredLint> {
        let mut out = Vec::new();
        for (i, e) in self.entries.iter().enumerate() {
            let Some(dir) = &e.dir else { continue };
            if e.level == "off" {
                continue;
            }
            let mut limits = e.limits.clone();
            let mut replaced = false;
            for later in &self.entries[i + 1..] {
                match &later.dir {
                    None => {
                        limits.insert("overridden");
                    }
                    Some(d) if covers(d, dir) && later.limits.is_empty() => {
                        replaced = true;
                        break;
                    }
                    Some(d) if covers(d, dir) || covers(dir, d) => {
                        limits.insert("overridden");
                    }
                    Some(_) => {}
                }
            }
            if replaced {
                continue;
            }
            if self.last_unread.is_some_and(|u| u > e.seq) {
                limits.insert("unread_after");
            }
            out.push(DeclaredLint {
                dir: dir.clone(),
                rule: DECLARED_IMPORTS.to_string(),
                level: e.level.clone(),
                line: e.line,
                sources: Vec::new(),
                options: e.options.iter().cloned().collect(),
                limits: limits.into_iter().map(str::to_string).collect(),
            });
        }
        out
    }
}

/// `dir` is `inner` or a folder above it (`""` is the repository root).
fn covers(dir: &str, inner: &str) -> bool {
    dir.is_empty() || inner == dir || inner.starts_with(&format!("{dir}/"))
}

/// The folder a `files` glob names, repo-relative: its literal leading segments when
/// `**` follows them, joined to the configuration's folder `base`.
fn folder_glob(base: &str, glob: &str) -> Option<String> {
    let glob = glob.trim_start_matches("./");
    let segs: Vec<&str> = glob.split('/').collect();
    let lit: Vec<&str> = segs
        .iter()
        .copied()
        .take_while(|s| !s.contains(['*', '?', '{', '[', '(']) && *s != ".." && !s.is_empty())
        .collect();
    if lit.is_empty() || segs.get(lit.len()) != Some(&"**") {
        return None;
    }
    let dir = lit.join("/");
    Some(if base.is_empty() {
        dir
    } else {
        format!("{base}/{dir}")
    })
}

#[cfg(test)]
mod tests {
    use super::super::read_config;

    /// `(dir, level, line, options, limits)` of one listed restriction.
    type Row = (String, String, u32, Vec<String>, Vec<String>);

    fn listed(rel: &str, text: &str) -> Vec<Row> {
        read_config(rel, text)
            .expect("a stack")
            .expect("a config")
            .declared
            .into_iter()
            .map(|d| (d.dir, d.level, d.line, d.options, d.limits))
            .collect()
    }

    fn dirs(rel: &str, text: &str) -> Vec<(String, Vec<String>)> {
        listed(rel, text)
            .into_iter()
            .map(|(d, _, _, _, l)| (d, l))
            .collect()
    }

    /// Pins that a flat config's block scoped by `files` is listed with its folder, its
    /// level and its line, also when the block is a constant spread into the array,
    /// while the reading mining uses ignores it as before.
    #[test]
    fn scoped_flat_blocks_are_listed_where_they_are_written() {
        let text = "import tseslint from 'typescript-eslint';\n\
                    const server = {\n  files: ['src/server/**/*.ts'],\n  rules: {\n    'no-restricted-imports': ['warn', { patterns: ['../client/*'] }],\n  },\n};\n\
                    export default tseslint.config(\n  ...tseslint.configs.recommended,\n  server,\n  { files: ['packages/ui/**'], rules: { '@typescript-eslint/no-restricted-imports': ['error', '@acme/web'] } },\n);\n";
        let c = read_config("web/eslint.config.mjs", text).unwrap().unwrap();
        assert!(
            c.rules.iter().all(|r| r.rule != "no-restricted-imports"),
            "mining's reading is unchanged: {:?}",
            c.rules
        );
        let l = listed("web/eslint.config.mjs", text);
        assert_eq!(l.len(), 2, "{l:?}");
        assert_eq!(l[0].0, "web/src/server");
        assert_eq!((l[0].1.as_str(), l[0].2), ("warn", 5));
        assert!(l[0].3.contains(&"../client/*".to_string()));
        assert!(l[0].4.is_empty(), "{l:?}");
        assert_eq!(
            (l[1].0.as_str(), l[1].1.as_str()),
            ("web/packages/ui", "error")
        );
    }

    /// Pins that `off` is no rule, that a later block for the whole folder replaces an
    /// earlier one, and that a later one for part of it, or for files no folder names,
    /// marks it `overridden`.
    #[test]
    fn later_blocks_replace_or_limit_earlier_ones() {
        let off = "export default [\n { files: ['src/**'], rules: { 'no-restricted-imports': ['error', '../x'] } },\n { files: ['src/**'], rules: { 'no-restricted-imports': 'off' } },\n];";
        assert!(dirs("eslint.config.js", off).is_empty());
        let part = "export default [\n { files: ['src/**'], rules: { 'no-restricted-imports': ['error', '../x'] } },\n { files: ['src/legacy/**'], rules: { 'no-restricted-imports': 'off' } },\n { files: ['lib/**'], rules: { 'no-restricted-imports': 'off' } },\n];";
        assert_eq!(
            dirs("eslint.config.js", part),
            [("src".into(), vec!["overridden".into()])]
        );
        let tests = "export default [\n { files: ['src/**'], rules: { 'no-restricted-imports': ['error', '../x'] } },\n { files: ['**/*.test.ts'], rules: { 'no-restricted-imports': 'off' } },\n];";
        assert_eq!(
            dirs("eslint.config.js", tests),
            [("src".into(), vec!["overridden".into()])]
        );
        let none =
            "export default [{ files: ['src/**'], rules: { 'no-restricted-imports': 'off' } }];";
        assert!(dirs("eslint.config.js", none).is_empty());
    }

    /// Pins that what is not read is said, never guessed: a block handed to a call
    /// Drift does not know is `computed`, a later binding imported from another file
    /// or an unknown preset makes earlier blocks `unread_after`, and a block with
    /// `ignores` is limited.
    #[test]
    fn what_is_not_read_is_said() {
        let built = "import { make } from './make.mjs';\nexport default [make({ files: ['src/**'], rules: { 'no-restricted-imports': ['error', '../x'] } })];";
        assert_eq!(
            dirs("eslint.config.js", built),
            [("src".into(), vec!["computed".into()])]
        );
        let after = "import shared from './shared.mjs';\nexport default [{ files: ['src/**'], rules: { 'no-restricted-imports': ['error', '../x'] } }, shared];";
        assert_eq!(
            dirs("eslint.config.js", after),
            [("src".into(), vec!["unread_after".into()])]
        );
        let before = "import shared from './shared.mjs';\nimport { defineConfig } from 'eslint/config';\nexport default defineConfig([shared, { files: ['src/**'], ignores: ['src/gen/**'], rules: { 'no-restricted-imports': ['error', '../x'] } }]);";
        assert_eq!(
            dirs("eslint.config.js", before),
            [("src".into(), vec!["ignores".into()])]
        );
    }

    /// Pins the legacy `.eslintrc.js`: a literal `module.exports` with `overrides`,
    /// each entry listed for the folders of its `files`.
    #[test]
    fn legacy_js_overrides_are_listed() {
        let text = "module.exports = {\n  root: true,\n  overrides: [\n    {\n      files: ['core/**/*.ts'],\n      excludedFiles: ['core/gen/**'],\n      rules: { 'no-restricted-imports': ['error', { patterns: ['../ui/**'] }] },\n    },\n    { files: ['lib/**'], rules: { 'no-restricted-imports': ['warn', '../app'] } },\n  ],\n};\n";
        let l = listed("pkg/.eslintrc.js", text);
        assert_eq!(l.len(), 2, "{l:?}");
        assert_eq!((l[0].0.as_str(), l[0].2), ("pkg/core", 7));
        assert_eq!(l[0].4, ["ignores"]);
        assert_eq!((l[1].0.as_str(), l[1].1.as_str()), ("pkg/lib", "warn"));
        assert!(l[1].4.is_empty());
    }
}
