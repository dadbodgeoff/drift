/**
 * Dependency Graph - Import/export relationship tracking
 *
 * Builds and maintains a graph of module dependencies,
 * enabling circular dependency detection and topological sorting.
 *
 * @requirements 2.3 - THE Scanner SHALL build and maintain a dependency graph of imports/exports
 * @requirements 2.4 - THE Scanner SHALL detect circular dependencies and flag them
 */

/**
 * Type of import statement
 */
export type ImportType =
  | 'es-module' // ES6 import
  | 'commonjs' // require()
  | 'dynamic' // dynamic import()
  | 'type-only'; // import type

/**
 * Type of export statement
 */
export type ExportType =
  | 'named' // export { foo }
  | 'default' // export default
  | 're-export' // export { foo } from './bar'
  | 'namespace' // export * from './bar'
  | 'type-only'; // export type

/**
 * Information about an import statement
 */
export interface ImportInfo {
  /** The source module path (as written in the import statement) */
  source: string;

  /** Resolved absolute path to the imported module (if resolvable) */
  resolvedPath?: string;

  /** Imported specifiers (e.g., ['foo', 'bar'] for import { foo, bar }) */
  specifiers: ImportSpecifier[];

  /** Type of import */
  type: ImportType;

  /** Whether this is a side-effect only import (import './styles.css') */
  sideEffectOnly: boolean;

  /** Line number where the import appears */
  line: number;

  /** Column number where the import appears */
  column: number;
}

/**
 * Individual import specifier
 */
export interface ImportSpecifier {
  /** Name as exported from the source module */
  imported: string;

  /** Local name in the importing module (may differ due to aliasing) */
  local: string;

  /** Whether this is a default import */
  isDefault: boolean;

  /** Whether this is a namespace import (import * as foo) */
  isNamespace: boolean;
}

/**
 * Information about an export statement
 */
export interface ExportInfo {
  /** Name of the exported symbol */
  name: string;

  /** Type of export */
  type: ExportType;

  /** Source module for re-exports */
  source?: string;

  /** Original name if re-exported with alias */
  originalName?: string;

  /** Line number where the export appears */
  line: number;

  /** Column number where the export appears */
  column: number;
}

/**
 * Represents a module (file) in the dependency graph
 */
export interface ModuleNode {
  /** Absolute path to the module */
  path: string;

  /** All imports in this module */
  imports: ImportInfo[];

  /** All exports from this module */
  exports: ExportInfo[];

  /** Paths of modules this module imports (dependencies) */
  dependencies: Set<string>;

  /** Paths of modules that import this module (dependents) */
  dependents: Set<string>;

  /** Whether this module has been fully analyzed */
  analyzed: boolean;

  /** Last modification time when analyzed */
  analyzedAt?: Date;
}

/**
 * Represents an edge in the dependency graph
 */
export interface DependencyEdge {
  /** Source module (the one doing the importing) */
  from: string;

  /** Target module (the one being imported) */
  to: string;

  /** Import information for this edge */
  importInfo: ImportInfo;
}

/**
 * Result of circular dependency detection
 */
export interface CircularDependencyResult {
  /** Whether any circular dependencies were found */
  hasCircular: boolean;

  /** All detected cycles (each cycle is an array of file paths) */
  cycles: string[][];
}

/**
 * Options for dependency graph operations
 */
export interface DependencyGraphOptions {
  /** Whether to track type-only imports separately */
  trackTypeImports?: boolean;

  /** Whether to include node_modules in the graph */
  includeNodeModules?: boolean;
}

/**
 * Dependency Graph class for tracking module relationships
 *
 * @requirements 2.3 - Build and maintain a dependency graph of imports/exports
 * @requirements 2.4 - Detect circular dependencies and flag them
 */
export class DependencyGraph {
  /** Map of module path to module node */
  private modules: Map<string, ModuleNode> = new Map();

  /** All edges in the graph */
  private edges: DependencyEdge[] = [];

  /** Configuration options */
  private options: DependencyGraphOptions;

  constructor(options: DependencyGraphOptions = {}) {
    this.options = {
      trackTypeImports: true,
      includeNodeModules: false,
      ...options,
    };
  }

  /**
   * Add a module to the dependency graph
   *
   * @param path - Absolute path to the module
   * @param imports - Import statements in the module
   * @param exports - Export statements in the module
   */
  addModule(path: string, imports: ImportInfo[], exports: ExportInfo[]): void {
    const normalizedPath = this.normalizePath(path);

    // Filter imports based on options
    const filteredImports = imports.filter((imp) => {
      if (!this.options.trackTypeImports && imp.type === 'type-only') {
        return false;
      }
      if (!this.options.includeNodeModules && this.isNodeModule(imp.source)) {
        return false;
      }
      return true;
    });

    // Create or update the module node
    const existingNode = this.modules.get(normalizedPath);
    const dependencies = new Set<string>();

    // Build dependency set from imports
    for (const imp of filteredImports) {
      if (imp.resolvedPath) {
        const resolvedNormalized = this.normalizePath(imp.resolvedPath);
        dependencies.add(resolvedNormalized);

        // Add edge
        this.edges.push({
          from: normalizedPath,
          to: resolvedNormalized,
          importInfo: imp,
        });

        // Update the dependent's dependents set
        const targetModule = this.modules.get(resolvedNormalized);
        if (targetModule) {
          targetModule.dependents.add(normalizedPath);
        } else {
          // Create a placeholder node for the target
          this.modules.set(resolvedNormalized, {
            path: resolvedNormalized,
            imports: [],
            exports: [],
            dependencies: new Set(),
            dependents: new Set([normalizedPath]),
            analyzed: false,
          });
        }
      }
    }

    const moduleNode: ModuleNode = {
      path: normalizedPath,
      imports: filteredImports,
      exports,
      dependencies,
      dependents: existingNode?.dependents ?? new Set(),
      analyzed: true,
      analyzedAt: new Date(),
    };

    this.modules.set(normalizedPath, moduleNode);
  }

  /**
   * Remove a module from the dependency graph
   *
   * @param path - Absolute path to the module to remove
   */
  removeModule(path: string): void {
    const normalizedPath = this.normalizePath(path);
    const module = this.modules.get(normalizedPath);

    if (!module) {
      return;
    }

    // Remove this module from all dependents' dependency sets
    for (const dependent of module.dependents) {
      const dependentModule = this.modules.get(dependent);
      if (dependentModule) {
        dependentModule.dependencies.delete(normalizedPath);
      }
    }

    // Remove this module from all dependencies' dependent sets
    for (const dependency of module.dependencies) {
      const dependencyModule = this.modules.get(dependency);
      if (dependencyModule) {
        dependencyModule.dependents.delete(normalizedPath);
      }
    }

    // Remove edges involving this module
    this.edges = this.edges.filter(
      (edge) => edge.from !== normalizedPath && edge.to !== normalizedPath
    );

    // Remove the module
    this.modules.delete(normalizedPath);
  }

  /**
   * Get all modules that this module imports (direct dependencies)
   *
   * @param path - Absolute path to the module
   * @returns Array of paths to dependencies
   */
  getDependencies(path: string): string[] {
    const normalizedPath = this.normalizePath(path);
    const module = this.modules.get(normalizedPath);

    if (!module) {
      return [];
    }

    return Array.from(module.dependencies);
  }

  /**
   * Get all modules that import this module (direct dependents)
   *
   * @param path - Absolute path to the module
   * @returns Array of paths to dependents
   */
  getDependents(path: string): string[] {
    const normalizedPath = this.normalizePath(path);
    const module = this.modules.get(normalizedPath);

    if (!module) {
      return [];
    }

    return Array.from(module.dependents);
  }

  /**
   * Get all transitive dependencies of a module (recursive)
   *
   * @param path - Absolute path to the module
   * @returns Array of all transitive dependency paths
   */
  getTransitiveDependencies(path: string): string[] {
    const normalizedPath = this.normalizePath(path);
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (modulePath: string): void => {
      if (visited.has(modulePath)) {
        return;
      }
      visited.add(modulePath);

      const module = this.modules.get(modulePath);
      if (!module) {
        return;
      }

      for (const dep of module.dependencies) {
        if (dep !== normalizedPath) {
          result.push(dep);
          visit(dep);
        }
      }
    };

    visit(normalizedPath);
    return result;
  }

  /**
   * Get all transitive dependents of a module (recursive)
   *
   * @param path - Absolute path to the module
   * @returns Array of all transitive dependent paths
   */
  getTransitiveDependents(path: string): string[] {
    const normalizedPath = this.normalizePath(path);
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (modulePath: string): void => {
      if (visited.has(modulePath)) {
        return;
      }
      visited.add(modulePath);

      const module = this.modules.get(modulePath);
      if (!module) {
        return;
      }

      for (const dependent of module.dependents) {
        if (dependent !== normalizedPath) {
          result.push(dependent);
          visit(dependent);
        }
      }
    };

    visit(normalizedPath);
    return result;
  }

  /**
   * Get modules in topological order (build order)
   * Modules with no dependencies come first
   *
   * @returns Array of module paths in topological order
   * @throws Error if the graph contains cycles
   */
  getTopologicalOrder(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>(); // For cycle detection

    const visit = (path: string): void => {
      if (visited.has(path)) {
        return;
      }

      if (visiting.has(path)) {
        throw new Error(`Circular dependency detected involving: ${path}`);
      }

      visiting.add(path);

      const module = this.modules.get(path);
      if (module) {
        for (const dep of module.dependencies) {
          visit(dep);
        }
      }

      visiting.delete(path);
      visited.add(path);
      result.push(path);
    };

    // Visit all modules
    for (const path of this.modules.keys()) {
      visit(path);
    }

    return result;
  }

  /**
   * Check if the graph has any circular dependencies
   *
   * @returns true if circular dependencies exist
   * @requirements 2.4
   */
  hasCircularDependency(): boolean {
    return this.getCircularDependencies().length > 0;
  }

  /**
   * Get all circular dependencies in the graph
   *
   * @returns Array of cycles, where each cycle is an array of file paths
   * @requirements 2.4
   */
  getCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const module = this.modules.get(node);
      if (module) {
        for (const neighbor of module.dependencies) {
          if (!visited.has(neighbor)) {
            dfs(neighbor);
          } else if (recursionStack.has(neighbor)) {
            // Found a cycle - extract it from the path
            const cycleStart = path.indexOf(neighbor);
            if (cycleStart !== -1) {
              const cycle = [...path.slice(cycleStart), neighbor];
              // Only add if this cycle hasn't been found before
              if (!this.cycleExists(cycles, cycle)) {
                cycles.push(cycle);
              }
            }
          }
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    // Run DFS from each unvisited node
    for (const node of this.modules.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Get detailed circular dependency information
   *
   * @returns CircularDependencyResult with all cycles
   * @requirements 2.4
   */
  detectCircularDependencies(): CircularDependencyResult {
    const cycles = this.getCircularDependencies();
    return {
      hasCircular: cycles.length > 0,
      cycles,
    };
  }

  /**
   * Get a module node by path
   *
   * @param path - Absolute path to the module
   * @returns ModuleNode or undefined if not found
   */
  getModule(path: string): ModuleNode | undefined {
    return this.modules.get(this.normalizePath(path));
  }

  /**
   * Check if a module exists in the graph
   *
   * @param path - Absolute path to the module
   * @returns true if the module exists
   */
  hasModule(path: string): boolean {
    return this.modules.has(this.normalizePath(path));
  }

  /**
   * Get all modules in the graph
   *
   * @returns Array of all module paths
   */
  getAllModules(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * Get all edges in the graph
   *
   * @returns Array of all dependency edges
   */
  getAllEdges(): DependencyEdge[] {
    return [...this.edges];
  }

  /**
   * Get the number of modules in the graph
   */
  get size(): number {
    return this.modules.size;
  }

  /**
   * Get the number of edges in the graph
   */
  get edgeCount(): number {
    return this.edges.length;
  }

  /**
   * Clear all modules and edges from the graph
   */
  clear(): void {
    this.modules.clear();
    this.edges = [];
  }

  /**
   * Get modules with no dependencies (leaf nodes)
   *
   * @returns Array of module paths with no dependencies
   */
  getLeafModules(): string[] {
    const result: string[] = [];
    for (const [path, module] of this.modules) {
      if (module.dependencies.size === 0) {
        result.push(path);
      }
    }
    return result;
  }

  /**
   * Get modules with no dependents (root nodes)
   *
   * @returns Array of module paths with no dependents
   */
  getRootModules(): string[] {
    const result: string[] = [];
    for (const [path, module] of this.modules) {
      if (module.dependents.size === 0) {
        result.push(path);
      }
    }
    return result;
  }

  /**
   * Get modules that are part of any circular dependency
   *
   * @returns Array of module paths involved in cycles
   */
  getModulesInCycles(): string[] {
    const cycles = this.getCircularDependencies();
    const modulesInCycles = new Set<string>();

    for (const cycle of cycles) {
      for (const module of cycle) {
        modulesInCycles.add(module);
      }
    }

    return Array.from(modulesInCycles);
  }

  /**
   * Check if a specific cycle already exists in the cycles array
   * Cycles are considered equal if they contain the same nodes
   */
  private cycleExists(cycles: string[][], newCycle: string[]): boolean {
    const newCycleSet = new Set(newCycle.slice(0, -1)); // Exclude the repeated node at the end

    for (const existingCycle of cycles) {
      const existingSet = new Set(existingCycle.slice(0, -1));
      if (
        existingSet.size === newCycleSet.size &&
        [...newCycleSet].every((node) => existingSet.has(node))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalize a file path for consistent comparison
   */
  private normalizePath(path: string): string {
    // Normalize path separators and remove trailing slashes
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  /**
   * Check if an import source is a node_modules package
   */
  private isNodeModule(source: string): boolean {
    // Node modules don't start with . or /
    return !source.startsWith('.') && !source.startsWith('/');
  }
}
