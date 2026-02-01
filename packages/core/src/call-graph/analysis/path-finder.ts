/**
 * Path Finder
 *
 * Advanced path finding algorithms for call graph traversal.
 * Supports finding shortest paths, all paths, and critical paths
 * between functions in the call graph.
 */

import type { DataAccessPoint } from '../../boundaries/types.js';
import type {
  CallGraph,
  FunctionNode,
  CallPathNode,
  CodeLocation,
} from '../types.js';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  getCallGraphCallers,
} from '../../native/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for path finding
 */
export interface PathFinderOptions {
  /** Maximum depth to search */
  maxDepth?: number | undefined;
  /** Maximum number of paths to return */
  maxPaths?: number | undefined;
  /** Include unresolved calls */
  includeUnresolved?: boolean | undefined;
  /** Minimum confidence for call resolution */
  minConfidence?: number | undefined;
}

/**
 * A complete path with metadata
 */
export interface CallPath {
  /** Path nodes */
  nodes: CallPathNode[];
  /** Total depth */
  depth: number;
  /** Minimum confidence along the path */
  minConfidence: number;
  /** Whether path contains unresolved calls */
  hasUnresolved: boolean;
}

/**
 * Result of path finding
 */
export interface PathFinderResult {
  /** Found paths */
  paths: CallPath[];
  /** Whether search was exhaustive */
  exhaustive: boolean;
  /** Number of nodes visited */
  nodesVisited: number;
  /** Search time in ms */
  searchTimeMs: number;
}

/**
 * Critical path analysis result
 */
export interface CriticalPathResult {
  /** The critical path (most impactful) */
  criticalPath: CallPath | null;
  /** All paths sorted by criticality */
  rankedPaths: Array<{
    path: CallPath;
    score: number;
    factors: string[];
  }>;
}

// ============================================================================
// Path Finder
// ============================================================================

/**
 * Advanced path finding for call graphs
 */
export class PathFinder {
  private readonly graph: CallGraph;
  private useNativeQueries: boolean;
  private projectRoot: string | undefined;

  constructor(graph: CallGraph) {
    this.graph = graph;
    
    // Check if we should use native SQLite queries
    this.projectRoot = graph.projectRoot;
    const isSqliteMode = (graph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
    this.useNativeQueries = isSqliteMode && 
                            !!this.projectRoot && 
                            isNativeAvailable() && 
                            isCallGraphAvailable(this.projectRoot);
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
   * Find the shortest path between two functions
   */
  findShortestPath(
    fromId: string,
    toId: string,
    options: PathFinderOptions = {}
  ): CallPath | null {
    const result = this.findPaths(fromId, toId, { ...options, maxPaths: 1 });
    return result.paths[0] ?? null;
  }

  /**
   * Find all paths between two functions
   */
  findAllPaths(
    fromId: string,
    toId: string,
    options: PathFinderOptions = {}
  ): PathFinderResult {
    return this.findPaths(fromId, toId, options);
  }

  /**
   * Find paths from a location to any data access
   */
  findPathsToData(
    from: CodeLocation,
    options: PathFinderOptions = {}
  ): PathFinderResult {
    const startTime = Date.now();
    const paths: CallPath[] = [];
    let nodesVisited = 0;

    // Find containing function
    const fromFunc = this.findContainingFunction(from.file, from.line);
    if (!fromFunc) {
      return {
        paths: [],
        exhaustive: true,
        nodesVisited: 0,
        searchTimeMs: Date.now() - startTime,
      };
    }

    // Find all data accessors
    for (const accessorId of this.graph.dataAccessors) {
      const result = this.findPaths(fromFunc.id, accessorId, options);
      paths.push(...result.paths);
      nodesVisited += result.nodesVisited;

      if (options.maxPaths && paths.length >= options.maxPaths) {
        break;
      }
    }

    // Sort by depth
    paths.sort((a, b) => a.depth - b.depth);

    return {
      paths: options.maxPaths ? paths.slice(0, options.maxPaths) : paths,
      exhaustive: !options.maxPaths || paths.length < options.maxPaths,
      nodesVisited,
      searchTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Find paths from entry points to a specific function
   */
  findPathsFromEntryPoints(
    toId: string,
    options: PathFinderOptions = {}
  ): PathFinderResult {
    const startTime = Date.now();
    const paths: CallPath[] = [];
    let nodesVisited = 0;

    for (const entryPointId of this.graph.entryPoints) {
      const result = this.findPaths(entryPointId, toId, options);
      paths.push(...result.paths);
      nodesVisited += result.nodesVisited;

      if (options.maxPaths && paths.length >= options.maxPaths) {
        break;
      }
    }

    // Sort by depth
    paths.sort((a, b) => a.depth - b.depth);

    return {
      paths: options.maxPaths ? paths.slice(0, options.maxPaths) : paths,
      exhaustive: !options.maxPaths || paths.length < options.maxPaths,
      nodesVisited,
      searchTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Find the critical path (most impactful) to data access
   */
  findCriticalPath(
    from: CodeLocation,
    dataAccessPoints: DataAccessPoint[],
    options: PathFinderOptions = {}
  ): CriticalPathResult {
    const pathsResult = this.findPathsToData(from, { ...options, maxPaths: 100 });

    if (pathsResult.paths.length === 0) {
      return {
        criticalPath: null,
        rankedPaths: [],
      };
    }

    // Score each path
    const rankedPaths = pathsResult.paths.map((path) => {
      const { score, factors } = this.scorePath(path, dataAccessPoints);
      return { path, score, factors };
    });

    // Sort by score (descending)
    rankedPaths.sort((a, b) => b.score - a.score);

    return {
      criticalPath: rankedPaths[0]?.path ?? null,
      rankedPaths,
    };
  }

  /**
   * Check if two functions are connected
   */
  isConnected(fromId: string, toId: string, maxDepth: number = 10): boolean {
    return this.findShortestPath(fromId, toId, { maxDepth }) !== null;
  }

  /**
   * Get all functions reachable from a starting point
   */
  getReachableFunctions(
    fromId: string,
    options: PathFinderOptions = {}
  ): Set<string> {
    const maxDepth = options.maxDepth ?? Infinity;
    const includeUnresolved = options.includeUnresolved ?? false;
    const minConfidence = options.minConfidence ?? 0;

    const reachable = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (reachable.has(id) || depth > maxDepth) {continue;}
      reachable.add(id);

      const func = this.graph.functions.get(id);
      if (!func) {continue;}

      for (const call of func.calls) {
        if (!call.resolved && !includeUnresolved) {continue;}
        if (call.confidence < minConfidence) {continue;}

        for (const candidateId of call.resolvedCandidates) {
          if (!reachable.has(candidateId)) {
            queue.push({ id: candidateId, depth: depth + 1 });
          }
        }
      }
    }

    return reachable;
  }

  /**
   * Get all functions that can reach a target
   */
  getCallers(
    toId: string,
    options: PathFinderOptions = {}
  ): Set<string> {
    const maxDepth = options.maxDepth ?? Infinity;
    const callers = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: toId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (callers.has(id) || depth > maxDepth) {continue;}
      callers.add(id);

      const func = this.graph.functions.get(id);
      if (!func) {continue;}

      // Use native query if available
      const funcCallers = this.getFunctionCallers(id, func.name);
      for (const callSite of funcCallers) {
        if (!callers.has(callSite.callerId)) {
          queue.push({ id: callSite.callerId, depth: depth + 1 });
        }
      }
    }

    return callers;
  }

  /**
   * Find paths between two functions using BFS
   */
  private findPaths(
    fromId: string,
    toId: string,
    options: PathFinderOptions = {}
  ): PathFinderResult {
    const startTime = Date.now();
    const maxDepth = options.maxDepth ?? 20;
    const maxPaths = options.maxPaths ?? 100;
    const includeUnresolved = options.includeUnresolved ?? false;
    const minConfidence = options.minConfidence ?? 0;

    const paths: CallPath[] = [];
    let nodesVisited = 0;

    // Handle same node case
    if (fromId === toId) {
      const func = this.graph.functions.get(fromId);
      if (func) {
        return {
          paths: [{
            nodes: [{
              functionId: fromId,
              functionName: func.qualifiedName,
              file: func.file,
              line: func.startLine,
            }],
            depth: 0,
            minConfidence: 1,
            hasUnresolved: false,
          }],
          exhaustive: true,
          nodesVisited: 1,
          searchTimeMs: Date.now() - startTime,
        };
      }
    }

    // BFS with path tracking
    const visited = new Map<string, number>(); // Track minimum depth to reach each node
    const queue: Array<{
      id: string;
      path: CallPathNode[];
      depth: number;
      minConf: number;
      hasUnresolved: boolean;
    }> = [];

    const fromFunc = this.graph.functions.get(fromId);
    if (!fromFunc) {
      return {
        paths: [],
        exhaustive: true,
        nodesVisited: 0,
        searchTimeMs: Date.now() - startTime,
      };
    }

    queue.push({
      id: fromId,
      path: [{
        functionId: fromId,
        functionName: fromFunc.qualifiedName,
        file: fromFunc.file,
        line: fromFunc.startLine,
      }],
      depth: 0,
      minConf: 1,
      hasUnresolved: false,
    });

    while (queue.length > 0 && paths.length < maxPaths) {
      const current = queue.shift()!;
      const { id, path, depth, minConf, hasUnresolved } = current;
      nodesVisited++;

      if (depth > maxDepth) {continue;}

      // Skip if we've visited this node at a lower depth (optimization)
      const prevDepth = visited.get(id);
      if (prevDepth !== undefined && prevDepth < depth) {continue;}
      visited.set(id, depth);

      // Check if we reached the target
      if (id === toId) {
        paths.push({
          nodes: path,
          depth,
          minConfidence: minConf,
          hasUnresolved,
        });
        continue;
      }

      const func = this.graph.functions.get(id);
      if (!func) {continue;}

      // Explore calls
      for (const call of func.calls) {
        if (!call.resolved && !includeUnresolved) {continue;}
        if (call.confidence < minConfidence) {continue;}

        for (const candidateId of call.resolvedCandidates) {
          const candidate = this.graph.functions.get(candidateId);
          if (!candidate) {continue;}

          // Don't revisit nodes in the current path (avoid cycles)
          if (path.some((n) => n.functionId === candidateId)) {continue;}

          queue.push({
            id: candidateId,
            path: [
              ...path,
              {
                functionId: candidateId,
                functionName: candidate.qualifiedName,
                file: candidate.file,
                line: candidate.startLine,
              },
            ],
            depth: depth + 1,
            minConf: Math.min(minConf, call.confidence),
            hasUnresolved: hasUnresolved || !call.resolved,
          });
        }
      }
    }

    return {
      paths,
      exhaustive: paths.length < maxPaths,
      nodesVisited,
      searchTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Score a path based on criticality factors
   */
  private scorePath(
    path: CallPath,
    dataAccessPoints: DataAccessPoint[]
  ): { score: number; factors: string[] } {
    let score = 100;
    const factors: string[] = [];

    // Shorter paths are more critical (easier to exploit)
    if (path.depth <= 2) {
      score += 20;
      factors.push('Short call chain');
    } else if (path.depth > 5) {
      score -= 10;
      factors.push('Deep call chain');
    }

    // Higher confidence paths are more reliable
    if (path.minConfidence >= 0.9) {
      score += 10;
      factors.push('High confidence resolution');
    } else if (path.minConfidence < 0.5) {
      score -= 20;
      factors.push('Low confidence resolution');
    }

    // Unresolved calls reduce criticality
    if (path.hasUnresolved) {
      score -= 15;
      factors.push('Contains unresolved calls');
    }

    // Check if path ends at sensitive data
    const lastNode = path.nodes[path.nodes.length - 1];
    if (lastNode) {
      const accessPoint = dataAccessPoints.find(
        (ap) => ap.file === lastNode.file && ap.line === lastNode.line
      );
      if (accessPoint) {
        // Boost for write/delete operations
        if (accessPoint.operation === 'write' || accessPoint.operation === 'delete') {
          score += 15;
          factors.push('Write/delete operation');
        }
      }
    }

    return { score: Math.max(0, score), factors };
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
}

/**
 * Create a new path finder
 */
export function createPathFinder(graph: CallGraph): PathFinder {
  return new PathFinder(graph);
}
