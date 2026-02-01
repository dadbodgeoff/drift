/**
 * Impact Analyzer
 *
 * Answers: "If I change this code, what else is affected?"
 * 
 * Uses reverse call graph traversal to find:
 * - Direct callers (immediate impact)
 * - Transitive callers (ripple effect)
 * - Affected entry points (user-facing impact)
 * - Sensitive data paths affected (security impact)
 */

import type { DataAccessPoint } from '../../boundaries/types.js';
import type {
  CallGraph,
  FunctionNode,
  CallPathNode,
} from '../types.js';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  getCallGraphCallers,
  type CallerInfo,
} from '../../native/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Risk level for impact assessment
 */
export type ImpactRisk = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single affected function with context
 */
export interface AffectedFunction {
  /** Function ID */
  id: string;
  /** Function name */
  name: string;
  /** Qualified name */
  qualifiedName: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** How many hops from the changed code */
  depth: number;
  /** Is this an entry point? */
  isEntryPoint: boolean;
  /** Does this function access sensitive data? */
  accessesSensitiveData: boolean;
  /** Call path from this function to the changed code */
  pathToChange: CallPathNode[];
}

/**
 * Sensitive data path that could be affected
 */
export interface AffectedDataPath {
  /** The data being accessed */
  table: string;
  /** Fields accessed */
  fields: string[];
  /** Operation type */
  operation: 'read' | 'write' | 'delete' | 'unknown';
  /** Entry point that reaches this data through the changed code */
  entryPoint: string;
  /** Full path: entry → changed code → data */
  fullPath: CallPathNode[];
  /** Sensitivity classification */
  sensitivity: 'credentials' | 'financial' | 'health' | 'pii' | 'unknown';
}

/**
 * Complete impact analysis result
 */
export interface ImpactAnalysisResult {
  /** What was analyzed */
  target: {
    type: 'file' | 'function';
    file: string;
    functionId?: string;
    functionName?: string;
  };
  /** Overall risk assessment */
  risk: ImpactRisk;
  /** Risk score (0-100) */
  riskScore: number;
  /** Summary statistics */
  summary: {
    directCallers: number;
    transitiveCallers: number;
    affectedEntryPoints: number;
    affectedDataPaths: number;
    maxDepth: number;
  };
  /** All affected functions */
  affected: AffectedFunction[];
  /** Entry points that are affected */
  entryPoints: AffectedFunction[];
  /** Sensitive data paths affected */
  sensitiveDataPaths: AffectedDataPath[];
  /** Functions in the changed file/function */
  changedFunctions: string[];
}

/**
 * Options for impact analysis
 */
export interface ImpactAnalysisOptions {
  /** Maximum depth to traverse (default: unlimited) */
  maxDepth?: number;
  /** Include functions with no callers */
  includeOrphans?: boolean;
}

// ============================================================================
// Impact Analyzer
// ============================================================================

/**
 * Analyzes the impact of code changes
 */
export class ImpactAnalyzer {
  private graph: CallGraph;
  private entryPointSet: Set<string>;

  constructor(graph: CallGraph) {
    this.graph = graph;
    this.entryPointSet = new Set(graph.entryPoints);
  }

  /**
   * Analyze impact of changing a file
   */
  analyzeFile(file: string, options: ImpactAnalysisOptions = {}): ImpactAnalysisResult {
    // Find all functions in this file
    const functionsInFile: FunctionNode[] = [];
    for (const [, func] of this.graph.functions) {
      if (func.file === file) {
        functionsInFile.push(func);
      }
    }

    if (functionsInFile.length === 0) {
      return this.createEmptyResult({ type: 'file', file });
    }

    // Analyze impact of all functions in the file
    return this.analyzeMultipleFunctions(
      functionsInFile.map(f => f.id),
      { type: 'file', file },
      options
    );
  }

  /**
   * Analyze impact of changing a specific function
   */
  analyzeFunction(functionId: string, options: ImpactAnalysisOptions = {}): ImpactAnalysisResult {
    const func = this.graph.functions.get(functionId);
    if (!func) {
      return this.createEmptyResult({ type: 'function', file: '', functionId });
    }

    return this.analyzeMultipleFunctions(
      [functionId],
      { type: 'function', file: func.file, functionId, functionName: func.qualifiedName },
      options
    );
  }

  /**
   * Find function by name and analyze it
   */
  analyzeFunctionByName(name: string, options: ImpactAnalysisOptions = {}): ImpactAnalysisResult {
    // Check if we can use native SQLite queries (more accurate for SQLite-backed graphs)
    const projectRoot = this.graph.projectRoot;
    const isSqliteMode = (this.graph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
    
    if (isSqliteMode && projectRoot && isNativeAvailable() && isCallGraphAvailable(projectRoot)) {
      return this.analyzeWithNativeQueries(name, options);
    }
    
    // Fall back to in-memory graph analysis
    // Find function by name
    for (const [id, func] of this.graph.functions) {
      if (func.name === name || func.qualifiedName === name) {
        return this.analyzeFunction(id, options);
      }
    }

    return this.createEmptyResult({ type: 'function', file: '', functionName: name });
  }

  /**
   * Analyze using native SQLite queries (more accurate for SQLite-backed graphs)
   */
  private analyzeWithNativeQueries(name: string, options: ImpactAnalysisOptions = {}): ImpactAnalysisResult {
    const projectRoot = this.graph.projectRoot!;
    const { maxDepth = 10 } = options;
    
    const affected = new Map<string, AffectedFunction>();
    const visited = new Set<string>();
    
    // Get direct callers from SQLite
    const directCallers = getCallGraphCallers(projectRoot, name);
    
    if (directCallers.length === 0) {
      return this.createEmptyResult({ type: 'function', file: '', functionName: name });
    }
    
    // BFS to find transitive callers
    const queue: Array<{ caller: CallerInfo; depth: number; path: CallPathNode[] }> = [];
    
    // Initialize with direct callers
    for (const caller of directCallers) {
      const pathNode: CallPathNode = {
        functionId: caller.callerId,
        functionName: caller.callerName,
        file: caller.callerFile,
        line: caller.line,
      };
      
      queue.push({
        caller,
        depth: 1,
        path: [pathNode],
      });
    }
    
    // BFS traversal
    while (queue.length > 0) {
      const { caller, depth, path } = queue.shift()!;
      
      if (visited.has(caller.callerId) || depth > maxDepth) {
        continue;
      }
      visited.add(caller.callerId);
      
      // Check if this is an entry point
      const isEntryPoint = this.entryPointSet.has(caller.callerId);
      
      // Record this affected function
      affected.set(caller.callerId, {
        id: caller.callerId,
        name: caller.callerName,
        qualifiedName: caller.callerName,
        file: caller.callerFile,
        line: caller.line,
        depth,
        isEntryPoint,
        accessesSensitiveData: false, // Would need additional query
        pathToChange: path,
      });
      
      // Get callers of this caller for transitive analysis
      if (depth < maxDepth) {
        const transitiveCallers = getCallGraphCallers(projectRoot, caller.callerName);
        for (const tc of transitiveCallers) {
          if (!visited.has(tc.callerId)) {
            const tcPath: CallPathNode = {
              functionId: tc.callerId,
              functionName: tc.callerName,
              file: tc.callerFile,
              line: tc.line,
            };
            queue.push({
              caller: tc,
              depth: depth + 1,
              path: [tcPath, ...path],
            });
          }
        }
      }
    }
    
    // Extract entry points
    const entryPoints = Array.from(affected.values())
      .filter(a => a.isEntryPoint)
      .sort((a, b) => a.depth - b.depth);
    
    // Sort affected by depth
    const sortedAffected = Array.from(affected.values())
      .sort((a, b) => a.depth - b.depth);
    
    // Calculate risk
    const { risk, riskScore } = this.calculateRisk(affected, entryPoints, []);
    
    return {
      target: { type: 'function', file: '', functionName: name },
      risk,
      riskScore,
      summary: {
        directCallers: sortedAffected.filter(a => a.depth === 1).length,
        transitiveCallers: sortedAffected.filter(a => a.depth > 1).length,
        affectedEntryPoints: entryPoints.length,
        affectedDataPaths: 0,
        maxDepth: Math.max(0, ...sortedAffected.map(a => a.depth)),
      },
      affected: sortedAffected,
      entryPoints,
      sensitiveDataPaths: [],
      changedFunctions: [name],
    };
  }

  /**
   * Core analysis: find all callers of given functions
   */
  private analyzeMultipleFunctions(
    functionIds: string[],
    target: ImpactAnalysisResult['target'],
    options: ImpactAnalysisOptions
  ): ImpactAnalysisResult {
    const { maxDepth = Infinity } = options;
    
    const affected = new Map<string, AffectedFunction>();
    const changedFunctionsSet = new Set(functionIds);

    // BFS backwards through calledBy
    const queue: Array<{ funcId: string; depth: number; path: CallPathNode[] }> = [];
    const visited = new Set<string>();

    // Initialize queue with direct callers of all changed functions
    for (const funcId of functionIds) {
      const func = this.graph.functions.get(funcId);
      if (!func) {continue;}

      // Add the changed function's path node
      const changedNode: CallPathNode = {
        functionId: funcId,
        functionName: func.qualifiedName,
        file: func.file,
        line: func.startLine,
      };

      for (const caller of func.calledBy) {
        if (!visited.has(caller.callerId)) {
          queue.push({
            funcId: caller.callerId,
            depth: 1,
            path: [changedNode],
          });
        }
      }
    }

    // BFS traversal
    while (queue.length > 0) {
      const { funcId, depth, path } = queue.shift()!;

      if (visited.has(funcId) || depth > maxDepth) {
        continue;
      }
      visited.add(funcId);

      const func = this.graph.functions.get(funcId);
      if (!func) {continue;}

      // Build path to this function
      const currentPath: CallPathNode[] = [
        {
          functionId: funcId,
          functionName: func.qualifiedName,
          file: func.file,
          line: func.startLine,
        },
        ...path,
      ];

      // Record this affected function
      affected.set(funcId, {
        id: funcId,
        name: func.name,
        qualifiedName: func.qualifiedName,
        file: func.file,
        line: func.startLine,
        depth,
        isEntryPoint: this.entryPointSet.has(funcId),
        accessesSensitiveData: this.hasSensitiveAccess(func),
        pathToChange: currentPath,
      });

      // Continue to callers of this function
      for (const caller of func.calledBy) {
        if (!visited.has(caller.callerId)) {
          queue.push({
            funcId: caller.callerId,
            depth: depth + 1,
            path: currentPath,
          });
        }
      }
    }

    // Extract entry points
    const entryPoints = Array.from(affected.values())
      .filter(a => a.isEntryPoint)
      .sort((a, b) => a.depth - b.depth);

    // Find sensitive data paths
    const sensitiveDataPaths = this.findAffectedDataPaths(functionIds, entryPoints);

    // Calculate risk
    const { risk, riskScore } = this.calculateRisk(affected, entryPoints, sensitiveDataPaths);

    // Sort affected by depth
    const sortedAffected = Array.from(affected.values())
      .sort((a, b) => a.depth - b.depth);

    return {
      target,
      risk,
      riskScore,
      summary: {
        directCallers: sortedAffected.filter(a => a.depth === 1).length,
        transitiveCallers: sortedAffected.filter(a => a.depth > 1).length,
        affectedEntryPoints: entryPoints.length,
        affectedDataPaths: sensitiveDataPaths.length,
        maxDepth: Math.max(0, ...sortedAffected.map(a => a.depth)),
      },
      affected: sortedAffected,
      entryPoints,
      sensitiveDataPaths,
      changedFunctions: Array.from(changedFunctionsSet),
    };
  }

  /**
   * Find sensitive data paths that go through the changed code
   */
  private findAffectedDataPaths(
    changedFunctionIds: string[],
    affectedEntryPoints: AffectedFunction[]
  ): AffectedDataPath[] {
    const paths: AffectedDataPath[] = [];

    // For each changed function, find what data it can reach
    for (const funcId of changedFunctionIds) {
      const dataAccess = this.getReachableDataAccess(funcId);

      for (const access of dataAccess) {
        const sensitivity = this.classifySensitivity(access);
        if (sensitivity === 'unknown') {continue;}

        // Find entry points that can reach this data through the changed code
        for (const entryPoint of affectedEntryPoints) {
          // Build full path: entry → changed → data
          const fullPath: CallPathNode[] = [
            ...entryPoint.pathToChange,
            {
              functionId: access.file + ':data',
              functionName: `${access.table}.${access.fields.join(',')}`,
              file: access.file,
              line: access.line,
            },
          ];

          paths.push({
            table: access.table,
            fields: access.fields,
            operation: access.operation,
            entryPoint: entryPoint.qualifiedName,
            fullPath,
            sensitivity,
          });
        }
      }
    }

    return paths;
  }

  /**
   * Get all data access reachable from a function (forward traversal)
   */
  private getReachableDataAccess(functionId: string): DataAccessPoint[] {
    const access: DataAccessPoint[] = [];
    const visited = new Set<string>();
    const queue = [functionId];

    while (queue.length > 0) {
      const funcId = queue.shift()!;
      if (visited.has(funcId)) {continue;}
      visited.add(funcId);

      const func = this.graph.functions.get(funcId);
      if (!func) {continue;}

      // Collect data access
      access.push(...func.dataAccess);

      // Follow calls
      for (const call of func.calls) {
        // Handle both resolved calleeId and resolvedCandidates
        const candidates = call.resolvedCandidates ?? [];
        if (call.calleeId && !candidates.includes(call.calleeId)) {
          candidates.push(call.calleeId);
        }
        for (const candidate of candidates) {
          if (!visited.has(candidate)) {
            queue.push(candidate);
          }
        }
      }
    }

    return access;
  }

  /**
   * Check if a function has sensitive data access
   */
  private hasSensitiveAccess(func: FunctionNode): boolean {
    for (const access of func.dataAccess) {
      if (this.classifySensitivity(access) !== 'unknown') {
        return true;
      }
    }
    return false;
  }

  /**
   * Classify sensitivity of a data access point
   */
  private classifySensitivity(access: DataAccessPoint): AffectedDataPath['sensitivity'] {
    const text = `${access.table} ${access.fields.join(' ')}`.toLowerCase();

    if (/password|secret|token|api_key|private_key|auth/.test(text)) {
      return 'credentials';
    }
    if (/credit_card|card_number|cvv|bank|account_number|salary|income|payment|stripe|billing/.test(text)) {
      return 'financial';
    }
    if (/diagnosis|medical|health|prescription|insurance|hipaa/.test(text)) {
      return 'health';
    }
    if (/ssn|social_security|email|phone|address|dob|birth|name/.test(text)) {
      return 'pii';
    }

    return 'unknown';
  }

  /**
   * Calculate overall risk level
   */
  private calculateRisk(
    affected: Map<string, AffectedFunction>,
    entryPoints: AffectedFunction[],
    sensitiveDataPaths: AffectedDataPath[]
  ): { risk: ImpactRisk; riskScore: number } {
    let score = 0;

    // Base score from number of affected functions
    score += Math.min(30, affected.size * 2);

    // Entry points are high impact
    score += Math.min(25, entryPoints.length * 5);

    // Sensitive data paths are critical
    const credentialPaths = sensitiveDataPaths.filter(p => p.sensitivity === 'credentials').length;
    const financialPaths = sensitiveDataPaths.filter(p => p.sensitivity === 'financial').length;
    const healthPaths = sensitiveDataPaths.filter(p => p.sensitivity === 'health').length;
    const piiPaths = sensitiveDataPaths.filter(p => p.sensitivity === 'pii').length;

    score += credentialPaths * 15;
    score += financialPaths * 12;
    score += healthPaths * 10;
    score += piiPaths * 5;

    // Cap at 100
    score = Math.min(100, score);

    // Determine risk level
    let risk: ImpactRisk;
    if (score >= 75 || credentialPaths > 0) {
      risk = 'critical';
    } else if (score >= 50 || financialPaths > 0 || healthPaths > 0) {
      risk = 'high';
    } else if (score >= 25 || piiPaths > 0) {
      risk = 'medium';
    } else {
      risk = 'low';
    }

    return { risk, riskScore: score };
  }

  /**
   * Create empty result
   */
  private createEmptyResult(target: ImpactAnalysisResult['target']): ImpactAnalysisResult {
    return {
      target,
      risk: 'low',
      riskScore: 0,
      summary: {
        directCallers: 0,
        transitiveCallers: 0,
        affectedEntryPoints: 0,
        affectedDataPaths: 0,
        maxDepth: 0,
      },
      affected: [],
      entryPoints: [],
      sensitiveDataPaths: [],
      changedFunctions: [],
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an impact analyzer
 */
export function createImpactAnalyzer(graph: CallGraph): ImpactAnalyzer {
  return new ImpactAnalyzer(graph);
}
