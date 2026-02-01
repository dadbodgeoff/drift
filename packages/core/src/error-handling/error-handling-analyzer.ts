/**
 * Error Handling Analyzer
 *
 * Analyzes error handling patterns, boundaries, and propagation chains.
 * Detects gaps in error handling coverage.
 */

import type {
  ErrorHandlingTopology,
  ErrorHandlingProfile,
  ErrorBoundary,
  UnhandledErrorPath,
  ErrorPropagationChain,
  ErrorHandlingMetrics,
  ErrorHandlingSummary,
  FunctionErrorAnalysis,
  ErrorHandlingGap,
  ErrorHandlingOptions,
  GapDetectionOptions,
  BoundaryAnalysisOptions,
  CatchClause,
  AsyncErrorHandling,
  ErrorSeverity,
  ErrorHandlingQuality,
} from './types.js';
import type { CallGraph, FunctionNode } from '../call-graph/types.js';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  getCallGraphCallers,
} from '../native/index.js';

// ============================================================================
// Analyzer
// ============================================================================

export class ErrorHandlingAnalyzer {
  private topology: ErrorHandlingTopology | null = null;
  private callGraph: CallGraph | null = null;
  private options: ErrorHandlingOptions;
  private useNativeQueries: boolean = false;
  private projectRoot: string | undefined;

  constructor(options: ErrorHandlingOptions) {
    this.options = {
      includeAsync: true,
      detectFrameworkBoundaries: true,
      maxPropagationDepth: 20,
      ...options,
    };
  }

  /**
   * Set the call graph for analysis
   */
  setCallGraph(callGraph: CallGraph): void {
    this.callGraph = callGraph;
    
    // Check if we should use native SQLite queries
    this.projectRoot = callGraph.projectRoot;
    const isSqliteMode = (callGraph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
    this.useNativeQueries = isSqliteMode && 
                            !!this.projectRoot && 
                            isNativeAvailable() && 
                            isCallGraphAvailable(this.projectRoot);
  }

  /**
   * Get callers for a function (using native query if available)
   */
  private getFunctionCallers(funcId: string, funcName: string): Array<{ callerId: string; line: number }> {
    const func = this.callGraph?.functions.get(funcId);
    
    // If calledBy is populated, use it
    if (func && func.calledBy.length > 0) {
      return func.calledBy;
    }
    
    // If using native queries, check SQLite
    if (this.useNativeQueries && this.projectRoot) {
      const callers = getCallGraphCallers(this.projectRoot, funcName);
      return callers.map(c => ({ callerId: c.callerId, line: c.line }));
    }
    
    return func?.calledBy ?? [];
  }

  /**
   * Build the error handling topology
   */
  build(): ErrorHandlingTopology {
    if (!this.callGraph) {
      throw new Error('Call graph required. Call setCallGraph() first.');
    }

    const functions = new Map<string, ErrorHandlingProfile>();
    const boundaries: ErrorBoundary[] = [];
    const propagationChains: ErrorPropagationChain[] = [];

    // Phase 1: Analyze each function's error handling
    for (const [funcId, func] of this.callGraph.functions) {
      const profile = this.analyzeFunction(funcId, func);
      functions.set(funcId, profile);

      // Detect boundaries
      if (profile.hasTryCatch && profile.catchClauses.length > 0) {
        const boundary = this.detectBoundary(funcId, func, profile);
        if (boundary) {
          boundaries.push(boundary);
        }
      }
    }

    // Phase 2: Build propagation chains for throwing functions
    for (const [funcId, profile] of functions) {
      if (profile.canThrow) {
        const chain = this.traceErrorPropagation(funcId, functions);
        if (chain) {
          propagationChains.push(chain);
        }
      }
    }

    // Phase 3: Find unhandled paths
    const unhandledPaths = this.findUnhandledPaths(propagationChains, functions);

    this.topology = {
      functions,
      boundaries,
      unhandledPaths,
      propagationChains,
      generatedAt: new Date().toISOString(),
      projectRoot: this.options.rootDir,
    };

    return this.topology;
  }

  /**
   * Get the built topology
   */
  getTopology(): ErrorHandlingTopology | null {
    return this.topology;
  }

  /**
   * Get aggregate metrics
   */
  getMetrics(): ErrorHandlingMetrics | null {
    if (!this.topology) {return null;}

    const functions = Array.from(this.topology.functions.values());
    const totalFunctions = functions.length;
    const functionsWithTryCatch = functions.filter(f => f.hasTryCatch).length;
    const functionsThatThrow = functions.filter(f => f.canThrow).length;
    
    const swallowedErrorCount = functions.filter(f => 
      f.catchClauses.some(c => c.action === 'swallow')
    ).length;

    const unhandledAsyncCount = functions.filter(f => 
      f.asyncHandling?.hasUnhandledPromises
    ).length;

    const avgQualityScore = totalFunctions > 0
      ? Math.round(functions.reduce((sum, f) => sum + f.qualityScore, 0) / totalFunctions)
      : 0;

    const unhandledBySeverity: Record<ErrorSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const path of this.topology.unhandledPaths) {
      unhandledBySeverity[path.severity]++;
    }

    const frameworkBoundaries = this.topology.boundaries.filter(b => b.isFrameworkBoundary).length;

    return {
      totalFunctions,
      functionsWithTryCatch,
      functionsThatThrow,
      boundaryCount: this.topology.boundaries.length,
      unhandledCount: this.topology.unhandledPaths.length,
      unhandledBySeverity,
      avgQualityScore,
      swallowedErrorCount,
      unhandledAsyncCount,
      frameworkBoundaries,
    };
  }

  /**
   * Get summary for display
   */
  getSummary(): ErrorHandlingSummary | null {
    const metrics = this.getMetrics();
    if (!metrics || !this.topology) {return null;}

    const coveragePercent = metrics.totalFunctions > 0
      ? Math.round((metrics.functionsWithTryCatch / metrics.totalFunctions) * 100)
      : 0;

    const qualityDistribution: Record<ErrorHandlingQuality, number> = {
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0,
    };

    for (const func of this.topology.functions.values()) {
      const quality = this.scoreToQuality(func.qualityScore);
      qualityDistribution[quality]++;
    }

    const topIssues: ErrorHandlingSummary['topIssues'] = [];
    
    if (metrics.swallowedErrorCount > 0) {
      topIssues.push({
        type: 'swallowed',
        count: metrics.swallowedErrorCount,
        severity: 'high',
      });
    }
    if (metrics.unhandledAsyncCount > 0) {
      topIssues.push({
        type: 'unhandled-async',
        count: metrics.unhandledAsyncCount,
        severity: 'high',
      });
    }
    if (metrics.unhandledBySeverity.critical > 0) {
      topIssues.push({
        type: 'no-boundary',
        count: metrics.unhandledBySeverity.critical,
        severity: 'critical',
      });
    }

    // Sort by severity
    const severityOrder: Record<ErrorSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    topIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      totalFunctions: metrics.totalFunctions,
      coveragePercent,
      unhandledPaths: metrics.unhandledCount,
      criticalUnhandled: metrics.unhandledBySeverity.critical,
      avgQuality: metrics.avgQualityScore,
      qualityDistribution,
      topIssues: topIssues.slice(0, 5),
    };
  }

  /**
   * Analyze a specific function
   */
  analyzeFunction(funcId: string, func?: FunctionNode): ErrorHandlingProfile {
    const funcNode = func ?? this.callGraph?.functions.get(funcId);
    if (!funcNode) {
      throw new Error(`Function not found: ${funcId}`);
    }

    // Detect error handling constructs from function metadata
    const hasTryCatch = this.detectTryCatch(funcNode);
    const canThrow = this.detectThrows(funcNode);
    const throwLocations = this.findThrowLocations(funcNode);
    const catchClauses = this.extractCatchClauses(funcNode);
    const rethrows = catchClauses.some(c => c.action === 'rethrow');
    const isAsync = this.isAsyncFunction(funcNode);
    const asyncHandling = isAsync && this.options.includeAsync
      ? this.analyzeAsyncHandling(funcNode)
      : null;

    const qualityScore = this.calculateQualityScore({
      hasTryCatch,
      canThrow,
      catchClauses,
      rethrows,
      asyncHandling,
      isAsync,
    });

    return {
      functionId: funcId,
      file: funcNode.file,
      name: funcNode.name,
      qualifiedName: funcNode.className 
        ? `${funcNode.className}.${funcNode.name}` 
        : funcNode.name,
      line: funcNode.startLine,
      hasTryCatch,
      canThrow,
      throwLocations,
      catchClauses,
      rethrows,
      asyncHandling,
      isAsync,
      qualityScore,
    };
  }

  /**
   * Get detailed analysis for a function
   */
  getFunctionAnalysis(funcId: string): FunctionErrorAnalysis | null {
    if (!this.topology || !this.callGraph) {return null;}

    const profile = this.topology.functions.get(funcId);
    if (!profile) {return null;}

    const func = this.callGraph.functions.get(funcId);
    if (!func) {return null;}

    // Find incoming errors (from callees)
    const incomingErrors: FunctionErrorAnalysis['incomingErrors'] = [];
    for (const call of func.calls) {
      for (const candidate of call.resolvedCandidates) {
        const calleeProfile = this.topology.functions.get(candidate);
        if (calleeProfile?.canThrow) {
          incomingErrors.push({
            from: candidate,
            errorType: 'Error', // Would need AST analysis for specific types
          });
        }
      }
    }

    // Find outgoing errors (to callers)
    const outgoingErrors: FunctionErrorAnalysis['outgoingErrors'] = [];
    const funcCallers = this.getFunctionCallers(funcId, func.name);
    for (const caller of funcCallers) {
      const callerProfile = this.topology.functions.get(caller.callerId);
      outgoingErrors.push({
        to: caller.callerId,
        caught: callerProfile?.hasTryCatch ?? false,
      });
    }

    // Check if protected by boundary
    const foundBoundary = this.topology.boundaries.find(b => 
      b.catchesFrom.includes(funcId)
    );

    // Find issues
    const issues: FunctionErrorAnalysis['issues'] = [];
    
    if (profile.canThrow && !profile.hasTryCatch && !foundBoundary) {
      issues.push({
        type: 'unprotected-throw',
        message: 'Function throws but has no error handling',
        severity: 'high',
      });
    }

    if (profile.catchClauses.some(c => c.action === 'swallow')) {
      const swallowLine = profile.catchClauses.find(c => c.action === 'swallow')?.line;
      issues.push({
        type: 'swallowed-error',
        message: 'Error is caught but swallowed (empty catch block)',
        severity: 'medium',
        ...(swallowLine !== undefined && { line: swallowLine }),
      });
    }

    if (profile.asyncHandling?.hasUnhandledPromises) {
      issues.push({
        type: 'unhandled-promise',
        message: 'Async function has unhandled promise rejections',
        severity: 'high',
      });
    }

    if (profile.catchClauses.some(c => c.errorType === 'any')) {
      issues.push({
        type: 'bare-catch',
        message: 'Catch clause catches all errors without type checking',
        severity: 'low',
      });
    }

    // Generate suggestions
    const suggestions: string[] = [];
    
    if (issues.some(i => i.type === 'unprotected-throw')) {
      suggestions.push('Add try/catch block or ensure caller handles errors');
    }
    if (issues.some(i => i.type === 'swallowed-error')) {
      suggestions.push('Log the error or rethrow it instead of swallowing');
    }
    if (issues.some(i => i.type === 'unhandled-promise')) {
      suggestions.push('Add .catch() to promise chains or use try/catch with await');
    }

    const result: FunctionErrorAnalysis = {
      profile,
      incomingErrors,
      outgoingErrors,
      isProtected: !!foundBoundary,
      issues,
      suggestions,
    };

    if (foundBoundary) {
      result.protectingBoundary = foundBoundary;
    }

    return result;
  }

  /**
   * Find error handling gaps
   */
  getGaps(options: GapDetectionOptions = {}): ErrorHandlingGap[] {
    if (!this.topology) {return [];}

    const { minSeverity = 'low', limit = 20, includeSuggestions = true, files } = options;
    const gaps: ErrorHandlingGap[] = [];

    const severityOrder: Record<ErrorSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const minOrder = severityOrder[minSeverity];

    for (const [funcId, profile] of this.topology.functions) {
      // Filter by files if specified
      if (files && !files.some(f => profile.file.includes(f))) {continue;}

      // Check for various gaps
      if (profile.canThrow && !profile.hasTryCatch) {
        const severity = this.calculateGapSeverity(profile, 'no-try-catch');
        if (severityOrder[severity] <= minOrder) {
          gaps.push({
            functionId: funcId,
            file: profile.file,
            name: profile.qualifiedName,
            line: profile.line,
            gapType: 'no-try-catch',
            severity,
            description: 'Function can throw but has no error handling',
            suggestion: includeSuggestions 
              ? 'Add try/catch block to handle potential errors'
              : '',
            riskScore: this.calculateRiskScore(profile, 'no-try-catch'),
          });
        }
      }

      if (profile.catchClauses.some(c => c.action === 'swallow')) {
        const severity = this.calculateGapSeverity(profile, 'swallowed-error');
        if (severityOrder[severity] <= minOrder) {
          gaps.push({
            functionId: funcId,
            file: profile.file,
            name: profile.qualifiedName,
            line: profile.catchClauses.find(c => c.action === 'swallow')?.line ?? profile.line,
            gapType: 'swallowed-error',
            severity,
            description: 'Error is caught but not handled (empty catch block)',
            suggestion: includeSuggestions
              ? 'Log the error or rethrow it'
              : '',
            riskScore: this.calculateRiskScore(profile, 'swallowed-error'),
          });
        }
      }

      if (profile.asyncHandling?.hasUnhandledPromises) {
        const severity = this.calculateGapSeverity(profile, 'unhandled-async');
        if (severityOrder[severity] <= minOrder) {
          gaps.push({
            functionId: funcId,
            file: profile.file,
            name: profile.qualifiedName,
            line: profile.asyncHandling.unhandledLocations[0]?.line ?? profile.line,
            gapType: 'unhandled-async',
            severity,
            description: 'Async function has unhandled promise rejections',
            suggestion: includeSuggestions
              ? 'Add .catch() or wrap await in try/catch'
              : '',
            riskScore: this.calculateRiskScore(profile, 'unhandled-async'),
          });
        }
      }

      if (profile.catchClauses.some(c => c.errorType === 'any' && c.action !== 'rethrow')) {
        const severity: ErrorSeverity = 'low';
        if (severityOrder[severity] <= minOrder) {
          gaps.push({
            functionId: funcId,
            file: profile.file,
            name: profile.qualifiedName,
            line: profile.catchClauses.find(c => c.errorType === 'any')?.line ?? profile.line,
            gapType: 'bare-catch',
            severity,
            description: 'Catch clause catches all errors without type checking',
            suggestion: includeSuggestions
              ? 'Consider catching specific error types'
              : '',
            riskScore: this.calculateRiskScore(profile, 'bare-catch'),
          });
        }
      }
    }

    // Sort by risk score descending
    gaps.sort((a, b) => b.riskScore - a.riskScore);

    return gaps.slice(0, limit);
  }

  /**
   * Get error boundaries
   */
  getBoundaries(options: BoundaryAnalysisOptions = {}): ErrorBoundary[] {
    if (!this.topology) {return [];}

    let boundaries = this.topology.boundaries;

    if (!options.includeFramework) {
      boundaries = boundaries.filter(b => !b.isFrameworkBoundary);
    }

    if (options.minCoverage !== undefined) {
      boundaries = boundaries.filter(b => b.coverage >= options.minCoverage!);
    }

    return boundaries.sort((a, b) => b.coverage - a.coverage);
  }

  /**
   * Get unhandled error paths
   */
  getUnhandledPaths(minSeverity: ErrorSeverity = 'low'): UnhandledErrorPath[] {
    if (!this.topology) {return [];}

    const severityOrder: Record<ErrorSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const minOrder = severityOrder[minSeverity];

    return this.topology.unhandledPaths
      .filter(p => severityOrder[p.severity] <= minOrder)
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }


  // ============================================================================
  // Private Helpers
  // ============================================================================

  private detectTryCatch(func: FunctionNode): boolean {
    // Heuristic: check if function body contains try/catch patterns
    // In a full implementation, this would use AST analysis
    // For now, we use metadata from the call graph if available
    return (func as any).hasTryCatch ?? false;
  }

  private detectThrows(func: FunctionNode): boolean {
    // Heuristic: check if function can throw
    // Functions that call other throwing functions can also throw
    return (func as any).canThrow ?? 
           func.calls.length > 0; // Conservative: assume any function with calls can throw
  }

  private findThrowLocations(func: FunctionNode): number[] {
    // Would need AST analysis for precise locations
    return (func as any).throwLocations ?? [];
  }

  private extractCatchClauses(func: FunctionNode): CatchClause[] {
    // Would need AST analysis for precise extraction
    // Return empty for now - real implementation would parse AST
    return (func as any).catchClauses ?? [];
  }

  private isAsyncFunction(func: FunctionNode): boolean {
    if ((func as any).isAsync) {return true;}
    if (func.name.includes('async')) {return true;}
    return func.returnType?.includes('Promise') ?? false;
  }

  private analyzeAsyncHandling(_func: FunctionNode): AsyncErrorHandling {
    // Would need AST analysis for precise detection
    return {
      hasCatch: false,
      hasAsyncTryCatch: false,
      hasUnhandledPromises: false,
      unhandledLocations: [],
    };
  }

  private calculateQualityScore(profile: Partial<ErrorHandlingProfile>): number {
    let score = 50; // Base score

    // Positive factors
    if (profile.hasTryCatch) {score += 20;}
    if (profile.catchClauses?.some(c => c.action === 'recover')) {score += 15;}
    if (profile.catchClauses?.some(c => c.action === 'transform')) {score += 10;}
    if (profile.catchClauses?.some(c => c.preservesError)) {score += 5;}
    if (profile.asyncHandling?.hasAsyncTryCatch) {score += 10;}
    if (profile.asyncHandling?.hasCatch) {score += 5;}

    // Negative factors
    if (profile.canThrow && !profile.hasTryCatch) {score -= 20;}
    if (profile.catchClauses?.some(c => c.action === 'swallow')) {score -= 25;}
    if (profile.catchClauses?.some(c => c.errorType === 'any')) {score -= 5;}
    if (profile.asyncHandling?.hasUnhandledPromises) {score -= 20;}

    return Math.max(0, Math.min(100, score));
  }

  private scoreToQuality(score: number): ErrorHandlingQuality {
    if (score >= 80) {return 'excellent';}
    if (score >= 60) {return 'good';}
    if (score >= 40) {return 'fair';}
    return 'poor';
  }

  private detectBoundary(
    funcId: string, 
    func: FunctionNode, 
    profile: ErrorHandlingProfile
  ): ErrorBoundary | null {
    if (!this.callGraph) {return null;}

    // Find what this function catches from
    const catchesFrom: string[] = [];
    for (const call of func.calls) {
      for (const candidate of call.resolvedCandidates) {
        const calleeProfile = this.topology?.functions.get(candidate);
        if (calleeProfile?.canThrow) {
          catchesFrom.push(candidate);
        }
      }
    }

    if (catchesFrom.length === 0) {return null;}

    // Detect framework boundaries
    const isFrameworkBoundary = this.isFrameworkBoundary(func);
    const frameworkType = this.detectFrameworkType(func);

    // Calculate coverage
    const totalCallees = func.calls.reduce((sum, c) => sum + c.resolvedCandidates.length, 0);
    const coverage = totalCallees > 0 ? (catchesFrom.length / totalCallees) * 100 : 0;

    const boundary: ErrorBoundary = {
      functionId: funcId,
      file: func.file,
      name: profile.qualifiedName,
      catchesFrom,
      handledTypes: profile.catchClauses.map(c => c.errorType),
      isFrameworkBoundary,
      coverage: Math.round(coverage),
      line: profile.catchClauses[0]?.line ?? func.startLine,
    };

    if (frameworkType) {
      boundary.frameworkType = frameworkType;
    }

    return boundary;
  }

  private isFrameworkBoundary(func: FunctionNode): boolean {
    const name = func.name.toLowerCase();
    const className = func.className?.toLowerCase() ?? '';
    
    // React error boundaries
    if (name === 'componentdidcatch' || className.includes('errorboundary')) {return true;}
    
    // Express/Koa middleware
    if (func.parameters?.length === 4) {return true;} // (err, req, res, next)
    
    // NestJS exception filters
    if (className.includes('filter') && name === 'catch') {return true;}
    
    // Spring exception handlers
    if ((func as any).annotations?.some((a: string) => 
      a.includes('ExceptionHandler') || a.includes('ControllerAdvice')
    )) {return true;}

    return false;
  }

  private detectFrameworkType(func: FunctionNode): ErrorBoundary['frameworkType'] | undefined {
    const name = func.name.toLowerCase();
    const className = func.className?.toLowerCase() ?? '';

    if (name === 'componentdidcatch' || className.includes('errorboundary')) {
      return 'react-error-boundary';
    }
    if (func.parameters?.length === 4) {
      return 'express-middleware';
    }
    if (className.includes('filter') && name === 'catch') {
      return 'nestjs-filter';
    }
    
    return undefined;
  }

  private traceErrorPropagation(
    throwerId: string,
    functions: Map<string, ErrorHandlingProfile>
  ): ErrorPropagationChain | null {
    if (!this.callGraph) {return null;}

    const path: string[] = [throwerId];
    let current = throwerId;
    let depth = 0;
    const maxDepth = this.options.maxPropagationDepth ?? 20;

    while (depth < maxDepth) {
      const func = this.callGraph.functions.get(current);
      if (!func) {
        // No more callers - error escapes
        return {
          source: { functionId: throwerId, throwLine: functions.get(throwerId)?.line ?? 0 },
          sink: null,
          propagationPath: path,
          transformations: [],
          depth,
        };
      }
      
      const funcCallers = this.getFunctionCallers(current, func.name);
      if (funcCallers.length === 0) {
        // No more callers - error escapes
        return {
          source: { functionId: throwerId, throwLine: functions.get(throwerId)?.line ?? 0 },
          sink: null,
          propagationPath: path,
          transformations: [],
          depth,
        };
      }

      // Check if any caller catches
      for (const caller of funcCallers) {
        const callerProfile = functions.get(caller.callerId);
        if (callerProfile?.hasTryCatch) {
          // Found a boundary
          return {
            source: { functionId: throwerId, throwLine: functions.get(throwerId)?.line ?? 0 },
            sink: { 
              functionId: caller.callerId, 
              catchLine: callerProfile.catchClauses[0]?.line ?? callerProfile.line 
            },
            propagationPath: path,
            transformations: [],
            depth,
          };
        }
      }

      // Move to first caller (simplified - real impl would explore all paths)
      const nextCaller = funcCallers[0]?.callerId;
      if (!nextCaller || path.includes(nextCaller)) {break;} // Avoid cycles
      
      path.push(nextCaller);
      current = nextCaller;
      depth++;
    }

    return null;
  }

  private findUnhandledPaths(
    chains: ErrorPropagationChain[],
    functions: Map<string, ErrorHandlingProfile>
  ): UnhandledErrorPath[] {
    const unhandled: UnhandledErrorPath[] = [];

    for (const chain of chains) {
      if (chain.sink === null) {
        // This error escapes without being caught
        const sourceProfile = functions.get(chain.source.functionId);
        const entryPoint = chain.propagationPath[chain.propagationPath.length - 1] ?? chain.source.functionId;
        const entryProfile = functions.get(entryPoint);

        const severity = this.calculatePathSeverity(entryProfile);

        unhandled.push({
          entryPoint,
          path: chain.propagationPath,
          errorType: 'Error', // Would need AST for specific type
          severity,
          suggestedBoundary: this.suggestBoundaryLocation(chain, functions),
          reason: `Error from ${sourceProfile?.qualifiedName ?? chain.source.functionId} escapes to ${entryProfile?.qualifiedName ?? entryPoint}`,
        });
      }
    }

    return unhandled;
  }

  private calculatePathSeverity(entryProfile?: ErrorHandlingProfile): ErrorSeverity {
    if (!entryProfile) {return 'medium';}

    // Entry points and exported functions are more critical
    const func = this.callGraph?.functions.get(entryProfile.functionId);
    if (func?.isExported) {return 'critical';}
    // Check if file is an entry point
    if (this.callGraph?.entryPoints.includes(entryProfile.file)) {return 'critical';}

    return 'medium';
  }

  private suggestBoundaryLocation(
    chain: ErrorPropagationChain,
    _functions: Map<string, ErrorHandlingProfile>
  ): string {
    // Suggest adding error handling at the middle of the chain
    const midIndex = Math.floor(chain.propagationPath.length / 2);
    return chain.propagationPath[midIndex] ?? chain.source.functionId;
  }

  private calculateGapSeverity(
    profile: ErrorHandlingProfile,
    gapType: string
  ): ErrorSeverity {
    const func = this.callGraph?.functions.get(profile.functionId);
    
    // Entry points and exported functions are more critical
    const isEntryPointFile = this.callGraph?.entryPoints.includes(profile.file) ?? false;
    if (func?.isExported || isEntryPointFile) {
      return gapType === 'swallowed-error' ? 'high' : 'critical';
    }

    switch (gapType) {
      case 'no-try-catch':
        return profile.canThrow ? 'high' : 'medium';
      case 'swallowed-error':
        return 'high';
      case 'unhandled-async':
        return 'high';
      case 'bare-catch':
        return 'low';
      default:
        return 'medium';
    }
  }

  private calculateRiskScore(
    profile: ErrorHandlingProfile,
    gapType: string
  ): number {
    let score = 50;

    // Gap type weights
    switch (gapType) {
      case 'no-try-catch':
        score += 20;
        break;
      case 'swallowed-error':
        score += 30;
        break;
      case 'unhandled-async':
        score += 25;
        break;
      case 'bare-catch':
        score += 5;
        break;
    }

    // Function importance
    const func = this.callGraph?.functions.get(profile.functionId);
    const isEntryPointFile = this.callGraph?.entryPoints.includes(profile.file) ?? false;
    if (func?.isExported) {score += 15;}
    if (isEntryPointFile) {score += 20;}
    if ((func?.calledBy.length ?? 0) > 5) {score += 10;}

    return Math.min(100, score);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createErrorHandlingAnalyzer(options: ErrorHandlingOptions): ErrorHandlingAnalyzer {
  return new ErrorHandlingAnalyzer(options);
}
