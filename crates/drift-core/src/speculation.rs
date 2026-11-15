//! A cheap bound on the parsing work TypeScript and JavaScript can force, checked
//! before any parser runs.
//!
//! oxc resolves some ambiguities by parsing ahead speculatively and rewinding when
//! the guess was wrong, and what it allocated while guessing stays in the file's
//! arena until the parse ends. Real code guesses over a few tokens. A file can
//! make every guess run far ahead and nest guesses inside guesses, so the parser's
//! work and memory grow with the square of the file, or exponentially with its
//! nesting: 32 KB of `x=a<a<a<...b>()>()` takes 1.4 GB, 300 bytes of
//! `a<(y=a<(y=...` more than 3 GB. The speculations (oxc 0.157) are:
//!
//! - **Type arguments.** In TypeScript, a `<` after an operand may open type
//!   arguments (`f<T>(x)`) or be a comparison. The parser reads a type list from
//!   it and, when that does not end in `>` and a call or template, rewinds and reads
//!   a comparison. It is not memoized: after the rewind, the next `<` guesses again
//!   over the rest, so `a<a<a<...` costs the square of its length.
//! - **Arrow parameters.** A `(` that may open an arrow function's parameters
//!   (`(a, b)`, `([a])`, `({ a })`, `(a = 1)`) is read as parameters, then rewound
//!   and read as an expression when no `=>` follows. Types do the same for a `(`
//!   that may start a function type.
//! - **`infer` constraints.** `infer X extends C` is read with `C` as the constraint,
//!   then rewound when a `?` follows (the `extends` then starts a conditional type).
//!
//! A guess can reach arbitrary code only through parts that hold expressions or
//! types (default values, type annotations, type arguments), and each rewind
//! re-reads what the guess read, guesses inside it included. So the cost of a span
//! of the file is its length times the number of times it is read: twice for each
//! enclosing arrow-parameter or constraint guess that fails, and, at each nesting
//! level, once more for each unfinished type-argument guess before it. This module
//! lexes the file (strings, comments, templates, regular expressions and JSX as the
//! parser sees them), finds the spans each guess can read (until a token no type or
//! parameter list can hold, or the end of the enclosing bracket), sums that cost,
//! and reports files whose cost exceeds [`MAX_READS_PER_BYTE`] times their length
//! (plus [`SLACK_BYTES`]). They are skipped as [`crate::SkipReason::TooCostly`].
//! Across 96,000 files of real TypeScript and JavaScript the median is 1.01 reads
//! per byte and the 99th percentile 1.4; no file comes within a third of the bound.
//!
//! The spans are upper bounds: a guess is assumed to fail (unless arrow parameters
//! are followed by `=>`), and to read until the first token that certainly ends it.
//! That only overestimates, so the bound holds whichever way the parser resolves a
//! guess. It overestimates most in types, where `<` does not guess: a generic type
//! nested hundreds deep (`A<A<A<...>>>`) is reported, though it parses cheaply.
//!
//! Known limit: the lexer decides regex against division and where JSX text ends as
//! [`crate::nesting`] does, from the tokens around it; where it disagrees with the
//! parser, a guess can go uncounted. The parse's arena has a fixed budget as well
//! (`drift_ts::arena`), so memory stays bounded either way.

/// What a file's extension makes of `<`: TypeScript reads type arguments, JSX reads
/// elements.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dialect {
    pub typescript: bool,
    pub jsx: bool,
}

impl Dialect {
    /// The dialect the TypeScript/JavaScript parser reads a file at `rel_path` in:
    /// `.ts`/`.mts`/`.cts` without JSX, `.tsx` with it, and JavaScript (any
    /// extension) with JSX. Anything else is read as `.tsx`.
    pub fn of_path(rel_path: &str) -> Self {
        let ext = rel_path.rsplit_once('.').map_or("", |(_, e)| e);
        match ext {
            "ts" | "mts" | "cts" => Self {
                typescript: true,
                jsx: false,
            },
            "js" | "mjs" | "cjs" | "jsx" => Self {
                typescript: false,
                jsx: true,
            },
            _ => Self {
                typescript: true,
                jsx: true,
            },
        }
    }
}

/// Most reads per byte accepted on average, on top of [`SLACK_BYTES`]: real code
/// stays below 1.1.
pub const MAX_READS_PER_BYTE: f64 = 4.0;

/// Cost accepted in any file, in byte reads: small files with a few guesses.
pub const SLACK_BYTES: f64 = 64.0 * 1024.0;

/// True when parsing `text` may cost more than [`MAX_READS_PER_BYTE`] reads per
/// byte (see the module docs).
pub fn too_costly(text: &str, dialect: Dialect) -> bool {
    cost(text, dialect) > MAX_READS_PER_BYTE * text.len() as f64 + SLACK_BYTES
}

/// The estimated parsing cost of `text`, in byte reads (at least its length),
/// saturating at `f64::INFINITY` once it is beyond any budget.
pub fn cost(text: &str, dialect: Dialect) -> f64 {
    let toks = lex(text.as_bytes(), dialect);
    sweep(&toks, dialect, text.len())
}

// ---------- tokens ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Word {
    /// A name, or a keyword that can be one (`async`, `of`, `type`, ...).
    Name,
    /// A keyword that is never a binding name (`return`, `typeof`, `new`, ...).
    Reserved,
    Infer,
    Extends,
    /// A parameter modifier (`public`, `private`, `protected`, `readonly`, `override`).
    Modifier,
    /// `async`: a name, and a `(` after it may open an arrow's parameters.
    Async,
    /// A keyword whose `(` is not an expression (`function`, `if`, `while`, `for`,
    /// `switch`, `catch`, `with`); never a binding name.
    Head,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Word(Word),
    /// A number, string or regular expression: an operand without structure.
    Lit,
    /// Opens a level: `(`, `[`, `{`; `` ` `` a template, `$` a template field, `j` a
    /// JSX expression container, `<` a JSX element.
    Open(u8),
    Close,
    /// `<` in code.
    Lt,
    /// `<<` in code.
    LtLt,
    /// One `>` in code (`>>` is two).
    Gt,
    /// `=`.
    Eq,
    /// `=>`.
    Arrow,
    Comma,
    Colon,
    Question,
    Semi,
    Dot3,
    /// An operator no type or parameter list holds: `&&`, `||`, `??`, `==`, `!=`,
    /// `<=`, `>=`'s `=` aside, compound assignments, `++`, `--`, `*`, `/`, `%`, `^`, `~`.
    Break,
    /// Any other punctuation (`.`, `+`, `-`, `&`, `|`, `!`, `?.`, `@`, `#`).
    Other,
}

#[derive(Debug, Clone, Copy)]
struct Tok {
    kind: Kind,
    /// Byte offset just past the token.
    end: u32,
    /// For [`Kind::Open`]: the index of its [`Kind::Close`] (or of the end of input);
    /// for a close, the index of its open.
    mate: u32,
}

/// Keywords an operand follows, so a `/` after them starts a regex (as in
/// [`crate::nesting`]).
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

/// Keywords that are never a binding name, so they end an arrow-parameter guess.
const RESERVED: &[&[u8]] = &[
    b"break",
    b"case",
    b"catch",
    b"class",
    b"const",
    b"continue",
    b"debugger",
    b"default",
    b"delete",
    b"do",
    b"else",
    b"enum",
    b"export",
    b"false",
    b"finally",
    b"for",
    b"function",
    b"if",
    b"import",
    b"in",
    b"instanceof",
    b"new",
    b"null",
    b"return",
    b"super",
    b"switch",
    b"throw",
    b"true",
    b"try",
    b"typeof",
    b"var",
    b"void",
    b"while",
    b"with",
];

/// Keywords whose `(` holds a condition, a parameter list or a binding, not an
/// expression the parser may read as an arrow's parameters.
const HEADS: &[&[u8]] = &[
    b"function",
    b"if",
    b"while",
    b"for",
    b"switch",
    b"catch",
    b"with",
];

const MODIFIERS: &[&[u8]] = &[
    b"public",
    b"private",
    b"protected",
    b"readonly",
    b"override",
];

/// What a `/` starts here (see [`crate::nesting`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slash {
    Divide,
    Regex,
}

/// Where the lexer is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Frame {
    /// Code inside a bracket opened by `opener` (`0` at the top level), whose open
    /// token is `at`; `ctrl`: the `(` of `if`/`while`/`for`/`with`.
    Code { opener: u8, at: usize, ctrl: bool },
    /// Template text; `at` is its open token.
    Template { at: usize },
    /// A JSX tag (`<a b="c">`); `at` is the element's open token.
    Tag { at: usize },
    /// JSX children; `at` is the element's open token.
    Children { at: usize },
}

fn is_ident_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c == b'$' || c >= 0x80 || c == b'\\'
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80 || c == b'\\'
}

/// The regex literal whose `/` is at `i` ends at the returned index, or is not
/// one (it would run past its line).
fn regex_end(b: &[u8], mut i: usize) -> Option<usize> {
    i += 1;
    let mut class = false;
    while i < b.len() {
        match b[i] {
            b'\n' | b'\r' => return None,
            b'\\' => {
                i += 2;
                continue;
            }
            b'[' => class = true,
            b']' => class = false,
            b'/' if !class => {
                i += 1;
                while i < b.len() && is_ident(b[i]) {
                    i += 1; // flags
                }
                return Some(i);
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// At `i` (just after a `<` at an operand position), a JSX element starts: a name
/// or `>` follows, and not TypeScript's generic arrow (`<T,>`, `<T extends U>`).
fn starts_jsx(b: &[u8], i: usize, dialect: Dialect) -> bool {
    match b.get(i) {
        Some(b'>') => true,
        Some(&c) if is_ident_start(c) => {
            if !dialect.typescript {
                return true;
            }
            let mut j = i;
            while j < b.len() && is_ident(b[j]) {
                j += 1;
            }
            while j < b.len() && b[j].is_ascii_whitespace() {
                j += 1;
            }
            !(b.get(j) == Some(&b',') || b[j..].starts_with(b"extends"))
        }
        _ => false,
    }
}

struct Lexer {
    toks: Vec<Tok>,
    frames: Vec<Frame>,
}

impl Lexer {
    fn push(&mut self, kind: Kind, end: usize) {
        self.toks.push(Tok {
            kind,
            end: end as u32,
            mate: 0,
        });
    }

    /// Emit an open token and enter `frame` (built from its index).
    fn open(&mut self, opener: u8, end: usize, frame: impl FnOnce(usize) -> Frame) {
        let at = self.toks.len();
        self.push(Kind::Open(opener), end);
        self.frames.push(frame(at));
    }

    /// Emit the close token of the open token `at`.
    fn close(&mut self, at: usize, end: usize) {
        let idx = self.toks.len() as u32;
        self.toks.push(Tok {
            kind: Kind::Close,
            end: end as u32,
            mate: at as u32,
        });
        self.toks[at].mate = idx;
    }
}

/// Tokens of `b`, with every open token paired with its close.
fn lex(b: &[u8], dialect: Dialect) -> Vec<Tok> {
    let mut lx = Lexer {
        toks: Vec::with_capacity(b.len() / 4),
        frames: vec![Frame::Code {
            opener: 0,
            at: usize::MAX,
            ctrl: false,
        }],
    };
    let mut i = 0;
    let mut slash = Slash::Regex;
    // The last word was `if`/`while`/`for`/`with` (so its `(` is a control paren),
    // or a `.` (so the next word is a property name, not a keyword).
    let mut ctrl = false;
    let mut after_dot = false;
    while i < b.len() {
        let frame = *lx.frames.last().unwrap_or(&Frame::Code {
            opener: 0,
            at: usize::MAX,
            ctrl: false,
        });
        match frame {
            Frame::Template { at } => {
                while i < b.len() {
                    match b[i] {
                        b'\\' => i += 2,
                        b'`' => {
                            i += 1;
                            lx.frames.pop();
                            lx.close(at, i);
                            slash = Slash::Divide;
                            break;
                        }
                        b'$' if b.get(i + 1) == Some(&b'{') => {
                            i += 2;
                            lx.open(b'$', i, |at| Frame::Code {
                                opener: b'$',
                                at,
                                ctrl: false,
                            });
                            slash = Slash::Regex;
                            break;
                        }
                        _ => i += 1,
                    }
                }
                continue;
            }
            Frame::Tag { at } => {
                match b[i] {
                    b'/' if b.get(i + 1) == Some(&b'>') => {
                        i += 2;
                        lx.frames.pop();
                        lx.close(at, i);
                        slash = Slash::Divide;
                    }
                    b'>' => {
                        i += 1;
                        if let Some(f) = lx.frames.last_mut() {
                            *f = Frame::Children { at };
                        }
                    }
                    b'{' => {
                        i += 1;
                        lx.open(b'j', i, |at| Frame::Code {
                            opener: b'j',
                            at,
                            ctrl: false,
                        });
                        slash = Slash::Regex;
                    }
                    q @ (b'"' | b'\'') => {
                        // JSX attribute strings have no escapes and may span lines.
                        i += 1;
                        while i < b.len() && b[i] != q {
                            i += 1;
                        }
                        i += 1;
                    }
                    _ => i += 1,
                }
                continue;
            }
            Frame::Children { at } => {
                while i < b.len() && b[i] != b'<' && b[i] != b'{' {
                    i += 1;
                }
                if i >= b.len() {
                    break;
                }
                if b[i] == b'{' {
                    i += 1;
                    lx.open(b'j', i, |at| Frame::Code {
                        opener: b'j',
                        at,
                        ctrl: false,
                    });
                    slash = Slash::Regex;
                    continue;
                }
                let mut j = i + 1;
                while j < b.len() && b[j].is_ascii_whitespace() {
                    j += 1;
                }
                if b.get(j) == Some(&b'/') {
                    // A closing tag ends this element.
                    while j < b.len() && b[j] != b'>' {
                        j += 1;
                    }
                    i = j + 1;
                    lx.frames.pop();
                    lx.close(at, i);
                    slash = Slash::Divide;
                } else {
                    i += 1;
                    lx.open(b'<', i, |at| Frame::Tag { at });
                }
                continue;
            }
            Frame::Code { .. } => {}
        }

        // Code.
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let rest = &b[i..];
        let starts = |p: &[u8]| rest.starts_with(p);
        let was_dot = after_dot;
        after_dot = false;
        let was_ctrl = ctrl;
        ctrl = false;
        match c {
            b'/' if starts(b"//") => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
                ctrl = was_ctrl;
                after_dot = was_dot;
                continue;
            }
            b'/' if starts(b"/*") => {
                i += 2;
                while i < b.len() && !b[i..].starts_with(b"*/") {
                    i += 1;
                }
                i = (i + 2).min(b.len());
                ctrl = was_ctrl;
                after_dot = was_dot;
                continue;
            }
            b'/' => {
                if slash == Slash::Regex
                    && let Some(e) = regex_end(b, i)
                {
                    i = e;
                    lx.push(Kind::Lit, i);
                    slash = Slash::Divide;
                } else {
                    i += if starts(b"/=") { 2 } else { 1 };
                    lx.push(Kind::Break, i);
                    slash = Slash::Regex;
                }
                continue;
            }
            b'"' | b'\'' => {
                i += 1;
                while i < b.len() && b[i] != c && b[i] != b'\n' {
                    i += if b[i] == b'\\' { 2 } else { 1 };
                }
                i = (i + 1).min(b.len());
                lx.push(Kind::Lit, i);
                slash = Slash::Divide;
                continue;
            }
            b'`' => {
                i += 1;
                lx.open(b'`', i, |at| Frame::Template { at });
                continue;
            }
            b'.' if b.get(i + 1).is_some_and(u8::is_ascii_digit) => {}
            b'0'..=b'9' => {}
            _ if is_ident_start(c)
                || (c == b'#' && b.get(i + 1).is_some_and(|&d| is_ident_start(d))) =>
            {
                i += 1;
                while i < b.len() && is_ident(b[i]) {
                    i += 1;
                }
                let word = &b[start..i];
                let keyword = !was_dot;
                let kind = if !keyword {
                    Word::Name
                } else if word == b"infer" {
                    Word::Infer
                } else if word == b"extends" {
                    Word::Extends
                } else if MODIFIERS.contains(&word) {
                    Word::Modifier
                } else if word == b"async" {
                    Word::Async
                } else if HEADS.contains(&word) {
                    Word::Head
                } else if RESERVED.contains(&word) {
                    Word::Reserved
                } else {
                    Word::Name
                };
                lx.push(Kind::Word(kind), i);
                slash = if keyword && BEFORE_OPERAND.contains(&word) {
                    Slash::Regex
                } else {
                    Slash::Divide
                };
                ctrl = keyword && matches!(word, b"if" | b"while" | b"for" | b"with");
                continue;
            }
            _ => {}
        }
        if c.is_ascii_digit() || c == b'.' && b.get(i + 1).is_some_and(u8::is_ascii_digit) {
            i += 1;
            while i < b.len() {
                let d = b[i];
                // Digits, letters (`0x1f`, `1e5`, `1n`), `.` and `_`, and an exponent's sign.
                let exponent_sign = matches!(d, b'+' | b'-') && matches!(b[i - 1], b'e' | b'E');
                if !(is_ident(d) || d == b'.' || exponent_sign) {
                    break;
                }
                i += 1;
            }
            lx.push(Kind::Lit, i);
            slash = Slash::Divide;
            continue;
        }
        let (kind, len, next) = match c {
            b'(' | b'[' | b'{' => {
                i += 1;
                let opener = c;
                let is_ctrl = c == b'(' && was_ctrl;
                lx.open(opener, i, |at| Frame::Code {
                    opener,
                    at,
                    ctrl: is_ctrl,
                });
                slash = Slash::Regex;
                continue;
            }
            b')' | b']' | b'}' => {
                i += 1;
                match frame {
                    Frame::Code {
                        opener: b'$' | b'j',
                        at,
                        ..
                    } if c == b'}' => {
                        // A template field or JSX container ends: back to its text.
                        lx.frames.pop();
                        lx.close(at, i);
                        slash = Slash::Regex;
                    }
                    Frame::Code {
                        opener: b'(' | b'[' | b'{',
                        at,
                        ctrl: was_ctrl_paren,
                    } => {
                        lx.frames.pop();
                        lx.close(at, i);
                        slash = if c == b')' && was_ctrl_paren {
                            Slash::Regex
                        } else {
                            Slash::Divide
                        };
                    }
                    // A stray closer: nothing to close.
                    _ => slash = Slash::Divide,
                }
                continue;
            }
            b'<' => {
                if slash == Slash::Regex && dialect.jsx && starts_jsx(b, i + 1, dialect) {
                    i += 1;
                    lx.open(b'<', i, |at| Frame::Tag { at });
                    continue;
                }
                if starts(b"<<=") {
                    (Kind::Break, 3, Slash::Regex)
                } else if starts(b"<=") {
                    (Kind::Break, 2, Slash::Regex)
                } else if starts(b"<<") {
                    (Kind::LtLt, 2, Slash::Regex)
                } else {
                    (Kind::Lt, 1, Slash::Divide)
                }
            }
            b'>' => (Kind::Gt, 1, Slash::Divide),
            b'=' if starts(b"=>") => (Kind::Arrow, 2, Slash::Regex),
            b'=' if starts(b"===") => (Kind::Break, 3, Slash::Regex),
            b'=' if starts(b"==") => (Kind::Break, 2, Slash::Regex),
            b'=' => (Kind::Eq, 1, Slash::Regex),
            b'!' if starts(b"!==") => (Kind::Break, 3, Slash::Regex),
            b'!' if starts(b"!=") => (Kind::Break, 2, Slash::Regex),
            b'&' | b'|' | b'?' if starts(&[c, c, b'=']) => (Kind::Break, 3, Slash::Regex),
            b'&' | b'|' | b'?' if starts(&[c, c]) => (Kind::Break, 2, Slash::Regex),
            b'&' | b'|' if starts(&[c, b'=']) => (Kind::Break, 2, Slash::Regex),
            b'?' if starts(b"?.") && !b.get(i + 2).is_some_and(u8::is_ascii_digit) => {
                (Kind::Other, 2, Slash::Regex)
            }
            b'?' => (Kind::Question, 1, Slash::Regex),
            b'+' | b'-' if starts(&[c, c]) => (Kind::Break, 2, Slash::Divide),
            b'+' | b'-' if starts(&[c, b'=']) => (Kind::Break, 2, Slash::Regex),
            b'*' if starts(b"**=") => (Kind::Break, 3, Slash::Regex),
            b'*' if starts(b"**") || starts(b"*=") => (Kind::Break, 2, Slash::Regex),
            b'*' | b'%' | b'^' | b'~' => (
                Kind::Break,
                if rest.get(1) == Some(&b'=') && c != b'~' {
                    2
                } else {
                    1
                },
                Slash::Regex,
            ),
            b'.' if starts(b"...") => (Kind::Dot3, 3, Slash::Regex),
            b'.' => {
                after_dot = true;
                (Kind::Other, 1, Slash::Regex)
            }
            b',' => (Kind::Comma, 1, Slash::Regex),
            b':' => (Kind::Colon, 1, Slash::Regex),
            b';' => (Kind::Semi, 1, Slash::Regex),
            b'!' if slash == Slash::Divide => (Kind::Other, 1, Slash::Divide),
            _ => (Kind::Other, 1, Slash::Regex),
        };
        i += len;
        lx.push(kind, i);
        slash = next;
    }
    // Pair what is still open with the end of input.
    let end = lx.toks.len() as u32;
    for f in lx.frames.drain(..) {
        let at = match f {
            Frame::Code { at, .. }
            | Frame::Template { at }
            | Frame::Tag { at }
            | Frame::Children { at } => at,
        };
        if let Some(t) = lx.toks.get_mut(at) {
            t.mate = end;
        }
    }
    lx.toks
}

// ---------- arrow parameter guesses ----------

/// The first index at or after `j` (before `close`) of a token at this level that
/// `stop` accepts, stepping over nested brackets; `close` when there is none.
fn scan_to(t: &[Tok], mut j: usize, close: usize, stop: impl Fn(Kind) -> bool) -> usize {
    while j < close {
        let k = t[j].kind;
        if stop(k) {
            return j;
        }
        j = match k {
            Kind::Open(_) => t[j].mate as usize + 1,
            _ => j + 1,
        };
    }
    close
}

/// `Ok(next)` past one parameter-like element starting at `j`, or `Err(at)` where a
/// parameter list cannot continue. Over-accepts: modifiers, `?`, a type annotation
/// and a default value anywhere one may stand.
fn element(t: &[Tok], mut j: usize, close: usize) -> Result<usize, usize> {
    while j < close && t[j].kind == Kind::Word(Word::Modifier) {
        j += 1;
    }
    if j < close && t[j].kind == Kind::Dot3 {
        j += 1;
    }
    if j >= close {
        return Err(j);
    }
    j = match t[j].kind {
        Kind::Word(Word::Name | Word::Infer | Word::Extends | Word::Modifier | Word::Async) => {
            j + 1
        }
        Kind::Open(b'[') => array_pattern(t, j)?,
        Kind::Open(b'{') => object_pattern(t, j)?,
        _ => return Err(j),
    };
    if j < close && t[j].kind == Kind::Question {
        j += 1;
    }
    if j < close && t[j].kind == Kind::Colon {
        j = scan_to(t, j + 1, close, |k| matches!(k, Kind::Comma | Kind::Eq));
    }
    if j < close && t[j].kind == Kind::Eq {
        j = scan_to(t, j + 1, close, |k| k == Kind::Comma);
    }
    Ok(j)
}

/// Comma-separated items up to `close`: `Ok(close)` when all fit.
fn items(
    t: &[Tok],
    mut j: usize,
    close: usize,
    item: impl Fn(&[Tok], usize, usize) -> Result<usize, usize>,
) -> Result<usize, usize> {
    loop {
        if j >= close {
            return Ok(close);
        }
        j = item(t, j, close)?;
        if j >= close {
            return Ok(close);
        }
        if t[j].kind != Kind::Comma {
            return Err(j);
        }
        j += 1;
    }
}

/// `[a, , [b] = c, ...d]` opened at `j`: `Ok` past its `]`.
fn array_pattern(t: &[Tok], j: usize) -> Result<usize, usize> {
    let close = t[j].mate as usize;
    items(t, j + 1, close, |t, j, close| {
        if t[j].kind == Kind::Comma {
            Ok(j) // a hole
        } else {
            element(t, j, close)
        }
    })?;
    Ok(close + 1)
}

/// `{ a, b: [c], d = e, [f]: g, ...h }` opened at `j`: `Ok` past its `}`.
fn object_pattern(t: &[Tok], j: usize) -> Result<usize, usize> {
    let close = t[j].mate as usize;
    items(t, j + 1, close, |t, j, close| {
        let next = match t[j].kind {
            Kind::Dot3 => return element(t, j, close),
            // Any word is a key (`{ default: d }`).
            Kind::Word(_) | Kind::Lit => j + 1,
            Kind::Open(b'[') => t[j].mate as usize + 1,
            _ => return Err(j),
        };
        if next >= close {
            return Ok(next);
        }
        match t[next].kind {
            Kind::Colon => element(t, next + 1, close),
            Kind::Eq => Ok(scan_to(t, next + 1, close, |k| k == Kind::Comma)),
            _ => Ok(next),
        }
    })?;
    Ok(close + 1)
}

/// The last token an arrow-parameter guess at the `(` at `i` reads, or `None` when
/// it reads nothing twice (it cannot start, or it is an arrow and succeeds).
/// `outer` is the close of the enclosing level; `in_conditional`: an unfinished
/// `?` precedes it there, where a return type may be rewound after the body.
fn arrow_guess(t: &[Tok], i: usize, outer: usize, in_conditional: bool) -> Option<usize> {
    let close = t[i].mate as usize;
    match items(t, i + 1, close, element) {
        Err(at) if at <= i + 1 => None,
        Err(at) => Some(at),
        Ok(_) => match t.get(close + 1).map(|t| t.kind) {
            Some(Kind::Arrow) => None,
            Some(Kind::Colon) => {
                // A return type: read to the `=>`, and in a conditional's true branch
                // the body too (the parser may rewind after it).
                let stop = move |k| {
                    matches!(k, Kind::Comma | Kind::Semi | Kind::Break)
                        || (!in_conditional && k == Kind::Arrow)
                };
                Some(scan_to(t, close + 2, outer, stop).min(t.len().saturating_sub(1)))
            }
            _ => Some(close),
        },
    }
}

// ---------- cost ----------

/// An unfinished type-argument (or `infer` constraint) guess.
#[derive(Debug, Clone, Copy)]
struct Guess {
    /// The level's angle count before its `<` (or at its `extends`).
    base: i64,
    /// An `infer` constraint: ends at a `?` or `,`, or a `>` below its start.
    constraint: bool,
}

#[derive(Debug)]
struct Level {
    guesses: Vec<Guess>,
    /// `<` minus `>` seen at this level.
    angle: i64,
    /// Unfinished `?` of conditional expressions at this level.
    conditionals: u32,
    /// TypeScript: angle counts before each unfinished `<` at an operand position
    /// (a generic arrow's type parameters `<T>(x) => x`, or a type assertion).
    heads: Vec<i64>,
    /// Index of the level's close token.
    close: usize,
}

impl Level {
    fn new(close: usize) -> Self {
        Self {
            guesses: Vec::new(),
            angle: 0,
            conditionals: 0,
            heads: Vec::new(),
            close,
        }
    }
}

/// How many times the current position is read, and its `log2` (kept as a sum, so
/// many guesses multiply without overflow).
struct Cost {
    log_reads: f64,
    reads: f64,
}

impl Cost {
    /// One more guess at a level that had `n`: reads go from `n + 1` to `n + 2` there.
    fn add(&mut self, n: usize) {
        self.shift(((n + 2) as f64).log2() - ((n + 1) as f64).log2());
    }

    fn remove(&mut self, n: usize) {
        self.shift((n as f64).log2() - ((n + 1) as f64).log2());
    }

    /// Multiply the reads by `2^by`.
    fn shift(&mut self, by: f64) {
        self.log_reads += by;
        self.reads = self.log_reads.exp2();
    }
}

fn close_guesses(level: &mut Level, cost: &mut Cost, keep: impl Fn(&Guess, i64) -> bool) {
    while let Some(g) = level.guesses.last() {
        if keep(g, level.angle - g.base) {
            break;
        }
        cost.remove(level.guesses.len());
        level.guesses.pop();
    }
}

/// Reads beyond which a file is over any budget (`2^40`).
const LOG_READS_CAP: f64 = 40.0;

fn sweep(t: &[Tok], dialect: Dialect, len: usize) -> f64 {
    let budget = MAX_READS_PER_BYTE * len as f64 + SLACK_BYTES;
    let mut levels = vec![Level::new(t.len())];
    let mut cost = Cost {
        log_reads: 0.0,
        reads: 1.0,
    };
    // Ends of the arrow-parameter guesses being read, innermost last.
    let mut arrows: Vec<usize> = Vec::new();
    // The `>` that last ended a generic arrow's type parameters.
    let mut generic_head = None;
    let mut total = 0.0;
    let mut prev_end = 0u32;
    for (idx, tok) in t.iter().enumerate() {
        total += f64::from(tok.end - prev_end) * cost.reads;
        prev_end = tok.end;
        if total > budget || cost.log_reads > LOG_READS_CAP {
            return f64::INFINITY;
        }
        let prev = idx.checked_sub(1).map(|p| t[p].kind);
        let after_operand = matches!(
            prev,
            Some(Kind::Word(
                Word::Name | Word::Infer | Word::Extends | Word::Modifier | Word::Async
            )) | Some(Kind::Lit | Kind::Close)
        );
        let Some(level) = levels.last_mut() else {
            break;
        };
        match tok.kind {
            Kind::Lt | Kind::LtLt => {
                let n = if tok.kind == Kind::Lt { 1 } else { 2 };
                if dialect.typescript && after_operand {
                    level.guesses.push(Guess {
                        base: level.angle,
                        constraint: false,
                    });
                    cost.add(level.guesses.len() - 1);
                } else if dialect.typescript {
                    level.heads.push(level.angle);
                }
                level.angle += n;
            }
            Kind::Gt => {
                level.angle -= 1;
                if level.heads.last() == Some(&level.angle) {
                    level.heads.pop();
                    generic_head = Some(idx);
                }
                close_guesses(level, &mut cost, |g, bal| {
                    if g.constraint { bal >= 0 } else { bal > 0 }
                });
            }
            Kind::Eq => {
                close_guesses(level, &mut cost, |g, bal| {
                    if g.constraint { bal > 0 } else { bal != 1 }
                });
            }
            Kind::Break | Kind::Semi => close_guesses(level, &mut cost, |_, _| false),
            Kind::Comma => close_guesses(level, &mut cost, |g, bal| !(g.constraint && bal == 0)),
            Kind::Question => {
                level.conditionals += 1;
                close_guesses(level, &mut cost, |g, bal| !(g.constraint && bal == 0));
            }
            Kind::Colon => level.conditionals = level.conditionals.saturating_sub(1),
            Kind::Word(Word::Extends)
                if dialect.typescript
                    && idx >= 2
                    && matches!(prev, Some(Kind::Word(_)))
                    && t[idx - 2].kind == Kind::Word(Word::Infer) =>
            {
                level.guesses.push(Guess {
                    base: level.angle,
                    constraint: true,
                });
                cost.add(level.guesses.len() - 1);
            }
            Kind::Open(opener) => {
                // A `(` where an expression starts may open an arrow's parameters; one
                // after a name, a literal or a closer is a call's arguments or a
                // declaration's parameters, read once.
                let expression = match prev {
                    None => true,
                    Some(Kind::Word(Word::Async)) => true,
                    Some(Kind::Word(_) | Kind::Lit) => {
                        matches!(prev, Some(Kind::Word(Word::Reserved)))
                    }
                    // After a block, a statement starts.
                    Some(Kind::Close) => t[t[idx - 1].mate as usize].kind == Kind::Open(b'{'),
                    Some(Kind::Gt) => generic_head == Some(idx - 1),
                    _ => true,
                };
                if opener == b'('
                    && expression
                    && let Some(end) = arrow_guess(t, idx, level.close, level.conditionals > 0)
                {
                    arrows.push(end);
                    cost.shift(1.0);
                }
                levels.push(Level::new(tok.mate as usize));
            }
            Kind::Close => {
                if levels.len() > 1
                    && let Some(mut l) = levels.pop()
                {
                    close_guesses(&mut l, &mut cost, |_, _| false);
                }
            }
            _ => {}
        }
        while arrows.last().is_some_and(|&e| e <= idx) {
            arrows.pop();
            cost.shift(-1.0);
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    const TS: Dialect = Dialect {
        typescript: true,
        jsx: false,
    };
    const TSX: Dialect = Dialect {
        typescript: true,
        jsx: true,
    };
    const JS: Dialect = Dialect {
        typescript: false,
        jsx: true,
    };

    fn ratio(src: &str, d: Dialect) -> f64 {
        cost(src, d) / src.len() as f64
    }

    #[test]
    fn ordinary_code_is_read_about_once() {
        let src = r#"
import { useState } from "react";
export function f<T extends object>(xs: Array<Map<string, T>>, n: number): Promise<T[]> {
  for (let i = 0; i < n; i++) { if (xs[i] && i < 3 || n > 2) continue; }
  const m = new Map<string, number>();
  const ok = a < b ? (c) : d;
  const g = ({ a, b = 1 }: Props): number => a + b;
  return foo<T>(xs, (x) => x < 1, [a, b], { a: 1, b: [c] });
}
type U<T> = T extends Array<infer A extends string> ? A : never;
"#;
        // A dense sample: real files read about 1.05 times per byte.
        assert!(ratio(src, TS) < 2.0, "{}", ratio(src, TS));
        let jsx = r#"
const A = ({ items }: { items: string[] }) => (
  <ul className="x">{items.map((i) => <li key={i}>Don't {i < 3 ? "a" : 'b'} / {i}</li>)}</ul>
);
"#;
        assert!(ratio(jsx, TSX) < 2.0, "{}", ratio(jsx, TSX));
        assert!(ratio(jsx, JS) < 2.0, "{}", ratio(jsx, JS));
    }

    fn call_shape(n: usize) -> String {
        format!("x={}b{}", "a<\n".repeat(n), ">()\n".repeat(n))
    }

    #[test]
    fn nested_generic_calls_are_too_costly() {
        assert!(!too_costly(&call_shape(8), TS));
        assert!(too_costly(&call_shape(2_000), TS));
        assert!(too_costly(&format!("x={}a", "a<\n".repeat(3_000)), TS));
        // JavaScript has no type arguments: `<` is a comparison.
        assert!(!too_costly(&call_shape(2_000), JS));
    }

    #[test]
    fn nested_guesses_are_too_costly() {
        let init = |n| format!("x={}b{}", "a<(y=\n".repeat(n), ")>()\n".repeat(n));
        assert!(!too_costly(&init(4), TS));
        assert!(too_costly(&init(24), TS));
        let pay = "g(1),\n".repeat(2_000);
        let wrap = |n| format!("x={}({pay}){}", "([a=\n".repeat(n), "])\n".repeat(n));
        assert!(!too_costly(&wrap(1), JS));
        assert!(too_costly(&wrap(40), JS));
        let mut inner = "0".to_string();
        for _ in 0..24 {
            inner = format!("((a: infer B extends\n{inner} ? 0 : 0) => 0)");
        }
        assert!(too_costly(
            &format!("type T<X> = X extends [{inner}] ? 1 : 2\n"),
            TS
        ));
    }
}
