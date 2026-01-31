/**
 * drift_memory_validate
 * 
 * Run validation on memories to detect and heal staleness.
 * V2: Enhanced with healing stats and detailed issue tracking.
 */

import { getCortex } from 'driftdetect-cortex';

interface ValidationIssue {
  memoryId: string;
  type: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  healed: boolean;
  healAction?: string;
}

interface ValidateResult {
  summary: {
    total: number;
    valid: number;
    stale: number;
    healed: number;
    flaggedForReview: number;
  };
  healingStats: {
    confidenceAdjusted: number;
    summariesFixed: number;
    relationshipsRepaired: number;
    memoriesRemoved: number;
  };
  duration: number;
  details: ValidationIssue[];
  recommendations: string[];
}

/**
 * Memory validate tool definition - V2 with healing stats
 */
export const memoryValidate = {
  name: 'drift_memory_validate',
  description: 'Run validation on memories to detect staleness and optionally auto-heal. Returns detailed healing statistics.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['all', 'stale', 'recent', 'high_importance'],
        default: 'stale',
        description: 'Which memories to validate',
      },
      autoHeal: {
        type: 'boolean',
        default: true,
        description: 'Automatically heal minor issues',
      },
      removeInvalid: {
        type: 'boolean',
        default: false,
        description: 'Remove memories that cannot be healed',
      },
      minConfidenceThreshold: {
        type: 'number',
        default: 0.2,
        description: 'Minimum confidence to keep (memories below this may be removed)',
      },
    },
  },

  async execute(params: {
    scope?: string;
    autoHeal?: boolean;
    removeInvalid?: boolean;
    minConfidenceThreshold?: number;
  }): Promise<ValidateResult> {
    const cortex = await getCortex();
    const startTime = Date.now();
    const autoHeal = params.autoHeal !== false;
    const minConfidence = params.minConfidenceThreshold ?? 0.2;

    const healingStats = {
      confidenceAdjusted: 0,
      summariesFixed: 0,
      relationshipsRepaired: 0,
      memoriesRemoved: 0,
    };

    const details: ValidationIssue[] = [];
    let valid = 0;
    let stale = 0;
    let healed = 0;
    let flaggedForReview = 0;

    // Get memories based on scope
    let memories;
    switch (params.scope) {
      case 'all':
        memories = await cortex.storage.search({ limit: 1000 });
        break;
      case 'recent':
        memories = await cortex.storage.search({ limit: 100 });
        break;
      case 'high_importance':
        memories = await cortex.storage.search({ 
          importance: ['high', 'critical'],
          limit: 500,
        });
        break;
      case 'stale':
      default:
        memories = await cortex.storage.search({ 
          maxConfidence: 0.5,
          limit: 500,
        });
        break;
    }

    for (const memory of memories) {
      const issues: ValidationIssue[] = [];

      // Check for missing summary
      if (!memory.summary || memory.summary.trim() === '') {
        const issue: ValidationIssue = {
          memoryId: memory.id,
          type: memory.type,
          issue: 'Missing summary',
          severity: 'medium',
          healed: false,
        };

        if (autoHeal) {
          await cortex.storage.update(memory.id, { 
            summary: `Memory ${memory.id.slice(0, 8)}...` 
          });
          issue.healed = true;
          issue.healAction = 'Generated placeholder summary';
          healingStats.summariesFixed++;
          healed++;
        }

        issues.push(issue);
      }

      // Check for invalid confidence
      if (memory.confidence < 0 || memory.confidence > 1) {
        const issue: ValidationIssue = {
          memoryId: memory.id,
          type: memory.type,
          issue: `Invalid confidence: ${memory.confidence}`,
          severity: 'high',
          healed: false,
        };

        if (autoHeal) {
          const fixedConfidence = Math.max(0, Math.min(1, memory.confidence));
          await cortex.storage.update(memory.id, { confidence: fixedConfidence });
          issue.healed = true;
          issue.healAction = `Adjusted to ${fixedConfidence}`;
          healingStats.confidenceAdjusted++;
          healed++;
        }

        issues.push(issue);
      }

      // Check for very low confidence
      if (memory.confidence < minConfidence) {
        const issue: ValidationIssue = {
          memoryId: memory.id,
          type: memory.type,
          issue: `Very low confidence: ${memory.confidence}`,
          severity: 'low',
          healed: false,
        };

        if (params.removeInvalid) {
          await cortex.storage.delete(memory.id);
          issue.healed = true;
          issue.healAction = 'Removed';
          healingStats.memoriesRemoved++;
          healed++;
        } else {
          flaggedForReview++;
        }

        issues.push(issue);
        stale++;
      }

      // Check for stale memories (old and not accessed)
      const createdAt = new Date(memory.createdAt);
      const lastAccessed = memory.lastAccessed ? new Date(memory.lastAccessed) : createdAt;
      const now = new Date();
      const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const daysSinceAccess = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

      if (ageInDays > 90 && daysSinceAccess > 30 && memory.accessCount < 3) {
        const issue: ValidationIssue = {
          memoryId: memory.id,
          type: memory.type,
          issue: `Stale: ${Math.round(ageInDays)} days old, ${memory.accessCount} accesses`,
          severity: 'low',
          healed: false,
        };

        if (autoHeal && memory.confidence > 0.3) {
          // Reduce confidence for stale memories
          const newConfidence = memory.confidence * 0.8;
          await cortex.storage.update(memory.id, { confidence: newConfidence });
          issue.healed = true;
          issue.healAction = `Reduced confidence to ${newConfidence.toFixed(2)}`;
          healingStats.confidenceAdjusted++;
          healed++;
        } else {
          flaggedForReview++;
        }

        issues.push(issue);
        stale++;
      }

      if (issues.length === 0) {
        valid++;
      }

      details.push(...issues);
    }

    const duration = Date.now() - startTime;

    // Generate recommendations
    const recommendations: string[] = [];
    if (stale > memories.length * 0.3) {
      recommendations.push('High percentage of stale memories - consider running consolidation');
    }
    if (healingStats.memoriesRemoved > 0) {
      recommendations.push(`Removed ${healingStats.memoriesRemoved} invalid memories`);
    }
    if (flaggedForReview > 0) {
      recommendations.push(`${flaggedForReview} memories flagged for manual review`);
    }
    if (recommendations.length === 0) {
      recommendations.push('Memory system is healthy');
    }

    return {
      summary: {
        total: memories.length,
        valid,
        stale,
        healed,
        flaggedForReview,
      },
      healingStats,
      duration,
      details: details.slice(0, 50), // Limit details
      recommendations,
    };
  },
};
