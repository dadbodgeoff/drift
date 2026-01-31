/**
 * drift_memory_health
 * 
 * Get comprehensive health report for the memory system.
 * Shows statistics, issues, and recommendations.
 */

import { getCortex } from 'driftdetect-cortex';

interface HealthIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  recommendation: string;
}

interface HealthResult {
  overallScore: number;
  status: 'healthy' | 'warning' | 'critical';
  memoryStats: {
    total: number;
    byType: Record<string, number>;
    avgConfidence: number;
    lowConfidenceCount: number;
    recentlyAccessed: number;
  };
  validationStats: {
    lastValidation: string | null;
    issuesFound: number;
    issuesFixed: number;
  };
  issues: HealthIssue[];
  recommendations: string[];
}

/**
 * Drift memory health tool definition
 */
export const driftMemoryHealth = {
  name: 'drift_memory_health',
  description: 'Get comprehensive health report for the memory system. Shows statistics, issues, and recommendations for improvement.',
  parameters: {
    type: 'object',
    properties: {
      includeRecommendations: {
        type: 'boolean',
        default: true,
        description: 'Include improvement recommendations',
      },
      checkValidation: {
        type: 'boolean',
        default: true,
        description: 'Check for validation issues',
      },
    },
  },

  async execute(params: {
    includeRecommendations?: boolean;
    checkValidation?: boolean;
  }): Promise<HealthResult> {
    const cortex = await getCortex();
    
    // Get memory statistics
    const countByType = await cortex.storage.countByType();
    const total = Object.values(countByType).reduce((sum, count) => sum + count, 0);
    
    // Get sample of memories for analysis
    const memories = await cortex.storage.search({ limit: 500 });
    
    let confidenceSum = 0;
    let lowConfidenceCount = 0;
    let recentlyAccessed = 0;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    for (const memory of memories) {
      confidenceSum += memory.confidence;
      if (memory.confidence < 0.5) {
        lowConfidenceCount++;
      }
      if (memory.lastAccessed && new Date(memory.lastAccessed) > oneWeekAgo) {
        recentlyAccessed++;
      }
    }

    const avgConfidence = memories.length > 0 ? confidenceSum / memories.length : 0;

    // Identify issues
    const issues: HealthIssue[] = [];
    const recommendations: string[] = [];

    if (avgConfidence < 0.5) {
      issues.push({
        severity: 'high',
        message: `Average memory confidence is low (${Math.round(avgConfidence * 100)}%)`,
        recommendation: 'Run validation to confirm or remove low-confidence memories',
      });
    }

    if (lowConfidenceCount > memories.length * 0.3) {
      issues.push({
        severity: 'medium',
        message: `${lowConfidenceCount} memories (${Math.round(lowConfidenceCount / memories.length * 100)}%) have low confidence`,
        recommendation: 'Review and validate these memories',
      });
    }

    if (total > 1000) {
      issues.push({
        severity: 'low',
        message: `Large memory count (${total}) may impact performance`,
        recommendation: 'Consider running consolidation to merge similar memories',
      });
    }

    if (recentlyAccessed < memories.length * 0.1) {
      issues.push({
        severity: 'low',
        message: 'Most memories have not been accessed recently',
        recommendation: 'Consider pruning unused memories',
      });
    }

    // Generate recommendations
    if (params.includeRecommendations !== false) {
      if (lowConfidenceCount > 10) {
        recommendations.push('Run drift_memory_validate to clean up low-confidence memories');
      }
      if (total > 500) {
        recommendations.push('Run drift_memory_consolidate to merge similar memories');
      }
      if (avgConfidence < 0.7) {
        recommendations.push('Use drift_memory_feedback to confirm accurate memories');
      }
      if (recommendations.length === 0) {
        recommendations.push('Memory system is healthy. Continue using as normal.');
      }
    }

    // Calculate overall score
    let overallScore = 100;
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          overallScore -= 30;
          break;
        case 'high':
          overallScore -= 20;
          break;
        case 'medium':
          overallScore -= 10;
          break;
        case 'low':
          overallScore -= 5;
          break;
      }
    }
    overallScore = Math.max(0, overallScore);

    // Determine status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (overallScore < 50) {
      status = 'critical';
    } else if (overallScore < 80) {
      status = 'warning';
    }

    return {
      overallScore,
      status,
      memoryStats: {
        total,
        byType: countByType as Record<string, number>,
        avgConfidence,
        lowConfidenceCount,
        recentlyAccessed,
      },
      validationStats: {
        lastValidation: null,
        issuesFound: 0,
        issuesFixed: 0,
      },
      issues,
      recommendations,
    };
  },
};
