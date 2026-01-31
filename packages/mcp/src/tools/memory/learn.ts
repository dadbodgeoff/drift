/**
 * drift_memory_learn
 * 
 * Learn from corrections and feedback with full analysis.
 * Uses CorrectionAnalyzer, PrincipleExtractor, and LearningMemoryFactory
 * to create appropriate memory types from user feedback.
 */

import { getCortex, generateSessionId } from 'driftdetect-cortex';

interface LearnResult {
  learned: boolean;
  memoriesCreated: Array<{
    id: string;
    type: string;
    summary: string;
  }>;
  analysis: {
    correctionType: string;
    severity: string;
    extractedPrinciples: string[];
    confidence: number;
  };
  causalLinks: string[];
  recommendations: string[];
}

/**
 * Memory learn tool definition - V2 with full learning pipeline
 */
export const memoryLearn = {
  name: 'drift_memory_learn',
  description: 'Learn from corrections and feedback. Analyzes the correction, extracts principles, and creates appropriate memory types (tribal, procedural, code_smell, etc.).',
  parameters: {
    type: 'object',
    properties: {
      original: {
        type: 'string',
        description: 'The original code or response that was corrected',
      },
      feedback: {
        type: 'string',
        description: 'The user feedback or correction explanation',
      },
      correctedCode: {
        type: 'string',
        description: 'The corrected code (if applicable)',
      },
      context: {
        type: 'object',
        properties: {
          activeFile: { type: 'string' },
          activeFunction: { type: 'string' },
          intent: { type: 'string' },
          focus: { type: 'string' },
          relatedMemoryIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        description: 'Context at time of correction',
      },
      // Legacy parameters for backward compatibility
      userQuery: {
        type: 'string',
        description: 'Legacy: What the user asked (use original instead)',
      },
      agentResponse: {
        type: 'string',
        description: 'Legacy: What the agent responded (use original instead)',
      },
      outcome: {
        type: 'string',
        enum: ['accepted', 'rejected', 'modified', 'unknown'],
        description: 'Legacy: Outcome of the interaction',
      },
      extractedFacts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fact: { type: 'string' },
            confidence: { type: 'number' },
            type: { type: 'string', enum: ['preference', 'knowledge', 'correction', 'warning'] },
          },
        },
        description: 'Legacy: Facts extracted from the interaction',
      },
    },
    required: [],
  },

  async execute(params: {
    original?: string;
    feedback?: string;
    correctedCode?: string;
    context?: {
      activeFile?: string;
      activeFunction?: string;
      intent?: string;
      focus?: string;
      relatedMemoryIds?: string[];
    };
    // Legacy parameters
    userQuery?: string;
    agentResponse?: string;
    outcome?: string;
    extractedFacts?: Array<{
      fact: string;
      confidence: number;
      type: string;
    }>;
  }): Promise<LearnResult> {
    const cortex = await getCortex();

    // Handle legacy parameters
    const original = params.original ?? params.agentResponse ?? '';
    const feedback = params.feedback ?? params.userQuery ?? '';

    // Try to use V2 learning if available
    if ('learn' in cortex && original && feedback) {
      try {
        const learnResult = await (cortex as any).learn(
          original,
          feedback,
          params.correctedCode,
          params.context
        );

        return {
          learned: true,
          memoriesCreated: learnResult.memoriesCreated.map((m: any) => ({
            id: m.id,
            type: m.type,
            summary: m.summary,
          })),
          analysis: {
            correctionType: learnResult.analysis?.correctionType ?? 'unknown',
            severity: learnResult.analysis?.severity ?? 'normal',
            extractedPrinciples: learnResult.analysis?.extractedPrinciples ?? [],
            confidence: learnResult.analysis?.confidence ?? 0.8,
          },
          causalLinks: learnResult.causalLinks ?? [],
          recommendations: learnResult.recommendations ?? [],
        };
      } catch {
        // Fall back to legacy approach
      }
    }

    // Legacy approach: create episodic memory
    const id = await cortex.add({
      type: 'episodic',
      interaction: {
        userQuery: feedback,
        agentResponse: original,
        outcome: (params.outcome as 'accepted' | 'rejected' | 'modified' | 'unknown') ?? 'modified',
      },
      context: params.context ?? {},
      extractedFacts: params.extractedFacts as any,
      consolidationStatus: 'pending',
      sessionId: generateSessionId(),
      summary: `💭 ${params.context?.focus ?? 'Correction'}`,
      confidence: 1.0,
      importance: 'normal',
    } as any);

    // Extract principles from feedback if possible
    const extractedPrinciples: string[] = [];
    if (feedback) {
      // Simple principle extraction from feedback
      const sentences = feedback.split(/[.!?]+/).filter(s => s.trim().length > 10);
      for (const sentence of sentences.slice(0, 3)) {
        const trimmed = sentence.trim();
        if (trimmed.toLowerCase().includes('always') ||
            trimmed.toLowerCase().includes('never') ||
            trimmed.toLowerCase().includes('should') ||
            trimmed.toLowerCase().includes('must')) {
          extractedPrinciples.push(trimmed);
        }
      }
    }

    return {
      learned: true,
      memoriesCreated: [{
        id,
        type: 'episodic',
        summary: `💭 ${params.context?.focus ?? 'Correction'}`,
      }],
      analysis: {
        correctionType: params.outcome === 'rejected' ? 'rejection' : 'modification',
        severity: 'normal',
        extractedPrinciples,
        confidence: 0.8,
      },
      causalLinks: [],
      recommendations: extractedPrinciples.length > 0
        ? ['Principles extracted will be consolidated into permanent memories']
        : ['Consider providing more specific feedback for better learning'],
    };
  },
};
