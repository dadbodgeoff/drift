// What an answer of absence rests on, worded one way for every view (crates/drift-mine/src/practices/basis.rs).
// `none` and `internal` are what Drift found in what it read, never statements about the code.
import type { AnswerBasis, AnswerNotRead } from "@/shared/contract/drift";

/** What every answer of absence says it rests on (basis.rs `IN_WHAT_DRIFT_READ`). */
export const IN_WHAT_DRIFT_READ = "in what Drift read";

/** Where no guard was found (basis.rs `AUTHN_NONE`). */
export const NO_GUARD_FOUND = "no guard found in what Drift read";

/** Unread items named in a short line before "and N more" (basis.rs `NAMED`). */
const NAMED = 2;

const shortName = (r: string): string => {
  const at = r.lastIndexOf("#");
  return at < 0 ? r : r.slice(at + 1);
};

/** One unread item, short (basis.rs `short`): `require_scope from company_auth`, `api/big.py (too large)`. */
export function notReadShort(n: AnswerNotRead): string {
  if (n.kind === "package_function") {
    const m = /^pkg:([^#]+)#(.+)$/.exec(n.what);
    if (!m) return n.what;
    const name = m[2].split(".").pop() ?? m[2];
    return `${name} from ${m[1]}`;
  }
  if (n.kind === "depth_limit") return `${shortName(n.what)} (not followed)`;
  if (!n.why) return n.what;
  if (n.kind === "file" || n.kind === "description") return `${n.what} (${n.why.split(/[:,]/)[0].trim()})`;
  return n.what;
}

/** `2 not read: a, b`, `5 not read: a, b and 3 more`; "" when nothing is listed (basis.rs `not_read_list`). */
export function notReadList(notRead: AnswerNotRead[] | undefined): string {
  const xs = notRead ?? [];
  if (!xs.length) return "";
  const more = xs.length > NAMED ? ` and ${xs.length - NAMED} more` : "";
  return `${xs.length} not read: ${xs.slice(0, NAMED).map(notReadShort).join(", ")}${more}`;
}

/** ` (2 not read)`; "" when nothing is listed (basis.rs `not_read_count`). */
export const notReadCount = (notRead: AnswerNotRead[] | undefined): string => (notRead?.length ? ` (${notRead.length} not read)` : "");

/** A practice map `none`: `none: no guard found in what Drift read (2 not read: …)` (basis.rs `none`). */
export function noneText(label: string, notRead: AnswerNotRead[] | undefined): string {
  const l = label.includes(IN_WHAT_DRIFT_READ) ? label : `${label} ${IN_WHAT_DRIFT_READ}`;
  const list = notReadList(notRead);
  return list ? `none: ${l} (${list})` : `none: ${l}`;
}

/** Where an entry point's guards would be named and none was found (basis.rs `no_guard`). */
export const noGuardText = (basis: AnswerBasis | undefined): string => `${NO_GUARD_FOUND}${notReadCount(basis?.not_read)}`;

/** An `internal` exposure (basis.rs `internal`): `internal in what Drift read (<boundary>; 1 not read: …)`. */
export function internalText(boundary: string | undefined, basis: AnswerBasis | undefined): string {
  const parts = [boundary, notReadList(basis?.not_read)].filter((p): p is string => !!p);
  return parts.length ? `internal ${IN_WHAT_DRIFT_READ} (${parts.join("; ")})` : `internal ${IN_WHAT_DRIFT_READ}`;
}

/** Authentication that identifies the caller and turns no one away (basis.rs `identified`). */
export function identifiedText(by: string[] | undefined): string {
  const names = (by ?? []).map((i) => shortName(i).split(".").pop() ?? i);
  return names.length ? `identified by ${names.join(", ")}, turns no one away` : "identified, turns no one away";
}
