import { useMemo } from "react";
import type { RepoRef } from "@/shared/api";
import { useCensus, useCheck, usePolicyFiles } from "@/entities/drift";
import { type ConventionRow, type PythonProposalsState, conventionLanguage, conventionRows, pythonProposals, suggestionRecord } from "./conventions";

export { conventionLanguage };
import { type LockEntry, PolicyError, parseConventions, parseLock } from "./policy";
import type { CensusParams, CensusWiring, ConventionsFile } from "@/shared/contract/drift";
import { wiringState } from "./wiring";
import precision from "./family-precision.json";

export interface Conventions {
  rows: ConventionRow[];
  policy: ConventionsFile | null;
  lock: LockEntry[];
  policyError: string | null;
  censusAvailable: boolean;
  /** Mining thresholds from census (`min_lower_bound`, `min_lift`, ...), when census ran. */
  params: CensusParams | null;
  /** Roles and units Drift considered at the last census. */
  census: {
    roles: number;
    units: number;
    conventions: number;
    largestRole: { summary: string; members: number } | null;
    /** Files census could not parse for lack of stack, left out of every count (#32); empty when none. */
    unchecked: string[];
  } | null;
  /** Experimental wiring (#38): census's `wiring` (registries, co-change history), and whether the flag was on. */
  wiring: CensusWiring | null;
  wiringState: "on" | "off" | "unknown";
  /** Decision D13-py: whether census made Python proposals (`off` with how many it withheld); null without a census. */
  pythonProposals: PythonProposalsState | null;
  /** Suggestions the review list shows before "Show all" (census `suggestion_cap.cap`): null for all, undefined from a census before the cap. */
  suggestionCap: number | null | undefined;
  loading: boolean;
  error: unknown;
}

export function useConventions(repo: RepoRef | null): Conventions {
  const files = usePolicyFiles(repo);
  const census = useCensus(repo);
  // Tier and effective mode of conventions census no longer reports come from check; it never holds up the rows.
  const check = useCheck(repo);
  const report = check.data?.data ?? null;
  return useMemo(() => {
    let policy: ConventionsFile | null = null;
    let policyError: string | null = null;
    if (files.data?.conventions) {
      try {
        policy = parseConventions(files.data.conventions);
      } catch (e) {
        policyError = e instanceof PolicyError ? e.message : String(e);
      }
    }
    const c = census.data?.data ?? null;
    return {
      rows: conventionRows(policy, c, report),
      policy,
      lock: files.data?.lock ? parseLock(files.data.lock) : [],
      policyError,
      censusAvailable: census.data !== null && !census.isError,
      params: c?.params ?? null,
      census: c
        ? {
            roles: c.roles,
            units: c.units,
            conventions: c.conventions,
            largestRole: c.largest_role ? { summary: c.largest_role.summary, members: c.largest_role.members } : null,
            unchecked: c.unchecked ?? [],
          }
        : null,
      wiring: c?.wiring ?? null,
      wiringState: wiringState(c),
      pythonProposals: pythonProposals(c),
      suggestionCap: c?.suggestion_cap ? c.suggestion_cap.cap : undefined,
      loading: files.isLoading || census.isLoading,
      error: files.error ?? census.error,
    };
  }, [files.data, files.isLoading, files.error, census.data, census.isLoading, census.isError, census.error, report]);
}

export interface FamilyHint {
  family: string;
  rate: number;
  notWrong: number | null;
  n: number;
  source: string;
}

type FamilyTable = Record<string, { n: number; rate: number; notWrong?: number }>;
const FAMILIES = precision.families as FamilyTable;
const LATEST = ((precision as { latest?: Record<string, { study: string; overall: { n: number; rate: number; notWrong: number }; families: FamilyTable }> }).latest ?? {});


/**
 * The study's accept rate for a rule family (null when the study had fewer than 5): the newest
 * dev run of the language (eval/study/runs, adjudicated labels), else the first round (PR #4).
 */
export function familyHint(family: string, language: "python" | "typescript" = "typescript"): FamilyHint | null {
  const l = LATEST[language];
  const f = l ? l.families[family] : language === "typescript" ? FAMILIES[family] : undefined;
  if (!f || f.n < 5) return null;
  return { family, rate: f.rate, notWrong: f.notWrong ?? null, n: f.n, source: l?.study ?? precision.study };
}

/**
 * The track record a card shows, one per card so every place on it says the same number. A suggestion with a record in
 * W0's family table (check or census `agents`: suggestion-tier labels only, the record agents' admission and the
 * "Block anyway" styling read) shows that record; otherwise (the default tier, or no record) the study's family hint,
 * which pools tiers. Null when the record has fewer than 5 labelled cards.
 */
export interface TrackRecord {
  family: string;
  rate: number;
  n: number;
  notWrong: number | null;
  /** `suggestion`: suggestion-tier labels only (family-admission.json); `pooled`: every tier (family-precision.json). */
  scope: "suggestion" | "pooled";
  source: string;
}

export function trackRecord(row: Pick<ConventionRow, "family" | "tier" | "agents" | "example">): TrackRecord | null {
  const rec = suggestionRecord(row);
  if (rec) return rec.n < 5 ? null : { family: row.family, rate: rec.rate, n: rec.n, notWrong: null, scope: "suggestion", source: row.agents?.source ?? "crates/drift-mine/data/family-admission.json" };
  const h = familyHint(row.family, conventionLanguage(row.example.path));
  return h ? { family: h.family, rate: h.rate, n: h.n, notWrong: h.notWrong, scope: "pooled", source: h.source } : null;
}

/** The final precision study, family by family, with its provenance. */
export function studyFinal(): { overall: { rate: number; notWrong: number; n: number }; families: Record<string, { n: number; rate: number; notWrong?: number }>; study: string; provenance: string } {
  const p = precision as unknown as { overall: { rate: number; notWrong: number; n: number }; families: Record<string, { n: number; rate: number; notWrong?: number }>; study: string; provenance: string };
  return { overall: p.overall, families: p.families, study: p.study, provenance: p.provenance };
}
