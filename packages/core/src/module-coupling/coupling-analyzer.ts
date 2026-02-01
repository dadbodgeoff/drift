/**
 * Module Coupling Analyzer
 *
 * Analyzes module dependencies, calculates coupling metrics,
 * detects cycles, and identifies refactoring opportunities.
 */

import type {
  ModuleCouplingGraph,
  ModuleNode,
  ImportEdge,
  DependencyCycle,
  CouplingMetrics,
  AggregateCouplingMetrics,
  ModuleCouplingAnalysis,
  RefactorImpact,
  UnusedExportAnalysis,
  ModuleCouplingOptions,
  CycleDetectionOptions,
  HotspotOptions,
  ExportedSymbol,
  ModuleRole,
  CycleSeverity,
  CycleBreakSuggestion,
  BreakEffort,
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

export class ModuleCouplingAnalyzer {
  private graph: ModuleCouplingGraph | null = null;
  private callGraph: CallGraph | null = null;
  private options: ModuleCouplingOptions;
  private useNativeQueries: boolean = false;
  private projectRoot: string | undefined;

  constructor(options: ModuleCouplingOptions) {
    this.options = {
      includeExternal: false,
      granularity: 'file',
      maxDepth: 20,
      ...options,
    };
  }

  /**
   * Set the call graph for enhanced analysis
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
   * Build the module coupling graph from the call graph
   */
  build(): ModuleCouplingGraph {
    if (!this.callGraph) {
      throw new Error('Call graph required. Call setCallGraph() first.');
    }

    const modules = new Map<string, ModuleNode>();
    const edges: ImportEdge[] = [];
    const importMap = new Map<string, Map<string, ImportEdge>>();

    // Phase 1: Extract modules and imports from call graph
    for (const [_funcId, func] of this.callGraph.functions) {
      const modulePath = func.file;
      
      // Skip external modules if configured
      if (!this.options.includeExternal && this.isExternalModule(modulePath)) {
        continue;
      }

      // Get or create module node
      if (!modules.has(modulePath)) {
        modules.set(modulePath, this.createModuleNode(modulePath, func.language));
      }

      const moduleNode = modules.get(modulePath)!;

      // Track exports
      if (func.isExported) {
        moduleNode.exports.push({
          name: func.name,
          kind: this.inferExportKind(func),
          isTypeOnly: false,
          line: func.startLine,
          isReExport: false,
        });
      }

      // Track imports from function calls (using resolvedCandidates)
      for (const call of func.calls) {
        for (const candidate of call.resolvedCandidates) {
          const targetFunc = this.callGraph.functions.get(candidate);
          if (!targetFunc) {continue;}

          const targetModule = targetFunc.file;
          if (targetModule === modulePath) {continue;} // Skip self-imports
          if (!this.options.includeExternal && this.isExternalModule(targetModule)) {continue;}

          // Create or update edge
          if (!importMap.has(modulePath)) {
            importMap.set(modulePath, new Map());
          }
          
          const moduleImports = importMap.get(modulePath)!;
          if (!moduleImports.has(targetModule)) {
            moduleImports.set(targetModule, {
              from: modulePath,
              to: targetModule,
              symbols: [],
              isTypeOnly: false,
              weight: 0,
              line: call.line,
            });
          }

          const edge = moduleImports.get(targetModule)!;
          if (!edge.symbols.includes(targetFunc.name)) {
            edge.symbols.push(targetFunc.name);
            edge.weight++;
          }
        }
      }

      // ALSO track imports using calledBy relationships (more reliable)
      // This captures cross-module calls even when resolvedCandidates is empty
      const funcCallers = this.getFunctionCallers(func.id, func.name);
      for (const calledByInfo of funcCallers) {
        const callerFunc = this.callGraph.functions.get(calledByInfo.callerId);
        if (!callerFunc) {continue;}

        const callerModule = callerFunc.file;
        if (callerModule === modulePath) {continue;} // Skip same-module calls
        if (!this.options.includeExternal && this.isExternalModule(callerModule)) {continue;}

        // Create or update edge (caller imports this module)
        if (!importMap.has(callerModule)) {
          importMap.set(callerModule, new Map());
        }

        const callerImports = importMap.get(callerModule)!;
        if (!callerImports.has(modulePath)) {
          callerImports.set(modulePath, {
            from: callerModule,
            to: modulePath,
            symbols: [],
            isTypeOnly: false,
            weight: 0,
            line: calledByInfo.line,
          });
        }

        const edge = callerImports.get(modulePath)!;
        if (!edge.symbols.includes(func.name)) {
          edge.symbols.push(func.name);
          edge.weight++;
        }
      }
    }

    // Phase 2: Build edges array and update module relationships
    for (const [fromModule, targets] of importMap) {
      for (const [toModule, edge] of targets) {
        edges.push(edge);

        // Update module relationships
        const fromNode = modules.get(fromModule);
        const toNode = modules.get(toModule);

        if (fromNode && !fromNode.imports.includes(toModule)) {
          fromNode.imports.push(toModule);
        }
        if (toNode && !toNode.importedBy.includes(fromModule)) {
          toNode.importedBy.push(fromModule);
        }
      }
    }

    // Phase 3: Calculate metrics for each module
    for (const [_path, node] of modules) {
      node.metrics = this.calculateMetrics(node);
      node.role = this.determineRole(node);
      node.isLeaf = node.imports.length === 0;
      node.isEntryPoint = this.callGraph.entryPoints.some(ep => ep.includes(node.path));
    }

    // Phase 4: Find unused exports
    this.findUnusedExports(modules, edges);

    // Phase 5: Detect cycles
    const cycles = this.detectCycles(modules);

    // Phase 6: Calculate aggregate metrics
    const metrics = this.calculateAggregateMetrics(modules, edges, cycles);

    this.graph = {
      modules,
      edges,
      cycles,
      metrics,
      generatedAt: new Date().toISOString(),
      projectRoot: this.options.rootDir,
    };

    return this.graph;
  }

  /**
   * Get the built graph
   */
  getGraph(): ModuleCouplingGraph | null {
    return this.graph;
  }

  /**
   * Analyze coupling for a specific module
   */
  analyzeModule(modulePath: string): ModuleCouplingAnalysis | null {
    if (!this.graph) {return null;}

    const module = this.graph.modules.get(modulePath);
    if (!module) {return null;}

    // Get direct dependencies with details
    const directDependencies = module.imports.map(dep => {
      const edge = this.graph!.edges.find(e => e.from === modulePath && e.to === dep);
      return {
        path: dep,
        symbols: edge?.symbols ?? [],
        weight: edge?.weight ?? 0,
      };
    });

    // Get direct dependents with details
    const directDependents = module.importedBy.map(dep => {
      const edge = this.graph!.edges.find(e => e.from === dep && e.to === modulePath);
      return {
        path: dep,
        symbols: edge?.symbols ?? [],
        weight: edge?.weight ?? 0,
      };
    });

    // Calculate transitive dependencies
    const transitiveDependencies = this.getTransitiveDependencies(modulePath);
    const transitiveDependents = this.getTransitiveDependents(modulePath);

    // Find cycles involving this module
    const cyclesInvolved = this.graph.cycles.filter(c => c.path.includes(modulePath));

    // Calculate health
    const health = this.calculateModuleHealth(module, cyclesInvolved);

    return {
      module,
      directDependencies,
      directDependents,
      transitiveDependencies,
      transitiveDependents,
      cyclesInvolved,
      health,
    };
  }

  /**
   * Analyze refactor impact for a module
   */
  analyzeRefactorImpact(modulePath: string): RefactorImpact | null {
    if (!this.graph) {return null;}

    const module = this.graph.modules.get(modulePath);
    if (!module) {return null;}

    const transitiveDependents = this.getTransitiveDependents(modulePath);
    
    const affectedModules = transitiveDependents.map(dep => {
      const depModule = this.graph!.modules.get(dep);
      const edge = this.graph!.edges.find(e => e.to === modulePath && e.from === dep);
      
      return {
        path: dep,
        reason: edge 
          ? `Imports: ${edge.symbols.slice(0, 3).join(', ')}${edge.symbols.length > 3 ? '...' : ''}`
          : 'Transitive dependency',
        effort: this.estimateRefactorEffort(depModule, edge),
      };
    });

    const totalAffected = affectedModules.length;
    const risk = this.calculateRefactorRisk(totalAffected, module);

    const suggestions = this.generateRefactorSuggestions(module, affectedModules);

    return {
      target: modulePath,
      affectedModules,
      totalAffected,
      risk,
      suggestions,
    };
  }

  /**
   * Get all dependency cycles
   */
  getCycles(options: CycleDetectionOptions = {}): DependencyCycle[] {
    if (!this.graph) {return [];}

    let cycles = this.graph.cycles;

    if (options.maxCycleLength) {
      cycles = cycles.filter(c => c.length <= options.maxCycleLength!);
    }

    if (options.minSeverity) {
      const severityOrder: Record<CycleSeverity, number> = { critical: 0, warning: 1, info: 2 };
      const minOrder = severityOrder[options.minSeverity];
      cycles = cycles.filter(c => severityOrder[c.severity] <= minOrder);
    }

    return cycles;
  }

  /**
   * Get coupling hotspots
   */
  getHotspots(options: HotspotOptions = {}): Array<{ path: string; coupling: number; metrics: CouplingMetrics }> {
    if (!this.graph) {return [];}

    const { limit = 10, minCoupling = 5 } = options;

    const hotspots: Array<{ path: string; coupling: number; metrics: CouplingMetrics }> = [];

    for (const [path, module] of this.graph.modules) {
      const coupling = module.metrics.Ca + module.metrics.Ce;
      if (coupling >= minCoupling) {
        hotspots.push({ path, coupling, metrics: module.metrics });
      }
    }

    return hotspots
      .sort((a, b) => b.coupling - a.coupling)
      .slice(0, limit);
  }

  /**
   * Get unused exports across all modules
   */
  getUnusedExports(): UnusedExportAnalysis[] {
    if (!this.graph) {return [];}

    const results: UnusedExportAnalysis[] = [];

    for (const [path, module] of this.graph.modules) {
      if (module.unusedExports.length > 0) {
        const unusedExports = module.unusedExports.map(name => {
          const exp = module.exports.find(e => e.name === name);
          return {
            name,
            kind: exp?.kind ?? 'other' as const,
            line: exp?.line ?? 0,
          };
        });

        results.push({
          module: path,
          unusedExports,
          possibleReasons: this.inferUnusedExportReasons(module, unusedExports),
        });
      }
    }

    return results;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private createModuleNode(path: string, language: string): ModuleNode {
    return {
      path,
      language: language as ModuleNode['language'],
      importedBy: [],
      imports: [],
      metrics: { Ca: 0, Ce: 0, instability: 0, abstractness: 0, distance: 0 },
      role: 'isolated',
      exports: [],
      unusedExports: [],
      isEntryPoint: false,
      isLeaf: true,
    };
  }

  private isExternalModule(path: string): boolean {
    return path.includes('node_modules') || 
           path.includes('vendor') ||
           path.includes('site-packages') ||
           path.startsWith('@') ||
           !path.includes('/');
  }

  private inferExportKind(func: FunctionNode): ExportedSymbol['kind'] {
    if (func.className) {return 'class';}
    if (func.name.startsWith('use')) {return 'function';} // React hooks
    return 'function';
  }

  private calculateMetrics(node: ModuleNode): CouplingMetrics {
    const Ca = node.importedBy.length;
    const Ce = node.imports.length;
    const instability = Ca + Ce > 0 ? Ce / (Ca + Ce) : 0;
    
    // Calculate abstractness (ratio of interfaces/abstract types)
    const abstractExports = node.exports.filter(e => 
      e.kind === 'interface' || e.kind === 'type'
    ).length;
    const abstractness = node.exports.length > 0 
      ? abstractExports / node.exports.length 
      : 0;
    
    const distance = Math.abs(abstractness + instability - 1);

    return {
      Ca,
      Ce,
      instability: Math.round(instability * 100) / 100,
      abstractness: Math.round(abstractness * 100) / 100,
      distance: Math.round(distance * 100) / 100,
    };
  }

  private determineRole(node: ModuleNode): ModuleRole {
    const { Ca, Ce } = node.metrics;
    
    if (Ca === 0 && Ce === 0) {return 'isolated';}
    if (Ca > Ce * 2) {return 'hub';}        // Many depend on this
    if (Ce > Ca * 2) {return 'authority';}  // Depends on many
    return 'balanced';
  }

  private findUnusedExports(modules: Map<string, ModuleNode>, edges: ImportEdge[]): void {
    // Build set of all imported symbols per module
    const importedSymbols = new Map<string, Set<string>>();
    
    for (const edge of edges) {
      if (!importedSymbols.has(edge.to)) {
        importedSymbols.set(edge.to, new Set());
      }
      for (const symbol of edge.symbols) {
        importedSymbols.get(edge.to)!.add(symbol);
      }
    }

    // Find unused exports
    for (const [path, module] of modules) {
      const imported = importedSymbols.get(path) ?? new Set();
      module.unusedExports = module.exports
        .filter(exp => !imported.has(exp.name))
        .map(exp => exp.name);
    }
  }

  private detectCycles(modules: Map<string, ModuleNode>): DependencyCycle[] {
    // Tarjan's algorithm for strongly connected components
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    let currentIndex = 0;

    const strongConnect = (v: string) => {
      index.set(v, currentIndex);
      lowlink.set(v, currentIndex);
      currentIndex++;
      stack.push(v);
      onStack.add(v);

      const node = modules.get(v);
      if (node) {
        for (const w of node.imports) {
          if (!modules.has(w)) {continue;} // Skip external
          
          if (!index.has(w)) {
            strongConnect(w);
            lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
          } else if (onStack.has(w)) {
            lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
          }
        }
      }

      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        
        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    };

    for (const v of modules.keys()) {
      if (!index.has(v)) {
        strongConnect(v);
      }
    }

    // Convert SCCs to DependencyCycle objects
    return sccs.map((scc, i) => this.createCycle(scc, i, modules));
  }

  private createCycle(
    path: string[], 
    index: number, 
    modules: Map<string, ModuleNode>
  ): DependencyCycle {
    const length = path.length;
    const severity = this.calculateCycleSeverity(path, modules);
    const breakPoints = this.suggestBreakPoints(path, modules);
    
    // Calculate total weight
    let totalWeight = 0;
    for (let i = 0; i < path.length; i++) {
      const from = path[i]!;
      const to = path[(i + 1) % path.length]!;
      const fromNode = modules.get(from);
      if (fromNode?.imports.includes(to)) {
        totalWeight++;
      }
    }

    return {
      id: `cycle-${index}`,
      path,
      length,
      severity,
      breakPoints,
      totalWeight,
    };
  }

  private calculateCycleSeverity(path: string[], modules: Map<string, ModuleNode>): CycleSeverity {
    // Critical: cycles involving entry points or high-coupling modules
    const hasEntryPoint = path.some(p => modules.get(p)?.isEntryPoint);
    const hasHighCoupling = path.some(p => {
      const m = modules.get(p);
      return m && (m.metrics.Ca + m.metrics.Ce) > 10;
    });

    if (hasEntryPoint || path.length > 5) {return 'critical';}
    if (hasHighCoupling || path.length > 3) {return 'warning';}
    return 'info';
  }

  private suggestBreakPoints(
    path: string[], 
    modules: Map<string, ModuleNode>
  ): CycleBreakSuggestion[] {
    const suggestions: CycleBreakSuggestion[] = [];

    for (let i = 0; i < path.length; i++) {
      const from = path[i]!;
      const to = path[(i + 1) % path.length]!;
      
      const fromNode = modules.get(from);
      const toNode = modules.get(to);
      
      if (!fromNode || !toNode) {continue;}

      // Prefer breaking edges from unstable to stable modules
      const effort = this.estimateBreakEffort(fromNode, toNode);
      const rationale = this.generateBreakRationale(fromNode, toNode);
      const approach = this.suggestBreakApproach(fromNode, toNode);

      suggestions.push({
        edge: { from, to },
        rationale,
        effort,
        approach,
      });
    }

    // Sort by effort (low first)
    const effortOrder: Record<BreakEffort, number> = { low: 0, medium: 1, high: 2 };
    return suggestions.sort((a, b) => effortOrder[a.effort] - effortOrder[b.effort]);
  }

  private estimateBreakEffort(from: ModuleNode, to: ModuleNode): BreakEffort {
    // Low effort if from is unstable (easy to change)
    if (from.metrics.instability > 0.7) {return 'low';}
    // High effort if to is a hub (many depend on it)
    if (to.role === 'hub') {return 'high';}
    return 'medium';
  }

  private generateBreakRationale(from: ModuleNode, to: ModuleNode): string {
    if (from.metrics.instability > to.metrics.instability) {
      return `${from.path} is more unstable (${from.metrics.instability}) than ${to.path} (${to.metrics.instability})`;
    }
    if (to.role === 'hub') {
      return `${to.path} is a hub with ${to.metrics.Ca} dependents`;
    }
    return 'Balanced coupling on both sides';
  }

  private suggestBreakApproach(from: ModuleNode, to: ModuleNode): string {
    if (from.metrics.instability > 0.7) {
      return 'Extract shared interface to a new module';
    }
    if (to.role === 'hub') {
      return 'Use dependency injection to invert the dependency';
    }
    return 'Consider extracting common functionality to a shared module';
  }

  private calculateAggregateMetrics(
    modules: Map<string, ModuleNode>,
    edges: ImportEdge[],
    cycles: DependencyCycle[]
  ): AggregateCouplingMetrics {
    let totalInstability = 0;
    let totalDistance = 0;
    const zoneOfPain: string[] = [];
    const zoneOfUselessness: string[] = [];
    const hotspots: Array<{ path: string; coupling: number }> = [];
    const isolatedModules: string[] = [];

    for (const [path, module] of modules) {
      totalInstability += module.metrics.instability;
      totalDistance += module.metrics.distance;

      const coupling = module.metrics.Ca + module.metrics.Ce;
      hotspots.push({ path, coupling });

      // Zone of pain: stable (I < 0.3) and concrete (A < 0.3)
      if (module.metrics.instability < 0.3 && module.metrics.abstractness < 0.3) {
        zoneOfPain.push(path);
      }

      // Zone of uselessness: unstable (I > 0.7) and abstract (A > 0.7)
      if (module.metrics.instability > 0.7 && module.metrics.abstractness > 0.7) {
        zoneOfUselessness.push(path);
      }

      if (module.role === 'isolated') {
        isolatedModules.push(path);
      }
    }

    const moduleCount = modules.size;

    return {
      totalModules: moduleCount,
      totalEdges: edges.length,
      avgInstability: moduleCount > 0 ? Math.round((totalInstability / moduleCount) * 100) / 100 : 0,
      avgDistance: moduleCount > 0 ? Math.round((totalDistance / moduleCount) * 100) / 100 : 0,
      cycleCount: cycles.length,
      zoneOfPain,
      zoneOfUselessness,
      hotspots: hotspots.sort((a, b) => b.coupling - a.coupling).slice(0, 10),
      isolatedModules,
    };
  }

  private getTransitiveDependencies(modulePath: string): string[] {
    if (!this.graph) {return [];}

    const visited = new Set<string>();
    const queue = [modulePath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {continue;}
      visited.add(current);

      const node = this.graph.modules.get(current);
      if (node) {
        for (const dep of node.imports) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }
    }

    visited.delete(modulePath);
    return Array.from(visited);
  }

  private getTransitiveDependents(modulePath: string): string[] {
    if (!this.graph) {return [];}

    const visited = new Set<string>();
    const queue = [modulePath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {continue;}
      visited.add(current);

      const node = this.graph.modules.get(current);
      if (node) {
        for (const dep of node.importedBy) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }
    }

    visited.delete(modulePath);
    return Array.from(visited);
  }

  private calculateModuleHealth(
    module: ModuleNode, 
    cycles: DependencyCycle[]
  ): { score: number; issues: string[]; suggestions: string[] } {
    let score = 100;
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Penalize high coupling
    const coupling = module.metrics.Ca + module.metrics.Ce;
    if (coupling > 20) {
      score -= 30;
      issues.push(`Very high coupling (${coupling})`);
      suggestions.push('Consider splitting into smaller modules');
    } else if (coupling > 10) {
      score -= 15;
      issues.push(`High coupling (${coupling})`);
    }

    // Penalize cycles
    if (cycles.length > 0) {
      score -= cycles.length * 10;
      issues.push(`Involved in ${cycles.length} cycle(s)`);
      suggestions.push('Break dependency cycles to improve maintainability');
    }

    // Penalize zone of pain
    if (module.metrics.instability < 0.3 && module.metrics.abstractness < 0.3) {
      score -= 20;
      issues.push('In zone of pain (stable but concrete)');
      suggestions.push('Add abstractions or make more flexible');
    }

    // Penalize unused exports
    if (module.unusedExports.length > 3) {
      score -= 10;
      issues.push(`${module.unusedExports.length} unused exports`);
      suggestions.push('Remove or document unused exports');
    }

    return {
      score: Math.max(0, score),
      issues,
      suggestions,
    };
  }

  private estimateRefactorEffort(
    module: ModuleNode | undefined, 
    edge: ImportEdge | undefined
  ): BreakEffort {
    if (!module) {return 'medium';}
    
    const symbolCount = edge?.symbols.length ?? 0;
    if (symbolCount > 5) {return 'high';}
    if (symbolCount > 2) {return 'medium';}
    return 'low';
  }

  private calculateRefactorRisk(
    totalAffected: number, 
    module: ModuleNode
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (totalAffected > 20 || module.role === 'hub') {return 'critical';}
    if (totalAffected > 10) {return 'high';}
    if (totalAffected > 5) {return 'medium';}
    return 'low';
  }

  private generateRefactorSuggestions(
    module: ModuleNode, 
    affected: Array<{ path: string; effort: BreakEffort }>
  ): string[] {
    const suggestions: string[] = [];

    if (module.role === 'hub') {
      suggestions.push('Consider using dependency injection to reduce direct coupling');
    }

    const highEffortCount = affected.filter(a => a.effort === 'high').length;
    if (highEffortCount > 3) {
      suggestions.push('Create a facade or adapter to minimize breaking changes');
    }

    if (module.exports.length > 10) {
      suggestions.push('Split module into smaller, focused modules');
    }

    if (suggestions.length === 0) {
      suggestions.push('Refactor should be straightforward with proper testing');
    }

    return suggestions;
  }

  private inferUnusedExportReasons(
    module: ModuleNode, 
    unusedExports: Array<{ name: string; kind: string }>
  ): ('dead-code' | 'public-api' | 'test-only' | 'dynamic-import')[] {
    const reasons: ('dead-code' | 'public-api' | 'test-only' | 'dynamic-import')[] = [];

    // Check if it's likely a public API
    if (module.path.includes('index') || module.isEntryPoint) {
      reasons.push('public-api');
    }

    // Check for test-related exports
    if (unusedExports.some(e => e.name.includes('test') || e.name.includes('mock'))) {
      reasons.push('test-only');
    }

    // Default to dead-code if no other reason
    if (reasons.length === 0) {
      reasons.push('dead-code');
    }

    return reasons;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createModuleCouplingAnalyzer(options: ModuleCouplingOptions): ModuleCouplingAnalyzer {
  return new ModuleCouplingAnalyzer(options);
}
