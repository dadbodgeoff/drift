/**
 * drift_decisions - Decision Mining Analysis
 *
 * Analysis tool for mining architectural decisions from git history.
 * Answers: "What architectural decisions were made?" and "Why was this code structured this way?"
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createDecisionMiningAnalyzer,
  type MinedDecision,
  type DecisionMiningResult,
  type DecisionMiningSummary,
  type DecisionCategory,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export type DecisionsAction =
  | 'status'
  | 'list'
  | 'get'
  | 'for-file'
  | 'timeline'
  | 'search'
  | 'mine';

export interface DecisionsArgs {
  action: DecisionsAction;
  id?: string;
  file?: string;
  query?: string;
  category?: DecisionCategory;
  limit?: number;
  since?: string;
  until?: string;
  minConfidence?: number;
}

export interface DecisionsStatusData {
  summary: DecisionMiningSummary;
  generatedAt?: string;
}

export interface DecisionsListData {
  decisions: MinedDecision[];
  total: number;
}

export interface DecisionsGetData {
  decision: MinedDecision;
}

export interface DecisionsForFileData {
  file: string;
  decisions: MinedDecision[];
}

export interface DecisionsTimelineData {
  timeline: Array<{
    month: string;
    decisions: MinedDecision[];
  }>;
}

export interface DecisionsSearchData {
  query: string;
  results: MinedDecision[];
}

export interface DecisionsMineData {
  result: DecisionMiningResult;
}

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const DECISIONS_DIR = 'decisions';

// ============================================================================
// Handler
// ============================================================================

export async function handleDecisions(
  projectRoot: string,
  args: DecisionsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { action } = args;

  switch (action) {
    case 'status':
      return handleStatus(projectRoot);
    case 'list':
      return handleList(projectRoot, args.category, args.limit);
    case 'get':
      return handleGet(projectRoot, args.id);
    case 'for-file':
      return handleForFile(projectRoot, args.file);
    case 'timeline':
      return handleTimeline(projectRoot, args.limit);
    case 'search':
      return handleSearch(projectRoot, args.query, args.limit);
    case 'mine':
      return handleMine(projectRoot, args.since, args.until, args.minConfidence);
    default:
      throw Errors.invalidArgument('action', `Invalid action: ${action}. Valid actions: status, list, get, for-file, timeline, search, mine`);
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleStatus(
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DecisionsStatusData>();

  const indexPath = path.join(projectRoot, DRIFT_DIR, DECISIONS_DIR, 'index.json');

  try {
    const data = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
    const { summary } = data;

    let summaryText = `📜 ${summary.totalDecisions} decisions mined. `;
    summaryText += `${summary.byStatus.draft} draft, ${summary.byStatus.confirmed} confirmed. `;
    summaryText += `${summary.byConfidence.high} high confidence.`;

    const hints = {
      nextActions: [
        summary.byStatus.draft > 0
          ? 'Review draft decisions with drift_decisions action="list"'
          : 'All decisions confirmed',
      ],
      relatedTools: ['drift_decisions action="list"', 'drift_decisions action="timeline"'],
    };

    return builder
      .withSummary(summaryText)
      .withData({ summary, generatedAt: data.lastUpdated })
      .withHints(hints)
      .buildContent();

  } catch {
    throw Errors.custom(
      'NO_DECISIONS',
      'No decisions found. Mine them first using the CLI: drift decisions mine',
      ['drift decisions mine']
    );
  }
}

async function handleList(
  projectRoot: string,
  category?: DecisionCategory,
  limit?: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DecisionsListData>();

  const decisions = await loadDecisions(projectRoot);
  if (!decisions) {
    throw Errors.custom(
      'NO_DECISIONS',
      'No decisions found. Mine them first.',
      ['drift decisions mine']
    );
  }

  let filtered = decisions;

  // Filter by category
  if (category) {
    filtered = filtered.filter(d => d.category === category);
  }

  // Sort by confidence
  filtered.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Apply limit
  const limitedDecisions = filtered.slice(0, limit ?? 20);

  let summaryText = `📜 ${limitedDecisions.length} decisions`;
  if (category) {
    summaryText += ` in ${category}`;
  }
  summaryText += `. Showing top by confidence.`;

  const hints = {
    nextActions: limitedDecisions.length > 0
      ? [`View details: drift_decisions action="get" id="${limitedDecisions[0]?.id}"`]
      : ['Mine decisions first'],
    relatedTools: ['drift_decisions action="get"', 'drift_decisions action="for-file"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ decisions: limitedDecisions, total: filtered.length })
    .withHints(hints)
    .buildContent();
}

async function handleGet(
  projectRoot: string,
  id?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DecisionsGetData>();

  if (!id) {
    throw Errors.missingParameter('id');
  }

  try {
    const decisionPath = path.join(projectRoot, DRIFT_DIR, DECISIONS_DIR, `${id}.json`);
    const decision = JSON.parse(await fs.readFile(decisionPath, 'utf-8')) as MinedDecision;

    let summaryText = `📜 ${decision.id}: ${decision.title}. `;
    summaryText += `${decision.status} | ${decision.confidence} confidence | ${decision.category}.`;

    const hints = {
      nextActions: decision.status === 'draft'
        ? ['Confirm with: drift decisions confirm ' + id]
        : ['View related decisions'],
      relatedTools: ['drift_decisions action="for-file"', 'drift_decisions action="timeline"'],
    };

    return builder
      .withSummary(summaryText)
      .withData({ decision })
      .withHints(hints)
      .buildContent();

  } catch {
    throw Errors.custom(
      'DECISION_NOT_FOUND',
      `Decision not found: ${id}`,
      ['drift_decisions action="list"']
    );
  }
}

async function handleForFile(
  projectRoot: string,
  file?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DecisionsForFileData>();

  if (!file) {
    throw Errors.missingParameter('file');
  }

  const decisions = await loadDecisions(projectRoot);
  if (!decisions) {
    throw Errors.custom(
      'NO_DECISIONS',
      'No decisions found. Mine them first.',
      ['drift decisions mine']
    );
  }

  // Find decisions affecting this file
  const matching = decisions.filter(d =>
    d.cluster.filesAffected.some(f => f.includes(file) || file.includes(f))
  );

  const summaryText = `📜 ${matching.length} decisions affect ${file}.`;

  const hints = {
    nextActions: matching.length > 0
      ? [`View decision: drift_decisions action="get" id="${matching[0]?.id}"`]
      : ['No decisions found for this file'],
    relatedTools: ['drift_decisions action="get"', 'drift_impact_analysis'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ file, decisions: matching })
    .withHints(hints)
    .buildContent();
}

async function handleTimeline(
  projectRoot: string,
  limit?: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DecisionsTimelineData>();

  const decisions = await loadDecisions(projectRoot);
  if (!decisions) {
    throw Errors.custom(
      'NO_DECISIONS',
      'No decisions found. Mine them first.',
      ['drift decisions mine']
    );
  }

  // Sort by date (newest first)
  const sorted = [...decisions].sort(
    (a, b) => new Date(b.dateRange.end).getTime() - new Date(a.dateRange.end).getTime()
  ).slice(0, limit ?? 20);

  // Group by month
  const byMonth = new Map<string, MinedDecision[]>();
  for (const decision of sorted) {
    const date = new Date(decision.dateRange.end);
    const month = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    if (!byMonth.has(month)) {
      byMonth.set(month, []);
    }
    byMonth.get(month)!.push(decision);
  }

  const timeline = Array.from(byMonth.entries()).map(([month, decisions]) => ({
    month,
    decisions,
  }));

  const summaryText = `📅 ${sorted.length} decisions across ${timeline.length} months.`;

  const hints = {
    nextActions: ['View specific decision for details'],
    relatedTools: ['drift_decisions action="get"', 'drift_trends'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ timeline })
    .withHints(hints)
    .buildContent();
}

async function handleSearch(
  projectRoot: string,
  query?: string,
  limit?: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DecisionsSearchData>();

  if (!query) {
    throw Errors.missingParameter('query');
  }

  const decisions = await loadDecisions(projectRoot);
  if (!decisions) {
    throw Errors.custom(
      'NO_DECISIONS',
      'No decisions found. Mine them first.',
      ['drift decisions mine']
    );
  }

  const queryLower = query.toLowerCase();

  // Search in title, ADR content, and tags
  const results = decisions.filter(d =>
    d.title.toLowerCase().includes(queryLower) ||
    d.adr.context.toLowerCase().includes(queryLower) ||
    d.adr.decision.toLowerCase().includes(queryLower) ||
    d.tags.some(t => t.toLowerCase().includes(queryLower)) ||
    d.category.toLowerCase().includes(queryLower)
  ).slice(0, limit ?? 10);

  const summaryText = `🔍 ${results.length} decisions match "${query}".`;

  const hints = {
    nextActions: results.length > 0
      ? [`View: drift_decisions action="get" id="${results[0]?.id}"`]
      : ['Try a different search term'],
    relatedTools: ['drift_decisions action="list"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ query, results })
    .withHints(hints)
    .buildContent();
}

async function handleMine(
  projectRoot: string,
  since?: string,
  until?: string,
  minConfidence?: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<DecisionsMineData>();

  // Build options conditionally to satisfy exactOptionalPropertyTypes
  const options: Parameters<typeof createDecisionMiningAnalyzer>[0] = {
    rootDir: projectRoot,
    minConfidence: minConfidence ?? 0.5,
  };
  
  if (since) {
    options.since = new Date(since);
  }
  if (until) {
    options.until = new Date(until);
  }

  // Create analyzer
  const analyzer = createDecisionMiningAnalyzer(options);

  // Run mining
  const result = await analyzer.mine();

  // Save results
  await saveDecisions(projectRoot, result);

  let summaryText = `📜 Mined ${result.decisions.length} decisions from ${result.summary.totalCommitsAnalyzed} commits. `;
  summaryText += `${result.summary.byConfidence.high} high confidence.`;

  const hints = {
    nextActions: result.decisions.length > 0
      ? ['View decisions with drift_decisions action="list"']
      : ['Try adjusting date range or confidence threshold'],
    warnings: result.errors.length > 0
      ? [`${result.errors.length} errors during mining`]
      : undefined,
    relatedTools: ['drift_decisions action="status"', 'drift_decisions action="timeline"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ result })
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

async function loadDecisions(projectRoot: string): Promise<MinedDecision[] | null> {
  try {
    const indexPath = path.join(projectRoot, DRIFT_DIR, DECISIONS_DIR, 'index.json');
    const indexData = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

    const decisions: MinedDecision[] = [];
    for (const id of indexData.decisionIds) {
      const decisionPath = path.join(projectRoot, DRIFT_DIR, DECISIONS_DIR, `${id}.json`);
      try {
        const decision = JSON.parse(await fs.readFile(decisionPath, 'utf-8'));
        decisions.push(decision);
      } catch {
        // Skip missing decisions
      }
    }

    return decisions;
  } catch {
    return null;
  }
}

async function saveDecisions(projectRoot: string, result: DecisionMiningResult): Promise<void> {
  const decisionsDir = path.join(projectRoot, DRIFT_DIR, DECISIONS_DIR);
  await fs.mkdir(decisionsDir, { recursive: true });

  // Save each decision
  for (const decision of result.decisions) {
    const decisionPath = path.join(decisionsDir, `${decision.id}.json`);
    await fs.writeFile(decisionPath, JSON.stringify(decision, null, 2));
  }

  // Build and save index
  const index = {
    version: '1.0.0',
    decisionIds: result.decisions.map(d => d.id),
    byStatus: {
      draft: result.decisions.filter(d => d.status === 'draft').map(d => d.id),
      confirmed: result.decisions.filter(d => d.status === 'confirmed').map(d => d.id),
      superseded: result.decisions.filter(d => d.status === 'superseded').map(d => d.id),
      rejected: result.decisions.filter(d => d.status === 'rejected').map(d => d.id),
    },
    byCategory: {} as Record<string, string[]>,
    summary: result.summary,
    lastUpdated: new Date().toISOString(),
  };

  const categories = [
    'technology-adoption', 'technology-removal', 'pattern-introduction',
    'pattern-migration', 'architecture-change', 'api-change',
    'security-enhancement', 'performance-optimization', 'refactoring',
    'testing-strategy', 'infrastructure', 'other'
  ];
  for (const category of categories) {
    index.byCategory[category] = result.decisions.filter(d => d.category === category).map(d => d.id);
  }

  await fs.writeFile(
    path.join(decisionsDir, 'index.json'),
    JSON.stringify(index, null, 2)
  );
}
