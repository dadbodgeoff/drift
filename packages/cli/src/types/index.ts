/**
 * CLI type exports
 */

export interface CLIOptions {
  /** Enable verbose output */
  verbose?: boolean;
  /** Output format */
  format?: 'text' | 'json' | 'github' | 'gitlab';
  /** CI mode */
  ci?: boolean;
  /** Check only staged files */
  staged?: boolean;
}

export interface CheckResult {
  /** Number of violations */
  violationCount: number;
  /** Number of errors */
  errorCount: number;
  /** Number of warnings */
  warningCount: number;
  /** Exit code */
  exitCode: number;
}
