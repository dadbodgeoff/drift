/**
 * Reachability Analysis Engine
 *
 * Answers the core question: "What data can this line of code ultimately access?"
 * Uses BFS traversal through the call graph to find all reachable data access points.
 */

import type {
  CallGraph,
  FunctionNode,
  ReachabilityResult,
  ReachabilityOptions,
  ReachableDataAccess,
  CallPathNode,
  CodeLocation,
  SensitiveFieldAccess,
  InverseReachabilityOptions,
  InverseReachabilityResult,
  InverseAccessPath,
} from '../types.js';

/**
 * Reachability Analysis Engine
 */
export class ReachabilityEngine {
  private graph: CallGraph;

  constructor(graph: CallGraph) {
    this.graph = graph;
  }

  /**
   * Get all data reachable from a specific code location
   */
  getReachableData(
    file: string,
    line: number,
    options: ReachabilityOptions = {}
  ): ReachabilityResult {
    // Find the containing function
    const func = this.findContainingFunction(file, line);
    if (!func) {
      return this.createEmptyResult({ file, line });
    }

    return this.getReachableDataFromFunction(func.id, options);
  }

  /**
   * Get all data reachable from a function
   */
  getReachableDataFromFunction(
    functionId: string,
    options: ReachabilityOptions = {}
  ): ReachabilityResult {
    const func = this.graph.functions.get(functionId);
    if (!func) {
      return this.createEmptyResult({ file: '', line: 0, functionId });
    }

    const {
      maxDepth = Infinity,
      sensitiveOnly = false,
      tables = [],
      includeUnresolved = false,
    } = options;

    const visited = new Set<string>();
    const reachableAccess: ReachableDataAccess[] = [];
    const queue: Array<{ funcId: string; path: CallPathNode[]; depth: number }> = [];

    // Start BFS from the given function
    queue.push({
      funcId: functionId,
      path: [],
      depth: 0,
    });

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { funcId, path, depth } = current;

      if (visited.has(funcId) || depth > maxDepth) {
        continue;
      }
      visited.add(funcId);

      const currentFunc = this.graph.functions.get(funcId);
      if (!currentFunc) {continue;}

      // Build current path
      const currentPath: CallPathNode[] = [
        ...path,
        {
          functionId: funcId,
          functionName: currentFunc.qualifiedName,
          file: currentFunc.file,
          line: currentFunc.startLine,
        },
      ];

      // Collect data access from this function
      for (const access of currentFunc.dataAccess) {
        // Filter by tables if specified
        if (tables.length > 0 && !tables.includes(access.table)) {
          continue;
        }

        reachableAccess.push({
          access,
          path: currentPath,
          depth,
        });
      }

      // Follow calls to other functions
      for (const call of currentFunc.calls) {
        if (!call.resolved && !includeUnresolved) {
          continue;
        }

        // Add all resolved candidates to the queue
        for (const candidateId of call.resolvedCandidates) {
          if (!visited.has(candidateId)) {
            queue.push({
              funcId: candidateId,
              path: currentPath,
              depth: depth + 1,
            });
          }
        }
      }
    }

    // Build result
    return this.buildResult(
      { file: func.file, line: func.startLine, functionId },
      reachableAccess,
      sensitiveOnly
    );
  }

  /**
   * Get the call path from a location to a specific data access point
   */
  getCallPath(
    from: CodeLocation,
    toTable: string,
    toField?: string
  ): CallPathNode[][] {
    const result = this.getReachableData(from.file, from.line, {
      tables: [toTable],
    });

    const paths: CallPathNode[][] = [];

    for (const access of result.reachableAccess) {
      // If field specified, filter by field
      if (toField && !access.access.fields.includes(toField)) {
        continue;
      }
      paths.push(access.path);
    }

    return paths;
  }

  /**
   * Inverse query: "Who can reach this data?"
   * Find all code paths that can access a specific table/field
   */
  getCodePathsToData(options: InverseReachabilityOptions): InverseReachabilityResult {
    const { table, field, maxDepth = Infinity } = options;

    // Find all functions that directly access this table
    const directAccessors: string[] = [];
    for (const funcId of this.graph.dataAccessors) {
      const func = this.graph.functions.get(funcId);
      if (!func) {continue;}

      for (const access of func.dataAccess) {
        if (access.table === table) {
          if (!field || access.fields.includes(field)) {
            directAccessors.push(funcId);
            break;
          }
        }
      }
    }

    // For each direct accessor, find all paths from entry points
    const accessPaths: InverseAccessPath[] = [];
    const reachingEntryPoints = new Set<string>();

    for (const accessorId of directAccessors) {
      const accessor = this.graph.functions.get(accessorId);
      if (!accessor) {continue;}

      // Find the specific access point
      const accessPoint = accessor.dataAccess.find(
        (a) => a.table === table && (!field || a.fields.includes(field))
      );
      if (!accessPoint) {continue;}

      // BFS backwards from accessor to find entry points
      const pathsToAccessor = this.findPathsToFunction(accessorId, maxDepth);

      for (const { entryPoint, path } of pathsToAccessor) {
        reachingEntryPoints.add(entryPoint);
        accessPaths.push({
          entryPoint,
          path,
          accessPoint,
        });
      }
    }

    return {
      target: { table, field: field ?? undefined },
      accessPaths,
      entryPoints: Array.from(reachingEntryPoints),
      totalAccessors: directAccessors.length,
    };
  }

  /**
   * Find all paths from entry points to a specific function
   */
  private findPathsToFunction(
    targetId: string,
    maxDepth: number
  ): Array<{ entryPoint: string; path: CallPathNode[] }> {
    const results: Array<{ entryPoint: string; path: CallPathNode[] }> = [];

    // For each entry point, try to find a path to the target
    for (const entryPointId of this.graph.entryPoints) {
      const paths = this.findPathsBFS(entryPointId, targetId, maxDepth);
      for (const path of paths) {
        results.push({
          entryPoint: entryPointId,
          path,
        });
      }
    }

    return results;
  }

  /**
   * BFS to find paths between two functions
   */
  private findPathsBFS(
    fromId: string,
    toId: string,
    maxDepth: number
  ): CallPathNode[][] {
    const paths: CallPathNode[][] = [];
    const queue: Array<{ funcId: string; path: CallPathNode[]; depth: number }> = [];
    const visited = new Map<string, number>(); // Track minimum depth to reach each node

    const fromFunc = this.graph.functions.get(fromId);
    if (!fromFunc) {return paths;}

    queue.push({
      funcId: fromId,
      path: [{
        functionId: fromId,
        functionName: fromFunc.qualifiedName,
        file: fromFunc.file,
        line: fromFunc.startLine,
      }],
      depth: 0,
    });

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { funcId, path, depth } = current;

      if (depth > maxDepth) {continue;}

      // Check if we've reached the target
      if (funcId === toId) {
        paths.push(path);
        continue; // Don't stop - there might be other paths
      }

      // Skip if we've visited this node at a lower depth
      const previousDepth = visited.get(funcId);
      if (previousDepth !== undefined && previousDepth <= depth) {
        continue;
      }
      visited.set(funcId, depth);

      const currentFunc = this.graph.functions.get(funcId);
      if (!currentFunc) {continue;}

      // Follow calls
      for (const call of currentFunc.calls) {
        if (!call.resolved) {continue;}

        for (const candidateId of call.resolvedCandidates) {
          const candidate = this.graph.functions.get(candidateId);
          if (!candidate) {continue;}

          queue.push({
            funcId: candidateId,
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
          });
        }
      }
    }

    return paths;
  }

  /**
   * Find the function containing a specific line
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
   * Build the reachability result
   */
  private buildResult(
    origin: CodeLocation,
    reachableAccess: ReachableDataAccess[],
    sensitiveOnly: boolean
  ): ReachabilityResult {
    // Collect unique tables
    const tablesSet = new Set<string>();
    for (const access of reachableAccess) {
      tablesSet.add(access.access.table);
    }

    // Group sensitive fields
    const sensitiveFieldsMap = new Map<string, SensitiveFieldAccess>();
    for (const access of reachableAccess) {
      // Check if any fields are sensitive (simplified - real impl would check against known sensitive fields)
      const sensitivePatterns = [
        'password', 'secret', 'token', 'key', 'ssn', 'social_security',
        'credit_card', 'card_number', 'cvv', 'pin', 'dob', 'date_of_birth',
        'email', 'phone', 'address', 'salary', 'income',
      ];

      for (const field of access.access.fields) {
        const fieldLower = field.toLowerCase();
        const isSensitive = sensitivePatterns.some((p) => fieldLower.includes(p));

        if (isSensitive) {
          const key = `${access.access.table}.${field}`;
          const existing = sensitiveFieldsMap.get(key);

          if (existing) {
            existing.paths.push(access.path);
            existing.accessCount++;
          } else {
            sensitiveFieldsMap.set(key, {
              field: {
                field,
                table: access.access.table,
                sensitivityType: this.classifySensitivity(field),
                file: access.access.file,
                line: access.access.line,
                confidence: 0.8,
              },
              paths: [access.path],
              accessCount: 1,
            });
          }
        }
      }
    }

    // Filter if sensitiveOnly
    let filteredAccess = reachableAccess;
    if (sensitiveOnly) {
      const sensitiveKeys = new Set(sensitiveFieldsMap.keys());
      filteredAccess = reachableAccess.filter((a) =>
        a.access.fields.some((f) => sensitiveKeys.has(`${a.access.table}.${f}`))
      );
    }

    // Calculate max depth
    const maxDepth = filteredAccess.reduce((max, a) => Math.max(max, a.depth), 0);

    return {
      origin,
      reachableAccess: filteredAccess,
      tables: Array.from(tablesSet),
      sensitiveFields: Array.from(sensitiveFieldsMap.values()),
      maxDepth,
      functionsTraversed: new Set(filteredAccess.flatMap((a) => a.path.map((p) => p.functionId))).size,
    };
  }

  /**
   * Classify sensitivity type based on field name
   */
  private classifySensitivity(field: string): 'pii' | 'credentials' | 'financial' | 'health' | 'unknown' {
    const fieldLower = field.toLowerCase();

    if (['password', 'secret', 'token', 'key', 'api_key', 'auth'].some((p) => fieldLower.includes(p))) {
      return 'credentials';
    }
    if (['credit_card', 'card_number', 'cvv', 'account_number', 'salary', 'income', 'bank'].some((p) => fieldLower.includes(p))) {
      return 'financial';
    }
    if (['diagnosis', 'medical', 'health', 'prescription', 'condition'].some((p) => fieldLower.includes(p))) {
      return 'health';
    }
    if (['ssn', 'social_security', 'email', 'phone', 'address', 'dob', 'name', 'birth'].some((p) => fieldLower.includes(p))) {
      return 'pii';
    }

    return 'unknown';
  }

  /**
   * Create an empty result
   */
  private createEmptyResult(origin: CodeLocation): ReachabilityResult {
    return {
      origin,
      reachableAccess: [],
      tables: [],
      sensitiveFields: [],
      maxDepth: 0,
      functionsTraversed: 0,
    };
  }
}
