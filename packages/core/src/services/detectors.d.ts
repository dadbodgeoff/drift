/**
 * Type declarations for driftdetect-detectors module
 * 
 * This module is dynamically imported at runtime to break the cyclic dependency
 * between core and detectors packages. The detectors package depends on core,
 * but core needs to use detectors at runtime for scanning.
 */

declare module 'driftdetect-detectors' {
  import type { Language, PatternMatch } from '../index.js';

  interface BaseDetector {
    id: string;
    getInfo(): {
      name: string;
      description: string;
      category: string;
      subcategory: string;
      supportedLanguages: Language[];
    };
    detect(context: DetectionContext): Promise<{
      patterns: PatternMatch[];
      violations: Array<{
        id: string;
        patternId: string;
        severity: 'error' | 'warning' | 'info' | 'hint';
        file: string;
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        message: string;
        expected: string;
        actual: string;
        explanation?: string;
        aiExplainAvailable: boolean;
        aiFixAvailable: boolean;
        firstSeen: Date;
        occurrences: number;
      }>;
      metadata?: { custom?: Record<string, unknown> };
    }>;
  }

  interface DetectionContext {
    file: string;
    content: string;
    language: Language;
    ast: unknown;
    imports: string[];
    exports: string[];
    extension: string;
    isTestFile: boolean;
    isTypeDefinition: boolean;
    projectContext: {
      rootDir: string;
      files: string[];
      config: Record<string, unknown>;
    };
  }

  export function createAllDetectorsArray(): Promise<BaseDetector[]>;
  export function getDetectorCounts(): Record<string, number>;
}
