/**
 * drift_memory_predict
 * 
 * Get predicted memories for the current context.
 * Uses behavioral and temporal signals to anticipate
 * what memories will be needed.
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

interface PredictedMemory {
  memoryId: string;
  memoryType: string;
  summary: string;
  confidence: number;
  predictionScore: number;
  reason: string;
}

interface PredictResult {
  predictions: PredictedMemory[];
  signals: {
    activeFile: string;
    recentFiles: string[];
    detectedIntent: string | null;
  };
  totalPredictions: number;
}

/**
 * Drift memory predict tool definition
 */
export const driftMemoryPredict = {
  name: 'drift_memory_predict',
  description: 'Get predicted memories for the current context. Uses behavioral and temporal signals to anticipate what memories will be needed.',
  parameters: {
    type: 'object',
    properties: {
      activeFile: {
        type: 'string',
        description: 'The currently active file',
      },
      recentFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Recently accessed files',
      },
      intent: {
        type: 'string',
        enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test'],
        description: 'Optional: the current intent',
      },
      limit: {
        type: 'number',
        default: 10,
        description: 'Maximum predictions to return',
      },
    },
    required: ['activeFile'],
  },

  async execute(params: {
    activeFile: string;
    recentFiles?: string[];
    intent?: string;
    limit?: number;
  }): Promise<PredictResult> {
    const cortex = await getCortex();
    const limit = params.limit ?? 10;
    const predictions: PredictedMemory[] = [];

    // Get memories linked to the active file
    const fileMemories = await cortex.storage.findByFile(params.activeFile);
    for (const memory of fileMemories.slice(0, limit)) {
      predictions.push({
        memoryId: memory.id,
        memoryType: memory.type,
        summary: memory.summary,
        confidence: memory.confidence,
        predictionScore: 0.9, // High score for file-linked
        reason: 'Linked to active file',
      });
    }

    // Get memories from recent files
    if (params.recentFiles && params.recentFiles.length > 0) {
      for (const file of params.recentFiles.slice(0, 3)) {
        const recentMemories = await cortex.storage.findByFile(file);
        for (const memory of recentMemories.slice(0, 3)) {
          if (!predictions.find(p => p.memoryId === memory.id)) {
            predictions.push({
              memoryId: memory.id,
              memoryType: memory.type,
              summary: memory.summary,
              confidence: memory.confidence,
              predictionScore: 0.7, // Medium score for recent files
              reason: 'Linked to recently accessed file',
            });
          }
        }
      }
    }

    // Get memories by intent if provided
    if (params.intent) {
      const intentMemories = await cortex.retrieval.retrieve({
        intent: params.intent as Intent,
        focus: params.activeFile,
        maxTokens: 1000,
      });

      for (const result of intentMemories.memories.slice(0, 5)) {
        if (!predictions.find(p => p.memoryId === result.memory.id)) {
          predictions.push({
            memoryId: result.memory.id,
            memoryType: result.memory.type,
            summary: result.memory.summary,
            confidence: result.memory.confidence,
            predictionScore: result.relevanceScore * 0.8,
            reason: `Relevant for ${params.intent}`,
          });
        }
      }
    }

    // Sort by prediction score
    predictions.sort((a, b) => b.predictionScore - a.predictionScore);

    return {
      predictions: predictions.slice(0, limit),
      signals: {
        activeFile: params.activeFile,
        recentFiles: params.recentFiles ?? [],
        detectedIntent: params.intent ?? null,
      },
      totalPredictions: predictions.length,
    };
  },
};
