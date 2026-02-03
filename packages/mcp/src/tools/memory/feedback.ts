/**
 * drift_memory_feedback
 * 
 * Process feedback on memories to improve confidence calibration.
 * Supports confirming, rejecting, or modifying memories.
 * 
 * V2: Integrates contradiction detection and confidence propagation.
 */

import { getCortex, ContradictionDetector, ConfidencePropagator, type ContradictionResult } from 'driftdetect-cortex';

interface FeedbackResult {
  success: boolean;
  memoryId: string;
  action: string;
  previousConfidence: number;
  newConfidence: number;
  message: string;
  contradictionsDetected?: ContradictionResult[] | undefined;
  confidenceUpdates?: Array<{
    memoryId: string;
    previousConfidence: number;
    newConfidence: number;
    reason: string;
  }> | undefined;
}

/**
 * Drift memory feedback tool definition
 */
export const driftMemoryFeedback = {
  name: 'drift_memory_feedback',
  description: 'Process feedback on memories to improve confidence calibration. Confirm, reject, or modify memories based on user feedback. Automatically detects contradictions and propagates confidence changes.',
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
      // V2: Explicit contradiction/confirmation
      contradicts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Memory IDs this feedback explicitly contradicts',
      },
      confirms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Memory IDs this feedback explicitly confirms',
      },
      autoDetectContradictions: {
        type: 'boolean',
        default: true,
        description: 'Automatically detect contradicting memories',
      },
    },
    required: ['memoryId', 'action'],
  },

  async execute(params: {
    memoryId: string;
    action: 'confirm' | 'reject' | 'modify';
    feedback?: string;
    modification?: string;
    contradicts?: string[];
    confirms?: string[];
    autoDetectContradictions?: boolean;
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
    const contradictionsDetected: ContradictionResult[] = [];
    const confidenceUpdates: Array<{
      memoryId: string;
      previousConfidence: number;
      newConfidence: number;
      reason: string;
    }> = [];

    // Initialize contradiction detector and propagator
    const contradictionDetector = new ContradictionDetector(
      cortex.storage,
      cortex.embeddings
    );
    const confidencePropagator = new ConfidencePropagator(cortex.storage);

    switch (params.action) {
      case 'confirm':
        // Increase confidence
        newConfidence = Math.min(1.0, previousConfidence + 0.1);
        message = 'Memory confirmed. Confidence increased.';
        
        // Handle explicit confirmations
        if (params.confirms?.length) {
          for (const confirmId of params.confirms) {
            const updates = await confidencePropagator.applyConfirmation(
              confirmId,
              params.memoryId,
              params.feedback || 'Explicit confirmation'
            );
            confidenceUpdates.push(...updates);
          }
        }
        break;
      
      case 'reject':
        // Decrease confidence significantly
        newConfidence = Math.max(0.1, previousConfidence - 0.3);
        message = 'Memory rejected. Confidence decreased.';
        
        // Auto-detect contradictions if enabled
        if (params.autoDetectContradictions !== false) {
          const detected = await contradictionDetector.detectContradictions(memory);
          contradictionsDetected.push(...detected);
          
          // Apply contradiction propagation
          for (const contradiction of detected) {
            const updates = await confidencePropagator.applyContradiction(
              contradiction,
              params.memoryId
            );
            confidenceUpdates.push(...updates);
          }
        }
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

    // Handle explicit contradictions
    if (params.contradicts?.length) {
      for (const contradictId of params.contradicts) {
        const contradictedMemory = await cortex.storage.read(contradictId);
        if (contradictedMemory) {
          const contradiction: ContradictionResult = {
            existingMemoryId: contradictId,
            contradictionType: 'direct',
            confidence: 0.9, // High confidence for explicit contradictions
            evidence: params.feedback || 'Explicit contradiction from user feedback',
            suggestedAction: 'lower_confidence',
            similarityScore: 0.8,
          };
          contradictionsDetected.push(contradiction);
          
          const updates = await confidencePropagator.applyContradiction(
            contradiction,
            params.memoryId
          );
          confidenceUpdates.push(...updates);
        }
      }
    }

    // Update confidence and access info
    await cortex.storage.update(params.memoryId, {
      confidence: newConfidence,
      lastAccessed: new Date().toISOString(),
      accessCount: memory.accessCount + 1,
    });

    // Add to confidence updates
    confidenceUpdates.unshift({
      memoryId: params.memoryId,
      previousConfidence,
      newConfidence,
      reason: `${params.action}: ${params.feedback || 'User feedback'}`,
    });

    return {
      success: true,
      memoryId: params.memoryId,
      action: params.action,
      previousConfidence,
      newConfidence,
      message,
      contradictionsDetected: contradictionsDetected.length > 0 ? contradictionsDetected : undefined,
      confidenceUpdates: confidenceUpdates.length > 1 ? confidenceUpdates : undefined,
    };
  },
};
