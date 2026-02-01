/**
 * drift_memory_for_context
 * 
 * Get memories relevant to current context (integrates with drift_context).
 * V2: Supports compression levels and session tracking.
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

interface ContextMemory {
  id: string;
  type: string;
  summary: string;
  confidence: number;
  compressed?: boolean;
  compressionLevel?: number;
}

interface ContextResult {
  // Domain-agnostic
  core: ContextMemory[];
  tribal: ContextMemory[];
  procedural: ContextMemory[];
  semantic: ContextMemory[];
  decisions: ContextMemory[];
  insights: ContextMemory[];
  references: ContextMemory[];
  preferences: ContextMemory[];
  // Code-specific
  patternRationales: ContextMemory[];
  constraintOverrides: ContextMemory[];
  codeSmells: ContextMemory[];
  // Metadata
  warnings: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
  tokensUsed: number;
  memoriesIncluded: number;
  memoriesOmitted: number;
  retrievalTime: number;
  compressionLevel: number;
  sessionId?: string;
  deduplicatedCount: number;
}

/**
 * Memory for context tool definition - V2 with compression levels
 */
export const memoryForContext = {
  name: 'drift_memory_for_context',
  description: 'Get memories relevant to current context. Supports compression levels for token efficiency.',
  parameters: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: [
          // Domain-agnostic intents
          'create',           // Creating something new (not code-specific)
          'investigate',      // Understanding/researching
          'decide',           // Making a decision
          'recall',           // Finding past knowledge
          'learn',            // Adding new knowledge
          // Code-specific intents
          'add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test'
        ],
        description: 'What you are trying to do',
      },
      focus: {
        type: 'string',
        description: 'What you are working on',
      },
      activeFile: { type: 'string' },
      relevantPatterns: { type: 'array', items: { type: 'string' } },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeAlreadySent: { type: 'boolean', default: false },
    },
    required: ['intent', 'focus'],
  },

  async execute(params: {
    intent: string;
    focus: string;
    activeFile?: string;
    relevantPatterns?: string[];
    maxTokens?: number;
    compressionLevel?: 1 | 2 | 3;
    sessionId?: string;
    excludeAlreadySent?: boolean;
  }): Promise<ContextResult> {
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;

    const retrievalContext: Parameters<typeof cortex.retrieval.retrieve>[0] = {
      intent: params.intent as Intent,
      focus: params.focus,
      maxTokens: params.maxTokens || 2000,
    };

    if (params.activeFile) retrievalContext.activeFile = params.activeFile;
    if (params.relevantPatterns) retrievalContext.relevantPatterns = params.relevantPatterns;

    const result = await cortex.retrieval.retrieve(retrievalContext);

    const toMem = (m: any): ContextMemory => {
      let summary = m.memory.summary;
      if (compressionLevel === 3 && summary.length > 50) summary = summary.slice(0, 47) + '...';
      else if (compressionLevel === 2 && summary.length > 150) summary = summary.slice(0, 147) + '...';
      return { id: m.memory.id, type: m.memory.type, summary, confidence: m.memory.confidence, compressed: compressionLevel > 1, compressionLevel };
    };

    const byType = {
      // Domain-agnostic
      core: result.memories.filter(m => m.memory.type === 'core').map(toMem),
      tribal: result.memories.filter(m => m.memory.type === 'tribal').map(toMem),
      procedural: result.memories.filter(m => m.memory.type === 'procedural').map(toMem),
      semantic: result.memories.filter(m => m.memory.type === 'semantic').map(toMem),
      decisions: result.memories.filter(m => m.memory.type === 'decision').map(toMem),
      insights: result.memories.filter(m => m.memory.type === 'insight').map(toMem),
      references: result.memories.filter(m => m.memory.type === 'reference').map(toMem),
      preferences: result.memories.filter(m => m.memory.type === 'preference').map(toMem),
      // Code-specific
      patternRationales: result.memories.filter(m => m.memory.type === 'pattern_rationale').map(toMem),
      constraintOverrides: result.memories.filter(m => m.memory.type === 'constraint_override').map(toMem),
      codeSmells: result.memories.filter(m => m.memory.type === 'code_smell').map(toMem),
    };

    const warnings = byType.tribal
      .filter(m => m.summary.toLowerCase().includes('warning') || m.summary.toLowerCase().includes('critical'))
      .map(m => ({ type: 'tribal', severity: m.summary.toLowerCase().includes('critical') ? 'critical' : 'warning', message: m.summary }));

    const contextResult: ContextResult = {
      ...byType,
      warnings,
      tokensUsed: result.tokensUsed,
      memoriesIncluded: result.memories.length,
      memoriesOmitted: result.totalCandidates - result.memories.length,
      retrievalTime: result.retrievalTime,
      compressionLevel,
      deduplicatedCount: 0,
    };
    
    if (params.sessionId !== undefined) {
      contextResult.sessionId = params.sessionId;
    }
    
    return contextResult;
  },
};
