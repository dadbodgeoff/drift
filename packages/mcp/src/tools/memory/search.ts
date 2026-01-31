/**
 * drift_memory_search
 * 
 * Search memories with semantic and filter-based queries.
 * V2: Integrates SessionContext for deduplication.
 */

import { getCortex, type MemoryType } from 'driftdetect-cortex';

interface SearchResult {
  id: string;
  type: string;
  summary: string;
  confidence: number;
  importance: string;
  alreadySent?: boolean;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  deduplicated: number;
  sessionId?: string | undefined;
}

/**
 * Memory search tool definition - V2 with session deduplication
 */
export const memorySearch = {
  name: 'drift_memory_search',
  description: 'Search memories using semantic search and filters. Returns memories matching the query. Supports session-based deduplication to avoid sending the same memories twice.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Semantic search query',
      },
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by memory types',
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold (0-1)',
      },
      importance: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by importance levels',
      },
      limit: {
        type: 'number',
        default: 20,
        description: 'Maximum results to return',
      },
      // V2 parameters
      sessionId: {
        type: 'string',
        description: 'Session ID for deduplication (memories already sent in this session will be marked)',
      },
      excludeAlreadySent: {
        type: 'boolean',
        default: false,
        description: 'Exclude memories already sent in this session',
      },
      trackInSession: {
        type: 'boolean',
        default: true,
        description: 'Track returned memories in session',
      },
    },
  },

  async execute(params: {
    query?: string;
    types?: string[];
    minConfidence?: number;
    importance?: string[];
    limit?: number;
    sessionId?: string;
    excludeAlreadySent?: boolean;
    trackInSession?: boolean;
  }): Promise<SearchResponse> {
    const cortex = await getCortex();
    const limit = params.limit ?? 20;
    let deduplicated = 0;

    // Get session context if available
    let sessionMemoryIds: Set<string> | null = null;
    if (params.sessionId && 'sessionManager' in cortex) {
      try {
        const session = await (cortex as any).sessionManager.getSession(params.sessionId);
        if (session?.memoriesSent) {
          sessionMemoryIds = new Set(session.memoriesSent);
        }
      } catch {
        // Session manager not available
      }
    }

    let results: SearchResult[] = [];

    // If query provided, use semantic search
    if (params.query) {
      try {
        const embedding = await cortex.embeddings.embed(params.query);
        const searchResults = await cortex.storage.similaritySearch(
          embedding,
          limit * 2 // Get more to account for filtering
        );

        // Apply additional filters
        let filtered = searchResults;
        if (params.types?.length) {
          filtered = filtered.filter(m => params.types!.includes(m.type));
        }
        if (params.minConfidence !== undefined) {
          filtered = filtered.filter(m => m.confidence >= params.minConfidence!);
        }
        if (params.importance?.length) {
          filtered = filtered.filter(m => params.importance!.includes(m.importance));
        }

        results = filtered.map(m => ({
          id: m.id,
          type: m.type,
          summary: m.summary,
          confidence: m.confidence,
          importance: m.importance,
          alreadySent: sessionMemoryIds?.has(m.id) ?? false,
        }));
      } catch {
        // Fall back to filter-based search
      }
    }

    // If no results from semantic search, use filter-based search
    if (results.length === 0) {
      const searchQuery: Parameters<typeof cortex.storage.search>[0] = {
        types: params.types as MemoryType[],
        importance: params.importance as ('low' | 'normal' | 'high' | 'critical')[],
        limit: limit * 2,
      };

      if (params.minConfidence !== undefined) {
        searchQuery.minConfidence = params.minConfidence;
      }

      const searchResults = await cortex.storage.search(searchQuery);

      results = searchResults.map(m => ({
        id: m.id,
        type: m.type,
        summary: m.summary,
        confidence: m.confidence,
        importance: m.importance,
        alreadySent: sessionMemoryIds?.has(m.id) ?? false,
      }));
    }

    // Handle deduplication
    if (params.excludeAlreadySent && sessionMemoryIds) {
      const beforeCount = results.length;
      results = results.filter(r => !r.alreadySent);
      deduplicated = beforeCount - results.length;
    } else {
      deduplicated = results.filter(r => r.alreadySent).length;
    }

    // Limit results
    results = results.slice(0, limit);

    // Track in session if enabled
    if (params.trackInSession !== false && params.sessionId && 'sessionManager' in cortex) {
      try {
        const memoryIds = results.map(r => r.id);
        await (cortex as any).sessionManager.trackMemoriesSent(params.sessionId, memoryIds);
      } catch {
        // Session tracking not available
      }
    }

    return {
      results,
      total: results.length,
      deduplicated,
      sessionId: params.sessionId,
    };
  },
};
