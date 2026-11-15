// Slim facts: `drift scan` output with the fields the Studio never shows
// removed, so a 36k-file repository stays small in memory and over IPC.
// Used by the Electron main process (after `drift scan --out`) and by the
// fixture builder, so both hand the renderer exactly the same shape.

import type { FactSymbol, FileFacts, RepoFacts } from "./drift";

/** Control facts about request input (crates/drift-core/src/facts.rs `controls`, facts schema 5). */
export const INPUT_CONTROLS = ["reads_input", "no_input"];

/**
 * The controls the Studio shows (crates/drift-core/src/facts.rs `pub mod controls`): request input,
 * and `rejects_caller` (#60), a body that turns a caller away before it hands control on, which is
 * what makes a wrapper a guard. Every other control is mining input only.
 */
export const SHOWN_CONTROLS = [...INPUT_CONTROLS, "rejects_caller"];

function slimSymbol(s: FactSymbol): FactSymbol {
  const out: FactSymbol = {
    name: s.name,
    kind: s.kind,
    exported_as: s.exported_as,
    line: s.line,
    wraps: s.wraps,
  };
  if (s.suppressions?.length) out.suppressions = s.suppressions;
  if (s.sinks?.length) out.sinks = s.sinks;
  const shown = s.controls?.filter((c) => SHOWN_CONTROLS.includes(c));
  if (shown?.length) out.controls = shown;
  // Callees acted on only after the continuation (#60): why a wrapper that calls them is no guard.
  if (s.after_continuation?.length) out.after_continuation = s.after_continuation;
  // Errors raised only there (Python lists them, #79; a TypeScript `throw f(err)` after next() too) are among
  // `throws`: those are kept, so the drawer says "raises X after handing on" rather than calling X. Other
  // thrown classes are mining input.
  const raisedAfter = s.throws?.filter((t) => s.after_continuation?.includes(t));
  if (raisedAfter?.length) out.throws = raisedAfter;
  if (s.field_decorators?.length) out.field_decorators = s.field_decorators;
  // Kinds of class and purpose facts (`abstract`, `subclassed`, `test_helper`, ...): a few short strings, shown in the code drawer and on the map.
  if (s.traits?.length) out.traits = s.traits;
  if (s.derives_from) out.derives_from = s.derives_from;
  // A value made by a factory proven to return a function (#91): shown in the code drawer as "made by f()".
  if (s.made_by) out.made_by = s.made_by;
  return out;
}

function slimFile(f: FileFacts): FileFacts {
  const out: FileFacts = {
    path: f.path,
    lang: f.lang,
    package: f.package,
    parse_ok: f.parse_ok,
    directives: f.directives,
    // Names are not shown; the module, whether it is type-only and when it loads are.
    imports: f.imports.map((i) => (i.load && i.load !== "static" ? { module: i.module, names: [], type_only: i.type_only, load: i.load } : { module: i.module, names: [], type_only: i.type_only })),
    symbols: f.symbols.map(slimSymbol),
    entry_points: f.entry_points,
  };
  if (f.has_test) out.has_test = true;
  if (f.client_leaks?.length) out.client_leaks = f.client_leaks;
  return out;
}

export function slimFacts(r: RepoFacts): RepoFacts {
  return {
    schema_version: r.schema_version,
    files: r.files.map(slimFile),
    skipped: r.skipped,
    models: r.models ?? [],
    packages: (r.packages ?? []).map(({ peer_dependencies: _peer, optional_dependencies: _optional, dev_only: _dev, ...p }) => ({ ...p, dependencies: [] })),
  };
}
