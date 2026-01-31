/**
 * drift_memory_for_context
 * 
 * Get memories relevant to current context (integrates with drift_context).
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

/**
 * Memory for context tool definition
 */
export const memoryForContext = {
  name: 'drift_memory_for_context',
  description: 'Get memories relevant to current context. Integrates with drift_context for comprehensive codebase intelligence.',
  parameters: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test'],
        description: 'What you are trying to do',
      },
      focus: {
        type: 'string',
        description: 'What you are working on (e.g., "authentication", "payment processing")',
      },
      activeFile: {
        type: 'string',
        description: 'Currently active file path',
      },
      relevantPatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pattern IDs from drift_context',
      },
      maxTokens: {
        type: 'number',
        default: 2000,
        description: 'Maximum tokens to use for memories',
      },
    },
    required: ['intent', 'focus'],
  },

  async execute(params: {
    intent: string;
    focus: string;
    activeFile?: string;
    relevantPatterns?: string[];
    maxTokens?: number;
  }) {
    const cortex = await getCortex();

    const retrievalContext: Parameters<typeof cortex.retrieval.retrieve>[0] = {
      intent: params.intent as Intent,
      focus: params.focus,
      maxTokens: params.maxTokens || 2000,
    };

    if (params.activeFile) {
      retrievalContext.activeFile = params.activeFile;
    }
    if (params.relevantPatterns) {
      retrievalContext.relevantPatterns = params.relevantPatterns;
    }

    const result = await cortex.retrieval.retrieve(retrievalContext);

    // Organize by type
    const byType = {
      core: result.memories.filter(m => m.memory.type === 'core'),
      tribal: result.memories.filter(m => m.memory.type === 'tribal'),
      procedural: result.memories.filter(m => m.memory.type === 'procedural'),
      semantic: result.memories.filter(m => m.memory.type === 'semantic'),
      patternRationales: result.memories.filter(m => m.memory.type === 'pattern_rationale'),
      constraintOverrides: result.memories.filter(m => m.memory.type === 'constraint_override'),
      codeSmells: result.memories.filter(m => m.memory.type === 'code_smell'),
    };

    // Extract warnings from tribal memories
    const warnings = byType.tribal
      .filter(m => {
        const mem = m.memory as any;
        return mem.severity === 'critical' || mem.severity === 'warning';
      })
      .map(m => ({
        type: 'tribal',
        severity: (m.memory as any).severity,
        message: m.memory.summary,
      }));

    return {
      ...byType,
      warnings,
      tokensUsed: result.tokensUsed,
      memoriesIncluded: result.memories.length,
      memoriesOmitted: result.totalCandidates - result.memories.length,
      retrievalTime: result.retrievalTime,
    };
  },
};
