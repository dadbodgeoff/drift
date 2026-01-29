/**
 * drift_explain - Comprehensive Code Explanation
 * Uses LEARNED DATA from Drift's pattern detection and boundary analysis
 * 
 * This tool leverages what Drift has already learned about the codebase:
 * - PatternStore: Patterns discovered through semantic clustering
 * - BoundaryStore: Data access points learned from scanning
 * - CallGraphStore: Call relationships and reachability
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  PatternStore, ManifestStore, BoundaryStore, CallGraphStore,
  createCallGraphAnalyzer,
  type Pattern, type DataAccessPoint,
} from 'driftdetect-core';

import { createResponseBuilder } from '../../infrastructure/index.js';

export type ExplanationDepth = 'summary' | 'detailed' | 'comprehensive';
export type ExplanationFocus = 'security' | 'performance' | 'architecture' | 'testing';

export interface ExplainArgs { target: string; depth?: ExplanationDepth; focus?: ExplanationFocus; }

export interface CodeExplanation {
  summary: string;
  purpose: string;
  context: { module: string; role: string; importance: 'critical' | 'high' | 'medium' | 'low' };
  patterns: Array<{ name: string; category: string; compliance: 'follows' | 'partial' | 'deviates'; note: string }>;
  dependencies: { imports: string[]; usedBy: string[]; calls: string[]; dataAccess: Array<{ table: string; operation: string; fields: string[] }> };
  security?: { sensitiveData: string[]; accessLevel: string; concerns: string[]; reachableSensitiveFields?: string[] };
  semantics?: { functions: number; asyncFunctions: number; exportedFunctions: number; dataAccessPoints: number; frameworks: string[] };
  insights: string[];
  nextSteps: string[];
}

export interface ExplainData { target: string; depth: ExplanationDepth; focus?: ExplanationFocus | undefined; explanation: CodeExplanation; }

export async function handleExplain(
  stores: { pattern: PatternStore; manifest: ManifestStore; boundary: BoundaryStore; callGraph: CallGraphStore },
  projectRoot: string, args: ExplainArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ExplainData>();
  const { target, depth = 'detailed', focus } = args;
  await stores.pattern.initialize();
  await stores.manifest.load();
  
  const isFile = target.includes('/') || target.includes('.');
  const relativePath = isFile ? (target.startsWith('/') ? path.relative(projectRoot, target) : target) : null;
  
  let fileContent: string | null = null;
  if (relativePath) {
    try { fileContent = await fs.readFile(path.join(projectRoot, relativePath), 'utf-8'); } catch { /* not found */ }
  }

  
  if (!fileContent && !relativePath) {
    return builder.withSummary(`Symbol search not yet implemented for: ${target}`)
      .withData({ target, depth, focus, explanation: {
        summary: `Could not find target: ${target}`, purpose: 'Unknown',
        context: { module: 'unknown', role: 'unknown', importance: 'low' },
        patterns: [], dependencies: { imports: [], usedBy: [], calls: [], dataAccess: [] },
        insights: ['Target not found - try providing a file path'], nextSteps: ['Use drift_files_list to find relevant files'],
      }}).buildContent();
  }
  
  // Use LEARNED data from BoundaryStore instead of re-extracting
  await stores.boundary.initialize();
  const fileAccessInfo = stores.boundary.getFileAccess(relativePath || '');
  let dataAccessPoints: DataAccessPoint[] = [];
  
  // Get data access points that Drift has already learned for this file
  if (fileAccessInfo.length > 0 && fileAccessInfo[0]) {
    dataAccessPoints = fileAccessInfo[0].accessPoints;
  }
  
  const allPatterns = stores.pattern.getAll();
  const filePatterns = relativePath ? allPatterns.filter(p => p.locations.some(l => l.file === relativePath) || p.outliers.some(o => o.file === relativePath)) : [];
  const explanation = await analyzeCode(relativePath || target, fileContent || '', filePatterns, dataAccessPoints, projectRoot, depth, focus);
  
  return builder.withSummary(explanation.summary)
    .withData({ target: relativePath || target, depth, focus, explanation })
    .withHints({ nextActions: explanation.nextSteps.slice(0, 3), relatedTools: ['drift_impact_analysis', 'drift_reachability', 'drift_code_examples'] })
    .buildContent();
}

async function analyzeCode(
  file: string, _content: string, patterns: Pattern[], dataAccessPoints: DataAccessPoint[],
  projectRoot: string, depth: ExplanationDepth, focus?: ExplanationFocus
): Promise<CodeExplanation> {
  const purpose = inferPurpose(file, dataAccessPoints);
  const context = inferContext(file, patterns, dataAccessPoints);
  const patternAnalysis = analyzePatterns(patterns, file);
  const dependencies = await extractDependencies(dataAccessPoints, file, projectRoot);
  
  let security: CodeExplanation['security'] | undefined;
  if (depth !== 'summary' || focus === 'security') {
    security = await analyzeSecurityContext(file, dataAccessPoints, projectRoot);
  }
  
  let semantics: CodeExplanation['semantics'] | undefined;
  if (dataAccessPoints.length > 0) {
    semantics = { functions: 0, asyncFunctions: 0, exportedFunctions: 0, dataAccessPoints: dataAccessPoints.length, frameworks: detectFrameworks(dataAccessPoints) };
  }
  
  const insights = generateInsights(file, patterns, dependencies, security, dataAccessPoints, focus);
  const nextSteps = generateNextSteps(file, patterns, security, dataAccessPoints, focus);
  const summary = buildSummary(file, purpose, context, patternAnalysis, security, semantics);
  
  const result: CodeExplanation = { summary, purpose, context, patterns: patternAnalysis, dependencies, insights, nextSteps };
  if (security) {result.security = security;}
  if (semantics) {result.semantics = semantics;}
  return result;
}


function inferPurpose(file: string, dataAccessPoints: DataAccessPoint[]): string {
  const fileName = path.basename(file, path.extname(file));
  if (dataAccessPoints.length > 0) {
    const tables = [...new Set(dataAccessPoints.map(a => a.table))];
    const operations = [...new Set(dataAccessPoints.map(a => a.operation))];
    return `Data access layer for ${tables.join(', ')} (${operations.join(', ')})`;
  }
  if (/controller/i.test(fileName)) {return 'HTTP request handler';}
  if (/service/i.test(fileName)) {return 'Business logic service';}
  if (/repository/i.test(fileName)) {return 'Data access layer';}
  if (/middleware/i.test(fileName)) {return 'Request/response interceptor';}
  return 'Module providing specific functionality';
}

function inferContext(file: string, patterns: Pattern[], dataAccessPoints: DataAccessPoint[]) {
  const parts = file.split('/');
  const module = parts.length > 1 ? parts[parts.length - 2] ?? 'root' : 'root';
  let role = 'utility';
  if (dataAccessPoints.length > 0) {role = 'data layer';}
  else if (patterns.some(p => p.category === 'api')) {role = 'API layer';}
  else if (patterns.some(p => p.category === 'data-access')) {role = 'data layer';}
  
  let importance: 'critical' | 'high' | 'medium' | 'low' = 'medium';
  const sensitivePatterns = ['password', 'secret', 'token', 'api_key', 'ssn'];
  if (dataAccessPoints.some(a => a.fields.some(f => sensitivePatterns.some(p => f.toLowerCase().includes(p))))) {importance = 'critical';}
  else if (dataAccessPoints.length > 0) {importance = 'high';}
  return { module, role, importance };
}

function analyzePatterns(patterns: Pattern[], file: string) {
  return patterns.slice(0, 5).map(p => {
    const isOutlier = p.outliers.some(o => o.file === file);
    const isLocation = p.locations.some(l => l.file === file);
    return {
      name: p.name, category: p.category,
      compliance: isOutlier ? 'deviates' as const : isLocation ? 'follows' as const : 'partial' as const,
      note: isOutlier ? `Deviates from ${p.locations.length} implementations` : `Consistent with ${p.locations.length} implementations`,
    };
  });
}

async function extractDependencies(dataAccessPoints: DataAccessPoint[], file: string, projectRoot: string) {
  const imports: string[] = [];
  const usedBy: string[] = [];
  const dataAccess: Array<{ table: string; operation: string; fields: string[] }> = [];
  for (const access of dataAccessPoints) {
    dataAccess.push({ table: access.table, operation: access.operation, fields: access.fields });
  }
  try {
    const analyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
    await analyzer.initialize();
    const graph = analyzer.getGraph();
    if (graph) {
      for (const func of analyzer.getFunctionsInFile(file)) {
        for (const caller of func.calledBy) {
          const callerFunc = graph.functions.get(caller.callerId);
          if (callerFunc) {
            // Transform __module__ to <module-level> for cleaner display
            const displayName = callerFunc.qualifiedName === '__module__' ? '<module-level>' : callerFunc.qualifiedName;
            if (!usedBy.includes(displayName)) {usedBy.push(displayName);}
          }
        }
      }
    }
  } catch { /* Call graph not available */ }
  return { imports: imports.slice(0, 10), usedBy: usedBy.slice(0, 10), calls: [], dataAccess };
}


async function analyzeSecurityContext(file: string, dataAccessPoints: DataAccessPoint[], projectRoot: string): Promise<CodeExplanation['security'] | undefined> {
  const sensitiveData: string[] = [];
  const concerns: string[] = [];
  const reachableSensitiveFields: string[] = [];
  const sensitivePatterns = ['password', 'secret', 'token', 'api_key', 'ssn'];
  
  for (const access of dataAccessPoints) {
    for (const field of access.fields) {
      if (sensitivePatterns.some(p => field.toLowerCase().includes(p)) && !sensitiveData.includes(field)) {sensitiveData.push(field);}
    }
    if (access.isRawSql) {concerns.push(`Raw SQL at line ${access.line}`);}
  }
  
  try {
    const analyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
    await analyzer.initialize();
    const graph = analyzer.getGraph();
    if (graph) {
      for (const func of analyzer.getFunctionsInFile(file)) {
        const reachable = analyzer.getReachableDataFromFunction(`${file}:${func.name}`, { sensitiveOnly: true, maxDepth: 5 });
        for (const sf of reachable.sensitiveFields) {
          const fieldName = `${sf.field.table}.${sf.field.field}`;
          if (!reachableSensitiveFields.includes(fieldName)) {reachableSensitiveFields.push(fieldName);}
        }
      }
    }
  } catch { /* Call graph not available */ }
  
  if (!sensitiveData.length && !concerns.length && !reachableSensitiveFields.length) {return undefined;}
  const accessLevel = file.includes('admin') ? 'admin-only' : file.includes('api') ? 'public' : 'internal';
  const result: CodeExplanation['security'] = { sensitiveData, accessLevel, concerns };
  if (reachableSensitiveFields.length > 0) {result.reachableSensitiveFields = reachableSensitiveFields;}
  return result;
}

function detectFrameworks(dataAccessPoints: DataAccessPoint[]): string[] {
  const frameworks = new Set<string>();
  const frameworkNames: Record<string, string> = {
    'supabase': 'Supabase', 'prisma': 'Prisma', 'typeorm': 'TypeORM', 'sequelize': 'Sequelize',
    'mongoose': 'Mongoose', 'django': 'Django', 'sqlalchemy': 'SQLAlchemy', 'efcore': 'Entity Framework',
    'eloquent': 'Laravel/Eloquent', 'spring-data': 'Spring Data JPA', 'hibernate': 'Hibernate',
    'drizzle': 'Drizzle', 'knex': 'Knex', 'doctrine': 'Doctrine',
  };
  for (const access of dataAccessPoints) {
    if (access.framework) {frameworks.add(frameworkNames[access.framework] || access.framework);}
  }
  return Array.from(frameworks);
}


function generateInsights(_file: string, patterns: Pattern[], _deps: CodeExplanation['dependencies'], security: CodeExplanation['security'] | undefined, dataAccessPoints: DataAccessPoint[], _focus?: ExplanationFocus): string[] {
  const insights: string[] = [];
  if (dataAccessPoints.length > 0) {
    const tables = [...new Set(dataAccessPoints.map(a => a.table))];
    insights.push(`Accesses ${dataAccessPoints.length} data point(s) across ${tables.length} table(s)`);
  }
  if (patterns.length) {insights.push(`Participates in ${patterns.length} pattern(s)`);}
  if (security?.concerns.length) {insights.push(`⚠️ ${security.concerns.length} security concern(s)`);}
  if (security?.reachableSensitiveFields?.length) {insights.push(`🔒 Can reach ${security.reachableSensitiveFields.length} sensitive field(s)`);}
  return insights;
}

function generateNextSteps(file: string, patterns: Pattern[], security: CodeExplanation['security'] | undefined, dataAccessPoints: DataAccessPoint[], _focus?: ExplanationFocus): string[] {
  const steps: string[] = [];
  if (security?.concerns.length) {steps.push('Run drift_suggest_changes with issue="security"');}
  if (security?.reachableSensitiveFields?.length) {steps.push('Use drift_reachability to trace sensitive data');}
  const outliers = patterns.filter(p => p.outliers.some(o => o.file === file));
  if (outliers.length && outliers[0]) {steps.push(`Review pattern "${outliers[0].name}" with drift_pattern_get`);}
  if (dataAccessPoints.some(a => a.isRawSql)) {steps.push('Review raw SQL queries for injection vulnerabilities');}
  if (!steps.length) {steps.push('Use drift_code_examples to see similar implementations');}
  return steps;
}

function buildSummary(file: string, purpose: string, context: CodeExplanation['context'], patterns: CodeExplanation['patterns'], security: CodeExplanation['security'] | undefined, semantics?: CodeExplanation['semantics']): string {
  const fileName = path.basename(file);
  let summary = `**${fileName}** is a ${context.importance}-importance ${context.role} file. ${purpose}. `;
  if (semantics) {summary += `${semantics.dataAccessPoints} data access point(s). `;}
  const deviates = patterns.filter(p => p.compliance === 'deviates').length;
  if (deviates) {summary += `⚠️ Deviates from ${deviates} pattern(s). `;}
  if (security?.concerns.length) {summary += `🔒 ${security.concerns.length} security concern(s).`;}
  return summary;
}
