//! The parse stack covers the worst case under the size cap by construction.
//!
//! Each shape nests as often as its file's length allows, and is lowered (parse, Drift's visitors, the recursive drop of the syntax tree)
//! directly on the stack: the nesting guard is bypassed, so the stack bound itself
//! is what is tested. A stack overflow aborts the test binary.
//!
//! Release builds, whose stack is the one shipped, lower files of exactly the size
//! cap on the stack a scan gives a file of that length, `stack::with_stack_for`
//! (CI runs these with `--release`). Debug builds,
//! whose frames are larger, lower files of an eighth of the cap on a stack scaled
//! down to them by the debug allowance per byte with no base: a stricter test,
//! since the cost per byte does not depend on the file's length.
//!
//! F-string fields (ruff) and call chains (Drift's lowering), whose parse or lowering takes time quadratic in the nesting (minutes or more at the
//! cap), get a smaller fraction of the cap in both, scaled the same way.

use drift_core::ingest::MAX_FILE_BYTES;
use drift_core::stack;
use drift_py::lower::lower_file;

/// `prefix`, `open` as often as fits, `mid`, as many `close`, `suffix`, padded with
/// spaces to exactly `len` bytes.
fn at_len(len: usize, [prefix, open, mid, close, suffix]: [&str; 5]) -> String {
    let fixed = prefix.len() + mid.len() + suffix.len();
    let n = (len - fixed) / (open.len() + close.len());
    let mut s = String::with_capacity(len);
    s.push_str(prefix);
    s.push_str(&open.repeat(n));
    s.push_str(mid);
    s.push_str(&close.repeat(n));
    s.push_str(suffix);
    s.push_str(&" ".repeat(len - s.len()));
    s
}

/// `stmt` nested by indentation, one space per level, as deep as `len` bytes allow,
/// padded to exactly `len` bytes.
fn indented(len: usize, stmt: &str) -> String {
    let mut s = String::with_capacity(len);
    let mut depth = 0;
    // This level's line, then the innermost `pass` one deeper.
    while s.len() + (2 * depth + 1) + stmt.len() + "pass\n".len() <= len {
        s.push_str(&" ".repeat(depth));
        s.push_str(stmt);
        depth += 1;
    }
    s.push_str(&" ".repeat(depth));
    s.push_str("pass\n");
    s.push_str(&" ".repeat(len - s.len()));
    s
}

/// The length of each worst-case file (see the module docs).
const LEN: usize = if cfg!(debug_assertions) {
    MAX_FILE_BYTES as usize / 8
} else {
    MAX_FILE_BYTES as usize
};

/// Run `f` on the stack `len` bytes of source are allowed: the parse stack at the
/// size cap, a scaled one below it.
fn on_stack(len: usize, f: impl FnOnce() + Send) -> bool {
    if len == MAX_FILE_BYTES as usize {
        assert_eq!(stack::stack_bytes_for(len), Some(stack::PARSE_STACK_BYTES));
        // The stack the scan gives a file of this length; the release bound is
        // tested only where it can be reserved.
        stack::with_stack_for(len, f).expect("the full parse stack can be reserved");
        true
    } else {
        stack::run_scaled(len, f).is_some()
    }
}

/// [prefix, open, mid, close, suffix]; `close` empty: left open, which the parser
/// descends into twice as deep as a balanced file.
const SHAPES: &[[&str; 5]] = &[
    ["x=", "(", "", "", ""],
    ["x=", "(", "1", ")", "\n"],
    ["x=", "[", "", "", ""],
    ["x=", "[", "", "]", "\n"],
    ["x=", "{", "", "", ""],
    ["x=", "{", "1", "}", "\n"],
    ["x=", "{1:", "1", "}", "\n"],
    ["x=", "f(", "1", ")", "\n"],
    ["x=a", "", "", ".b", "\n"],
    ["x=a", "", "", "[0]", "\n"],
    ["x=", "-", "1", "", "\n"],
    ["x=", "not ", "1", "", "\n"],
    ["x=", "2**", "2", "", "\n"],
    ["x=1", "", "", "+1", "\n"],
    ["x=", "lambda:", "1", "", "\n"],
    ["match x:\n case ", "[", "", "", ""],
];

/// Shapes lowered at a fraction of the cap, with the bytes each gets.
const SLOW_SHAPES: &[([&str; 5], usize)] = &[
    (["x=", "f\"{", "", "", ""], 64 * 1024),
    (["x=", "f\"{", "1", "}\"", "\n"], 64 * 1024),
    (["x=", "f\"{1:{", "1", "}}\"", "\n"], 64 * 1024),
    (["x=a", "", "", "()", "\n"], 8 * 1024),
];

#[test]
fn worst_case_nesting_does_not_overflow_the_parse_stack() {
    for shape in SHAPES {
        let text = at_len(LEN, *shape);
        assert_eq!(text.len(), LEN);
        assert!(
            on_stack(LEN, || drop(lower_file("a.py", &text))),
            "{shape:?}"
        );
    }
    for (shape, len) in SLOW_SHAPES {
        let text = at_len(*len, *shape);
        assert!(
            on_stack(*len, || drop(lower_file("a.py", &text))),
            "{shape:?}"
        );
    }
    for stmt in ["if 1:\n", "def f():\n", "class A:\n"] {
        let text = indented(LEN, stmt);
        assert_eq!(text.len(), LEN);
        assert!(
            on_stack(LEN, || drop(lower_file("a.py", &text))),
            "{stmt:?}"
        );
    }
}
