/**
 * Enrichment Engine
 *
 * Enterprise-grade security finding enrichment.
 * Transforms raw vulnerability findings into actionable intelligence
 * by connecting them to their actual data impact through call graph analysis.
 *
 * @example
 * ```typescript
 * const engine = new EnrichmentEngine(callGraph, boundaryStore);
 *
 * // Enrich a single finding
 * const enriched = await engine.enrich(finding);
 * console.log(enriched.dataImpact.sensitiveFields);
 * console.log(enriched.priority.tier); // 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
 *
 * // Batch enrich with summary
 * const result = await engine.enrichBatch(findings);
 * console.log(result.summary.byPriority);
 * ```
 */

import { ImpactScorer, createImpactScorer } from './impact-scorer.js';
import { RemediationGenerator, createRemediationGenerator } from './remediation-generator.js';
import { SensitivityClassifier, createSensitivityClassifier } from './sensitivity-classifier.js';
import { ReachabilityEngine } from '../analysis/reachability.js';

import type { DataAccessPoint, SensitiveField } from '../../boundaries/types.js';
import type { CallGraph, FunctionNode, CallPathNode } from '../types.js';
import type {
  SecurityFinding,
  EnrichedFinding,
  DataImpact,
  BlastRadius,
  ReachableData,
  SensitiveFieldImpact,
  EntryPointInfo,
  EntryPointType,
  AffectedFunction,
  EnrichmentOptions,
  EnrichmentResult,
  EnrichmentSummary,
  BatchMetadata,
  EnrichmentFailure,
  EnrichmentMetadata,
  PriorityTier,
  ImpactClassification,
  FindingCategory,
  DataRegulation,
} from './types.js';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  getCallGraphCallers,
} from '../../native/index.js';

// ============================================================================
// Constants
// ============================================================================

const ENGINE_VERSION = '1.0.0';
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_PARALLEL_LIMIT = 10;

/**
 * Decorator patterns that indicate API entry points
 */
const API_DECORATOR_PATTERNS = [
  // Express/Node.js
  /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(/i,
  /app\.(get|post|put|delete|patch)\s*\(/i,
  /router\.(get|post|put|delete|patch)\s*\(/i,
  // NestJS
  /@(Controller|Get|Post|Put|Delete|Patch)\s*\(/i,
  // FastAPI/Flask
  /@app\.(route|get|post|put|delete)\s*\(/i,
  /@router\.(get|post|put|delete)\s*\(/i,
  // Spring
  /@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)\s*\(/i,
  // ASP.NET
  /\[(HttpGet|HttpPost|HttpPut|HttpDelete|Route)\s*\(/i,
  // Laravel
  /Route::(get|post|put|delete|patch)\s*\(/i,
];

// ============================================================================
// Enrichment Engine
// ============================================================================

/**
 * Enterprise-grade security finding enrichment engine
 */
export class EnrichmentEngine {
  private readonly graph: CallGraph;
  private readonly reachability: ReachabilityEngine;
  private readonly classifier: SensitivityClassifier;
  private readonly scorer: ImpactScorer;
  private readonly remediator: RemediationGenerator;
  private readonly dataAccessByFile: Map<string, DataAccessPoint[]>;
  private readonly sensitiveFields: Map<string, SensitiveField>;
  private readonly useNativeQueries: boolean;
  private readonly projectRoot: string | undefined;

  constructor(
    graph: CallGraph,
    dataAccessPoints?: DataAccessPoint[],
    sensitiveFields?: SensitiveField[]
  ) {
    this.graph = graph;
    this.reachability = new ReachabilityEngine(graph);
    this.classifier = createSensitivityClassifier();
    this.scorer = createImpactScorer();
    this.remediator = createRemediationGenerator();

    // Check if we should use native SQLite queries
    this.projectRoot = graph.projectRoot;
    const isSqliteMode = (graph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
    this.useNativeQueries = isSqliteMode && 
                            !!this.projectRoot && 
                            isNativeAvailable() && 
                            isCallGraphAvailable(this.projectRoot);

    // Index data access points by file
    this.dataAccessByFile = new Map();
    if (dataAccessPoints) {
      for (const access of dataAccessPoints) {
        const existing = this.dataAccessByFile.get(access.file) ?? [];
        existing.push(access);
        this.dataAccessByFile.set(access.file, existing);
      }
    }

    // Index sensitive fields
    this.sensitiveFields = new Map();
    if (sensitiveFields) {
      for (const field of sensitiveFields) {
        const key = field.table ? `${field.table}.${field.field}` : field.field;
        this.sensitiveFields.set(key.toLowerCase(), field);
      }
    }
  }

  /**
   * Get callers for a function (using native query if available)
   */
  private getFunctionCallers(funcId: string, funcName: string): Array<{ callerId: string }> {
    const func = this.graph.functions.get(funcId);
    
    // If calledBy is populated, use it
    if (func && func.calledBy.length > 0) {
      return func.calledBy;
    }
    
    // If using native queries, check SQLite
    if (this.useNativeQueries && this.projectRoot) {
      const callers = getCallGraphCallers(this.projectRoot, funcName);
      return callers.map(c => ({ callerId: c.callerId }));
    }
    
    return func?.calledBy ?? [];
  }

  /**
   * Enrich a single security finding
   */
  async enrich(
    finding: SecurityFinding,
    options: EnrichmentOptions = {}
  ): Promise<EnrichedFinding> {
    const startTime = Date.now();
    const warnings: string[] = [];

    try {
      // Analyze data impact
      const dataImpact = this.analyzeDataImpact(finding, options, warnings);

      // Analyze blast radius
      const blastRadius = options.skipBlastRadius
        ? this.createEmptyBlastRadius()
        : this.analyzeBlastRadius(finding, warnings);

      // Calculate priority score
      const priority = this.scorer.calculatePriority(
        finding.severity,
        finding.category,
        dataImpact,
        blastRadius,
        finding.cvss
      );

      // Generate remediation guidance
      const remediation = options.skipRemediation
        ? this.createEmptyRemediation()
        : this.remediator.generate(finding, dataImpact);

      // Build enrichment metadata
      const enrichment: EnrichmentMetadata = {
        enrichedAt: new Date().toISOString(),
        engineVersion: ENGINE_VERSION,
        callGraphVersion: this.graph.version,
        confidence: this.calculateConfidence(dataImpact, blastRadius),
        warnings,
        processingTimeMs: Date.now() - startTime,
      };

      return {
        finding,
        dataImpact,
        blastRadius,
        priority,
        remediation,
        enrichment,
      };
    } catch (error) {
      // Return a minimal enrichment on error
      warnings.push(`Enrichment error: ${error instanceof Error ? error.message : 'Unknown error'}`);

      return {
        finding,
        dataImpact: this.createEmptyDataImpact(),
        blastRadius: this.createEmptyBlastRadius(),
        priority: {
          overall: this.getBaseSeverityScore(finding.severity),
          severityScore: this.getBaseSeverityScore(finding.severity),
          dataImpactScore: 0,
          blastRadiusScore: 0,
          exploitabilityScore: 50,
          tier: this.getBaseTier(finding.severity),
          increasingFactors: [],
          decreasingFactors: ['Enrichment failed - using base severity only'],
        },
        remediation: this.createEmptyRemediation(),
        enrichment: {
          enrichedAt: new Date().toISOString(),
          engineVersion: ENGINE_VERSION,
          callGraphVersion: this.graph.version,
          confidence: 0.1,
          warnings,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Enrich multiple findings with summary statistics
   */
  async enrichBatch(
    findings: SecurityFinding[],
    options: EnrichmentOptions = {}
  ): Promise<EnrichmentResult> {
    const startTime = Date.now();
    const enrichedFindings: EnrichedFinding[] = [];
    const failures: EnrichmentFailure[] = [];

    const parallelLimit = options.parallelLimit ?? DEFAULT_PARALLEL_LIMIT;

    // Process in batches for controlled parallelism
    for (let i = 0; i < findings.length; i += parallelLimit) {
      const batch = findings.slice(i, i + parallelLimit);
      const results = await Promise.all(
        batch.map(async (finding) => {
          try {
            return await this.enrich(finding, options);
          } catch (error) {
            failures.push({
              findingId: finding.id,
              error: error instanceof Error ? error.message : 'Unknown error',
              type: 'unknown',
            });
            return null;
          }
        })
      );

      for (const result of results) {
        if (result) {
          enrichedFindings.push(result);
        }
      }
    }

    // Build summary
    const summary = this.buildSummary(enrichedFindings);

    // Build metadata
    const metadata: BatchMetadata = {
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      totalTimeMs: Date.now() - startTime,
      avgTimePerFindingMs: findings.length > 0
        ? (Date.now() - startTime) / findings.length
        : 0,
      failures,
    };

    return {
      findings: enrichedFindings,
      summary,
      metadata,
    };
  }

  /**
   * Analyze data impact for a finding
   */
  private analyzeDataImpact(
    finding: SecurityFinding,
    options: EnrichmentOptions,
    warnings: string[]
  ): DataImpact {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

    // Get reachability from the finding location
    const reachabilityResult = this.reachability.getReachableData(
      finding.file,
      finding.line,
      {
        maxDepth,
        includeUnresolved: options.includeUnresolved ?? false,
      }
    );

    if (reachabilityResult.reachableAccess.length === 0) {
      warnings.push('No data access detected from vulnerability location');
      return this.createEmptyDataImpact();
    }

    // Build reachable data with impact analysis
    const reachableData: ReachableData[] = [];
    const sensitiveFieldsMap = new Map<string, SensitiveFieldImpact>();
    const tablesSet = new Set<string>();
    const regulationsSet = new Set<DataRegulation>();

    for (const access of reachabilityResult.reachableAccess) {
      if (access.access.confidence < minConfidence) {continue;}

      tablesSet.add(access.access.table);

      // Classify sensitive fields
      const accessSensitiveFields: SensitiveField[] = [];
      for (const field of access.access.fields) {
        const profile = this.classifier.classify(field, access.access.table);

        if (profile.type !== 'unknown') {
          const sensitiveField: SensitiveField = {
            field,
            table: access.access.table,
            sensitivityType: profile.type,
            file: access.access.file,
            line: access.access.line,
            confidence: access.access.confidence,
          };
          accessSensitiveFields.push(sensitiveField);

          // Add to aggregated map
          const key = `${access.access.table}.${field}`.toLowerCase();
          const existing = sensitiveFieldsMap.get(key);
          if (existing) {
            existing.pathCount++;
            existing.shortestPath = Math.min(existing.shortestPath, access.depth);
            if (!existing.operations.includes(access.access.operation)) {
              existing.operations.push(access.access.operation);
            }
          } else {
            sensitiveFieldsMap.set(key, {
              field: sensitiveField,
              pathCount: 1,
              shortestPath: access.depth,
              operations: [access.access.operation],
              regulations: profile.regulations,
              impactScore: profile.baseScore,
            });
          }

          // Collect regulations
          for (const reg of profile.regulations) {
            regulationsSet.add(reg);
          }
        }
      }

      // Calculate impact for this access
      const impactScore = this.calculateAccessImpactScore(access.access, accessSensitiveFields);

      reachableData.push({
        access: access.access,
        callPath: access.path,
        depth: access.depth,
        sensitiveFields: accessSensitiveFields,
        operations: [access.access.operation],
        impactScore,
        impactRationale: this.buildImpactRationale(access.access, accessSensitiveFields),
      });
    }

    const sensitiveFields = Array.from(sensitiveFieldsMap.values());
    const tables = Array.from(tablesSet);
    const regulations = Array.from(regulationsSet);

    // Calculate overall score
    const { score, classification } = this.scorer.calculateDataImpactScore(
      sensitiveFields,
      tables,
      reachabilityResult.maxDepth,
      reachabilityResult.functionsTraversed
    );

    return {
      tables,
      sensitiveFields,
      reachableData,
      maxDepth: reachabilityResult.maxDepth,
      attackSurfaceSize: reachabilityResult.functionsTraversed,
      regulations,
      score,
      classification,
    };
  }

  /**
   * Analyze blast radius for a finding
   */
  private analyzeBlastRadius(
    finding: SecurityFinding,
    warnings: string[]
  ): BlastRadius {
    // Find the function containing the vulnerability
    const vulnFunction = this.findContainingFunction(finding.file, finding.line);
    if (!vulnFunction) {
      warnings.push('Could not find function containing vulnerability');
      return this.createEmptyBlastRadius();
    }

    // Find entry points that can reach this vulnerability
    const entryPoints = this.findEntryPointsToFunction(vulnFunction.id);

    // Find affected functions (callers and callees)
    const affectedFunctions = this.findAffectedFunctions(vulnFunction);

    // Calculate lines of code in blast radius
    const linesOfCode = this.calculateLinesOfCode(affectedFunctions);

    // Find related vulnerabilities (other findings in the same call paths)
    // This would require access to all findings - simplified here
    const relatedVulnerabilities: string[] = [];

    // Calculate score
    const { score, classification } = this.scorer.calculateBlastRadiusScore(
      entryPoints,
      affectedFunctions.length,
      linesOfCode
    );

    return {
      entryPoints,
      relatedVulnerabilities,
      affectedFunctions,
      linesOfCode,
      score,
      classification,
    };
  }

  /**
   * Find entry points that can reach a function
   */
  private findEntryPointsToFunction(targetId: string): EntryPointInfo[] {
    const entryPoints: EntryPointInfo[] = [];

    for (const entryPointId of this.graph.entryPoints) {
      const entryFunc = this.graph.functions.get(entryPointId);
      if (!entryFunc) {continue;}

      // BFS to find path from entry point to target
      const path = this.findPath(entryPointId, targetId);
      if (path.length === 0) {continue;}

      entryPoints.push({
        functionId: entryPointId,
        name: entryFunc.qualifiedName,
        file: entryFunc.file,
        line: entryFunc.startLine,
        type: this.classifyEntryPointType(entryFunc),
        isPublic: this.isPublicEntryPoint(entryFunc),
        requiresAuth: this.requiresAuthentication(entryFunc),
        pathToVulnerability: path,
      });
    }

    return entryPoints;
  }

  /**
   * Find path between two functions using BFS
   */
  private findPath(fromId: string, toId: string): CallPathNode[] {
    if (fromId === toId) {
      const func = this.graph.functions.get(fromId);
      if (!func) {return [];}
      return [{
        functionId: fromId,
        functionName: func.qualifiedName,
        file: func.file,
        line: func.startLine,
      }];
    }

    const visited = new Set<string>();
    const queue: Array<{ id: string; path: CallPathNode[] }> = [];

    const fromFunc = this.graph.functions.get(fromId);
    if (!fromFunc) {return [];}

    queue.push({
      id: fromId,
      path: [{
        functionId: fromId,
        functionName: fromFunc.qualifiedName,
        file: fromFunc.file,
        line: fromFunc.startLine,
      }],
    });

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (visited.has(id)) {continue;}
      visited.add(id);

      const func = this.graph.functions.get(id);
      if (!func) {continue;}

      for (const call of func.calls) {
        if (!call.resolved) {continue;}

        for (const candidateId of call.resolvedCandidates) {
          if (candidateId === toId) {
            const targetFunc = this.graph.functions.get(toId);
            if (!targetFunc) {continue;}
            return [
              ...path,
              {
                functionId: toId,
                functionName: targetFunc.qualifiedName,
                file: targetFunc.file,
                line: targetFunc.startLine,
              },
            ];
          }

          if (!visited.has(candidateId)) {
            const candidateFunc = this.graph.functions.get(candidateId);
            if (candidateFunc) {
              queue.push({
                id: candidateId,
                path: [
                  ...path,
                  {
                    functionId: candidateId,
                    functionName: candidateFunc.qualifiedName,
                    file: candidateFunc.file,
                    line: candidateFunc.startLine,
                  },
                ],
              });
            }
          }
        }
      }
    }

    return [];
  }

  /**
   * Find functions affected by a vulnerability
   */
  private findAffectedFunctions(vulnFunction: FunctionNode): AffectedFunction[] {
    const affected: AffectedFunction[] = [];
    const visited = new Set<string>();

    // Add the vulnerable function itself
    affected.push({
      functionId: vulnFunction.id,
      name: vulnFunction.qualifiedName,
      file: vulnFunction.file,
      line: vulnFunction.startLine,
      affectedBy: 'direct',
      distance: 0,
    });
    visited.add(vulnFunction.id);

    // Find callers (functions that call the vulnerable function)
    const callerQueue: Array<{ id: string; distance: number }> = [];
    const vulnCallers = this.getFunctionCallers(vulnFunction.id, vulnFunction.name);
    for (const callSite of vulnCallers) {
      if (!visited.has(callSite.callerId)) {
        callerQueue.push({ id: callSite.callerId, distance: 1 });
      }
    }

    while (callerQueue.length > 0 && affected.length < 100) {
      const { id, distance } = callerQueue.shift()!;
      if (visited.has(id)) {continue;}
      visited.add(id);

      const func = this.graph.functions.get(id);
      if (!func) {continue;}

      affected.push({
        functionId: id,
        name: func.qualifiedName,
        file: func.file,
        line: func.startLine,
        affectedBy: 'caller',
        distance,
      });

      // Add callers of this function (up to distance 3)
      if (distance < 3) {
        const funcCallers = this.getFunctionCallers(id, func.name);
        for (const callSite of funcCallers) {
          if (!visited.has(callSite.callerId)) {
            callerQueue.push({ id: callSite.callerId, distance: distance + 1 });
          }
        }
      }
    }

    // Find callees (functions called by the vulnerable function)
    const calleeQueue: Array<{ id: string; distance: number }> = [];
    for (const call of vulnFunction.calls) {
      if (call.resolved) {
        for (const candidateId of call.resolvedCandidates) {
          if (!visited.has(candidateId)) {
            calleeQueue.push({ id: candidateId, distance: 1 });
          }
        }
      }
    }

    while (calleeQueue.length > 0 && affected.length < 100) {
      const { id, distance } = calleeQueue.shift()!;
      if (visited.has(id)) {continue;}
      visited.add(id);

      const func = this.graph.functions.get(id);
      if (!func) {continue;}

      affected.push({
        functionId: id,
        name: func.qualifiedName,
        file: func.file,
        line: func.startLine,
        affectedBy: 'callee',
        distance,
      });

      // Add callees of this function (up to distance 3)
      if (distance < 3) {
        for (const call of func.calls) {
          if (call.resolved) {
            for (const candidateId of call.resolvedCandidates) {
              if (!visited.has(candidateId)) {
                calleeQueue.push({ id: candidateId, distance: distance + 1 });
              }
            }
          }
        }
      }
    }

    return affected;
  }

  /**
   * Find the function containing a location
   */
  private findContainingFunction(file: string, line: number): FunctionNode | null {
    let best: FunctionNode | null = null;
    let bestSize = Infinity;

    for (const [, func] of this.graph.functions) {
      if (func.file === file && line >= func.startLine && line <= func.endLine) {
        const size = func.endLine - func.startLine;
        if (size < bestSize) {
          best = func;
          bestSize = size;
        }
      }
    }

    return best;
  }

  /**
   * Classify entry point type based on decorators and patterns
   */
  private classifyEntryPointType(func: FunctionNode): EntryPointType {
    const decorators = func.decorators.join(' ');

    for (const pattern of API_DECORATOR_PATTERNS) {
      if (pattern.test(decorators)) {
        return 'api-endpoint';
      }
    }

    if (func.name === 'main' || func.name === '__main__') {
      return 'main';
    }

    if (func.isExported) {
      return 'exported-function';
    }

    return 'exported-function';
  }

  /**
   * Check if entry point is publicly accessible
   */
  private isPublicEntryPoint(func: FunctionNode): boolean {
    const decorators = func.decorators.join(' ').toLowerCase();

    // Check for public API indicators
    if (decorators.includes('public') || decorators.includes('anonymous')) {
      return true;
    }

    // API endpoints are typically public unless marked otherwise
    for (const pattern of API_DECORATOR_PATTERNS) {
      if (pattern.test(func.decorators.join(' '))) {
        return true;
      }
    }

    return func.isExported;
  }

  /**
   * Check if entry point requires authentication
   */
  private requiresAuthentication(func: FunctionNode): boolean {
    const decorators = func.decorators.join(' ').toLowerCase();

    // Check for auth decorators
    const authPatterns = [
      'auth', 'authenticated', 'authorize', 'protected',
      'login_required', 'jwt', 'bearer', 'guard',
    ];

    return authPatterns.some((pattern) => decorators.includes(pattern));
  }

  /**
   * Calculate lines of code in affected functions
   */
  private calculateLinesOfCode(functions: AffectedFunction[]): number {
    let total = 0;

    for (const affected of functions) {
      const func = this.graph.functions.get(affected.functionId);
      if (func) {
        total += func.endLine - func.startLine + 1;
      }
    }

    return total;
  }

  /**
   * Calculate impact score for a single data access
   */
  private calculateAccessImpactScore(
    access: DataAccessPoint,
    sensitiveFields: SensitiveField[]
  ): number {
    if (sensitiveFields.length === 0) {
      return 10; // Base score for non-sensitive data
    }

    // Use the highest sensitivity score
    let maxScore = 0;
    for (const field of sensitiveFields) {
      const profile = this.classifier.classify(field.field, field.table ?? undefined);
      maxScore = Math.max(maxScore, profile.baseScore);
    }

    // Adjust for operation type
    const operationMultiplier = access.operation === 'write' || access.operation === 'delete'
      ? 1.0
      : 0.8;

    return Math.round(maxScore * operationMultiplier);
  }

  /**
   * Build impact rationale string
   */
  private buildImpactRationale(
    access: DataAccessPoint,
    sensitiveFields: SensitiveField[]
  ): string {
    if (sensitiveFields.length === 0) {
      return `${access.operation} access to ${access.table}`;
    }

    const types = [...new Set(sensitiveFields.map((f) => f.sensitivityType))];
    return `${access.operation} access to ${types.join(', ')} data in ${access.table}`;
  }

  /**
   * Calculate overall confidence in enrichment
   */
  private calculateConfidence(dataImpact: DataImpact, blastRadius: BlastRadius): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence if we found data access
    if (dataImpact.reachableData.length > 0) {
      confidence += 0.2;
    }

    // Higher confidence if we found entry points
    if (blastRadius.entryPoints.length > 0) {
      confidence += 0.2;
    }

    // Higher confidence if call graph has good resolution
    const resolutionRate = this.graph.stats.resolvedCallSites /
      Math.max(1, this.graph.stats.totalCallSites);
    confidence += resolutionRate * 0.1;

    return Math.min(1, confidence);
  }

  /**
   * Build summary statistics for batch enrichment
   */
  private buildSummary(findings: EnrichedFinding[]): EnrichmentSummary {
    const byPriority: Record<PriorityTier, number> = {
      P0: 0, P1: 0, P2: 0, P3: 0, P4: 0,
    };
    const byImpact: Record<ImpactClassification, number> = {
      catastrophic: 0, severe: 0, significant: 0, moderate: 0, minimal: 0, none: 0,
    };
    const byCategory: Record<FindingCategory, number> = {
      injection: 0, 'broken-auth': 0, 'sensitive-exposure': 0, xxe: 0,
      'broken-access': 0, misconfig: 0, xss: 0, deserialization: 0,
      components: 0, logging: 0, ssrf: 0, other: 0,
    };

    const sensitiveFieldsSet = new Set<string>();
    const tablesSet = new Set<string>();
    const regulationsSet = new Set<DataRegulation>();

    for (const finding of findings) {
      byPriority[finding.priority.tier]++;
      byImpact[finding.dataImpact.classification]++;
      byCategory[finding.finding.category]++;

      for (const field of finding.dataImpact.sensitiveFields) {
        sensitiveFieldsSet.add(`${field.field.table}.${field.field.field}`);
      }
      for (const table of finding.dataImpact.tables) {
        tablesSet.add(table);
      }
      for (const reg of finding.dataImpact.regulations) {
        regulationsSet.add(reg);
      }
    }

    // Get top priority findings
    const topPriority = findings
      .filter((f) => f.priority.tier === 'P0' || f.priority.tier === 'P1')
      .sort((a, b) => b.priority.overall - a.priority.overall)
      .slice(0, 10);

    return {
      totalFindings: findings.length,
      byPriority,
      byImpact,
      byCategory,
      sensitiveFieldsAtRisk: sensitiveFieldsSet.size,
      tablesAtRisk: tablesSet.size,
      regulationsImplicated: Array.from(regulationsSet),
      topPriority,
    };
  }

  /**
   * Get base severity score
   */
  private getBaseSeverityScore(severity: SecurityFinding['severity']): number {
    const scores = { critical: 90, high: 70, medium: 50, low: 25, info: 10 };
    return scores[severity];
  }

  /**
   * Get base priority tier from severity
   */
  private getBaseTier(severity: SecurityFinding['severity']): PriorityTier {
    const tiers: Record<SecurityFinding['severity'], PriorityTier> = {
      critical: 'P1', high: 'P2', medium: 'P3', low: 'P4', info: 'P4',
    };
    return tiers[severity];
  }

  /**
   * Create empty data impact
   */
  private createEmptyDataImpact(): DataImpact {
    return {
      tables: [],
      sensitiveFields: [],
      reachableData: [],
      maxDepth: 0,
      attackSurfaceSize: 0,
      regulations: [],
      score: 0,
      classification: 'none',
    };
  }

  /**
   * Create empty blast radius
   */
  private createEmptyBlastRadius(): BlastRadius {
    return {
      entryPoints: [],
      relatedVulnerabilities: [],
      affectedFunctions: [],
      linesOfCode: 0,
      score: 0,
      classification: 'contained',
    };
  }

  /**
   * Create empty remediation
   */
  private createEmptyRemediation() {
    return {
      summary: 'Review and address the security finding',
      steps: [],
      codeExamples: [],
      effort: {
        time: 'hours' as const,
        complexity: 'moderate' as const,
        regressionRisk: 'medium' as const,
      },
      references: [],
    };
  }
}

/**
 * Create a new enrichment engine
 */
export function createEnrichmentEngine(
  graph: CallGraph,
  dataAccessPoints?: DataAccessPoint[],
  sensitiveFields?: SensitiveField[]
): EnrichmentEngine {
  return new EnrichmentEngine(graph, dataAccessPoints, sensitiveFields);
}
