/**
 * drift_curate - Pattern Curation Handler
 * 
 * Enterprise pattern curation with mandatory verification.
 * Prevents AI hallucination through grep-based evidence checking.
 * 
 * @module tools/curation/handler
 */

import type { PatternStore } from 'driftdetect-core';
import { createPatternStore } from 'driftdetect-core/storage';

import { createResponseBuilder } from '../../infrastructure/response-builder.js';
import type { 
  CurationInput, 
  PatternReviewItem,
  VerificationResult,
} from './types.js';
import { CURATION_CONSTANTS } from './types.js';
import type { CurationAuditEntry } from './types.js';
import { verifyPattern, getEvidenceRequirements } from './verifier.js';
import { 
  loadAuditEntries, 
  saveAuditEntry, 
  getAuditSummary 
} from './audit-store.js';

interface CurationContext {
  projectRoot: string;
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleReview(
  store: PatternStore,
  input: CurationInput
): Promise<{ patterns: PatternReviewItem[]; total: number; message: string }> {
  const discovered = store.getDiscovered();
  
  // Filter by criteria
  let filtered = discovered;
  
  if (input.category) {
    filtered = filtered.filter(p => p.category === input.category);
  }
  if (input.minConfidence !== undefined) {
    filtered = filtered.filter(p => p.confidence.score >= input.minConfidence!);
  }
  if (input.maxConfidence !== undefined) {
    filtered = filtered.filter(p => p.confidence.score <= input.maxConfidence!);
  }
  
  // Sort by confidence (highest first for review)
  filtered.sort((a, b) => b.confidence.score - a.confidence.score);
  
  // Apply limit
  const limit = input.limit ?? 20;
  const patterns = filtered.slice(0, limit);

  // Map to review items with evidence requirements
  const reviewItems: PatternReviewItem[] = patterns.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    confidence: p.confidence.score,
    confidenceLevel: p.confidence.level,
    locationCount: p.locations.length,
    outlierCount: p.outliers.length,
    firstSeen: p.metadata.firstSeen,
    evidenceRequirements: getEvidenceRequirements(p.confidence.level),
  }));
  
  return {
    patterns: reviewItems,
    total: filtered.length,
    message: `Found ${filtered.length} patterns pending review`,
  };
}

async function handleVerify(
  store: PatternStore,
  input: CurationInput,
  projectRoot: string
): Promise<VerificationResult> {
  if (!input.patternId) {
    throw new Error('patternId required for verify action');
  }
  if (!input.evidence) {
    throw new Error('evidence required for verify action');
  }
  
  const pattern = store.get(input.patternId);
  if (!pattern) {
    throw new Error(`Pattern not found: ${input.patternId}`);
  }
  
  return verifyPattern(projectRoot, pattern, input.evidence);
}

async function handleApprove(
  store: PatternStore,
  input: CurationInput,
  projectRoot: string
): Promise<{ success: boolean; pattern: string; message: string }> {
  if (!input.patternId) {
    throw new Error('patternId required for approve action');
  }
  
  const pattern = store.get(input.patternId);
  if (!pattern) {
    throw new Error(`Pattern not found: ${input.patternId}`);
  }
  
  // Require evidence for non-high-confidence patterns
  if (pattern.confidence.level !== 'high' && !input.evidence) {
    throw new Error(
      'Evidence required for patterns below high confidence. ' +
      'Use action="verify" first to validate the pattern.'
    );
  }
  
  // Verify if evidence provided
  if (input.evidence) {
    const verification = await verifyPattern(projectRoot, pattern, input.evidence);
    if (!verification.canApprove) {
      throw new Error(
        `Cannot approve: ${verification.approvalRequirements?.join(', ')}`
      );
    }
  }

  // Approve the pattern
  store.approve(input.patternId, input.approvedBy ?? 'ai-agent');
  await store.saveAll();
  
  // Record audit entry
  const auditEntry: Omit<CurationAuditEntry, 'id' | 'timestamp'> = {
    action: 'approve',
    patternId: pattern.id,
    patternName: pattern.name,
    category: pattern.category,
    previousStatus: 'discovered',
    newStatus: 'approved',
    confidence: pattern.confidence.score,
    approvedBy: input.approvedBy ?? 'ai-agent',
  };
  
  if (input.evidence) {
    auditEntry.evidence = {
      files: input.evidence.files,
      reasoning: input.evidence.reasoning,
    };
  }
  
  await saveAuditEntry(projectRoot, auditEntry);
  
  return {
    success: true,
    pattern: pattern.name,
    message: `Approved pattern "${pattern.name}"`,
  };
}

async function handleIgnore(
  store: PatternStore,
  input: CurationInput,
  projectRoot: string
): Promise<{ success: boolean; pattern: string; message: string }> {
  if (!input.patternId) {
    throw new Error('patternId required for ignore action');
  }
  if (!input.ignoreReason) {
    throw new Error('ignoreReason required for ignore action');
  }
  
  const pattern = store.get(input.patternId);
  if (!pattern) {
    throw new Error(`Pattern not found: ${input.patternId}`);
  }
  
  // Ignore the pattern
  store.ignore(input.patternId);
  await store.saveAll();
  
  // Record audit entry
  await saveAuditEntry(projectRoot, {
    action: 'ignore',
    patternId: pattern.id,
    patternName: pattern.name,
    category: pattern.category,
    previousStatus: pattern.status,
    newStatus: 'ignored',
    confidence: pattern.confidence.score,
    ignoreReason: input.ignoreReason,
  });
  
  return {
    success: true,
    pattern: pattern.name,
    message: `Ignored pattern "${pattern.name}": ${input.ignoreReason}`,
  };
}


async function handleBulkApprove(
  store: PatternStore,
  input: CurationInput,
  projectRoot: string
): Promise<{ 
  approved: number; 
  skipped: number; 
  patterns: string[];
  message: string;
}> {
  const threshold = input.confidenceThreshold ?? CURATION_CONSTANTS.DEFAULT_BULK_THRESHOLD;
  const discovered = store.getDiscovered();
  
  // Filter to high-confidence patterns only
  const eligible = discovered.filter(p => 
    p.confidence.score >= threshold && 
    p.confidence.level === 'high'
  );
  
  // Limit batch size
  const toApprove = eligible.slice(0, CURATION_CONSTANTS.MAX_BULK_PATTERNS);
  
  if (input.dryRun) {
    return {
      approved: 0,
      skipped: eligible.length - toApprove.length,
      patterns: toApprove.map(p => p.name),
      message: `[DRY RUN] Would approve ${toApprove.length} patterns`,
    };
  }
  
  const approvedPatterns: string[] = [];
  
  for (const pattern of toApprove) {
    store.approve(pattern.id, 'bulk-auto-approve');
    approvedPatterns.push(pattern.name);
    
    await saveAuditEntry(projectRoot, {
      action: 'bulk_approve',
      patternId: pattern.id,
      patternName: pattern.name,
      category: pattern.category,
      previousStatus: 'discovered',
      newStatus: 'approved',
      confidence: pattern.confidence.score,
      approvedBy: 'bulk-auto-approve',
    });
  }
  
  await store.saveAll();
  
  return {
    approved: approvedPatterns.length,
    skipped: eligible.length - toApprove.length,
    patterns: approvedPatterns,
    message: `Bulk approved ${approvedPatterns.length} high-confidence patterns`,
  };
}

async function handleAudit(
  projectRoot: string
): Promise<ReturnType<typeof getAuditSummary>> {
  const entries = await loadAuditEntries(projectRoot);
  return getAuditSummary(entries);
}


// ============================================================================
// Main Handler
// ============================================================================

export async function handleCurate(
  input: CurationInput,
  context: CurationContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { projectRoot } = context;
  const builder = createResponseBuilder();
  
  try {
    // Initialize store
    const store = await createPatternStore({ rootDir: projectRoot });
    
    switch (input.action) {
      case 'review': {
        const result = await handleReview(store as PatternStore, input);
        return builder
          .withSummary(result.message)
          .withData(result)
          .withHints({
            nextActions: [
              'Use action="verify" with evidence to validate a pattern',
              'Use action="approve" after verification to approve',
              'Use action="bulk_approve" for high-confidence patterns',
            ],
          })
          .buildContent();
      }
      
      case 'verify': {
        const result = await handleVerify(store as PatternStore, input, projectRoot);
        const summary = result.canApprove
          ? `✅ Pattern verified - ready for approval`
          : `⚠️ Verification incomplete: ${result.approvalRequirements?.join(', ')}`;
        
        return builder
          .withSummary(summary)
          .withData(result)
          .withHints({
            nextActions: result.canApprove
              ? [`Use action="approve" patternId="${input.patternId}" to approve`]
              : ['Provide additional evidence and re-verify'],
          })
          .buildContent();
      }
      
      case 'approve': {
        const result = await handleApprove(store as PatternStore, input, projectRoot);
        return builder
          .withSummary(result.message)
          .withData(result)
          .buildContent();
      }
      
      case 'ignore': {
        const result = await handleIgnore(store as PatternStore, input, projectRoot);
        return builder
          .withSummary(result.message)
          .withData(result)
          .buildContent();
      }
      
      case 'bulk_approve': {
        const result = await handleBulkApprove(store as PatternStore, input, projectRoot);
        return builder
          .withSummary(result.message)
          .withData(result)
          .buildContent();
      }
      
      case 'audit': {
        const result = await handleAudit(projectRoot);
        return builder
          .withSummary(`${result.totalDecisions} curation decisions recorded`)
          .withData(result)
          .buildContent();
      }
      
      default:
        throw new Error(`Unknown action: ${input.action}`);
    }
  } catch (error) {
    return builder
      .withSummary(`Error: ${(error as Error).message}`)
      .withData({ success: false, error: (error as Error).message })
      .buildContent();
  }
}
