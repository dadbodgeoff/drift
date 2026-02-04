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
  // Core scan
  runCoreScan: boolean;
  
  // Core features (user chooses each)
  scanBoundaries: boolean;
  scanContracts: boolean;
  scanEnvironment: boolean;
  scanConstants: boolean;
  
  // Pattern approval
  autoApprove: boolean;
  approveThreshold: number;
  
  // Deep analysis (user chooses each)
  buildCallGraph: boolean;
  buildTestTopology: boolean;
  buildCoupling: boolean;
  scanDna: boolean;
  analyzeErrorHandling: boolean;
  
  // Memory (opt-in)
  initMemory: boolean;
}

export interface SetupState {
  phase: number;
  completed: string[];
  choices: SetupChoices;
  startedAt: string;
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
    // Core features
    boundaries: FeatureConfig;
    contracts: FeatureConfig;
    environment: FeatureConfig;
    constants: FeatureConfig;
    
    // Deep analysis
    callGraph: FeatureConfig;
    testTopology: FeatureConfig;
    coupling: FeatureConfig;
    dna: FeatureConfig;
    errorHandling: FeatureConfig;
    
    // Derived
    constraints: FeatureConfig;
    audit: FeatureConfig;
    
    // Memory
    memory: FeatureConfig;
    
    // Sync
    sqliteSync: FeatureConfig;
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
