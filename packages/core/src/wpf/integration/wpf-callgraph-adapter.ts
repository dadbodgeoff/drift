/**
 * WPF Call Graph Adapter
 *
 * Integrates WPF-specific nodes into the existing call graph.
 * Creates edges between XAML bindings, ViewModels, and data access.
 */

import type {
  WpfCallGraphNode,
  WpfCallGraphEdge,
  WpfNodeType,
  XamlExtractionResult,
  ViewModelAnalysis,
  ViewModelLink,
  DataContextResolution,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface WpfCallGraphIntegration {
  /** WPF-specific nodes */
  nodes: WpfCallGraphNode[];
  /** WPF-specific edges */
  edges: WpfCallGraphEdge[];
  /** Statistics */
  stats: WpfCallGraphStats;
}

export interface WpfCallGraphStats {
  /** Total nodes added */
  totalNodes: number;
  /** Total edges added */
  totalEdges: number;
  /** Nodes by type */
  nodesByType: Record<WpfNodeType, number>;
  /** Edges by type */
  edgesByType: Record<string, number>;
}

// ============================================================================
// WPF Call Graph Adapter
// ============================================================================

export class WpfCallGraphAdapter {
  private nodes: Map<string, WpfCallGraphNode> = new Map();
  private edges: WpfCallGraphEdge[] = [];

  /**
   * Build WPF call graph from analysis results
   */
  build(
    xamlFiles: Map<string, XamlExtractionResult>,
    viewModels: Map<string, ViewModelAnalysis>,
    links: ViewModelLink[],
    dataContexts: DataContextResolution[]
  ): WpfCallGraphIntegration {
    // Clear previous data
    this.nodes.clear();
    this.edges = [];

    // Add ViewModel nodes
    for (const vm of viewModels.values()) {
      this.addViewModelNodes(vm);
    }

    // Add XAML nodes
    for (const [filePath, xaml] of xamlFiles) {
      this.addXamlNodes(filePath, xaml);
    }

    // Add binding edges from links
    for (const link of links) {
      this.addBindingEdge(link);
    }

    // Add DataContext inheritance edges
    for (const dc of dataContexts) {
      this.addDataContextEdge(dc);
    }

    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      stats: this.calculateStats(),
    };
  }

  /**
   * Add ViewModel nodes
   */
  private addViewModelNodes(vm: ViewModelAnalysis): void {
    // Add property nodes
    for (const prop of vm.properties) {
      const nodeId = `csharp:${vm.className}:${prop.name}`;
      this.nodes.set(nodeId, {
        id: nodeId,
        type: 'viewmodel-property',
        name: prop.name,
        file: vm.filePath,
        line: prop.location.line,
        metadata: {
          propertyType: prop.type,
          notifiesChange: prop.raisesPropertyChanged,
        },
      });
    }

    // Add command nodes
    for (const cmd of vm.commands) {
      const nodeId = `csharp:${vm.className}:${cmd.name}`;
      const metadata: Record<string, string> = {};
      if (cmd.executeMethod !== undefined) {
        metadata['executeMethod'] = cmd.executeMethod;
      }
      if (cmd.canExecuteMethod !== undefined) {
        metadata['canExecuteMethod'] = cmd.canExecuteMethod;
      }
      
      this.nodes.set(nodeId, {
        id: nodeId,
        type: 'viewmodel-command',
        name: cmd.name,
        file: vm.filePath,
        line: cmd.location.line,
        metadata,
      });

      // Add edge to execute method if known
      if (cmd.executeMethod) {
        const executeNodeId = `csharp:${vm.className}:${cmd.executeMethod}`;
        this.edges.push({
          source: nodeId,
          target: executeNodeId,
          type: 'invokes-command',
          confidence: 0.95,
        });
      }
    }
  }

  /**
   * Add XAML nodes
   */
  private addXamlNodes(filePath: string, xaml: XamlExtractionResult): void {
    const xClass = xaml.xClass ?? filePath;

    // Add binding nodes
    for (const binding of xaml.bindings) {
      const nodeId = `xaml:${xClass}:${binding.elementName}:${binding.property}`;
      this.nodes.set(nodeId, {
        id: nodeId,
        type: 'xaml-binding',
        name: `${binding.elementName}.${binding.property}`,
        file: filePath,
        line: binding.location.line,
        metadata: {
          bindingPath: binding.parsed.path,
          bindingMode: binding.parsed.mode,
        },
      });
    }

    // Add command nodes
    for (const command of xaml.commands) {
      const nodeId = `xaml:${xClass}:${command.elementName}:Command`;
      this.nodes.set(nodeId, {
        id: nodeId,
        type: 'xaml-command',
        name: `${command.elementName}.Command`,
        file: filePath,
        line: command.location.line,
        metadata: {
          bindingPath: command.binding,
        },
      });
    }
  }

  /**
   * Add binding edge from link
   */
  private addBindingEdge(link: ViewModelLink): void {
    const sourceId = `xaml:${link.xamlFile}:${link.xamlElement}:${link.bindingPath}`;
    const targetId = `csharp:${link.viewModelClass}:${link.viewModelProperty}`;

    // Ensure nodes exist
    if (!this.nodes.has(sourceId)) {
      this.nodes.set(sourceId, {
        id: sourceId,
        type: 'xaml-binding',
        name: `${link.xamlElement}.${link.bindingPath}`,
        file: link.xamlFile,
        line: link.locations.xaml.line,
        metadata: {
          bindingPath: link.bindingPath,
        },
      });
    }

    this.edges.push({
      source: sourceId,
      target: targetId,
      type: 'binds-to',
      confidence: link.confidence,
    });
  }

  /**
   * Add DataContext inheritance edge
   */
  private addDataContextEdge(dc: DataContextResolution): void {
    if (!dc.resolvedType) {return;}

    const sourceId = `xaml:${dc.xamlFile}:root`;
    const targetId = `csharp:${dc.resolvedType}`;

    // Add root element node if not exists
    if (!this.nodes.has(sourceId)) {
      this.nodes.set(sourceId, {
        id: sourceId,
        type: 'xaml-element',
        name: dc.xamlFile,
        file: dc.xamlFile,
        line: 1,
        metadata: {},
      });
    }

    this.edges.push({
      source: sourceId,
      target: targetId,
      type: 'inherits-context',
      confidence: dc.confidence === 'high' ? 0.95 : dc.confidence === 'medium' ? 0.7 : 0.4,
    });
  }

  /**
   * Get node by ID
   */
  getNode(id: string): WpfCallGraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get edges from a node
   */
  getOutgoingEdges(nodeId: string): WpfCallGraphEdge[] {
    return this.edges.filter(e => e.source === nodeId);
  }

  /**
   * Get edges to a node
   */
  getIncomingEdges(nodeId: string): WpfCallGraphEdge[] {
    return this.edges.filter(e => e.target === nodeId);
  }

  /**
   * Find path between two nodes
   */
  findPath(sourceId: string, targetId: string, maxDepth: number = 10): string[] | null {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: sourceId, path: [sourceId] }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === targetId) {
        return current.path;
      }

      if (current.path.length >= maxDepth) {
        continue;
      }

      if (visited.has(current.nodeId)) {
        continue;
      }
      visited.add(current.nodeId);

      const outgoing = this.getOutgoingEdges(current.nodeId);
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          queue.push({
            nodeId: edge.target,
            path: [...current.path, edge.target],
          });
        }
      }
    }

    return null;
  }

  /**
   * Get all nodes reachable from a starting node
   */
  getReachableNodes(startId: string, maxDepth: number = 10): WpfCallGraphNode[] {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startId, depth: 0 }];
    const reachable: WpfCallGraphNode[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.nodeId) || current.depth > maxDepth) {
        continue;
      }
      visited.add(current.nodeId);

      const node = this.nodes.get(current.nodeId);
      if (node) {
        reachable.push(node);
      }

      const outgoing = this.getOutgoingEdges(current.nodeId);
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          queue.push({
            nodeId: edge.target,
            depth: current.depth + 1,
          });
        }
      }
    }

    return reachable;
  }

  /**
   * Calculate statistics
   */
  private calculateStats(): WpfCallGraphStats {
    const nodesByType: Record<WpfNodeType, number> = {
      'xaml-element': 0,
      'xaml-binding': 0,
      'xaml-command': 0,
      'viewmodel-property': 0,
      'viewmodel-command': 0,
      'dependency-property': 0,
      'value-converter': 0,
      'code-behind-handler': 0,
    };

    const edgesByType: Record<string, number> = {};

    for (const node of this.nodes.values()) {
      nodesByType[node.type]++;
    }

    for (const edge of this.edges) {
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
    }

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      nodesByType,
      edgesByType,
    };
  }

  /**
   * Export to JSON format compatible with existing call graph
   */
  exportToJson(): object {
    return {
      nodes: Array.from(this.nodes.values()).map(node => ({
        id: node.id,
        type: node.type,
        name: node.name,
        file: node.file,
        line: node.line,
        ...node.metadata,
      })),
      edges: this.edges.map(edge => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        confidence: edge.confidence,
      })),
    };
  }
}

/**
 * Factory function
 */
export function createWpfCallGraphAdapter(): WpfCallGraphAdapter {
  return new WpfCallGraphAdapter();
}
