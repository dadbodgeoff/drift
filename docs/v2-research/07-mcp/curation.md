# MCP Curation System

## Location
`packages/mcp/src/tools/curation/`

## Purpose
Pattern approval workflow with anti-hallucination verification. When an AI agent wants to approve a pattern, it must provide evidence (files, snippets, reasoning) that the curation system verifies against actual code before allowing approval. This prevents AI from approving patterns based on hallucinated evidence.

## Files
- `handler.ts` — `handleCurate()`: main handler with 6 actions (review, verify, approve, ignore, bulk_approve, audit)
- `verifier.ts` — `verifyPattern()`: reads actual files and checks evidence claims
- `types.ts` — `CurationEvidence`, `VerificationResult`, `EvidenceCheck`, constants
- `audit-store.ts` — Audit persistence for curation decisions
- `index.ts` — Tool definition and barrel exports

## The Curation Flow

```
1. AI calls drift_curate action="review" patternId="..."
   → Returns pattern details + evidence requirements for its confidence level

2. AI gathers evidence (reads files, finds snippets)

3. AI calls drift_curate action="verify" patternId="..." evidence={files, snippets, reasoning}
   → Verifier reads actual files, checks claims
   → Returns VerificationResult with score and canApprove flag

4. If canApprove=true:
   AI calls drift_curate action="approve" patternId="..." evidence={...}
   → Pattern status changes to "approved"
   → Audit record created

5. If canApprove=false:
   Response includes approvalRequirements explaining what's missing
```

## Evidence Requirements

Scale with pattern confidence level:

| Confidence | Min Verified Files | Require Snippets | Reasoning |
|-----------|-------------------|-------------------|-----------|
| High (≥0.85) | 1 | No | Optional |
| Medium (≥0.70) | 2 | Yes | Required |
| Low (≥0.50) | 3 | Yes | Required (detailed) |
| Uncertain (<0.50) | 3 | Yes | Required (comprehensive) |

## Verification Algorithm (`verifyPattern`)

For each claimed file:
1. Read the actual file from disk
2. Check if pattern locations reference this file
3. If locations found, verify line numbers are within file bounds
4. If snippets provided, check if any snippet appears in file content
5. Mark as verified if locations match OR snippets found

Additionally checks pattern's own locations (not claimed by AI) for cross-validation.

### Verification Score
```
verificationScore = verifiedChecks / totalChecks
```

| Score | Status |
|-------|--------|
| ≥ 0.80 | `verified` |
| ≥ 0.50 | `partial` |
| < 0.50 | `failed` |

### Approval Requirements
Approval blocked if any of:
- Verified file count < minimum for confidence level
- Snippets required but not provided
- Verification score below minimum (configurable)
- Reasoning missing or too short (< 20 chars)

## Key Types

```typescript
interface CurationEvidence {
  files: string[];           // Files where pattern appears
  snippets?: string[];       // Code snippets as evidence
  reasoning: string;         // Why this pattern should be approved
}

interface VerificationResult {
  verified: boolean;
  patternId: string;
  patternName: string;
  confidence: number;
  evidenceChecks: EvidenceCheck[];
  verificationScore: number;
  verificationStatus: 'verified' | 'partial' | 'failed';
  canApprove: boolean;
  approvalRequirements?: string[];
}

interface EvidenceCheck {
  file: string;
  claimed: boolean;          // Was this file claimed by AI?
  verified: boolean;         // Does evidence check out?
  matchedLines?: number[];
  snippet?: string;          // Actual code from file
  error?: string;
}
```

## Rust Rebuild Considerations
- Curation stays in TypeScript — it's an AI interaction workflow
- The verifier's file reading could be faster via Rust NAPI for large codebases
- Pattern location verification is pure data comparison — trivial either way
- The anti-hallucination concept is valuable and should be preserved in v2
