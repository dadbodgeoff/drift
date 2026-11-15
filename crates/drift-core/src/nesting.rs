//! A cheap bound on syntactic nesting, checked before any parser runs.
//!
//! Parsers, AST visitors and the recursive `Drop` of a syntax tree all recurse
//! once per nesting level, so a few hundred kilobytes of `(` (one per line, which
//! no minified-line or size filter catches) overflow even a 64 MiB stack and abort
//! the whole process. Real code never comes close: CPython rejects more than 200
//! nested parentheses and 100 indentation levels. Files beyond [`MAX_NESTING`] are
//! skipped as [`crate::SkipReason::TooDeep`].
//!
//! This is defence in depth and the fast path, not the guarantee: every parse runs
//! on a stack sized for a file of its length that nests at every byte
//! ([`crate::stack`]), so a construct this scan does not count cannot overflow the
//! stack. It can still cost time and heap: see the known limits there.
//!
//! The scan skips strings and comments, except the code inside a string: the
//! replacement fields of Python f-strings and t-strings (`f"{x}"`, any mix with `r`
//! and `b`, triple-quoted ones over many lines, nested strings and format specs
//! included) and the `${...}` fields of template literals, which nest like any other
//! code and count as one bracket level each. For every language it bounds bracket depth.
//! For Python it bounds the *potential* syntax-tree depth: bracket depth, plus
//! indentation depth, plus the tokens in the current comma-free run at each open
//! bracket level, which also covers long chains that nest without brackets
//! (`x.a.a.a...`, `a + a + ...`, `x[0][0]...`, `not not ...`).
//!
//! TypeScript and JavaScript regex literals are skipped too, so a quote, a backtick
//! or a `/*` inside one (`/`/`, `/[/*]/`) does not open a string or comment that
//! hides the code after it. A `/` starts a regex where an operand is expected: after
//! an operator, a `(`, a keyword like `return`, `default` or `extends`, or the `)` of
//! `if (...)`. Anywhere else it divides. That includes after `}`, `<` and `>`, which
//! also end blocks, object literals and JSX tags (`</div>`, `{a}/{b}`), and after `of`,
//! `await` and `yield`, which can be names. Which reading is right there cannot be
//! told from the tokens around it.
//!
//! A misread `/` can move string, template or comment state onto code, on its line
//! or a later one, so the scan fails closed: the brackets in text that might be code
//! count. That text is the text of template literals and block comments, string text
//! after a line continuation (`\` at the end of a line), and the strings and line
//! comments on a line where such an unsure `/` was read as division. While the text
//! lasts its brackets count on top of the code's depth, and closers there cancel
//! only opens there. What it leaves open when it ends stays counted for the rest of
//! the file, since the parser may still be inside it, and later closers never cancel
//! that. So the hides of many misreads add up, and the total stays bounded by
//! [`MAX_NESTING`]. Real code leaves few brackets open in such text.

/// Deepest nesting accepted (brackets for every language; potential tree depth for Python).
pub const MAX_NESTING: usize = 1000;

/// Comment and string syntax of the language being scanned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Syntax {
    /// `//` and `/* */` comments; `'`, `"` and `` ` `` strings (TypeScript, JavaScript).
    CLike,
    /// `#` comments; `'`, `"` and triple-quoted strings; indentation.
    Python,
}

/// A string literal being scanned, kept while the scan is inside one of its fields.
#[derive(Debug, Clone, Copy)]
struct Str {
    quote: u8,
    triple: bool,
    /// Python f-/t-string or template literal: it has fields.
    fields: bool,
    /// Bracket depth outside the field this frame is suspended in.
    base: usize,
    /// The field sits in a format spec (`f"{x:{width}}"`): the spec resumes after it.
    in_spec: bool,
    /// TypeScript/JavaScript: brackets open in this literal's text so far, counted
    /// to fail closed (see the module docs).
    hidden: usize,
    /// TypeScript/JavaScript: a `'`/`"` string on a line where a `/` may have been
    /// misread, which may be code the parser sees: all its text counts.
    suspect: bool,
}

/// Where scanning a string stopped.
enum Stop {
    /// After the closing quote (or at the newline ending an unterminated string).
    End,
    /// After the `{` (`${` in a template literal) that opens a field.
    Field,
    /// At the `}` ending a format spec, which also closes its field.
    SpecEnd,
}

/// Scan string text from `i` (after the opening quote, or where a field closed) to
/// where it ends or opens a field. In a format spec, `}` ends the spec.
fn scan_str(b: &[u8], mut i: usize, s: &Str, spec: bool) -> (usize, Stop) {
    let q = s.quote;
    let template = q == b'`';
    while i < b.len() {
        let c = b[i];
        if c == b'\\' {
            // In a Python f-/t-string a backslash does not escape a brace: CPython
            // evaluates `f"\{1}"` to `'\\1'`, so the `{` still opens a field.
            let brace = matches!(b.get(i + 1), Some(b'{' | b'}'));
            i += if s.fields && !template && brace { 1 } else { 2 };
            continue;
        }
        if s.fields {
            if template {
                if c == b'$' && b.get(i + 1) == Some(&b'{') {
                    return (i + 2, Stop::Field);
                }
            } else if c == b'{' {
                if !spec && b.get(i + 1) == Some(&b'{') {
                    i += 2;
                    continue;
                }
                return (i + 1, Stop::Field);
            } else if c == b'}' {
                if spec {
                    return (i, Stop::SpecEnd);
                }
                i += if b.get(i + 1) == Some(&b'}') { 2 } else { 1 };
                continue;
            }
        }
        if s.triple {
            if c == q && b.get(i + 1) == Some(&q) && b.get(i + 2) == Some(&q) {
                return (i + 3, Stop::End);
            }
        } else if c == q {
            return (i + 1, Stop::End);
        } else if !template && (c == b'\n' || c == b'\r') {
            return (i, Stop::End); // unterminated: let the parser report it
        }
        i += 1;
    }
    (i, Stop::End)
}

/// The string prefix letters right before `b[i]` (a quote) make an f- or t-string.
fn has_fields_prefix(b: &[u8], i: usize) -> bool {
    let mut j = i;
    while j > 0 && i - j < 3 && b[j - 1].is_ascii_alphabetic() {
        j -= 1;
    }
    let ident = |c: u8| c.is_ascii_alphanumeric() || c == b'_' || c >= 0x80;
    let prefix = &b[j..i];
    !prefix.is_empty()
        && (j == 0 || !ident(b[j - 1]))
        && prefix
            .iter()
            .all(|c| matches!(c.to_ascii_lowercase(), b'r' | b'b' | b'f' | b't' | b'u'))
        && prefix
            .iter()
            .any(|c| matches!(c.to_ascii_lowercase(), b'f' | b't'))
}

/// What a `/` in TypeScript or JavaScript code starts, from the token before it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slash {
    /// After an operand: a name, a number, a literal, `)` or `]`.
    Divide,
    /// Where an operand is expected: after an operator, `(`, `,`, a keyword like
    /// `return`, the `)` of `if (...)`, or at the start.
    Regex,
    /// After `}`, `<` and `>`, which also end blocks and JSX tags, and after `of`,
    /// `await` and `yield`, which can be names: division, but what the rest of the
    /// line hides in strings and comments counts as if it were code.
    Unsure,
}

/// Keywords an operand follows, so a `/` after them starts a regex.
const BEFORE_OPERAND: &[&[u8]] = &[
    b"return",
    b"typeof",
    b"case",
    b"do",
    b"else",
    b"in",
    b"new",
    b"delete",
    b"void",
    b"throw",
    b"instanceof",
    b"default",
    b"extends",
];

/// Scan the regex literal whose opening `/` is at `i`: `Ok` with the index after
/// its closing `/`, or `Err` with the index of the line end (or the end of the
/// text) that leaves it unterminated. In a class (`[...]`) `/` does not close it.
fn regex_end(b: &[u8], mut i: usize) -> Result<usize, usize> {
    i += 1;
    let mut class = false;
    while i < b.len() {
        match b[i] {
            b'\n' | b'\r' => return Err(i),
            b'\\' => {
                if matches!(b.get(i + 1), Some(b'\n' | b'\r')) {
                    return Err(i + 1);
                }
                i += 2;
                continue;
            }
            b'[' => class = true,
            b']' => class = false,
            b'/' if !class => return Ok(i + 1),
            _ => {}
        }
        i += 1;
    }
    Err(b.len())
}

/// Fail closed on text the scan does not read as code: count the brackets of
/// `b[from..to]` on top of `open`, the ones already open in the same literal or
/// comment. A closer cancels only those, never one in the code around the text.
/// Returns the most that were open at once.
fn text_brackets(b: &[u8], from: usize, to: usize, open: &mut usize) -> usize {
    let mut most = *open;
    for &c in &b[from..to] {
        match c {
            b'(' | b'[' | b'{' => {
                *open += 1;
                most = most.max(*open);
            }
            b')' | b']' | b'}' => *open = open.saturating_sub(1),
            _ => {}
        }
    }
    most
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

/// True when `text` nests deeper than [`MAX_NESTING`].
pub fn too_deep(text: &str, syntax: Syntax) -> bool {
    let b = text.as_bytes();
    let python = syntax == Syntax::Python;
    let mut i = 0;
    let mut depth = 0usize;
    // Python: tokens in the current run at each bracket level, and their sum.
    let mut runs: Vec<usize> = vec![0];
    let mut run_sum = 0usize;
    let mut indents: Vec<usize> = vec![0];
    let mut at_line_start = true;
    let mut continued = false;
    let mut in_word = false;
    let over = |depth: usize, indents: &Vec<usize>, run_sum: usize| {
        depth + (indents.len() - 1) + run_sum > MAX_NESTING
    };
    // Strings whose fields the scan is inside, innermost last.
    let mut strs: Vec<Str> = Vec::new();
    // TypeScript/JavaScript: what a `/` starts here, whether the last token was
    // `if`/`while`/`for`/`with` (`for await` too) or a `.`, and, per bracket level,
    // whether its `(` follows one of those keywords. Levels never exceed
    // `MAX_NESTING`, so the bits fit in a fixed array.
    let mut slash = Slash::Regex;
    let mut ctrl = false;
    let mut after_dot = false;
    let mut ctrl_parens = [0u64; MAX_NESTING / 64 + 1];
    // TypeScript/JavaScript, to fail closed: the brackets open in the text of the
    // template literals whose fields the scan is inside (the sum of their
    // `Str::hidden`); the brackets left open by the text of literals and comments
    // that ended, which only grows, since a misread can leave the parser in code
    // there and no later closer is known to match them; and whether this line has
    // a `/` read as division where it may start a regex.
    let mut hidden_sum = 0usize;
    let mut leaked = 0usize;
    let mut unsure_line = false;
    // Scan a string from `i`; on a field, open it as a bracket level and return to
    // code. Returns the new position, or `None` when the nesting is too deep.
    macro_rules! string_from {
        ($i:expr, $s:expr, $spec:expr) => {{
            let (start, mut s): (usize, Str) = ($i, $s);
            let (ni, stop) = scan_str(b, start, &s, $spec);
            if !python {
                // Fail closed: template text counts its brackets, and so does the
                // text of a string after a line continuation (the only newlines a
                // `'`/`"` string can contain).
                let from = if s.quote == b'`' || s.suspect {
                    Some(start)
                } else {
                    b[start..ni]
                        .iter()
                        .position(|&c| c == b'\n' || c == b'\r')
                        .map(|p| start + p)
                };
                // Not the `{` of a `${` field, which opens a level of code.
                let to = if matches!(stop, Stop::Field) {
                    ni - 1
                } else {
                    ni
                };
                if let Some(from) = from
                    && depth + hidden_sum + leaked + text_brackets(b, from, to, &mut s.hidden)
                        > MAX_NESTING
                {
                    return true;
                }
                if matches!(stop, Stop::End) {
                    leaked += s.hidden;
                }
            }
            match stop {
                Stop::End if $spec => {
                    // A quote inside a format spec: the string ended; close its field.
                    while depth > s.base {
                        depth -= 1;
                        if python {
                            run_sum -= runs.pop().unwrap_or(0);
                        }
                    }
                    if let Some(f) = strs.pop() {
                        hidden_sum -= f.hidden;
                    }
                    slash = Slash::Divide;
                }
                Stop::End | Stop::SpecEnd => slash = Slash::Divide,
                Stop::Field => {
                    // A field starts an expression; its `}` is not a `)`.
                    slash = Slash::Regex;
                    strs.push(Str {
                        base: depth,
                        in_spec: $spec,
                        ..s
                    });
                    hidden_sum += s.hidden;
                    if python {
                        runs[depth] += 1;
                        run_sum += 1;
                        runs.push(0);
                    }
                    depth += 1;
                    if depth + hidden_sum + leaked > MAX_NESTING
                        || (python && over(depth, &indents, run_sum))
                    {
                        return true;
                    }
                    ctrl_parens[depth / 64] &= !(1 << (depth % 64));
                }
            }
            ctrl = false;
            after_dot = false;
            ni
        }};
    }
    while i < b.len() {
        let c = b[i];
        if python && at_line_start {
            at_line_start = false;
            if depth == 0 && !continued {
                let mut width = 0;
                let mut j = i;
                while j < b.len() && (b[j] == b' ' || b[j] == b'\t' || b[j] == b'\x0c') {
                    width = if b[j] == b'\t' {
                        (width / 8 + 1) * 8
                    } else {
                        width + 1
                    };
                    j += 1;
                }
                let blank = j >= b.len() || matches!(b[j], b'\n' | b'\r' | b'#');
                if !blank {
                    while indents.len() > 1 && *indents.last().unwrap_or(&0) > width {
                        indents.pop();
                    }
                    if width > *indents.last().unwrap_or(&0) {
                        indents.push(width);
                        if over(depth, &indents, run_sum) {
                            return true;
                        }
                    }
                }
            }
            continued = false;
        }
        match c {
            b'\n' | b'\r' => {
                at_line_start = true;
                in_word = false;
                unsure_line = false;
                if python && depth == 0 && !continued {
                    run_sum -= runs[0];
                    runs[0] = 0;
                }
                i += 1;
                continue;
            }
            b'\\' if python && matches!(b.get(i + 1), Some(b'\n' | b'\r')) => {
                continued = true;
                i += 1;
                continue;
            }
            b'#' if python => {
                while i < b.len() && b[i] != b'\n' && b[i] != b'\r' {
                    i += 1;
                }
                continue;
            }
            b'/' if !python && b.get(i + 1) == Some(&b'/') => {
                let start = i + 2;
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
                // Fail closed: on a line with a misread `/`, this may be code.
                if unsure_line {
                    let mut open = 0;
                    if depth + hidden_sum + leaked + text_brackets(b, start, i, &mut open)
                        > MAX_NESTING
                    {
                        return true;
                    }
                    leaked += open;
                }
                continue;
            }
            b'/' if !python && b.get(i + 1) == Some(&b'*') => {
                let start = i + 2;
                i = start;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                // Fail closed: a misread `/*` must not hide deep code.
                let end = if i + 1 < b.len() { i } else { b.len() };
                let mut open = 0;
                if depth + hidden_sum + leaked + text_brackets(b, start.min(end), end, &mut open)
                    > MAX_NESTING
                {
                    return true;
                }
                leaked += open;
                i += 2;
                continue;
            }
            b'/' if !python => {
                ctrl = false;
                after_dot = false;
                // A regex never runs past its line: an unterminated one is division
                // the scan did not foresee.
                let regex = match slash {
                    Slash::Regex => regex_end(b, i).ok(),
                    Slash::Divide | Slash::Unsure => None,
                };
                if let Some(mut e) = regex {
                    while e < b.len() && is_ident(b[e]) {
                        e += 1; // flags
                    }
                    i = e;
                    slash = Slash::Divide;
                    continue;
                }
                if slash != Slash::Divide {
                    unsure_line = true;
                }
                slash = Slash::Regex;
            }
            b'"' | b'\'' | b'`' if c != b'`' || !python => {
                in_word = false;
                let triple = python && b.get(i + 1) == Some(&c) && b.get(i + 2) == Some(&c);
                let s = Str {
                    quote: c,
                    triple,
                    fields: if python {
                        has_fields_prefix(b, i)
                    } else {
                        c == b'`'
                    },
                    base: depth,
                    in_spec: false,
                    hidden: 0,
                    suspect: !python && unsure_line,
                };
                i = string_from!(i + if triple { 3 } else { 1 }, s, false);
                continue;
            }
            // The `:` starting a format spec at the top level of an f-string field.
            b':' if python
                && strs
                    .last()
                    .is_some_and(|s| s.quote != b'`' && depth == s.base + 1) =>
            {
                in_word = false;
                run_sum -= runs[depth];
                runs[depth] = 0;
                let s = *strs.last().unwrap_or_else(|| unreachable!());
                i = string_from!(i + 1, s, true);
                continue;
            }
            b'(' | b'[' | b'{' => {
                in_word = false;
                if python {
                    runs[depth] += 1;
                    run_sum += 1;
                    runs.push(0);
                }
                depth += 1;
                if depth + hidden_sum + leaked > MAX_NESTING
                    || (python && over(depth, &indents, run_sum))
                {
                    return true;
                }
                let bit = 1 << (depth % 64);
                if c == b'(' && ctrl {
                    ctrl_parens[depth / 64] |= bit;
                } else {
                    ctrl_parens[depth / 64] &= !bit;
                }
                slash = Slash::Regex;
                ctrl = false;
                after_dot = false;
            }
            b')' | b']' | b'}' => {
                in_word = false;
                slash = match c {
                    b')' if depth > 0 && ctrl_parens[depth / 64] & (1 << (depth % 64)) != 0 => {
                        Slash::Regex
                    }
                    b'}' => Slash::Unsure,
                    _ => Slash::Divide,
                };
                ctrl = false;
                after_dot = false;
                if depth > 0 {
                    depth -= 1;
                    if python {
                        run_sum -= runs.pop().unwrap_or(0);
                    }
                }
                // A `}` closing a field: the string (or its format spec) resumes.
                if c == b'}'
                    && let Some(s) = strs.last().copied()
                    && s.base == depth
                {
                    strs.pop();
                    hidden_sum -= s.hidden;
                    i = string_from!(i + 1, s, s.in_spec);
                    continue;
                }
            }
            b',' | b';' | b':' if python => {
                in_word = false;
                run_sum -= runs[depth];
                runs[depth] = 0;
            }
            _ if python => {
                let word = c.is_ascii_alphanumeric() || c == b'_' || c >= 0x80;
                let op = b".+-*/%|&^@<>~=!".contains(&c);
                if (word && !in_word) || op {
                    runs[depth] += 1;
                    run_sum += 1;
                    if over(depth, &indents, run_sum) {
                        return true;
                    }
                }
                in_word = word;
            }
            _ if is_ident(c) => {
                // A name, keyword or number (with its `.`s: `1.5`).
                let start = i;
                let number = c.is_ascii_digit();
                while i < b.len() && (is_ident(b[i]) || (number && b[i] == b'.')) {
                    i += 1;
                }
                let word = &b[start..i];
                let keyword = !number && !after_dot;
                slash = if !keyword {
                    Slash::Divide
                } else if BEFORE_OPERAND.contains(&word) {
                    Slash::Regex
                } else if matches!(
                    word,
                    // Names, or ASI-terminated statements (`break⏎/re/.b`) a regex can follow.
                    b"of" | b"await" | b"yield" | b"break" | b"continue" | b"debugger"
                ) {
                    Slash::Unsure
                } else {
                    Slash::Divide
                };
                ctrl = keyword
                    && (matches!(word, b"if" | b"while" | b"for" | b"with")
                        || (ctrl && word == b"await"));
                after_dot = false;
                continue;
            }
            _ if !c.is_ascii_whitespace() => {
                let prev = if i > 0 { b[i - 1] } else { b'\n' };
                slash = match c {
                    b'<' | b'>' if prev != b'=' => Slash::Unsure, // not `=>`
                    b'+' | b'-' if b.get(i + 1) == Some(&c) => {
                        // Postfix `x++ / 2`, or (after ASI, `a⏎++/re/.b`) a prefix one
                        // that takes a regex: the line is unsure either way.
                        i += 1;
                        Slash::Unsure
                    }
                    // After an operand, TypeScript's non-null `x!` (or a `!` that
                    // starts a statement on the next line).
                    b'!' if slash != Slash::Regex && b.get(i + 1) != Some(&b'=') => Slash::Unsure,
                    _ => Slash::Regex,
                };
                ctrl = false;
                after_dot = c == b'.';
            }
            _ => {}
        }
        i += 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostile_nesting_is_too_deep() {
        let paren = format!("x = {}1{}\n", "(\n".repeat(100_000), "\n)".repeat(100_000));
        assert!(too_deep(&paren, Syntax::Python));
        let call = format!(
            "def f():\n    return ({}{})\n",
            "g(\n".repeat(80_000),
            ")\n".repeat(80_000)
        );
        assert!(too_deep(&call, Syntax::Python));
        let attr = format!("import os\nx = (os\n{})\n", ".a\n".repeat(200_000));
        assert!(too_deep(&attr, Syntax::Python));
        let indent: String = (0..1200)
            .map(|d| format!("{}if x:\n", " ".repeat(d)))
            .collect::<String>()
            + &" ".repeat(1200)
            + "pass\n";
        assert!(too_deep(&indent, Syntax::Python));
        let ts = format!(
            "const x = {}1{};\n",
            "(\n".repeat(100_000),
            "\n)".repeat(100_000)
        );
        assert!(too_deep(&ts, Syntax::CLike));
        // After ASI a line-leading `++`/`--` is a prefix operator and a regex can follow
        // it; a string the regex seems to hold must not hide the line's brackets.
        for line in ["++/'/.b;(()=>{a\n", "--/\\//.b;(()=>{a\n"] {
            let s = format!(
                "declare let a: any;\n(()=>{{a\n{}{};\n",
                line.repeat(50_000),
                "})\n".repeat(50_001)
            );
            assert!(too_deep(&s, Syntax::CLike), "{line}");
        }
        for word in ["break", "continue", "debugger"] {
            let s = format!(
                "for(;;){{{}}}\n",
                format!("{word}\n/'/.b;(()=>{{\n").repeat(2000)
            );
            assert!(too_deep(&s, Syntax::CLike), "{word}");
        }
        // Fields of f-strings and template literals are code.
        let fstring = format!(
            "x = f\"\"\"{{{}1{}}}\"\"\"\n",
            "(\n".repeat(200_000),
            "\n)".repeat(200_000)
        );
        assert!(too_deep(&fstring, Syntax::Python));
        // A backslash before the brace does not hide the field from Python.
        for prefix in ["f", "rf", "Rf"] {
            let s = format!(
                "x = {prefix}\"\"\"\\{{{}1{}}}\"\"\"\n",
                "(\n".repeat(200_000),
                "\n)".repeat(200_000)
            );
            assert!(too_deep(&s, Syntax::Python), "{prefix} backslash brace");
        }
        for prefix in ["f", "F", "rf", "Rf", "fR", "t", "T", "tr"] {
            let s = format!(
                "x = {prefix}'{{{}1{}}}'\n",
                "(".repeat(2000),
                ")".repeat(2000)
            );
            assert!(too_deep(&s, Syntax::Python), "{prefix}");
        }
        let nested = format!(
            "x = f'{{f\"{{{}1{}}}\"}}'\n",
            "[\n".repeat(2000),
            "]\n".repeat(2000)
        );
        assert!(too_deep(&nested, Syntax::Python));
        let spec = format!(
            "x = f'{{v:{{{}w{}}}}}'\n",
            "(".repeat(2000),
            ")".repeat(2000)
        );
        assert!(too_deep(&spec, Syntax::Python));
        let template = format!(
            "const x = `${{{}1{}}}`;\n",
            "(\n".repeat(200_000),
            "\n)".repeat(200_000)
        );
        assert!(too_deep(&template, Syntax::CLike));
        // A quote, backtick or `/*` inside a regex opens nothing that could hide
        // the code after it, wherever the regex sits.
        let deep = format!("{}1{}", "(\n".repeat(200_000), "\n)".repeat(200_000));
        // Lines ending in `\` inside comments continue a string the scan misread.
        let continued = format!(
            "( // \\\n{}1{}",
            "( // \\\n".repeat(2000),
            "\n)".repeat(2001)
        );
        for regex in [
            "/`/", "/'/", "/\"/", "/[/]`/", "/\\/`/", "/[/*]/", "/\\/*/", "/[`]/",
        ] {
            for before in [
                "const r = ",
                "f(",
                "if (x) ",
                "for await (const y of z) ",
                "{\n}\n",
                "x = a < ",
                "x = a > ",
                "x = () => ",
                "function g() { return ",
                "x = `${",
                "<div>{y}</div>;\nx = ",
                "export default ",
                "class A extends ",
            ] {
                let s = format!("{before}{regex};\nconst d = {deep};\nconst t = `x */`;\n");
                assert!(too_deep(&s, Syntax::CLike), "{before}{regex}");
                let s = format!("{before}{regex}; // \\\nconst d = {continued};\n'\"`*/\n");
                assert!(too_deep(&s, Syntax::CLike), "{before}{regex} continued");
            }
        }
        // Wherever a misread moves string or template state to a later line, the
        // text it hides still counts. A JSX closer or `}` before a real template
        // with a `/` (either reading of the `/` is valid code for some input), and
        // a backtick in JSX text:
        for jsx in [
            "export const C = () => (\n  <p>\n    <b>x</b>{`a/b\n`}\n  </p>\n);\n",
            "export const D = (a: string) => (\n  <p>\n    {a}/{`x/\n`}\n  </p>\n);\n",
            "export const E = () => <p>`</p>;\n",
            "export const F = () => <p>/*</p>;\n",
        ] {
            let s = format!("{jsx}const d = {deep};\nconst t = `x */`;\n");
            assert!(too_deep(&s, Syntax::CLike), "{jsx}");
        }
        // Many small hides add up: what each one leaves open stays counted. Per-line
        // strings, line comments and regex bodies after `x < /` (a regex call to the
        // parser), and templates of real code between misread backticks.
        let lines = [
            "x</'/(\n".repeat(100_000),
            "x</'/(x</'/+\n".repeat(69_000),
            "x</a'/(\n".repeat(100_000),
            "x</\\//(\n".repeat(100_000),
            "x>/\"/(\n".repeat(100_000),
            "}/'/(\n".repeat(100_000),
            "of/'/(\n".repeat(100_000),
            format!(
                "x < /`/ && {}",
                format!("{}`x`", "(\n".repeat(900)).repeat(220)
            ),
        ];
        for body in lines {
            let s = format!("const a = {body}1;\n");
            assert!(
                too_deep(&s, Syntax::CLike),
                "{}",
                &body[..body.len().min(40)]
            );
        }
        // Text after a line continuation counts too, but closers there cannot
        // cancel brackets open in the code around it.
        let s = format!(
            "const d = ({}'\\\n{}{}'\n",
            "(\n".repeat(600),
            ")".repeat(600),
            "(".repeat(600)
        );
        assert!(too_deep(&s, Syntax::CLike));
        // Before the continuation, a string's text is bounded by its line.
        let s = format!("const d = ({}'{}'\n", "(\n".repeat(600), "(".repeat(600));
        assert!(!too_deep(&s, Syntax::CLike));
    }

    #[test]
    fn real_code_is_not_too_deep() {
        let py = "def f(a, b):\n    if a:\n        return {'k': [1, 2, (3, 4)]}.get('k')\n    # ((((((\n    s = \"))))((((\" + '''\n((((\n'''\n    return a.b.c(d)[0].e\n";
        assert!(!too_deep(py, Syntax::Python));
        // Long, flat data: commas end every run.
        let data = format!("TABLE = [\n{}]\n", "    (1, 'a', 2.5),\n".repeat(50_000));
        assert!(!too_deep(&data, Syntax::Python));
        let ts = "// (((((\nconst s = `((((${x}`;\n/* {{{{ */\nexport const a = f(g(h({ b: [1, 2] })));\n";
        assert!(!too_deep(ts, Syntax::CLike));
        // Strings never count, whatever they contain.
        let strings = format!("x = '{}'\n", "(".repeat(5000));
        assert!(!too_deep(&strings, Syntax::Python));
        assert!(!too_deep(
            &format!("const x = \"{}\";\n", "[".repeat(5000)),
            Syntax::CLike
        ));
        // Text around fields, escaped braces, specs and nested strings do not count;
        // after a field the scan is back in the string, and after it in code.
        let fstrings = format!(
            "x = f'{{{{{}}}}} {{a!r:>{{w}}}} {{b:#x}} {{d[\"k\"]:%Y-%m}} {{f\"{{c}}\"}}'\ny = rb'{}'\nz = f\"\"\"\n{{\n  q\n}}\n{}\"\"\"\n",
            "(".repeat(5000),
            "{".repeat(5000),
            "(".repeat(5000)
        );
        assert!(!too_deep(&fstrings, Syntax::Python));
        // Template text counts its brackets only to fail closed: the 900 the first
        // template leaves open stay counted, but text closers in another template
        // never cancel code, and a plain string never counts.
        let templates = format!(
            "const a = `${{x}} {} ${{`${{y}}`}} `;\nconst c = `{}`;\nconst b = '{}';\n",
            "(".repeat(900),
            "]".repeat(5000),
            "(".repeat(5000)
        );
        assert!(!too_deep(&templates, Syntax::CLike));
        assert!(too_deep(
            &format!("{templates}const d = `{}`;\n", "(".repeat(101)),
            Syntax::CLike
        ));
        // Division and regexes, wherever real code puts them, leave the scan in
        // code. Every entry opens exactly one bracket outside its regexes, strings
        // and comments: 1001 copies go too deep and 999 do not, so a misread that
        // hid that `(` or counted a bracket inside a regex, string or comment shows.
        let entries = [
            "x = (a / b / c) * (",
            "x = a.b(c) / d(e) / f[0] / 2 + (",
            "x = (a / 2); y = /re/g; z = (",
            "x = (i++ / 2) + (j-- / 3) + y! / 4 + (",
            "x = 1.5 / 2 + a.return / 3 + a.if / 4 + (",
            "x = function () { return /[)(]/.test(s); } + (",
            "x = f(/\\)/, /(/, [/\\[/], !/(/.test(s), a && /(/) + (",
            "x = { k: /(/ }, y = c ? /(/ : /)/, z = (",
            "x = /\\${(\\w+)}/g.exec(s) || (",
            "if (/'/.test(s)) y = /\"/; z = (",
            "x = /[/'\"`]/.source; y = (",
            "x = s.split(/\\//); y = (",
            "for (const y of ys) if (y) /(/.test(y); z = (",
            "x = a / b; // a/b/c ( ' \" `\n  + (c / d) /* (/'\"`/) */ + (",
            "x = \"https://example.com/a/(\" + '//x(' + (",
            "x = <div className=\"a/b\">a/b {n}/{m} </div> && (",
            "x = <p>1/2 cup, and/or <b>bold</b>{\" \"}</p> && (",
            "x = <a href=\"/x\" /> && <Foo {...p} /> && (",
            "x = `a/${b / 2}px / ${c}/` + (",
            "x = <b>x</b>{`a/b`} && (",
            "x = <b>x</b>{'a/b'} && (",
            "x = <b>x</b>{\"don't/go\"} && (",
            "x = <p>{a}/{`x/`}</p> && (",
            "x = s.length > 0 ? /x/ : null; y = (",
            "export default /[(]/; y = (",
            "class A extends /[(]/.constructor {}; y = (",
        ];
        for entry in entries {
            let deep = format!("{entry}\n").repeat(1001);
            assert!(too_deep(&deep, Syntax::CLike), "{entry} not counted");
            assert!(
                !too_deep(&deep[..deep.len() / 1001 * 999], Syntax::CLike),
                "{entry}"
            );
            let balanced = format!("{entry}\n0)\n").repeat(2000);
            assert!(!too_deep(&balanced, Syntax::CLike), "{entry} balanced");
        }
        // Words ending in f or t before a quote are not prefixes.
        assert!(!too_deep(
            &format!("x = if'{{{}'\n", "(".repeat(5000)),
            Syntax::Python
        ));
    }
}
