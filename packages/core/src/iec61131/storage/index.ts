/**
 * IEC 61131-3 Storage Module
 * 
 * SQLite-backed storage for Code Factory analysis results.
 * Extends the unified Drift database with ST-specific tables.
 */

export { IEC61131Repository, createIEC61131Repository } from './repository.js';
export type {
  IEC61131RepositoryConfig,
  StoredSTFile,
  StoredSTPOU,
  StoredSTVariable,
  StoredSTDocstring,
  StoredStateMachine,
  StoredSafetyInterlock,
  StoredSafetyBypass,
  StoredTribalKnowledge,
  StoredIOMapping,
  StoredMigrationScore,
  STAnalysisRun,
} from './repository.js';
