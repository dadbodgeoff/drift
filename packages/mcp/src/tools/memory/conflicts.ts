/**
 * drift_memory_conflicts
 * 
 * Detect conflicting memories that may cause inconsistent behavior.
 * Identifies contradictions and suggests resolutions.
 */

import { getCortex } from 'driftdetect-cortex';

interface ConflictPair {
  memory1: {
    id: string;
    type: string;
    summary: string;
    confidence: number;
  };
  memory2: {
    id: string;
    type: string;
    summary: string;
    confidence: number;
  };
  conflictType: 'contradiction' | 'superseded' | 'overlap';
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestedResolution: string;
}

interface ConflictsResult {
  conflicts: ConflictPair[];
  totalConflicts: number;
  summary: string;
}

/**
 * Drift memory conflicts tool definition
 */
export const driftMemoryConflicts = {
  name: 'drift_memory_conflicts',
  description: 'Detect conflicting memories that may cause inconsistent behavior. Identifies contradictions and suggests resolutions.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Optional: limit conflict detection to memories related to this file or topic',
      },
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: limit to specific memory types',
      },
      minSeverity: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        default: 'low',
        description: 'Minimum severity to report',
      },
    },
  },

  async execute(params: {
    scope?: string;
    types?: string[];
    minSeverity?: 'low' | 'medium' | 'high';
  }): Promise<ConflictsResult> {
    const cortex = await getCortex();
    const conflicts: ConflictPair[] = [];
    const minSeverity = params.minSeverity ?? 'low';
    const severityOrder = { low: 0, medium: 1, high: 2 };

    // Get memories to analyze
    let memories;
    if (params.scope) {
      memories = await cortex.storage.findByFile(params.scope);
    } else {
      memories = await cortex.storage.search({ limit: 200 });
    }

    // Filter by types if specified
    if (params.types && params.types.length > 0) {
      memories = memories.filter(m => params.types!.includes(m.type));
    }

    // Check for superseded relationships
    for (const memory of memories) {
      const related = await cortex.storage.getRelated(memory.id, 'supersedes');
      for (const superseded of related) {
        const severity = superseded.confidence > 0.5 ? 'high' : 'medium';
        if (severityOrder[severity] >= severityOrder[minSeverity]) {
          conflicts.push({
            memory1: {
              id: memory.id,
              type: memory.type,
              summary: memory.summary,
              confidence: memory.confidence,
            },
            memory2: {
              id: superseded.id,
              type: superseded.type,
              summary: superseded.summary,
              confidence: superseded.confidence,
            },
            conflictType: 'superseded',
            severity,
            description: `Memory "${memory.summary}" supersedes "${superseded.summary}"`,
            suggestedResolution: 'Consider archiving or deleting the superseded memory',
          });
        }
      }

      // Check for contradictions
      const contradictions = await cortex.storage.getRelated(memory.id, 'contradicts');
      for (const contradicting of contradictions) {
        const severity = 'high';
        if (severityOrder[severity] >= severityOrder[minSeverity]) {
          conflicts.push({
            memory1: {
              id: memory.id,
              type: memory.type,
              summary: memory.summary,
              confidence: memory.confidence,
            },
            memory2: {
              id: contradicting.id,
              type: contradicting.type,
              summary: contradicting.summary,
              confidence: contradicting.confidence,
            },
            conflictType: 'contradiction',
            severity,
            description: `Memory "${memory.summary}" contradicts "${contradicting.summary}"`,
            suggestedResolution: 'Review both memories and keep the more accurate one',
          });
        }
      }
    }

    // Deduplicate conflicts (A conflicts with B = B conflicts with A)
    const seen = new Set<string>();
    const uniqueConflicts = conflicts.filter(c => {
      const key1 = `${c.memory1.id}:${c.memory2.id}`;
      const key2 = `${c.memory2.id}:${c.memory1.id}`;
      if (seen.has(key1) || seen.has(key2)) {
        return false;
      }
      seen.add(key1);
      return true;
    });

    // Generate summary
    let summary: string;
    if (uniqueConflicts.length === 0) {
      summary = 'No conflicts detected in the memory system.';
    } else {
      const highCount = uniqueConflicts.filter(c => c.severity === 'high').length;
      const mediumCount = uniqueConflicts.filter(c => c.severity === 'medium').length;
      const parts: string[] = [];
      if (highCount > 0) parts.push(`${highCount} high severity`);
      if (mediumCount > 0) parts.push(`${mediumCount} medium severity`);
      summary = `Found ${uniqueConflicts.length} conflict(s): ${parts.join(', ')}.`;
    }

    return {
      conflicts: uniqueConflicts,
      totalConflicts: uniqueConflicts.length,
      summary,
    };
  },
};
