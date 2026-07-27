import type { SecurityBoundaryProof } from "@drift/core";

export interface SecurityCheckFindingInput {
  finding_id: string;
  title: string;
  file_path: string;
  enforcement_result: "pass" | "brief" | "warn" | "block";
}

export interface BuildSecurityCheckJsonInput {
  repo_id: string;
  scope: "changed-hunks" | "changed-files" | "full";
  changed_files: string[];
  proofs: SecurityBoundaryProof[];
  findings: SecurityCheckFindingInput[];
}

export interface SecurityCheckJson {
  repo_id: string;
  scope: "changed-hunks" | "changed-files" | "full";
  security_boundary_proofs: SecurityBoundaryProof[];
  security_findings: SecurityCheckFindingInput[];
  summary: {
    security_findings_count: number;
    security_blocking_count: number;
    middleware_coverage_proven_count: number;
    request_validation_failed_count: number;
    phase6_failed_count: number;
    phase6_parser_gap_count: number;
    session_trust_failed_count: number;
    authorization_failed_count: number;
    tenant_scope_failed_count: number;
  };
}

export function buildSecurityCheckJson(input: BuildSecurityCheckJsonInput): SecurityCheckJson {
  const changedFiles = new Set(input.changed_files);
  const scopedFindings = input.findings.filter((finding) =>
    input.scope === "full" || changedFiles.has(finding.file_path)
  );

  return {
    repo_id: input.repo_id,
    scope: input.scope,
    security_boundary_proofs: input.proofs,
    security_findings: scopedFindings,
    summary: {
      security_findings_count: scopedFindings.length,
      security_blocking_count: scopedFindings.filter((finding) =>
        finding.enforcement_result === "block"
      ).length,
      middleware_coverage_proven_count: input.proofs.filter((proof) => {
        const middleware = proof.middleware;
        return Boolean(middleware && middleware.required && middleware.proven);
      }).length,
      request_validation_failed_count: input.proofs.filter((proof) => {
        const requestValidation = proof.request_validation;
        return Boolean(requestValidation && requestValidation.required && !requestValidation.proven);
      }).length,
      phase6_failed_count: input.proofs.filter((proof) =>
        Boolean(
          (proof.ssrf?.required && !proof.ssrf.proven) ||
          (proof.raw_sql?.required && !proof.raw_sql.proven) ||
          (proof.cors?.required && !proof.cors.proven) ||
          (proof.csrf?.required && !proof.csrf.proven) ||
          (proof.rate_limit?.required && !proof.rate_limit.proven)
        )
      ).length,
      phase6_parser_gap_count: input.proofs.reduce((count, proof) =>
        count + proof.parser_gaps.filter((gap) =>
          gap.code === "unsupported_dynamic_outbound_url" ||
          gap.code === "unsupported_dynamic_cors_origin"
        ).length, 0),
      session_trust_failed_count: input.proofs.filter((proof) => {
        const sessionTrust = proof.session_trust;
        return Boolean(sessionTrust && sessionTrust.required && !sessionTrust.proven);
      }).length,
      authorization_failed_count: input.proofs.filter((proof) => {
        const authorization = proof.authorization;
        return Boolean(authorization && authorization.required && !authorization.proven);
      }).length,
      tenant_scope_failed_count: input.proofs.filter((proof) => {
        const tenant = proof.tenant;
        return Boolean(tenant && tenant.required && !tenant.proven);
      }).length
    }
  };
}
