/**
 * drift_constraints - Architectural Constraint Management
 * 
 * MCP tool for managing learned architectural constraints.
 * Constraints are invariants that MUST be satisfied by code.
 * 
 * MIGRATION: Read operations (list, show) now use SQLite via UnifiedStore.
 * Write operations (extract, approve, ignore) still use JSON store for now.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createConstraintStore,
  createInvariantDetector,
  createConstraintSynthesizer,
  createConstraintVerifier,
  type Constraint,
  type ConstraintSummary,
  type ConstraintCategory,
  type ExtractionResult,
  type VerificationResult,
} from 'driftdetect-core';
import { UnifiedStore, type DbConstraint } from 'driftdetect-core/storage';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export type ConstraintsAction = 
  | 'list'
  | 'show'
  | 'extract'
  | 'approve'
  | 'ignore'
  | 'verify';

export interface ConstraintsArgs {
  action: ConstraintsAction;
  id?: string;
  file?: string;
  category?: string;
  status?: string;
  limit?: number;
  minConfidence?: number;
  reason?: string;
}

export interface ConstraintsListData {
  constraints: ConstraintSummary[];
  total: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface ConstraintsShowData {
  constraint: Constraint;
}

export interface ConstraintsExtractData {
  result: ExtractionResult;
}

export interface ConstraintsVerifyData {
  result: VerificationResult;
}


// ============================================================================
// Handler
// ============================================================================

/**
 * Handle constraints with UnifiedStore (SQLite - preferred for reads)
 */
export async function handleConstraintsWithSqlite(
  unifiedStore: UnifiedStore,
  projectRoot: string,
  args: ConstraintsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { action } = args;

  switch (action) {
    case 'list':
      return handleListWithSqlite(unifiedStore, args);
    case 'show':
      return handleShowWithSqlite(unifiedStore, args.id);
    // Write operations still use JSON store
    case 'extract':
      return handleExtract(projectRoot, args);
    case 'approve':
      return handleApprove(projectRoot, args.id);
    case 'ignore':
      return handleIgnore(projectRoot, args.id, args.reason);
    case 'verify':
      return handleVerify(projectRoot, args.file, args);
    default:
      throw Errors.invalidArgument('action', `Invalid action: ${action}. Valid: list, show, extract, approve, ignore, verify`);
  }
}

/**
 * Handle constraints with legacy JSON store (backward compatibility)
 * @deprecated Use handleConstraintsWithSqlite instead
 */
export async function handleConstraints(
  projectRoot: string,
  args: ConstraintsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { action } = args;

  switch (action) {
    case 'list':
      return handleList(projectRoot, args);
    case 'show':
      return handleShow(projectRoot, args.id);
    case 'extract':
      return handleExtract(projectRoot, args);
    case 'approve':
      return handleApprove(projectRoot, args.id);
    case 'ignore':
      return handleIgnore(projectRoot, args.id, args.reason);
    case 'verify':
      return handleVerify(projectRoot, args.file, args);
    default:
      throw Errors.invalidArgument('action', `Invalid action: ${action}. Valid: list, show, extract, approve, ignore, verify`);
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleList(
  projectRoot: string,
  args: ConstraintsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstraintsListData>();

  const store = createConstraintStore({ rootDir: projectRoot });
  await store.initialize();

  const queryOptions: Parameters<typeof store.query>[0] = {
    limit: args.limit ?? 20,
  };
  if (args.category) {
    queryOptions.category = args.category as ConstraintCategory;
  }
  if (args.status) {
    queryOptions.status = args.status as any;
  }
  if (args.minConfidence !== undefined) {
    queryOptions.minConfidence = args.minConfidence;
  }
  const result = store.query(queryOptions);

  const counts = store.getCounts();
  const summaries = result.constraints.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.category,
    language: c.language,
    status: c.status,
    confidence: c.confidence.score,
    enforcement: c.enforcement.level,
    evidence: c.confidence.evidence,
    violations: c.confidence.violations,
    type: c.invariant.type,
  }));

  let summaryText = `📋 ${result.total} constraints. `;
  summaryText += `${counts.byStatus.approved ?? 0} approved, `;
  summaryText += `${counts.byStatus.discovered ?? 0} discovered.`;

  const hints = {
    nextActions: counts.byStatus.discovered > 0
      ? ['Review discovered constraints with drift_constraints action="show"']
      : ['All constraints reviewed'],
    relatedTools: ['drift_constraints action="verify"', 'drift_context'],
  };

  return builder
    .withSummary(summaryText)
    .withData({
      constraints: summaries,
      total: result.total,
      byCategory: counts.byCategory,
      byStatus: counts.byStatus,
    })
    .withHints(hints)
    .buildContent();
}

async function handleShow(
  projectRoot: string,
  id?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstraintsShowData>();

  if (!id) {
    throw Errors.missingParameter('id');
  }

  const store = createConstraintStore({ rootDir: projectRoot });
  await store.initialize();

  const constraint = store.get(id);
  if (!constraint) {
    throw Errors.custom('CONSTRAINT_NOT_FOUND', `Constraint not found: ${id}`, []);
  }

  let summaryText = `🔍 ${constraint.name} (${constraint.status}). `;
  summaryText += `${constraint.invariant.type}: ${constraint.invariant.condition}. `;
  summaryText += `Confidence: ${Math.round(constraint.confidence.score * 100)}%.`;

  const hints = {
    nextActions: constraint.status === 'discovered'
      ? [`Approve: drift_constraints action="approve" id="${id}"`]
      : ['Constraint is active'],
    relatedTools: ['drift_constraints action="verify"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ constraint })
    .withHints(hints)
    .buildContent();
}

async function handleExtract(
  projectRoot: string,
  args: ConstraintsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstraintsExtractData>();

  const store = createConstraintStore({ rootDir: projectRoot });
  await store.initialize();

  const detector = createInvariantDetector({ rootDir: projectRoot });
  const synthesizer = createConstraintSynthesizer({ store, detector });

  const synthesisOptions: Parameters<typeof synthesizer.synthesize>[0] = {
    minConfidence: args.minConfidence ?? 0.85,
    includeViolationDetails: true,
  };
  if (args.category) {
    synthesisOptions.categories = [args.category as ConstraintCategory];
  }
  const result = await synthesizer.synthesize(synthesisOptions);

  let summaryText = `🔍 Extracted ${result.discovered.length} new constraints. `;
  summaryText += `Updated ${result.updated.length}, invalidated ${result.invalidated.length}. `;
  summaryText += `Time: ${result.stats.executionTimeMs}ms.`;

  const hints = {
    nextActions: result.discovered.length > 0
      ? ['Review new constraints with drift_constraints action="list" status="discovered"']
      : ['No new constraints found'],
    relatedTools: ['drift_constraints action="list"', 'drift_constraints action="approve"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ result })
    .withHints(hints)
    .buildContent();
}

async function handleApprove(
  projectRoot: string,
  id?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<{ constraint: Constraint }>();

  if (!id) {
    throw Errors.missingParameter('id');
  }

  const store = createConstraintStore({ rootDir: projectRoot });
  await store.initialize();

  const result = await store.approve(id);
  if (!result) {
    throw Errors.custom('CONSTRAINT_NOT_FOUND', `Constraint not found: ${id}`, []);
  }

  const summaryText = `✓ Approved: ${result.name}. Now actively enforced.`;

  const hints = {
    nextActions: ['Verify code with drift_constraints action="verify"'],
    relatedTools: ['drift_constraints action="verify"', 'drift_context'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ constraint: result })
    .withHints(hints)
    .buildContent();
}

async function handleIgnore(
  projectRoot: string,
  id?: string,
  reason?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<{ constraint: Constraint }>();

  if (!id) {
    throw Errors.missingParameter('id');
  }

  const store = createConstraintStore({ rootDir: projectRoot });
  await store.initialize();

  const result = await store.ignore(id, reason);
  if (!result) {
    throw Errors.custom('CONSTRAINT_NOT_FOUND', `Constraint not found: ${id}`, []);
  }

  let summaryText = `⊘ Ignored: ${result.name}.`;
  if (reason) {
    summaryText += ` Reason: ${reason}`;
  }

  const hints = {
    nextActions: ['Continue reviewing other constraints'],
    relatedTools: ['drift_constraints action="list" status="discovered"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ constraint: result })
    .withHints(hints)
    .buildContent();
}

async function handleVerify(
  projectRoot: string,
  file?: string,
  args?: ConstraintsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstraintsVerifyData>();

  if (!file) {
    throw Errors.missingParameter('file');
  }

  const store = createConstraintStore({ rootDir: projectRoot });
  await store.initialize();

  const verifier = createConstraintVerifier({ rootDir: projectRoot, store });

  // Read file content
  const filePath = path.resolve(projectRoot, file);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw Errors.custom('FILE_NOT_FOUND', `File not found: ${file}`, []);
  }

  const verifyOptions: Parameters<typeof verifier.verifyFile>[2] = {
    includeFixes: true,
    includeExamples: true,
  };
  if (args?.category) {
    verifyOptions.categories = [args.category];
  }
  if (args?.minConfidence !== undefined) {
    verifyOptions.minConfidence = args.minConfidence;
  }

  const result = await verifier.verifyFile(file, content, verifyOptions);

  let summaryText = result.passed
    ? `✓ All ${result.satisfied.length} constraints satisfied.`
    : `✗ ${result.violations.length} violations found.`;
  
  summaryText += ` Checked ${result.metadata.constraintsChecked} constraints in ${result.metadata.executionTimeMs}ms.`;

  const hints = {
    nextActions: result.violations.length > 0
      ? result.violations.slice(0, 3).map(v => v.guidance)
      : ['Code follows all constraints'],
    warnings: result.violations.filter(v => v.severity === 'error').length > 0
      ? ['Critical constraint violations found']
      : undefined,
    relatedTools: ['drift_suggest_changes', 'drift_context'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ result })
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// SQLite-based Action Handlers
// ============================================================================

/**
 * Handle list action using SQLite (preferred)
 */
async function handleListWithSqlite(
  unifiedStore: UnifiedStore,
  args: ConstraintsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstraintsListData & { _source: 'sqlite' }>();

  // Get all constraints from SQLite
  let constraints: DbConstraint[] = [];
  
  if (args.status && args.status !== 'all') {
    constraints = await unifiedStore.constraints.findByStatus(args.status as any);
  } else if (args.category) {
    constraints = await unifiedStore.constraints.findByCategory(args.category);
  } else {
    // Get all - need to query directly
    const all = await Promise.all([
      unifiedStore.constraints.findByStatus('discovered'),
      unifiedStore.constraints.findByStatus('approved'),
      unifiedStore.constraints.findByStatus('ignored'),
      unifiedStore.constraints.findByStatus('custom'),
    ]);
    constraints = all.flat();
  }

  // Filter by confidence if specified
  if (args.minConfidence !== undefined) {
    constraints = constraints.filter(c => c.confidence_score >= args.minConfidence!);
  }

  // Sort by confidence (highest first)
  constraints.sort((a, b) => b.confidence_score - a.confidence_score);

  // Apply limit
  const limit = args.limit ?? 20;
  const total = constraints.length;
  constraints = constraints.slice(0, limit);

  // Map to summaries (simplified - just the essential fields)
  const summaries = constraints.map(c => {
    const invariant = c.invariant ? JSON.parse(c.invariant) : {};
    return {
      id: c.id,
      name: c.name,
      description: c.description ?? '',
      category: c.category,
      language: c.language,
      status: c.status,
      confidence: c.confidence_score,
      enforcement: c.enforcement_level,
      evidence: c.confidence_evidence,
      violations: c.confidence_violations,
      type: invariant.type ?? 'unknown',
    };
  });

  // Get counts
  const counts = await unifiedStore.constraints.getCounts();

  let summaryText = `📋 ${total} constraints. `;
  summaryText += `${counts.byStatus.approved ?? 0} approved, `;
  summaryText += `${counts.byStatus.discovered ?? 0} discovered.`;

  const hints = {
    nextActions: (counts.byStatus.discovered ?? 0) > 0
      ? ['Review discovered constraints with drift_constraints action="show"']
      : ['All constraints reviewed'],
    relatedTools: ['drift_constraints action="verify"', 'drift_context'],
  };

  return builder
    .withSummary(summaryText)
    .withData({
      constraints: summaries as unknown as ConstraintSummary[],
      total,
      byCategory: counts.byCategory,
      byStatus: counts.byStatus,
      _source: 'sqlite',
    })
    .withHints(hints)
    .buildContent();
}

/**
 * Handle show action using SQLite (preferred)
 */
async function handleShowWithSqlite(
  unifiedStore: UnifiedStore,
  id?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<{ constraint: DbConstraint; _source: 'sqlite' }>();

  if (!id) {
    throw Errors.missingParameter('id');
  }

  const dbConstraint = await unifiedStore.constraints.read(id);
  if (!dbConstraint) {
    throw Errors.custom('CONSTRAINT_NOT_FOUND', `Constraint not found: ${id}`, []);
  }

  // Parse invariant for display
  const invariant = dbConstraint.invariant ? JSON.parse(dbConstraint.invariant) : {};

  let summaryText = `🔍 ${dbConstraint.name} (${dbConstraint.status}). `;
  summaryText += `${invariant.type ?? 'unknown'}: ${invariant.condition ?? 'N/A'}. `;
  summaryText += `Confidence: ${Math.round(dbConstraint.confidence_score * 100)}%.`;

  const hints = {
    nextActions: dbConstraint.status === 'discovered'
      ? [`Approve: drift_constraints action="approve" id="${id}"`]
      : ['Constraint is active'],
    relatedTools: ['drift_constraints action="verify"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ constraint: dbConstraint, _source: 'sqlite' })
    .withHints(hints)
    .buildContent();
}
