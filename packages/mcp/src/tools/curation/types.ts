/**
 * Curation Types - Type definitions for pattern curation
 * 
 * @module tools/curation/types
 */

import type { PatternCategory } from 'driftdetect-core';

// ============================================================================
// Input Types
// ============================================================================

export type CurationAction = 
  | 'review'       // Get patterns needing review
  | 'verify'       // Verify pattern exists in code
  | 'approve'      // Approve a verified pattern
  | 'ignore'       // Ignore a pattern
  | 'bulk_approve' // Auto-approve high-confidence patterns
  | 'audit';       // View curation history

export interface CurationEvidence {
  /** Files where pattern exists */
  files: string[];
  /** Line numbers where pattern is found */
  lines?: number[];
  /** Code snippets as evidence */
  snippets?: string[];
  /** Reasoning for why this is a valid pattern */
  reasoning: string;
}

export interface CurationInput {
  action: CurationAction;
  category?: PatternCategory;
  minConfidence?: number;
  maxConfidence?: number;
  limit?: number;
  patternId?: string;
  evidence?: CurationEvidence;
  approvedBy?: string;
  ignoreReason?: string;
  confidenceThreshold?: number;
  dryRun?: boolean;
}

// ============================================================================
// Result Types
// ============================================================================

export interface EvidenceCheck {
  file: string;
  claimed: boolean;
  verified: boolean;
  matchedLines?: number[];
  snippet?: string;
  error?: string;
}

export interface VerificationResult {
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


export interface CurationAuditEntry {
  id: string;
  timestamp: string;
  action: 'approve' | 'ignore' | 'bulk_approve';
  patternId: string;
  patternName: string;
  category: PatternCategory;
  previousStatus: string;
  newStatus: string;
  confidence: number;
  verificationScore?: number;
  evidence?: { files: string[]; reasoning: string };
  approvedBy?: string;
  ignoreReason?: string;
}

export interface PatternReviewItem {
  id: string;
  name: string;
  description: string;
  category: PatternCategory;
  confidence: number;
  confidenceLevel: string;
  locationCount: number;
  outlierCount: number;
  firstSeen: string;
  evidenceRequirements: {
    minFiles: number;
    requireSnippet: boolean;
    reason: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

export const CURATION_CONSTANTS = {
  /** Minimum confidence for bulk approval */
  DEFAULT_BULK_THRESHOLD: 0.95,
  /** Maximum patterns per bulk operation */
  MAX_BULK_PATTERNS: 50,
  /** Minimum verification score to allow approval */
  MIN_VERIFICATION_SCORE: 0.7,
  /** Audit file name */
  AUDIT_FILE: 'curation-audit.json',
} as const;

export const EVIDENCE_REQUIREMENTS = {
  high: { minFiles: 1, requireSnippet: false },
  medium: { minFiles: 2, requireSnippet: true },
  low: { minFiles: 3, requireSnippet: true },
  uncertain: { minFiles: 5, requireSnippet: true },
} as const;
