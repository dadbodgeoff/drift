/**
 * Pattern Verifier - Verifies patterns exist in actual code
 * 
 * Anti-hallucination: Greps actual files to verify AI claims.
 * 
 * @module tools/curation/verifier
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Pattern } from 'driftdetect-core';
import type { 
  CurationEvidence, 
  EvidenceCheck, 
  VerificationResult 
} from './types.js';
import { EVIDENCE_REQUIREMENTS, CURATION_CONSTANTS } from './types.js';

/**
 * Get evidence requirements based on confidence level
 */
export function getEvidenceRequirements(confidenceLevel: string): {
  minFiles: number;
  requireSnippet: boolean;
  reason: string;
} {
  const level = confidenceLevel as keyof typeof EVIDENCE_REQUIREMENTS;
  const req = EVIDENCE_REQUIREMENTS[level] ?? EVIDENCE_REQUIREMENTS['uncertain'];
  
  const reasons: Record<string, string> = {
    high: 'High confidence - minimal verification needed',
    medium: 'Medium confidence - provide code snippets',
    low: 'Low confidence - extensive verification required',
    uncertain: 'Uncertain - comprehensive evidence required',
  };
  
  const reason = reasons[level] || 'Uncertain - comprehensive evidence required';
  return { ...req, reason };
}

/**
 * Verify a single file contains expected pattern
 */
async function verifyFile(
  projectRoot: string,
  file: string,
  pattern: Pattern,
  snippets?: string[]
): Promise<EvidenceCheck> {
  const fullPath = path.join(projectRoot, file);
  
  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    // Check if pattern locations include this file
    const patternLocations = pattern.locations.filter(l => l.file === file);
    const matchedLines: number[] = [];

    // Verify pattern locations exist
    for (const loc of patternLocations) {
      if (loc.line > 0 && loc.line <= lines.length) {
        matchedLines.push(loc.line);
      }
    }
    
    // Verify snippets if provided
    let snippetVerified = true;
    if (snippets && snippets.length > 0) {
      snippetVerified = snippets.some(snippet => 
        content.includes(snippet.trim())
      );
    }
    
    const verified = matchedLines.length > 0 || snippetVerified;
    
    const result: EvidenceCheck = {
      file,
      claimed: true,
      verified,
    };
    
    if (matchedLines.length > 0) {
      result.matchedLines = matchedLines;
    }
    
    if (verified) {
      result.snippet = lines.slice(
        Math.max(0, (matchedLines[0] ?? 1) - 2),
        (matchedLines[0] ?? 1) + 2
      ).join('\n');
    }
    
    return result;
  } catch (error) {
    return {
      file,
      claimed: true,
      verified: false,
      error: `File not found or unreadable: ${(error as Error).message}`,
    };
  }
}

/**
 * Verify pattern evidence against actual codebase
 */
export async function verifyPattern(
  projectRoot: string,
  pattern: Pattern,
  evidence: CurationEvidence
): Promise<VerificationResult> {
  const requirements = getEvidenceRequirements(pattern.confidence.level);
  const evidenceChecks: EvidenceCheck[] = [];
  
  // Verify each claimed file
  for (const file of evidence.files) {
    const check = await verifyFile(
      projectRoot, 
      file, 
      pattern, 
      evidence.snippets
    );
    evidenceChecks.push(check);
  }
  
  // Also verify pattern's own locations
  const patternFiles = [...new Set(pattern.locations.map(l => l.file))];
  for (const file of patternFiles.slice(0, 3)) {
    if (!evidence.files.includes(file)) {
      const check = await verifyFile(projectRoot, file, pattern);
      check.claimed = false; // Not claimed by AI, verified from pattern
      evidenceChecks.push(check);
    }
  }
  
  // Calculate verification score
  const verifiedCount = evidenceChecks.filter(c => c.verified).length;
  const totalChecks = evidenceChecks.length || 1;
  const verificationScore = verifiedCount / totalChecks;

  // Determine verification status
  let verificationStatus: 'verified' | 'partial' | 'failed';
  if (verificationScore >= 0.8) {
    verificationStatus = 'verified';
  } else if (verificationScore >= 0.5) {
    verificationStatus = 'partial';
  } else {
    verificationStatus = 'failed';
  }
  
  // Check approval requirements
  const approvalRequirements: string[] = [];
  const claimedVerified = evidenceChecks.filter(c => c.claimed && c.verified).length;
  
  if (claimedVerified < requirements.minFiles) {
    approvalRequirements.push(
      `Need ${requirements.minFiles} verified files, got ${claimedVerified}`
    );
  }
  
  if (requirements.requireSnippet && !evidence.snippets?.length) {
    approvalRequirements.push('Code snippets required for this confidence level');
  }
  
  if (verificationScore < CURATION_CONSTANTS.MIN_VERIFICATION_SCORE) {
    approvalRequirements.push(
      `Verification score ${(verificationScore * 100).toFixed(0)}% below minimum ${CURATION_CONSTANTS.MIN_VERIFICATION_SCORE * 100}%`
    );
  }
  
  if (!evidence.reasoning || evidence.reasoning.length < 20) {
    approvalRequirements.push('Provide detailed reasoning (min 20 chars)');
  }
  
  const canApprove = approvalRequirements.length === 0;
  
  const result: VerificationResult = {
    verified: verificationStatus === 'verified',
    patternId: pattern.id,
    patternName: pattern.name,
    confidence: pattern.confidence.score,
    evidenceChecks,
    verificationScore,
    verificationStatus,
    canApprove,
  };
  
  if (!canApprove) {
    result.approvalRequirements = approvalRequirements;
  }
  
  return result;
}
