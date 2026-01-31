/**
 * drift_memory_get
 * 
 * Get a specific memory by ID.
 * V2: Enhanced with causal chain option.
 */

import { getCortex } from 'driftdetect-cortex';

interface CausalLink {
  memoryId: string;
  relationship: string;
  summary: string;
  confidence: number;
}

interface GetResult {
  memory: any;
  decay: any;
  causalChain?: {
    ancestors: CausalLink[];
    descendants: CausalLink[];
    related: CausalLink[];
  };
  relatedMemories?: Array<{
    id: string;
    type: string;
    summary: string;
    relationship: string;
  }>;
}

/**
 * Memory get tool definition - V2 with causal chain
 */
export const memoryGet = {
  name: 'drift_memory_get',
  description: 'Get a specific memory by ID with full details. Optionally includes causal chain showing related memories.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Memory ID',
      },
      includeCausalChain: {
        type: 'boolean',
        default: false,
        description: 'Include causal chain (ancestors, descendants, related)',
      },
      includeRelated: {
        type: 'boolean',
        default: false,
        description: 'Include related memories',
      },
      maxChainDepth: {
        type: 'number',
        default: 3,
        description: 'Maximum depth for causal chain traversal',
      },
    },
    required: ['id'],
  },

  async execute(params: {
    id: string;
    includeCausalChain?: boolean;
    includeRelated?: boolean;
    maxChainDepth?: number;
  }): Promise<GetResult | { error: string; id: string }> {
    const cortex = await getCortex();
    const memory = await cortex.get(params.id);

    if (!memory) {
      return { error: 'Memory not found', id: params.id };
    }

    // Calculate current decay factors
    const decay = cortex.calculateDecay(memory);

    const result: GetResult = {
      memory,
      decay,
    };

    // Get causal chain if requested
    if (params.includeCausalChain) {
      const ancestors: CausalLink[] = [];
      const descendants: CausalLink[] = [];
      const related: CausalLink[] = [];

      try {
        // Get ancestors (memories this one derived from)
        const derivedFrom = await cortex.storage.getRelated(params.id, 'derived_from');
        for (const m of derivedFrom) {
          ancestors.push({
            memoryId: m.id,
            relationship: 'derived_from',
            summary: m.summary,
            confidence: m.confidence,
          });
        }

        // Get descendants (memories derived from this one)
        // This requires reverse lookup which may not be available
        try {
          const allMemories = await cortex.storage.search({ limit: 100 });
          for (const m of allMemories) {
            const mDerivedFrom = await cortex.storage.getRelated(m.id, 'derived_from');
            if (mDerivedFrom.some(d => d.id === params.id)) {
              descendants.push({
                memoryId: m.id,
                relationship: 'derived_from',
                summary: m.summary,
                confidence: m.confidence,
              });
            }
          }
        } catch {
          // Reverse lookup not available
        }

        // Get related memories
        const relatedMemories = await cortex.storage.getRelated(params.id, 'related');
        for (const m of relatedMemories) {
          related.push({
            memoryId: m.id,
            relationship: 'related',
            summary: m.summary,
            confidence: m.confidence,
          });
        }

        // Get supersedes relationships
        const supersedes = await cortex.storage.getRelated(params.id, 'supersedes');
        for (const m of supersedes) {
          descendants.push({
            memoryId: m.id,
            relationship: 'supersedes',
            summary: m.summary,
            confidence: m.confidence,
          });
        }

        result.causalChain = { ancestors, descendants, related };
      } catch {
        // Causal chain not available
        result.causalChain = { ancestors: [], descendants: [], related: [] };
      }
    }

    // Get related memories if requested
    if (params.includeRelated) {
      try {
        const relatedMemories = await cortex.storage.getRelated(params.id);
        result.relatedMemories = relatedMemories.map(m => ({
          id: m.id,
          type: m.type,
          summary: m.summary,
          relationship: 'related',
        }));
      } catch {
        result.relatedMemories = [];
      }
    }

    return result;
  },
};
