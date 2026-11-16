// Version handshake with the CLI's JSON. The Studio renders only shapes it
// understands; anything else degrades to a clear message.
import { type Census, type CensusWhy, type PracticesReport, type RepoFacts, SUPPORTED_PRACTICES } from "@/shared/contract/drift";
import { t } from "@/shared/i18n";

/**
 * `FACTS_SCHEMA_VERSION` values this Studio reads (crates/drift-core/src/facts.rs).
 * 5 only adds facts (`field_decorators`, the `reads_input`/`no_input` controls) that
 * are omitted when empty, so 4 still reads. 6 adds `imports[].load` (omitted for static
 * imports) and the packages' `peer_dependencies`/`optional_dependencies` (omitted when
 * empty), so 4 and 5 still read. 7 only adds `derives_from` (a wrapper binding built on
 * another), omitted when empty. 8 adds Python class facts (`meta`, `decorator_args`,
 * `disclaims`), also omitted when empty. 9 adds the wiring facts (`registries`,
 * `discovers`), also omitted when empty. 10 adds class `members` (each method's own calls and
 * sinks, which `drift security` follows) and `server_reads` (env reads on the server side of
 * `typeof window`), both omitted when empty and dropped from slim facts. 11 adds the practice facts
 * (`body_checks`, `responses`, `log_calls`, `catches`, `headers`, `inputs`, `handles_errors`,
 * `test_requests`, `mocks`, `route_matchers`, packages' `dev_only`), all omitted when empty and dropped
 * from slim facts. A Rust test (`drift-core/tests/studio_contract.rs`) fails when the CLI's version is
 * missing here.
 */
export const SUPPORTED_FACTS = [4, 5, 6, 7, 8, 9, 10, 11];
/** `census --json` `schema` values this Studio reads. */
export const SUPPORTED_CENSUS = [1];

export class SchemaError extends Error {
  readonly kind = "schema";
}

export function checkFacts(f: RepoFacts, version: string | null): RepoFacts {
  if (!SUPPORTED_FACTS.includes(f.schema_version))
    throw new SchemaError(t("shell.schemaMismatch", { version: version ?? "unknown", what: "facts", want: SUPPORTED_FACTS.join("/") }) + ` (got ${f.schema_version})`);
  return f;
}

export function checkCensus(c: Census, version: string | null): Census {
  if (!SUPPORTED_CENSUS.includes(c.schema))
    throw new SchemaError(t("shell.schemaMismatch", { version: version ?? "unknown", what: "census", want: SUPPORTED_CENSUS.join("/") }) + ` (got ${c.schema})`);
  return c;
}

export function checkPractices(p: PracticesReport, version: string | null): PracticesReport {
  if (!SUPPORTED_PRACTICES.includes(p.version))
    throw new SchemaError(t("shell.schemaMismatch", { version: version ?? "unknown", what: "practices", want: SUPPORTED_PRACTICES.join("/") }) + ` (got ${p.version})`);
  return p;
}

/** `census --why --json` `schema` values this Studio reads (crates/drift-mine/src/funnel.rs `why_json`). */
export const SUPPORTED_FUNNEL = [1];

export function checkFunnel(f: CensusWhy, version: string | null): CensusWhy {
  if (!SUPPORTED_FUNNEL.includes(f.schema))
    throw new SchemaError(t("shell.schemaMismatch", { version: version ?? "unknown", what: "census --why", want: SUPPORTED_FUNNEL.join("/") }) + ` (got ${String(f.schema)})`);
  return f;
}

/** `drift 0.1.0-dev` -> `0.1.0-dev`. */
export function parseVersion(v: string | null): string | null {
  const m = v ? /(\d+\.\d+\.\d+[\w.-]*)/.exec(v) : null;
  return m ? m[1] : null;
}
