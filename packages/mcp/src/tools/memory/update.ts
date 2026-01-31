/**
 * drift_memory_update
 * 
 * Update an existing memory.
 */

import { getCortex } from 'driftdetect-cortex';

/**
 * Memory update tool definition
 */
export const memoryUpdate = {
  name: 'drift_memory_update',
  description: 'Update an existing memory',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Memory ID to update',
      },
      updates: {
        type: 'object',
        description: 'Fields to update',
      },
    },
    required: ['id', 'updates'],
  },

  async execute(params: { id: string; updates: Record<string, unknown> }) {
    const cortex = await getCortex();

    // Verify memory exists
    const existing = await cortex.get(params.id);
    if (!existing) {
      return { error: 'Memory not found', id: params.id };
    }

    await cortex.update(params.id, params.updates as any);

    return {
      updated: true,
      id: params.id,
    };
  },
};
