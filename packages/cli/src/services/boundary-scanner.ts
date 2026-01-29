/**
 * Boundary Scanner Service
 *
 * Scans files to detect data access patterns and boundaries.
 * Tracks which code accesses which database tables/fields.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createBoundaryStore,
  type BoundaryStore,
  type DataAccessPoint,
  type ORMModel,
  type SensitiveField,
  type BoundaryScanResult,
} from 'driftdetect-core';

// Re-export types for consumers
export type { BoundaryScanResult } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface BoundaryScannerConfig {
  rootDir: string;
  verbose?: boolean;
}

// ============================================================================
// Language Detection
// ============================================================================

function getLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.py':
    case '.pyw':
      return 'python';
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.cs':
      return 'csharp';
    case '.php':
      return 'php';
    case '.java':
      return 'java';
    default:
      return null;
  }
}

function isDataAccessFile(filePath: string, content: string): boolean {
  // Skip test files for boundary detection
  if (filePath.includes('.test.') || filePath.includes('.spec.') || 
      filePath.includes('__tests__') || filePath.includes('/tests/')) {
    return false;
  }

  // ORM patterns
  const ormPatterns = [
    'DbSet', 'DbContext', 'Entity', 'Table', 'Column',
    'models.Model', 'CharField', 'ForeignKey', 'ManyToMany',
    'declarative_base', 'relationship',
    'prisma.', '@prisma/client',
    '@Entity', '@Column', 'getRepository',
    'sequelize.define', 'DataTypes',
    'drizzle-orm',
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM',
    'execute', 'query', 'rawQuery',
  ];

  return ormPatterns.some(pattern => content.includes(pattern));
}

// ============================================================================
// Sensitive Field Detection
// ============================================================================

const SENSITIVE_PATTERNS: Record<string, RegExp[]> = {
  pii: [
    /\bssn\b/i, /\bsocial_security\b/i, /\bdate_of_birth\b/i,
    /\bdob\b/i, /\baddress\b/i, /\bphone\b/i, /\bphone_number\b/i,
  ],
  credentials: [
    /\bpassword\b/i, /\bpassword_hash\b/i, /\bsecret\b/i, /\btoken\b/i,
    /\bapi_key\b/i, /\bprivate_key\b/i, /\bhash\b/i, /\bsalt\b/i,
  ],
  financial: [
    /\bcredit_card\b/i, /\bcard_number\b/i, /\bcvv\b/i,
    /\bbank_account\b/i, /\bsalary\b/i, /\bincome\b/i,
  ],
  health: [
    /\bdiagnosis\b/i, /\bprescription\b/i, /\bmedical\b/i, /\bhealth\b/i,
  ],
};

function detectSensitiveFields(content: string, file: string): SensitiveField[] {
  const fields: SensitiveField[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {continue;}
    
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || 
        trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    for (const [type, patterns] of Object.entries(SENSITIVE_PATTERNS)) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          // Try to extract table name from context
          let table: string | null = null;
          
          // Look for class/model name in surrounding lines
          for (let j = Math.max(0, i - 10); j < i; j++) {
            const prevLine = lines[j];
            if (!prevLine) {continue;}
            
            const classMatch = prevLine.match(/class\s+(\w+)/);
            const modelMatch = prevLine.match(/model\s+(\w+)/);
            const tableMatch = prevLine.match(/Table\s*\(\s*["'](\w+)["']/);
            
            if (classMatch?.[1]) {table = classMatch[1];}
            if (modelMatch?.[1]) {table = modelMatch[1];}
            if (tableMatch?.[1]) {table = tableMatch[1];}
          }

          fields.push({
            field: match[0],
            table,
            sensitivityType: type as SensitiveField['sensitivityType'],
            file,
            line: i + 1,
            confidence: 0.8,
          });
          break;
        }
      }
    }
  }

  return fields;
}

// ============================================================================
// ORM Model Detection
// ============================================================================

function detectORMModels(content: string, file: string): ORMModel[] {
  const models: ORMModel[] = [];

  // Detect EF Core DbSet patterns
  const dbSetPattern = /DbSet<(\w+)>\s+(\w+)/g;
  let match;
  while ((match = dbSetPattern.exec(content)) !== null) {
    const modelName = match[1];
    const propName = match[2];
    if (modelName && propName) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      models.push({
        name: modelName,
        tableName: propName.toLowerCase(),
        fields: [],
        file,
        line: lineNum,
        framework: 'efcore',
        confidence: 0.9,
      });
    }
  }

  // Detect Django models
  const djangoModelPattern = /class\s+(\w+)\s*\([^)]*models\.Model[^)]*\)/g;
  while ((match = djangoModelPattern.exec(content)) !== null) {
    const modelName = match[1];
    if (modelName) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      models.push({
        name: modelName,
        tableName: modelName.toLowerCase() + 's',
        fields: [],
        file,
        line: lineNum,
        framework: 'django',
        confidence: 0.85,
      });
    }
  }

  // Detect TypeORM entities
  const typeormPattern = /@Entity\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g;
  while ((match = typeormPattern.exec(content)) !== null) {
    const modelName = match[1];
    if (modelName) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      models.push({
        name: modelName,
        tableName: modelName.toLowerCase() + 's',
        fields: [],
        file,
        line: lineNum,
        framework: 'typeorm',
        confidence: 0.9,
      });
    }
  }

  // Detect Prisma models (from schema.prisma)
  if (file.endsWith('.prisma')) {
    const prismaPattern = /model\s+(\w+)\s*\{/g;
    while ((match = prismaPattern.exec(content)) !== null) {
      const modelName = match[1];
      if (modelName) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        models.push({
          name: modelName,
          tableName: modelName.toLowerCase() + 's',
          fields: [],
          file,
          line: lineNum,
          framework: 'prisma',
          confidence: 0.95,
        });
      }
    }
  }

  // Detect Sequelize models
  const sequelizePattern = /sequelize\.define\s*\(\s*['"](\w+)['"]/g;
  while ((match = sequelizePattern.exec(content)) !== null) {
    const modelName = match[1];
    if (modelName) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      models.push({
        name: modelName,
        tableName: modelName.toLowerCase() + 's',
        fields: [],
        file,
        line: lineNum,
        framework: 'sequelize',
        confidence: 0.85,
      });
    }
  }

  return models;
}

// ============================================================================
// Query Access Detection
// ============================================================================

function detectQueryAccess(content: string, file: string): DataAccessPoint[] {
  const accessPoints: DataAccessPoint[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {continue;}
    
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || 
        trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Detect various query patterns
    const patterns: Array<{ pattern: RegExp; operation: DataAccessPoint['operation']; isRawSql: boolean }> = [
      { pattern: /\.find\w*\s*\(/i, operation: 'read', isRawSql: false },
      { pattern: /\.get\w*\s*\(/i, operation: 'read', isRawSql: false },
      { pattern: /\.where\s*\(/i, operation: 'read', isRawSql: false },
      { pattern: /\.select\s*\(/i, operation: 'read', isRawSql: false },
      { pattern: /\.filter\s*\(/i, operation: 'read', isRawSql: false },
      { pattern: /\.all\s*\(/i, operation: 'read', isRawSql: false },
      { pattern: /\.objects\./i, operation: 'read', isRawSql: false },
      { pattern: /\.create\s*\(/i, operation: 'write', isRawSql: false },
      { pattern: /\.save\s*\(/i, operation: 'write', isRawSql: false },
      { pattern: /\.update\s*\(/i, operation: 'write', isRawSql: false },
      { pattern: /\.insert\s*\(/i, operation: 'write', isRawSql: false },
      { pattern: /\.delete\s*\(/i, operation: 'delete', isRawSql: false },
      { pattern: /\.remove\s*\(/i, operation: 'delete', isRawSql: false },
      { pattern: /\.destroy\s*\(/i, operation: 'delete', isRawSql: false },
      { pattern: /\bSELECT\b/i, operation: 'read', isRawSql: true },
      { pattern: /\bINSERT\b/i, operation: 'write', isRawSql: true },
      { pattern: /\bUPDATE\b/i, operation: 'write', isRawSql: true },
      { pattern: /\bDELETE\b/i, operation: 'delete', isRawSql: true },
    ];

    for (const { pattern, operation, isRawSql } of patterns) {
      if (pattern.test(line)) {
        // Try to extract table name
        let table = 'unknown';
        
        const fromMatch = line.match(/FROM\s+["'`]?(\w+)["'`]?/i);
        const intoMatch = line.match(/INTO\s+["'`]?(\w+)["'`]?/i);
        const updateMatch = line.match(/UPDATE\s+["'`]?(\w+)["'`]?/i);
        const deleteMatch = line.match(/DELETE\s+FROM\s+["'`]?(\w+)["'`]?/i);
        const modelMatch = line.match(/(\w+)\.find|(\w+)\.create|(\w+)\.update|(\w+)\.delete/i);
        
        if (fromMatch?.[1]) {table = fromMatch[1];}
        else if (intoMatch?.[1]) {table = intoMatch[1];}
        else if (updateMatch?.[1]) {table = updateMatch[1];}
        else if (deleteMatch?.[1]) {table = deleteMatch[1];}
        else if (modelMatch) {
          const matched = modelMatch[1] || modelMatch[2] || modelMatch[3] || modelMatch[4];
          if (matched) {table = matched;}
        }

        const id = `${file}:${i + 1}:0:${table}`;
        
        if (!accessPoints.find(ap => ap.id === id)) {
          accessPoints.push({
            id,
            table,
            fields: [],
            operation,
            file,
            line: i + 1,
            column: 0,
            context: trimmed.slice(0, 100),
            isRawSql,
            confidence: isRawSql ? 0.7 : 0.85,
          });
        }
        break;
      }
    }
  }

  return accessPoints;
}

// ============================================================================
// Boundary Scanner
// ============================================================================

export class BoundaryScanner {
  private config: BoundaryScannerConfig;
  private store: BoundaryStore;

  constructor(config: BoundaryScannerConfig) {
    this.config = config;
    this.store = createBoundaryStore({ rootDir: config.rootDir });
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  async scanFiles(files: string[]): Promise<BoundaryScanResult> {
    const startTime = Date.now();
    
    let filesScanned = 0;
    const allModels: ORMModel[] = [];
    const allAccessPoints: DataAccessPoint[] = [];
    const allSensitiveFields: SensitiveField[] = [];

    for (const file of files) {
      const filePath = path.join(this.config.rootDir, file);
      const language = getLanguage(file);
      
      if (!language && !file.endsWith('.prisma')) {continue;}

      try {
        const content = await fs.readFile(filePath, 'utf-8');

        if (isDataAccessFile(file, content) || file.endsWith('.prisma')) {
          filesScanned++;
          allModels.push(...detectORMModels(content, file));
          allAccessPoints.push(...detectQueryAccess(content, file));
          allSensitiveFields.push(...detectSensitiveFields(content, file));
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error(`Error scanning ${file}:`, (error as Error).message);
        }
      }
    }

    for (const model of allModels) {
      this.store.addModel(model);
    }

    for (const accessPoint of allAccessPoints) {
      this.store.addAccessPoint(accessPoint);
    }

    for (const field of allSensitiveFields) {
      this.store.addSensitiveField(field);
    }

    const accessMap = this.store.getAccessMap();
    await this.store.saveAccessMap(accessMap);

    const violations = this.store.checkAllViolations();
    const duration = Date.now() - startTime;

    return {
      accessMap,
      violations,
      stats: {
        filesScanned,
        tablesFound: Object.keys(accessMap.tables).length,
        accessPointsFound: Object.keys(accessMap.accessPoints).length,
        sensitiveFieldsFound: accessMap.sensitiveFields.length,
        violationsFound: violations.length,
        scanDurationMs: duration,
      },
    };
  }

  getStore(): BoundaryStore {
    return this.store;
  }
}

export function createBoundaryScanner(config: BoundaryScannerConfig): BoundaryScanner {
  return new BoundaryScanner(config);
}
