/**
 * Storage Sync Service
 *
 * Syncs data from legacy JSON stores to the unified SQLite database.
 * This service ensures drift.db is the single source of truth.
 *
 * @module storage/sync-service
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { UnifiedStore } from './unified-store.js';
import type {
  DbDataModel,
  DbSensitiveField,
  DbDataAccessPoint,
  DbEnvVariable,
  DbEnvAccessPoint,
  DbFunction,
  DbFunctionCall,
  DbFunctionDataAccess,
  DbAuditSnapshot,
  DbHealthTrend,
  DbDNAProfile,
  DbDNAGene,
  DbDNAMutation,
  DbTestFile,
  DbTestCoverage,
  DbContract,
  DbContractFrontend,
  DbConstraint,
  DbScanHistory,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';

// ============================================================================
// Types
// ============================================================================

export interface SyncResult {
  success: boolean;
  synced: {
    boundaries: number;
    environment: number;
    callGraph: { functions: number; calls: number; dataAccess: number };
    audit: { snapshots: number; trends: number };
    dna: { genes: number; mutations: number };
    testTopology: { files: number; coverage: number };
    contracts: { contracts: number; frontends: number };
    constraints: number;
    history: number;
    coupling: { modules: number; cycles: number };
    errorHandling: { boundaries: number; gaps: number };
  };
  errors: string[];
}


export interface SyncOptions {
  rootDir: string;
  verbose?: boolean;
  /** Only sync specific domains */
  domains?: ('boundaries' | 'environment' | 'callGraph' | 'audit' | 'dna' | 'testTopology')[];
}

// ============================================================================
// Sync Service
// ============================================================================

/**
 * StoreSyncService - Syncs legacy JSON data to SQLite
 */
export class StoreSyncService {
  private readonly rootDir: string;
  private readonly verbose: boolean;
  private store: UnifiedStore | null = null;

  constructor(options: SyncOptions) {
    this.rootDir = options.rootDir;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Initialize the sync service
   */
  async initialize(): Promise<void> {
    this.store = new UnifiedStore({ rootDir: this.rootDir });
    await this.store.initialize();
  }

  /**
   * Close the sync service
   */
  async close(): Promise<void> {
    if (this.store) {
      await this.store.close();
      this.store = null;
    }
  }

  /**
   * Get the unified store instance
   */
  getStore(): UnifiedStore {
    if (!this.store) {
      throw new Error('StoreSyncService not initialized');
    }
    return this.store;
  }


  /**
   * Sync all data from JSON to SQLite
   */
  async syncAll(): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      synced: {
        boundaries: 0,
        environment: 0,
        callGraph: { functions: 0, calls: 0, dataAccess: 0 },
        audit: { snapshots: 0, trends: 0 },
        dna: { genes: 0, mutations: 0 },
        testTopology: { files: 0, coverage: 0 },
        contracts: { contracts: 0, frontends: 0 },
        constraints: 0,
        history: 0,
        coupling: { modules: 0, cycles: 0 },
        errorHandling: { boundaries: 0, gaps: 0 },
      },
      errors: [],
    };

    try {
      // Sync boundaries
      const boundaryResult = await this.syncBoundaries();
      result.synced.boundaries = boundaryResult;

      // Sync environment
      const envResult = await this.syncEnvironment();
      result.synced.environment = envResult;

      // Sync call graph
      const cgResult = await this.syncCallGraph();
      result.synced.callGraph = cgResult;

      // Sync audit
      const auditResult = await this.syncAudit();
      result.synced.audit = auditResult;

      // Sync DNA
      const dnaResult = await this.syncDNA();
      result.synced.dna = dnaResult;

      // Sync test topology
      const testResult = await this.syncTestTopology();
      result.synced.testTopology = testResult;

      // Sync contracts
      const contractResult = await this.syncContracts();
      result.synced.contracts = contractResult;

      // Sync constraints
      const constraintResult = await this.syncConstraints();
      result.synced.constraints = constraintResult;

      // Sync history
      const historyResult = await this.syncHistory();
      result.synced.history = historyResult;

      // Sync coupling
      const couplingResult = await this.syncCoupling();
      result.synced.coupling = couplingResult;

      // Sync error handling
      const errorResult = await this.syncErrorHandling();
      result.synced.errorHandling = errorResult;

    } catch (error) {
      result.success = false;
      result.errors.push(String(error));
    }

    return result;
  }


  /**
   * Sync boundaries from JSON to SQLite
   */
  async syncBoundaries(): Promise<number> {
    if (!this.store) throw new Error('Not initialized');
    
    const accessMapPath = path.join(this.rootDir, DRIFT_DIR, 'boundaries', 'access-map.json');
    
    try {
      const content = await fs.readFile(accessMapPath, 'utf-8');
      const data = JSON.parse(content);
      let count = 0;

      // Sync models
      if (data.models) {
        for (const model of data.models) {
          const tableName = model.tableName ?? model.table_name;
          
          // Skip if required fields are missing
          if (!model.name || !tableName || !model.file) {
            if (this.verbose) console.log(`  Skipping invalid model: missing required data`);
            continue;
          }
          
          const dbModel: DbDataModel = {
            name: model.name,
            table_name: tableName,
            file: model.file,
            line: model.line ?? 0,
            framework: model.framework ?? null,
            confidence: model.confidence ?? 1.0,
            fields: model.fields ? JSON.stringify(model.fields) : null,
          };
          await this.store.boundaries.addModel(dbModel);
          count++;
        }
      }

      // Sync sensitive fields
      if (data.sensitiveFields) {
        for (const field of data.sensitiveFields) {
          // Handle both camelCase and snake_case, and the actual JSON format
          const tableName = field.table ?? field.tableName ?? field.table_name ?? 'unknown';
          const fieldName = field.field ?? field.fieldName ?? field.field_name;
          const sensitivity = field.sensitivityType ?? field.sensitivity;
          
          // Skip if required fields are missing
          if (!fieldName || !sensitivity) {
            if (this.verbose) console.log(`  Skipping invalid sensitive field: missing required data`);
            continue;
          }
          
          // Map sensitivityType to valid enum values
          const sensitivityMap: Record<string, string> = {
            'pii': 'pii',
            'credentials': 'auth',
            'financial': 'financial',
            'health': 'health',
            'auth': 'auth',
            'custom': 'custom',
          };
          const mappedSensitivity = sensitivityMap[sensitivity] ?? 'custom';
          
          const dbField: DbSensitiveField = {
            table_name: tableName,
            field_name: fieldName,
            sensitivity: mappedSensitivity as 'pii' | 'financial' | 'auth' | 'health' | 'custom',
            reason: field.reason ?? `Detected in ${field.file}:${field.line}`,
          };
          await this.store.boundaries.addSensitiveField(dbField);
        }
      }

      // Sync access points
      if (data.accessPoints) {
        for (const [, ap] of Object.entries(data.accessPoints)) {
          const point = ap as Record<string, unknown>;
          const tableName = (point['table'] as string) ?? (point['tableName'] as string);
          const file = point['file'] as string;
          const line = point['line'] as number;
          
          // Skip if required fields are missing
          if (!tableName || !file || line === undefined) {
            if (this.verbose) console.log(`  Skipping invalid access point: missing required data`);
            continue;
          }
          
          const dbPoint: DbDataAccessPoint = {
            id: (point['id'] as string) ?? `${file}:${line}:${tableName}`,
            table_name: tableName,
            operation: (point['operation'] as 'read' | 'write' | 'delete') ?? 'read',
            file: file,
            line: line,
            column_num: (point['column'] as number) ?? 0,
            context: (point['context'] as string) ?? null,
            fields: point['fields'] ? JSON.stringify(point['fields']) : null,
            is_raw_sql: (point['isRawSql'] as boolean) ? 1 : 0,
            confidence: (point['confidence'] as number) ?? 1.0,
            function_id: (point['functionId'] as string) ?? null,
          };
          await this.store.boundaries.addAccessPoint(dbPoint);
          count++;
        }
      }

      if (this.verbose) console.log(`  Synced ${count} boundary items`);
      return count;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return 0;
    }
  }


  /**
   * Sync environment from JSON to SQLite
   */
  async syncEnvironment(): Promise<number> {
    if (!this.store) throw new Error('Not initialized');
    
    const accessMapPath = path.join(this.rootDir, DRIFT_DIR, 'environment', 'access-map.json');
    
    try {
      const content = await fs.readFile(accessMapPath, 'utf-8');
      const data = JSON.parse(content);
      let count = 0;

      // Sync variables
      if (data.variables) {
        for (const [name, info] of Object.entries(data.variables)) {
          const varInfo = info as Record<string, unknown>;
          const dbVar: DbEnvVariable = {
            name,
            sensitivity: (varInfo['sensitivity'] as 'secret' | 'credential' | 'config' | 'unknown') ?? 'unknown',
            has_default: varInfo['hasDefault'] ? 1 : 0,
            is_required: varInfo['isRequired'] ? 1 : 0,
            default_value: (varInfo['defaultValue'] as string) ?? null,
          };
          await this.store.environment.addVariable(dbVar);
          count++;
        }
      }

      // Sync access points
      if (data.accessPoints) {
        for (const [, ap] of Object.entries(data.accessPoints)) {
          const point = ap as Record<string, unknown>;
          const varName = (point['varName'] as string) ?? (point['variable'] as string);
          const file = point['file'] as string;
          const line = point['line'] as number;
          
          // Skip if required fields are missing
          if (!varName || !file || line === undefined) {
            if (this.verbose) console.log(`  Skipping invalid env access point: missing required data`);
            continue;
          }
          
          const dbPoint: DbEnvAccessPoint = {
            id: (point['id'] as string) ?? `${file}:${line}:${varName}`,
            var_name: varName,
            method: (point['method'] as string) ?? 'unknown',
            file: file,
            line: line,
            column_num: (point['column'] as number) ?? 0,
            context: (point['context'] as string) ?? null,
            language: (point['language'] as string) ?? null,
            confidence: (point['confidence'] as number) ?? 1.0,
            has_default: point['hasDefault'] ? 1 : 0,
            default_value: (point['defaultValue'] as string) ?? null,
            is_required: point['isRequired'] ? 1 : 0,
          };
          await this.store.environment.addAccessPoint(dbPoint);
          count++;
        }
      }

      if (this.verbose) console.log(`  Synced ${count} environment items`);
      return count;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return 0;
    }
  }


  /**
   * Sync call graph from callgraph.db to drift.db
   * The Rust native call graph builder writes to a separate SQLite database.
   */
  async syncCallGraph(): Promise<{ functions: number; calls: number; dataAccess: number }> {
    if (!this.store) throw new Error('Not initialized');
    
    const callgraphDbPath = path.join(this.rootDir, DRIFT_DIR, 'lake', 'callgraph', 'callgraph.db');
    const result = { functions: 0, calls: 0, dataAccess: 0 };
    
    try {
      // Check if callgraph.db exists
      await fs.access(callgraphDbPath);
      
      // Dynamic import better-sqlite3 to read from callgraph.db
      const Database = (await import('better-sqlite3')).default;
      const cgDb = new Database(callgraphDbPath, { readonly: true });
      
      try {
        // Sync functions
        const functions = cgDb.prepare('SELECT * FROM functions').all() as Array<{
          id: string;
          name: string;
          file: string;
          start_line: number;
          end_line: number;
          is_entry_point: number;
          is_data_accessor: number;
        }>;
        
        for (const fn of functions) {
          const dbFunc: DbFunction = {
            id: fn.id,
            name: fn.name,
            qualified_name: null,
            file: fn.file,
            start_line: fn.start_line,
            end_line: fn.end_line,
            language: 'typescript', // Default for now
            is_exported: 0,
            is_entry_point: fn.is_entry_point,
            is_data_accessor: fn.is_data_accessor,
            is_constructor: 0,
            is_async: 0,
            decorators: null,
            parameters: null,
            signature: null,
          };
          await this.store.callGraph.addFunction(dbFunc);
          result.functions++;
        }

        // Sync calls
        const calls = cgDb.prepare('SELECT * FROM calls').all() as Array<{
          caller_id: string;
          target: string;
          resolved_id: string | null;
          confidence: number;
          line: number;
        }>;
        
        for (const call of calls) {
          const dbCall: DbFunctionCall = {
            caller_id: call.caller_id,
            callee_id: call.resolved_id,
            callee_name: call.target,
            line: call.line,
            column_num: 0,
            resolved: call.resolved_id ? 1 : 0,
            confidence: call.confidence,
            argument_count: 0,
          };
          await this.store.callGraph.addCall(dbCall);
          result.calls++;
        }

        // Sync data access
        const dataAccess = cgDb.prepare('SELECT * FROM data_access').all() as Array<{
          function_id: string;
          table_name: string;
          operation: string;
          fields: string | null;
          line: number;
        }>;
        
        for (const da of dataAccess) {
          const dbAccess: DbFunctionDataAccess = {
            function_id: da.function_id,
            table_name: da.table_name,
            operation: da.operation as 'read' | 'write' | 'delete',
            fields: da.fields,
            line: da.line,
            confidence: 1.0,
          };
          await this.store.callGraph.addDataAccess(dbAccess);
          result.dataAccess++;
        }
      } finally {
        cgDb.close();
      }

      if (this.verbose) {
        console.log(`  Synced ${result.functions} functions, ${result.calls} calls, ${result.dataAccess} data access`);
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return result;
    }
  }


  /**
   * Sync audit data from JSON to SQLite
   */
  async syncAudit(): Promise<{ snapshots: number; trends: number }> {
    if (!this.store) throw new Error('Not initialized');
    
    const auditDir = path.join(this.rootDir, DRIFT_DIR, 'audit');
    const result = { snapshots: 0, trends: 0 };
    
    try {
      // Sync latest snapshot
      const latestPath = path.join(auditDir, 'latest.json');
      try {
        const content = await fs.readFile(latestPath, 'utf-8');
        const data = JSON.parse(content);
        
        const dbSnapshot: DbAuditSnapshot = {
          date: data.date ?? new Date().toISOString().split('T')[0],
          scan_hash: data.scanHash ?? null,
          health_score: data.healthScore ?? data.health_score ?? null,
          total_patterns: data.totalPatterns ?? data.total_patterns ?? null,
          auto_approve_eligible: data.autoApproveEligible ?? null,
          flagged_for_review: data.flaggedForReview ?? null,
          likely_false_positives: data.likelyFalsePositives ?? null,
          duplicate_candidates: data.duplicateCandidates ?? null,
          avg_confidence: data.avgConfidence ?? data.avg_confidence ?? null,
          cross_validation_score: data.crossValidationScore ?? null,
          summary: data.summary ? JSON.stringify(data.summary) : null,
        };
        await this.store.audit.addSnapshot(dbSnapshot);
        result.snapshots++;
      } catch { /* No latest.json */ }

      // Sync historical snapshots
      const snapshotsDir = path.join(auditDir, 'snapshots');
      try {
        const files = await fs.readdir(snapshotsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          
          const content = await fs.readFile(path.join(snapshotsDir, file), 'utf-8');
          const data = JSON.parse(content);
          
          const dbSnapshot: DbAuditSnapshot = {
            date: data.date ?? file.replace('.json', ''),
            scan_hash: data.scanHash ?? null,
            health_score: data.healthScore ?? null,
            total_patterns: data.totalPatterns ?? null,
            auto_approve_eligible: data.autoApproveEligible ?? null,
            flagged_for_review: data.flaggedForReview ?? null,
            likely_false_positives: data.likelyFalsePositives ?? null,
            duplicate_candidates: data.duplicateCandidates ?? null,
            avg_confidence: data.avgConfidence ?? null,
            cross_validation_score: data.crossValidationScore ?? null,
            summary: data.summary ? JSON.stringify(data.summary) : null,
          };
          await this.store.audit.addSnapshot(dbSnapshot);
          result.snapshots++;
        }
      } catch { /* No snapshots dir */ }

      // Sync degradation/trends
      const degradationPath = path.join(auditDir, 'degradation.json');
      try {
        const content = await fs.readFile(degradationPath, 'utf-8');
        const data = JSON.parse(content);
        
        if (data.history) {
          for (const entry of data.history) {
            const dbTrend: DbHealthTrend = {
              date: entry.date,
              health_score: entry.healthScore ?? null,
              avg_confidence: entry.avgConfidence ?? null,
              total_patterns: entry.totalPatterns ?? null,
              approved_count: entry.approvedCount ?? null,
              duplicate_groups: entry.duplicateGroups ?? null,
              cross_validation_score: entry.crossValidationScore ?? null,
            };
            await this.store.audit.addTrend(dbTrend);
            result.trends++;
          }
        }
      } catch { /* No degradation.json */ }

      if (this.verbose) {
        console.log(`  Synced ${result.snapshots} snapshots, ${result.trends} trends`);
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return result;
    }
  }


  /**
   * Sync DNA data from JSON to SQLite
   */
  async syncDNA(): Promise<{ genes: number; mutations: number }> {
    if (!this.store) throw new Error('Not initialized');
    
    const dnaDir = path.join(this.rootDir, DRIFT_DIR, 'dna');
    const result = { genes: 0, mutations: 0 };
    
    try {
      // Try styling.json first (new format from dna scan)
      const stylingPath = path.join(dnaDir, 'styling.json');
      try {
        const content = await fs.readFile(stylingPath, 'utf-8');
        const data = JSON.parse(content);
        
        // Save profile from summary
        if (data.summary) {
          const dbProfile: DbDNAProfile = {
            id: 1,
            version: data.version ?? '1.0.0',
            generated_at: data.generatedAt ?? new Date().toISOString(),
            health_score: data.summary.healthScore ?? null,
            genetic_diversity: data.summary.geneticDiversity ?? null,
            summary: JSON.stringify(data.summary),
          };
          await this.store.dna.saveProfile(dbProfile);
        }
        
        // Sync genes from the genes object
        if (data.genes) {
          for (const [geneId, gene] of Object.entries(data.genes)) {
            const geneData = gene as Record<string, unknown>;
            const dbGene: DbDNAGene = {
              id: geneId,
              name: (geneData['name'] as string) ?? geneId,
              dominant_variant: (geneData['dominant'] as string) ?? null,
              frequency: null,
              confidence: (geneData['confidence'] as number) ?? null,
              variants: geneData['alleles'] ? JSON.stringify(geneData['alleles']) : null,
              evidence: geneData['exemplars'] ? JSON.stringify(geneData['exemplars']) : null,
            };
            await this.store.dna.addGene(dbGene);
            result.genes++;
          }
        }
      } catch { /* No styling.json */ }

      // Also try legacy profile.json format
      const profilePath = path.join(dnaDir, 'profile.json');
      try {
        const content = await fs.readFile(profilePath, 'utf-8');
        const data = JSON.parse(content);
        
        const dbProfile: DbDNAProfile = {
          id: 1,
          version: data.version ?? '1.0.0',
          generated_at: data.generatedAt ?? new Date().toISOString(),
          health_score: data.healthScore ?? null,
          genetic_diversity: data.geneticDiversity ?? null,
          summary: data.summary ? JSON.stringify(data.summary) : null,
        };
        await this.store.dna.saveProfile(dbProfile);
      } catch { /* No profile.json */ }

      // Also try legacy genes.json format
      const genesPath = path.join(dnaDir, 'genes.json');
      try {
        const content = await fs.readFile(genesPath, 'utf-8');
        const data = JSON.parse(content);
        
        const genes = Array.isArray(data) ? data : (data.genes ?? []);
        for (const gene of genes) {
          const dbGene: DbDNAGene = {
            id: gene.id,
            name: gene.name,
            dominant_variant: gene.dominantVariant ?? null,
            frequency: gene.frequency ?? null,
            confidence: gene.confidence ?? null,
            variants: gene.variants ? JSON.stringify(gene.variants) : null,
            evidence: gene.evidence ? JSON.stringify(gene.evidence) : null,
          };
          await this.store.dna.addGene(dbGene);
          result.genes++;

          // Sync mutations for this gene
          if (gene.mutations) {
            for (const mutation of gene.mutations) {
              const dbMutation: DbDNAMutation = {
                gene_id: gene.id,
                file: mutation.file,
                line: mutation.line,
                expected: mutation.expected ?? null,
                actual: mutation.actual ?? null,
                impact: mutation.impact ?? null,
                reason: mutation.reason ?? null,
              };
              await this.store.dna.addMutation(dbMutation);
              result.mutations++;
            }
          }
        }
      } catch { /* No genes.json */ }

      if (this.verbose) {
        console.log(`  Synced ${result.genes} genes, ${result.mutations} mutations`);
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return result;
    }
  }


  /**
   * Sync test topology from JSON to SQLite
   */
  async syncTestTopology(): Promise<{ files: number; coverage: number }> {
    if (!this.store) throw new Error('Not initialized');
    
    const testDir = path.join(this.rootDir, DRIFT_DIR, 'test-topology');
    const result = { files: 0, coverage: 0 };
    
    try {
      // Sync test files index
      const indexPath = path.join(testDir, 'index.json');
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        const data = JSON.parse(content);
        
        const testFiles = data.testFiles ?? data.files ?? [];
        for (const tf of testFiles) {
          const dbFile: DbTestFile = {
            file: tf.file ?? tf.path,
            test_framework: tf.framework ?? tf.testFramework ?? null,
            test_count: tf.testCount ?? tf.count ?? 0,
            last_run: tf.lastRun ?? null,
            status: tf.status ?? 'unknown',
          };
          await this.store.testTopology.addTestFile(dbFile);
          result.files++;
        }
      } catch { /* No index.json */ }

      // Sync coverage mappings
      const coveragePath = path.join(testDir, 'coverage.json');
      try {
        const content = await fs.readFile(coveragePath, 'utf-8');
        const data = JSON.parse(content);
        
        const mappings = data.mappings ?? data.coverage ?? [];
        for (const mapping of mappings) {
          const dbCoverage: DbTestCoverage = {
            test_file: mapping.testFile ?? mapping.test_file,
            source_file: mapping.sourceFile ?? mapping.source_file,
            function_id: mapping.functionId ?? mapping.function_id ?? null,
            coverage_type: mapping.type ?? mapping.coverageType ?? null,
            confidence: mapping.confidence ?? 1.0,
          };
          await this.store.testTopology.addCoverage(dbCoverage);
          result.coverage++;
        }
      } catch { /* No coverage.json */ }

      if (this.verbose) {
        console.log(`  Synced ${result.files} test files, ${result.coverage} coverage mappings`);
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return result;
    }
  }


  /**
   * Sync contracts from JSON to SQLite
   */
  async syncContracts(): Promise<{ contracts: number; frontends: number }> {
    if (!this.store) throw new Error('Not initialized');
    
    const contractsDir = path.join(this.rootDir, DRIFT_DIR, 'contracts');
    const result = { contracts: 0, frontends: 0 };
    
    const statuses = ['discovered', 'mismatch', 'verified', 'ignored'] as const;
    
    for (const status of statuses) {
      const contractsPath = path.join(contractsDir, status, 'contracts.json');
      
      try {
        const content = await fs.readFile(contractsPath, 'utf-8');
        const data = JSON.parse(content);
        
        const contracts = data.contracts ?? [];
        for (const contract of contracts) {
          const backend = contract.backend ?? {};
          const confidence = contract.confidence ?? {};
          
          const dbContract: DbContract = {
            id: contract.id,
            method: contract.method ?? 'GET',
            endpoint: contract.endpoint ?? backend.path ?? '',
            normalized_endpoint: backend.normalizedPath ?? contract.endpoint ?? '',
            status: status as DbContract['status'],
            
            backend_method: backend.method ?? null,
            backend_path: backend.path ?? null,
            backend_normalized_path: backend.normalizedPath ?? null,
            backend_file: backend.file ?? null,
            backend_line: backend.line ?? null,
            backend_framework: backend.framework ?? null,
            backend_response_fields: backend.responseFields ? JSON.stringify(backend.responseFields) : null,
            
            confidence_score: confidence.score ?? 0,
            confidence_level: confidence.level ?? 'low',
            match_confidence: confidence.matchConfidence ?? null,
            field_extraction_confidence: confidence.fieldExtractionConfidence ?? null,
            
            mismatches: contract.mismatches ? JSON.stringify(contract.mismatches) : null,
            
            first_seen: contract.metadata?.firstSeen ?? new Date().toISOString(),
            last_seen: contract.metadata?.lastSeen ?? new Date().toISOString(),
            verified_at: null,
            verified_by: null,
          };
          
          await this.store.contracts.create(dbContract);
          result.contracts++;
          
          // Sync frontends
          const frontends = contract.frontend ?? [];
          for (const fe of frontends) {
            const dbFrontend: DbContractFrontend = {
              contract_id: contract.id,
              method: fe.method ?? 'GET',
              path: fe.path ?? '',
              normalized_path: fe.normalizedPath ?? fe.path ?? '',
              file: fe.file ?? '',
              line: fe.line ?? 0,
              library: fe.library ?? null,
              response_fields: fe.responseFields ? JSON.stringify(fe.responseFields) : null,
            };
            await this.store.contracts.addFrontend(contract.id, dbFrontend);
            result.frontends++;
          }
        }
      } catch { /* No contracts file for this status */ }
    }

    if (this.verbose) {
      console.log(`  Synced ${result.contracts} contracts, ${result.frontends} frontends`);
    }
    return result;
  }


  /**
   * Sync constraints from JSON to SQLite
   */
  async syncConstraints(): Promise<number> {
    if (!this.store) throw new Error('Not initialized');
    
    const constraintsDir = path.join(this.rootDir, DRIFT_DIR, 'constraints');
    let count = 0;
    
    const statuses = ['discovered', 'approved', 'ignored', 'custom'] as const;
    
    for (const status of statuses) {
      const statusDir = path.join(constraintsDir, status);
      
      try {
        const files = await fs.readdir(statusDir);
        
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          
          const content = await fs.readFile(path.join(statusDir, file), 'utf-8');
          const data = JSON.parse(content);
          
          // Handle both single constraint and array of constraints
          const constraints = Array.isArray(data) ? data : (data.constraints ?? [data]);
          
          for (const constraint of constraints) {
            if (!constraint.id || !constraint.name) continue;
            
            const dbConstraint: DbConstraint = {
              id: constraint.id,
              name: constraint.name,
              description: constraint.description ?? null,
              category: constraint.category ?? 'structural',
              status: status as DbConstraint['status'],
              language: constraint.language ?? 'typescript',
              
              invariant: constraint.invariant ? JSON.stringify(constraint.invariant) : '{}',
              scope: constraint.scope ? JSON.stringify(constraint.scope) : null,
              enforcement_level: constraint.enforcementLevel ?? constraint.enforcement_level ?? 'warning',
              enforcement_message: constraint.enforcementMessage ?? constraint.enforcement_message ?? null,
              enforcement_autofix: constraint.enforcementAutofix ?? null,
              
              confidence_score: constraint.confidence?.score ?? constraint.confidenceScore ?? 0,
              confidence_evidence: constraint.confidence?.evidence ?? 0,
              confidence_violations: constraint.confidence?.violations ?? 0,
              
              created_at: constraint.createdAt ?? constraint.firstSeen ?? new Date().toISOString(),
              updated_at: constraint.updatedAt ?? constraint.lastSeen ?? new Date().toISOString(),
              approved_at: constraint.approvedAt ?? null,
              approved_by: constraint.approvedBy ?? null,
              ignored_at: constraint.ignoredAt ?? null,
              ignore_reason: constraint.ignoreReason ?? constraint.ignoredReason ?? null,
              tags: constraint.tags ? JSON.stringify(constraint.tags) : null,
              notes: constraint.notes ?? null,
            };
            
            await this.store.constraints.create(dbConstraint);
            count++;
          }
        }
      } catch { /* No constraints for this status */ }
    }

    if (this.verbose) {
      console.log(`  Synced ${count} constraints`);
    }
    return count;
  }


  /**
   * Sync history snapshots from JSON to SQLite
   */
  async syncHistory(): Promise<number> {
    if (!this.store) throw new Error('Not initialized');
    
    const historyDir = path.join(this.rootDir, DRIFT_DIR, 'history', 'snapshots');
    let count = 0;
    
    try {
      const files = await fs.readdir(historyDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const content = await fs.readFile(path.join(historyDir, file), 'utf-8');
        const data = JSON.parse(content);
        
        const dbScan: DbScanHistory = {
          scan_id: data.scanId ?? `scan-${file.replace('.json', '')}`,
          started_at: data.timestamp ?? data.startedAt ?? new Date().toISOString(),
          completed_at: data.completedAt ?? data.timestamp ?? null,
          duration_ms: data.durationMs ?? data.duration ?? null,
          files_scanned: data.filesScanned ?? data.patterns?.length ?? null,
          patterns_found: data.patternsFound ?? data.patterns?.length ?? null,
          patterns_approved: data.patternsApproved ?? null,
          errors: data.errors ?? 0,
          status: 'completed',
          error_message: null,
          checksum: data.checksum ?? null,
        };
        
        await this.store.audit.addScan(dbScan);
        count++;
      }
    } catch { /* No history snapshots */ }

    if (this.verbose) {
      console.log(`  Synced ${count} history snapshots`);
    }
    return count;
  }


  /**
   * Sync module coupling from JSON to SQLite
   */
  async syncCoupling(): Promise<{ modules: number; cycles: number }> {
    if (!this.store) throw new Error('Not initialized');
    
    const couplingPath = path.join(this.rootDir, DRIFT_DIR, 'module-coupling', 'graph.json');
    let modules = 0;
    let cycles = 0;
    
    try {
      const content = await fs.readFile(couplingPath, 'utf-8');
      const data = JSON.parse(content);
      
      // Sync modules (can be object or array)
      const moduleList = Array.isArray(data.modules) 
        ? data.modules 
        : Object.entries(data.modules ?? {}).map(([key, val]) => ({ name: key, ...(val as object) }));
      
      for (const mod of moduleList) {
        const moduleName = mod.name ?? mod.path ?? '';
        
        // Sync imports as coupling relationships
        const imports = mod.imports ?? [];
        for (const imp of imports) {
          const targetModule = typeof imp === 'string' ? imp : (imp.module ?? imp.path ?? '');
          this.store.runRaw(`
            INSERT OR REPLACE INTO module_coupling (source_module, target_module, coupling_type, strength)
            VALUES (?, ?, ?, ?)
          `, [
            moduleName,
            targetModule,
            'import',
            1,
          ]);
          modules++;
        }
        
        // If no imports, still record the module
        if (imports.length === 0 && moduleName) {
          this.store.runRaw(`
            INSERT OR REPLACE INTO module_coupling (source_module, target_module, coupling_type, strength)
            VALUES (?, ?, ?, ?)
          `, [
            moduleName,
            '',
            'import',
            0,
          ]);
          modules++;
        }
      }
      
      // Sync edges as coupling relationships (if present)
      if (data.edges && Array.isArray(data.edges)) {
        for (const edge of data.edges) {
          this.store.runRaw(`
            INSERT OR REPLACE INTO module_coupling (source_module, target_module, coupling_type, strength)
            VALUES (?, ?, ?, ?)
          `, [
            edge.source ?? edge.from,
            edge.target ?? edge.to,
            'import',
            edge.weight ?? 1,
          ]);
          modules++;
        }
      }
      
      // Sync cycles
      if (data.cycles && Array.isArray(data.cycles)) {
        for (const cycle of data.cycles) {
          const cycleModules = Array.isArray(cycle) ? cycle : (cycle.modules ?? cycle.path ?? []);
          const cycleHash = cycleModules.join('->');
          
          this.store.runRaw(`
            INSERT OR IGNORE INTO coupling_cycles (cycle_hash, modules, length, severity)
            VALUES (?, ?, ?, ?)
          `, [
            cycleHash,
            JSON.stringify(cycleModules),
            cycleModules.length,
            cycle.severity ?? 'warning',
          ]);
          cycles++;
        }
      }
    } catch (err) { 
      if (this.verbose) {
        console.log(`  Error syncing coupling: ${err}`);
      }
    }

    if (this.verbose) {
      console.log(`  Synced ${modules} module couplings, ${cycles} cycles`);
    }
    return { modules, cycles };
  }


  /**
   * Sync error handling from JSON to SQLite
   */
  async syncErrorHandling(): Promise<{ boundaries: number; gaps: number }> {
    if (!this.store) throw new Error('Not initialized');
    
    const analysisPath = path.join(this.rootDir, DRIFT_DIR, 'error-handling', 'analysis.json');
    let boundaries = 0;
    let gaps = 0;
    
    try {
      const content = await fs.readFile(analysisPath, 'utf-8');
      const data = JSON.parse(content);
      
      // Sync boundaries
      if (data.boundaries && Array.isArray(data.boundaries)) {
        for (const boundary of data.boundaries) {
          this.store.runRaw(`
            INSERT OR REPLACE INTO error_boundaries (file, line, type, catches, rethrows, logs, swallows)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            boundary.file ?? boundary.location?.file ?? '',
            boundary.line ?? boundary.startLine ?? boundary.location?.line ?? 0,
            boundary.boundaryType === 'try_catch' ? 'try-catch' : (boundary.boundaryType ?? boundary.type ?? 'try-catch'),
            JSON.stringify(boundary.caughtTypes ?? []),
            boundary.rethrows ? 1 : 0,
            boundary.logsError ? 1 : 0,
            boundary.isSwallowed ? 1 : 0,
          ]);
          boundaries++;
        }
      }
      
      // Sync gaps
      if (data.gaps && Array.isArray(data.gaps)) {
        for (const gap of data.gaps) {
          this.store.runRaw(`
            INSERT OR REPLACE INTO error_handling_gaps (file, line, function_id, gap_type, severity, description)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [
            gap.file ?? gap.location?.file ?? '',
            gap.line ?? gap.startLine ?? gap.location?.line ?? 0,
            gap.functionId ?? gap.functionName ?? gap.function ?? null,
            gap.gapType ?? gap.type ?? 'unhandled',
            gap.severity ?? 'medium',
            gap.description ?? gap.message ?? null,
          ]);
          gaps++;
        }
      }
    } catch (err) { 
      if (this.verbose) {
        console.log(`  Error syncing error handling: ${err}`);
      }
    }

    if (this.verbose) {
      console.log(`  Synced ${boundaries} error boundaries, ${gaps} gaps`);
    }
    return { boundaries, gaps };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a sync service instance
 */
export function createSyncService(options: SyncOptions): StoreSyncService {
  return new StoreSyncService(options);
}
