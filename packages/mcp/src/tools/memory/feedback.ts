/**
 * drift_memory_feedback
 * 
 * Process feedback on memories to improve confidence calibration.
 * Supports confirming, rejecting, or modifying memories.
 */

import { getCortex } from 'driftdetect-cortex';

interface FeedbackResult {
  success: boolean;
  memoryId: string;
  action: string;
  previousConfidence: number;
  newConfidence: number;
  message: string;
}

/**
 * Drift memory feedback tool definition
 */
export const driftMemoryFeedback = {
  name: 'drift_memory_feedback',
  description: 'Process feedback on memories to improve confidence calibration. Confirm, reject, or modify memories based on user feedback.',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The memory ID to provide feedback on',
      },
      action: {
        type: 'string',
        enum: ['confirm', 'reject', 'modify'],
        description: 'The feedback action: confirm (still accurate), reject (no longer valid), modify (needs update)',
      },
      feedback: {
        type: 'string',
        description: 'Optional feedback text explaining the action',
      },
      modification: {
        type: 'string',
        description: 'For modify action: the updated content',
      },
    },
    required: ['memoryId', 'action'],
  },

  async execute(params: {
    memoryId: string;
    action: 'confirm' | 'reject' | 'modify';
    feedback?: string;
    modification?: string;
  }): Promise<FeedbackResult> {
    const cortex = await getCortex();
    
    // Get the memory
    const memory = await cortex.storage.read(params.memoryId);
    if (!memory) {
      return {
        success: false,
        memoryId: params.memoryId,
        action: params.action,
        previousConfidence: 0,
        newConfidence: 0,
        message: 'Memory not found',
      };
    }

    const previousConfidence = memory.confidence;
    let newConfidence = previousConfidence;
    let message = '';

    switch (params.action) {
      case 'confirm':
        // Increase confidence
        newConfidence = Math.min(1.0, previousConfidence + 0.1);
        message = 'Memory confirmed. Confidence increased.';
        break;
      
      case 'reject':
        // Decrease confidence significantly
        newConfidence = Math.max(0.1, previousConfidence - 0.3);
        message = 'Memory rejected. Confidence decreased.';
        break;
      
      case 'modify':
        // Slight decrease but update content
        newConfidence = Math.max(0.3, previousConfidence - 0.1);
        message = 'Memory modified. Content updated.';
        
        if (params.modification) {
          await cortex.storage.update(params.memoryId, {
            summary: params.modification,
          });
        }
        break;
    }

    // Update confidence and access info
    await cortex.storage.update(params.memoryId, {
      confidence: newConfidence,
      lastAccessed: new Date().toISOString(),
      accessCount: memory.accessCount + 1,
    });

    return {
      success: true,
      memoryId: params.memoryId,
      action: params.action,
      previousConfidence,
      newConfidence,
      message,
    };
  },
};
