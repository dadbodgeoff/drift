# Compiler oracle

Differential test of Drift's parser against the TypeScript compiler. Results
from the first audit are in `docs/v2/PARSER-AUDIT-2026-11-05.md`.

```sh
npm install --prefix /tmp/oracle typescript@5
export TS_PATH=/tmp/oracle/node_modules/typescript
drift --root REPO debug imports > imports.jsonl
drift --root REPO scan --no-cache --out facts.json
node eval/oracle/oracle.mjs REPO imports.jsonl facts.json --samples 400 --json report.json
```

Categories: `agree` (same file), `agree_source_vs_dts`, `DISAGREE` (different
files: always a bug), `GAP_*` (TypeScript resolves in-repo, Drift does not),
`drift_only_resolves` (usually workspace packages without `node_modules`).

## Parameter types

`types.mjs` checks the parameter-type facts (`Symbol.arg_types`: whether the
callee's declared parameter type requires each object key a call passes)
against the type checker. Each call in the files that have such facts is
resolved again (`getResolvedSignature`), and each key is looked up on the
declared type of the callee's parameter, with Drift's definition of optional
(declared `?`, an `undefined` member, or a destructuring default).

```sh
drift --root REPO --no-cache scan --out facts.json
node eval/oracle/types.mjs REPO facts.json [--files 300] [--json report.json] [--verbose]
```

Categories: `agree`, `DISAGREE` (both known, different: always a bug),
`drift_only` (the compiler cannot answer, usually a type from an uninstalled
package) and `tsc_only` (Drift answers unknown: a coverage gap, never wrong).
Callees declared in `node_modules` are checked too, as `pkg:<package>#name`.

The oracle uses Drift's definition of optional, so 0 disagreements says Drift
reads the declarations as the compiler does; it does not validate the
definition itself (that `| undefined` and a destructuring default make a key
optional, although the compiler still requires the key in the first case, and
in the second when the annotation requires it).

`fixtures.mjs` runs it with `--strict` (a `drift_only` key is a disagreement)
on the synthetic fixtures `crates/drift-ts/tests/fixtures/param-types` and
`param-types-tricky`, whose `_node_modules` becomes `node_modules` in a
temporary copy. CI requires 0 disagreements:

```sh
cargo build -p drift-cli
node eval/oracle/fixtures.mjs --drift target/debug/drift
```
