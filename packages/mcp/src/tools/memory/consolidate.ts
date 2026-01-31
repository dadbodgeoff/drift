/**
 * drift_memory_consolidate
 * 
 * Trigger memory consolidation (sleep-inspired).
 */

import { getCortex } from 'driftdetect-cortex';

/**
 * Memory consolidate tool definition
 */
export const memoryConsolidate = {
  name: 'drift_memory_consolidate',
  description: 'Trigger memory consolidation - compresses episodic memories into semantic knowledge',
  parameters: {
    type: 'object',
    properties: {
      dryRun: {
        type: 'boolean',
        default: false,
        description: 'Preview what would be consolidated without making changes',
      },
    },
  },

  async execute(params: { dryRun?: boolean }) {
    const cortex = await getCortex();

    const result = await cortex.consolidate(params.dryRun || false);

    return {
      dryRun: params.dryRun || false,
      episodesProcessed: result.episodesProcessed,
      memoriesCreated: result.memoriesCreated,
      memoriesUpdated: result.memoriesUpdated,
      memoriesPruned: result.memoriesPruned,
      tokensFreed: result.tokensFreed,
      duration: result.duration,
    };
  },
};
