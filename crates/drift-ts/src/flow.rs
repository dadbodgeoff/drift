//! JavaScript files with type annotations (Flow), which the JavaScript parser rejects.
//!
//! Babel-built projects (Create React App among them) type `.js` files with Flow:
//! `({ id }: Object) => …`, `function f(x: string): ?string`, `type Props = {…}`,
//! `import type { T } from "…"`. oxc has no Flow mode, so such a file fails to parse
//! as JavaScript and would contribute no facts.
//!
//! [`strip_types`] reads the file as TypeScript and blanks the type syntax it finds
//! there (annotations, type parameters and arguments, type aliases, interfaces,
//! type-only imports and exports) with spaces, keeping every line break, so the
//! result has the same length and lines. That copy is accepted only when
//!
//! - the TypeScript parse has no error, and holds no other TypeScript node (casts,
//!   enums, namespaces, `implements`, `this` parameters, inline `type` specifiers,
//!   …) and no type-only class field (`x: T;`, which Babel removes and TypeScript
//!   may keep);
//! - the copy parses as JavaScript with no error;
//! - the JavaScript program is the TypeScript program without its type syntax:
//!   the same nodes, of the same kinds, in the same tree shape. Blanking a type
//!   alias between two statements cannot then join them (`a = 1⏎type T = U⏎[x]`),
//!   and syntax that means something else in JavaScript (`f<T>(x)`) cannot slip
//!   through unblanked.
//!
//! Flow syntax that TypeScript does not share (`{| |}` exact objects, `opaque type`,
//! `%checks`, variance `+x`, `(x: T)` casts, `import typeof`, existential `*`, bounds
//! `<T: U>`) makes the TypeScript parse fail, so the file is
//! [`Typed::Unsupported`]: skipped with its own reason, never guessed at.

use oxc_allocator::Allocator;
use oxc_ast::ast::{Declaration, PropertyDefinition};
use oxc_ast::{AstKind, AstType};
use oxc_ast_visit::Visit;
use oxc_parser::{Parser, ParserReturn};
use oxc_span::{SourceType, Span};

/// What a JavaScript file that does not parse as JavaScript is, read with types.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Typed {
    /// The file with its type syntax blanked out (same length, same lines): plain
    /// JavaScript, parsed without error into the program the typed parse found.
    Stripped(String),
    /// It has type syntax that cannot be removed with certainty (see the module
    /// docs): no facts.
    Unsupported,
    /// No sign of type syntax: an ordinary syntax error, left to the JavaScript
    /// parse's own recovery.
    Untyped,
}

/// Read `text` (a JavaScript file of type `js` whose JavaScript parse failed) with
/// types, in `allocator`. See the module docs.
pub(crate) fn strip_types(allocator: &Allocator, text: &str, js: SourceType) -> Typed {
    let plain = Parser::new(allocator, text, js).parse();
    if !plain.diagnostics.has_errors() {
        // Nothing to strip: the caller only asks for files that do not parse.
        return Typed::Untyped;
    }
    let pragma = plain.is_flow_language;
    let plain_at = first_error_at(&plain);
    let typed = Parser::new(allocator, text, js.with_typescript(true)).parse();
    if typed.diagnostics.has_errors() {
        // The typed read got past where the plain one stopped: the file has type
        // syntax, of a kind TypeScript does not share. (With a `@flow` pragma the
        // plain read's one error points at the pragma's comment, so this holds.)
        return if first_error_at(&typed) > plain_at {
            Typed::Unsupported
        } else {
            Typed::Untyped
        };
    }
    let mut shape = Shape::default();
    shape.visit_program(&typed.program);
    if shape.blanks.is_empty() && !shape.refused {
        return if pragma {
            Typed::Unsupported
        } else {
            Typed::Untyped
        };
    }
    if shape.refused {
        return Typed::Unsupported;
    }
    let stripped = blank(text, &shape.blanks);
    let reread = Parser::new(allocator, &stripped, js).parse();
    if reread.diagnostics.has_errors() {
        return Typed::Unsupported;
    }
    let mut again = Shape::default();
    again.visit_program(&reread.program);
    if again.refused || !again.blanks.is_empty() || again.kinds != shape.kinds {
        return Typed::Unsupported;
    }
    Typed::Stripped(stripped)
}

/// Where the parse first stopped: the earliest error, at its furthest label (an
/// error can also point back at what it closes, `Opened here`). 0 when no error
/// has a label.
fn first_error_at(ret: &ParserReturn) -> u32 {
    ret.diagnostics
        .iter()
        .filter_map(|d| d.labels.iter().map(|l| l.offset()).max())
        .min()
        .unwrap_or(0)
}

/// `text` with every byte inside `spans` replaced by a space, except line breaks.
fn blank(text: &str, spans: &[Span]) -> String {
    let mut bytes = text.as_bytes().to_vec();
    for s in spans {
        for b in &mut bytes[s.start as usize..s.end as usize] {
            if !matches!(*b, b'\n' | b'\r') {
                *b = b' ';
            }
        }
    }
    // Only whole spans of the source are blanked, and a span never splits a
    // character; non-ASCII bytes inside one all become spaces.
    String::from_utf8(bytes).unwrap_or_default()
}

/// The program's nodes in pre-order, as (kind, depth), with the type syntax left
/// out (and its spans kept, to blank).
#[derive(Default)]
struct Shape {
    kinds: Vec<(AstType, u32)>,
    depth: u32,
    /// Depth inside a node being blanked (0 when outside one).
    inside_blank: u32,
    blanks: Vec<Span>,
    /// A TypeScript node that is not blanked, or type syntax this module does not
    /// remove.
    refused: bool,
}

impl<'a> Visit<'a> for Shape {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        if self.inside_blank > 0 {
            self.inside_blank += 1;
            return;
        }
        if let Some(span) = type_only(&kind) {
            self.blanks.push(span);
            self.inside_blank = 1;
            return;
        }
        if refused(&kind) {
            self.refused = true;
        }
        self.kinds.push((kind.ty(), self.depth));
        self.depth += 1;
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        if self.inside_blank > 0 {
            self.inside_blank -= 1;
        } else {
            self.depth -= 1;
        }
    }
}

/// The span to blank when `kind` is type syntax as a whole.
fn type_only(kind: &AstKind) -> Option<Span> {
    match kind {
        AstKind::TSTypeAnnotation(t) => Some(t.span),
        AstKind::TSTypeParameterDeclaration(t) => Some(t.span),
        AstKind::TSTypeParameterInstantiation(t) => Some(t.span),
        AstKind::TSTypeAliasDeclaration(t) => Some(t.span),
        AstKind::TSInterfaceDeclaration(t) => Some(t.span),
        AstKind::ImportDeclaration(d) if d.import_kind.is_type() => Some(d.span),
        AstKind::ExportNamedDeclaration(d) if d.export_kind.is_type() => Some(d.span),
        AstKind::ExportFromDeclaration(d) if d.export_kind.is_type() => Some(d.span),
        AstKind::ExportAllDeclaration(d) if d.export_kind.is_type() => Some(d.span),
        AstKind::ExportDeclaration(d)
            if matches!(
                d.declaration,
                Declaration::TSTypeAliasDeclaration(_) | Declaration::TSInterfaceDeclaration(_)
            ) =>
        {
            Some(d.span)
        }
        _ => None,
    }
}

/// True for syntax [`type_only`] does not blank and JavaScript does not have, or
/// whose stripped meaning is not certain.
fn refused(kind: &AstKind) -> bool {
    match kind {
        // `import { type T, f }`: Babel drops the specifier, or the whole import
        // when none is left; not decided here.
        AstKind::ImportSpecifier(s) => s.import_kind.is_type(),
        AstKind::ExportSpecifier(s) => s.export_kind.is_type(),
        // `x: T;` with no value: Babel removes the field unless configured to keep
        // it, TypeScript keeps it or not by its own option.
        AstKind::PropertyDefinition(p) => type_only_field(p),
        _ => {
            let name = format!("{:?}", kind.ty());
            name.starts_with("TS") || name.starts_with("JSDoc")
        }
    }
}

fn type_only_field(p: &PropertyDefinition) -> bool {
    p.value.is_none() && p.type_annotation.is_some() || p.declare || p.definite || p.optional
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(src: &str) -> Typed {
        let a = Allocator::default();
        strip_types(&a, src, SourceType::jsx())
    }

    fn stripped(src: &str) -> String {
        match run(src) {
            Typed::Stripped(s) => s,
            other => panic!("{other:?} for {src:?}"),
        }
    }

    #[test]
    fn blanks_annotations_keeping_offsets() {
        let src = "export function f({ a }: Object, b: ?string): number {\n  return a;\n}\n";
        let out = stripped(src);
        assert_eq!(out.len(), src.len());
        assert_eq!(
            out,
            "export function f({ a }        , b         )         {\n  return a;\n}\n"
        );
    }

    #[test]
    fn blanks_whole_type_statements() {
        let src = "import type { T } from './t';\nexport type P = {\n  a: T,\n};\ntype Q = P;\nconst x = 1;\n";
        let out = stripped(src);
        assert_eq!(out.lines().count(), src.lines().count());
        assert_eq!(out.trim(), "const x = 1;");
    }

    #[test]
    fn refuses_what_it_cannot_remove_with_certainty() {
        for src in [
            // Flow-only syntax after an annotation both read: the TypeScript parse
            // fails, further on than the JavaScript one.
            "export const f = (x: A) => x;\ntype A = {| a: number |};\n",
            "const f = (x: T) => x;\nopaque type T = string;\n",
            "function isStr(x: mixed): boolean %checks { return typeof x === 'string'; }\n",
            "const f = (p: P) => p;\ntype P = { +a: number };\n",
            "const f = (z: number) => z;\nconst y = (x: any);\n",
            "const f = (z: T) => z;\nimport typeof T from './t';\n",
            "function f(p: Promise<*>) { return p; }\n",
            "function f<T: Object>(x: T): T { return x; }\n",
            // Flow-only syntax first, in a `@flow` file.
            "/* @flow */\nopaque type T = string;\n",
            // TypeScript nodes with no JavaScript meaning to strip to.
            "const f = (x: number) => x as any;\n",
            "enum E { A }\nconst f = (x: E) => x;\n",
            "class A implements B { m(x: number) { return x; } }\n",
            "function f(this: Window, x: number) { return x; }\n",
            "import { type T, f } from './t';\nconst g = (x: T) => f(x);\n",
            "class A { x: number; m(y: number) { return y; } }\n",
            // A modifier JavaScript reads with a recoverable error (same nodes).
            "class A { public x = 1; m(y: number) { return y; } }\n",
            // The stripped copy would not parse.
            "function f(x?: number) { return x; }\n",
            // A `@flow` file with no annotation TypeScript can read.
            "// @flow\nfunction f(x) { return x }\nnot valid at all\n",
            // A `@flow` file with no annotation, read by TypeScript with no error.
            "/* @flow */\nclass A { public x = 1 }\n",
            // A TypeScript node around blanked type arguments (`f<T>` uncalled).
            "const g = f<string>;\nconst h = (x: number) => x;\n",
        ] {
            assert_eq!(run(src), Typed::Unsupported, "{src}");
        }
    }

    #[test]
    fn leaves_ordinary_syntax_errors_alone() {
        // Known limit: Flow-only syntax before any annotation TypeScript reads, in a
        // file with no `@flow` pragma, fails both parses at the same place and reads
        // as an ordinary syntax error (no facts either way).
        for src in [
            "const x = ;\n",
            "function f( {\n",
            "let a = 1 +* 2;\n",
            "opaque type T = string;\n",
            // TypeScript syntax JavaScript recovers from, with no type annotation.
            "class A { public x = 1 }\n",
        ] {
            assert_eq!(run(src), Typed::Untyped, "{src}");
        }
    }

    #[test]
    fn refuses_a_strip_that_joins_statements() {
        // Without its type alias the next line would continue `a = 1` as `1[0]`.
        let src = "let a = 1\ntype T = number\n[0].forEach((x: T) => x)\n";
        assert_eq!(run(src), Typed::Unsupported);
    }

    #[test]
    fn strips_type_arguments_that_javascript_would_compare() {
        let src = "const s = useState<string>('');\nconst m = new Map<string, number>();\nconst f = <T,>(x: T): T => x;\n";
        let out = stripped(src);
        assert!(!out.contains('<') && !out.contains('>') || out.contains("=>"));
        assert!(out.contains("useState        ('')"));
        assert!(out.contains("new Map                ()"));
    }
}
