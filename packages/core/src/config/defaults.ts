/**
 * Config Defaults - Default configuration values
 * 
 * @requirements 36.1
 */

import type { DriftConfig } from './types.js';

export const DEFAULT_CONFIG: DriftConfig = {
  severity: {},
  ignore: ['node_modules', '.git', 'dist', 'build'],
  ai: {
    provider: 'openai',
  },
  ci: {
    failOn: 'error',
    reportFormat: 'text',
  },
  learning: {
    autoApproveThreshold: 0.95,
    minOccurrences: 3,
  },
  performance: {
    maxWorkers: 4,
    cacheEnabled: true,
    incrementalAnalysis: true,
  },
};
