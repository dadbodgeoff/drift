/**
 * drift_memory_contradictions
 * 
 * Find and surface contradicting memories that need resolution.
 * Helps maintain memory consistency and quality.
 */

import { getCortex, ContradictionDetector, type ContradictionResult, type Memory, type MemoryType } from 'driftdetect-cortex';

/**
 * Contradiction pair with resolution suggestions
 */
interface ContradictionPair {
  memoryA: {
    id: string;
    type: MemoryType;
    summary: string;
    confidence: number;
    createdAt: string;
  };
  memoryB: {
    id: string;
    type: MemoryType;
    summary: string;
    confidence: number;
    createdAt: string;
  };
  contradictionType: 'direct' | 'partial' | 'supersedes' | 'temporal';
  confidence: number;
  evidence: string;
  suggestedResolution: {
    action: 'keep_a' | 'keep_b' | 'merge' | 'archive_both' | 'flag_for_review';
    reason: string;
  };
}

/**
 * Contradiction report
 */
interface ContradictionReport {
  success: boolean;
  totalContradictions: number;
  contradictions: ContradictionPair[];
  summary: {
    byType: Record<string, number>;
    bySeverity: {
      high: number;
      medium: number;
      low: number;
    };
    avgConfidence: number;
  };
  recommendations: string[];
  analysisTimeMs: number;
}

/**
 * Determine suggested resolution for a contradiction
 */
function suggestResolution(
  memoryA: Memory,
  memoryB: Memory,
  contradiction: ContradictionResult
): { action: 'keep_a' | 'keep_b' | 'merge' | 'archive_both' | 'flag_for_review'; reason: string } {
  // If one supersedes the other, keep the newer one
  if (contradiction.contradictionType === 'supersedes') {
    const aDate = new Date(memoryA.createdAt);
    const bDate = new Date(memoryB.createdAt);
    if (aDate > bDate) {
      return { action: 'keep_a', reason: 'Memory A is newer and supersedes Memory B' };
    }
    return { action: 'keep_b', reason: 'Memory B is newer and supersedes Memory A' };
  }

  // If confidence difference is significant, keep the higher confidence one
  const confidenceDiff = Math.abs(memoryA.confidence - memoryB.confidence);
  if (confidenceDiff > 0.3) {
    if (memoryA.confidence > memoryB.confidence) {
      return { action: 'keep_a', reason: `Memory A has significantly higher confidence (${memoryA.confidence.toFixed(2)} vs ${memoryB.confidence.toFixed(2)})` };
    }
    return { action: 'keep_b', reason: `Memory B has significantly higher confidence (${memoryB.confidence.toFixed(2)} vs ${memoryA.confidence.toFixed(2)})` };
  }

  // If both are low confidence, consider archiving both
  if (memoryA.confidence < 0.4 && memoryB.confidence < 0.4) {
    return { action: 'archive_both', reason: 'Both memories have low confidence' };
  }

  // If partial contradiction, suggest merge
  if (contradiction.contradictionType === 'partial') {
    return { action: 'merge', reason: 'Partial contradiction - memories may contain complementary information' };
  }

  // Default to flag for review
  return { action: 'flag_for_review', reason: 'Requires human review to determine correct resolution' };
}

/**
 * Drift memory contradictions tool definition
 */
export const driftMemoryContradictions = {
  name: 'drift_memory_contradictions',
  description: 'Find and surface contradicting memories that need resolution. Analyzes memory pairs for conflicts and suggests resolutions.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['all', 'high_confidence', 'recent', 'by_type'],
        default: 'all',
        description: 'Scope of analysis: all memories, only high confidence, recent (last 7 days), or specific type',
      },
      memoryType: {
        type: 'string',
        description: 'For by_type scope: the memory type to analyze',
      },
      minContradictionConfidence: {
        type: 'number',
        default: 0.5,
        description: 'Minimum confidence threshold for reporting contradictions (0-1)',
      },
      limit: {
        type: 'number',
        default: 20,
        description: 'Maximum contradictions to return',
      },
      includeResolved: {
        type: 'boolean',
        default: false,
        description: 'Include previously resolved contradictions',
      },
    },
  },

  async execute(params: {
    scope?: 'all' | 'high_confidence' | 'recent' | 'by_type';
    memoryType?: string;
    minContradictionConfidence?: number;
    limit?: number;
    includeResolved?: boolean;
  }): Promise<ContradictionReport> {
    const startTime = Date.now();
    const cortex = await getCortex();
    
    const scope = params.scope ?? 'all';
    const minConfidence = params.minContradictionConfidence ?? 0.5;
    const limit = params.limit ?? 20;

    // Get memories based on scope
    let memories: Memory[] = [];
    
    switch (scope) {
      case 'high_confidence':
        memories = await cortex.storage.search({ limit: 500 });
        memories = memories.filter(m => m.confidence >= 0.7);
        break;
      
      case 'recent':
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        memories = await cortex.storage.search({ limit: 500 });
        memories = memories.filter(m => new Date(m.createdAt) >= sevenDaysAgo);
        break;
      
      case 'by_type':
        if (params.memoryType) {
          memories = await cortex.storage.findByType(params.memoryType as MemoryType, { limit: 500 });
        }
        break;
      
      default:
        memories = await cortex.storage.search({ limit: 500 });
    }

    // Initialize contradiction detector
    const detector = new ContradictionDetector(
      cortex.storage,
      cortex.embeddings,
      { minContradictionConfidence: minConfidence }
    );

    // Find contradictions
    const contradictionPairs: ContradictionPair[] = [];
    const seenPairs = new Set<string>();

    for (const memory of memories) {
      const contradictions = await detector.detectContradictions(memory);
      
      for (const contradiction of contradictions) {
        // Skip if below threshold
        if (contradiction.confidence < minConfidence) continue;
        
        // Skip duplicate pairs
        const pairKey = [memory.id, contradiction.existingMemoryId].sort().join(':');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        // Get the other memory
        const otherMemory = await cortex.storage.read(contradiction.existingMemoryId);
        if (!otherMemory) continue;

        // Determine resolution
        const resolution = suggestResolution(memory, otherMemory, contradiction);

        contradictionPairs.push({
          memoryA: {
            id: memory.id,
            type: memory.type,
            summary: memory.summary,
            confidence: memory.confidence,
            createdAt: memory.createdAt,
          },
          memoryB: {
            id: otherMemory.id,
            type: otherMemory.type,
            summary: otherMemory.summary,
            confidence: otherMemory.confidence,
            createdAt: otherMemory.createdAt,
          },
          contradictionType: contradiction.contradictionType,
          confidence: contradiction.confidence,
          evidence: contradiction.evidence,
          suggestedResolution: resolution,
        });

        if (contradictionPairs.length >= limit) break;
      }

      if (contradictionPairs.length >= limit) break;
    }

    // Calculate summary statistics
    const byType: Record<string, number> = {};
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let totalConfidence = 0;

    for (const pair of contradictionPairs) {
      byType[pair.contradictionType] = (byType[pair.contradictionType] || 0) + 1;
      totalConfidence += pair.confidence;
      
      if (pair.confidence >= 0.8) highCount++;
      else if (pair.confidence >= 0.5) mediumCount++;
      else lowCount++;
    }

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (highCount > 5) {
      recommendations.push(`${highCount} high-confidence contradictions detected. Consider running memory consolidation.`);
    }
    
    if ((byType['supersedes'] ?? 0) > 3) {
      recommendations.push(`${byType['supersedes']} supersession contradictions found. Older memories may need archival.`);
    }
    
    if (contradictionPairs.length === 0) {
      recommendations.push('No significant contradictions detected. Memory consistency is good.');
    } else {
      recommendations.push(`Review the ${contradictionPairs.length} contradictions and apply suggested resolutions.`);
    }

    return {
      success: true,
      totalContradictions: contradictionPairs.length,
      contradictions: contradictionPairs,
      summary: {
        byType,
        bySeverity: {
          high: highCount,
          medium: mediumCount,
          low: lowCount,
        },
        avgConfidence: contradictionPairs.length > 0 
          ? totalConfidence / contradictionPairs.length 
          : 0,
      },
      recommendations,
      analysisTimeMs: Date.now() - startTime,
    };
  },
};
