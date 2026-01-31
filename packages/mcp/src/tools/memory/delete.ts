/**
 * drift_memory_delete
 * 
 * Delete a memory (soft delete).
 */

import { getCortex } from 'driftdetect-cortex';

/**
 * Memory delete tool definition
 */
export const memoryDelete = {
  name: 'drift_memory_delete',
  description: 'Delete a memory (soft delete - can be recovered)',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Memory ID to delete',
      },
    },
    required: ['id'],
  },

  async execute(params: { id: string }) {
    const cortex = await getCortex();

    // Verify memory exists
    const existing = await cortex.get(params.id);
    if (!existing) {
      return { error: 'Memory not found', id: params.id };
    }

    await cortex.delete(params.id);

    return {
      deleted: true,
      id: params.id,
    };
  },
};
