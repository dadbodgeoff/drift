/**
 * drift_memory_query
 * 
 * Execute rich graph queries across memory relationships.
 * Supports natural language queries and structured MGQL.
 */

import { getCortex, type Memory, type MemoryType, type RelationshipType } from 'driftdetect-cortex';

/**
 * Graph query structure
 */
interface GraphQuery {
  from: MemorySelector;
  traverse: TraversalStep[];
  where?: FilterExpression;
  limit?: number;
  depth?: number;
}

interface MemorySelector {
  type?: MemoryType | MemoryType[];
  ids?: string[];
  where?: FilterExpression;
}

interface TraversalStep {
  relationship: RelationshipType | 'any';
  direction: 'outbound' | 'inbound' | 'both';
  filter?: FilterExpression;
  collect?: boolean;
}

interface FilterExpression {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'in' | 'exists';
  value: unknown;
  and?: FilterExpression[];
  or?: FilterExpression[];
}

/**
 * Query result
 */
interface QueryResult {
  success: boolean;
  memories: Array<{
    id: string;
    type: MemoryType;
    summary: string;
    confidence: number;
    path?: string[];
  }>;
  paths?: Array<{
    nodes: string[];
    relationships: string[];
  }> | undefined;
  count: number;
  queryTimeMs: number;
  tokensUsed?: number;
}

/**
 * Parse natural language query to MGQL
 */
function parseNaturalLanguageQuery(query: string): GraphQuery | null {
  const lowerQuery = query.toLowerCase();
  
  // Pattern: "incidents affecting entities owned by X"
  const incidentsAffectingMatch = lowerQuery.match(/incidents?\s+affecting\s+entities?\s+owned\s+by\s+(\w+)/);
  if (incidentsAffectingMatch) {
    return {
      from: { type: 'entity', where: { field: 'name', op: 'contains', value: incidentsAffectingMatch[1] } },
      traverse: [
        { relationship: 'owns', direction: 'outbound', collect: true },
        { relationship: 'affects', direction: 'inbound', filter: { field: 'type', op: 'eq', value: 'incident' } },
      ],
    };
  }

  // Pattern: "goals blocked by incidents"
  const goalsBlockedMatch = lowerQuery.match(/goals?\s+blocked\s+by\s+incidents?/);
  if (goalsBlockedMatch) {
    return {
      from: { type: 'incident' },
      traverse: [
        { relationship: 'blocks', direction: 'outbound', filter: { field: 'type', op: 'eq', value: 'goal' } },
      ],
    };
  }

  // Pattern: "workflows requiring skill X"
  const workflowsRequiringMatch = lowerQuery.match(/workflows?\s+requiring\s+(?:skill\s+)?(\w+)/);
  if (workflowsRequiringMatch) {
    return {
      from: { type: 'skill', where: { field: 'name', op: 'contains', value: workflowsRequiringMatch[1] } },
      traverse: [
        { relationship: 'requires', direction: 'inbound', filter: { field: 'type', op: 'eq', value: 'workflow' } },
      ],
    };
  }

  // Pattern: "memories related to X"
  const relatedToMatch = lowerQuery.match(/memories?\s+related\s+to\s+(\w+)/);
  if (relatedToMatch) {
    return {
      from: { where: { field: 'summary', op: 'contains', value: relatedToMatch[1] } },
      traverse: [
        { relationship: 'any', direction: 'both', collect: true },
      ],
      limit: 20,
    };
  }

  // Pattern: "what contradicts X"
  const contradictsMatch = lowerQuery.match(/what\s+contradicts?\s+(\w+)/);
  if (contradictsMatch) {
    return {
      from: { where: { field: 'summary', op: 'contains', value: contradictsMatch[1] } },
      traverse: [
        { relationship: 'contradicts', direction: 'both' },
      ],
    };
  }

  // Pattern: "tribal knowledge from incidents"
  const tribalFromMatch = lowerQuery.match(/tribal\s+knowledge\s+from\s+incidents?/);
  if (tribalFromMatch) {
    return {
      from: { type: 'incident' },
      traverse: [
        { relationship: 'learned_from', direction: 'inbound', filter: { field: 'type', op: 'eq', value: 'tribal' } },
      ],
    };
  }

  return null;
}

/**
 * Evaluate filter expression against a memory
 */
function evaluateFilter(memory: Memory, filter: FilterExpression): boolean {
  const value = getFieldValue(memory, filter.field);
  
  switch (filter.op) {
    case 'eq':
      return value === filter.value;
    case 'ne':
      return value !== filter.value;
    case 'gt':
      return typeof value === 'number' && value > (filter.value as number);
    case 'lt':
      return typeof value === 'number' && value < (filter.value as number);
    case 'contains':
      if (typeof value === 'string') {
        return value.toLowerCase().includes(String(filter.value).toLowerCase());
      }
      if (Array.isArray(value)) {
        return value.some(v => 
          typeof v === 'string' && v.toLowerCase().includes(String(filter.value).toLowerCase())
        );
      }
      return false;
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(value);
    case 'exists':
      return value !== undefined && value !== null;
    default:
      return true;
  }
}

/**
 * Get field value from memory (supports nested paths)
 */
function getFieldValue(memory: Memory, field: string): unknown {
  const parts = field.split('.');
  let value: unknown = memory;
  
  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  
  return value;
}

/**
 * Execute graph query
 */
async function executeQuery(
  cortex: Awaited<ReturnType<typeof getCortex>>,
  query: GraphQuery
): Promise<{ memories: Memory[]; paths: Array<{ nodes: string[]; relationships: string[] }> }> {
  const results: Memory[] = [];
  const paths: Array<{ nodes: string[]; relationships: string[] }> = [];
  const visited = new Set<string>();

  // Get starting memories
  let startMemories: Memory[] = [];
  
  if (query.from.ids?.length) {
    for (const id of query.from.ids) {
      const mem = await cortex.storage.read(id);
      if (mem) startMemories.push(mem);
    }
  } else if (query.from.type) {
    const types = Array.isArray(query.from.type) ? query.from.type : [query.from.type];
    for (const type of types) {
      const mems = await cortex.storage.findByType(type, { limit: 100 });
      startMemories.push(...mems);
    }
  } else {
    startMemories = await cortex.storage.search({ limit: 100 });
  }

  // Apply starting filter
  if (query.from.where) {
    startMemories = startMemories.filter(m => evaluateFilter(m, query.from.where!));
  }

  // Traverse from each starting memory
  for (const startMem of startMemories) {
    const path: { nodes: string[]; relationships: string[] } = {
      nodes: [startMem.id],
      relationships: [],
    };

    let currentMemories = [startMem];
    
    for (const step of query.traverse) {
      const nextMemories: Memory[] = [];
      
      for (const mem of currentMemories) {
        // Get related memories
        const related = await cortex.storage.getRelated(
          mem.id,
          step.relationship === 'any' ? undefined : step.relationship
        );

        for (const relMem of related) {
          // Apply step filter
          if (step.filter && !evaluateFilter(relMem, step.filter)) {
            continue;
          }

          // Check direction (simplified - would need relationship direction in storage)
          nextMemories.push(relMem);
          
          if (step.collect && !visited.has(relMem.id)) {
            visited.add(relMem.id);
            results.push(relMem);
            path.nodes.push(relMem.id);
            path.relationships.push(step.relationship);
          }
        }
      }

      currentMemories = nextMemories;
    }

    // Add final memories
    for (const mem of currentMemories) {
      if (!visited.has(mem.id)) {
        visited.add(mem.id);
        results.push(mem);
        path.nodes.push(mem.id);
      }
    }

    if (path.nodes.length > 1) {
      paths.push(path);
    }
  }

  // Apply final filter
  let finalResults = results;
  if (query.where) {
    finalResults = results.filter(m => evaluateFilter(m, query.where!));
  }

  // Apply limit
  if (query.limit) {
    finalResults = finalResults.slice(0, query.limit);
  }

  return { memories: finalResults, paths };
}

/**
 * Drift memory query tool definition
 */
export const driftMemoryQuery = {
  name: 'drift_memory_query',
  description: 'Execute rich graph queries across memory relationships. Supports natural language queries like "incidents affecting entities owned by platform-team" or structured MGQL queries.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query (e.g., "incidents affecting entities owned by platform-team", "goals blocked by incidents", "tribal knowledge from incidents")',
      },
      mgql: {
        type: 'object',
        description: 'Structured MGQL query object (alternative to natural language)',
        properties: {
          from: {
            type: 'object',
            description: 'Starting point selector',
            properties: {
              type: { type: 'string', description: 'Memory type to start from' },
              ids: { type: 'array', items: { type: 'string' }, description: 'Specific memory IDs' },
              where: { type: 'object', description: 'Filter expression' },
            },
          },
          traverse: {
            type: 'array',
            description: 'Traversal steps',
            items: {
              type: 'object',
              properties: {
                relationship: { type: 'string', description: 'Relationship type to follow' },
                direction: { type: 'string', enum: ['outbound', 'inbound', 'both'] },
                filter: { type: 'object', description: 'Filter at this step' },
                collect: { type: 'boolean', description: 'Collect intermediate nodes' },
              },
            },
          },
          where: { type: 'object', description: 'Final filter expression' },
          limit: { type: 'number', description: 'Maximum results' },
          depth: { type: 'number', description: 'Maximum traversal depth' },
        },
      },
      format: {
        type: 'string',
        enum: ['memories', 'graph', 'paths', 'count'],
        default: 'memories',
        description: 'Output format',
      },
      maxTokens: {
        type: 'number',
        default: 2000,
        description: 'Maximum tokens for response',
      },
      compressionLevel: {
        type: 'number',
        enum: [1, 2, 3],
        default: 2,
        description: 'Compression level (1=full, 2=moderate, 3=minimal)',
      },
    },
  },

  async execute(params: {
    query?: string;
    mgql?: GraphQuery;
    format?: 'memories' | 'graph' | 'paths' | 'count';
    maxTokens?: number;
    compressionLevel?: 1 | 2 | 3;
  }): Promise<QueryResult> {
    const startTime = Date.now();
    const cortex = await getCortex();

    // Parse query
    let graphQuery: GraphQuery | null = null;
    
    if (params.mgql) {
      graphQuery = params.mgql;
    } else if (params.query) {
      graphQuery = parseNaturalLanguageQuery(params.query);
      
      if (!graphQuery) {
        // Fallback to simple search
        const memories = await cortex.storage.search({
          limit: params.maxTokens ? Math.floor(params.maxTokens / 100) : 20,
        });
        
        const filtered = memories.filter(m => 
          m.summary?.toLowerCase().includes(params.query!.toLowerCase()) ||
          JSON.stringify(m).toLowerCase().includes(params.query!.toLowerCase())
        );

        return {
          success: true,
          memories: filtered.map(m => ({
            id: m.id,
            type: m.type,
            summary: m.summary,
            confidence: m.confidence,
          })),
          count: filtered.length,
          queryTimeMs: Date.now() - startTime,
        };
      }
    } else {
      return {
        success: false,
        memories: [],
        count: 0,
        queryTimeMs: Date.now() - startTime,
      };
    }

    // Execute query
    const { memories, paths } = await executeQuery(cortex, graphQuery);

    // Format results based on compression level
    const compressionLevel = params.compressionLevel ?? 2;
    const formattedMemories = memories.map(m => {
      const base = {
        id: m.id,
        type: m.type,
        summary: m.summary,
        confidence: m.confidence,
      };

      if (compressionLevel === 1) {
        return { ...base, ...(m as unknown as Record<string, unknown>) };
      } else if (compressionLevel === 2) {
        return {
          ...base,
          createdAt: m.createdAt,
          linkedPatterns: m.linkedPatterns,
        };
      }
      return base;
    });

    // Estimate tokens
    const tokensUsed = Math.ceil(JSON.stringify(formattedMemories).length / 4);

    return {
      success: true,
      memories: formattedMemories,
      paths: params.format === 'paths' || params.format === 'graph' ? paths : undefined,
      count: memories.length,
      queryTimeMs: Date.now() - startTime,
      tokensUsed,
    };
  },
};
