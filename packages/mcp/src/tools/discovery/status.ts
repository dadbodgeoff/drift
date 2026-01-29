/**
 * drift_status - Codebase Health Snapshot
 * 
 * Discovery tool that provides a quick overview of:
 * - Pattern counts by category
 * - Health score
 * - Critical issues requiring attention
 * - Scan status
 * 
 * OPTIMIZED: Uses pre-computed views from the data lake for instant response.
 * Falls back to computing from raw data if views are unavailable.
 * 
 * MIGRATION: Now supports both legacy PatternStore and new IPatternService.
 * The service-based approach is preferred for new code.
 */

import { createResponseBuilder } from '../../infrastructure/index.js';

import type { PatternStore, DataLake, StatusView, IPatternService } from 'driftdetect-core';

export interface StatusData {
  health: {
    score: number;
    trend: 'improving' | 'stable' | 'declining';
  };
  patterns: {
    total: number;
    approved: number;
    discovered: number;
    byCategory: Record<string, number>;
  };
  issues: {
    critical: number;
    warnings: number;
  };
  lastScan?: string | undefined;
  /** Response source for debugging */
  _source?: 'view' | 'computed' | 'service';
}

/**
 * Handle status request using IPatternService (preferred)
 */
export async function handleStatusWithService(
  service: IPatternService,
  _args: Record<string, unknown>,
  dataLake?: DataLake
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<StatusData>();
  
  try {
    // OPTIMIZATION: Try data lake view first (instant response)
    if (dataLake) {
      const statusView = await tryGetStatusFromLake(dataLake);
      if (statusView) {
        return buildResponseFromView(builder, statusView);
      }
    }
    
    // Use the pattern service
    const status = await service.getStatus();
    
    // Count issues from patterns
    const result = await service.query({
      filter: { statuses: ['approved'] },
      pagination: { offset: 0, limit: 1000 },
    });
    
    const criticalIssues = result.patterns.filter(
      p => p.outliers.length > 5
    ).length;
    const warnings = result.patterns.filter(
      p => p.confidence < 0.7 && p.locations.length > 3
    ).length;
    
    const data: StatusData = {
      health: {
        score: status.healthScore,
        trend: 'stable', // TODO: Calculate from history
      },
      patterns: {
        total: status.totalPatterns,
        approved: status.byStatus.approved,
        discovered: status.byStatus.discovered,
        byCategory: status.byCategory as Record<string, number>,
      },
      issues: {
        critical: criticalIssues,
        warnings,
      },
      lastScan: status.lastScanAt?.toISOString(),
      _source: 'service',
    };
    
    // Build summary
    let summary = `Health: ${status.healthScore}/100. `;
    summary += `${status.totalPatterns} patterns (${status.byStatus.approved} approved). `;
    if (criticalIssues > 0) {
      summary += `⚠️ ${criticalIssues} critical issues.`;
    } else {
      summary += 'No critical issues.';
    }
    
    return builder
      .withSummary(summary)
      .withData(data)
      .withHints({
        nextActions: [
          criticalIssues > 0 
            ? 'Use drift_patterns_list with status="approved" to see patterns with issues'
            : 'Use drift_patterns_list to explore discovered patterns',
          'Use drift_capabilities to see all available tools',
        ],
        ...(criticalIssues > 0 ? { warnings: [`${criticalIssues} approved patterns have significant outliers`] } : {}),
      })
      .buildContent();
      
  } catch (error) {
    // No patterns found - likely needs scan
    return builder
      .withSummary('No pattern data found. Run drift scan first.')
      .withData({
        health: { score: 0, trend: 'stable' },
        patterns: { total: 0, approved: 0, discovered: 0, byCategory: {} },
        issues: { critical: 0, warnings: 0 },
      })
      .withHints({
        nextActions: ["Run 'drift scan' in the project root to analyze patterns"],
      })
      .buildContent();
  }
}

/**
 * Handle status request using legacy PatternStore (backward compatibility)
 * @deprecated Use handleStatusWithService instead
 */
export async function handleStatus(
  store: PatternStore,
  _args: Record<string, unknown>,
  dataLake?: DataLake
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<StatusData>();
  
  try {
    // OPTIMIZATION: Try data lake view first (instant response)
    if (dataLake) {
      const statusView = await tryGetStatusFromLake(dataLake);
      if (statusView) {
        return buildResponseFromView(builder, statusView);
      }
    }
    
    // Fallback: Compute from raw data
    await store.initialize();
    const stats = store.getStats();
    const patterns = store.getAll();
    
    // Calculate health score (0-100)
    const approvedCount = patterns.filter(p => p.status === 'approved').length;
    const highConfidenceCount = patterns.filter(p => p.confidence.score >= 0.85).length;
    const healthScore = Math.round(
      (approvedCount / Math.max(1, stats.totalPatterns)) * 50 +
      (highConfidenceCount / Math.max(1, stats.totalPatterns)) * 50
    );
    
    // Count issues
    const criticalIssues = patterns.filter(
      p => p.status === 'approved' && p.outliers.length > 5
    ).length;
    const warnings = patterns.filter(
      p => p.confidence.score < 0.7 && p.locations.length > 3
    ).length;
    
    const data: StatusData = {
      health: {
        score: healthScore,
        trend: 'stable', // TODO: Calculate from history
      },
      patterns: {
        total: stats.totalPatterns,
        approved: approvedCount,
        discovered: stats.totalPatterns - approvedCount,
        byCategory: stats.byCategory,
      },
      issues: {
        critical: criticalIssues,
        warnings,
      },
      _source: 'computed',
    };
    
    // Build summary
    let summary = `Health: ${healthScore}/100. `;
    summary += `${stats.totalPatterns} patterns (${approvedCount} approved). `;
    if (criticalIssues > 0) {
      summary += `⚠️ ${criticalIssues} critical issues.`;
    } else {
      summary += 'No critical issues.';
    }
    
    return builder
      .withSummary(summary)
      .withData(data)
      .withHints({
        nextActions: [
          criticalIssues > 0 
            ? 'Use drift_patterns_list with status="approved" to see patterns with issues'
            : 'Use drift_patterns_list to explore discovered patterns',
          'Use drift_capabilities to see all available tools',
        ],
        ...(criticalIssues > 0 ? { warnings: [`${criticalIssues} approved patterns have significant outliers`] } : {}),
      })
      .buildContent();
      
  } catch (error) {
    // No patterns found - likely needs scan
    return builder
      .withSummary('No pattern data found. Run drift scan first.')
      .withData({
        health: { score: 0, trend: 'stable' },
        patterns: { total: 0, approved: 0, discovered: 0, byCategory: {} },
        issues: { critical: 0, warnings: 0 },
      })
      .withHints({
        nextActions: ["Run 'drift scan' in the project root to analyze patterns"],
      })
      .buildContent();
  }
}

/**
 * Try to get status from data lake view (instant)
 */
async function tryGetStatusFromLake(dataLake: DataLake): Promise<StatusView | null> {
  try {
    await dataLake.initialize();
    return await dataLake.query.getStatus();
  } catch {
    return null;
  }
}

/**
 * Build response from pre-computed status view
 */
function buildResponseFromView(
  builder: ReturnType<typeof createResponseBuilder<StatusData>>,
  view: StatusView
): { content: Array<{ type: string; text: string }> } {
  const data: StatusData = {
    health: {
      score: view.health.score,
      trend: view.health.trend,
    },
    patterns: {
      total: view.patterns.total,
      approved: view.patterns.approved,
      discovered: view.patterns.discovered,
      byCategory: view.patterns.byCategory,
    },
    issues: {
      critical: view.issues.critical,
      warnings: view.issues.warnings,
    },
    lastScan: view.lastScan.timestamp,
    _source: 'view',
  };
  
  // Build summary
  let summary = `Health: ${view.health.score}/100 (${view.health.trend}). `;
  summary += `${view.patterns.total} patterns (${view.patterns.approved} approved). `;
  if (view.issues.critical > 0) {
    summary += `⚠️ ${view.issues.critical} critical issues.`;
  } else {
    summary += 'No critical issues.';
  }
  
  // Add security info if available
  if (view.security.violations > 0) {
    summary += ` Security: ${view.security.riskLevel} risk, ${view.security.violations} violations.`;
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: [
        view.issues.critical > 0 
          ? 'Use drift_patterns_list with status="approved" to see patterns with issues'
          : 'Use drift_patterns_list to explore discovered patterns',
        view.security.violations > 0
          ? 'Use drift_security_summary to review security violations'
          : 'Use drift_capabilities to see all available tools',
      ],
      ...(view.issues.critical > 0 ? { warnings: [`${view.issues.critical} critical issues detected`] } : {}),
    })
    .buildContent();
}
