/**
 * Sensitive Data Coverage Analyzer
 *
 * Answers: "Which access paths to sensitive data are covered by tests?"
 * 
 * Cross-references the call graph with test files to determine:
 * - Which functions that access sensitive data are tested
 * - Which access paths from entry points to sensitive data are covered
 * - Coverage gaps for sensitive fields
 */

import type { DataAccessPoint, SensitivityType } from '../../boundaries/types.js';
import type {
  CallGraph,
  CallPathNode,
} from '../types.js';
import {
  isNativeAvailable,
  isCallGraphAvailable,
  getCallGraphCallers,
} from '../../native/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Coverage status for a sensitive field
 */
export type CoverageStatus = 'covered' | 'partial' | 'uncovered';

/**
 * An access path to sensitive data
 */
export interface SensitiveAccessPath {
  /** Unique path ID */
  id: string;
  /** The sensitive field being accessed */
  field: string;
  /** Table containing the field */
  table: string;
  /** Sensitivity classification */
  sensitivity: SensitivityType;
  /** Entry point that can reach this data */
  entryPoint: {
    id: string;
    name: string;
    file: string;
    line: number;
  };
  /** Function that directly accesses the data */
  accessor: {
    id: string;
    name: string;
    file: string;
    line: number;
  };
  /** Call path from entry point to accessor */
  path: CallPathNode[];
  /** Depth of the path */
  depth: number;
  /** Is this path covered by tests? */
  isTested: boolean;
  /** Test files that cover this path */
  testFiles: string[];
}

/**
 * Coverage information for a sensitive field
 */
export interface FieldCoverage {
  /** Field name (e.g., "password_hash") */
  field: string;
  /** Table name (e.g., "users") */
  table: string;
  /** Full field identifier (e.g., "users.password_hash") */
  fullName: string;
  /** Sensitivity classification */
  sensitivity: SensitivityType;
  /** Total access paths to this field */
  totalPaths: number;
  /** Number of tested paths */
  testedPaths: number;
  /** Coverage percentage */
  coveragePercent: number;
  /** Coverage status */
  status: CoverageStatus;
  /** All access paths */
  paths: SensitiveAccessPath[];
}

/**
 * Complete coverage analysis result
 */
export interface CoverageAnalysisResult {
  /** Summary statistics */
  summary: {
    totalSensitiveFields: number;
    totalAccessPaths: number;
    testedAccessPaths: number;
    coveragePercent: number;
    bySensitivity: Record<SensitivityType, {
      fields: number;
      paths: number;
      testedPaths: number;
      coveragePercent: number;
    }>;
  };
  /** Coverage by field */
  fields: FieldCoverage[];
  /** Uncovered paths (highest priority) */
  uncoveredPaths: SensitiveAccessPath[];
  /** Test files analyzed */
  testFiles: string[];
  /** Functions in test files */
  testFunctions: number;
}

/**
 * Custom sensitivity pattern configuration
 */
export interface SensitivityPatternConfig {
  /** Pattern name for display */
  name: string;
  /** Regex patterns to match table/field names */
  patterns: string[];
  /** Sensitivity type to assign */
  sensitivity: SensitivityType;
  /** Priority (lower = higher priority, checked first) */
  priority?: number;
}

/**
 * Options for coverage analysis
 */
export interface CoverageAnalysisOptions {
  /** Test file patterns (default: common test patterns) */
  testPatterns?: RegExp[];
  /** Custom sensitivity patterns (merged with defaults) */
  sensitivityPatterns?: SensitivityPatternConfig[];
  /** Replace default sensitivity patterns entirely */
  replaceSensitivityPatterns?: boolean;
  /** Minimum sensitivity to include (default: all) */
  minSensitivity?: SensitivityType;
  /** Maximum path depth (default: 10) */
  maxDepth?: number;
  /** Include partial coverage details */
  includePartial?: boolean;
}

// ============================================================================
// Coverage Analyzer
// ============================================================================

/**
 * Analyzes test coverage for sensitive data access paths
 */
export class CoverageAnalyzer {
  private graph: CallGraph;
  private entryPointSet: Set<string>;
  private testFunctions: Set<string>;
  private testFiles: Set<string>;
  private testedFunctions: Set<string>;
  private sensitivityPatterns: SensitivityPatternConfig[];
  private useNativeQueries: boolean;
  private projectRoot: string | undefined;

  constructor(graph: CallGraph) {
    this.graph = graph;
    this.entryPointSet = new Set(graph.entryPoints);
    this.testFunctions = new Set();
    this.testFiles = new Set();
    this.testedFunctions = new Set();
    this.sensitivityPatterns = this.getDefaultSensitivityPatterns();
    
    // Check if we should use native SQLite queries
    this.projectRoot = graph.projectRoot;
    const isSqliteMode = (graph as { _sqliteAvailable?: boolean })._sqliteAvailable === true;
    this.useNativeQueries = isSqliteMode && 
                            !!this.projectRoot && 
                            isNativeAvailable() && 
                            isCallGraphAvailable(this.projectRoot);
  }

  /**
   * Get callers for a function (using native query if available)
   */
  private getCallers(funcId: string, funcName: string): Array<{ callerId: string }> {
    const func = this.graph.functions.get(funcId);
    
    // If calledBy is populated, use it
    if (func && func.calledBy.length > 0) {
      return func.calledBy;
    }
    
    // If using native queries, check SQLite
    if (this.useNativeQueries && this.projectRoot) {
      const callers = getCallGraphCallers(this.projectRoot, funcName);
      return callers.map(c => ({ callerId: c.callerId }));
    }
    
    return func?.calledBy ?? [];
  }

  /**
   * Analyze coverage for sensitive data access
   */
  analyze(options: CoverageAnalysisOptions = {}): CoverageAnalysisResult {
    const {
      testPatterns = this.getDefaultTestPatterns(),
      sensitivityPatterns,
      replaceSensitivityPatterns = false,
      maxDepth = 10,
    } = options;

    // Configure sensitivity patterns
    if (sensitivityPatterns) {
      if (replaceSensitivityPatterns) {
        this.sensitivityPatterns = sensitivityPatterns;
      } else {
        // Merge custom patterns with defaults (custom takes priority)
        this.sensitivityPatterns = [
          ...sensitivityPatterns,
          ...this.getDefaultSensitivityPatterns(),
        ];
      }
    }

    // Sort by priority
    this.sensitivityPatterns.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    // Step 1: Identify test files and functions
    this.identifyTestCode(testPatterns);

    // Step 2: Find all functions called by tests (directly or transitively)
    this.findTestedFunctions();

    // Step 3: Find all sensitive data access points
    const sensitiveAccess = this.findSensitiveAccess();

    // Step 4: Build access paths from entry points to sensitive data
    const accessPaths = this.buildAccessPaths(sensitiveAccess, maxDepth);

    // Step 5: Determine which paths are tested
    this.markTestedPaths(accessPaths);

    // Step 6: Group by field and calculate coverage
    const fieldCoverage = this.calculateFieldCoverage(accessPaths);

    // Step 7: Build summary
    const summary = this.buildSummary(fieldCoverage);

    // Step 8: Get uncovered paths sorted by priority
    const uncoveredPaths = accessPaths
      .filter(p => !p.isTested)
      .sort((a, b) => {
        // Sort by sensitivity (credentials first), then by depth
        const sensOrder: Record<SensitivityType, number> = {
          credentials: 0,
          financial: 1,
          health: 2,
          pii: 3,
          unknown: 4,
        };
        if (sensOrder[a.sensitivity] !== sensOrder[b.sensitivity]) {
          return sensOrder[a.sensitivity] - sensOrder[b.sensitivity];
        }
        return a.depth - b.depth;
      });

    return {
      summary,
      fields: fieldCoverage,
      uncoveredPaths,
      testFiles: Array.from(this.testFiles),
      testFunctions: this.testFunctions.size,
    };
  }

  /**
   * Get default test file patterns
   * Covers common conventions across languages and frameworks
   */
  private getDefaultTestPatterns(): RegExp[] {
    return [
      // Directory-based patterns
      /test[s]?[\/\\]/i,              // tests/ or test/
      /spec[s]?[\/\\]/i,              // specs/ or spec/
      /__tests__[\/\\]/i,             // __tests__/ (Jest)
      
      // Python patterns
      /_test\.[^.]+$/i,               // _test.py
      /test_[^\/\\]+\.[^.]+$/i,       // test_*.py
      
      // JavaScript/TypeScript patterns
      /\.test\.[^.]+$/i,              // .test.ts, .test.js
      /\.spec\.[^.]+$/i,              // .spec.ts, .spec.js
      
      // C#/.NET patterns
      /Tests?\.[^.]+$/i,              // Test.cs, Tests.cs
      /\.Tests[\/\\]/i,               // *.Tests/ project
      
      // Java patterns
      /Test\.java$/i,                 // *Test.java
      /Tests\.java$/i,                // *Tests.java
      /IT\.java$/i,                   // *IT.java (integration tests)
      
      // PHP/Laravel patterns
      /Test\.php$/i,                  // *Test.php
      /tests[\/\\]Feature[\/\\]/i,    // tests/Feature/
      /tests[\/\\]Unit[\/\\]/i,       // tests/Unit/
      
      // Ruby patterns
      /_spec\.rb$/i,                  // *_spec.rb (RSpec)
      /_test\.rb$/i,                  // *_test.rb (Minitest)
      
      // Go patterns
      /_test\.go$/i,                  // *_test.go
    ];
  }

  /**
   * Get default sensitivity patterns
   * Covers common sensitive data across ORMs and databases
   */
  private getDefaultSensitivityPatterns(): SensitivityPatternConfig[] {
    return [
      // Credentials (highest priority)
      {
        name: 'Passwords & Hashes',
        patterns: ['password', 'passwd', 'pwd', 'hash', 'hashed', 'password_hash', 'password_digest'],
        sensitivity: 'credentials',
        priority: 1,
      },
      {
        name: 'API Keys & Secrets',
        patterns: ['api_key', 'apikey', 'secret', 'secret_key', 'private_key', 'access_key', 'client_secret'],
        sensitivity: 'credentials',
        priority: 1,
      },
      {
        name: 'Authentication Tokens',
        patterns: ['token', 'auth_token', 'access_token', 'refresh_token', 'jwt', 'bearer', 'session_token'],
        sensitivity: 'credentials',
        priority: 1,
      },
      {
        name: 'OAuth & SSO',
        patterns: ['oauth', 'sso', 'saml', 'oidc', 'client_id', 'client_credentials'],
        sensitivity: 'credentials',
        priority: 2,
      },

      // Financial (high priority)
      {
        name: 'Credit Cards',
        patterns: ['credit_card', 'card_number', 'cc_number', 'cvv', 'cvc', 'card_exp', 'expiry'],
        sensitivity: 'financial',
        priority: 10,
      },
      {
        name: 'Bank Accounts',
        patterns: ['bank_account', 'account_number', 'routing_number', 'iban', 'swift', 'bic'],
        sensitivity: 'financial',
        priority: 10,
      },
      {
        name: 'Tax & Government IDs',
        patterns: ['ssn', 'social_security', 'tax_id', 'ein', 'tin', 'national_id', 'passport'],
        sensitivity: 'financial',
        priority: 10,
      },
      {
        name: 'Payment & Billing',
        patterns: ['salary', 'income', 'wage', 'compensation', 'payment', 'billing', 'stripe', 'paypal'],
        sensitivity: 'financial',
        priority: 15,
      },

      // Health (HIPAA)
      {
        name: 'Medical Records',
        patterns: ['diagnosis', 'medical', 'health', 'prescription', 'medication', 'treatment'],
        sensitivity: 'health',
        priority: 20,
      },
      {
        name: 'Patient Data',
        patterns: ['patient', 'hipaa', 'insurance', 'claim', 'provider', 'healthcare'],
        sensitivity: 'health',
        priority: 20,
      },

      // PII (Personal Identifiable Information)
      {
        name: 'Contact Information',
        patterns: ['email', 'phone', 'mobile', 'telephone', 'fax'],
        sensitivity: 'pii',
        priority: 30,
      },
      {
        name: 'Personal Names',
        patterns: ['first_name', 'last_name', 'full_name', 'middle_name', 'maiden_name', 'nickname'],
        sensitivity: 'pii',
        priority: 30,
      },
      {
        name: 'Address Information',
        patterns: ['address', 'street', 'city', 'state', 'zip', 'postal', 'country', 'region'],
        sensitivity: 'pii',
        priority: 30,
      },
      {
        name: 'Birth & Demographics',
        patterns: ['dob', 'date_of_birth', 'birth', 'age', 'gender', 'sex', 'race', 'ethnicity'],
        sensitivity: 'pii',
        priority: 30,
      },
      {
        name: 'Location Data',
        patterns: ['latitude', 'longitude', 'lat', 'lng', 'geo', 'location', 'coordinates'],
        sensitivity: 'pii',
        priority: 35,
      },
    ];
  }

  /**
   * Identify test files and test functions
   */
  private identifyTestCode(patterns: RegExp[]): void {
    for (const [id, func] of this.graph.functions) {
      const isTestFile = patterns.some(p => p.test(func.file));
      
      if (isTestFile) {
        this.testFiles.add(func.file);
        this.testFunctions.add(id);
      }
    }
  }

  /**
   * Find all functions that are called by tests (directly or transitively)
   */
  private findTestedFunctions(): void {
    const visited = new Set<string>();
    const queue = Array.from(this.testFunctions);

    while (queue.length > 0) {
      const funcId = queue.shift()!;
      if (visited.has(funcId)) {continue;}
      visited.add(funcId);

      this.testedFunctions.add(funcId);

      const func = this.graph.functions.get(funcId);
      if (!func) {continue;}

      // Follow all calls from this function
      for (const call of func.calls) {
        for (const candidate of call.resolvedCandidates) {
          if (!visited.has(candidate)) {
            queue.push(candidate);
          }
        }
      }
    }
  }

  /**
   * Find all sensitive data access points
   */
  private findSensitiveAccess(): Array<{
    access: DataAccessPoint;
    functionId: string;
    sensitivity: SensitivityType;
  }> {
    const results: Array<{
      access: DataAccessPoint;
      functionId: string;
      sensitivity: SensitivityType;
    }> = [];

    for (const [id, func] of this.graph.functions) {
      for (const access of func.dataAccess) {
        const sensitivity = this.classifySensitivity(access);
        if (sensitivity !== 'unknown') {
          results.push({
            access,
            functionId: id,
            sensitivity,
          });
        }
      }
    }

    return results;
  }

  /**
   * Build access paths from entry points to sensitive data
   */
  private buildAccessPaths(
    sensitiveAccess: Array<{
      access: DataAccessPoint;
      functionId: string;
      sensitivity: SensitivityType;
    }>,
    maxDepth: number
  ): SensitiveAccessPath[] {
    const paths: SensitiveAccessPath[] = [];
    let pathId = 0;

    for (const { access, functionId, sensitivity } of sensitiveAccess) {
      const accessor = this.graph.functions.get(functionId);
      if (!accessor) {continue;}

      // Find all entry points that can reach this accessor
      const entryPaths = this.findPathsFromEntryPoints(functionId, maxDepth);

      for (const { entryPointId, path } of entryPaths) {
        const entryPoint = this.graph.functions.get(entryPointId);
        if (!entryPoint) {continue;}

        // Extract sensitive fields from the access
        const sensitiveFields = this.extractSensitiveFields(access, sensitivity);

        for (const field of sensitiveFields) {
          paths.push({
            id: `path-${++pathId}`,
            field,
            table: access.table,
            sensitivity,
            entryPoint: {
              id: entryPointId,
              name: entryPoint.qualifiedName,
              file: entryPoint.file,
              line: entryPoint.startLine,
            },
            accessor: {
              id: functionId,
              name: accessor.qualifiedName,
              file: accessor.file,
              line: accessor.startLine,
            },
            path,
            depth: path.length,
            isTested: false,
            testFiles: [],
          });
        }
      }
    }

    return paths;
  }

  /**
   * Find all paths from entry points to a target function
   */
  private findPathsFromEntryPoints(
    targetId: string,
    maxDepth: number
  ): Array<{ entryPointId: string; path: CallPathNode[] }> {
    const results: Array<{ entryPointId: string; path: CallPathNode[] }> = [];
    
    // BFS backwards from target to find entry points
    const visited = new Map<string, CallPathNode[]>();
    const queue: Array<{ funcId: string; path: CallPathNode[] }> = [];

    const targetFunc = this.graph.functions.get(targetId);
    if (!targetFunc) {return results;}

    // Start from target
    const targetNode: CallPathNode = {
      functionId: targetId,
      functionName: targetFunc.qualifiedName,
      file: targetFunc.file,
      line: targetFunc.startLine,
    };

    queue.push({ funcId: targetId, path: [targetNode] });

    while (queue.length > 0) {
      const { funcId, path } = queue.shift()!;

      if (path.length > maxDepth) {continue;}

      // Check if this is an entry point
      if (this.entryPointSet.has(funcId) && funcId !== targetId) {
        results.push({
          entryPointId: funcId,
          path: [...path].reverse(), // Reverse to get entry → target order
        });
      }

      const func = this.graph.functions.get(funcId);
      if (!func) {continue;}

      // Follow callers (use native query if available)
      const callers = this.getCallers(funcId, func.name);
      for (const caller of callers) {
        const existingPath = visited.get(caller.callerId);
        if (!existingPath || existingPath.length > path.length + 1) {
          const callerFunc = this.graph.functions.get(caller.callerId);
          if (callerFunc) {
            const newPath: CallPathNode[] = [
              {
                functionId: caller.callerId,
                functionName: callerFunc.qualifiedName,
                file: callerFunc.file,
                line: callerFunc.startLine,
              },
              ...path,
            ];
            visited.set(caller.callerId, newPath);
            queue.push({ funcId: caller.callerId, path: newPath });
          }
        }
      }
    }

    return results;
  }

  /**
   * Mark which paths are tested
   */
  private markTestedPaths(paths: SensitiveAccessPath[]): void {
    for (const path of paths) {
      // A path is tested if:
      // 1. The accessor function is called by tests, OR
      // 2. Any function in the path is called by tests
      
      const pathFunctionIds = path.path.map(p => p.functionId);
      const testedInPath = pathFunctionIds.filter(id => this.testedFunctions.has(id));

      if (testedInPath.length > 0) {
        path.isTested = true;
        
        // Find which test files cover this path
        for (const funcId of testedInPath) {
          const func = this.graph.functions.get(funcId);
          if (func) {
            // Find test functions that call this function (use native query if available)
            const callers = this.getCallers(funcId, func.name);
            for (const caller of callers) {
              const callerFunc = this.graph.functions.get(caller.callerId);
              if (callerFunc && this.testFiles.has(callerFunc.file)) {
                if (!path.testFiles.includes(callerFunc.file)) {
                  path.testFiles.push(callerFunc.file);
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Calculate coverage by field
   */
  private calculateFieldCoverage(paths: SensitiveAccessPath[]): FieldCoverage[] {
    const byField = new Map<string, SensitiveAccessPath[]>();

    for (const path of paths) {
      const key = `${path.table}.${path.field}`;
      const existing = byField.get(key) ?? [];
      existing.push(path);
      byField.set(key, existing);
    }

    const results: FieldCoverage[] = [];

    for (const [fullName, fieldPaths] of byField) {
      const parts = fullName.split('.');
      const table = parts[0] ?? '';
      const field = parts.length > 1 ? parts.slice(1).join('.') : (parts[0] ?? '');
      const testedPaths = fieldPaths.filter(p => p.isTested).length;
      const totalPaths = fieldPaths.length;
      const coveragePercent = totalPaths > 0 ? Math.round((testedPaths / totalPaths) * 100) : 0;

      let status: CoverageStatus;
      if (coveragePercent === 100) {
        status = 'covered';
      } else if (coveragePercent > 0) {
        status = 'partial';
      } else {
        status = 'uncovered';
      }

      results.push({
        field,
        table,
        fullName,
        sensitivity: fieldPaths[0]?.sensitivity ?? 'unknown',
        totalPaths,
        testedPaths,
        coveragePercent,
        status,
        paths: fieldPaths,
      });
    }

    // Sort by coverage (uncovered first), then by sensitivity
    results.sort((a, b) => {
      if (a.status !== b.status) {
        const statusOrder: Record<CoverageStatus, number> = {
          uncovered: 0,
          partial: 1,
          covered: 2,
        };
        return statusOrder[a.status] - statusOrder[b.status];
      }
      const sensOrder: Record<SensitivityType, number> = {
        credentials: 0,
        financial: 1,
        health: 2,
        pii: 3,
        unknown: 4,
      };
      return sensOrder[a.sensitivity] - sensOrder[b.sensitivity];
    });

    return results;
  }

  /**
   * Build summary statistics
   */
  private buildSummary(fieldCoverage: FieldCoverage[]): CoverageAnalysisResult['summary'] {
    const bySensitivity: Record<SensitivityType, {
      fields: number;
      paths: number;
      testedPaths: number;
      coveragePercent: number;
    }> = {
      credentials: { fields: 0, paths: 0, testedPaths: 0, coveragePercent: 0 },
      financial: { fields: 0, paths: 0, testedPaths: 0, coveragePercent: 0 },
      health: { fields: 0, paths: 0, testedPaths: 0, coveragePercent: 0 },
      pii: { fields: 0, paths: 0, testedPaths: 0, coveragePercent: 0 },
      unknown: { fields: 0, paths: 0, testedPaths: 0, coveragePercent: 0 },
    };

    let totalPaths = 0;
    let testedPaths = 0;

    for (const field of fieldCoverage) {
      bySensitivity[field.sensitivity].fields++;
      bySensitivity[field.sensitivity].paths += field.totalPaths;
      bySensitivity[field.sensitivity].testedPaths += field.testedPaths;
      totalPaths += field.totalPaths;
      testedPaths += field.testedPaths;
    }

    // Calculate percentages
    for (const sens of Object.keys(bySensitivity) as SensitivityType[]) {
      const s = bySensitivity[sens];
      s.coveragePercent = s.paths > 0 ? Math.round((s.testedPaths / s.paths) * 100) : 0;
    }

    return {
      totalSensitiveFields: fieldCoverage.length,
      totalAccessPaths: totalPaths,
      testedAccessPaths: testedPaths,
      coveragePercent: totalPaths > 0 ? Math.round((testedPaths / totalPaths) * 100) : 0,
      bySensitivity,
    };
  }

  /**
   * Classify sensitivity of a data access point using configurable patterns
   */
  private classifySensitivity(access: DataAccessPoint): SensitivityType {
    const text = `${access.table} ${access.fields.join(' ')}`.toLowerCase();

    // Check each pattern in priority order
    for (const config of this.sensitivityPatterns) {
      for (const pattern of config.patterns) {
        if (text.includes(pattern.toLowerCase())) {
          return config.sensitivity;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Extract sensitive field names from an access point using configurable patterns
   */
  private extractSensitiveFields(access: DataAccessPoint, sensitivity: SensitivityType): string[] {
    // Get all patterns for this sensitivity type
    const patterns = this.sensitivityPatterns
      .filter(p => p.sensitivity === sensitivity)
      .flatMap(p => p.patterns);

    const sensitiveFields = access.fields.filter(field => {
      const fieldLower = field.toLowerCase();
      return patterns.some(pattern => fieldLower.includes(pattern.toLowerCase()));
    });

    // If no specific fields match, use the table name as the field
    if (sensitiveFields.length === 0) {
      return [access.table];
    }

    return sensitiveFields;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a coverage analyzer
 */
export function createCoverageAnalyzer(graph: CallGraph): CoverageAnalyzer {
  return new CoverageAnalyzer(graph);
}
