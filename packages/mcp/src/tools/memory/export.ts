/**
 * drift_memory_export
 * 
 * Export memories to JSON.
 */

import { getCortex, type MemoryType } from 'driftdetect-cortex';

/**
 * Memory export tool definition
 */
export const memoryExport = {
  name: 'drift_memory_export',
  description: 'Export memories to JSON format',
  parameters: {
    type: 'object',
    properties: {
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by memory types (empty = all)',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold',
      },
      includeArchived: {
        type: 'boolean',
        default: false,
        description: 'Include archived memories',
      },
    },
  },

  async execute(params: {
    types?: string[];
    minConfidence?: number;
    includeArchived?: boolean;
  }) {
    const cortex = await getCortex();

    const searchQuery: Parameters<typeof cortex.search>[0] = {
      types: params.types as MemoryType[],
      limit: 10000,
    };

    if (params.minConfidence !== undefined) {
      searchQuery.minConfidence = params.minConfidence;
    }
    if (params.includeArchived !== undefined) {
      searchQuery.includeArchived = params.includeArchived;
    }

    const memories = await cortex.search(searchQuery);

    return {
      exportedAt: new Date().toISOString(),
      count: memories.length,
      memories,
    };
  },
};
