/**
 * drift_memory_status
 * 
 * Get memory system health overview.
 * V2: Enhanced with health metrics and recommendations.
 */

import { getCortex } from 'driftdetect-cortex';

interface StatusResult {
  counts: {
    total: number;
    byType: Record<string, number>;
    byConfidence: {
      high: number;
      medium: number;
      low: number;
      stale: number;
    };
  };
  health: {
    score: number;
    status: 'healthy' | 'warning' | 'critical';
    avgConfidence: number;
    staleCount: number;
    pendingConsolidation: number;
    lastConsolidation: string | null;
    lastValidation: string | null;
  };
  session?: {
    activeSessions: number;
    totalTokensSent: number;
  } | undefined;
  recentMemories: Array<{
    id: string;
    type: string;
    summary: string;
  }>;
  recommendations: string[];
}

/**
 * Memory status tool definition - V2 with health metrics
 */
export const memoryStatus = {
  name: 'drift_memory_status',
  description: 'Get memory system health overview including counts by type, confidence distribution, health score, and recommendations.',
  parameters: {
    type: 'object',
    properties: {
      includeRecommendations: {
        type: 'boolean',
        default: true,
        description: 'Include improvement recommendations',
      },
      includeSession: {
        type: 'boolean',
        default: true,
        description: 'Include session statistics',
      },
    },
  },

  async execute(params?: {
    includeRecommendations?: boolean;
    includeSession?: boolean;
  }): Promise<StatusResult> {
    const cortex = await getCortex();

    const counts = await cortex.storage.countByType();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    const staleCount = await cortex.storage.count({ maxConfidence: 0.5 });
    const pendingConsolidation = await cortex.storage.count({
      types: ['episodic'],
      consolidationStatus: 'pending',
    });

    const summaries = await cortex.storage.getSummaries({ limit: 10 });

    const highConfidence = await cortex.storage.count({ minConfidence: 0.8 });
    const mediumConfidence = await cortex.storage.count({ minConfidence: 0.5, maxConfidence: 0.8 });
    const lowConfidence = await cortex.storage.count({ minConfidence: 0.2, maxConfidence: 0.5 });

    const avgConfidence = await cortex.getAverageConfidence();
    const lastConsolidation = await cortex.getLastConsolidationDate();
    const lastValidation = await cortex.getLastValidationDate();

    // Calculate health score
    let healthScore = 100;
    const recommendations: string[] = [];

    if (avgConfidence < 0.5) {
      healthScore -= 20;
      recommendations.push('Run drift_memory_validate to clean up low-confidence memories');
    }
    if (staleCount > total * 0.3) {
      healthScore -= 15;
      recommendations.push('Many memories are stale - consider running validation');
    }
    if (pendingConsolidation > 50) {
      healthScore -= 10;
      recommendations.push('Run drift_memory_consolidate to process pending episodic memories');
    }
    if (total > 1000) {
      healthScore -= 5;
      recommendations.push('Large memory count - consider consolidation for better performance');
    }

    healthScore = Math.max(0, healthScore);

    let healthStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (healthScore < 50) healthStatus = 'critical';
    else if (healthScore < 80) healthStatus = 'warning';

    if (recommendations.length === 0) {
      recommendations.push('Memory system is healthy');
    }

    // Get session stats if available
    let session: StatusResult['session'] | undefined;
    if (params?.includeSession !== false && 'sessionManager' in cortex) {
      try {
        const activeSession = await (cortex as any).sessionManager.getActiveSession();
        session = {
          activeSessions: activeSession ? 1 : 0,
          totalTokensSent: activeSession?.tokensSent ?? 0,
        };
      } catch {
        // Session manager not available
      }
    }

    return {
      counts: {
        total,
        byType: counts as Record<string, number>,
        byConfidence: {
          high: highConfidence,
          medium: mediumConfidence,
          low: lowConfidence,
          stale: staleCount,
        },
      },
      health: {
        score: healthScore,
        status: healthStatus,
        avgConfidence,
        staleCount,
        pendingConsolidation,
        lastConsolidation,
        lastValidation,
      },
      session,
      recentMemories: summaries,
      recommendations: params?.includeRecommendations !== false ? recommendations : [],
    };
  },
};
