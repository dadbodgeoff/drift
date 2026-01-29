/**
 * SARIF Reporter
 * 
 * @license Apache-2.0
 * 
 * SARIF (Static Analysis Results Interchange Format) reporter.
 * Compatible with GitHub Security, VS Code, and other tools.
 */

import { BaseReporter } from './reporter-interface.js';

import type { QualityGateResult, ReporterOptions } from '../types.js';

/**
 * SARIF reporter for standardized static analysis output.
 */
export class SarifReporter extends BaseReporter {
  readonly id = 'sarif';
  readonly format = 'sarif' as const;

  generate(result: QualityGateResult, _options?: ReporterOptions): string {
    const sarif = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'Drift Quality Gates',
              version: '1.0.0',
              informationUri: 'https://driftscan.dev',
              rules: this.buildRules(result),
            },
          },
          results: this.buildResults(result),
          invocations: [
            {
              executionSuccessful: result.passed,
              endTimeUtc: result.metadata.timestamp,
            },
          ],
        },
      ],
    };

    return JSON.stringify(sarif, null, 2);
  }

  private buildRules(result: QualityGateResult): Array<{
    id: string;
    name: string;
    shortDescription: { text: string };
  }> {
    const ruleIds = new Set(result.violations.map(v => v.ruleId));
    return Array.from(ruleIds).map(ruleId => ({
      id: ruleId,
      name: ruleId,
      shortDescription: {
        text: `Quality gate rule: ${ruleId}`,
      },
    }));
  }

  private buildResults(result: QualityGateResult): Array<{
    ruleId: string;
    level: string;
    message: { text: string };
    locations: Array<{
      physicalLocation: {
        artifactLocation: { uri: string };
        region: {
          startLine: number;
          startColumn: number;
          endLine: number;
          endColumn: number;
        };
      };
    }>;
  }> {
    return result.violations.map(v => ({
      ruleId: v.ruleId,
      level: this.mapLevel(v.severity),
      message: {
        text: v.message,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: v.file,
            },
            region: {
              startLine: v.line,
              startColumn: v.column,
              endLine: v.endLine ?? v.line,
              endColumn: v.endColumn ?? v.column,
            },
          },
        },
      ],
    }));
  }

  private mapLevel(severity: string): string {
    switch (severity) {
      case 'error': return 'error';
      case 'warning': return 'warning';
      case 'info': return 'note';
      default: return 'none';
    }
  }
}
