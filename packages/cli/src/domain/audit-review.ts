import type { AuditChainVerification } from "@drift/core";

export function auditListSummary(input: {
  totalCount: number;
  filteredCount: number;
  listedCount: number;
  verification: AuditChainVerification;
}): {
  total_count: number;
  filtered_count: number;
  listed_count: number;
  audit_valid: boolean;
  verified_count: number;
  head_event_hash: string | null;
} {
  return {
    total_count: input.totalCount,
    filtered_count: input.filteredCount,
    listed_count: input.listedCount,
    audit_valid: input.verification.valid,
    verified_count: input.verification.verified_count,
    head_event_hash: input.verification.head_event_hash
  };
}

export function auditVerifySummary(verification: AuditChainVerification): {
  valid: boolean;
  event_count: number;
  verified_count: number;
  strict: boolean;
  head_sequence?: number | null;
  broken_at_event_id: string | null;
  reason_count: number;
  head_event_hash: string | null;
} {
  return {
    valid: verification.valid,
    event_count: verification.event_count,
    verified_count: verification.verified_count,
    strict: verification.strict === true,
    head_sequence: verification.head_sequence,
    broken_at_event_id: verification.broken_at_event_id,
    reason_count: verification.reasons.length,
    head_event_hash: verification.head_event_hash
  };
}

export function auditListNextCommands(repoId: string): string[] {
  return [
    `drift audit verify --repo ${repoId} --json`,
    `drift backup create --repo ${repoId} --confirm --json`
  ];
}

export function auditVerifyNextCommands(repoId: string, verification: AuditChainVerification): string[] {
  return verification.valid
    ? [
        `drift audit list --repo ${repoId} --json`,
        `drift backup create --repo ${repoId} --confirm --json`
      ]
    : [
        `drift audit list --repo ${repoId} --json`,
        `drift doctor --repo-root . --json`
      ];
}
