//! Single-file components: the script blocks of Vue (`.vue`), Svelte (`.svelte`)
//! and Astro (`.astro`) files, read as one TypeScript/JavaScript module each.
//!
//! [`extract`] keeps every byte inside the script blocks where it is and blanks
//! everything else (markup, styles, the tags themselves) with spaces, keeping every
//! line break (`\n` and `\r`), so the module has the file's length, lines and
//! columns, as the Flow strip does ([`crate::flow`]). What is read:
//!
//! - Vue: `<script>` and `<script setup>` at the top level of the file, one of each
//!   at most, in one language (`lang` `ts`, `tsx`, `js`, `jsx`, or none for
//!   JavaScript). They are one module, as the Vue compiler makes them: the setup
//!   block's bindings beside the other's. Compiler macros (`defineProps`,
//!   `defineEmits`) are calls of names nothing imports, as written.
//! - Svelte: the instance `<script>` and the module script (`context="module"`, or
//!   `module` in Svelte 5) at the top level, one of each at most, in one language
//!   (`lang` `ts`/`typescript`, or none). An `export` in the instance script
//!   declares a property of the component, not an export of the module, so it is
//!   blanked: `export let name` is read as `let name`.
//! - Astro: the frontmatter between the `---` fences (server code, TypeScript), and
//!   the `<script>` tags of the markup the Astro build bundles for the browser (no
//!   attribute but `src`). A script whose top-level names are declared by the
//!   frontmatter or an earlier script is a module of its own in Astro: it is left
//!   out rather than read as the same names. An `is:inline` script (any attribute
//!   but `src`) is markup and is not read.
//!
//! A `src` attribute points at a file the scan reads on its own: the block is
//! empty here.
//!
//! The markup is not read: what a template renders, the components it uses, the
//! handlers it binds. A script tag inside an HTML comment, an attribute value or a
//! template expression is no block. A block ends at the first `</script` after it,
//! as the frameworks' compilers end it. A file whose blocks cannot be delimited with
//! certainty (a block that never ends, two blocks of one kind, languages that
//! differ or one Drift does not read, an element closed out of order before a
//! script tag, a frontmatter fence that never closes) is [`None`]: skipped as
//! [`drift_core::SkipReason::ComponentScript`], counted with the other skipped
//! files.

use oxc_parser::ParseOptions;
use oxc_span::SourceType;

/// The kind of component a path names, by its extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Vue,
    Svelte,
    Astro,
}

impl Kind {
    /// The component kind of `rel_path`; none for any other file.
    pub fn of_path(rel_path: &str) -> Option<Kind> {
        match rel_path.rsplit_once('.').map(|(_, e)| e) {
            Some("vue") => Some(Kind::Vue),
            Some("svelte") => Some(Kind::Svelte),
            Some("astro") => Some(Kind::Astro),
            _ => None,
        }
    }
}

/// The script of a component, read as one module ([`extract`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Script {
    /// The file with everything outside its script blocks blanked: same length,
    /// same lines.
    pub text: String,
    /// The blocks are TypeScript.
    pub typescript: bool,
    /// The blocks may hold JSX (`lang="tsx"`, `lang="jsx"`, or JavaScript).
    pub jsx: bool,
    /// Astro frontmatter: a `return` at its top level ends the page early.
    pub top_level_return: bool,
    /// The byte ranges of the blocks read, in order.
    pub blocks: Vec<(usize, usize)>,
}

impl Script {
    pub(crate) fn source_type(&self) -> SourceType {
        let base = if self.typescript {
            SourceType::ts()
        } else {
            SourceType::mjs()
        };
        base.with_jsx(self.jsx)
    }

    pub(crate) fn parse_options(&self) -> ParseOptions {
        ParseOptions {
            allow_return_outside_function: self.top_level_return,
            ..ParseOptions::default()
        }
    }
}

/// A file whose blocks cannot be delimited with certainty.
struct Uncertain;

type Scan<T> = Result<T, Uncertain>;

/// The script of the component `text` of `kind`, positions kept; [`None`] where its
/// blocks cannot be delimited with certainty (see the module docs).
pub fn extract(kind: Kind, text: &str) -> Option<Script> {
    let script = match kind {
        Kind::Vue => vue(text),
        Kind::Svelte => svelte(text),
        Kind::Astro => astro(text),
    }
    .ok()?;
    Some(script)
}

/// One element's opening tag.
struct Tag {
    /// Lowercased.
    name: String,
    /// Where `<` is.
    start: usize,
    /// Just past `>`.
    end: usize,
    self_closing: bool,
    /// `(name, value)`, names lowercased; a bare attribute has no value.
    attrs: Vec<(String, Option<String>)>,
}

impl Tag {
    fn attr(&self, name: &str) -> Option<Option<&str>> {
        self.attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_deref())
    }
}

/// HTML elements that never have content (no closing tag).
const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

/// How a markup scan reads `{`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Braces {
    /// Not specially (Vue templates: `{{ }}` interpolations hold no `<`).
    Plain,
    /// A `{...}` in text or in a tag is a JavaScript expression (Svelte).
    Everywhere,
    /// Only inside a tag (Astro: an expression in text may hold markup).
    InTags,
}

struct Scanner<'t> {
    b: &'t [u8],
}

impl<'t> Scanner<'t> {
    fn new(text: &'t str) -> Self {
        Scanner { b: text.as_bytes() }
    }

    fn starts(&self, at: usize, s: &str) -> bool {
        self.b
            .get(at..at + s.len())
            .is_some_and(|w| w.eq_ignore_ascii_case(s.as_bytes()))
    }

    fn find(&self, from: usize, s: &str) -> Option<usize> {
        (from..self.b.len()).find(|&j| self.starts(j, s))
    }

    /// The end of a JavaScript expression in braces whose `{` is at `at`: just past
    /// its `}`. Strings, template literals and comments are skipped; braces count.
    fn skip_braces(&self, at: usize) -> Scan<usize> {
        let mut j = at + 1;
        let mut depth = 1usize;
        while j < self.b.len() {
            match self.b[j] {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(j + 1);
                    }
                }
                q @ (b'"' | b'\'') => j = self.skip_string(j, q)? - 1,
                b'`' => j = self.skip_template(j)? - 1,
                b'/' if self.b.get(j + 1) == Some(&b'/') => {
                    j = self.find(j, "\n").ok_or(Uncertain)?;
                }
                b'/' if self.b.get(j + 1) == Some(&b'*') => {
                    j = self.find(j + 2, "*/").ok_or(Uncertain)? + 1;
                }
                _ => {}
            }
            j += 1;
        }
        Err(Uncertain)
    }

    /// Just past the closing quote of the string whose quote `q` is at `at`.
    fn skip_string(&self, at: usize, q: u8) -> Scan<usize> {
        let mut j = at + 1;
        while j < self.b.len() {
            match self.b[j] {
                b'\\' => j += 1,
                b'\n' => return Err(Uncertain),
                c if c == q => return Ok(j + 1),
                _ => {}
            }
            j += 1;
        }
        Err(Uncertain)
    }

    /// Just past the closing backquote of the template literal at `at`.
    fn skip_template(&self, at: usize) -> Scan<usize> {
        let mut j = at + 1;
        while j < self.b.len() {
            match self.b[j] {
                b'\\' => j += 1,
                b'`' => return Ok(j + 1),
                b'$' if self.b.get(j + 1) == Some(&b'{') => {
                    j = self.skip_braces(j + 1)? - 1;
                }
                _ => {}
            }
            j += 1;
        }
        Err(Uncertain)
    }

    /// The opening tag whose `<` is at `at` (a letter follows it), or `<!doctype`.
    fn open_tag(&self, at: usize, braces: Braces) -> Scan<Tag> {
        let name_end = (at + 1..self.b.len())
            .find(|&j| {
                let c = self.b[j];
                c.is_ascii_whitespace() || c == b'>' || c == b'/'
            })
            .ok_or(Uncertain)?;
        let name = String::from_utf8_lossy(&self.b[at + 1..name_end]).to_ascii_lowercase();
        let mut attrs = Vec::new();
        let mut j = name_end;
        loop {
            while j < self.b.len() && self.b[j].is_ascii_whitespace() {
                j += 1;
            }
            match self.b.get(j) {
                None => return Err(Uncertain),
                Some(b'>') => {
                    return Ok(Tag {
                        name,
                        start: at,
                        end: j + 1,
                        self_closing: false,
                        attrs,
                    });
                }
                Some(b'/') if self.b.get(j + 1) == Some(&b'>') => {
                    return Ok(Tag {
                        name,
                        start: at,
                        end: j + 2,
                        self_closing: true,
                        attrs,
                    });
                }
                Some(b'{') if braces != Braces::Plain => {
                    j = self.skip_braces(j)?;
                    attrs.push(("{}".to_string(), None));
                    continue;
                }
                _ => {}
            }
            let n0 = j;
            while j < self.b.len() {
                let c = self.b[j];
                if c.is_ascii_whitespace() || c == b'=' || c == b'>' {
                    break;
                }
                if c == b'/' && self.b.get(j + 1) == Some(&b'>') {
                    break;
                }
                j += 1;
            }
            if j == n0 {
                // A lone `/` or `=` where a name goes.
                j += 1;
                continue;
            }
            let attr = String::from_utf8_lossy(&self.b[n0..j]).to_ascii_lowercase();
            let mut k = j;
            while k < self.b.len() && self.b[k].is_ascii_whitespace() {
                k += 1;
            }
            if self.b.get(k) != Some(&b'=') {
                attrs.push((attr, None));
                continue;
            }
            k += 1;
            while k < self.b.len() && self.b[k].is_ascii_whitespace() {
                k += 1;
            }
            let (value, next) = match self.b.get(k) {
                None => return Err(Uncertain),
                Some(&q @ (b'"' | b'\'')) => {
                    let close = (k + 1..self.b.len())
                        .find(|&x| self.b[x] == q)
                        .ok_or(Uncertain)?;
                    (
                        String::from_utf8_lossy(&self.b[k + 1..close]).into_owned(),
                        close + 1,
                    )
                }
                Some(b'{') if braces != Braces::Plain => {
                    let end = self.skip_braces(k)?;
                    (String::from_utf8_lossy(&self.b[k..end]).into_owned(), end)
                }
                Some(_) => {
                    let end = (k..self.b.len())
                        .find(|&x| self.b[x].is_ascii_whitespace() || self.b[x] == b'>')
                        .ok_or(Uncertain)?;
                    (String::from_utf8_lossy(&self.b[k..end]).into_owned(), end)
                }
            };
            attrs.push((attr, Some(value)));
            j = next;
        }
    }

    /// Where the raw text of a `<name>` element opened just before `from` ends: the
    /// first `</name` (any case) followed by `>` after spaces. `(content end, just
    /// past the closing tag)`.
    fn raw_text_end(&self, from: usize, name: &str) -> Scan<(usize, usize)> {
        let close = format!("</{name}");
        let mut j = from;
        loop {
            let at = self.find(j, &close).ok_or(Uncertain)?;
            let mut k = at + close.len();
            while k < self.b.len() && self.b[k].is_ascii_whitespace() {
                k += 1;
            }
            match self.b.get(k) {
                Some(b'>') => return Ok((at, k + 1)),
                // `</scripts`: another name.
                _ => j = at + 1,
            }
        }
    }
}

/// One item of markup ([`markup`]).
enum Item {
    /// A `<script>` element: its tag, where its content ends, the element depth it
    /// is at, and whether the element nesting before it was read without a fault.
    Script {
        tag: Tag,
        content_end: usize,
        depth: usize,
        nesting_sound: bool,
    },
}

/// The script elements of the markup in `range`: comments, raw-text elements
/// (`script`, `style`, `textarea`, `title`) and braces (per `braces`) are skipped,
/// and element nesting is followed (void and self-closing elements aside). An
/// element closed out of order makes the nesting after it unsound.
fn markup(s: &Scanner<'_>, range: (usize, usize), braces: Braces) -> Scan<Vec<Item>> {
    let (mut i, end) = range;
    let mut stack: Vec<String> = Vec::new();
    let mut sound = true;
    let mut out = Vec::new();
    while i < end {
        let c = s.b[i];
        if c == b'{' && braces == Braces::Everywhere {
            i = s.skip_braces(i)?;
            continue;
        }
        if c != b'<' {
            i += 1;
            continue;
        }
        if s.starts(i, "<!--") {
            i = s.find(i + 4, "-->").ok_or(Uncertain)? + 3;
            continue;
        }
        let next = s.b.get(i + 1).copied().unwrap_or(b' ');
        if next == b'/' {
            let close_end = s.find(i, ">").ok_or(Uncertain)?;
            let name = String::from_utf8_lossy(&s.b[i + 2..close_end])
                .trim()
                .to_ascii_lowercase();
            if stack.last() == Some(&name) {
                stack.pop();
            } else {
                sound = false;
                if let Some(at) = stack.iter().rposition(|n| *n == name) {
                    stack.truncate(at);
                }
            }
            i = close_end + 1;
            continue;
        }
        if !(next.is_ascii_alphabetic() || next == b'!') {
            i += 1;
            continue;
        }
        if next == b'!' {
            // `<!doctype ...>`, `<![CDATA[`: no element.
            i = s.find(i, ">").ok_or(Uncertain)? + 1;
            continue;
        }
        let tag = s.open_tag(i, braces)?;
        i = tag.end;
        if tag.self_closing || VOID.contains(&tag.name.as_str()) {
            continue;
        }
        match tag.name.as_str() {
            "script" => {
                let (content_end, after) = s.raw_text_end(tag.end, "script")?;
                i = after;
                out.push(Item::Script {
                    tag,
                    content_end,
                    depth: stack.len(),
                    nesting_sound: sound,
                });
            }
            "style" | "textarea" | "title" => {
                let name = tag.name.clone();
                i = s.raw_text_end(tag.end, &name)?.1;
            }
            _ => stack.push(tag.name),
        }
    }
    Ok(out)
}

/// The file with the bytes of `blocks` kept and every other byte but a line break
/// a space; a `;` where each block after the first opens, so no statement of one
/// block runs on into the next.
fn blank(text: &str, blocks: &[(usize, usize)], separators: &[usize]) -> String {
    let mut out: Vec<u8> = text
        .bytes()
        .map(|c| if c == b'\n' || c == b'\r' { c } else { b' ' })
        .collect();
    for &(a, b) in blocks {
        out[a..b].copy_from_slice(&text.as_bytes()[a..b]);
    }
    for &at in separators {
        if out[at] == b' ' {
            out[at] = b';';
        }
    }
    // Only whole characters were kept (each block starts after `>` or a line break
    // and ends at `<` or a line break); everything else is ASCII.
    String::from_utf8(out).unwrap_or_default()
}

/// `(typescript, jsx)` of a `lang` attribute; `None` for a language Drift does not
/// read.
fn language(lang: Option<Option<&str>>) -> Option<(bool, bool)> {
    match lang {
        None => Some((false, true)),
        Some(v) => match v.unwrap_or("").trim().to_ascii_lowercase().as_str() {
            "" | "js" | "javascript" | "jsx" => Some((false, true)),
            "ts" | "typescript" => Some((true, false)),
            "tsx" => Some((true, true)),
            _ => None,
        },
    }
}

/// A script block read from `tag`: its content's range, empty where `src` names
/// another file.
fn content(tag: &Tag, content_end: usize) -> (usize, usize) {
    if tag.attr("src").is_some() {
        (tag.end, tag.end)
    } else {
        (tag.end, content_end)
    }
}

fn vue(text: &str) -> Scan<Script> {
    let s = Scanner::new(text);
    let mut plain: Option<(Tag, usize)> = None;
    let mut setup: Option<(Tag, usize)> = None;
    let mut i = 0;
    // The top level of an SFC: blocks, comments and text between them.
    while i < s.b.len() {
        if s.b[i] != b'<' {
            i += 1;
            continue;
        }
        if s.starts(i, "<!--") {
            i = s.find(i + 4, "-->").ok_or(Uncertain)? + 3;
            continue;
        }
        let next = s.b.get(i + 1).copied().unwrap_or(b' ');
        if next == b'/' {
            // A closing tag with no block open.
            return Err(Uncertain);
        }
        if next == b'!' {
            i = s.find(i, ">").ok_or(Uncertain)? + 1;
            continue;
        }
        if !next.is_ascii_alphabetic() {
            i += 1;
            continue;
        }
        let tag = s.open_tag(i, Braces::Plain)?;
        if tag.self_closing {
            i = tag.end;
            if tag.name == "script" {
                let slot = if tag.attr("setup").is_some() {
                    &mut setup
                } else {
                    &mut plain
                };
                if slot.is_some() {
                    return Err(Uncertain);
                }
                let end = tag.end;
                *slot = Some((tag, end));
            }
            continue;
        }
        match tag.name.as_str() {
            "script" => {
                let (content_end, after) = s.raw_text_end(tag.end, "script")?;
                i = after;
                let slot = if tag.attr("setup").is_some() {
                    &mut setup
                } else {
                    &mut plain
                };
                if slot.is_some() {
                    return Err(Uncertain);
                }
                *slot = Some((tag, content_end));
            }
            // A template in another language (`lang="pug"`) is raw text to its end.
            "template" if tag.attr("lang").is_some_and(|l| l != Some("html")) => {
                i = s.raw_text_end(tag.end, "template")?.1;
            }
            "template" => i = template_end(&s, tag.end)?,
            // `<style>` and custom blocks (`<i18n>`, `<docs>`) are raw text.
            name => {
                let name = name.to_string();
                i = s.raw_text_end(tag.end, &name)?.1;
            }
        }
    }
    let mut found: Vec<(Tag, usize)> = plain.into_iter().chain(setup).collect();
    found.sort_by_key(|(t, _)| t.start);
    let langs: Vec<(bool, bool)> = found
        .iter()
        .map(|(t, _)| language(t.attr("lang")).ok_or(Uncertain))
        .collect::<Scan<_>>()?;
    if langs.windows(2).any(|w| w[0] != w[1]) {
        return Err(Uncertain);
    }
    let (typescript, jsx) = langs.first().copied().unwrap_or((false, true));
    let blocks: Vec<(usize, usize)> = found.iter().map(|(t, e)| content(t, *e)).collect();
    let separators: Vec<usize> = found.iter().skip(1).map(|(t, _)| t.start).collect();
    Ok(Script {
        text: blank(text, &blocks, &separators),
        typescript,
        jsx,
        top_level_return: false,
        blocks,
    })
}

/// Just past the `</template>` that closes the top-level template whose content
/// starts at `from`: nested `<template>` elements count, comments and quoted
/// attribute values are skipped.
fn template_end(s: &Scanner<'_>, from: usize) -> Scan<usize> {
    let mut depth = 1usize;
    let mut i = from;
    while i < s.b.len() {
        if s.b[i] != b'<' {
            i += 1;
            continue;
        }
        if s.starts(i, "<!--") {
            i = s.find(i + 4, "-->").ok_or(Uncertain)? + 3;
            continue;
        }
        if s.starts(i, "</template") {
            let close = s.find(i, ">").ok_or(Uncertain)?;
            let between = &s.b[i + "</template".len()..close];
            i = close + 1;
            if between.iter().all(u8::is_ascii_whitespace) {
                depth -= 1;
                if depth == 0 {
                    return Ok(i);
                }
            }
            continue;
        }
        let next = s.b.get(i + 1).copied().unwrap_or(b' ');
        if next.is_ascii_alphabetic() {
            let tag = s.open_tag(i, Braces::Plain)?;
            if tag.name == "template" && !tag.self_closing {
                depth += 1;
            }
            i = tag.end;
            continue;
        }
        i += 1;
    }
    Err(Uncertain)
}

fn svelte(text: &str) -> Scan<Script> {
    let s = Scanner::new(text);
    let mut instance: Option<(Tag, usize)> = None;
    let mut module: Option<(Tag, usize)> = None;
    for item in markup(&s, (0, s.b.len()), Braces::Everywhere)? {
        let Item::Script {
            tag,
            content_end,
            depth,
            nesting_sound,
        } = item;
        if !nesting_sound {
            // Whether it is the component's script or an element's cannot be told.
            return Err(Uncertain);
        }
        if depth > 0 {
            // An element of the markup (`<svelte:head><script>`): not the component's.
            continue;
        }
        let is_module = tag.attr("module").is_some()
            || tag
                .attr("context")
                .is_some_and(|v| v.is_some_and(|v| v.trim() == "module"));
        let slot = if is_module {
            &mut module
        } else {
            &mut instance
        };
        if slot.is_some() {
            return Err(Uncertain);
        }
        *slot = Some((tag, content_end));
    }
    let langs: Vec<(bool, bool)> = instance
        .iter()
        .chain(&module)
        .map(|(t, _)| language(t.attr("lang")).ok_or(Uncertain))
        .collect::<Scan<_>>()?;
    if langs.windows(2).any(|w| w[0].0 != w[1].0) {
        return Err(Uncertain);
    }
    let typescript = langs.first().is_some_and(|l| l.0);
    let instance_range = instance.as_ref().map(|(t, e)| content(t, *e));
    let mut found: Vec<(Tag, usize)> = instance.into_iter().chain(module).collect();
    found.sort_by_key(|(t, _)| t.start);
    let blocks: Vec<(usize, usize)> = found.iter().map(|(t, e)| content(t, *e)).collect();
    let separators: Vec<usize> = found.iter().skip(1).map(|(t, _)| t.start).collect();
    let mut script = Script {
        text: blank(text, &blocks, &separators),
        typescript,
        jsx: false,
        top_level_return: false,
        blocks,
    };
    if let Some(range) = instance_range {
        script.text = component_props(&script, range)?;
    }
    Ok(script)
}

/// The script with each `export` of the instance script's top level (in `range`)
/// blanked: a property of the component (`export let name`, `export { a as b }`),
/// not an export of the module.
fn component_props(script: &Script, range: (usize, usize)) -> Scan<String> {
    use oxc_ast::ast::Statement;
    use oxc_span::GetSpan;
    let text = &script.text;
    let spans: Vec<(usize, usize, bool)> = crate::arena::with_arena(text.len(), |allocator| {
        let ret = oxc_parser::Parser::new(allocator, text, script.source_type()).parse();
        ret.program
            .body
            .iter()
            .filter_map(|st| match st {
                // The keyword alone for a declaration (`export let name`); the
                // whole statement for a list of names, which declares nothing.
                Statement::ExportDeclaration(e) => Some((e.span(), true)),
                Statement::ExportNamedDeclaration(e) => Some((e.span(), false)),
                _ => None,
            })
            .filter(|(span, _)| (range.0..range.1).contains(&(span.start as usize)))
            .map(|(span, declaration)| (span.start as usize, span.end as usize, declaration))
            .collect::<Vec<_>>()
    })
    .map_err(|_| Uncertain)?;
    let mut out = text.as_bytes().to_vec();
    for (start, end, declaration) in spans {
        let end = if declaration {
            if out.get(start..start + 6) != Some(b"export".as_slice()) {
                return Err(Uncertain);
            }
            start + 6
        } else {
            end
        };
        for c in &mut out[start..end] {
            if *c != b'\n' && *c != b'\r' {
                *c = b' ';
            }
        }
    }
    String::from_utf8(out).map_err(|_| Uncertain)
}

fn astro(text: &str) -> Scan<Script> {
    let s = Scanner::new(text);
    let mut blocks: Vec<(usize, usize)> = Vec::new();
    let mut separators = Vec::new();
    let mut markup_from = 0;
    // The frontmatter: a first line (after a byte order mark and blank lines) that
    // is `---`, to the next line that is.
    let mut i = if text.starts_with('\u{feff}') { 3 } else { 0 };
    while i < s.b.len() && s.b[i].is_ascii_whitespace() {
        i += 1;
    }
    if s.starts(i, "---") && line_is_fence(text, i) {
        let open_end = line_end(text, i);
        let mut j = open_end;
        let close = loop {
            if j >= s.b.len() {
                return Err(Uncertain);
            }
            if line_is_fence(text, j) {
                break j;
            }
            j = line_end(text, j);
        };
        blocks.push((open_end, close));
        markup_from = line_end(text, close);
    }
    let frontmatter = !blocks.is_empty();
    let mut scripts = Vec::new();
    for item in markup(&s, (markup_from, s.b.len()), Braces::InTags)? {
        let Item::Script {
            tag, content_end, ..
        } = item;
        // Bundled for the browser: no attribute but `src` (which names a file read
        // on its own). Any other attribute leaves the script inline, in the markup.
        if tag.attrs.iter().any(|(n, _)| n != "src") || tag.attr("src").is_some() {
            continue;
        }
        scripts.push((tag.start, (tag.end, content_end)));
    }
    let script = |blocks: &[(usize, usize)]| Script {
        text: blank(text, blocks, &[]),
        typescript: true,
        jsx: false,
        top_level_return: true,
        blocks: blocks.to_vec(),
    };
    // Each bundled script is a module of its own: one that declares a name another
    // block declares is left out, not read as the same binding.
    let mut declared = match blocks.first() {
        Some(_) => top_level_names(&script(&blocks))?,
        None => Vec::new(),
    };
    for (start, range) in scripts {
        let names = top_level_names(&script(&[range]))?;
        if names.iter().any(|n| declared.contains(n)) {
            continue;
        }
        declared.extend(names);
        if !blocks.is_empty() {
            separators.push(start);
        }
        blocks.push(range);
    }
    Ok(Script {
        text: blank(text, &blocks, &separators),
        typescript: true,
        jsx: false,
        top_level_return: frontmatter,
        blocks,
    })
}

/// The line holding `at` is `---` (spaces after it aside).
fn line_is_fence(text: &str, at: usize) -> bool {
    let start = text[..at].rfind('\n').map_or(0, |n| n + 1);
    let line = &text[start..line_end(text, at)];
    let line = line.strip_prefix('\u{feff}').unwrap_or(line);
    line.trim_end() == "---"
}

/// Just past the line break ending the line that holds `at` (the text's end for the
/// last line).
fn line_end(text: &str, at: usize) -> usize {
    text[at..].find('\n').map_or(text.len(), |n| at + n + 1)
}

/// The names `script` declares at its top level, sorted.
fn top_level_names(script: &Script) -> Scan<Vec<String>> {
    let text = &script.text;
    let names = crate::arena::with_arena(text.len(), |allocator| {
        let ret = oxc_parser::Parser::new(allocator, text, script.source_type())
            .with_options(script.parse_options())
            .parse();
        let semantic = oxc_semantic::SemanticBuilder::new()
            .build(&ret.program)
            .semantic;
        let scoping = semantic.scoping();
        let mut names: Vec<String> = scoping
            .iter_bindings_in(scoping.root_scope_id())
            .map(|id| scoping.symbol_name(id).to_string())
            .collect();
        names.sort();
        names
    })
    .map_err(|_| Uncertain)?;
    Ok(names)
}

/// [`lower_component`] on a stack that covers `text`
/// ([`drift_core::stack::with_stack_for`]).
pub fn lower_component_on_stack(
    rel_path: &str,
    text: &str,
) -> Result<crate::lower::RawFile, drift_core::stack::Unavailable> {
    drift_core::stack::with_stack_for(text.len(), || lower_component(rel_path, text))
}

/// The facts of the component `text` at `rel_path`: its script ([`extract`])
/// lowered as any module is, positions those of the file. The content gates of a
/// source file (minified, nested too deep, too costly to parse) apply to the
/// script, not to the markup blanked out of it; a file whose blocks cannot be
/// delimited is skipped as [`drift_core::SkipReason::ComponentScript`]. A path that
/// names no component is lowered as a source file ([`crate::lower::lower_file`]).
pub fn lower_component(rel_path: &str, text: &str) -> crate::lower::RawFile {
    use drift_core::SkipReason;
    let Some(kind) = Kind::of_path(rel_path) else {
        return crate::lower::lower_file(rel_path, text);
    };
    let skipped = |reason| crate::lower::RawFile {
        skip: Some(reason),
        ..Default::default()
    };
    let Some(script) = extract(kind, text) else {
        return skipped(SkipReason::ComponentScript);
    };
    let dialect = drift_core::speculation::Dialect {
        typescript: script.typescript,
        jsx: script.jsx,
    };
    // A line of markup is blank here: only the length of what is read counts.
    let read: Vec<&str> = script.text.lines().map(str::trim).collect();
    if drift_core::ingest::looks_minified(&read.join("\n")) {
        return skipped(SkipReason::Minified);
    }
    if drift_core::nesting::too_deep(&script.text, drift_core::nesting::Syntax::CLike) {
        return skipped(SkipReason::TooDeep);
    }
    if drift_core::speculation::too_costly(&script.text, dialect) {
        return skipped(SkipReason::TooCostly);
    }
    crate::arena::with_arena(script.text.len(), |allocator| {
        crate::lower::lower_parsed_with(
            allocator,
            rel_path,
            &script.text,
            script.source_type(),
            script.parse_options(),
        )
    })
    .unwrap_or_else(|_| skipped(SkipReason::TooCostly))
}

/// The facts of the lowered `components`, linked with every file of the scan
/// (`all`, the sources and the components): what they import from a source and from
/// each other resolves as any module's imports do. The sources' own facts are
/// linked without them (`crate::scan`), so what mining reads is what it read before
/// components were read; these are the listed reading's alone
/// ([`drift_core::RepoFacts::listed_files`]). Parameter types are not read for them.
pub(crate) fn link_components(
    resolver: &crate::resolve::ModuleResolver,
    all: &[crate::resolve::LoweredFile],
    components: &[crate::resolve::LoweredFile],
    root: &std::path::Path,
) -> Vec<drift_core::FileFacts> {
    use crate::resolve::{all_specs, export_specs, mount_specs};
    if components.is_empty() {
        return Vec::new();
    }
    // Every specifier of a component; of a source, those a component's links can
    // follow through it (re-exports, mounts).
    let linker = crate::resolve::Linker::with_specs(resolver, all, |f| {
        if Kind::of_path(&f.rel_path).is_some() {
            return all_specs(f);
        }
        let mut s = export_specs(f);
        s.extend(mount_specs(f));
        s
    });
    let mut memo = crate::PackageMemo::new();
    components
        .iter()
        .map(|f| {
            let package = crate::package_of(root, &f.abs_path, &mut memo);
            linker.link(f, package)
        })
        .collect()
}
