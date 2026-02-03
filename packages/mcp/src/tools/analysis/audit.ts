/**
 * drift_audit - Pattern Audit System
 *
 * Runs pattern audit to detect duplicates, validate cross-references,
 * and generate approval recommendations. Supports agent-assisted
 * pattern review workflows.
 * 
 * Phase 3: Uses async factory for automatic SQLite support.
 */

import {
  AuditEngine,
  AuditStore,
  type AuditResult,
  type AuditOptions,
} from 'driftdetect-core';
import { createPatternStore } from 'driftdetect-core/storage';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export interface AuditArgs {
  /** Action to perform */
  action: 'status' | 'run' | 'approve-recommended' | 'trends';
  /** Confidence threshold for auto-approve (default: 0.90) */
  threshold?: number;
  /** Compare to previous audit */
  compareToPrevious?: boolean;
  /** Categories to audit (empty = all) */
  categories?: string[];
}

export interface AuditData {
  result?: AuditResult;
  status?: {
    hasAudit: boolean;
    generatedAt?: string;
    healthScore?: number;
    totalPatterns?: number;
    autoApproveEligible?: number;
    flaggedForReview?: number;
    likelyFalsePositives?: number;
    duplicateCandidates?: number;
  };
  trends?: {
    healthTrend: string;
    confidenceTrend: string;
    patternGrowth: string;
    history: Array<{
      date: string;
      healthScore: number;
      totalPatterns: number;
    }>;
    alerts: Array<{
      type: string;
      severity: string;
      message: string;
    }>;
  };
  approved?: {
    count: number;
    patterns: Array<{ id: string; name: string; confidence: number }>;
  };
}

// ============================================================================
// Handler
// ============================================================================

export async function handleAudit(
  projectRoot: string,
  args: AuditArgs
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const builder = createResponseBuilder<AuditData>();

  try {
    const auditStore = new AuditStore({ rootDir: projectRoot });
    
    switch (args.action) {
      case 'status': {
        const latest = await auditStore.loadLatest();
        
        if (!latest) {
          return builder
            .withSummary('No audit found. Run `drift audit` or use action="run" first.')
            .withData({ status: { hasAudit: false } })
            .withHints({
              nextActions: ['Run drift_audit with action="run" to generate an audit'],
              relatedTools: ['drift_patterns_list', 'drift_status'],
            })
            .buildContent();
        }

        const statusData = {
          hasAudit: true,
          generatedAt: latest.generatedAt,
          healthScore: latest.summary.healthScore,
          totalPatterns: latest.summary.totalPatterns,
          autoApproveEligible: latest.summary.autoApproveEligible,
          flaggedForReview: latest.summary.flaggedForReview,
          likelyFalsePositives: latest.summary.likelyFalsePositives,
          duplicateCandidates: latest.summary.duplicateCandidates,
        };

        const healthEmoji = latest.summary.healthScore >= 85 ? '✅' : 
                           latest.summary.healthScore >= 70 ? '⚠️' : '❌';

        return builder
          .withSummary(
            `${healthEmoji} Health Score: ${latest.summary.healthScore}/100. ` +
            `${latest.summary.autoApproveEligible} patterns eligible for auto-approve, ` +
            `${latest.summary.flaggedForReview} need review.`
          )
          .withData({ status: statusData })
          .withHints(latest.summary.autoApproveEligible > 0 
            ? {
                nextActions: ['Use action="approve-recommended" to auto-approve high-confidence patterns'],
                relatedTools: ['drift_patterns_list', 'drift_approve'],
              }
            : {
                relatedTools: ['drift_patterns_list', 'drift_approve'],
              }
          )
          .buildContent();
      }

      case 'run': {
        // Load patterns (Phase 3: auto-detects SQLite)
        const patternStore = await createPatternStore({ rootDir: projectRoot });
        const patterns = patternStore.getAll();

        if (patterns.length === 0) {
          return builder
            .withSummary('No patterns found. Run `drift scan` first.')
            .withData({})
            .withHints({
              nextActions: ['Run drift scan to discover patterns'],
              relatedTools: ['drift_status'],
            })
            .buildContent();
        }

        // Run audit
        const auditEngine = new AuditEngine({ 
          rootDir: projectRoot,
          autoApproveThreshold: args.threshold ?? 0.90,
        });

        const auditOptions: AuditOptions = {
          crossValidateCallGraph: true,
          crossValidateConstraints: true,
          compareToPrevious: args.compareToPrevious ?? true,
          categories: args.categories as any,
        };

        const result = await auditEngine.runAudit(patterns, auditOptions);

        // Compare to previous if requested
        if (auditOptions.compareToPrevious) {
          const previous = await auditStore.loadLatest();
          if (previous) {
            result.degradation = auditStore.compareAudits(result, previous);
          }
        }

        // Save audit
        await auditStore.saveAudit(result);

        const healthEmoji = result.summary.healthScore >= 85 ? '✅' : 
                           result.summary.healthScore >= 70 ? '⚠️' : '❌';

        let summaryText = `${healthEmoji} Audit complete. Health Score: ${result.summary.healthScore}/100. `;
        summaryText += `${result.summary.autoApproveEligible} patterns eligible for auto-approve (≥${((args.threshold ?? 0.90) * 100).toFixed(0)}% confidence). `;
        summaryText += `${result.summary.flaggedForReview} need review. `;
        
        if (result.summary.duplicateCandidates > 0) {
          summaryText += `${result.summary.duplicateCandidates} duplicate groups detected. `;
        }

        const warnings: string[] = [];
        if (result.degradation?.trend === 'declining') {
          warnings.push(`Quality declining: health dropped ${Math.abs(result.degradation.healthScoreDelta)} points`);
        }
        if (result.summary.likelyFalsePositives > 5) {
          warnings.push(`${result.summary.likelyFalsePositives} likely false positives detected`);
        }

        return builder
          .withSummary(summaryText)
          .withData({ result })
          .withHints({
            nextActions: result.summary.autoApproveEligible > 0
              ? [
                  `Use action="approve-recommended" to auto-approve ${result.summary.autoApproveEligible} high-confidence patterns`,
                  'Review flagged patterns manually',
                ]
              : ['Review flagged patterns manually'],
            warnings: warnings.length > 0 ? warnings : undefined,
            relatedTools: ['drift_patterns_list', 'drift_approve', 'drift_quality_gate'],
          })
          .buildContent();
      }

      case 'approve-recommended': {
        const threshold = args.threshold ?? 0.90;
        
        // Load latest audit
        const latest = await auditStore.loadLatest();
        if (!latest) {
          return builder
            .withSummary('No audit found. Run action="run" first.')
            .withData({})
            .withHints({
              nextActions: ['Run drift_audit with action="run" first'],
              relatedTools: ['drift_patterns_list'],
            })
            .buildContent();
        }

        // Get patterns eligible for auto-approve
        const eligible = latest.patterns.filter(
          p => p.recommendation === 'auto-approve' && p.confidence >= threshold
        );

        if (eligible.length === 0) {
          return builder
            .withSummary(`No patterns eligible for auto-approve at ≥${(threshold * 100).toFixed(0)}% confidence.`)
            .withData({ approved: { count: 0, patterns: [] } })
            .withHints({
              nextActions: ['Lower threshold or review patterns manually'],
              relatedTools: ['drift_patterns_list'],
            })
            .buildContent();
        }

        // Approve patterns (Phase 3: auto-detects SQLite)
        const patternStore = await createPatternStore({ rootDir: projectRoot });

        const approved: Array<{ id: string; name: string; confidence: number }> = [];
        for (const p of eligible) {
          try {
            await patternStore.approve(p.id);
            approved.push({ id: p.id, name: p.name, confidence: p.confidence });
          } catch {
            // Pattern may already be approved or not found
          }
        }

        await patternStore.saveAll();
        if (patternStore.close) {
          await patternStore.close();
        }

        return builder
          .withSummary(
            `✅ Auto-approved ${approved.length} patterns with ≥${(threshold * 100).toFixed(0)}% confidence.`
          )
          .withData({ approved: { count: approved.length, patterns: approved } })
          .withHints(latest.summary.flaggedForReview > 0
            ? {
                nextActions: [`${latest.summary.flaggedForReview} patterns still need manual review`],
                relatedTools: ['drift_patterns_list', 'drift_status'],
              }
            : {
                relatedTools: ['drift_patterns_list', 'drift_status'],
              }
          )
          .buildContent();
      }

      case 'trends': {
        const tracking = await auditStore.getDegradationTracking();

        if (!tracking || tracking.history.length === 0) {
          return builder
            .withSummary('No audit history found. Run audits over time to build history.')
            .withData({})
            .withHints({
              nextActions: ['Run drift_audit with action="run" multiple times to build history'],
              relatedTools: ['drift_trends'],
            })
            .buildContent();
        }

        const trendsData = {
          healthTrend: tracking.trends.healthTrend,
          confidenceTrend: tracking.trends.confidenceTrend,
          patternGrowth: tracking.trends.patternGrowth,
          history: tracking.history.slice(-7).map(h => ({
            date: h.date,
            healthScore: h.healthScore,
            totalPatterns: h.totalPatterns,
          })),
          alerts: tracking.alerts.map(a => ({
            type: a.type,
            severity: a.severity,
            message: a.message,
          })),
        };

        const trendEmoji = tracking.trends.healthTrend === 'improving' ? '📈' :
                          tracking.trends.healthTrend === 'declining' ? '📉' : '➡️';

        let summaryText = `${trendEmoji} Health trend: ${tracking.trends.healthTrend}. `;
        summaryText += `Confidence trend: ${tracking.trends.confidenceTrend}. `;
        summaryText += `Pattern growth: ${tracking.trends.patternGrowth}.`;

        if (tracking.alerts.length > 0) {
          summaryText += ` ${tracking.alerts.length} active alert(s).`;
        }

        return builder
          .withSummary(summaryText)
          .withData({ trends: trendsData })
          .withHints({
            warnings: tracking.alerts.length > 0 
              ? tracking.alerts.map(a => a.message)
              : undefined,
            relatedTools: ['drift_trends', 'drift_quality_gate'],
          })
          .buildContent();
      }

      default:
        throw Errors.invalidArgument('action', `Unknown action: ${args.action}. Valid: status, run, approve-recommended, trends`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw Errors.internal(`Audit failed: ${message}`);
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

export const auditTool = {
  name: 'drift_audit',
  description: `Run pattern audit to detect duplicates, validate cross-references, and generate approval recommendations.

Actions:
- status: Show current audit status (health score, eligible patterns)
- run: Run a full audit on discovered patterns
- approve-recommended: Auto-approve patterns with ≥90% confidence
- trends: Show quality trends over time

The audit system helps reduce manual review burden by:
1. Identifying high-confidence patterns eligible for auto-approval
2. Detecting duplicate patterns that may need merging
3. Cross-validating patterns against call graph and constraints
4. Tracking quality degradation over time

Use this after scanning to streamline pattern approval workflows.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'run', 'approve-recommended', 'trends'],
        description: 'Action to perform',
      },
      threshold: {
        type: 'number',
        description: 'Confidence threshold for auto-approve (default: 0.90)',
      },
      compareToPrevious: {
        type: 'boolean',
        description: 'Compare to previous audit for degradation detection (default: true)',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categories to audit (empty = all)',
      },
    },
    required: ['action'],
  },
};
