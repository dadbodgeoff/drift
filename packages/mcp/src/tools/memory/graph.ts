/**
 * drift_memory_graph
 * 
 * Visualize memory relationships and causal connections.
 * Returns graph data for understanding memory structure.
 */

import { getCortex, type Memory } from 'driftdetect-cortex';

interface GraphNode {
  id: string;
  type: string;
  label: string;
  confidence: number;
  importance: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  strength: number;
}

interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    avgConnections: number;
    mostConnected: string | null;
  };
  mermaid: string;
}

/**
 * Drift memory graph tool definition
 */
export const driftMemoryGraph = {
  name: 'drift_memory_graph',
  description: 'Visualize memory relationships and causal connections. Returns graph data for understanding memory structure.',
  parameters: {
    type: 'object',
    properties: {
      rootMemoryId: {
        type: 'string',
        description: 'Optional: start from a specific memory',
      },
      scope: {
        type: 'string',
        description: 'Optional: limit to memories related to this file or topic',
      },
      maxNodes: {
        type: 'number',
        default: 50,
        description: 'Maximum nodes to include',
      },
      includeRelationships: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relationship types to include (default: all)',
      },
      format: {
        type: 'string',
        enum: ['json', 'mermaid'],
        default: 'json',
        description: 'Output format',
      },
    },
  },

  async execute(params: {
    rootMemoryId?: string;
    scope?: string;
    maxNodes?: number;
    includeRelationships?: string[];
    format?: 'json' | 'mermaid';
  }): Promise<GraphResult> {
    const cortex = await getCortex();
    const maxNodes = params.maxNodes ?? 50;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // Get starting memories
    let memories: Memory[];
    if (params.rootMemoryId) {
      const rootMemory = await cortex.storage.read(params.rootMemoryId);
      if (rootMemory) {
        memories = [rootMemory];
        // Also get related memories
        const related = await cortex.storage.getRelated(params.rootMemoryId);
        memories.push(...related);
      } else {
        memories = [];
      }
    } else if (params.scope) {
      memories = await cortex.storage.findByFile(params.scope);
    } else {
      memories = await cortex.storage.search({ limit: maxNodes });
    }

    // Build nodes
    for (const memory of memories.slice(0, maxNodes)) {
      if (!nodeIds.has(memory.id)) {
        nodeIds.add(memory.id);
        nodes.push({
          id: memory.id,
          type: memory.type,
          label: memory.summary.slice(0, 50) + (memory.summary.length > 50 ? '...' : ''),
          confidence: memory.confidence,
          importance: memory.importance ?? 'normal',
        });
      }
    }

    // Build edges from relationships
    const relationshipTypes = params.includeRelationships ?? ['supersedes', 'supports', 'contradicts', 'related', 'derived_from'];
    
    for (const node of nodes) {
      for (const relType of relationshipTypes) {
        try {
          const related = await cortex.storage.getRelated(node.id, relType as 'supersedes' | 'supports' | 'contradicts' | 'related' | 'derived_from');
          for (const relatedMemory of related) {
            if (nodeIds.has(relatedMemory.id)) {
              edges.push({
                source: node.id,
                target: relatedMemory.id,
                relationship: relType,
                strength: relatedMemory.confidence,
              });
            }
          }
        } catch {
          // Relationship type not supported, skip
        }
      }
    }

    // Calculate stats
    const connectionCounts = new Map<string, number>();
    for (const edge of edges) {
      connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
      connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
    }

    let mostConnected: string | null = null;
    let maxConnections = 0;
    for (const [id, count] of connectionCounts) {
      if (count > maxConnections) {
        maxConnections = count;
        mostConnected = id;
      }
    }

    const avgConnections = nodes.length > 0 
      ? edges.length * 2 / nodes.length 
      : 0;

    // Generate Mermaid diagram
    const mermaid = generateMermaid(nodes, edges);

    return {
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        avgConnections: Math.round(avgConnections * 100) / 100,
        mostConnected,
      },
      mermaid,
    };
  },
};

function generateMermaid(nodes: GraphNode[], edges: GraphEdge[]): string {
  const lines: string[] = ['graph TD'];
  
  // Add nodes
  for (const node of nodes.slice(0, 20)) {
    const label = node.label.replace(/"/g, "'").replace(/\n/g, ' ');
    const shape = getNodeShape(node.type);
    lines.push(`    ${sanitizeId(node.id)}${shape[0]}"${label}"${shape[1]}`);
  }

  // Add edges
  for (const edge of edges.slice(0, 30)) {
    const arrow = getEdgeArrow(edge.relationship);
    lines.push(`    ${sanitizeId(edge.source)} ${arrow} ${sanitizeId(edge.target)}`);
  }

  return lines.join('\n');
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
}

function getNodeShape(type: string): [string, string] {
  switch (type) {
    case 'tribal':
      return ['((', '))'];
    case 'pattern_rationale':
      return ['[/', '/]'];
    case 'code_smell':
      return ['{{', '}}'];
    case 'procedural':
      return ['[[', ']]'];
    default:
      return ['[', ']'];
  }
}

function getEdgeArrow(relationship: string): string {
  switch (relationship) {
    case 'supersedes':
      return '==>';
    case 'contradicts':
      return 'x--x';
    case 'supports':
      return '-->';
    case 'derived_from':
      return '-..->';
    default:
      return '---';
  }
}
