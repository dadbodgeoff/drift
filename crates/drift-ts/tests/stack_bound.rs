//! The parse stack covers the worst case under the size cap by construction.
//!
//! Each shape nests as often as its file's length allows, and is lowered (parse, semantic pass, Drift's visitors, drop)
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
//! Call chains (`a()()()`), whose lowering takes time quadratic in the nesting (minutes or more at the
//! cap), get a smaller fraction of the cap in both, scaled the same way.

use drift_core::ingest::MAX_FILE_BYTES;
use drift_core::stack;
use drift_ts::lower::lower_file;

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

/// (file, [prefix, open, mid, close, suffix]); `close` empty: left open, which the
/// parser descends into twice as deep as a balanced file.
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

/// (file, [prefix, open, mid, close, suffix]); `close` empty: left open, which the
/// parser descends into twice as deep as a balanced file.
const SHAPES: &[(&str, [&str; 5])] = &[
    ("a.ts", ["x=", "(", "", "", ""]),
    ("a.ts", ["x=", "(", "1", ")", ";"]),
    ("a.ts", ["type T = ", "A<\n", "", "", ""]),
    ("a.ts", ["type T = ", "A<", "B", ">", ";"]),
    ("a.ts", ["type T = ", "[", "", "", ""]),
    ("a.ts", ["type T = ", "[", "", "]", ";"]),
    ("a.tsx", ["x=", "<a>", "", "", ""]),
    ("a.tsx", ["x=", "<a>", "", "</a>", ";"]),
    ("a.js", ["x=", "<a>", "", "</a>", ";"]),
    ("a.ts", ["x=", "[", "", "", ""]),
    ("a.ts", ["x=", "[", "", "]", ";"]),
    ("a.ts", ["x=", "!", "y", "", ";"]),
    ("a.ts", ["x=", "- ", "y", "", ";"]),
    ("a.ts", ["x=a", "", "", ".b", ";"]),
    ("a.ts", ["x=a", "", "", "!", ";"]),
    ("a.ts", ["x=", "`${", "", "", ""]),
    ("a.ts", ["", "{", "", "", ""]),
    ("a.ts", ["", "{", "", "}", ""]),
    ("a.ts", ["", "if(1)", ";", "", ""]),
    ("a.ts", ["", "a:", ";", "", ""]),
    ("a.ts", ["", "a=", "1", "", ";"]),
    ("a.ts", ["x=", "()=>{", "", "}", ";"]),
];

#[test]
fn worst_case_nesting_does_not_overflow_the_parse_stack() {
    for (file, shape) in SHAPES {
        let text = at_len(LEN, *shape);
        assert_eq!(text.len(), LEN);
        assert!(
            on_stack(LEN, || drop(lower_file(file, &text))),
            "{file} {shape:?}"
        );
    }
    let len = 8 * 1024;
    let text = at_len(len, ["x=a", "", "", "()", ";"]);
    assert!(on_stack(len, || drop(lower_file("a.ts", &text))));
}
