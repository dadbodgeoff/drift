/**
 * Boundary Store - Data access boundary persistence and querying
 *
 * Loads and saves data access maps and boundary rules to .drift/boundaries/ directory.
 * Supports querying access points by table, file, and checking violations against rules.
 * 
 * Features:
 * - Table name validation to filter false positives
 * - Confidence adjustment based on table name quality
 * - Configurable validation rules
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import { 
  TableNameValidator, 
  createTableNameValidator,
  type TableNameValidatorConfig 
} from './table-name-validator.js';

import type {
  BoundaryStoreConfig,
  DataAccessMap,
  DataAccessPoint,
  TableAccessInfo,
  FileAccessInfo,
  SensitiveField,
  ORMModel,
  BoundaryRules,
  BoundaryViolation,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Directory name for drift configuration */
const DRIFT_DIR = '.drift';

/** Directory name for boundaries */
const BOUNDARIES_DIR = 'boundaries';

/** Access map file name */
const ACCESS_MAP_FILE = 'access-map.json';

/** Rules file name */
const RULES_FILE = 'rules.json';

/** Current schema version */
const SCHEMA_VERSION = '1.0' as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Generate a unique ID for access points
 */
function generateAccessPointId(point: Omit<DataAccessPoint, 'id'>): string {
  return `${point.file}:${point.line}:${point.column}:${point.table}`;
}

/**
 * Create an empty access map
 */
function createEmptyAccessMap(projectRoot: string): DataAccessMap {
  return {
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    projectRoot,
    models: [],
    tables: {},
    accessPoints: {},
    sensitiveFields: [],
    stats: {
      totalTables: 0,
      totalAccessPoints: 0,
      totalSensitiveFields: 0,
      totalModels: 0,
    },
  };
}

/**
 * BoundaryStore configuration with validation options
 */
export interface ExtendedBoundaryStoreConfig extends BoundaryStoreConfig {
  /** Table name validation configuration */
  tableValidation?: TableNameValidatorConfig;
  /** Whether to enable table name validation (default: true) */
  enableTableValidation?: boolean;
}

// ============================================================================
// BoundaryStore Class
// ============================================================================

/**
 * Boundary Store - Manages data access boundary persistence and querying
 *
 * Data is stored in .drift/boundaries/ directory:
 * - .drift/boundaries/access-map.json - Discovered data access points
 * - .drift/boundaries/rules.json - User-defined boundary rules (optional)
 */
export class BoundaryStore {
  private readonly config: ExtendedBoundaryStoreConfig;
  private readonly boundariesDir: string;
  private readonly tableValidator: TableNameValidator;
  private readonly enableValidation: boolean;
  private accessMap: DataAccessMap | null = null;
  private rules: BoundaryRules | null = null;
  
  /** Statistics about filtered table names */
  private filteredTables: Map<string, string> = new Map();

  constructor(config: ExtendedBoundaryStoreConfig) {
    this.config = config;
    this.boundariesDir = path.join(this.config.rootDir, DRIFT_DIR, BOUNDARIES_DIR);
    this.enableValidation = config.enableTableValidation !== false;
    this.tableValidator = createTableNameValidator(config.tableValidation);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the boundary store
   *
   * Creates necessary directories and loads existing data.
   */
  async initialize(): Promise<void> {
    await ensureDir(this.boundariesDir);
    await this.loadAccessMap();
    await this.loadRules();
  }

  /**
   * Load access map from disk
   */
  private async loadAccessMap(): Promise<void> {
    const filePath = path.join(this.boundariesDir, ACCESS_MAP_FILE);
    
    if (!(await fileExists(filePath))) {
      this.accessMap = createEmptyAccessMap(this.config.rootDir);
      return;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.accessMap = JSON.parse(content) as DataAccessMap;
    } catch {
      this.accessMap = createEmptyAccessMap(this.config.rootDir);
    }
  }

  /**
   * Load rules from disk
   */
  private async loadRules(): Promise<void> {
    const filePath = path.join(this.boundariesDir, RULES_FILE);
    
    if (!(await fileExists(filePath))) {
      this.rules = null;
      return;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.rules = JSON.parse(content) as BoundaryRules;
    } catch {
      this.rules = null;
    }
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  /**
   * Get the full data access map
   */
  getAccessMap(): DataAccessMap {
    if (!this.accessMap) {
      return createEmptyAccessMap(this.config.rootDir);
    }
    return this.accessMap;
  }

  /**
   * Get access information for a specific table
   */
  getTableAccess(table: string): TableAccessInfo | null {
    if (!this.accessMap) {
      return null;
    }
    return this.accessMap.tables[table] ?? null;
  }

  /**
   * Get access information for files matching a glob pattern
   */
  getFileAccess(filePattern: string): FileAccessInfo[] {
    if (!this.accessMap) {
      return [];
    }

    // Group access points by file
    const fileMap = new Map<string, FileAccessInfo>();

    for (const accessPoint of Object.values(this.accessMap.accessPoints)) {
      if (minimatch(accessPoint.file, filePattern)) {
        if (!fileMap.has(accessPoint.file)) {
          fileMap.set(accessPoint.file, {
            file: accessPoint.file,
            tables: [],
            accessPoints: [],
          });
        }

        const fileInfo = fileMap.get(accessPoint.file)!;
        fileInfo.accessPoints.push(accessPoint);
        
        if (!fileInfo.tables.includes(accessPoint.table)) {
          fileInfo.tables.push(accessPoint.table);
        }
      }
    }

    return Array.from(fileMap.values());
  }

  /**
   * Get all sensitive field access
   */
  getSensitiveAccess(): SensitiveField[] {
    if (!this.accessMap) {
      return [];
    }
    return this.accessMap.sensitiveFields;
  }

  /**
   * Get boundary rules (or null if not configured)
   */
  getRules(): BoundaryRules | null {
    return this.rules;
  }

  // ==========================================================================
  // Violation Checking
  // ==========================================================================

  /**
   * Check a single access point against rules
   */
  checkViolations(accessPoint: DataAccessPoint): BoundaryViolation[] {
    if (!this.rules) {
      return [];
    }

    const violations: BoundaryViolation[] = [];

    // Check against global excludes first
    if (this.rules.globalExcludes) {
      for (const excludePattern of this.rules.globalExcludes) {
        if (minimatch(accessPoint.file, excludePattern)) {
          return []; // File is globally excluded
        }
      }
    }

    // Check each enabled rule
    for (const rule of this.rules.boundaries) {
      if (rule.enabled === false) {
        continue;
      }

      const violation = this.checkRuleViolation(accessPoint, rule);
      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Check a single rule against an access point
   */
  private checkRuleViolation(
    accessPoint: DataAccessPoint,
    rule: BoundaryRules['boundaries'][0]
  ): BoundaryViolation | null {
    // Check if rule applies to this access point
    let ruleApplies = false;

    // Check table restrictions
    if (rule.tables?.includes(accessPoint.table)) {
      ruleApplies = true;
    }

    // Check field restrictions
    if (rule.fields) {
      for (const field of accessPoint.fields) {
        const fullFieldName = `${accessPoint.table}.${field}`;
        if (rule.fields.includes(fullFieldName) || rule.fields.includes(field)) {
          ruleApplies = true;
          break;
        }
      }
    }

    // Check operation restrictions
    if (rule.operations && !rule.operations.includes(accessPoint.operation)) {
      return null; // Operation not restricted by this rule
    }

    if (!ruleApplies) {
      return null;
    }

    // Check if file is in excluded paths
    if (rule.excludePaths) {
      for (const excludePattern of rule.excludePaths) {
        if (minimatch(accessPoint.file, excludePattern)) {
          return null; // File is excluded from this rule
        }
      }
    }

    // Check if file is in allowed paths
    let isAllowed = false;
    for (const allowedPattern of rule.allowedPaths) {
      if (minimatch(accessPoint.file, allowedPattern)) {
        isAllowed = true;
        break;
      }
    }

    if (isAllowed) {
      return null; // Access is allowed
    }

    // Create violation
    return {
      id: `${rule.id}:${accessPoint.id}`,
      ruleId: rule.id,
      ruleDescription: rule.description,
      severity: rule.severity,
      file: accessPoint.file,
      line: accessPoint.line,
      column: accessPoint.column,
      message: `Access to ${accessPoint.table} violates boundary rule: ${rule.description}`,
      table: accessPoint.table,
      fields: accessPoint.fields,
      operation: accessPoint.operation,
      suggestion: `Move this access to an allowed path: ${rule.allowedPaths.join(', ')}`,
    };
  }

  /**
   * Check all access points against rules
   */
  checkAllViolations(): BoundaryViolation[] {
    if (!this.accessMap || !this.rules) {
      return [];
    }

    const violations: BoundaryViolation[] = [];

    for (const accessPoint of Object.values(this.accessMap.accessPoints)) {
      const pointViolations = this.checkViolations(accessPoint);
      violations.push(...pointViolations);
    }

    return violations;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Save access map to disk
   */
  async saveAccessMap(map: DataAccessMap): Promise<void> {
    await ensureDir(this.boundariesDir);
    
    const filePath = path.join(this.boundariesDir, ACCESS_MAP_FILE);
    
    // Update stats
    map.stats = {
      totalTables: Object.keys(map.tables).length,
      totalAccessPoints: Object.keys(map.accessPoints).length,
      totalSensitiveFields: map.sensitiveFields.length,
      totalModels: map.models.length,
    };
    
    map.generatedAt = new Date().toISOString();
    
    this.accessMap = map;
    await fs.writeFile(filePath, JSON.stringify(map, null, 2));
  }

  /**
   * Save rules to disk
   */
  async saveRules(rules: BoundaryRules): Promise<void> {
    await ensureDir(this.boundariesDir);
    
    const filePath = path.join(this.boundariesDir, RULES_FILE);
    this.rules = rules;
    await fs.writeFile(filePath, JSON.stringify(rules, null, 2));
  }

  // ==========================================================================
  // Adding Data
  // ==========================================================================

  /**
   * Add a single access point
   * 
   * Table names are validated to filter out false positives.
   * Invalid table names are logged and the access point is skipped.
   */
  addAccessPoint(point: DataAccessPoint): void {
    if (!this.accessMap) {
      this.accessMap = createEmptyAccessMap(this.config.rootDir);
    }

    // Validate table name if validation is enabled
    if (this.enableValidation) {
      const validation = this.tableValidator.validate(point.table, {
        file: point.file,
        line: point.line,
      });
      
      if (!validation.isValid) {
        // Track filtered tables for debugging
        this.filteredTables.set(point.table, validation.reason ?? 'Unknown reason');
        return; // Skip this access point
      }
      
      // Adjust confidence based on table name quality
      point.confidence = point.confidence * validation.confidenceMultiplier;
      
      // Use normalized name if provided
      if (validation.normalizedName) {
        point.table = validation.normalizedName;
      }
    }

    // Ensure ID exists
    if (!point.id) {
      point.id = generateAccessPointId(point);
    }

    // Add to access points
    this.accessMap.accessPoints[point.id] = point;

    // Update table info
    if (!this.accessMap.tables[point.table]) {
      this.accessMap.tables[point.table] = {
        name: point.table,
        model: null,
        fields: [],
        sensitiveFields: [],
        accessedBy: [],
      };
    }

    const tableInfo = this.accessMap.tables[point.table]!;
    
    // Add fields
    for (const field of point.fields) {
      if (!tableInfo.fields.includes(field)) {
        tableInfo.fields.push(field);
      }
    }

    // Add access point reference
    if (!tableInfo.accessedBy.find(ap => ap.id === point.id)) {
      tableInfo.accessedBy.push(point);
    }

    // Update stats
    this.accessMap.stats.totalTables = Object.keys(this.accessMap.tables).length;
    this.accessMap.stats.totalAccessPoints = Object.keys(this.accessMap.accessPoints).length;
  }

  /**
   * Get filtered table names and reasons (for debugging)
   */
  getFilteredTables(): Map<string, string> {
    return new Map(this.filteredTables);
  }

  /**
   * Clear filtered tables tracking
   */
  clearFilteredTables(): void {
    this.filteredTables.clear();
  }

  /**
   * Add an ORM model
   */
  addModel(model: ORMModel): void {
    if (!this.accessMap) {
      this.accessMap = createEmptyAccessMap(this.config.rootDir);
    }

    // Check if model already exists
    const existingIndex = this.accessMap.models.findIndex(
      m => m.name === model.name && m.file === model.file
    );

    if (existingIndex >= 0) {
      this.accessMap.models[existingIndex] = model;
    } else {
      this.accessMap.models.push(model);
    }

    // Update table info if table name is known
    if (model.tableName) {
      if (!this.accessMap.tables[model.tableName]) {
        this.accessMap.tables[model.tableName] = {
          name: model.tableName,
          model: model.name,
          fields: model.fields,
          sensitiveFields: [],
          accessedBy: [],
        };
      } else {
        const existingTable = this.accessMap.tables[model.tableName]!;
        existingTable.model = model.name;
        // Merge fields
        for (const field of model.fields) {
          if (!existingTable.fields.includes(field)) {
            existingTable.fields.push(field);
          }
        }
      }
    }

    // Update stats
    this.accessMap.stats.totalModels = this.accessMap.models.length;
    this.accessMap.stats.totalTables = Object.keys(this.accessMap.tables).length;
  }

  /**
   * Add a sensitive field
   */
  addSensitiveField(field: SensitiveField): void {
    if (!this.accessMap) {
      this.accessMap = createEmptyAccessMap(this.config.rootDir);
    }

    // Check if field already exists
    const existingIndex = this.accessMap.sensitiveFields.findIndex(
      f => f.field === field.field && f.table === field.table
    );

    if (existingIndex >= 0) {
      this.accessMap.sensitiveFields[existingIndex] = field;
    } else {
      this.accessMap.sensitiveFields.push(field);
    }

    // Update table info if table is known
    if (field.table) {
      const tableInfo = this.accessMap.tables[field.table];
      if (tableInfo) {
        const existingSensitive = tableInfo.sensitiveFields.findIndex(
          f => f.field === field.field
        );

        if (existingSensitive >= 0) {
          tableInfo.sensitiveFields[existingSensitive] = field;
        } else {
          tableInfo.sensitiveFields.push(field);
        }
      }
    }

    // Update stats
    this.accessMap.stats.totalSensitiveFields = this.accessMap.sensitiveFields.length;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new BoundaryStore instance
 */
export function createBoundaryStore(config: ExtendedBoundaryStoreConfig): BoundaryStore {
  return new BoundaryStore(config);
}
