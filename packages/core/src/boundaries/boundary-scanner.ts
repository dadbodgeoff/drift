/**
 * Boundary Scanner - Detects data access patterns in source code
 *
 * Uses a two-phase approach following Drift's philosophy:
 * 1. LEARN: First pass discovers patterns from YOUR codebase
 * 2. DETECT: Second pass uses learned patterns, regex as fallback
 *
 * This ensures we capture how YOUR code accesses data, not hardcoded assumptions.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import { BoundaryStore, createBoundaryStore } from './boundary-store.js';
import { DataAccessLearner, createDataAccessLearner, type LearnedDataAccessConventions } from './data-access-learner.js';
import {
  extractFieldsFromLine,
  extractModelsFromContent,
} from './field-extractors/index.js';

import type {
  DataAccessPoint,
  ORMModel,
  SensitiveField,
  BoundaryScanResult,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface BoundaryScannerConfig {
  rootDir: string;
  verbose?: boolean;
  /** Skip learning phase and use regex only (not recommended) */
  skipLearning?: boolean;
}

export interface ScanFilesOptions {
  /** File patterns to scan (glob) */
  patterns?: string[];
  /** Directories to ignore */
  ignorePatterns?: string[];
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
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.hpp':
    case '.h':
      return 'cpp';
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

  // ORM patterns for all 8 supported languages
  const ormPatterns = [
    // C# - EF Core, Dapper
    'DbSet', 'DbContext', 'Entity', 'Table', 'Column',
    // Python - Django, SQLAlchemy
    'models.Model', 'CharField', 'ForeignKey', 'ManyToMany',
    'declarative_base', 'relationship',
    // TypeScript/JavaScript - Prisma, TypeORM, Sequelize, Drizzle, Supabase
    'prisma.', '@prisma/client',
    '@Entity', '@Column', 'getRepository',
    'sequelize.define', 'DataTypes',
    'drizzle-orm',
    'supabase', '.from(', '.select(', '.insert(', '.update(',
    // Java - Hibernate, Spring Data, jOOQ, MyBatis
    '@Repository', 'JpaRepository', 'CrudRepository',
    '@Table', '@Id', '@GeneratedValue',
    'DSL.', 'jOOQ',
    '<mapper', '<select', '<insert', '<update',
    // PHP - Eloquent, Doctrine
    'Eloquent', 'hasMany', 'belongsTo',
    '@ORM\\', 'EntityManager',
    // Go - GORM, sqlx, Ent, Bun
    'gorm.Model', 'gorm.DB', 'db.Find', 'db.Create', 'db.Where',
    'sqlx.DB', 'sqlx.Select', 'sqlx.Get',
    'ent.Client', 'entc.', '.Query()',
    'bun.DB', 'bun.NewSelect',
    // Rust - Diesel, SeaORM, sqlx, tokio-postgres
    'diesel::', '#[derive(Queryable)]', '#[table_name',
    'sea_orm::', 'Entity::find', 'ActiveModel',
    'sqlx::query', 'sqlx::FromRow',
    'tokio_postgres::', 'postgres::',
    // C++ - ODB, SOCI, sqlpp11, raw SQL libs
    'odb::', '#pragma db', 'odb::database',
    'soci::', 'soci::session',
    'sqlpp::', 'sqlpp11',
    'pqxx::', 'mysqlpp::', 'sqlite3_',
    // Generic SQL patterns
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM',
    'execute', 'query', 'rawQuery',
  ];

  return ormPatterns.some(pattern => content.includes(pattern));
}

// ============================================================================
// Sensitive Field Detection
// ============================================================================

/**
 * Sensitivity patterns with specificity scores
 * Higher specificity = more confident the match is actually sensitive data
 */
interface SensitivePattern {
  pattern: RegExp;
  specificity: number; // 0.0-1.0, how specific/unambiguous this pattern is
}

const SENSITIVE_PATTERNS: Record<string, SensitivePattern[]> = {
  pii: [
    // High specificity - very likely to be actual sensitive fields
    { pattern: /\bssn\b/i, specificity: 0.95 },
    { pattern: /\bsocial_security(?:_number)?\b/i, specificity: 0.95 },
    { pattern: /\bdate_of_birth\b/i, specificity: 0.9 },
    { pattern: /\bdob\b/i, specificity: 0.85 },
    { pattern: /\bphone_number\b/i, specificity: 0.85 },
    { pattern: /\bfull_name\b/i, specificity: 0.8 },
    { pattern: /\bfirst_name\b/i, specificity: 0.75 },
    { pattern: /\blast_name\b/i, specificity: 0.75 },
    // Lower specificity - could be false positives
    { pattern: /\baddress\b/i, specificity: 0.5 }, // Could be memory address, IP address, etc.
    { pattern: /\bphone\b/i, specificity: 0.6 },
    { pattern: /\bemail\b/i, specificity: 0.65 },
  ],
  credentials: [
    // High specificity
    { pattern: /\bpassword_hash\b/i, specificity: 0.95 },
    { pattern: /\bhashed_password\b/i, specificity: 0.95 },
    { pattern: /\bapi_key\b/i, specificity: 0.9 },
    { pattern: /\bprivate_key\b/i, specificity: 0.9 },
    { pattern: /\bsecret_key\b/i, specificity: 0.9 },
    { pattern: /\brefresh_token\b/i, specificity: 0.9 },
    { pattern: /\baccess_token\b/i, specificity: 0.85 },
    { pattern: /\bauth_token\b/i, specificity: 0.85 },
    // Medium specificity
    { pattern: /\bpassword\b/i, specificity: 0.75 },
    { pattern: /\bsalt\b/i, specificity: 0.7 },
    // Lower specificity - common false positives
    { pattern: /\bsecret\b/i, specificity: 0.5 }, // Could be "secret santa", etc.
    { pattern: /\btoken\b/i, specificity: 0.5 }, // Could be parsing token, etc.
    { pattern: /\bhash\b/i, specificity: 0.4 }, // Could be hash table, URL hash, etc.
  ],
  financial: [
    // High specificity
    { pattern: /\bcredit_card(?:_number)?\b/i, specificity: 0.95 },
    { pattern: /\bcard_number\b/i, specificity: 0.9 },
    { pattern: /\bcvv\b/i, specificity: 0.95 },
    { pattern: /\bbank_account(?:_number)?\b/i, specificity: 0.9 },
    { pattern: /\brouting_number\b/i, specificity: 0.9 },
    { pattern: /\bsalary\b/i, specificity: 0.85 },
    { pattern: /\bincome\b/i, specificity: 0.8 },
    // Lower specificity
    { pattern: /\bpayment\b/i, specificity: 0.5 }, // Could be payment method, payment status
    { pattern: /\bbalance\b/i, specificity: 0.5 }, // Could be load balance, balance check
  ],
  health: [
    // High specificity
    { pattern: /\bdiagnosis\b/i, specificity: 0.9 },
    { pattern: /\bprescription\b/i, specificity: 0.9 },
    { pattern: /\bmedical_record\b/i, specificity: 0.95 },
    { pattern: /\bhealth_record\b/i, specificity: 0.95 },
    // Lower specificity
    { pattern: /\bmedical\b/i, specificity: 0.6 }, // Could be "medical" in comments
    { pattern: /\bhealth\b/i, specificity: 0.5 }, // Could be "health check", "health endpoint"
  ],
};

/**
 * Context indicators that boost confidence (field is likely a real data field)
 */
const FIELD_CONTEXT_PATTERNS = [
  // ORM/Schema definitions
  /Column\s*\(/i,
  /Field\s*\(/i,
  /CharField\s*\(/i,
  /TextField\s*\(/i,
  /IntegerField\s*\(/i,
  /DecimalField\s*\(/i,
  /BooleanField\s*\(/i,
  /ForeignKey\s*\(/i,
  /property\s+/i,
  /@Column/i,
  /@Field/i,
  /DbSet</i,
  // Type annotations suggesting data fields
  /:\s*string\b/i,
  /:\s*number\b/i,
  /:\s*boolean\b/i,
  /:\s*int\b/i,
  /:\s*varchar/i,
  /:\s*text\b/i,
  // Database operations
  /\.select\s*\(/i,
  /\.insert\s*\(/i,
  /\.update\s*\(/i,
  /\.where\s*\(/i,
  /\.eq\s*\(/i,
  // Object property definitions
  /^\s*\w+\s*:/,
  /^\s*['"]?\w+['"]?\s*:/,
];

/**
 * Context indicators that reduce confidence (likely not a real sensitive field)
 */
const FALSE_POSITIVE_PATTERNS = [
  // Variable names that happen to contain sensitive words
  /(?:get|set|is|has|check|validate|verify|update|create|delete|fetch|load|save|find|parse|format|render|display|show|hide|toggle|enable|disable)(?:Password|Email|Phone|Address|Token|Secret|Hash)/i,
  // Function/method names
  /function\s+\w*(?:password|email|phone|address|token|secret|hash)\w*\s*\(/i,
  /(?:async\s+)?(?:function|const|let|var)\s+\w*(?:Password|Email|Phone|Address|Token|Secret|Hash)\w*\s*[=:]/i,
  // Import/require statements
  /(?:import|require|from)\s+.*(?:password|email|phone|address|token|secret|hash)/i,
  // Comments (inline)
  /\/\/.*(?:password|email|phone|address|token|secret|hash)/i,
  /\/\*.*(?:password|email|phone|address|token|secret|hash)/i,
  /#.*(?:password|email|phone|address|token|secret|hash)/i,
  // String literals in logs/messages (not actual field access)
  /(?:log|console|print|error|warn|info|debug)\s*\(.*['"].*(?:password|email|phone|address|token|secret|hash)/i,
  /['"].*(?:password|email|phone|address|token|secret|hash).*['"]/i,
  // Test/mock data indicators
  /(?:mock|fake|test|dummy|sample|example)(?:Password|Email|Phone|Address|Token|Secret|Hash)/i,
  // URL/path patterns
  /\/(?:password|email|phone|address|token|secret|hash)\//i,
  // Health check endpoints (not health data)
  /health[_-]?check/i,
  /health[_-]?endpoint/i,
  /health[_-]?status/i,
  // Load balancer patterns
  /load[_-]?balance/i,
];

/**
 * Check if a line is inside a comment block
 */
function isInCommentBlock(lines: string[], lineIndex: number): boolean {
  let inBlockComment = false;
  
  for (let i = 0; i <= lineIndex; i++) {
    const line = lines[i] ?? '';
    
    // Check for block comment start/end
    if (line.includes('/*') && !line.includes('*/')) {
      inBlockComment = true;
    } else if (line.includes('*/')) {
      inBlockComment = false;
    }
    
    // Handle single-line block comments
    if (line.includes('/*') && line.includes('*/')) {
      // Check if the comment spans the whole line
      const commentStart = line.indexOf('/*');
      const commentEnd = line.indexOf('*/');
      if (commentStart === 0 && commentEnd === line.length - 2) {
        continue; // This line is a complete block comment
      }
    }
  }
  
  return inBlockComment;
}

/**
 * Calculate confidence score for a sensitive field detection
 */
function calculateSensitiveFieldConfidence(
  line: string,
  patternSpecificity: number,
  hasFieldContext: boolean,
  hasFalsePositiveIndicator: boolean
): number {
  let confidence = patternSpecificity;
  
  // Boost confidence if we have field context
  if (hasFieldContext) {
    confidence = Math.min(1.0, confidence + 0.15);
  }
  
  // Reduce confidence for false positive indicators
  if (hasFalsePositiveIndicator) {
    confidence = Math.max(0.1, confidence - 0.4);
  }
  
  // Reduce confidence for very short lines (likely not real field definitions)
  if (line.trim().length < 10) {
    confidence = Math.max(0.1, confidence - 0.2);
  }
  
  return Math.round(confidence * 100) / 100; // Round to 2 decimal places
}

function detectSensitiveFields(content: string, file: string): SensitiveField[] {
  const fields: SensitiveField[] = [];
  const lines = content.split('\n');
  const seenFields = new Set<string>(); // Deduplicate by field+line

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {continue;}
    
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) {continue;}
    
    // Skip single-line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || 
        trimmed.startsWith('*') || trimmed.startsWith('/*') ||
        trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      continue;
    }
    
    // Skip if inside a block comment
    if (isInCommentBlock(lines, i)) {
      continue;
    }

    // Check for field context (boosts confidence)
    const hasFieldContext = FIELD_CONTEXT_PATTERNS.some(p => p.test(line));
    
    // Check for false positive indicators (reduces confidence)
    const hasFalsePositiveIndicator = FALSE_POSITIVE_PATTERNS.some(p => p.test(line));

    for (const [type, patterns] of Object.entries(SENSITIVE_PATTERNS)) {
      for (const { pattern, specificity } of patterns) {
        const match = line.match(pattern);
        if (match) {
          const fieldKey = `${match[0].toLowerCase()}:${i + 1}`;
          
          // Skip duplicates
          if (seenFields.has(fieldKey)) {continue;}
          
          // Calculate confidence
          const confidence = calculateSensitiveFieldConfidence(
            line,
            specificity,
            hasFieldContext,
            hasFalsePositiveIndicator
          );
          
          // Skip low-confidence detections (below 0.5 threshold)
          if (confidence < 0.5) {continue;}
          
          // Try to extract table name from context
          let table: string | null = null;
          
          // Look for class/model name in surrounding lines
          for (let j = Math.max(0, i - 10); j < i; j++) {
            const prevLine = lines[j];
            if (!prevLine) {continue;}
            
            const classMatch = prevLine.match(/class\s+(\w+)/);
            const modelMatch = prevLine.match(/model\s+(\w+)/);
            const tableMatch = prevLine.match(/Table\s*\(\s*["'](\w+)["']/);
            const fromMatch = prevLine.match(/\.from\s*\(\s*["'](\w+)["']/);
            
            if (classMatch?.[1]) {table = classMatch[1];}
            if (modelMatch?.[1]) {table = modelMatch[1];}
            if (tableMatch?.[1]) {table = tableMatch[1];}
            if (fromMatch?.[1]) {table = fromMatch[1];}
          }

          seenFields.add(fieldKey);
          fields.push({
            field: match[0],
            table,
            sensitivityType: type as SensitiveField['sensitivityType'],
            file,
            line: i + 1,
            confidence,
          });
          break; // Only match one pattern per type per line
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
  const language = getLanguage(file) ?? 'unknown';
  
  // First, try the new field extractors for model detection
  const extractedModels = extractModelsFromContent(content, language);
  for (const em of extractedModels) {
    models.push({
      name: em.modelName,
      tableName: em.tableName ?? em.modelName.toLowerCase() + 's',
      fields: em.fields.map(f => f.name),
      file,
      line: em.startLine,
      framework: em.framework,
      confidence: 0.95,
    });
  }
  
  // If we found models from extractors, return them
  if (models.length > 0) {
    return models;
  }

  // Fallback to regex-based detection for frameworks not yet covered by extractors
  
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

  // Detect SQLAlchemy models
  const sqlalchemyPattern = /class\s+(\w+)\s*\([^)]*(?:Base|DeclarativeBase)[^)]*\)/g;
  while ((match = sqlalchemyPattern.exec(content)) !== null) {
    const modelName = match[1];
    if (modelName) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      models.push({
        name: modelName,
        tableName: modelName.toLowerCase() + 's',
        fields: [],
        file,
        line: lineNum,
        framework: 'sqlalchemy',
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
  
  // Detect GORM models (Go)
  const gormPattern = /type\s+(\w+)\s+struct\s*\{[^}]*gorm\.Model/g;
  while ((match = gormPattern.exec(content)) !== null) {
    const modelName = match[1];
    if (modelName) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      models.push({
        name: modelName,
        tableName: toSnakeCase(modelName) + 's',
        fields: [],
        file,
        line: lineNum,
        framework: 'gorm',
        confidence: 0.9,
      });
    }
  }
  
  // Detect Diesel models (Rust)
  const dieselPattern = /#\[derive\([^\]]*Queryable[^\]]*\)\]\s*(?:pub\s+)?struct\s+(\w+)/g;
  while ((match = dieselPattern.exec(content)) !== null) {
    const modelName = match[1];
    if (modelName) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      models.push({
        name: modelName,
        tableName: toSnakeCase(modelName) + 's',
        fields: [],
        file,
        line: lineNum,
        framework: 'diesel',
        confidence: 0.9,
      });
    }
  }

  return models;
}

/**
 * Convert PascalCase to snake_case
 */
function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

// ============================================================================
// Query Access Detection
// ============================================================================

/**
 * Common table name patterns - helps identify tables from variable names
 * Maps common suffixes/patterns to likely table names
 */
const TABLE_NAME_HINTS: Record<string, string> = {
  // User-related
  'user': 'users',
  'users': 'users',
  'account': 'accounts',
  'accounts': 'accounts',
  'profile': 'profiles',
  'profiles': 'profiles',
  'auth': 'auth',
  'session': 'sessions',
  'sessions': 'sessions',
  'token': 'tokens',
  'tokens': 'tokens',
  // Content
  'post': 'posts',
  'posts': 'posts',
  'comment': 'comments',
  'comments': 'comments',
  'article': 'articles',
  'articles': 'articles',
  'document': 'documents',
  'documents': 'documents',
  'file': 'files',
  'files': 'files',
  'image': 'images',
  'images': 'images',
  'media': 'media',
  // E-commerce
  'order': 'orders',
  'orders': 'orders',
  'product': 'products',
  'products': 'products',
  'cart': 'carts',
  'carts': 'carts',
  'item': 'items',
  'items': 'items',
  'payment': 'payments',
  'payments': 'payments',
  'transaction': 'transactions',
  'transactions': 'transactions',
  'invoice': 'invoices',
  'invoices': 'invoices',
  // Organization
  'company': 'companies',
  'companies': 'companies',
  'organization': 'organizations',
  'organizations': 'organizations',
  'team': 'teams',
  'teams': 'teams',
  'member': 'members',
  'members': 'members',
  'role': 'roles',
  'roles': 'roles',
  'permission': 'permissions',
  'permissions': 'permissions',
  // Communication
  'message': 'messages',
  'messages': 'messages',
  'notification': 'notifications',
  'notifications': 'notifications',
  'email': 'emails',
  'emails': 'emails',
  // Analytics
  'event': 'events',
  'events': 'events',
  'log': 'logs',
  'logs': 'logs',
  'audit': 'audit_logs',
  'metric': 'metrics',
  'metrics': 'metrics',
  // Settings
  'setting': 'settings',
  'settings': 'settings',
  'config': 'configs',
  'preference': 'preferences',
  'preferences': 'preferences',
  // Relationships
  'subscription': 'subscriptions',
  'subscriptions': 'subscriptions',
  'follower': 'followers',
  'followers': 'followers',
  'friend': 'friends',
  'friends': 'friends',
  'connection': 'connections',
  'connections': 'connections',
  // Generic
  'record': 'records',
  'records': 'records',
  'entry': 'entries',
  'entries': 'entries',
  'data': 'data',
  'result': 'results',
  'results': 'results',
};

/**
 * Common field patterns for different data types
 */
const COMMON_FIELD_PATTERNS: Array<{ pattern: RegExp; fields: string[] }> = [
  // ID fields
  { pattern: /\bid\b/i, fields: ['id'] },
  { pattern: /\buser_id\b/i, fields: ['user_id'] },
  { pattern: /\baccount_id\b/i, fields: ['account_id'] },
  { pattern: /\borganization_id\b/i, fields: ['organization_id'] },
  // Timestamps
  { pattern: /\bcreated_at\b/i, fields: ['created_at'] },
  { pattern: /\bupdated_at\b/i, fields: ['updated_at'] },
  { pattern: /\bdeleted_at\b/i, fields: ['deleted_at'] },
  // User fields
  { pattern: /\bemail\b/i, fields: ['email'] },
  { pattern: /\busername\b/i, fields: ['username'] },
  { pattern: /\bpassword\b/i, fields: ['password'] },
  { pattern: /\bname\b/i, fields: ['name'] },
  { pattern: /\bfirst_name\b/i, fields: ['first_name'] },
  { pattern: /\blast_name\b/i, fields: ['last_name'] },
  { pattern: /\bphone\b/i, fields: ['phone'] },
  { pattern: /\baddress\b/i, fields: ['address'] },
  // Status fields
  { pattern: /\bstatus\b/i, fields: ['status'] },
  { pattern: /\bstate\b/i, fields: ['state'] },
  { pattern: /\bactive\b/i, fields: ['active'] },
  { pattern: /\benabled\b/i, fields: ['enabled'] },
  // Content fields
  { pattern: /\btitle\b/i, fields: ['title'] },
  { pattern: /\bdescription\b/i, fields: ['description'] },
  { pattern: /\bcontent\b/i, fields: ['content'] },
  { pattern: /\bbody\b/i, fields: ['body'] },
  // Financial
  { pattern: /\bamount\b/i, fields: ['amount'] },
  { pattern: /\bprice\b/i, fields: ['price'] },
  { pattern: /\btotal\b/i, fields: ['total'] },
  { pattern: /\bbalance\b/i, fields: ['balance'] },
];

/**
 * Extract table name from a line of code using multiple strategies
 */
function extractTableName(line: string, context: string[]): string {
  // Strategy 1: Supabase .from('table_name')
  const supabaseFrom = line.match(/\.from\s*\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/i);
  if (supabaseFrom?.[1]) {return supabaseFrom[1];}

  // Strategy 2: Supabase with template literal .from(`table_name`)
  const supabaseTemplate = line.match(/\.from\s*\(\s*`([a-zA-Z_][a-zA-Z0-9_]*)`/i);
  if (supabaseTemplate?.[1]) {return supabaseTemplate[1];}

  // Strategy 3: Prisma prisma.tableName.
  const prisma = line.match(/prisma\.([a-zA-Z_][a-zA-Z0-9_]*)\./i);
  if (prisma?.[1]) {return prisma[1];}

  // Strategy 4: Drizzle db.select().from(tableName) or db.insert(tableName)
  const drizzleFrom = line.match(/\.from\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/i);
  if (drizzleFrom?.[1] && !drizzleFrom[1].startsWith('"') && !drizzleFrom[1].startsWith("'")) {
    const hint = TABLE_NAME_HINTS[drizzleFrom[1].toLowerCase()];
    if (hint) {return hint;}
    return drizzleFrom[1];
  }

  // Strategy 5: SQL FROM clause
  const sqlFrom = line.match(/FROM\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
  if (sqlFrom?.[1]) {return sqlFrom[1];}

  // Strategy 6: SQL INTO clause
  const sqlInto = line.match(/INTO\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
  if (sqlInto?.[1]) {return sqlInto[1];}

  // Strategy 7: SQL UPDATE clause
  const sqlUpdate = line.match(/UPDATE\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
  if (sqlUpdate?.[1]) {return sqlUpdate[1];}

  // Strategy 8: SQL DELETE FROM clause
  const sqlDelete = line.match(/DELETE\s+FROM\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
  if (sqlDelete?.[1]) {return sqlDelete[1];}

  // Strategy 9: Django Model.objects
  const djangoModel = line.match(/([A-Z][a-zA-Z0-9]*)\.objects/);
  if (djangoModel?.[1]) {return djangoModel[1].toLowerCase() + 's';}

  // Strategy 10: SQLAlchemy session.query(Model)
  const sqlalchemyQuery = line.match(/\.query\s*\(\s*([A-Z][a-zA-Z0-9]*)\s*\)/);
  if (sqlalchemyQuery?.[1]) {return sqlalchemyQuery[1].toLowerCase() + 's';}

  // Strategy 11: TypeORM getRepository(Entity)
  const typeormRepo = line.match(/getRepository\s*\(\s*([A-Z][a-zA-Z0-9]*)\s*\)/);
  if (typeormRepo?.[1]) {return typeormRepo[1].toLowerCase() + 's';}

  // Strategy 12: Sequelize Model.findAll/create/etc
  const sequelizeModel = line.match(/([A-Z][a-zA-Z0-9]*)\.(?:find|create|update|destroy|bulkCreate)/);
  if (sequelizeModel?.[1]) {return sequelizeModel[1].toLowerCase() + 's';}

  // Strategy 13: Mongoose Model.find/save/etc
  const mongooseModel = line.match(/([A-Z][a-zA-Z0-9]*)\.(?:find|findOne|findById|create|save|updateOne|deleteOne)/);
  if (mongooseModel?.[1]) {return mongooseModel[1].toLowerCase() + 's';}

  // Strategy 14: Knex table('name')
  const knexTable = line.match(/\.table\s*\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/i);
  if (knexTable?.[1]) {return knexTable[1];}

  // Strategy 15: Generic ORM pattern - look for variable assignment with table hint
  const varAssignment = line.match(/(?:const|let|var)\s+(\w+)\s*=.*\.(?:from|table|query)/i);
  if (varAssignment?.[1]) {
    const hint = TABLE_NAME_HINTS[varAssignment[1].toLowerCase()];
    if (hint) {return hint;}
  }

  // Strategy 16: Look in surrounding context for table hints
  for (const ctxLine of context) {
    const tableHint = ctxLine.match(/table\s*[=:]\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/i);
    if (tableHint?.[1]) {return tableHint[1];}
    
    const collectionHint = ctxLine.match(/collection\s*[=:]\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/i);
    if (collectionHint?.[1]) {return collectionHint[1];}
  }

  // Strategy 17: Infer from common variable names in the line
  for (const [hint, table] of Object.entries(TABLE_NAME_HINTS)) {
    const varPattern = new RegExp(`\\b${hint}(?:s|Data|Result|Response|Query)?\\b`, 'i');
    if (varPattern.test(line)) {
      return table;
    }
  }

  return 'unknown';
}

/**
 * Extract field names from a line of code using framework-specific extractors
 * 
 * This is a wrapper that uses the new field extractor system while maintaining
 * backward compatibility with the existing API.
 */
function extractFields(line: string, content?: string, language?: string): string[] {
  // If we have content and language, use the new extractors
  if (content && language) {
    const result = extractFieldsFromLine(line, [], 0, content, language);
    return result.fields.map(f => f.name);
  }
  
  // Fallback to basic extraction for backward compatibility
  const fields: string[] = [];

  // Extract from .select('field1, field2')
  const selectMatch = line.match(/\.select\s*\(\s*["'`]([^"'`]+)["'`]/i);
  if (selectMatch?.[1]) {
    const selectFields = selectMatch[1].split(/\s*,\s*/);
    fields.push(...selectFields.map(f => f.trim()).filter(f => f && f !== '*'));
  }

  // Extract from .eq('field', value) or .match({ field: value })
  const eqMatch = line.match(/\.eq\s*\(\s*["'](\w+)["']/i);
  if (eqMatch?.[1]) {fields.push(eqMatch[1]);}

  // Extract from object keys in .insert({ field: value })
  const insertMatch = line.match(/\.(?:insert|update|upsert)\s*\(\s*\{([^}]+)\}/i);
  if (insertMatch?.[1]) {
    const keyMatches = insertMatch[1].matchAll(/(\w+)\s*:/g);
    for (const m of keyMatches) {
      if (m[1]) {fields.push(m[1]);}
    }
  }

  // Extract common fields from patterns
  for (const { pattern, fields: patternFields } of COMMON_FIELD_PATTERNS) {
    if (pattern.test(line)) {
      fields.push(...patternFields);
    }
  }

  // Deduplicate
  return [...new Set(fields)];
}

// ============================================================================
// Boundary Scanner Class
// ============================================================================

/**
 * Boundary Scanner - Scans source files for data access patterns
 *
 * Uses a two-phase approach:
 * 1. LEARN: First pass discovers patterns from the codebase
 * 2. DETECT: Second pass uses learned patterns + regex fallback
 */
export class BoundaryScanner {
  private config: BoundaryScannerConfig;
  private store: BoundaryStore;
  private learner: DataAccessLearner;
  private learnedConventions: LearnedDataAccessConventions | null = null;

  constructor(config: BoundaryScannerConfig) {
    this.config = config;
    this.store = createBoundaryStore({ rootDir: config.rootDir });
    this.learner = createDataAccessLearner();
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Scan files for data access patterns using learning approach
   */
  async scanFiles(files: string[]): Promise<BoundaryScanResult> {
    const startTime = Date.now();
    
    let filesScanned = 0;
    const allModels: ORMModel[] = [];
    const allAccessPoints: DataAccessPoint[] = [];
    const allSensitiveFields: SensitiveField[] = [];

    // Reset learner for fresh scan
    this.learner.reset();

    // ========================================================================
    // PHASE 1: LEARN - Discover patterns from the codebase
    // ========================================================================
    if (!this.config.skipLearning) {
      if (this.config.verbose) {
        console.log('Phase 1: Learning data access patterns from codebase...');
      }

      for (const file of files) {
        const filePath = path.join(this.config.rootDir, file);
        const language = getLanguage(file);
        
        if (!language && !file.endsWith('.prisma')) {continue;}

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          if (isDataAccessFile(file, content) || file.endsWith('.prisma')) {
            this.learner.learnFromFile(content, file);
          }
        } catch {
          // Skip files that can't be read during learning
        }
      }

      // Finalize learning
      this.learnedConventions = this.learner.finalizeLearning(files.length);

      if (this.config.verbose) {
        console.log(`  Learned ${this.learnedConventions.tables.size} tables`);
        console.log(`  Primary framework: ${this.learnedConventions.primaryFramework ?? 'mixed'}`);
        console.log(`  Naming convention: ${this.learnedConventions.tableNamingConvention}`);
      }
    }

    // ========================================================================
    // PHASE 2: DETECT - Use learned patterns + regex fallback
    // ========================================================================
    if (this.config.verbose) {
      console.log('Phase 2: Detecting data access with learned patterns...');
    }

    for (const file of files) {
      const filePath = path.join(this.config.rootDir, file);
      const language = getLanguage(file);
      
      if (!language && !file.endsWith('.prisma')) {continue;}

      try {
        const content = await fs.readFile(filePath, 'utf-8');

        if (isDataAccessFile(file, content) || file.endsWith('.prisma')) {
          filesScanned++;
          allModels.push(...detectORMModels(content, file));
          
          // Use learned patterns for detection, with regex fallback
          const accessPoints = this.detectWithLearning(content, file);
          allAccessPoints.push(...accessPoints);
          
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

  /**
   * Detect data access using learned patterns first, regex as fallback
   */
  private detectWithLearning(content: string, file: string): DataAccessPoint[] {
    const accessPoints: DataAccessPoint[] = [];
    const lines = content.split('\n');
    const language = getLanguage(file) ?? 'unknown';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {continue;}
      
      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || 
          trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      // Get surrounding context
      const contextStart = Math.max(0, i - 5);
      const contextEnd = Math.min(lines.length, i + 5);
      const context = lines.slice(contextStart, contextEnd).filter(l => l !== undefined);

      // Check if this line has a data access pattern
      const operation = this.detectOperation(line);
      if (!operation) {continue;}

      // Try to extract table name using multiple strategies
      let table = 'unknown';
      let confidence = 0.5;

      // Strategy 1: Use learned patterns (highest confidence)
      if (this.learnedConventions?.hasEnoughData) {
        const learnedTable = this.extractTableWithLearning(line, context);
        if (learnedTable) {
          table = learnedTable;
          confidence = 0.95; // High confidence for learned patterns
        }
      }

      // Strategy 2: Regex fallback (lower confidence)
      if (table === 'unknown') {
        table = extractTableName(line, context);
        confidence = table === 'unknown' ? 0.3 : 0.7;
      }

      // Use new field extractors for better field detection
      const fieldResult = extractFieldsFromLine(line, context, i + 1, content, language);
      const fields = fieldResult.fields.length > 0 
        ? fieldResult.fields.map(f => f.name)
        : extractFields(line); // Fallback to basic extraction
      
      // Use table from field extractor if we didn't find one
      if (table === 'unknown' && fieldResult.table) {
        table = fieldResult.table;
        confidence = 0.8;
      }
      
      const id = `${file}:${i + 1}:0:${table}`;
      
      if (!accessPoints.find(ap => ap.id === id)) {
        const accessPoint: DataAccessPoint = {
          id,
          table,
          fields,
          operation,
          file,
          line: i + 1,
          column: 0,
          context: trimmed.slice(0, 100),
          isRawSql: /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line),
          confidence,
        };
        if (fieldResult.framework) {
          accessPoint.framework = fieldResult.framework;
        }
        accessPoints.push(accessPoint);
      }
    }

    return accessPoints;
  }

  /**
   * Extract table name using learned patterns
   */
  private extractTableWithLearning(line: string, context: string[]): string | null {
    if (!this.learnedConventions) {return null;}

    // Check if any learned table pattern matches
    for (const [tableName] of this.learnedConventions.tables) {
      // Check if the table name appears in the line
      const tableRegex = new RegExp(`['"\`]${tableName}['"\`]|\\b${tableName}\\b`, 'i');
      if (tableRegex.test(line)) {
        return tableName;
      }
    }

    // Try to infer from variable names
    const varMatch = line.match(/(?:const|let|var)\s+(\w+)|(\w+)\s*=\s*(?:await\s+)?/);
    if (varMatch) {
      const varName = (varMatch[1] || varMatch[2])?.toLowerCase();
      if (varName) {
        const inferredTable = this.learner.inferTableFromVariable(varName);
        if (inferredTable) {return inferredTable;}
      }
    }

    // Check context for learned tables
    for (const ctxLine of context) {
      for (const [tableName] of this.learnedConventions.tables) {
        const tableRegex = new RegExp(`['"\`]${tableName}['"\`]`, 'i');
        if (tableRegex.test(ctxLine)) {
          return tableName;
        }
      }
    }

    return null;
  }

  /**
   * Detect the operation type from a line
   */
  private detectOperation(line: string): DataAccessPoint['operation'] | null {
    // Read operations
    if (/\.find\w*\s*\(|\.get\w*\s*\(|\.where\s*\(|\.select\s*\(|\.filter\s*\(|\.all\s*\(|\.objects\.|\.query\s*\(|\.from\s*\(|\bSELECT\b/i.test(line)) {
      return 'read';
    }
    // Write operations
    if (/\.create\s*\(|\.save\s*\(|\.update\s*\(|\.insert\s*\(|\.upsert\s*\(|\bINSERT\b|\bUPDATE\b/i.test(line)) {
      return 'write';
    }
    // Delete operations
    if (/\.delete\s*\(|\.remove\s*\(|\.destroy\s*\(|\bDELETE\b/i.test(line)) {
      return 'delete';
    }
    return null;
  }

  /**
   * Scan directory with glob patterns
   */
  async scanDirectory(options: ScanFilesOptions = {}): Promise<BoundaryScanResult> {
    const patterns = options.patterns ?? [
      // TypeScript/JavaScript
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      // Python
      '**/*.py',
      // C#
      '**/*.cs',
      // PHP
      '**/*.php',
      // Java
      '**/*.java',
      // Go
      '**/*.go',
      // Rust
      '**/*.rs',
      // C++
      '**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp',
      // Schema files
      '**/*.prisma',
    ];
    const ignorePatterns = options.ignorePatterns ?? [
      'node_modules', '.git', 'dist', 'build', '__pycache__', '.drift',
      'vendor', 'target', 'bin', 'obj', 'out',
    ];
    
    const files = await this.findFiles(patterns, ignorePatterns);
    return this.scanFiles(files);
  }

  /**
   * Get learned conventions (for debugging/inspection)
   */
  getLearnedConventions(): LearnedDataAccessConventions | null {
    return this.learnedConventions;
  }

  /**
   * Get the underlying store
   */
  getStore(): BoundaryStore {
    return this.store;
  }

  /**
   * Find files matching patterns
   */
  private async findFiles(patterns: string[], ignorePatterns: string[]): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (!ignorePatterns.includes(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (minimatch(relPath, pattern)) {
              files.push(relPath);
              break;
            }
          }
        }
      }
    };

    await walk(this.config.rootDir);
    return files;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new BoundaryScanner instance
 */
export function createBoundaryScanner(config: BoundaryScannerConfig): BoundaryScanner {
  return new BoundaryScanner(config);
}
