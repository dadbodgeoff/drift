/**
 * Setup Types - Shared types for the setup wizard
 * 
 * @module commands/setup/types
 */

export interface SetupOptions {
  yes?: boolean;
  verbose?: boolean;
  resume?: boolean;
}

export interface FeatureStats {
  [key: string]: number;
}

export interface FeatureResult {
  enabled: boolean;
  success: boolean;
  timestamp?: string;
  stats?: FeatureStats;
  error?: string;
}

export interface SetupChoices {
  autoApprove: boolean;
  approveThreshold: number;
  buildCallGraph: boolean;
  buildTestTopology: boolean;
  buildCoupling: boolean;
  scanDna: boolean;
  initMemory: boolean;
}

export interface SetupState {
  phase: number;
  completed: string[];
  choices: SetupChoices;
  startedAt: string;
}

export interface ScanResult {
  success: boolean;
  patternCount: number;
  categories: Record<string, number>;
}

export interface ApprovalResult {
  approved: number;
  threshold: number;
}

export interface AnalysisResults {
  callGraph?: FeatureResult;
  testTopology?: FeatureResult;
  coupling?: FeatureResult;
  dna?: FeatureResult;
  memory?: FeatureResult;
}

export interface SourceOfTruth {
  version: string;
  schemaVersion: string;
  createdAt: string;
  updatedAt: string;
  project: {
    id: string;
    name: string;
    rootPath: string;
  };
  baseline: {
    scanId: string;
    scannedAt: string;
    fileCount: number;
    patternCount: number;
    approvedCount: number;
    categories: Record<string, number>;
    checksum: string;
  };
  features: {
    callGraph: FeatureConfig;
    testTopology: FeatureConfig;
    coupling: FeatureConfig;
    dna: FeatureConfig;
    memory: FeatureConfig;
  };
  settings: {
    autoApproveThreshold: number;
    autoApproveEnabled: boolean;
  };
  history: HistoryEntry[];
}

export interface FeatureConfig {
  enabled: boolean;
  builtAt?: string;
  stats?: FeatureStats;
}

export interface HistoryEntry {
  action: string;
  timestamp: string;
  details: string;
}

export const DRIFT_DIR = '.drift';
export const SOURCE_OF_TRUTH_FILE = 'source-of-truth.json';
export const SETUP_STATE_FILE = '.setup-state.json';
export const SCHEMA_VERSION = '2.0.0';

export const DRIFT_SUBDIRS = [
  'patterns/discovered',
  'patterns/approved',
  'patterns/ignored',
  'patterns/variants',
  'history/snapshots',
  'cache',
  'reports',
  'lake/callgraph',
  'lake/patterns',
  'lake/security',
  'lake/examples',
  'boundaries',
  'test-topology',
  'module-coupling',
  'error-handling',
  'constraints/discovered',
  'constraints/approved',
  'constraints/ignored',
  'constraints/custom',
  'constraints/history',
  'contracts/discovered',
  'contracts/verified',
  'contracts/mismatch',
  'contracts/ignored',
  'indexes',
  'views',
  'dna',
  'environment',
  'memory',
  'audit/snapshots',
];
