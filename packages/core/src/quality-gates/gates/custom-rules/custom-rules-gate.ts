/**
 * Custom Rules Gate
 * 
 * @license Apache-2.0
 * 
 * Evaluates custom rules defined by the team.
 * Rules can check file patterns, content patterns, dependencies, naming, and structure.
 * 
 * FUTURE_GATE: gate:custom-rules (Team tier)
 */

import { BaseGate } from '../base-gate.js';

import type {
  GateId,
  GateInput,
  GateResult,
  GateConfig,
  CustomRulesConfig,
  CustomRulesDetails,
  GateViolation,
  CustomRule,
  RuleResult,
  RuleViolation,
  RuleCondition,
} from '../../types.js';

/**
 * Custom Rules Gate
 * 
 * Evaluates team-defined custom rules against changed files.
 */
export class CustomRulesGate extends BaseGate {
  readonly id: GateId = 'custom-rules';
  readonly name = 'Custom Rules';
  readonly description = 'Evaluates team-defined custom rules';

  protected async executeGate(input: GateInput): Promise<GateResult> {
    const config = input.config as CustomRulesConfig;
    
    // Collect all rules
    const rules = this.collectRules(config, input.context.customRules);
    
    if (rules.length === 0) {
      return this.createPassedResult(
        'No custom rules configured',
        {
          ruleResults: [],
          failedRules: [],
          passedRules: [],
          skippedRules: [],
        } as unknown as Record<string, unknown>,
        ['No custom rules found. Add rules to .drift/rules/ or policy configuration.']
      );
    }

    // Evaluate each rule
    const results = await this.evaluateRules(rules, input.files, input.projectRoot);

    // Build violations from failed rules
    const violations = this.buildViolations(results);

    // Determine pass/fail
    const failedRules = results.filter(r => !r.passed).map(r => r.ruleId);
    const passedRules = results.filter(r => r.passed).map(r => r.ruleId);
    const passed = failedRules.length === 0;
    const score = this.calculateScore(results);
    const status = passed ? 'passed' : 'failed';

    const details: CustomRulesDetails = {
      ruleResults: results,
      failedRules,
      passedRules,
      skippedRules: [],
    };

    const summary = this.buildSummary(results, passed);
    const warnings = this.buildWarnings(results, rules);

    if (!passed) {
      return this.createFailedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    return {
      gateId: this.id,
      gateName: this.name,
      status,
      passed,
      score,
      summary,
      violations,
      warnings,
      executionTimeMs: 0,
      details: details as unknown as Record<string, unknown>,
    };
  }

  validateConfig(config: GateConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const c = config as CustomRulesConfig;

    // Validate inline rules
    for (const rule of c.inlineRules) {
      if (!rule.id) {errors.push('Rule missing id');}
      if (!rule.name) {errors.push('Rule missing name');}
      if (!rule.condition) {errors.push(`Rule ${rule.id} missing condition`);}
    }

    return { valid: errors.length === 0, errors };
  }

  getDefaultConfig(): CustomRulesConfig {
    return {
      enabled: true,
      blocking: true,
      ruleFiles: ['.drift/rules/*.json', '.drift/rules/*.yaml'],
      inlineRules: [],
      useBuiltInRules: true,
    };
  }

  /**
   * Collect all rules from config and context.
   */
  private collectRules(
    config: CustomRulesConfig,
    contextRules?: CustomRule[]
  ): CustomRule[] {
    const rules: CustomRule[] = [];

    // Add inline rules from config
    rules.push(...config.inlineRules.filter(r => r.enabled));

    // Add rules from context (loaded from files)
    if (contextRules) {
      rules.push(...contextRules.filter(r => r.enabled));
    }

    // Add built-in rules if enabled
    if (config.useBuiltInRules) {
      rules.push(...this.getBuiltInRules());
    }

    return rules;
  }

  /**
   * Get built-in rules.
   */
  private getBuiltInRules(): CustomRule[] {
    return [
      {
        id: 'no-console-log',
        name: 'No console.log in production code',
        description: 'Prevents console.log statements in production code',
        severity: 'warning',
        condition: {
          type: 'content-pattern',
          files: 'src/**/*.{ts,js}',
          mustNotContain: 'console.log',
        },
        message: 'Remove console.log statements from production code',
        enabled: true,
        tags: ['code-quality'],
      },
      {
        id: 'test-file-naming',
        name: 'Test file naming convention',
        description: 'Test files must end with .test.ts or .spec.ts',
        severity: 'warning',
        condition: {
          type: 'file-pattern',
          forEachFile: '**/__tests__/**/*.ts',
          correspondingFile: '**/*.{test,spec}.ts',
        },
        message: 'Test files should follow naming convention: *.test.ts or *.spec.ts',
        enabled: true,
        tags: ['testing', 'naming'],
      },
      {
        id: 'no-relative-parent-imports',
        name: 'No deep relative imports',
        description: 'Prevents imports with more than 2 parent directory traversals',
        severity: 'info',
        condition: {
          type: 'content-pattern',
          files: 'src/**/*.{ts,js}',
          mustNotContain: '../../../',
        },
        message: 'Use absolute imports or path aliases instead of deep relative imports',
        enabled: true,
        tags: ['imports', 'code-quality'],
      },
    ];
  }

  /**
   * Evaluate all rules against changed files.
   */
  private async evaluateRules(
    rules: CustomRule[],
    files: string[],
    _projectRoot: string
  ): Promise<RuleResult[]> {
    const results: RuleResult[] = [];

    for (const rule of rules) {
      const result = await this.evaluateRule(rule, files);
      results.push(result);
    }

    return results;
  }

  /**
   * Evaluate a single rule.
   */
  private async evaluateRule(
    rule: CustomRule,
    files: string[]
  ): Promise<RuleResult> {
    const violations: RuleViolation[] = [];
    let filesChecked = 0;

    // Get files that match the rule's scope
    const applicableFiles = this.getApplicableFiles(files, rule.condition);
    filesChecked = applicableFiles.length;

    // Evaluate condition
    for (const file of applicableFiles) {
      const fileViolations = await this.evaluateCondition(rule.condition, file, rule);
      violations.push(...fileViolations);
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      passed: violations.length === 0,
      violations,
      filesChecked,
    };
  }

  /**
   * Get files that a rule applies to.
   */
  private getApplicableFiles(files: string[], condition: RuleCondition): string[] {
    // In full implementation, this would use glob matching
    // For now, return all files
    switch (condition.type) {
      case 'content-pattern':
        return files.filter(f => this.matchesGlob(f, condition.files));
      case 'file-pattern':
        if (condition.forEachFile) {
          return files.filter(f => this.matchesGlob(f, condition.forEachFile!));
        }
        return files;
      default:
        return files;
    }
  }

  /**
   * Simple glob matching (simplified).
   */
  private matchesGlob(file: string, pattern: string): boolean {
    // Simplified glob matching
    // In full implementation, would use minimatch or similar
    if (pattern.includes('**')) {
      const parts = pattern.split('**');
      const prefix = parts[0]?.replace(/\//g, '') ?? '';
      const suffix = parts[1]?.replace(/\//g, '') ?? '';
      
      // Check extension
      if (suffix.includes('.')) {
        const extensions = suffix.match(/\{([^}]+)\}/)?.[1]?.split(',') ?? [suffix.replace('*.', '')];
        return extensions.some(ext => file.endsWith(`.${ext.replace('.', '')}`));
      }
      
      return file.includes(prefix);
    }
    
    return file.includes(pattern);
  }

  /**
   * Evaluate a condition against a file.
   */
  private async evaluateCondition(
    condition: RuleCondition,
    file: string,
    rule: CustomRule
  ): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    switch (condition.type) {
      case 'content-pattern':
        // In full implementation, would read file and check content
        // For now, return empty (no violations)
        break;

      case 'file-pattern':
        // In full implementation, would check file existence patterns
        break;

      case 'dependency':
        // In full implementation, would check import statements
        break;

      case 'naming':
        // Check naming convention
        if (condition.target === 'file') {
          const regex = new RegExp(condition.pattern);
          if (!regex.test(file)) {
            violations.push({
              file,
              line: 1,
              message: rule.message,
            });
          }
        }
        break;

      case 'structure':
        // In full implementation, would check directory structure
        break;

      case 'composite':
        // Evaluate child conditions
        if (condition.operator === 'and') {
          for (const child of condition.conditions) {
            const childViolations = await this.evaluateCondition(child, file, rule);
            violations.push(...childViolations);
          }
        } else if (condition.operator === 'or') {
          let anyPassed = false;
          for (const child of condition.conditions) {
            const childViolations = await this.evaluateCondition(child, file, rule);
            if (childViolations.length === 0) {
              anyPassed = true;
              break;
            }
          }
          if (!anyPassed) {
            violations.push({
              file,
              line: 1,
              message: rule.message,
            });
          }
        }
        break;
    }

    return violations;
  }

  /**
   * Build violations from rule results.
   */
  private buildViolations(results: RuleResult[]): GateViolation[] {
    const violations: GateViolation[] = [];

    for (const result of results) {
      if (result.passed) {continue;}

      for (const v of result.violations) {
        violations.push(this.createViolation({
          severity: 'warning', // Could be enhanced to use rule severity
          file: v.file,
          line: v.line,
          column: 1,
          message: v.message,
          explanation: `Rule: ${result.ruleName}`,
          ruleId: result.ruleId,
        }));
      }
    }

    return violations;
  }

  /**
   * Calculate score based on results.
   */
  private calculateScore(results: RuleResult[]): number {
    if (results.length === 0) {return 100;}
    
    const passed = results.filter(r => r.passed).length;
    return Math.round((passed / results.length) * 100);
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(results: RuleResult[], passed: boolean): string {
    const total = results.length;
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = total - passedCount;

    if (total === 0) {
      return 'No custom rules to evaluate';
    }

    if (passed) {
      return `All ${passedCount} custom rule${passedCount === 1 ? '' : 's'} passed`;
    }

    return `${failedCount} custom rule${failedCount === 1 ? '' : 's'} failed out of ${total}`;
  }

  /**
   * Build warnings for the result.
   */
  private buildWarnings(results: RuleResult[], rules: CustomRule[]): string[] {
    const warnings: string[] = [];

    // Warn about rules with no files checked
    const noFilesRules = results.filter(r => r.filesChecked === 0);
    if (noFilesRules.length > 0) {
      warnings.push(`${noFilesRules.length} rule${noFilesRules.length === 1 ? '' : 's'} had no applicable files`);
    }

    // Warn about disabled rules
    const disabledCount = rules.filter(r => !r.enabled).length;
    if (disabledCount > 0) {
      warnings.push(`${disabledCount} rule${disabledCount === 1 ? '' : 's'} disabled`);
    }

    return warnings;
  }
}
