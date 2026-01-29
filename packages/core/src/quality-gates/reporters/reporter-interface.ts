/**
 * Reporter Interface
 * 
 * @license Apache-2.0
 * 
 * Interface for quality gate reporters.
 */

import * as fs from 'node:fs/promises';

import type { QualityGateResult, OutputFormat, ReporterOptions } from '../types.js';

/**
 * Interface for quality gate reporters.
 */
export interface Reporter {
  /** Reporter ID */
  readonly id: string;
  
  /** Format this reporter produces */
  readonly format: OutputFormat;
  
  /**
   * Generate report string from result.
   */
  generate(result: QualityGateResult, options?: ReporterOptions): string;
  
  /**
   * Write report to destination (file, stdout, webhook, etc.).
   */
  write(report: string, options?: ReporterOptions): Promise<void>;
}

/**
 * Base class for reporters.
 */
export abstract class BaseReporter implements Reporter {
  abstract readonly id: string;
  abstract readonly format: OutputFormat;
  
  abstract generate(result: QualityGateResult, options?: ReporterOptions): string;
  
  async write(report: string, options?: ReporterOptions): Promise<void> {
    if (options?.outputPath) {
      await fs.writeFile(options.outputPath, report);
    } else {
      console.log(report);
    }
  }
}
