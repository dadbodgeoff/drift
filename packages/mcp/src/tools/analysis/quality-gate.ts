/**
 * drift_quality_gate - Enterprise Quality Gates
 *
 * Runs quality gates on code changes to enforce pattern compliance,
 * constraint verification, regression detection, impact simulation,
 * security boundaries, and custom rules.
 *
 * This is the enterprise CI/CD integration point for Drift.
 */

import {
  GateOrchestrator,
  TextReporter,
  type QualityGateOptions,
  type QualityGateResult,
  type GateId,
  type OutputFormat,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export interface QualityGateArgs {
  /** Files to check (optional - defaults to all changed files) */
  files?: string[];
  /** Policy to use (default, strict, relaxed, ci-fast, or custom ID) */
  policy?: string;
  /** Specific gates to run (comma-separated) */
  gates?: string;
  /** Output format (text, json, github, gitlab, sarif) */
  format?: OutputFormat;
  /** Verbose output with details */
  verbose?: boolean;
  /** Branch name */
  branch?: string;
  /** Base branch for comparison */
  baseBranch?: string;
}

export interface QualityGateData {
  result: QualityGateResult;
}

// ============================================================================
// Handler
// ============================================================================

export async function handleQualityGate(
  projectRoot: string,
  args: QualityGateArgs
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const builder = createResponseBuilder<QualityGateData>();

  try {
    // Parse gates if provided
    let gates: GateId[] | undefined;
    if (args.gates) {
      gates = args.gates.split(',').map(g => g.trim()) as GateId[];
    }

    // Build options - only include defined values
    const options: QualityGateOptions = {
      projectRoot,
      format: args.format ?? 'json',
      ci: true, // MCP is always "CI mode"
      branch: args.branch ?? 'main',
    };

    // Add optional properties only if defined
    if (args.files && args.files.length > 0) {
      options.files = args.files;
    }
    if (args.policy) {
      options.policy = args.policy;
    }
    if (gates) {
      options.gates = gates;
    }
    if (args.verbose !== undefined) {
      options.verbose = args.verbose;
    }
    if (args.baseBranch) {
      options.baseBranch = args.baseBranch;
    }

    // Run quality gates
    const orchestrator = new GateOrchestrator(projectRoot);
    const result = await orchestrator.run(options);

    // Build summary
    const statusEmoji = result.passed ? '✅' : '❌';
    let summaryText = `${statusEmoji} Quality Gate ${result.passed ? 'PASSED' : 'FAILED'}. `;
    summaryText += `Score: ${result.score}/100. `;
    summaryText += `${result.metadata.gatesRun.length} gate${result.metadata.gatesRun.length === 1 ? '' : 's'} run. `;
    
    if (result.violations.length > 0) {
      summaryText += `${result.violations.length} violation${result.violations.length === 1 ? '' : 's'} found.`;
    }

    // Build hints
    const warnings: string[] = [...result.warnings];
    
    // Add gate-specific warnings
    for (const [gateId, gateResult] of Object.entries(result.gates)) {
      if (gateResult.warnings.length > 0) {
        warnings.push(`[${gateId}] ${gateResult.warnings[0]}`);
      }
    }

    const nextActions: string[] = [];
    if (!result.passed) {
      nextActions.push('Review violations and fix issues');
      nextActions.push('Run `drift gate --verbose` for detailed output');
    }
    if (result.metadata.gatesSkipped.length > 0) {
      nextActions.push(`Enable skipped gates: ${result.metadata.gatesSkipped.join(', ')}`);
    }

    const hints: {
      nextActions?: string[];
      warnings?: string[];
      relatedTools: string[];
    } = {
      relatedTools: [
        'drift_patterns_list',
        'drift_constraints',
        'drift_impact_analysis',
        'drift_security_summary',
      ],
    };

    if (nextActions.length > 0) {
      hints.nextActions = nextActions;
    }
    if (warnings.length > 0) {
      hints.warnings = warnings.slice(0, 5);
    }

    // Generate text report if verbose
    let detailedReport: string | undefined;
    if (args.verbose) {
      const reporter = new TextReporter();
      detailedReport = reporter.generate(result, { verbose: true });
    }

    const response = builder
      .withSummary(summaryText)
      .withData({ result })
      .withHints(hints)
      .buildContent();

    // Add detailed report as additional content if available
    if (detailedReport) {
      response.content.push({
        type: 'text',
        text: `\n\n--- Detailed Report ---\n${detailedReport}`,
      });
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw Errors.internal(`Quality gate failed: ${message}`);
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

export const qualityGateTool = {
  name: 'drift_quality_gate',
  description: `Run quality gates on code changes.

Quality gates check:
- Pattern Compliance: Do changes follow established patterns?
- Constraint Verification: Do changes satisfy architectural constraints?
- Regression Detection: Do changes cause pattern regressions?
- Impact Simulation: What's the blast radius of changes?
- Security Boundary: Is sensitive data access properly authorized?
- Custom Rules: Do changes follow team-defined rules?

Use this before merging PRs to catch architectural drift.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to check (optional - defaults to all changed files)',
      },
      policy: {
        type: 'string',
        description: 'Policy to use: default, strict, relaxed, ci-fast, or custom ID',
      },
      gates: {
        type: 'string',
        description: 'Specific gates to run (comma-separated): pattern-compliance, constraint-verification, regression-detection, impact-simulation, security-boundary, custom-rules',
      },
      format: {
        type: 'string',
        enum: ['text', 'json', 'github', 'gitlab', 'sarif'],
        description: 'Output format (default: json)',
      },
      verbose: {
        type: 'boolean',
        description: 'Include detailed output',
      },
      branch: {
        type: 'string',
        description: 'Current branch name',
      },
      baseBranch: {
        type: 'string',
        description: 'Base branch for comparison (for PRs)',
      },
    },
  },
};
