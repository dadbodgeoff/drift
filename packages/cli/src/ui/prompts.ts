/**
 * Prompts - Interactive prompts with Inquirer
 *
 * Provides interactive prompts for user input during CLI operations.
 *
 * @requirements 29.8
 */

import { confirm, select, input, checkbox } from '@inquirer/prompts';

import type { Severity } from 'driftdetect-core';

/**
 * Pattern approval choice
 */
export interface PatternChoice {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Pattern category */
  category: string;
  /** Confidence score */
  confidence: number;
}

/**
 * Prompt for confirmation
 */
export async function confirmPrompt(
  message: string,
  defaultValue = false
): Promise<boolean> {
  return confirm({
    message,
    default: defaultValue,
  });
}

/**
 * Prompt for text input
 */
export async function inputPrompt(
  message: string,
  defaultValue?: string
): Promise<string> {
  const config: { message: string; default?: string } = { message };
  if (defaultValue !== undefined) {
    config.default = defaultValue;
  }
  return input(config);
}

/**
 * Prompt to select from a list of options
 */
export async function selectPrompt<T extends string>(
  message: string,
  choices: Array<{ value: T; name: string; description?: string }>
): Promise<T> {
  return select({
    message,
    choices,
  });
}

/**
 * Prompt to select multiple items from a list
 */
export async function multiSelectPrompt<T extends string>(
  message: string,
  choices: Array<{ value: T; name: string; checked?: boolean }>
): Promise<T[]> {
  return checkbox({
    message,
    choices,
  });
}

/**
 * Prompt for pattern approval action
 */
export type PatternAction = 'approve' | 'ignore' | 'skip' | 'variant';

export async function promptPatternAction(
  pattern: PatternChoice
): Promise<PatternAction> {
  const confidenceLabel =
    pattern.confidence >= 0.85
      ? 'high'
      : pattern.confidence >= 0.65
        ? 'medium'
        : pattern.confidence >= 0.45
          ? 'low'
          : 'uncertain';

  return select({
    message: `Pattern: ${pattern.name} (${pattern.category}) - ${confidenceLabel} confidence (${(pattern.confidence * 100).toFixed(0)}%)`,
    choices: [
      { value: 'approve' as const, name: 'Approve - Enforce this pattern' },
      { value: 'ignore' as const, name: 'Ignore - Stop tracking this pattern' },
      { value: 'variant' as const, name: 'Variant - Mark as intentional deviation' },
      { value: 'skip' as const, name: 'Skip - Decide later' },
    ],
  });
}

/**
 * Prompt for multiple pattern approvals
 */
export async function promptBatchPatternApproval(
  patterns: PatternChoice[]
): Promise<string[]> {
  const choices = patterns.map((p) => ({
    value: p.id,
    name: `${p.name} (${p.category}) - ${(p.confidence * 100).toFixed(0)}%`,
    checked: p.confidence >= 0.85, // Pre-select high confidence patterns
  }));

  return checkbox({
    message: 'Select patterns to approve:',
    choices,
  });
}

/**
 * Prompt for severity selection
 */
export async function promptSeverity(
  message = 'Select severity level:'
): Promise<Severity> {
  return select({
    message,
    choices: [
      { value: 'error' as const, name: 'Error - Block commits and merges' },
      { value: 'warning' as const, name: 'Warning - Display but do not block' },
      { value: 'info' as const, name: 'Info - Informational only' },
      { value: 'hint' as const, name: 'Hint - Subtle suggestion' },
    ],
  });
}

/**
 * Prompt for variant reason
 */
export async function promptVariantReason(): Promise<string> {
  return input({
    message: 'Enter reason for this variant:',
    validate: (value) => {
      if (!value.trim()) {
        return 'Reason is required';
      }
      return true;
    },
  });
}

/**
 * Prompt for variant scope
 */
export type VariantScope = 'global' | 'directory' | 'file';

export async function promptVariantScope(): Promise<VariantScope> {
  return select({
    message: 'Select variant scope:',
    choices: [
      { value: 'file' as const, name: 'File - Apply to this file only' },
      { value: 'directory' as const, name: 'Directory - Apply to this directory' },
      { value: 'global' as const, name: 'Global - Apply everywhere' },
    ],
  });
}

/**
 * Prompt for initialization options
 */
export interface InitPromptResult {
  /** Whether to scan immediately */
  scanNow: boolean;
  /** Whether to auto-approve high confidence patterns */
  autoApprove: boolean;
}

export async function promptInitOptions(): Promise<InitPromptResult> {
  const scanNow = await confirm({
    message: 'Run initial scan now?',
    default: true,
  });

  const autoApprove = await confirm({
    message: 'Auto-approve high confidence patterns (>85%)?',
    default: false,
  });

  return { scanNow, autoApprove };
}

/**
 * Prompt for ignore reason
 */
export async function promptIgnoreReason(): Promise<string> {
  return input({
    message: 'Enter reason for ignoring (optional):',
  });
}

/**
 * Prompt for report format selection
 */
export type ReportFormat = 'text' | 'json' | 'github' | 'gitlab';

export async function promptReportFormat(): Promise<ReportFormat> {
  return select({
    message: 'Select report format:',
    choices: [
      { value: 'text' as const, name: 'Text - Human-readable output' },
      { value: 'json' as const, name: 'JSON - Machine-readable output' },
      { value: 'github' as const, name: 'GitHub - GitHub Actions annotations' },
      { value: 'gitlab' as const, name: 'GitLab - GitLab CI code quality format' },
    ],
  });
}

/**
 * Prompt for category selection
 */
export async function promptCategorySelection(
  categories: string[]
): Promise<string[]> {
  const choices = categories.map((c) => ({
    value: c,
    name: c,
    checked: true,
  }));

  return checkbox({
    message: 'Select categories to include:',
    choices,
  });
}
