/**
 * Call Graph Adapter
 *
 * Links constant extraction to the call graph system.
 * Enables tracking of constant usage through function calls.
 */

import { ConstantStore } from '../store/constant-store.js';

import type {
  ConstantExtraction,
  ConstantReference,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A constant with its call graph context
 */
export interface ConstantWithContext {
  /** The constant */
  constant: ConstantExtraction;

  /** Functions that use this constant */
  usedByFunctions: FunctionUsage[];

  /** Entry points that can reach this constant */
  reachableFromEntryPoints: string[];

  /** Data flow paths to this constant */
  dataFlowPaths: DataFlowPath[];
}

/**
 * Function usage of a constant
 */
export interface FunctionUsage {
  /** Function name */
  functionName: string;

  /** File containing the function */
  file: string;

  /** Line number of usage */
  line: number;

  /** How the constant is used */
  usageType: 'read' | 'parameter' | 'comparison' | 'assignment';

  /** Depth from entry point */
  depth: number;
}

/**
 * Data flow path to a constant
 */
export interface DataFlowPath {
  /** Entry point */
  entryPoint: string;

  /** Path of function calls */
  path: string[];

  /** Total depth */
  depth: number;
}

/**
 * Constant impact analysis result
 */
export interface ConstantImpactAnalysis {
  /** The constant being analyzed */
  constant: ConstantExtraction;

  /** Direct usages */
  directUsages: ConstantReference[];

  /** Functions affected by this constant */
  affectedFunctions: AffectedFunction[];

  /** Entry points affected */
  affectedEntryPoints: string[];

  /** Estimated impact score (0-100) */
  impactScore: number;

  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * A function affected by a constant
 */
export interface AffectedFunction {
  /** Function name */
  name: string;

  /** File path */
  file: string;

  /** Line number */
  line: number;

  /** How it's affected */
  affectedBy: 'direct_usage' | 'indirect_usage' | 'parameter_flow';

  /** Depth from constant */
  depth: number;
}

/**
 * Configuration for call graph adapter
 */
export interface CallGraphAdapterConfig {
  /** Root directory */
  rootDir: string;

  /** Maximum depth for traversal */
  maxDepth?: number;

  /** Include test files */
  includeTests?: boolean;
}

// ============================================================================
// Call Graph Adapter
// ============================================================================

/**
 * Adapter for linking constants to the call graph
 */
export class ConstantCallGraphAdapter {
  private readonly config: Required<CallGraphAdapterConfig>;
  private readonly store: ConstantStore;

  constructor(config: CallGraphAdapterConfig) {
    this.config = {
      rootDir: config.rootDir,
      maxDepth: config.maxDepth ?? 10,
      includeTests: config.includeTests ?? false,
    };

    this.store = new ConstantStore({ rootDir: config.rootDir });
  }

  /**
   * Get constant with call graph context
   */
  async getConstantWithContext(
    constantId: string,
    callGraph?: CallGraphInterface
  ): Promise<ConstantWithContext | null> {
    const constant = await this.store.getConstantById(constantId);
    if (!constant) {
      return null;
    }

    // Get all references to this constant
    const allConstants = await this.store.getAllConstants();
    const references = await this.findReferencesForConstant(constant, allConstants);

    // Build function usage list
    const usedByFunctions: FunctionUsage[] = references.map((ref) => ({
      functionName: ref.containingFunction ?? 'module-level',
      file: ref.file,
      line: ref.line,
      usageType: ref.referenceType,
      depth: 0, // Would need call graph to calculate
    }));

    // Get entry points if call graph is available
    const reachableFromEntryPoints: string[] = [];
    const dataFlowPaths: DataFlowPath[] = [];

    if (callGraph) {
      // Find entry points that can reach functions using this constant
      for (const usage of usedByFunctions) {
        const entryPoints = await this.findEntryPointsForFunction(
          usage.functionName,
          usage.file,
          callGraph
        );
        reachableFromEntryPoints.push(...entryPoints);
      }
    }

    return {
      constant,
      usedByFunctions,
      reachableFromEntryPoints: [...new Set(reachableFromEntryPoints)],
      dataFlowPaths,
    };
  }

  /**
   * Analyze impact of changing a constant
   */
  async analyzeConstantImpact(
    constantId: string,
    callGraph?: CallGraphInterface
  ): Promise<ConstantImpactAnalysis | null> {
    const constant = await this.store.getConstantById(constantId);
    if (!constant) {
      return null;
    }

    // Get all references
    const allConstants = await this.store.getAllConstants();
    const directUsages = await this.findReferencesForConstant(constant, allConstants);

    // Build affected functions list
    const affectedFunctions: AffectedFunction[] = [];
    const seenFunctions = new Set<string>();

    for (const usage of directUsages) {
      const key = `${usage.file}:${usage.containingFunction ?? 'module'}`;
      if (!seenFunctions.has(key)) {
        seenFunctions.add(key);
        affectedFunctions.push({
          name: usage.containingFunction ?? 'module-level',
          file: usage.file,
          line: usage.line,
          affectedBy: 'direct_usage',
          depth: 0,
        });
      }
    }

    // Find affected entry points
    const affectedEntryPoints: string[] = [];
    if (callGraph) {
      for (const func of affectedFunctions) {
        const entryPoints = await this.findEntryPointsForFunction(
          func.name,
          func.file,
          callGraph
        );
        affectedEntryPoints.push(...entryPoints);
      }
    }

    // Calculate impact score
    const impactScore = this.calculateImpactScore(
      directUsages.length,
      affectedFunctions.length,
      affectedEntryPoints.length,
      constant
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(impactScore, constant);

    return {
      constant,
      directUsages,
      affectedFunctions,
      affectedEntryPoints: [...new Set(affectedEntryPoints)],
      impactScore,
      riskLevel,
    };
  }

  /**
   * Find all constants used by a function
   */
  async findConstantsUsedByFunction(
    _functionName: string,
    filePath: string
  ): Promise<ConstantExtraction[]> {
    const allConstants = await this.store.getAllConstants();
    const usedConstants: ConstantExtraction[] = [];

    // Check which constants are referenced in the function
    // This is a simplified check - full implementation would parse the function body
    for (const constant of allConstants) {
      // Check if constant is from same file or imported
      if (constant.file === filePath || constant.isExported) {
        usedConstants.push(constant);
      }
    }

    return usedConstants;
  }

  /**
   * Find constants that flow to a specific data sink
   */
  async findConstantsFlowingToSink(
    _sinkFunction: string,
    sinkFile: string,
    _callGraph?: CallGraphInterface
  ): Promise<ConstantExtraction[]> {
    const flowingConstants: ConstantExtraction[] = [];

    // Find constants used in those functions
    const fileConstants = await this.store.getConstantsByFile(sinkFile);
    flowingConstants.push(...fileConstants);

    return flowingConstants;
  }

  /**
   * Get constants by entry point
   */
  async getConstantsByEntryPoint(
    entryPoint: string,
    callGraph?: CallGraphInterface
  ): Promise<ConstantExtraction[]> {
    const allConstants = await this.store.getAllConstants();

    if (!callGraph) {
      // Without call graph, return all exported constants
      return allConstants.filter((c) => c.isExported);
    }

    // With call graph, find all functions reachable from entry point
    // and return constants used by those functions
    const reachableFunctions = await this.getReachableFunctions(entryPoint, callGraph);
    const usedConstants: ConstantExtraction[] = [];
    const seenIds = new Set<string>();

    for (const func of reachableFunctions) {
      const funcConstants = await this.findConstantsUsedByFunction(func.name, func.file);
      for (const constant of funcConstants) {
        if (!seenIds.has(constant.id)) {
          seenIds.add(constant.id);
          usedConstants.push(constant);
        }
      }
    }

    return usedConstants;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Find references for a specific constant
   */
  private async findReferencesForConstant(
    _constant: ConstantExtraction,
    _allConstants: ConstantExtraction[]
  ): Promise<ConstantReference[]> {
    // This would need file content to find actual references
    // For now, return empty array - full implementation would scan files
    return [];
  }

  /**
   * Find entry points that can reach a function
   */
  private async findEntryPointsForFunction(
    functionName: string,
    filePath: string,
    callGraph: CallGraphInterface
  ): Promise<string[]> {
    // Use call graph to find entry points
    const entryPoints: string[] = [];

    try {
      const callers = await callGraph.getCallers(functionName, filePath);
      for (const caller of callers) {
        if (caller.isEntryPoint) {
          entryPoints.push(`${caller.file}:${caller.name}`);
        } else {
          // Recursively find entry points
          const parentEntryPoints = await this.findEntryPointsForFunction(
            caller.name,
            caller.file,
            callGraph
          );
          entryPoints.push(...parentEntryPoints);
        }
      }
    } catch {
      // Call graph not available or error
    }

    return entryPoints;
  }

  /**
   * Get all functions reachable from an entry point
   */
  private async getReachableFunctions(
    entryPoint: string,
    callGraph: CallGraphInterface
  ): Promise<Array<{ name: string; file: string }>> {
    const reachable: Array<{ name: string; file: string }> = [];
    const visited = new Set<string>();

    const traverse = async (funcName: string, filePath: string, depth: number) => {
      if (depth > this.config.maxDepth) {return;}

      const key = `${filePath}:${funcName}`;
      if (visited.has(key)) {return;}
      visited.add(key);

      reachable.push({ name: funcName, file: filePath });

      try {
        const callees = await callGraph.getCallees(funcName, filePath);
        for (const callee of callees) {
          await traverse(callee.name, callee.file, depth + 1);
        }
      } catch {
        // Ignore errors
      }
    };

    const [file, name] = entryPoint.split(':');
    if (file && name) {
      await traverse(name, file, 0);
    }

    return reachable;
  }

  /**
   * Calculate impact score for a constant
   */
  private calculateImpactScore(
    directUsages: number,
    affectedFunctions: number,
    affectedEntryPoints: number,
    constant: ConstantExtraction
  ): number {
    let score = 0;

    // Base score from usage count
    score += Math.min(directUsages * 5, 30);

    // Score from affected functions
    score += Math.min(affectedFunctions * 3, 25);

    // Score from affected entry points
    score += Math.min(affectedEntryPoints * 10, 30);

    // Bonus for exported constants
    if (constant.isExported) {
      score += 10;
    }

    // Bonus for security-sensitive categories
    if (constant.category === 'security' || constant.category === 'api') {
      score += 5;
    }

    return Math.min(score, 100);
  }

  /**
   * Determine risk level from impact score
   */
  private determineRiskLevel(
    impactScore: number,
    constant: ConstantExtraction
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Security constants are always at least medium risk
    if (constant.category === 'security') {
      if (impactScore >= 50) {return 'critical';}
      if (impactScore >= 25) {return 'high';}
      return 'medium';
    }

    // API constants are higher risk
    if (constant.category === 'api') {
      if (impactScore >= 60) {return 'critical';}
      if (impactScore >= 40) {return 'high';}
      if (impactScore >= 20) {return 'medium';}
      return 'low';
    }

    // Standard risk levels
    if (impactScore >= 70) {return 'critical';}
    if (impactScore >= 50) {return 'high';}
    if (impactScore >= 25) {return 'medium';}
    return 'low';
  }
}

// ============================================================================
// Call Graph Interface
// ============================================================================

/**
 * Interface for call graph operations
 * This allows the adapter to work with any call graph implementation
 */
export interface CallGraphInterface {
  /**
   * Get functions that call a given function
   */
  getCallers(
    functionName: string,
    filePath: string
  ): Promise<Array<{ name: string; file: string; isEntryPoint: boolean }>>;

  /**
   * Get functions called by a given function
   */
  getCallees(
    functionName: string,
    filePath: string
  ): Promise<Array<{ name: string; file: string }>>;

  /**
   * Check if a function is an entry point
   */
  isEntryPoint(functionName: string, filePath: string): Promise<boolean>;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a call graph adapter
 */
export function createCallGraphAdapter(
  config: CallGraphAdapterConfig
): ConstantCallGraphAdapter {
  return new ConstantCallGraphAdapter(config);
}
