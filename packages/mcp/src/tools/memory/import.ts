/**
 * drift_memory_import
 * 
 * Import memories from JSON.
 */

import { getCortex, type Memory } from 'driftdetect-cortex';

/**
 * Memory import tool definition
 */
export const memoryImport = {
  name: 'drift_memory_import',
  description: 'Import memories from JSON format',
  parameters: {
    type: 'object',
    properties: {
      memories: {
        type: 'array',
        items: { type: 'object' },
        description: 'Array of memories to import',
      },
      overwrite: {
        type: 'boolean',
        default: false,
        description: 'Overwrite existing memories with same ID',
      },
    },
    required: ['memories'],
  },

  async execute(params: {
    memories: Memory[];
    overwrite?: boolean;
  }) {
    const cortex = await getCortex();

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const memory of params.memories) {
      try {
        // Check if exists
        const existing = await cortex.get(memory.id);

        if (existing && !params.overwrite) {
          skipped++;
          continue;
        }

        if (existing) {
          await cortex.update(memory.id, memory);
        } else {
          await cortex.add(memory as any);
        }

        imported++;
      } catch {
        errors++;
      }
    }

    return {
      imported,
      skipped,
      errors,
      total: params.memories.length,
    };
  },
};
