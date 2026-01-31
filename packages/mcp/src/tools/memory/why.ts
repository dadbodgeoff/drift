/**
 * drift_why
 * 
 * The killer feature - get complete "why" context for any task.
 * Now with causal narratives from Cortex V2.
 * 
 * Combines patterns, decisions, tribal knowledge, warnings,
 * and causal chains to explain WHY things are the way they are.
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

interface CausalChainItem {
  memoryId: string;
  summary: string;
  relationship: string;
  confidence: number;
}

interface TribalKnowledgeItem {
  topic: string;
  knowledge: string;
  severity: string;
  confidence: number;
}

interface ProcedureItem {
  name: string;
  steps?: string[];
  checklist?: string[];
}

interface PatternRationaleItem {
  pattern: string;
  rationale: string;
  businessContext?: string;
}

interface DecisionContextItem {
  decision: string;
  businessContext?: string;
  stillValid: boolean;
}

interface CodeSmellItem {
  name: string;
  reason: string;
  suggestion?: string;
}

interface WarningItem {
  type: string;
  message: string;
  severity: string;
  source: string;
}

interface WhyResult {
  // Causal narrative (new in v2)
  narrative: string;
  causalChain: CausalChainItem[];
  narrativeConfidence: number;
  
  // Traditional context
  tribalKnowledge: TribalKnowledgeItem[];
  procedures: ProcedureItem[];
  patternRationales: PatternRationaleItem[];
  decisionContexts: DecisionContextItem[];
  codeSmells: CodeSmellItem[];
  warnings: WarningItem[];
  
  // Metadata
  sources: string[];
  summary: string;
}

/**
 * Drift why tool definition - V2 with causal narratives
 */
export const driftWhy = {
  name: 'drift_why',
  description: 'Get complete "why" context for any task - patterns, decisions, tribal knowledge, warnings, and causal narratives. The killer feature for understanding codebase context.',
  parameters: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test'],
        description: 'What you are trying to do',
      },
      focus: {
        type: 'string',
        description: 'What you are working on',
      },
      includeCausal: {
        type: 'boolean',
        default: true,
        description: 'Include causal narrative explaining WHY',
      },
      includePatterns: { type: 'boolean', default: true },
      includeConstraints: { type: 'boolean', default: true },
      includeMemories: { type: 'boolean', default: true },
      includeDecisions: { type: 'boolean', default: true },
      includeWarnings: { type: 'boolean', default: true },
      verbosity: {
        type: 'string',
        enum: ['summary', 'detailed', 'comprehensive'],
        default: 'detailed',
      },
      maxTokens: { type: 'number', default: 3000 },
    },
    required: ['intent', 'focus'],
  },

  async execute(params: {
    intent: string;
    focus: string;
    includeCausal?: boolean;
    includePatterns?: boolean;
    includeConstraints?: boolean;
    includeMemories?: boolean;
    includeDecisions?: boolean;
    includeWarnings?: boolean;
    verbosity?: string;
    maxTokens?: number;
  }): Promise<WhyResult> {
    const cortex = await getCortex();
    const results: WhyResult = {
      narrative: '',
      causalChain: [],
      narrativeConfidence: 0,
      tribalKnowledge: [],
      procedures: [],
      patternRationales: [],
      decisionContexts: [],
      codeSmells: [],
      warnings: [],
      sources: [],
      summary: '',
    };

    // Get causal narrative from CortexV2 if available
    if (params.includeCausal !== false) {
      try {
        // Check if cortex has v2 capabilities
        if ('getWhy' in cortex) {
          const whyResult = await (cortex as any).getWhy(
            params.intent as Intent,
            params.focus
          );
          results.narrative = whyResult.narrative;
          results.causalChain = whyResult.causalChain.map((item: any) => ({
            memoryId: item.node?.memoryId ?? item.memoryId ?? 'unknown',
            summary: item.node?.summary ?? item.summary ?? '',
            relationship: item.relationship,
            confidence: item.confidence,
          }));
          results.narrativeConfidence = whyResult.confidence;
          results.sources = whyResult.sources;
        }
      } catch {
        // V2 not available, continue with traditional approach
      }
    }

    // Get memories (traditional approach)
    if (params.includeMemories !== false) {
      const memories = await cortex.retrieval.retrieve({
        intent: params.intent as Intent,
        focus: params.focus,
        maxTokens: (params.maxTokens || 3000) / 2,
      });

      results.tribalKnowledge = memories.memories
        .filter(m => m.memory.type === 'tribal')
        .map(m => {
          const mem = m.memory as { topic: string; knowledge: string; severity: string; confidence: number };
          return {
            topic: mem.topic,
            knowledge: mem.knowledge,
            severity: mem.severity,
            confidence: mem.confidence,
          };
        });

      results.procedures = memories.memories
        .filter(m => m.memory.type === 'procedural')
        .map(m => {
          const mem = m.memory as { name: string; steps?: Array<{ action: string }>; checklist?: Array<{ item: string }> };
          const item: ProcedureItem = { name: mem.name };
          if (mem.steps) {
            item.steps = mem.steps.map(s => s.action);
          }
          if (mem.checklist) {
            item.checklist = mem.checklist.map(c => c.item);
          }
          return item;
        });

      results.patternRationales = memories.memories
        .filter(m => m.memory.type === 'pattern_rationale')
        .map(m => {
          const mem = m.memory as { patternName: string; rationale: string; businessContext?: string };
          const item: PatternRationaleItem = {
            pattern: mem.patternName,
            rationale: mem.rationale,
          };
          if (mem.businessContext) {
            item.businessContext = mem.businessContext;
          }
          return item;
        });

      results.decisionContexts = memories.memories
        .filter(m => m.memory.type === 'decision_context')
        .map(m => {
          const mem = m.memory as { decisionSummary: string; businessContext?: string; stillValid: boolean };
          const item: DecisionContextItem = {
            decision: mem.decisionSummary,
            stillValid: mem.stillValid,
          };
          if (mem.businessContext) {
            item.businessContext = mem.businessContext;
          }
          return item;
        });

      results.codeSmells = memories.memories
        .filter(m => m.memory.type === 'code_smell')
        .map(m => {
          const mem = m.memory as { name: string; reason: string; suggestion?: string };
          const item: CodeSmellItem = {
            name: mem.name,
            reason: mem.reason,
          };
          if (mem.suggestion) {
            item.suggestion = mem.suggestion;
          }
          return item;
        });

      // Add memory IDs to sources
      for (const m of memories.memories) {
        if (!results.sources.includes(m.memory.id)) {
          results.sources.push(m.memory.id);
        }
      }
    }

    // Synthesize warnings
    if (params.includeWarnings !== false) {
      // Add tribal warnings
      for (const t of results.tribalKnowledge) {
        if (t.severity === 'critical' || t.severity === 'warning') {
          results.warnings.push({
            type: 'tribal',
            message: t.knowledge,
            severity: t.severity,
            source: t.topic,
          });
        }
      }

      // Add code smell warnings
      for (const s of results.codeSmells) {
        results.warnings.push({
          type: 'code_smell',
          message: `Avoid: ${s.name} - ${s.reason}`,
          severity: 'warning',
          source: s.name,
        });
      }
    }

    // Generate summary
    const parts: string[] = [];
    if (results.narrative) {
      parts.push('causal narrative');
    }
    if (results.patternRationales.length) {
      parts.push(`${results.patternRationales.length} pattern rationales`);
    }
    if (results.tribalKnowledge.length) {
      parts.push(`${results.tribalKnowledge.length} tribal knowledge items`);
    }
    if (results.procedures.length) {
      parts.push(`${results.procedures.length} procedures`);
    }
    if (results.warnings.length) {
      parts.push(`${results.warnings.length} warnings`);
    }

    results.summary = parts.length > 0
      ? `Context includes: ${parts.join(', ')}`
      : 'No relevant context found';

    return results;
  },
};
