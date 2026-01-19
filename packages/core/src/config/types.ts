/**
 * Config type definitions
 * 
 * @requirements 36.1
 */

import type { Severity } from '../store/types.js';

export interface DriftConfig {
  /** Severity overrides per pattern */
  severity?: Record<string, Severity>;
  
  /** Files/folders to ignore */
  ignore?: string[];
  
  /** AI configuration (BYOK) */
  ai?: AIConfig;
  
  /** CI mode settings */
  ci?: CIConfig;
  
  /** Learning settings */
  learning?: LearningConfig;
  
  /** Performance settings */
  performance?: PerformanceConfig;
}

export interface AIConfig {
  /** AI provider to use */
  provider: 'openai' | 'anthropic' | 'ollama';
  /** Model to use */
  model?: string;
}

export interface CIConfig {
  /** Severity level that causes failure */
  failOn: 'error' | 'warning' | 'none';
  /** Report format */
  reportFormat: 'json' | 'text' | 'github' | 'gitlab';
}

export interface LearningConfig {
  /** Auto-approve patterns above this confidence */
  autoApproveThreshold: number;
  /** Minimum occurrences to detect pattern */
  minOccurrences: number;
}

export interface PerformanceConfig {
  /** Maximum worker threads */
  maxWorkers: number;
  /** Enable caching */
  cacheEnabled: boolean;
  /** Enable incremental analysis */
  incrementalAnalysis: boolean;
}
