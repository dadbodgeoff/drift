/**
 * drift_trends - Pattern Trend Analysis
 * 
 * Exploration tool that shows how patterns have changed over time.
 * Identifies regressions, improvements, and stability.
 */

import { createResponseBuilder } from '../../infrastructure/index.js';

import type { HistoryStore, PatternTrend } from 'driftdetect-core';

export interface TrendItem {
  patternId: string;
  patternName: string;
  category: string;
  type: 'regression' | 'improvement' | 'stable';
  severity?: 'critical' | 'warning';
  metric: string;
  change: {
    from: number;
    to: number;
    delta: number;
    deltaPercent: number;
  };
  details?: string;
}

export interface TrendsData {
  period: string;
  summary: {
    regressions: number;
    improvements: number;
    stable: number;
    criticalRegressions: number;
  };
  trends: TrendItem[];
  healthTrend: {
    current: number;
    previous: number;
    direction: 'up' | 'down' | 'stable';
  };
}

const DEFAULT_LIMIT = 20;

function getPeriodStartDate(period: string): string {
  const now = new Date();
  let daysAgo = 7;
  
  if (period === '30d') {daysAgo = 30;}
  else if (period === '90d') {daysAgo = 90;}
  
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - daysAgo);
  return startDate.toISOString().split('T')[0]!;
}

export async function handleTrends(
  store: HistoryStore,
  args: {
    period?: string;
    category?: string;
    severity?: string;
    limit?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<TrendsData>();
  
  const period = args.period ?? '7d';
  const limit = args.limit ?? DEFAULT_LIMIT;
  
  await store.initialize();
  
  // Get snapshots for the period
  const startDate = getPeriodStartDate(period);
  const snapshots = await store.getSnapshots(startDate);
  
  if (snapshots.length < 2) {
    return builder
      .withSummary(`Not enough history for ${period} trend analysis. Need at least 2 snapshots.`)
      .withData({
        period,
        summary: { regressions: 0, improvements: 0, stable: 0, criticalRegressions: 0 },
        trends: [],
        healthTrend: { current: 0, previous: 0, direction: 'stable' },
      })
      .withHints({
        nextActions: [
          "Run 'drift scan' periodically to build history",
          'Try a longer period like 30d or 90d',
        ],
      })
      .buildContent();
  }
  
  const oldSnapshot = snapshots[0]!;
  const newSnapshot = snapshots[snapshots.length - 1]!;
  
  // Calculate trends using the store's method
  const calculatedTrends = store.calculateTrends(newSnapshot, oldSnapshot);
  
  // Map to our TrendItem format
  let trends: TrendItem[] = calculatedTrends.map((t: PatternTrend) => {
    const item: TrendItem = {
      patternId: t.patternId,
      patternName: t.patternName,
      category: t.category,
      type: t.type,
      metric: t.metric,
      change: {
        from: t.previousValue,
        to: t.currentValue,
        delta: t.change,
        deltaPercent: Math.round(t.changePercent),
      },
      details: t.details,
    };
    
    if (t.severity === 'critical') {
      item.severity = 'critical';
    } else if (t.severity === 'warning') {
      item.severity = 'warning';
    }
    
    return item;
  });
  
  // Filter by category
  if (args.category) {
    trends = trends.filter(t => t.category === args.category);
  }
  
  // Filter by severity
  if (args.severity && args.severity !== 'all') {
    if (args.severity === 'critical') {
      trends = trends.filter(t => t.severity === 'critical');
    } else if (args.severity === 'warning') {
      trends = trends.filter(t => t.severity === 'critical' || t.severity === 'warning');
    }
  }
  
  // Sort: regressions first, then by severity
  trends.sort((a, b) => {
    if (a.type === 'regression' && b.type !== 'regression') {return -1;}
    if (b.type === 'regression' && a.type !== 'regression') {return 1;}
    if (a.severity === 'critical' && b.severity !== 'critical') {return -1;}
    if (b.severity === 'critical' && a.severity !== 'critical') {return 1;}
    return Math.abs(b.change.deltaPercent) - Math.abs(a.change.deltaPercent);
  });
  
  // Calculate summary before limiting
  const summary = {
    regressions: trends.filter(t => t.type === 'regression').length,
    improvements: trends.filter(t => t.type === 'improvement').length,
    stable: newSnapshot.patterns.length - trends.length,
    criticalRegressions: trends.filter(t => t.severity === 'critical').length,
  };
  
  // Apply limit
  trends = trends.slice(0, limit);
  
  // Calculate health trend from summaries
  const currentHealth = Math.round((newSnapshot.summary?.avgConfidence ?? 0) * 100);
  const previousHealth = Math.round((oldSnapshot.summary?.avgConfidence ?? 0) * 100);
  
  const healthTrend = {
    current: currentHealth,
    previous: previousHealth,
    direction: currentHealth > previousHealth + 5 
      ? 'up' as const
      : currentHealth < previousHealth - 5 
        ? 'down' as const 
        : 'stable' as const,
  };
  
  // Build summary text
  let summaryText = `${period} trends: `;
  if (summary.criticalRegressions > 0) {
    summaryText += `⚠️ ${summary.criticalRegressions} critical regressions. `;
  }
  summaryText += `${summary.regressions} regressions, ${summary.improvements} improvements. `;
  summaryText += `Health: ${currentHealth}/100 (${healthTrend.direction}).`;
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: summary.regressions > 0
      ? [
          'Use drift_pattern_get to investigate regression details',
          'Use drift_code_examples to see correct implementations',
        ]
      : [
          'Continue monitoring with periodic scans',
          'Use drift_patterns_list to explore stable patterns',
        ],
    relatedTools: ['drift_pattern_get', 'drift_code_examples', 'drift_patterns_list'],
  };
  
  if (summary.criticalRegressions > 0) {
    hints.warnings = [`${summary.criticalRegressions} patterns have critical regressions`];
  }
  
  return builder
    .withSummary(summaryText)
    .withData({ period, summary, trends, healthTrend })
    .withHints(hints)
    .buildContent();
}
