/**
 * drift_memory_add
 * 
 * Add a new memory to the system with causal inference.
 * Automatically infers causal relationships and links to existing memories.
 */

import { getCortex, type MemoryType } from 'driftdetect-cortex';

interface AddResult {
  id: string;
  created: boolean;
  linkedTo: string[];
  causalLinks: Array<{
    targetId: string;
    relationship: string;
    confidence: number;
  }>;
  conflicts: Array<{
    memoryId: string;
    reason: string;
  }>;
}

/**
 * Memory add tool definition - V2 with causal inference
 */
export const memoryAdd = {
  name: 'drift_memory_add',
  description: 'Add a new memory to the system. Supports domain-agnostic types (decision, insight, reference, preference), code-specific types (tribal, procedural, semantic, pattern_rationale, constraint_override, decision_context, code_smell), and universal types (agent_spawn, entity, goal, feedback, workflow, conversation, incident, meeting, skill, environment). Automatically infers causal relationships.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [
          // Domain-agnostic (for business, research, personal use)
          'decision',           // Standalone decisions
          'insight',            // Learned observations
          'reference',          // External references
          'preference',         // User/team preferences
          // General knowledge
          'tribal',             // Institutional knowledge
          'procedural',         // How-to procedures
          'semantic',           // Consolidated knowledge
          // Code-specific
          'pattern_rationale',  // Why patterns exist
          'constraint_override', // Approved exceptions
          'decision_context',   // Code decision context
          'code_smell',         // Anti-patterns
          // Universal memory types (v2)
          'agent_spawn',        // Reusable agent configurations
          'entity',             // Projects, products, teams, systems
          'goal',               // Objectives with progress tracking
          'feedback',           // Corrections and learning signals
          'workflow',           // Step-by-step processes
          'conversation',       // Summarized past discussions
          'incident',           // Postmortems and lessons learned
          'meeting',            // Meeting notes and action items
          'skill',              // Knowledge domains and proficiency
          'environment',        // System/environment configurations
        ],
        description: 'Type of memory to create',
      },
      content: {
        type: 'object',
        description: 'Memory content (varies by type). For decision: {title, outcome, decisionSummary, context?, alternatives?, stakeholders?}. For insight: {insight, source, domain?}. For reference: {title, url?, keyPoints}. For preference: {preference, category, scope, strength}. For agent_spawn: {name, description, slug, systemPrompt, tools, triggerPatterns}. For entity: {entityType, name, keyFacts, status}. For goal: {title, description, status, progress, successCriteria}. For workflow: {name, description, slug, steps, triggerPhrases}. For incident: {title, severity, impact, resolution, lessonsLearned}.',
      },
      linkedPatterns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pattern IDs to link to (code-specific)',
      },
      linkedFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths to link to (code-specific)',
      },
      importance: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'critical'],
        default: 'normal',
      },
      domain: {
        type: 'string',
        description: 'Domain/category for the memory (e.g., "business", "hiring", "architecture")',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
      // V2 parameters
      inferCausal: {
        type: 'boolean',
        default: true,
        description: 'Automatically infer causal relationships',
      },
      relatedMemoryIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of related memories to link causally',
      },
      causedBy: {
        type: 'string',
        description: 'ID of memory that caused this one',
      },
      supersedes: {
        type: 'string',
        description: 'ID of memory this one supersedes',
      },
    },
    required: ['type', 'content'],
  },

  async execute(params: {
    type: string;
    content: Record<string, unknown>;
    linkedPatterns?: string[];
    linkedFiles?: string[];
    importance?: string;
    inferCausal?: boolean;
    relatedMemoryIds?: string[];
    causedBy?: string;
    supersedes?: string;
  }): Promise<AddResult> {
    const cortex = await getCortex();

    const memory = {
      type: params.type as MemoryType,
      ...params.content,
      linkedPatterns: params.linkedPatterns,
      linkedFiles: params.linkedFiles,
      importance: (params.importance || 'normal') as 'low' | 'normal' | 'high' | 'critical',
      confidence: 1.0,
      summary: '', // Will be generated
    };

    const id = await cortex.add(memory as any);

    const result: AddResult = {
      id,
      created: true,
      linkedTo: [],
      causalLinks: [],
      conflicts: [],
    };

    // Link to patterns/files
    if (params.linkedPatterns) {
      for (const patternId of params.linkedPatterns) {
        try {
          await cortex.storage.linkToPattern(id, patternId);
          result.linkedTo.push(patternId);
        } catch {
          // Pattern linking not supported or pattern not found
        }
      }
    }

    if (params.linkedFiles) {
      for (const file of params.linkedFiles) {
        try {
          await cortex.storage.linkToFile(id, file);
          result.linkedTo.push(file);
        } catch {
          // File linking not supported
        }
      }
    }

    // Handle explicit causal relationships
    if (params.causedBy) {
      try {
        await cortex.storage.addRelationship(id, params.causedBy, 'derived_from');
        result.causalLinks.push({
          targetId: params.causedBy,
          relationship: 'derived_from',
          confidence: 1.0,
        });
      } catch {
        // Relationship not supported
      }
    }

    if (params.supersedes) {
      try {
        await cortex.storage.addRelationship(id, params.supersedes, 'supersedes');
        result.causalLinks.push({
          targetId: params.supersedes,
          relationship: 'supersedes',
          confidence: 1.0,
        });
        // Reduce confidence of superseded memory
        const supersededMemory = await cortex.storage.read(params.supersedes);
        if (supersededMemory) {
          await cortex.storage.update(params.supersedes, {
            confidence: Math.max(0.1, supersededMemory.confidence * 0.5),
          });
        }
      } catch {
        // Relationship not supported
      }
    }

    // Infer causal relationships if enabled
    if (params.inferCausal !== false) {
      try {
        // Find similar memories that might be related
        const summary = (params.content as any).summary ?? 
                       (params.content as any).knowledge ?? 
                       (params.content as any).rationale ?? '';
        
        if (summary && cortex.embeddings) {
          const embedding = await cortex.embeddings.embed(summary);
          const similar = await cortex.storage.similaritySearch(embedding, 5);
          
          for (const similarMemory of similar) {
            if (similarMemory.id === id) continue;
            
            // Check for potential conflicts
            if (similarMemory.type === params.type) {
              const similarity = await calculateSimilarity(summary, similarMemory.summary);
              if (similarity > 0.9) {
                result.conflicts.push({
                  memoryId: similarMemory.id,
                  reason: 'Very similar memory already exists',
                });
              } else if (similarity > 0.7) {
                // Link as related
                try {
                  await cortex.storage.addRelationship(id, similarMemory.id, 'related');
                  result.causalLinks.push({
                    targetId: similarMemory.id,
                    relationship: 'related',
                    confidence: similarity,
                  });
                } catch {
                  // Relationship not supported
                }
              }
            }
          }
        }
      } catch {
        // Causal inference not available
      }
    }

    // Link to explicitly provided related memories
    if (params.relatedMemoryIds) {
      for (const relatedId of params.relatedMemoryIds) {
        try {
          await cortex.storage.addRelationship(id, relatedId, 'related');
          result.causalLinks.push({
            targetId: relatedId,
            relationship: 'related',
            confidence: 1.0,
          });
        } catch {
          // Relationship not supported
        }
      }
    }

    return result;
  },
};

/**
 * Simple similarity calculation (Jaccard-like)
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}
