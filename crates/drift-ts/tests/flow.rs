//! JavaScript typed with Flow: the facts of a file whose type syntax TypeScript
//! shares are the facts of the same file stripped by hand; anything else is skipped
//! as `flow_syntax`, never read with guessed facts. Synthetic probes, one per
//! construct.

use drift_core::SkipReason;
use drift_ts::lower::{RawFile, lower_on_stack};

fn lower(path: &str, text: &str) -> RawFile {
    lower_on_stack(path, text).expect("stack")
}

/// Each probe: a Flow-typed file and the same file with its types deleted by hand
/// (line breaks kept, so lines match; columns need not).
const SAME_AS_HAND_STRIPPED: &[(&str, &str, &str)] = &[
    (
        "parameter, return and maybe types",
        r#"import { api } from './api';
export function getItem(key: string, fallback: ?string): ?string {
  return api.get(key) || fallback;
}
export const Card = ({ title, onClick }: Object): React$Node => {
  return api.track(title, onClick);
};
"#,
        r#"import { api } from './api';
export function getItem(key, fallback) {
  return api.get(key) || fallback;
}
export const Card = ({ title, onClick }) => {
  return api.track(title, onClick);
};
"#,
    ),
    (
        "type aliases, interfaces and type-only imports and exports",
        r#"// @flow
import type { User } from './user';
import type Store from './store';
import { load } from './load';
export type Props = {
  user: User,
  onSave?: (u: User) => void,
  tags: Array<string>,
};
type Callback = (string, number) => mixed;
interface Named { name: string }
export type { Callback };
export function save(p: Props, cb: Callback) {
  return load(p.user, cb);
}
"#,
        r#"// @flow


import { load } from './load';








export function save(p, cb) {
  return load(p.user, cb);
}
"#,
    ),
    (
        "type parameters and type arguments",
        r#"import { useState } from 'react';
import { fetchAll } from './net';
export function first<T>(xs: Array<T>): T {
  return xs[0];
}
export function useList() {
  const [items, setItems] = useState<Array<string>>([]);
  const seen = new Map<string, number>();
  const pick = <K,>(k: K): K => k;
  return fetchAll<string>(items, seen, pick, setItems);
}
"#,
        r#"import { useState } from 'react';
import { fetchAll } from './net';
export function first(xs) {
  return xs[0];
}
export function useList() {
  const [items, setItems] = useState([]);
  const seen = new Map();
  const pick = (k) => k;
  return fetchAll(items, seen, pick, setItems);
}
"#,
    ),
    (
        "JSX components with typed props, typed class members",
        r#"import React from 'react';
import { Button } from './button';
import { track } from './analytics';
export function Panel({ label, size = 1 }: { label: string, size?: number }) {
  return <Button size={size}>{label}</Button>;
}
export class Store extends React.Component<Object> {
  count: number = 0;
  bump(by: number): void {
    track(this.count + by);
  }
  render(): React$Node {
    return <Panel label="x" />;
  }
}
"#,
        r#"import React from 'react';
import { Button } from './button';
import { track } from './analytics';
export function Panel({ label, size = 1 }) {
  return <Button size={size}>{label}</Button>;
}
export class Store extends React.Component {
  count = 0;
  bump(by) {
    track(this.count + by);
  }
  render() {
    return <Panel label="x" />;
  }
}
"#,
    ),
    (
        "typed catch, rest and default parameters, typed variables",
        r#"const { query } = require('./db');
async function run(sql: string = '', ...args: Array<mixed>): Promise<void> {
  const limit: number = 10;
  try {
    await query(sql, limit, ...args);
  } catch (e: mixed) {
    console.error(e);
  }
}
module.exports = { run };
"#,
        r#"const { query } = require('./db');
async function run(sql = '', ...args) {
  const limit = 10;
  try {
    await query(sql, limit, ...args);
  } catch (e) {
    console.error(e);
  }
}
module.exports = { run };
"#,
    ),
];

#[test]
fn typed_files_have_the_facts_of_their_hand_stripped_copy() {
    for (what, typed, stripped) in SAME_AS_HAND_STRIPPED {
        let plain = lower("src/probe.js", stripped);
        assert!(
            plain.parse_ok && plain.skip.is_none(),
            "{what}: hand copy parses"
        );
        assert!(!plain.symbols.is_empty(), "{what}: hand copy has symbols");
        assert_eq!(lower("src/probe.js", typed), plain, "{what}");
        // `.jsx`, `.mjs` and `.cjs` files go the same way.
        for path in ["src/probe.jsx", "src/probe.mjs"] {
            assert_eq!(
                lower(path, typed),
                lower(path, stripped),
                "{what} as {path}"
            );
        }
    }
}

/// Each probe holds an annotation both readers share, then one construct whose
/// stripped meaning is not certain.
const SKIPPED: &[(&str, &str)] = &[
    (
        "exact object type",
        "export const f = (x: A) => g(x);\ntype A = {| a: number |};\n",
    ),
    (
        "opaque type",
        "export const f = (x: T) => g(x);\nopaque type T = string;\n",
    ),
    (
        "predicate function",
        "export function isStr(x: mixed): boolean %checks { return typeof x === 'string'; }\n",
    ),
    (
        "variance (+)",
        "export const f = (p: P) => g(p);\ntype P = { +a: number };\n",
    ),
    (
        "variance (-)",
        "export const f = (p: P) => g(p);\ntype P = { -a: number };\n",
    ),
    (
        "type cast",
        "export const f = (z: number) => g(z);\nconst y = (f: any);\n",
    ),
    (
        "typeof import",
        "export const f = (z: T) => g(z);\nimport typeof T from './t';\n",
    ),
    (
        "existential type",
        "export function f(p: Promise<*>) { return g(p); }\n",
    ),
    (
        "bounded generic",
        "export function f<T: Object>(x: T): T { return g(x); }\n",
    ),
    (
        "object type spread",
        "export const f = (p: P) => g(p);\ntype P = { ...Q, a: number };\n",
    ),
    (
        "declare statement",
        "export const f = (z: number) => g(z);\ndeclare var DEBUG: boolean;\n",
    ),
    (
        "declare export",
        "export const f = (z: number) => g(z);\ndeclare export function h(): void;\n",
    ),
    (
        "inline type specifier",
        "import { type T, g } from './t';\nexport const f = (x: T) => g(x);\n",
    ),
    (
        "type-only class field",
        "export class A { x: number; m(y: number) { return g(y); } }\n",
    ),
    (
        "declared class field",
        "export class A { declare x: number; m(y: number) { return g(y); } }\n",
    ),
    (
        "TypeScript modifier",
        "export class A { public x = 1; m(y: number) { return g(y); } }\n",
    ),
    ("as cast", "export const f = (x: number) => g(x as any);\n"),
    (
        "enum",
        "export const f = (x: number) => g(x);\nenum E { A, B }\n",
    ),
    (
        "implements",
        "export class A implements B { m(x: number) { return g(x); } }\n",
    ),
    (
        "this parameter",
        "export function f(this: Window, x: number) { return g(x); }\n",
    ),
    (
        "optional parameter",
        "export function f(x?: number) { return g(x); }\n",
    ),
    (
        "a strip that joins statements",
        "let a = 1\ntype T = number\n[0].forEach((x: T) => g(x))\n",
    ),
    (
        "Flow-only syntax first, with a pragma",
        "/* @flow */\nopaque type T = string;\nexport const f = (x: T) => g(x);\n",
    ),
];

#[test]
fn flow_syntax_that_cannot_be_removed_with_certainty_is_skipped() {
    for (what, src) in SKIPPED {
        let raw = lower("src/probe.js", src);
        assert_eq!(raw.skip, Some(SkipReason::FlowSyntax), "{what}");
        assert!(raw.symbols.is_empty() && raw.imports.is_empty(), "{what}");
    }
}

#[test]
fn other_files_are_read_as_before() {
    // Plain JavaScript: one parse, as before.
    let plain = lower("src/a.js", "export function f(x) { return g(x); }\n");
    assert!(plain.parse_ok && plain.skip.is_none() && plain.symbols.len() == 1);
    // A JavaScript syntax error with no type syntax: a parse error, not a skip.
    for src in [
        "export function f(x) { return g(x; }\n",
        "{% comment %}\napp.constant('S', {{ s | safe }});\n",
    ] {
        let raw = lower("src/a.js", src);
        assert!(!raw.parse_ok && raw.skip.is_none(), "{src}");
    }
    // TypeScript files are never read as Flow.
    let ts = lower(
        "src/a.ts",
        "export const f = (x: number) => g(x as any);\nopaque type T = string;\n",
    );
    assert!(!ts.parse_ok && ts.skip.is_none());
}
