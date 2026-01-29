/**
 * drift_constants - Constant & Enum Analysis
 *
 * Analysis tool for constants, enums, and exported values:
 * - Overview of constants by category and language
 * - List constants with filtering
 * - Get constant details and usages
 * - Find magic values that should be constants
 * - Find dead (unused) constants
 * - Detect potential hardcoded secrets
 * - Find inconsistent constant values
 */

import {
  ConstantStore,
  ConstantSecurityScanner,
  ConsistencyAnalyzer,
  type ConstantExtraction,
  type EnumExtraction,
  type ConstantCategory,
  type ConstantLanguage,
  type PotentialSecret,
  type InconsistentConstant,
  type IssueSeverity,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export type ConstantsAction =
  | 'status'
  | 'list'
  | 'get'
  | 'usages'
  | 'magic'
  | 'dead'
  | 'secrets'
  | 'inconsistent';

export interface ConstantsArgs {
  action?: ConstantsAction;
  // For list action
  category?: ConstantCategory;
  language?: ConstantLanguage;
  file?: string;
  search?: string;
  exported?: boolean;
  limit?: number;
  cursor?: string;
  // For get action
  id?: string;
  name?: string;
  // For usages action
  constantId?: string;
  // For magic action
  minOccurrences?: number;
  includeStrings?: boolean;
  includeNumbers?: boolean;
  // For secrets action
  severity?: IssueSeverity;
}

export interface ConstantsStatusData {
  totalConstants: number;
  totalEnums: number;
  byLanguage: Record<string, number>;
  byCategory: Record<string, number>;
  issues: {
    magicValues: number;
    deadConstants: number;
    potentialSecrets: number;
    inconsistentValues: number;
  };
  lastScanAt?: string;
}

export interface ConstantsListData {
  constants: Array<{
    id: string;
    name: string;
    qualifiedName: string;
    file: string;
    line: number;
    language: string;
    kind: string;
    category: string;
    value?: string | number | boolean | null | undefined;
    isExported: boolean;
  }>;
  enums: Array<{
    id: string;
    name: string;
    file: string;
    line: number;
    memberCount: number;
  }>;
  total: number;
  cursor?: string;
}

export interface ConstantDetailData {
  constant?: ConstantExtraction | undefined;
  enum?: EnumExtraction | undefined;
  usages: Array<{
    file: string;
    line: number;
    context?: string;
    containingFunction?: string;
  }>;
  usageCount: number;
  relatedConstants: Array<{
    id: string;
    name: string;
    reason: string;
  }>;
}

export interface SecretsData {
  potentialSecrets: PotentialSecret[];
  total: number;
  bySeverity: Record<IssueSeverity, number>;
}

export interface InconsistentData {
  inconsistencies: InconsistentConstant[];
  total: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// ============================================================================
// Handler
// ============================================================================

export async function handleConstants(
  projectRoot: string,
  args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const action = args.action ?? 'status';

  switch (action) {
    case 'status':
      return handleStatus(projectRoot);
    case 'list':
      return handleList(projectRoot, args);
    case 'get':
      return handleGet(projectRoot, args);
    case 'usages':
      return handleUsages(projectRoot, args);
    case 'magic':
      return handleMagic(projectRoot, args);
    case 'dead':
      return handleDead(projectRoot, args);
    case 'secrets':
      return handleSecrets(projectRoot, args);
    case 'inconsistent':
      return handleInconsistent(projectRoot, args);
    default:
      throw Errors.invalidArgument(
        'action',
        `Invalid action: ${action}. Valid: status, list, get, usages, magic, dead, secrets, inconsistent`
      );
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleStatus(
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstantsStatusData>();
  const store = new ConstantStore({ rootDir: projectRoot });

  try {
    const stats = await store.getStats();
    const index = await store.getIndex();

    const data: ConstantsStatusData = {
      totalConstants: stats.totalConstants,
      totalEnums: stats.totalEnums,
      byLanguage: stats.byLanguage,
      byCategory: stats.byCategory,
      issues: stats.issues,
      lastScanAt: index.generatedAt,
    };

    let summary = `📊 ${stats.totalConstants} constants, ${stats.totalEnums} enums. `;

    // Add language breakdown
    const topLanguages = Object.entries(stats.byLanguage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([lang, count]) => `${lang}: ${count}`)
      .join(', ');
    if (topLanguages) {
      summary += `Languages: ${topLanguages}. `;
    }

    // Add issues
    const issueCount =
      stats.issues.magicValues +
      stats.issues.deadConstants +
      stats.issues.potentialSecrets +
      stats.issues.inconsistentValues;
    if (issueCount > 0) {
      summary += `⚠️ ${issueCount} issues found.`;
    }

    const warnings: string[] = [];
    if (stats.issues.potentialSecrets > 0) {
      warnings.push(`${stats.issues.potentialSecrets} potential hardcoded secrets detected`);
    }
    if (stats.issues.inconsistentValues > 0) {
      warnings.push(`${stats.issues.inconsistentValues} constants have inconsistent values`);
    }

    return builder
      .withSummary(summary)
      .withData(data)
      .withHints({
        nextActions:
          stats.issues.potentialSecrets > 0
            ? ['Run action="secrets" to review potential secrets']
            : stats.totalConstants > 0
              ? ['Run action="list" to browse constants']
              : ['Run drift scan to extract constants'],
        warnings: warnings.length > 0 ? warnings : undefined,
        relatedTools: ['drift_constants action="list"', 'drift_constants action="secrets"'],
      })
      .buildContent();
  } catch {
    return builder
      .withSummary('No constant data found. Run `drift scan` first.')
      .withHints({
        nextActions: ['Run drift scan to extract constants from your codebase'],
        relatedTools: ['drift_status'],
      })
      .buildContent();
  }
}

async function handleList(
  projectRoot: string,
  args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstantsListData>();
  const store = new ConstantStore({ rootDir: projectRoot });
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  let constants = await store.getAllConstants();
  let enums = await store.getAllEnums();

  // Apply filters
  if (args.category) {
    constants = constants.filter((c) => c.category === args.category);
  }
  if (args.language) {
    constants = constants.filter((c) => c.language === args.language);
    enums = enums.filter((e) => e.language === args.language);
  }
  if (args.file) {
    constants = constants.filter((c) => c.file.includes(args.file!));
    enums = enums.filter((e) => e.file.includes(args.file!));
  }
  if (args.search) {
    const searchLower = args.search.toLowerCase();
    constants = constants.filter(
      (c) =>
        c.name.toLowerCase().includes(searchLower) ||
        c.qualifiedName.toLowerCase().includes(searchLower)
    );
    enums = enums.filter((e) => e.name.toLowerCase().includes(searchLower));
  }
  if (args.exported !== undefined) {
    constants = constants.filter((c) => c.isExported === args.exported);
    enums = enums.filter((e) => e.isExported === args.exported);
  }

  // Pagination
  const total = constants.length + enums.length;
  const paginatedConstants = constants.slice(0, limit);
  const paginatedEnums = enums.slice(0, Math.max(0, limit - paginatedConstants.length));

  const data: ConstantsListData = {
    constants: paginatedConstants.map((c) => ({
      id: c.id,
      name: c.name,
      qualifiedName: c.qualifiedName,
      file: c.file,
      line: c.line,
      language: c.language,
      kind: c.kind,
      category: c.category,
      value: c.value,
      isExported: c.isExported,
    })),
    enums: paginatedEnums.map((e) => ({
      id: e.id,
      name: e.name,
      file: e.file,
      line: e.line,
      memberCount: e.members.length,
    })),
    total,
  };

  let summary = `Found ${constants.length} constants`;
  if (enums.length > 0) {
    summary += `, ${enums.length} enums`;
  }
  if (args.category) {
    summary += ` in category "${args.category}"`;
  }
  if (args.language) {
    summary += ` (${args.language})`;
  }
  summary += '.';

  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Use action="get" with id or name to see constant details'],
      relatedTools: ['drift_constants action="get"', 'drift_file_patterns'],
    })
    .buildContent();
}

async function handleGet(
  projectRoot: string,
  args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ConstantDetailData>();
  const store = new ConstantStore({ rootDir: projectRoot });

  if (!args.id && !args.name) {
    throw Errors.missingParameter('id or name');
  }

  let constant: ConstantExtraction | null = null;
  let enumDef: EnumExtraction | null = null;

  if (args.id) {
    constant = await store.getConstantById(args.id);
    if (!constant) {
      enumDef = await store.getEnumById(args.id);
    }
  } else if (args.name) {
    const results = await store.searchByName(args.name);
    if (results.length > 0) {
      constant = results[0]!;
    } else {
      const enums = await store.getAllEnums();
      enumDef = enums.find((e) => e.name === args.name) ?? null;
    }
  }

  if (!constant && !enumDef) {
    throw Errors.custom('NOT_FOUND', `Constant or enum not found: ${args.id ?? args.name}`, [
      'Check the ID or name',
      'Use action="list" to see available constants',
    ]);
  }

  // Find related constants (same file or same category)
  const allConstants = await store.getAllConstants();
  const relatedConstants: Array<{ id: string; name: string; reason: string }> = [];

  if (constant) {
    const sameFile = allConstants
      .filter((c) => c.file === constant.file && c.id !== constant.id)
      .slice(0, 3);
    for (const c of sameFile) {
      relatedConstants.push({ id: c.id, name: c.name, reason: 'same_file' });
    }

    const sameCategory = allConstants
      .filter(
        (c) =>
          c.category === constant.category &&
          c.id !== constant.id &&
          !sameFile.some((sf) => sf.id === c.id)
      )
      .slice(0, 2);
    for (const c of sameCategory) {
      relatedConstants.push({ id: c.id, name: c.name, reason: 'same_category' });
    }
  }

  const data: ConstantDetailData = {
    constant: constant ?? undefined,
    enum: enumDef ?? undefined,
    usages: [], // Would need reference tracking to populate
    usageCount: 0,
    relatedConstants,
  };

  const item = constant ?? enumDef!;
  let summary = `${item.name}: ${constant ? constant.kind : 'enum'} in ${item.file}:${item.line}`;
  if (constant?.value !== undefined) {
    const valueStr = String(constant.value);
    summary += ` = ${valueStr.length > 50 ? valueStr.slice(0, 50) + '...' : valueStr}`;
  }
  if (enumDef) {
    summary += ` (${enumDef.members.length} members)`;
  }

  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Use action="usages" to find where this constant is used'],
      relatedTools: ['drift_constants action="usages"', 'drift_impact_analysis'],
    })
    .buildContent();
}

async function handleUsages(
  projectRoot: string,
  args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<{ constantId: string; usages: unknown[]; total: number }>();

  if (!args.constantId && !args.id && !args.name) {
    throw Errors.missingParameter('constantId, id, or name');
  }

  const store = new ConstantStore({ rootDir: projectRoot });
  const constantId = args.constantId ?? args.id ?? args.name;

  // Get the constant
  let constant = await store.getConstantById(constantId!);
  if (!constant && args.name) {
    const results = await store.searchByName(args.name);
    constant = results[0] ?? null;
  }

  if (!constant) {
    throw Errors.custom('NOT_FOUND', `Constant not found: ${constantId}`, [
      'Use action="list" to see available constants',
    ]);
  }

  // Note: Full usage tracking requires reference analysis
  // For now, return placeholder
  const data = {
    constantId: constant.id,
    usages: [],
    total: 0,
  };

  return builder
    .withSummary(
      `${constant.name}: Usage tracking requires reference analysis. Run drift scan with reference tracking enabled.`
    )
    .withData(data)
    .withHints({
      nextActions: ['Enable reference tracking in drift config for full usage analysis'],
      relatedTools: ['drift_reachability', 'drift_impact_analysis'],
    })
    .buildContent();
}

async function handleMagic(
  _projectRoot: string,
  _args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<{ magicValues: unknown[]; total: number }>();

  // Magic value detection requires scanning file content for literals
  // This is a placeholder - full implementation would scan files
  const data = {
    magicValues: [],
    total: 0,
  };

  return builder
    .withSummary(
      'Magic value detection requires file content scanning. Run drift scan with magic value detection enabled.'
    )
    .withData(data)
    .withHints({
      nextActions: ['Enable magic value detection in drift config'],
      relatedTools: ['drift_constants action="list"'],
    })
    .buildContent();
}

async function handleDead(
  projectRoot: string,
  args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<{ deadConstants: unknown[]; total: number }>();
  const store = new ConstantStore({ rootDir: projectRoot });
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Get constants that are not exported and uncategorized (likely unused)
  const constants = await store.getAllConstants();
  const potentiallyDead = constants
    .filter((c) => !c.isExported && c.category === 'uncategorized')
    .slice(0, limit);

  const data = {
    deadConstants: potentiallyDead.map((c) => ({
      id: c.id,
      name: c.name,
      file: c.file,
      line: c.line,
      confidence: 0.5,
      reason: 'not_exported_uncategorized',
    })),
    total: potentiallyDead.length,
  };

  let summary = `Found ${potentiallyDead.length} potentially unused constants. `;
  summary += 'Note: Full dead code detection requires reference analysis.';

  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions:
        potentiallyDead.length > 0
          ? ['Review these constants - they may be unused']
          : ['No obvious dead constants found'],
      relatedTools: ['drift_dead_code', 'drift_constants action="usages"'],
    })
    .buildContent();
}

async function handleSecrets(
  projectRoot: string,
  args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<SecretsData>();
  const store = new ConstantStore({ rootDir: projectRoot });
  const scanner = new ConstantSecurityScanner();

  const constants = await store.getAllConstants();
  const result = scanner.scan(constants);

  // Filter by severity if specified
  let secrets = result.secrets;
  if (args.severity) {
    const severityOrder: IssueSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    const minIndex = severityOrder.indexOf(args.severity);
    secrets = secrets.filter((s) => severityOrder.indexOf(s.severity) >= minIndex);
  }

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const paginatedSecrets = secrets.slice(0, limit);

  const bySeverity: Record<IssueSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const secret of secrets) {
    bySeverity[secret.severity]++;
  }

  const data: SecretsData = {
    potentialSecrets: paginatedSecrets,
    total: secrets.length,
    bySeverity,
  };

  let summary = `🔐 ${secrets.length} potential secrets detected. `;
  if (bySeverity.critical > 0) {
    summary += `🔴 ${bySeverity.critical} critical. `;
  }
  if (bySeverity.high > 0) {
    summary += `🟠 ${bySeverity.high} high. `;
  }

  const warnings: string[] = [];
  if (bySeverity.critical > 0) {
    warnings.push('Critical secrets found - immediate action required!');
  }

  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions:
        secrets.length > 0
          ? ['Move secrets to environment variables', 'Use a secrets manager']
          : ['No hardcoded secrets detected'],
      warnings: warnings.length > 0 ? warnings : undefined,
      relatedTools: ['drift_security_summary', 'drift_env'],
    })
    .buildContent();
}

async function handleInconsistent(
  projectRoot: string,
  args: ConstantsArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<InconsistentData>();
  const store = new ConstantStore({ rootDir: projectRoot });
  const analyzer = new ConsistencyAnalyzer();

  const constants = await store.getAllConstants();
  const result = analyzer.analyze(constants);

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const paginatedInconsistencies = result.inconsistencies.slice(0, limit);

  const data: InconsistentData = {
    inconsistencies: paginatedInconsistencies,
    total: result.inconsistencies.length,
  };

  const summary = `⚡ ${result.inconsistencies.length} constants have inconsistent values across files.`;

  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions:
        result.inconsistencies.length > 0
          ? ['Consolidate constants to a single source of truth']
          : ['No inconsistent constants found'],
      relatedTools: ['drift_constants action="get"', 'drift_constants action="list"'],
    })
    .buildContent();
}
