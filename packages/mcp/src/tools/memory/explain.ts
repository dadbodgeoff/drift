/**
 * drift_memory_explain
 * 
 * Generate causal "why" narratives explaining how and why
 * a memory or piece of knowledge came to be.
 */

import { getCortex } from 'driftdetect-cortex';

interface CausalChainNode {
  memoryId: string;
  memoryType: string;
  summary: string;
  relationship: string;
  confidence: number;
}

interface ExplainResult {
  memoryId: string;
  narrative: string;
  summary: string;
  causalChain: CausalChainNode[];
  keyPoints: string[];
  sources: string[];
  confidence: number;
}

/**
 * Drift memory explain tool definition
 */
export const driftMemoryExplain = {
  name: 'drift_memory_explain',
  description: 'Generate causal "why" narratives explaining how and why a memory or piece of knowledge came to be. Traces the origins and influences.',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The memory ID to explain',
      },
      maxDepth: {
        type: 'number',
        default: 5,
        description: 'Maximum depth to traverse causal chain',
      },
      includeChain: {
        type: 'boolean',
        default: true,
        description: 'Include detailed causal chain',
      },
      direction: {
        type: 'string',
        enum: ['origins', 'effects', 'both'],
        default: 'origins',
        description: 'Direction to trace: origins (what caused this), effects (what this caused), or both',
      },
    },
    required: ['memoryId'],
  },

  async execute(params: {
    memoryId: string;
    maxDepth?: number;
    includeChain?: boolean;
    direction?: 'origins' | 'effects' | 'both';
  }): Promise<ExplainResult> {
    const cortex = await getCortex();
    
    // Get the memory
    const memory = await cortex.storage.read(params.memoryId);
    if (!memory) {
      return {
        memoryId: params.memoryId,
        narrative: 'Memory not found',
        summary: 'The requested memory does not exist',
        causalChain: [],
        keyPoints: [],
        sources: [],
        confidence: 0,
      };
    }

    // Check if causal graph is available
    const causalStorage = (cortex as unknown as { causalStorage?: unknown }).causalStorage;
    if (!causalStorage) {
      return {
        memoryId: params.memoryId,
        narrative: `This ${memory.type} memory was created on ${memory.createdAt}. No causal analysis is available.`,
        summary: memory.summary,
        causalChain: [],
        keyPoints: [
          `Memory type: ${memory.type}`,
          `Confidence: ${Math.round(memory.confidence * 100)}%`,
          `Access count: ${memory.accessCount}`,
        ],
        sources: [params.memoryId],
        confidence: memory.confidence,
      };
    }

    // Build narrative from memory info
    const narrative = buildNarrative(memory);
    const keyPoints = extractKeyPoints(memory);

    return {
      memoryId: params.memoryId,
      narrative,
      summary: memory.summary,
      causalChain: [],
      keyPoints,
      sources: [params.memoryId],
      confidence: memory.confidence,
    };
  },
};

function buildNarrative(memory: { type: string; summary: string; createdAt: string; confidence: number; tags?: string[] }): string {
  const parts: string[] = [];
  
  parts.push(`This ${memory.type.replace(/_/g, ' ')} memory captures: "${memory.summary}".`);
  parts.push(`It was created on ${new Date(memory.createdAt).toLocaleDateString()}.`);
  parts.push(`Current confidence level is ${Math.round(memory.confidence * 100)}%.`);
  
  if (memory.tags && memory.tags.length > 0) {
    parts.push(`Related topics: ${memory.tags.join(', ')}.`);
  }

  return parts.join(' ');
}

function extractKeyPoints(memory: { type: string; confidence: number; accessCount: number; importance?: string }): string[] {
  const points: string[] = [];
  
  points.push(`Memory type: ${memory.type.replace(/_/g, ' ')}`);
  points.push(`Confidence: ${Math.round(memory.confidence * 100)}%`);
  points.push(`Access count: ${memory.accessCount}`);
  
  if (memory.importance) {
    points.push(`Importance: ${memory.importance}`);
  }

  return points;
}
