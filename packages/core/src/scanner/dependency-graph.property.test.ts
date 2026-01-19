/**
 * Property-Based Tests for DependencyGraph - Cycle Detection
 *
 * Property 13: Dependency Graph Acyclicity Detection
 * For any graph with cycles, all cycles SHALL be detected
 * **Validates: Requirements 2.4, 7.7**
 *
 * @requirements 2.4 - THE Scanner SHALL detect circular dependencies and flag them
 * @requirements 7.7 - THE Structural_Detector SHALL detect circular dependencies
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DependencyGraph, type ImportInfo } from './dependency-graph.js';

/**
 * Helper to create a valid module path
 */
const modulePathArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), { minLength: 2, maxLength: 8 }),
    fc.constantFrom('.ts', '.js', '.tsx', '.jsx')
  )
  .map(([name, ext]) => `/src/${name}${ext}`);

/**
 * Helper to create a unique set of module paths
 */
const uniqueModulePathsArb = (minLength: number, maxLength: number) =>
  fc
    .array(modulePathArb, { minLength, maxLength })
    .map((paths) => [...new Set(paths)])
    .filter((paths) => paths.length >= minLength);

/**
 * Helper to create an import info object
 */
function createImportInfo(source: string, resolvedPath: string): ImportInfo {
  return {
    source,
    resolvedPath,
    specifiers: [],
    type: 'es-module',
    sideEffectOnly: false,
    line: 1,
    column: 0,
  };
}

/**
 * Helper to add a module with dependencies to the graph
 */
function addModuleWithDeps(
  graph: DependencyGraph,
  modulePath: string,
  dependencies: string[]
): void {
  const imports = dependencies.map((dep) => createImportInfo(dep, dep));
  graph.addModule(modulePath, imports, []);
}

/**
 * Helper to create a simple cycle in the graph
 * Returns the nodes in the cycle
 */
function createCycle(graph: DependencyGraph, nodes: string[]): string[] {
  if (nodes.length < 2) {
    // Self-referencing cycle
    addModuleWithDeps(graph, nodes[0], [nodes[0]]);
    return nodes;
  }

  // Create chain: A -> B -> C -> ... -> A
  for (let i = 0; i < nodes.length; i++) {
    const current = nodes[i];
    const next = nodes[(i + 1) % nodes.length];
    addModuleWithDeps(graph, current, [next]);
  }

  return nodes;
}

/**
 * Helper to create an acyclic chain in the graph
 */
function createAcyclicChain(graph: DependencyGraph, nodes: string[]): void {
  // Create chain: A -> B -> C -> ... (no back edge)
  for (let i = 0; i < nodes.length - 1; i++) {
    addModuleWithDeps(graph, nodes[i], [nodes[i + 1]]);
  }
  // Last node has no dependencies
  addModuleWithDeps(graph, nodes[nodes.length - 1], []);
}

describe('DependencyGraph Property Tests', () => {
  /**
   * Property 13: Dependency Graph Acyclicity Detection
   * For any graph with cycles, all cycles SHALL be detected
   * **Validates: Requirements 2.4, 7.7**
   */
  describe('Property 13: Dependency Graph Acyclicity Detection', () => {
    it('should detect hasCircularDependency() === true when a cycle is introduced', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(2, 6),
          async (nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Create a cycle with the given nodes
            createCycle(graph, nodes);

            // PROPERTY: hasCircularDependency() must return true
            expect(graph.hasCircularDependency()).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return hasCircularDependency() === false for acyclic graphs', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(2, 8),
          async (nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Create an acyclic chain
            createAcyclicChain(graph, nodes);

            // PROPERTY: hasCircularDependency() must return false
            expect(graph.hasCircularDependency()).toBe(false);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should report all nodes in a cycle via getCircularDependencies()', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(2, 5),
          async (nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Create a cycle with the given nodes
            createCycle(graph, nodes);

            // Get detected cycles
            const cycles = graph.getCircularDependencies();

            // PROPERTY: At least one cycle should be detected
            expect(cycles.length).toBeGreaterThan(0);

            // PROPERTY: All nodes in the cycle should be reported
            const allNodesInCycles = new Set(cycles.flat());
            for (const node of nodes) {
              expect(allNodesInCycles.has(node)).toBe(true);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect self-referencing cycles (node imports itself)', async () => {
      await fc.assert(
        fc.asyncProperty(
          modulePathArb,
          async (modulePath) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Create a self-referencing cycle
            addModuleWithDeps(graph, modulePath, [modulePath]);

            // PROPERTY: hasCircularDependency() must return true
            expect(graph.hasCircularDependency()).toBe(true);

            // PROPERTY: The self-referencing node should be in the cycles
            const cycles = graph.getCircularDependencies();
            expect(cycles.length).toBeGreaterThan(0);

            const allNodesInCycles = new Set(cycles.flat());
            expect(allNodesInCycles.has(modulePath)).toBe(true);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should detect multiple independent cycles in the same graph', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(2, 4),
          uniqueModulePathsArb(2, 4),
          async (cycle1Nodes, cycle2Nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Ensure the two cycles don't share nodes
            const cycle1Set = new Set(cycle1Nodes);
            const filteredCycle2 = cycle2Nodes.filter((n) => !cycle1Set.has(n));

            if (filteredCycle2.length < 2) {
              return true; // Skip if not enough unique nodes for second cycle
            }

            // Create two independent cycles
            createCycle(graph, cycle1Nodes);
            createCycle(graph, filteredCycle2);

            // PROPERTY: hasCircularDependency() must return true
            expect(graph.hasCircularDependency()).toBe(true);

            // PROPERTY: All nodes from both cycles should be detected
            const modulesInCycles = graph.getModulesInCycles();
            const modulesSet = new Set(modulesInCycles);

            for (const node of cycle1Nodes) {
              expect(modulesSet.has(node)).toBe(true);
            }
            for (const node of filteredCycle2) {
              expect(modulesSet.has(node)).toBe(true);
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should detect cycles even when mixed with acyclic parts', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(2, 4),
          uniqueModulePathsArb(2, 4),
          async (cycleNodes, acyclicNodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Ensure the cycle and acyclic parts don't share nodes
            const cycleSet = new Set(cycleNodes);
            const filteredAcyclic = acyclicNodes.filter((n) => !cycleSet.has(n));

            if (filteredAcyclic.length < 2) {
              return true; // Skip if not enough unique nodes
            }

            // Create a cycle
            createCycle(graph, cycleNodes);

            // Create an acyclic chain
            createAcyclicChain(graph, filteredAcyclic);

            // PROPERTY: hasCircularDependency() must return true (cycle exists)
            expect(graph.hasCircularDependency()).toBe(true);

            // PROPERTY: Only cycle nodes should be in getModulesInCycles()
            const modulesInCycles = graph.getModulesInCycles();
            const modulesSet = new Set(modulesInCycles);

            // All cycle nodes should be detected
            for (const node of cycleNodes) {
              expect(modulesSet.has(node)).toBe(true);
            }

            // Acyclic nodes should NOT be in cycles
            for (const node of filteredAcyclic) {
              expect(modulesSet.has(node)).toBe(false);
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle diamond dependency pattern without false positive cycles', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(4, 4),
          async (nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Diamond pattern:
            //     A
            //    / \
            //   B   C
            //    \ /
            //     D
            const [a, b, c, d] = nodes;

            // D has no dependencies
            addModuleWithDeps(graph, d, []);
            // B and C both depend on D
            addModuleWithDeps(graph, b, [d]);
            addModuleWithDeps(graph, c, [d]);
            // A depends on both B and C
            addModuleWithDeps(graph, a, [b, c]);

            // PROPERTY: Diamond pattern is NOT a cycle
            expect(graph.hasCircularDependency()).toBe(false);
            expect(graph.getCircularDependencies()).toHaveLength(0);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should detect cycles of varying lengths (2 to N nodes)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 10 }),
          async (cycleLength) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Generate unique paths for the cycle
            const nodes: string[] = [];
            for (let i = 0; i < cycleLength; i++) {
              nodes.push(`/src/module${i}.ts`);
            }

            // Create a cycle of the specified length
            createCycle(graph, nodes);

            // PROPERTY: hasCircularDependency() must return true
            expect(graph.hasCircularDependency()).toBe(true);

            // PROPERTY: All nodes should be detected in cycles
            const modulesInCycles = graph.getModulesInCycles();
            expect(modulesInCycles.length).toBe(cycleLength);

            const modulesSet = new Set(modulesInCycles);
            for (const node of nodes) {
              expect(modulesSet.has(node)).toBe(true);
            }

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should correctly identify cycle membership via getModulesInCycles()', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(3, 6),
          async (nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Create a cycle
            createCycle(graph, nodes);

            // Get modules in cycles
            const modulesInCycles = graph.getModulesInCycles();

            // PROPERTY: The set of modules in cycles should exactly match the cycle nodes
            expect(new Set(modulesInCycles)).toEqual(new Set(nodes));

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle empty graph correctly', async () => {
      // Create a fresh graph
      const graph = new DependencyGraph();

      // Empty graph should have no cycles
      expect(graph.hasCircularDependency()).toBe(false);
      expect(graph.getCircularDependencies()).toHaveLength(0);
      expect(graph.getModulesInCycles()).toHaveLength(0);
    });

    it('should handle single node without self-reference correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          modulePathArb,
          async (modulePath) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Add a single node with no dependencies
            addModuleWithDeps(graph, modulePath, []);

            // PROPERTY: Single node without self-reference is not a cycle
            expect(graph.hasCircularDependency()).toBe(false);
            expect(graph.getCircularDependencies()).toHaveLength(0);

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should detect cycles when back edge creates a cycle in existing graph', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(3, 6),
          async (nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Build a graph where we explicitly create a cycle by having
            // the last node depend on the first node
            // Chain: A -> B -> C -> ... -> Z -> A (cycle!)
            for (let i = 0; i < nodes.length; i++) {
              const current = nodes[i];
              const next = nodes[(i + 1) % nodes.length]; // Wraps around to create cycle
              addModuleWithDeps(graph, current, [next]);
            }

            // PROPERTY: This graph has a cycle, so hasCircularDependency() must be true
            expect(graph.hasCircularDependency()).toBe(true);

            // PROPERTY: All nodes should be in the cycle
            const modulesInCycles = graph.getModulesInCycles();
            expect(modulesInCycles.length).toBe(nodes.length);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should maintain cycle detection consistency after module removal', async () => {
      await fc.assert(
        fc.asyncProperty(
          uniqueModulePathsArb(3, 5),
          async (nodes) => {
            // Create a fresh graph for each test iteration
            const graph = new DependencyGraph();

            // Create a cycle
            createCycle(graph, nodes);

            // Verify cycle exists
            expect(graph.hasCircularDependency()).toBe(true);

            // Remove one node from the cycle
            const removedNode = nodes[0];
            graph.removeModule(removedNode);

            // PROPERTY: After removing a node from the cycle, the cycle should be broken
            // (for a simple cycle where each node has exactly one dependency)
            expect(graph.hasCircularDependency()).toBe(false);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
