/**
 * drift_memory_suggest
 * 
 * Get memory suggestions based on current context.
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

/**
 * Memory suggest tool definition
 */
export const memorySuggest = {
  name: 'drift_memory_suggest',
  description: 'Get memory suggestions based on current context. Suggests what memories might be useful to add.',
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
        description: 'What you are working on',
      },
      activeFile: {
        type: 'string',
        description: 'Currently active file',
      },
    },
    required: ['intent', 'focus'],
  },

  async execute(params: {
    intent: string;
    focus: string;
    activeFile?: string;
  }) {
    const cortex = await getCortex();

    // Get existing memories for this context
    const retrievalContext: Parameters<typeof cortex.retrieval.retrieve>[0] = {
      intent: params.intent as Intent,
      focus: params.focus,
      maxTokens: 1000,
    };

    if (params.activeFile) {
      retrievalContext.activeFile = params.activeFile;
    }

    const existing = await cortex.retrieval.retrieve(retrievalContext);

    const suggestions: Array<{
      type: string;
      reason: string;
      example: string;
    }> = [];

    // Check for missing memory types
    const hasTribal = existing.memories.some(m => m.memory.type === 'tribal');
    const hasProcedural = existing.memories.some(m => m.memory.type === 'procedural');
    const hasPatternRationale = existing.memories.some(m => m.memory.type === 'pattern_rationale');

    if (!hasTribal) {
      suggestions.push({
        type: 'tribal',
        reason: `No tribal knowledge found for "${params.focus}". Consider adding gotchas or warnings.`,
        example: `{ type: 'tribal', topic: '${params.focus}', knowledge: 'Important warning about...', severity: 'warning' }`,
      });
    }

    if (!hasProcedural && params.intent === 'add_feature') {
      suggestions.push({
        type: 'procedural',
        reason: `No procedure found for adding features related to "${params.focus}".`,
        example: `{ type: 'procedural', name: 'Add ${params.focus} feature', steps: [...] }`,
      });
    }

    if (!hasPatternRationale) {
      suggestions.push({
        type: 'pattern_rationale',
        reason: `No pattern rationales found for "${params.focus}". Consider documenting why patterns exist.`,
        example: `{ type: 'pattern_rationale', patternName: '...', rationale: 'We use this pattern because...' }`,
      });
    }

    return {
      existingMemories: existing.memories.length,
      suggestions,
      coverage: {
        tribal: hasTribal,
        procedural: hasProcedural,
        patternRationale: hasPatternRationale,
      },
    };
  },
};
