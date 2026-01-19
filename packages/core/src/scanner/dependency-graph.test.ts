/**
 * Unit tests for DependencyGraph
 *
 * @requirements 2.3 - THE Scanner SHALL build and maintain a dependency graph of imports/exports
 * @requirements 2.4 - THE Scanner SHALL detect circular dependencies and flag them
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DependencyGraph,
  type ImportInfo,
  type ExportInfo,
} from './dependency-graph.js';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('addModule', () => {
    it('should add a module with no dependencies', () => {
      const imports: ImportInfo[] = [];
      const exports: ExportInfo[] = [
        { name: 'foo', type: 'named', line: 1, column: 0 },
      ];

      graph.addModule('/src/utils.ts', imports, exports);

      expect(graph.hasModule('/src/utils.ts')).toBe(true);
      expect(graph.size).toBe(1);
    });

    it('should add a module with dependencies', () => {
      // First add the dependency
      graph.addModule('/src/utils.ts', [], [
        { name: 'helper', type: 'named', line: 1, column: 0 },
      ]);

      // Then add the module that imports it
      const imports: ImportInfo[] = [
        {
          source: './utils',
          resolvedPath: '/src/utils.ts',
          specifiers: [
            { imported: 'helper', local: 'helper', isDefault: false, isNamespace: false },
          ],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ];

      graph.addModule('/src/index.ts', imports, []);

      expect(graph.getDependencies('/src/index.ts')).toContain('/src/utils.ts');
      expect(graph.getDependents('/src/utils.ts')).toContain('/src/index.ts');
    });

    it('should create placeholder nodes for unresolved dependencies', () => {
      const imports: ImportInfo[] = [
        {
          source: './unknown',
          resolvedPath: '/src/unknown.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ];

      graph.addModule('/src/index.ts', imports, []);

      expect(graph.hasModule('/src/unknown.ts')).toBe(true);
      const unknownModule = graph.getModule('/src/unknown.ts');
      expect(unknownModule?.analyzed).toBe(false);
    });

    it('should normalize paths with backslashes', () => {
      graph.addModule('C:\\src\\utils.ts', [], []);
      expect(graph.hasModule('C:/src/utils.ts')).toBe(true);
    });

    it('should filter out type-only imports when trackTypeImports is false', () => {
      const graphNoTypes = new DependencyGraph({ trackTypeImports: false });

      const imports: ImportInfo[] = [
        {
          source: './types',
          resolvedPath: '/src/types.ts',
          specifiers: [],
          type: 'type-only',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ];

      graphNoTypes.addModule('/src/index.ts', imports, []);

      expect(graphNoTypes.getDependencies('/src/index.ts')).toHaveLength(0);
    });

    it('should filter out node_modules imports when includeNodeModules is false', () => {
      const imports: ImportInfo[] = [
        {
          source: 'lodash',
          resolvedPath: '/node_modules/lodash/index.js',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ];

      graph.addModule('/src/index.ts', imports, []);

      // lodash should not be in dependencies since includeNodeModules defaults to false
      expect(graph.getDependencies('/src/index.ts')).toHaveLength(0);
    });
  });

  describe('removeModule', () => {
    it('should remove a module and clean up relationships', () => {
      // Set up a simple dependency chain: A -> B -> C
      graph.addModule('/src/c.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      // Remove B
      graph.removeModule('/src/b.ts');

      expect(graph.hasModule('/src/b.ts')).toBe(false);
      expect(graph.getDependencies('/src/a.ts')).not.toContain('/src/b.ts');
      expect(graph.getDependents('/src/c.ts')).not.toContain('/src/b.ts');
    });

    it('should handle removing non-existent module gracefully', () => {
      expect(() => graph.removeModule('/src/nonexistent.ts')).not.toThrow();
    });
  });

  describe('getDependencies', () => {
    it('should return empty array for module with no dependencies', () => {
      graph.addModule('/src/utils.ts', [], []);
      expect(graph.getDependencies('/src/utils.ts')).toEqual([]);
    });

    it('should return empty array for non-existent module', () => {
      expect(graph.getDependencies('/src/nonexistent.ts')).toEqual([]);
    });

    it('should return direct dependencies only', () => {
      // C has no deps, B depends on C, A depends on B
      graph.addModule('/src/c.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const deps = graph.getDependencies('/src/a.ts');
      expect(deps).toContain('/src/b.ts');
      expect(deps).not.toContain('/src/c.ts'); // Not a direct dependency
    });
  });

  describe('getDependents', () => {
    it('should return empty array for module with no dependents', () => {
      graph.addModule('/src/utils.ts', [], []);
      expect(graph.getDependents('/src/utils.ts')).toEqual([]);
    });

    it('should return direct dependents only', () => {
      graph.addModule('/src/c.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const dependents = graph.getDependents('/src/c.ts');
      expect(dependents).toContain('/src/b.ts');
      expect(dependents).not.toContain('/src/a.ts'); // Not a direct dependent
    });
  });

  describe('getTransitiveDependencies', () => {
    it('should return all transitive dependencies', () => {
      graph.addModule('/src/d.ts', [], []);
      graph.addModule('/src/c.ts', [
        {
          source: './d',
          resolvedPath: '/src/d.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const transitiveDeps = graph.getTransitiveDependencies('/src/a.ts');
      expect(transitiveDeps).toContain('/src/b.ts');
      expect(transitiveDeps).toContain('/src/c.ts');
      expect(transitiveDeps).toContain('/src/d.ts');
    });

    it('should handle cycles without infinite loop', () => {
      // Create a cycle: A -> B -> C -> A
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/c.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      // Should not hang
      const deps = graph.getTransitiveDependencies('/src/a.ts');
      expect(deps).toContain('/src/b.ts');
      expect(deps).toContain('/src/c.ts');
    });
  });

  describe('getTransitiveDependents', () => {
    it('should return all transitive dependents', () => {
      graph.addModule('/src/d.ts', [], []);
      graph.addModule('/src/c.ts', [
        {
          source: './d',
          resolvedPath: '/src/d.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const transitiveDependents = graph.getTransitiveDependents('/src/d.ts');
      expect(transitiveDependents).toContain('/src/c.ts');
      expect(transitiveDependents).toContain('/src/b.ts');
      expect(transitiveDependents).toContain('/src/a.ts');
    });
  });

  describe('getTopologicalOrder', () => {
    it('should return modules in correct build order', () => {
      graph.addModule('/src/c.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const order = graph.getTopologicalOrder();

      // C should come before B, B should come before A
      const indexC = order.indexOf('/src/c.ts');
      const indexB = order.indexOf('/src/b.ts');
      const indexA = order.indexOf('/src/a.ts');

      expect(indexC).toBeLessThan(indexB);
      expect(indexB).toBeLessThan(indexA);
    });

    it('should throw error when circular dependency exists', () => {
      // Create a cycle: A -> B -> A
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      expect(() => graph.getTopologicalOrder()).toThrow(/Circular dependency/);
    });
  });

  describe('hasCircularDependency', () => {
    it('should return false for acyclic graph', () => {
      graph.addModule('/src/c.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      expect(graph.hasCircularDependency()).toBe(false);
    });

    it('should return true for cyclic graph', () => {
      // Create a cycle: A -> B -> A
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      expect(graph.hasCircularDependency()).toBe(true);
    });
  });

  describe('getCircularDependencies', () => {
    it('should return empty array for acyclic graph', () => {
      graph.addModule('/src/a.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      expect(graph.getCircularDependencies()).toEqual([]);
    });

    it('should detect simple two-node cycle', () => {
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const cycles = graph.getCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);

      // The cycle should contain both a.ts and b.ts
      const cycleNodes = new Set(cycles[0]);
      expect(cycleNodes.has('/src/a.ts')).toBe(true);
      expect(cycleNodes.has('/src/b.ts')).toBe(true);
    });

    it('should detect three-node cycle', () => {
      // A -> B -> C -> A
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/c.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const cycles = graph.getCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);

      // The cycle should contain all three nodes
      const cycleNodes = new Set(cycles[0]);
      expect(cycleNodes.has('/src/a.ts')).toBe(true);
      expect(cycleNodes.has('/src/b.ts')).toBe(true);
      expect(cycleNodes.has('/src/c.ts')).toBe(true);
    });

    it('should detect self-referencing cycle', () => {
      graph.addModule('/src/a.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const cycles = graph.getCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('detectCircularDependencies', () => {
    it('should return detailed result for cyclic graph', () => {
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const result = graph.detectCircularDependencies();
      expect(result.hasCircular).toBe(true);
      expect(result.cycles.length).toBeGreaterThan(0);
    });
  });

  describe('getLeafModules', () => {
    it('should return modules with no dependencies', () => {
      graph.addModule('/src/leaf1.ts', [], []);
      graph.addModule('/src/leaf2.ts', [], []);
      graph.addModule('/src/parent.ts', [
        {
          source: './leaf1',
          resolvedPath: '/src/leaf1.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const leaves = graph.getLeafModules();
      expect(leaves).toContain('/src/leaf1.ts');
      expect(leaves).toContain('/src/leaf2.ts');
      expect(leaves).not.toContain('/src/parent.ts');
    });
  });

  describe('getRootModules', () => {
    it('should return modules with no dependents', () => {
      graph.addModule('/src/leaf.ts', [], []);
      graph.addModule('/src/root1.ts', [
        {
          source: './leaf',
          resolvedPath: '/src/leaf.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/root2.ts', [], []);

      const roots = graph.getRootModules();
      expect(roots).toContain('/src/root1.ts');
      expect(roots).toContain('/src/root2.ts');
      expect(roots).not.toContain('/src/leaf.ts');
    });
  });

  describe('getModulesInCycles', () => {
    it('should return all modules involved in cycles', () => {
      // Create two separate cycles
      // Cycle 1: A -> B -> A
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      // Non-cyclic module
      graph.addModule('/src/c.ts', [], []);

      const modulesInCycles = graph.getModulesInCycles();
      expect(modulesInCycles).toContain('/src/a.ts');
      expect(modulesInCycles).toContain('/src/b.ts');
      expect(modulesInCycles).not.toContain('/src/c.ts');
    });
  });

  describe('getAllModules', () => {
    it('should return all module paths', () => {
      graph.addModule('/src/a.ts', [], []);
      graph.addModule('/src/b.ts', [], []);

      const modules = graph.getAllModules();
      expect(modules).toContain('/src/a.ts');
      expect(modules).toContain('/src/b.ts');
      expect(modules).toHaveLength(2);
    });
  });

  describe('getAllEdges', () => {
    it('should return all dependency edges', () => {
      graph.addModule('/src/a.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const edges = graph.getAllEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0].from).toBe('/src/b.ts');
      expect(edges[0].to).toBe('/src/a.ts');
    });
  });

  describe('clear', () => {
    it('should remove all modules and edges', () => {
      graph.addModule('/src/a.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './a',
          resolvedPath: '/src/a.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      graph.clear();

      expect(graph.size).toBe(0);
      expect(graph.edgeCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle diamond dependency pattern', () => {
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      graph.addModule('/src/d.ts', [], []);
      graph.addModule('/src/b.ts', [
        {
          source: './d',
          resolvedPath: '/src/d.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/c.ts', [
        {
          source: './d',
          resolvedPath: '/src/d.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);
      graph.addModule('/src/a.ts', [
        {
          source: './b',
          resolvedPath: '/src/b.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
        {
          source: './c',
          resolvedPath: '/src/c.ts',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: false,
          line: 2,
          column: 0,
        },
      ], []);

      expect(graph.hasCircularDependency()).toBe(false);

      const transitiveDeps = graph.getTransitiveDependencies('/src/a.ts');
      expect(transitiveDeps).toContain('/src/b.ts');
      expect(transitiveDeps).toContain('/src/c.ts');
      expect(transitiveDeps).toContain('/src/d.ts');

      const dependentsOfD = graph.getDependents('/src/d.ts');
      expect(dependentsOfD).toContain('/src/b.ts');
      expect(dependentsOfD).toContain('/src/c.ts');
    });

    it('should handle multiple imports from same module', () => {
      graph.addModule('/src/utils.ts', [], [
        { name: 'foo', type: 'named', line: 1, column: 0 },
        { name: 'bar', type: 'named', line: 2, column: 0 },
      ]);
      graph.addModule('/src/index.ts', [
        {
          source: './utils',
          resolvedPath: '/src/utils.ts',
          specifiers: [
            { imported: 'foo', local: 'foo', isDefault: false, isNamespace: false },
            { imported: 'bar', local: 'bar', isDefault: false, isNamespace: false },
          ],
          type: 'es-module',
          sideEffectOnly: false,
          line: 1,
          column: 0,
        },
      ], []);

      const deps = graph.getDependencies('/src/index.ts');
      expect(deps).toHaveLength(1);
      expect(deps).toContain('/src/utils.ts');
    });

    it('should handle side-effect only imports', () => {
      graph.addModule('/src/styles.css', [], []);
      graph.addModule('/src/index.ts', [
        {
          source: './styles.css',
          resolvedPath: '/src/styles.css',
          specifiers: [],
          type: 'es-module',
          sideEffectOnly: true,
          line: 1,
          column: 0,
        },
      ], []);

      expect(graph.getDependencies('/src/index.ts')).toContain('/src/styles.css');
    });
  });
});
