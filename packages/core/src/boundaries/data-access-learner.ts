/**
 * Data Access Pattern Learner
 *
 * Learns data access patterns from the codebase semantically:
 * 1. First pass: Discover all data access patterns (tables, fields, operations)
 * 2. Build a learned model of how THIS codebase accesses data
 * 3. Use learned patterns for detection, regex as fallback
 *
 * This follows Drift's core philosophy: learn from the user's code,
 * don't enforce hardcoded conventions.
 */

// No imports needed - types are defined locally

// ============================================================================
// Types
// ============================================================================

/**
 * A learned data access pattern from the codebase
 */
export interface LearnedDataAccessPattern {
  /** Pattern identifier */
  id: string;
  /** The table/collection name */
  table: string;
  /** Fields accessed with this table */
  fields: string[];
  /** How the table is typically accessed (ORM method, raw SQL, etc.) */
  accessMethods: string[];
  /** Files where this pattern was found */
  files: string[];
  /** Number of occurrences */
  occurrences: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** The ORM/framework detected */
  framework?: string;
}

/**
 * Learned conventions about how this codebase accesses data
 */
export interface LearnedDataAccessConventions {
  /** All discovered tables/collections */
  tables: Map<string, LearnedDataAccessPattern>;
  /** Table name patterns (e.g., snake_case, camelCase, plural) */
  tableNamingConvention: 'snake_case' | 'camelCase' | 'PascalCase' | 'mixed';
  /** Primary ORM/framework used */
  primaryFramework: string | null;
  /** Common access patterns (e.g., .from(), .query(), Model.find()) */
  accessPatterns: string[];
  /** Variable naming patterns that indicate data access */
  variablePatterns: Map<string, string>; // variable pattern -> likely table
  /** Total files analyzed */
  filesAnalyzed: number;
  /** Whether enough data was found to be confident */
  hasEnoughData: boolean;
}

/**
 * Configuration for the learning process
 */
export interface DataAccessLearningConfig {
  /** Minimum occurrences to consider a pattern established */
  minOccurrences: number;
  /** Minimum files that must contain the pattern */
  minFiles: number;
  /** Minimum confidence to use learned pattern */
  minConfidence: number;
}

export const DEFAULT_DATA_ACCESS_LEARNING_CONFIG: DataAccessLearningConfig = {
  minOccurrences: 2,
  minFiles: 1,
  minConfidence: 0.5,
};

// ============================================================================
// Framework Detection
// ============================================================================

interface FrameworkSignature {
  name: string;
  patterns: RegExp[];
  tableExtractor: (line: string, context: string[]) => string | null;
  fieldExtractor: (line: string) => string[];
  confidence: number;
}

/**
 * Framework signatures - these are detection patterns, not hardcoded table names
 */
const FRAMEWORK_SIGNATURES: FrameworkSignature[] = [
  // Supabase
  {
    name: 'supabase',
    patterns: [
      /supabase/i,
      /\.from\s*\(\s*["'`]/,
      /createClient.*supabase/i,
    ],
    tableExtractor: (line) => {
      const match = line.match(/\.from\s*\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]/);
      return match?.[1] ?? null;
    },
    fieldExtractor: (line) => {
      const fields: string[] = [];
      // .select('field1, field2')
      const selectMatch = line.match(/\.select\s*\(\s*["'`]([^"'`]+)["'`]/);
      if (selectMatch?.[1]) {
        fields.push(...selectMatch[1].split(/\s*,\s*/).filter(f => f && f !== '*'));
      }
      // .eq('field', value)
      const eqMatch = line.match(/\.eq\s*\(\s*["'](\w+)["']/);
      if (eqMatch?.[1]) {fields.push(eqMatch[1]);}
      return fields;
    },
    confidence: 0.95,
  },
  // Prisma
  {
    name: 'prisma',
    patterns: [
      /prisma\./i,
      /@prisma\/client/,
      /PrismaClient/,
    ],
    tableExtractor: (line) => {
      const match = line.match(/prisma\.([a-zA-Z_][a-zA-Z0-9_]*)\./);
      return match?.[1] ?? null;
    },
    fieldExtractor: (line) => {
      const fields: string[] = [];
      // { select: { field: true } }
      const selectMatch = line.match(/select\s*:\s*\{([^}]+)\}/);
      if (selectMatch?.[1]) {
        const fieldMatches = selectMatch[1].matchAll(/(\w+)\s*:/g);
        for (const m of fieldMatches) {
          if (m[1]) {fields.push(m[1]);}
        }
      }
      return fields;
    },
    confidence: 0.95,
  },
  // Django ORM
  {
    name: 'django',
    patterns: [
      /\.objects\./,
      /models\.Model/,
      /from django/,
    ],
    tableExtractor: (line) => {
      const match = line.match(/([A-Z][a-zA-Z0-9]*)\.objects/);
      return match?.[1] ? match[1].toLowerCase() + 's' : null;
    },
    fieldExtractor: (line) => {
      const fields: string[] = [];
      // .values('field1', 'field2')
      const valuesMatch = line.match(/\.values\s*\(([^)]+)\)/);
      if (valuesMatch?.[1]) {
        const fieldMatches = valuesMatch[1].matchAll(/["'](\w+)["']/g);
        for (const m of fieldMatches) {
          if (m[1]) {fields.push(m[1]);}
        }
      }
      // .filter(field=value)
      const filterMatch = line.match(/\.filter\s*\(([^)]+)\)/);
      if (filterMatch?.[1]) {
        const fieldMatches = filterMatch[1].matchAll(/(\w+)\s*=/g);
        for (const m of fieldMatches) {
          if (m[1]) {fields.push(m[1]);}
        }
      }
      return fields;
    },
    confidence: 0.9,
  },
  // SQLAlchemy
  {
    name: 'sqlalchemy',
    patterns: [
      /session\.query/,
      /declarative_base/,
      /from sqlalchemy/,
    ],
    tableExtractor: (line) => {
      const match = line.match(/\.query\s*\(\s*([A-Z][a-zA-Z0-9]*)\s*\)/);
      return match?.[1] ? match[1].toLowerCase() + 's' : null;
    },
    fieldExtractor: () => [],
    confidence: 0.85,
  },
  // TypeORM
  {
    name: 'typeorm',
    patterns: [
      /@Entity/,
      /getRepository/,
      /from ['"]typeorm['"]/,
    ],
    tableExtractor: (line) => {
      const match = line.match(/getRepository\s*\(\s*([A-Z][a-zA-Z0-9]*)\s*\)/);
      return match?.[1] ? match[1].toLowerCase() + 's' : null;
    },
    fieldExtractor: () => [],
    confidence: 0.9,
  },
  // Sequelize
  {
    name: 'sequelize',
    patterns: [
      /sequelize\.define/,
      /Model\.init/,
      /from ['"]sequelize['"]/,
    ],
    tableExtractor: (line) => {
      // Model.findAll(), Model.create()
      const match = line.match(/([A-Z][a-zA-Z0-9]*)\.(?:find|create|update|destroy)/);
      return match?.[1] ? match[1].toLowerCase() + 's' : null;
    },
    fieldExtractor: () => [],
    confidence: 0.85,
  },
  // Mongoose
  {
    name: 'mongoose',
    patterns: [
      /mongoose\.model/,
      /new Schema/,
      /from ['"]mongoose['"]/,
    ],
    tableExtractor: (line) => {
      const match = line.match(/([A-Z][a-zA-Z0-9]*)\.(?:find|findOne|findById|create|save)/);
      return match?.[1] ? match[1].toLowerCase() + 's' : null;
    },
    fieldExtractor: () => [],
    confidence: 0.85,
  },
  // Drizzle
  {
    name: 'drizzle',
    patterns: [
      /drizzle-orm/,
      /\.from\s*\(\s*[a-zA-Z]/,
    ],
    tableExtractor: (line) => {
      const match = line.match(/\.from\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/);
      return match?.[1] ?? null;
    },
    fieldExtractor: () => [],
    confidence: 0.85,
  },
  // Knex
  {
    name: 'knex',
    patterns: [
      /knex\(/,
      /\.table\s*\(/,
      /from ['"]knex['"]/,
    ],
    tableExtractor: (line) => {
      const match = line.match(/\.table\s*\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/);
      if (match?.[1]) {return match[1];}
      const knexMatch = line.match(/knex\s*\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/);
      return knexMatch?.[1] ?? null;
    },
    fieldExtractor: () => [],
    confidence: 0.85,
  },
  // Raw SQL (fallback)
  {
    name: 'raw-sql',
    patterns: [
      /\bSELECT\b/i,
      /\bINSERT\b/i,
      /\bUPDATE\b/i,
      /\bDELETE\b/i,
    ],
    tableExtractor: (line) => {
      const fromMatch = line.match(/FROM\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
      if (fromMatch?.[1]) {return fromMatch[1];}
      const intoMatch = line.match(/INTO\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
      if (intoMatch?.[1]) {return intoMatch[1];}
      const updateMatch = line.match(/UPDATE\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
      if (updateMatch?.[1]) {return updateMatch[1];}
      return null;
    },
    fieldExtractor: () => [],
    confidence: 0.7,
  },
];

// ============================================================================
// Data Access Learner
// ============================================================================

/**
 * Data Access Pattern Learner
 *
 * Learns data access patterns from the codebase semantically.
 */
export class DataAccessLearner {
  private config: DataAccessLearningConfig;
  private conventions: LearnedDataAccessConventions | null = null;
  private tableOccurrences = new Map<string, { files: Set<string>; count: number; methods: Set<string>; fields: Set<string>; framework?: string }>();
  private frameworkCounts = new Map<string, number>();
  private variableToTable = new Map<string, Map<string, number>>(); // variable -> table -> count

  constructor(config: Partial<DataAccessLearningConfig> = {}) {
    this.config = { ...DEFAULT_DATA_ACCESS_LEARNING_CONFIG, ...config };
  }

  /**
   * Learn data access patterns from file content
   */
  learnFromFile(content: string, file: string): void {
    const lines = content.split('\n');

    // Detect which framework(s) this file uses
    const detectedFrameworks = this.detectFrameworks(content);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {continue;}

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') ||
          trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      // Get context (surrounding lines)
      const contextStart = Math.max(0, i - 5);
      const contextEnd = Math.min(lines.length, i + 5);
      const context = lines.slice(contextStart, contextEnd).filter(l => l !== undefined);

      // Try each detected framework's extractor
      for (const framework of detectedFrameworks) {
        const table = framework.tableExtractor(line, context);
        if (table) {
          this.recordTableAccess(table, file, framework.name, framework.fieldExtractor(line));
          
          // Learn variable patterns
          this.learnVariablePattern(line, table);
          break;
        }
      }
    }
  }

  /**
   * Detect which frameworks are used in this file
   */
  private detectFrameworks(content: string): FrameworkSignature[] {
    const detected: FrameworkSignature[] = [];

    for (const framework of FRAMEWORK_SIGNATURES) {
      for (const pattern of framework.patterns) {
        if (pattern.test(content)) {
          detected.push(framework);
          this.frameworkCounts.set(
            framework.name,
            (this.frameworkCounts.get(framework.name) ?? 0) + 1
          );
          break;
        }
      }
    }

    // Always include raw-sql as fallback
    if (!detected.find(f => f.name === 'raw-sql')) {
      const rawSql = FRAMEWORK_SIGNATURES.find(f => f.name === 'raw-sql');
      if (rawSql) {detected.push(rawSql);}
    }

    return detected;
  }

  /**
   * Record a table access occurrence
   */
  private recordTableAccess(table: string, file: string, framework: string, fields: string[]): void {
    const existing = this.tableOccurrences.get(table);
    if (existing) {
      existing.files.add(file);
      existing.count++;
      existing.methods.add(framework);
      for (const field of fields) {
        existing.fields.add(field);
      }
    } else {
      this.tableOccurrences.set(table, {
        files: new Set([file]),
        count: 1,
        methods: new Set([framework]),
        fields: new Set(fields),
        framework,
      });
    }
  }

  /**
   * Learn variable naming patterns that indicate table access
   */
  private learnVariablePattern(line: string, table: string): void {
    // Look for variable assignments near table access
    const varPatterns = [
      /(?:const|let|var)\s+(\w+)\s*=/,
      /(\w+)\s*=\s*(?:await\s+)?/,
      /def\s+(\w+)\s*\(/,
      /function\s+(\w+)\s*\(/,
    ];

    for (const pattern of varPatterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const varName = match[1].toLowerCase();
        // Record this variable -> table association
        if (!this.variableToTable.has(varName)) {
          this.variableToTable.set(varName, new Map());
        }
        const tableMap = this.variableToTable.get(varName)!;
        tableMap.set(table, (tableMap.get(table) ?? 0) + 1);
      }
    }
  }

  /**
   * Finalize learning and build conventions
   */
  finalizeLearning(filesAnalyzed: number): LearnedDataAccessConventions {
    const tables = new Map<string, LearnedDataAccessPattern>();

    // Build learned patterns from occurrences
    for (const [table, data] of this.tableOccurrences) {
      if (data.count >= this.config.minOccurrences && data.files.size >= this.config.minFiles) {
        const pattern: LearnedDataAccessPattern = {
          id: `table:${table}`,
          table,
          fields: Array.from(data.fields),
          accessMethods: Array.from(data.methods),
          files: Array.from(data.files),
          occurrences: data.count,
          confidence: Math.min(1, data.count / 10), // Scale confidence
        };
        if (data.framework) {
          pattern.framework = data.framework;
        }
        tables.set(table, pattern);
      }
    }

    // Determine primary framework
    let primaryFramework: string | null = null;
    let maxCount = 0;
    for (const [framework, count] of this.frameworkCounts) {
      if (count > maxCount && framework !== 'raw-sql') {
        maxCount = count;
        primaryFramework = framework;
      }
    }

    // Determine table naming convention
    const tableNamingConvention = this.detectNamingConvention(Array.from(tables.keys()));

    // Build variable patterns
    const variablePatterns = new Map<string, string>();
    for (const [varName, tableMap] of this.variableToTable) {
      // Find the most common table for this variable
      let bestTable: string | null = null;
      let bestCount = 0;
      for (const [table, count] of tableMap) {
        if (count > bestCount) {
          bestCount = count;
          bestTable = table;
        }
      }
      if (bestTable && bestCount >= 2) {
        variablePatterns.set(varName, bestTable);
      }
    }

    // Collect unique access patterns
    const accessPatterns = new Set<string>();
    for (const data of this.tableOccurrences.values()) {
      for (const method of data.methods) {
        accessPatterns.add(method);
      }
    }

    this.conventions = {
      tables,
      tableNamingConvention,
      primaryFramework,
      accessPatterns: Array.from(accessPatterns),
      variablePatterns,
      filesAnalyzed,
      hasEnoughData: tables.size > 0,
    };

    return this.conventions;
  }

  /**
   * Detect the naming convention used for tables
   */
  private detectNamingConvention(tables: string[]): 'snake_case' | 'camelCase' | 'PascalCase' | 'mixed' {
    let snakeCount = 0;
    let camelCount = 0;
    let pascalCount = 0;

    for (const table of tables) {
      if (table.includes('_')) {snakeCount++;}
      else if (table.length > 0 && table[0] === table[0]?.toLowerCase() && /[A-Z]/.test(table)) {camelCount++;}
      else if (table.length > 0 && table[0] === table[0]?.toUpperCase()) {pascalCount++;}
    }

    const total = tables.length;
    if (snakeCount > total * 0.6) {return 'snake_case';}
    if (camelCount > total * 0.6) {return 'camelCase';}
    if (pascalCount > total * 0.6) {return 'PascalCase';}
    return 'mixed';
  }

  /**
   * Get learned conventions
   */
  getConventions(): LearnedDataAccessConventions | null {
    return this.conventions;
  }

  /**
   * Check if a table was learned
   */
  hasLearnedTable(table: string): boolean {
    return this.conventions?.tables.has(table) ?? false;
  }

  /**
   * Get learned table info
   */
  getLearnedTable(table: string): LearnedDataAccessPattern | undefined {
    return this.conventions?.tables.get(table);
  }

  /**
   * Infer table from variable name using learned patterns
   */
  inferTableFromVariable(varName: string): string | null {
    return this.conventions?.variablePatterns.get(varName.toLowerCase()) ?? null;
  }

  /**
   * Get all learned tables
   */
  getAllLearnedTables(): string[] {
    return this.conventions ? Array.from(this.conventions.tables.keys()) : [];
  }

  /**
   * Reset learner state
   */
  reset(): void {
    this.conventions = null;
    this.tableOccurrences.clear();
    this.frameworkCounts.clear();
    this.variableToTable.clear();
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDataAccessLearner(config?: Partial<DataAccessLearningConfig>): DataAccessLearner {
  return new DataAccessLearner(config);
}
