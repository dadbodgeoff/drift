/**
 * IEC 61131-3 Repository
 * 
 * SQLite-backed storage for Code Factory analysis results.
 * Provides CRUD operations for all ST-related entities.
 */

import type { Database } from 'better-sqlite3';
import { generateId } from '../utils/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface IEC61131RepositoryConfig {
  db: Database;
}

// ============================================================================
// STORED ENTITY TYPES
// ============================================================================

export interface StoredSTFile {
  id: string;
  path: string;
  vendor: string | null;
  language: string;
  lineCount: number;
  hash: string;
  parsedAt: string | null;
  createdAt: string;
}

export interface StoredSTPOU {
  id: string;
  fileId: string;
  type: string;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  extends: string | null;
  implements: string[];
  vendorAttributes: Record<string, unknown>;
  createdAt: string;
}

export interface StoredSTVariable {
  id: string;
  pouId: string | null;
  fileId: string | null;
  section: string;
  name: string;
  dataType: string;
  initialValue: string | null;
  isArray: boolean;
  arrayBounds: unknown | null;
  comment: string | null;
  lineNumber: number | null;
  isSafetyCritical: boolean;
  ioAddress: string | null;
}

export interface StoredSTDocstring {
  id: string;
  pouId: string | null;
  fileId: string;
  summary: string | null;
  description: string | null;
  rawText: string | null;
  author: string | null;
  date: string | null;
  startLine: number;
  endLine: number;
  associatedBlock: string | null;
  associatedBlockType: string | null;
  qualityScore: number;
  extractedAt: string;
}

export interface StoredStateMachine {
  id: string;
  pouId: string;
  name: string;
  stateVariable: string;
  stateVariableType: string | null;
  stateCount: number;
  hasDeadlocks: boolean;
  hasGaps: boolean;
  unreachableStates: string[];
  gapValues: number[];
  mermaidDiagram: string;
  asciiDiagram: string;
  plantumlDiagram: string | null;
  startLine: number | null;
  endLine: number | null;
  createdAt: string;
}

export interface StoredSafetyInterlock {
  id: string;
  pouId: string | null;
  fileId: string;
  name: string;
  type: string;
  lineNumber: number | null;
  isBypassed: boolean;
  bypassCondition: string | null;
  confidence: number;
  severity: string;
  relatedInterlocks: string[];
}

export interface StoredSafetyBypass {
  id: string;
  pouId: string | null;
  fileId: string;
  name: string;
  lineNumber: number | null;
  affectedInterlocks: string[];
  condition: string | null;
  severity: string;
  detectedAt: string;
}

export interface StoredTribalKnowledge {
  id: string;
  pouId: string | null;
  fileId: string;
  type: string;
  content: string;
  context: string | null;
  lineNumber: number | null;
  importance: string;
  extractedAt: string;
}

export interface StoredIOMapping {
  id: string;
  pouId: string | null;
  fileId: string;
  address: string;
  addressType: string;
  variableName: string | null;
  description: string | null;
  lineNumber: number | null;
  isInput: boolean;
  bitSize: number;
}

export interface StoredMigrationScore {
  id: string;
  pouId: string;
  overallScore: number;
  documentationScore: number | null;
  safetyScore: number | null;
  complexityScore: number | null;
  dependenciesScore: number | null;
  testabilityScore: number | null;
  grade: string;
  blockers: unknown[];
  warnings: string[];
  suggestions: string[];
  calculatedAt: string;
}

export interface STAnalysisRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  filesAnalyzed: number;
  pousFound: number;
  stateMachinesFound: number;
  interlocksFound: number;
  bypassesFound: number;
  tribalKnowledgeFound: number;
  errors: unknown[];
  summary: unknown;
}

// ============================================================================
// ROW TYPE (for SQLite results)
// ============================================================================

type DbRow = Record<string, unknown>;

// ============================================================================
// REPOSITORY CLASS
// ============================================================================

export class IEC61131Repository {
  private db: Database;

  constructor(config: IEC61131RepositoryConfig) {
    this.db = config.db;
  }

  // ==========================================================================
  // FILE OPERATIONS
  // ==========================================================================

  storeFile(file: Omit<StoredSTFile, 'createdAt'>): StoredSTFile {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO st_files (id, path, vendor, language, line_count, hash, parsed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(file.id, file.path, file.vendor, file.language, file.lineCount, file.hash, file.parsedAt, createdAt);
    return { ...file, createdAt };
  }

  getFile(id: string): StoredSTFile | null {
    const stmt = this.db.prepare('SELECT * FROM st_files WHERE id = ?');
    const row = stmt.get(id) as DbRow | undefined;
    return row ? this.mapFileRow(row) : null;
  }

  getFileByPath(path: string): StoredSTFile | null {
    const stmt = this.db.prepare('SELECT * FROM st_files WHERE path = ?');
    const row = stmt.get(path) as DbRow | undefined;
    return row ? this.mapFileRow(row) : null;
  }

  getAllFiles(): StoredSTFile[] {
    const stmt = this.db.prepare('SELECT * FROM st_files ORDER BY path');
    const rows = stmt.all() as DbRow[];
    return rows.map(row => this.mapFileRow(row));
  }

  private mapFileRow(row: DbRow): StoredSTFile {
    return {
      id: row['id'] as string,
      path: row['path'] as string,
      vendor: row['vendor'] as string | null,
      language: row['language'] as string,
      lineCount: row['line_count'] as number,
      hash: row['hash'] as string,
      parsedAt: row['parsed_at'] as string | null,
      createdAt: row['created_at'] as string,
    };
  }

  // ==========================================================================
  // POU OPERATIONS
  // ==========================================================================

  storePOU(pou: Omit<StoredSTPOU, 'createdAt'>): StoredSTPOU {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO st_pous (id, file_id, type, name, qualified_name, start_line, end_line, extends, implements, vendor_attributes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      pou.id,
      pou.fileId,
      pou.type,
      pou.name,
      pou.qualifiedName,
      pou.startLine,
      pou.endLine,
      pou.extends,
      JSON.stringify(pou.implements),
      JSON.stringify(pou.vendorAttributes),
      createdAt
    );
    return { ...pou, createdAt };
  }

  getPOU(id: string): StoredSTPOU | null {
    const stmt = this.db.prepare('SELECT * FROM st_pous WHERE id = ?');
    const row = stmt.get(id) as DbRow | undefined;
    return row ? this.mapPOURow(row) : null;
  }

  getPOUsByFile(fileId: string): StoredSTPOU[] {
    const stmt = this.db.prepare('SELECT * FROM st_pous WHERE file_id = ? ORDER BY start_line');
    const rows = stmt.all(fileId) as DbRow[];
    return rows.map(row => this.mapPOURow(row));
  }

  getAllPOUs(): StoredSTPOU[] {
    const stmt = this.db.prepare('SELECT * FROM st_pous ORDER BY name');
    const rows = stmt.all() as DbRow[];
    return rows.map(row => this.mapPOURow(row));
  }

  private mapPOURow(row: DbRow): StoredSTPOU {
    return {
      id: row['id'] as string,
      fileId: row['file_id'] as string,
      type: row['type'] as string,
      name: row['name'] as string,
      qualifiedName: row['qualified_name'] as string,
      startLine: row['start_line'] as number,
      endLine: row['end_line'] as number,
      extends: row['extends'] as string | null,
      implements: JSON.parse((row['implements'] as string) || '[]'),
      vendorAttributes: JSON.parse((row['vendor_attributes'] as string) || '{}'),
      createdAt: row['created_at'] as string,
    };
  }

  // ==========================================================================
  // STATE MACHINE OPERATIONS
  // ==========================================================================

  storeStateMachine(sm: Omit<StoredStateMachine, 'createdAt'>): StoredStateMachine {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO st_state_machines 
      (id, pou_id, name, state_variable, state_variable_type, state_count, has_deadlocks, has_gaps, 
       unreachable_states, gap_values, mermaid_diagram, ascii_diagram, plantuml_diagram, start_line, end_line, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      sm.id,
      sm.pouId,
      sm.name,
      sm.stateVariable,
      sm.stateVariableType,
      sm.stateCount,
      sm.hasDeadlocks ? 1 : 0,
      sm.hasGaps ? 1 : 0,
      JSON.stringify(sm.unreachableStates),
      JSON.stringify(sm.gapValues),
      sm.mermaidDiagram,
      sm.asciiDiagram,
      sm.plantumlDiagram,
      sm.startLine,
      sm.endLine,
      createdAt
    );
    return { ...sm, createdAt };
  }

  getStateMachine(id: string): StoredStateMachine | null {
    const stmt = this.db.prepare('SELECT * FROM st_state_machines WHERE id = ?');
    const row = stmt.get(id) as DbRow | undefined;
    return row ? this.mapStateMachineRow(row) : null;
  }

  getStateMachinesByPOU(pouId: string): StoredStateMachine[] {
    const stmt = this.db.prepare('SELECT * FROM st_state_machines WHERE pou_id = ?');
    const rows = stmt.all(pouId) as DbRow[];
    return rows.map(row => this.mapStateMachineRow(row));
  }

  getAllStateMachines(): StoredStateMachine[] {
    const stmt = this.db.prepare('SELECT * FROM st_state_machines ORDER BY name');
    const rows = stmt.all() as DbRow[];
    return rows.map(row => this.mapStateMachineRow(row));
  }

  private mapStateMachineRow(row: DbRow): StoredStateMachine {
    return {
      id: row['id'] as string,
      pouId: row['pou_id'] as string,
      name: row['name'] as string,
      stateVariable: row['state_variable'] as string,
      stateVariableType: row['state_variable_type'] as string | null,
      stateCount: row['state_count'] as number,
      hasDeadlocks: Boolean(row['has_deadlocks']),
      hasGaps: Boolean(row['has_gaps']),
      unreachableStates: JSON.parse((row['unreachable_states'] as string) || '[]'),
      gapValues: JSON.parse((row['gap_values'] as string) || '[]'),
      mermaidDiagram: row['mermaid_diagram'] as string,
      asciiDiagram: row['ascii_diagram'] as string,
      plantumlDiagram: row['plantuml_diagram'] as string | null,
      startLine: row['start_line'] as number | null,
      endLine: row['end_line'] as number | null,
      createdAt: row['created_at'] as string,
    };
  }

  // ==========================================================================
  // SAFETY INTERLOCK OPERATIONS
  // ==========================================================================

  storeSafetyInterlock(interlock: StoredSafetyInterlock): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO st_safety_interlocks 
      (id, pou_id, file_id, name, type, line_number, is_bypassed, bypass_condition, confidence, severity, related_interlocks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      interlock.id,
      interlock.pouId,
      interlock.fileId,
      interlock.name,
      interlock.type,
      interlock.lineNumber,
      interlock.isBypassed ? 1 : 0,
      interlock.bypassCondition,
      interlock.confidence,
      interlock.severity,
      JSON.stringify(interlock.relatedInterlocks)
    );
  }

  getSafetyInterlocks(fileId?: string): StoredSafetyInterlock[] {
    const stmt = fileId
      ? this.db.prepare('SELECT * FROM st_safety_interlocks WHERE file_id = ?')
      : this.db.prepare('SELECT * FROM st_safety_interlocks');
    const rows = (fileId ? stmt.all(fileId) : stmt.all()) as DbRow[];
    return rows.map(row => this.mapSafetyInterlockRow(row));
  }

  private mapSafetyInterlockRow(row: DbRow): StoredSafetyInterlock {
    return {
      id: row['id'] as string,
      pouId: row['pou_id'] as string | null,
      fileId: row['file_id'] as string,
      name: row['name'] as string,
      type: row['type'] as string,
      lineNumber: row['line_number'] as number | null,
      isBypassed: Boolean(row['is_bypassed']),
      bypassCondition: row['bypass_condition'] as string | null,
      confidence: row['confidence'] as number,
      severity: row['severity'] as string,
      relatedInterlocks: JSON.parse((row['related_interlocks'] as string) || '[]'),
    };
  }

  // ==========================================================================
  // SAFETY BYPASS OPERATIONS
  // ==========================================================================

  storeSafetyBypass(bypass: Omit<StoredSafetyBypass, 'detectedAt'>): StoredSafetyBypass {
    const detectedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO st_safety_bypasses 
      (id, pou_id, file_id, name, line_number, affected_interlocks, condition, severity, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      bypass.id,
      bypass.pouId,
      bypass.fileId,
      bypass.name,
      bypass.lineNumber,
      JSON.stringify(bypass.affectedInterlocks),
      bypass.condition,
      bypass.severity,
      detectedAt
    );
    return { ...bypass, detectedAt };
  }

  getSafetyBypasses(): StoredSafetyBypass[] {
    const stmt = this.db.prepare('SELECT * FROM st_safety_bypasses ORDER BY detected_at DESC');
    const rows = stmt.all() as DbRow[];
    return rows.map(row => ({
      id: row['id'] as string,
      pouId: row['pou_id'] as string | null,
      fileId: row['file_id'] as string,
      name: row['name'] as string,
      lineNumber: row['line_number'] as number | null,
      affectedInterlocks: JSON.parse((row['affected_interlocks'] as string) || '[]'),
      condition: row['condition'] as string | null,
      severity: row['severity'] as string,
      detectedAt: row['detected_at'] as string,
    }));
  }

  // ==========================================================================
  // TRIBAL KNOWLEDGE OPERATIONS
  // ==========================================================================

  storeTribalKnowledge(item: Omit<StoredTribalKnowledge, 'extractedAt'>): StoredTribalKnowledge {
    const extractedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO st_tribal_knowledge 
      (id, pou_id, file_id, type, content, context, line_number, importance, extracted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.id,
      item.pouId,
      item.fileId,
      item.type,
      item.content,
      item.context,
      item.lineNumber,
      item.importance,
      extractedAt
    );
    return { ...item, extractedAt };
  }

  getTribalKnowledge(options?: { type?: string; importance?: string; limit?: number }): StoredTribalKnowledge[] {
    let sql = 'SELECT * FROM st_tribal_knowledge WHERE 1=1';
    const params: unknown[] = [];

    if (options?.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }
    if (options?.importance) {
      sql += ' AND importance = ?';
      params.push(options.importance);
    }
    sql += ' ORDER BY importance DESC, extracted_at DESC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as DbRow[];
    return rows.map(row => ({
      id: row['id'] as string,
      pouId: row['pou_id'] as string | null,
      fileId: row['file_id'] as string,
      type: row['type'] as string,
      content: row['content'] as string,
      context: row['context'] as string | null,
      lineNumber: row['line_number'] as number | null,
      importance: row['importance'] as string,
      extractedAt: row['extracted_at'] as string,
    }));
  }

  // ==========================================================================
  // MIGRATION SCORE OPERATIONS
  // ==========================================================================

  storeMigrationScore(score: Omit<StoredMigrationScore, 'calculatedAt'>): StoredMigrationScore {
    const calculatedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO st_migration_scores 
      (id, pou_id, overall_score, documentation_score, safety_score, complexity_score, 
       dependencies_score, testability_score, grade, blockers, warnings, suggestions, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      score.id,
      score.pouId,
      score.overallScore,
      score.documentationScore,
      score.safetyScore,
      score.complexityScore,
      score.dependenciesScore,
      score.testabilityScore,
      score.grade,
      JSON.stringify(score.blockers),
      JSON.stringify(score.warnings),
      JSON.stringify(score.suggestions),
      calculatedAt
    );
    return { ...score, calculatedAt };
  }

  getMigrationScores(): StoredMigrationScore[] {
    const stmt = this.db.prepare(`
      SELECT * FROM st_migration_scores ORDER BY overall_score DESC
    `);
    const rows = stmt.all() as DbRow[];
    return rows.map(row => ({
      id: row['id'] as string,
      pouId: row['pou_id'] as string,
      overallScore: row['overall_score'] as number,
      documentationScore: row['documentation_score'] as number | null,
      safetyScore: row['safety_score'] as number | null,
      complexityScore: row['complexity_score'] as number | null,
      dependenciesScore: row['dependencies_score'] as number | null,
      testabilityScore: row['testability_score'] as number | null,
      grade: row['grade'] as string,
      blockers: JSON.parse((row['blockers'] as string) || '[]'),
      warnings: JSON.parse((row['warnings'] as string) || '[]'),
      suggestions: JSON.parse((row['suggestions'] as string) || '[]'),
      calculatedAt: row['calculated_at'] as string,
    }));
  }

  // ==========================================================================
  // ANALYSIS RUN OPERATIONS
  // ==========================================================================

  startAnalysisRun(): STAnalysisRun {
    const id = generateId();
    const startedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO st_analysis_runs (id, started_at, status)
      VALUES (?, ?, 'running')
    `);
    stmt.run(id, startedAt);
    return {
      id,
      startedAt,
      completedAt: null,
      status: 'running',
      filesAnalyzed: 0,
      pousFound: 0,
      stateMachinesFound: 0,
      interlocksFound: 0,
      bypassesFound: 0,
      tribalKnowledgeFound: 0,
      errors: [],
      summary: null,
    };
  }

  completeAnalysisRun(id: string, summary: Partial<STAnalysisRun>): void {
    const completedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE st_analysis_runs SET
        completed_at = ?,
        status = ?,
        files_analyzed = ?,
        pous_found = ?,
        state_machines_found = ?,
        interlocks_found = ?,
        bypasses_found = ?,
        tribal_knowledge_found = ?,
        errors = ?,
        summary = ?
      WHERE id = ?
    `);
    stmt.run(
      completedAt,
      summary.status ?? 'completed',
      summary.filesAnalyzed ?? 0,
      summary.pousFound ?? 0,
      summary.stateMachinesFound ?? 0,
      summary.interlocksFound ?? 0,
      summary.bypassesFound ?? 0,
      summary.tribalKnowledgeFound ?? 0,
      JSON.stringify(summary.errors ?? []),
      JSON.stringify(summary.summary ?? {}),
      id
    );
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  getStats(): {
    files: number;
    pous: number;
    stateMachines: number;
    interlocks: number;
    bypasses: number;
    tribalKnowledge: number;
    avgMigrationScore: number | null;
  } {
    const stmt = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM st_files) as files,
        (SELECT COUNT(*) FROM st_pous) as pous,
        (SELECT COUNT(*) FROM st_state_machines) as state_machines,
        (SELECT COUNT(*) FROM st_safety_interlocks) as interlocks,
        (SELECT COUNT(*) FROM st_safety_bypasses) as bypasses,
        (SELECT COUNT(*) FROM st_tribal_knowledge) as tribal_knowledge,
        (SELECT AVG(overall_score) FROM st_migration_scores) as avg_migration_score
    `);
    const row = stmt.get() as DbRow;
    return {
      files: row['files'] as number,
      pous: row['pous'] as number,
      stateMachines: row['state_machines'] as number,
      interlocks: row['interlocks'] as number,
      bypasses: row['bypasses'] as number,
      tribalKnowledge: row['tribal_knowledge'] as number,
      avgMigrationScore: row['avg_migration_score'] as number | null,
    };
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  clearAll(): void {
    const tables = [
      'st_analysis_runs',
      'st_ai_contexts',
      'st_migration_scores',
      'st_call_graph',
      'st_io_mappings',
      'st_tribal_knowledge',
      'st_safety_warnings',
      'st_safety_bypasses',
      'st_safety_interlocks',
      'st_sm_transitions',
      'st_sm_states',
      'st_state_machines',
      'st_doc_history',
      'st_doc_params',
      'st_docstrings',
      'st_variables',
      'st_pous',
      'st_files',
    ];

    for (const table of tables) {
      try {
        this.db.prepare(`DELETE FROM ${table}`).run();
      } catch {
        // Table may not exist yet
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createIEC61131Repository(config: IEC61131RepositoryConfig): IEC61131Repository {
  return new IEC61131Repository(config);
}
