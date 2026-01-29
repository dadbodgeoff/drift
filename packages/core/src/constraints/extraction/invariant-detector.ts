/**
 * Invariant Detector
 *
 * Analyzes Drift's existing data (patterns, call graphs, boundaries, test topology,
 * error handling) to discover architectural invariants that can become constraints.
 * 
 * This is the semantic analysis layer that mines invariants from:
 * - Pattern data (high-confidence approved patterns)
 * - Call graph (auth-before-data-access, validation patterns)
 * - Boundaries (data access layer invariants)
 * - Test topology (coverage requirements)
 * - Error handling (error boundary patterns)
 */


import type { BoundaryStore } from '../../boundaries/boundary-store.js';
import type { CallGraphStore } from '../../call-graph/store/call-graph-store.js';
import type { CallGraph, FunctionNode } from '../../call-graph/types.js';
import type { ErrorHandlingAnalyzer } from '../../error-handling/error-handling-analyzer.js';
import type { PatternStore } from '../../store/pattern-store.js';
import type { Pattern, PatternLocation, OutlierLocation } from '../../store/types.js';
import type { TestTopologyAnalyzer } from '../../test-topology/test-topology-analyzer.js';
import type {
  Constraint,
  ConstraintCategory,
  ConstraintType,
  ConstraintPredicate,
  ConstraintScope,
  ConstraintViolationDetail,
  ConstraintLanguage,
  ExtractionOptions,
} from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface InvariantDetectorConfig {
  rootDir: string;
  patternStore?: PatternStore;
  callGraphStore?: CallGraphStore;
  boundaryStore?: BoundaryStore;
  testTopologyAnalyzer?: TestTopologyAnalyzer;
  errorHandlingAnalyzer?: ErrorHandlingAnalyzer;
}

export interface DetectedInvariant {
  /** Proposed constraint */
  constraint: Omit<Constraint, 'id' | 'metadata'>;
  /** Evidence supporting this invariant */
  evidence: InvariantEvidence;
  /** Violations found during detection */
  violations: ConstraintViolationDetail[];
}


export interface InvariantEvidence {
  /** Number of conforming instances */
  conforming: number;
  /** Number of violating instances */
  violating: number;
  /** Sample locations that conform */
  conformingLocations: string[];
  /** Sample locations that violate */
  violatingLocations: string[];
  /** Source data used */
  sources: string[];
}

// =============================================================================
// Invariant Detector
// =============================================================================

export class InvariantDetector {
  private readonly config: InvariantDetectorConfig;

  constructor(config: InvariantDetectorConfig) {
    this.config = config;
  }

  /**
   * Detect invariants from all available Drift data
   */
  async detectAll(options: ExtractionOptions = {}): Promise<DetectedInvariant[]> {
    const invariants: DetectedInvariant[] = [];
    const categories = options.categories ?? [
      'api', 'auth', 'data', 'error', 'test', 'security', 'structural'
    ];

    // Detect from patterns
    if (this.config.patternStore) {
      const patternInvariants = await this.detectFromPatterns(categories, options);
      invariants.push(...patternInvariants);
    }

    // Detect from call graph
    if (this.config.callGraphStore) {
      const callGraphInvariants = await this.detectFromCallGraph(options);
      invariants.push(...callGraphInvariants);
    }

    // Detect from boundaries
    if (this.config.boundaryStore) {
      const boundaryInvariants = await this.detectFromBoundaries(options);
      invariants.push(...boundaryInvariants);
    }

    // Detect from test topology
    if (this.config.testTopologyAnalyzer) {
      const testInvariants = await this.detectFromTestTopology(options);
      invariants.push(...testInvariants);
    }

    // Detect from error handling
    if (this.config.errorHandlingAnalyzer) {
      const errorInvariants = await this.detectFromErrorHandling(options);
      invariants.push(...errorInvariants);
    }

    // Filter by confidence threshold
    const minConfidence = options.minConfidence ?? 0.90;
    return invariants.filter(inv => inv.constraint.confidence.score >= minConfidence);
  }


  // ===========================================================================
  // Pattern-Based Detection
  // ===========================================================================

  /**
   * Detect invariants from pattern data
   */
  private async detectFromPatterns(
    categories: ConstraintCategory[],
    options: ExtractionOptions
  ): Promise<DetectedInvariant[]> {
    const invariants: DetectedInvariant[] = [];
    const store = this.config.patternStore!;

    // Get all approved patterns with high confidence
    const patterns = store.getAll().filter(p =>
      p.status === 'approved' &&
      p.confidence.score >= 0.85 &&
      categories.includes(p.category as ConstraintCategory)
    );

    for (const pattern of patterns) {
      const detected = this.patternToInvariant(pattern, options);
      if (detected) {
        invariants.push(detected);
      }
    }

    return invariants;
  }

  /**
   * Convert a high-confidence pattern to an invariant
   */
  private patternToInvariant(
    pattern: Pattern,
    options: ExtractionOptions
  ): DetectedInvariant | null {
    // Only convert patterns with enough evidence
    if (pattern.locations.length < 3) {return null;}

    const category = pattern.category as ConstraintCategory;
    const language = this.detectLanguageFromPattern(pattern);

    // Build predicate based on pattern type
    const predicate = this.buildPredicateFromPattern(pattern);

    // Calculate confidence
    const violations = pattern.outliers ?? [];
    const conforming = pattern.locations.length;
    const violating = violations.length;
    const confidence = conforming / (conforming + violating);

    // Build violation details
    const violationDetails: ConstraintViolationDetail[] = violations.map((o: OutlierLocation) => ({
      file: o.file,
      line: o.line,
      reason: o.reason ?? 'Outlier from pattern',
    }));

    // Build confidence object conditionally to satisfy exactOptionalPropertyTypes
    const constraintConfidence: Constraint['confidence'] = {
      score: confidence,
      evidence: conforming,
      violations: violating,
      lastVerified: new Date().toISOString(),
    };
    
    if (options.includeViolationDetails && violationDetails.length > 0) {
      constraintConfidence.violationDetails = violationDetails;
    }

    return {
      constraint: {
        name: `${pattern.name} Invariant`,
        description: `All ${pattern.name} instances must follow the established pattern`,
        category,
        derivedFrom: {
          patterns: [pattern.id],
          callGraphPaths: [],
          boundaries: [],
        },
        invariant: {
          type: this.inferConstraintType(pattern),
          condition: pattern.description ?? `Must follow ${pattern.name} pattern`,
          predicate,
        },
        scope: this.buildScopeFromPattern(pattern),
        confidence: constraintConfidence,
        enforcement: {
          level: confidence >= 0.95 ? 'error' : 'warning',
          guidance: `Follow the ${pattern.name} pattern as established in the codebase`,
        },
        status: 'discovered',
        language,
      },
      evidence: {
        conforming,
        violating,
        conformingLocations: pattern.locations.slice(0, 5).map((l: PatternLocation) => `${l.file}:${l.line}`),
        violatingLocations: violations.slice(0, 5).map((o: OutlierLocation) => `${o.file}:${o.line}`),
        sources: [`pattern:${pattern.id}`],
      },
      violations: violationDetails,
    };
  }


  // ===========================================================================
  // Call Graph-Based Detection
  // ===========================================================================

  /**
   * Detect invariants from call graph analysis
   */
  private async detectFromCallGraph(
    _options: ExtractionOptions
  ): Promise<DetectedInvariant[]> {
    const invariants: DetectedInvariant[] = [];
    const store = this.config.callGraphStore!;

    // Load call graph
    const graph = await store.load();
    if (!graph) {return invariants;}

    // Detect auth-before-data-access invariants
    const authInvariants = this.detectAuthBeforeDataAccess(graph);
    invariants.push(...authInvariants);

    // Detect validation patterns
    const validationInvariants = this.detectValidationPatterns(graph);
    invariants.push(...validationInvariants);

    return invariants;
  }

  /**
   * Detect auth-before-data-access patterns
   */
  private detectAuthBeforeDataAccess(graph: CallGraph): DetectedInvariant[] {
    const invariants: DetectedInvariant[] = [];

    // Find entry points that access data
    const entryPointIds = graph.entryPoints ?? [];
    const entryPointsWithData: FunctionNode[] = [];
    
    for (const id of entryPointIds) {
      const func = graph.functions.get(id);
      if (func?.dataAccess && func.dataAccess.length > 0) {
        entryPointsWithData.push(func);
      }
    }

    if (entryPointsWithData.length < 3) {return invariants;}

    // Group by whether they have auth in the call chain
    const withAuth: FunctionNode[] = [];
    const withoutAuth: FunctionNode[] = [];

    for (const entry of entryPointsWithData) {
      const hasAuth = this.hasAuthInCallChain(entry, graph);
      if (hasAuth) {
        withAuth.push(entry);
      } else {
        withoutAuth.push(entry);
      }
    }

    // If most entry points have auth, create an invariant
    const total = withAuth.length + withoutAuth.length;
    if (total >= 3 && withAuth.length / total >= 0.8) {
      const confidence = withAuth.length / total;

      invariants.push({
        constraint: {
          name: 'Auth Before Data Access',
          description: 'Entry points that access data must have authentication in the call chain',
          category: 'auth',
          derivedFrom: {
            patterns: [],
            callGraphPaths: entryPointsWithData.map(e => e.id),
            boundaries: [],
          },
          invariant: {
            type: 'must_precede',
            condition: 'Authentication must occur before data access',
            predicate: {
              callChain: {
                from: 'entryPoint',
                to: 'dataAccess',
                mustInclude: ['authenticate', 'authorize', 'checkAuth', 'requireAuth'],
              },
            },
          },
          scope: {
            entryPoints: true,
            dataAccessors: true,
          },
          confidence: {
            score: confidence,
            evidence: withAuth.length,
            violations: withoutAuth.length,
            lastVerified: new Date().toISOString(),
          },
          enforcement: {
            level: 'error',
            guidance: 'Add authentication middleware or check before accessing data',
          },
          status: 'discovered',
          language: 'all',
        },
        evidence: {
          conforming: withAuth.length,
          violating: withoutAuth.length,
          conformingLocations: withAuth.slice(0, 5).map(f => `${f.file}:${f.startLine}`),
          violatingLocations: withoutAuth.slice(0, 5).map(f => `${f.file}:${f.startLine}`),
          sources: ['callGraph'],
        },
        violations: withoutAuth.map(f => ({
          file: f.file,
          line: f.startLine,
          reason: 'Entry point accesses data without authentication in call chain',
        })),
      });
    }

    return invariants;
  }

  /**
   * Check if a function has auth in its call chain
   */
  private hasAuthInCallChain(func: FunctionNode, graph: CallGraph): boolean {
    const authPatterns = [
      /auth/i, /authenticate/i, /authorize/i, /checkAuth/i,
      /requireAuth/i, /isAuthenticated/i, /verifyToken/i,
      /validateToken/i, /checkPermission/i, /hasRole/i,
    ];

    const visited = new Set<string>();
    const queue = [func.id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {continue;}
      visited.add(current);

      const node = graph.functions.get(current);
      if (!node) {continue;}

      // Check if this function is auth-related
      if (authPatterns.some(p => p.test(node.name))) {
        return true;
      }

      // Check decorators/annotations
      if (node.decorators?.some(d => authPatterns.some(p => p.test(d)))) {
        return true;
      }

      // Add callees to queue
      for (const call of node.calls ?? []) {
        if (call.calleeId) {
          queue.push(call.calleeId);
        }
      }
    }

    return false;
  }


  /**
   * Detect validation patterns in call graph
   */
  private detectValidationPatterns(graph: CallGraph): DetectedInvariant[] {
    const invariants: DetectedInvariant[] = [];

    // Find entry points
    const entryPointIds = graph.entryPoints ?? [];
    const entryPoints: FunctionNode[] = [];
    
    for (const id of entryPointIds) {
      const func = graph.functions.get(id);
      if (func) {entryPoints.push(func);}
    }

    if (entryPoints.length < 3) {return invariants;}

    // Check for validation patterns
    const validationPatterns = [
      /validate/i, /sanitize/i, /check/i, /verify/i,
      /parse/i, /schema/i, /zod/i, /yup/i, /joi/i,
    ];

    const withValidation: FunctionNode[] = [];
    const withoutValidation: FunctionNode[] = [];

    for (const entry of entryPoints) {
      const hasValidation = this.hasPatternInCallChain(entry, graph, validationPatterns);
      if (hasValidation) {
        withValidation.push(entry);
      } else {
        withoutValidation.push(entry);
      }
    }

    const total = withValidation.length + withoutValidation.length;
    if (total >= 3 && withValidation.length / total >= 0.7) {
      const confidence = withValidation.length / total;

      invariants.push({
        constraint: {
          name: 'Input Validation Required',
          description: 'Entry points must validate input before processing',
          category: 'validation',
          derivedFrom: {
            patterns: [],
            callGraphPaths: entryPoints.map(e => e.id),
            boundaries: [],
          },
          invariant: {
            type: 'must_precede',
            condition: 'Input validation must occur at entry points',
            predicate: {
              entryPointMustHave: {
                inCallChain: ['validate', 'sanitize', 'parse', 'schema'],
                position: 'before_handler',
              },
            },
          },
          scope: {
            entryPoints: true,
          },
          confidence: {
            score: confidence,
            evidence: withValidation.length,
            violations: withoutValidation.length,
            lastVerified: new Date().toISOString(),
          },
          enforcement: {
            level: 'warning',
            guidance: 'Add input validation at the entry point',
          },
          status: 'discovered',
          language: 'all',
        },
        evidence: {
          conforming: withValidation.length,
          violating: withoutValidation.length,
          conformingLocations: withValidation.slice(0, 5).map(f => `${f.file}:${f.startLine}`),
          violatingLocations: withoutValidation.slice(0, 5).map(f => `${f.file}:${f.startLine}`),
          sources: ['callGraph'],
        },
        violations: withoutValidation.map(f => ({
          file: f.file,
          line: f.startLine,
          reason: 'Entry point lacks input validation',
        })),
      });
    }

    return invariants;
  }

  /**
   * Check if a function has a pattern in its call chain
   */
  private hasPatternInCallChain(
    func: FunctionNode, 
    graph: CallGraph, 
    patterns: RegExp[]
  ): boolean {
    const visited = new Set<string>();
    const queue = [func.id];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {continue;}
      visited.add(current);

      const node = graph.functions.get(current);
      if (!node) {continue;}

      if (patterns.some(p => p.test(node.name))) {
        return true;
      }

      if (node.decorators?.some(d => patterns.some(p => p.test(d)))) {
        return true;
      }

      for (const call of node.calls ?? []) {
        if (call.calleeId) {
          queue.push(call.calleeId);
        }
      }
    }

    return false;
  }


  // ===========================================================================
  // Boundary-Based Detection
  // ===========================================================================

  /**
   * Detect invariants from boundary data
   */
  private async detectFromBoundaries(
    _options: ExtractionOptions
  ): Promise<DetectedInvariant[]> {
    const invariants: DetectedInvariant[] = [];
    const store = this.config.boundaryStore!;

    try {
      await store.initialize();
      const accessMap = store.getAccessMap();
      if (!accessMap) {return invariants;}

      // Detect data access layer invariants from access points
      const accessPoints = Object.values(accessMap.accessPoints);
      if (accessPoints.length < 3) {return invariants;}

      // Group by table
      const byTable = new Map<string, Array<{ file: string; accessor: string; line: number }>>();
      
      for (const point of accessPoints) {
        const table = point.table;
        const list = byTable.get(table) ?? [];
        list.push({ 
          file: point.file, 
          accessor: point.context ?? 'direct',
          line: point.line,
        });
        byTable.set(table, list);
      }

      // For each table with enough accesses, check for consistent access layer
      for (const [table, accesses] of byTable) {
        if (accesses.length < 3) {continue;}

        // Extract access layers
        const layerCounts = new Map<string, number>();
        for (const access of accesses) {
          const layer = this.extractAccessLayer(access.accessor);
          layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
        }

        // Find dominant layer
        let dominantLayer = '';
        let dominantCount = 0;
        for (const [layer, count] of layerCounts) {
          if (count > dominantCount) {
            dominantLayer = layer;
            dominantCount = count;
          }
        }

        const confidence = dominantCount / accesses.length;
        if (confidence >= 0.8 && dominantLayer && dominantLayer !== 'direct') {
          const violations = accesses.filter(a =>
            this.extractAccessLayer(a.accessor) !== dominantLayer
          );

          invariants.push({
            constraint: {
              name: `${table} Access Layer`,
              description: `Access to ${table} must go through ${dominantLayer}`,
              category: 'data',
              derivedFrom: {
                patterns: [],
                callGraphPaths: [],
                boundaries: [table],
              },
              invariant: {
                type: 'data_flow',
                condition: `All access to ${table} must go through ${dominantLayer}`,
                predicate: {
                  dataAccess: {
                    table,
                    mustGoThrough: [dominantLayer],
                  },
                },
              },
              scope: {
                dataAccessors: true,
              },
              confidence: {
                score: confidence,
                evidence: dominantCount,
                violations: violations.length,
                lastVerified: new Date().toISOString(),
              },
              enforcement: {
                level: 'warning',
                guidance: `Access ${table} through ${dominantLayer} instead of directly`,
              },
              status: 'discovered',
              language: 'all',
            },
            evidence: {
              conforming: dominantCount,
              violating: violations.length,
              conformingLocations: accesses
                .filter(a => this.extractAccessLayer(a.accessor) === dominantLayer)
                .slice(0, 5)
                .map(a => `${a.file}:${a.line}`),
              violatingLocations: violations.slice(0, 5).map(a => `${a.file}:${a.line}`),
              sources: ['boundaries'],
            },
            violations: violations.map(a => ({
              file: a.file,
              line: a.line,
              reason: `Accesses ${table} directly instead of through ${dominantLayer}`,
            })),
          });
        }
      }

      // Detect sensitive data access patterns
      const sensitiveInvariants = this.detectSensitiveDataInvariants(accessMap);
      invariants.push(...sensitiveInvariants);

    } catch {
      // Boundary store not available or error
    }

    return invariants;
  }

  /**
   * Detect invariants for sensitive data access
   */
  private detectSensitiveDataInvariants(accessMap: ReturnType<BoundaryStore['getAccessMap']>): DetectedInvariant[] {
    const invariants: DetectedInvariant[] = [];
    
    if (!accessMap.sensitiveFields || accessMap.sensitiveFields.length === 0) {
      return invariants;
    }

    // Group sensitive fields by table
    const sensitiveByTable = new Map<string, string[]>();
    for (const field of accessMap.sensitiveFields) {
      if (!field.table) {continue;} // Skip fields without table info
      const fields = sensitiveByTable.get(field.table) ?? [];
      fields.push(field.field);
      sensitiveByTable.set(field.table, fields);
    }

    for (const [table, fields] of sensitiveByTable) {
      invariants.push({
        constraint: {
          name: `${table} Sensitive Data Protection`,
          description: `Sensitive fields in ${table} require special handling`,
          category: 'security',
          derivedFrom: {
            patterns: [],
            callGraphPaths: [],
            boundaries: [table],
          },
          invariant: {
            type: 'must_have',
            condition: `Access to sensitive fields (${fields.join(', ')}) must be audited`,
            predicate: {
              dataAccess: {
                table,
                sensitiveFields: fields,
                requiresAuth: true,
              },
            },
          },
          scope: {
            dataAccessors: true,
          },
          confidence: {
            score: 0.95,
            evidence: fields.length,
            violations: 0,
            lastVerified: new Date().toISOString(),
          },
          enforcement: {
            level: 'error',
            guidance: `Ensure proper authorization and audit logging when accessing ${fields.join(', ')}`,
          },
          status: 'discovered',
          language: 'all',
        },
        evidence: {
          conforming: fields.length,
          violating: 0,
          conformingLocations: [],
          violatingLocations: [],
          sources: ['boundaries:sensitiveFields'],
        },
        violations: [],
      });
    }

    return invariants;
  }

  /**
   * Extract the access layer from an accessor context
   */
  private extractAccessLayer(accessor: string): string {
    const match = accessor.match(/(\w+)(Repository|Service|DAO|Store|Manager)/i);
    return match ? match[0] : 'direct';
  }


  // ===========================================================================
  // Test Topology-Based Detection
  // ===========================================================================

  /**
   * Detect invariants from test topology
   */
  private async detectFromTestTopology(
    _options: ExtractionOptions
  ): Promise<DetectedInvariant[]> {
    const invariants: DetectedInvariant[] = [];
    const analyzer = this.config.testTopologyAnalyzer!;

    // Get summary statistics
    const summary = analyzer.getSummary();
    if (!summary || summary.totalFunctions < 5) {return invariants;}

    // If most functions are tested, create a test coverage invariant
    const coverageRatio = summary.coveredFunctions / summary.totalFunctions;
    if (coverageRatio >= 0.7) {
      invariants.push({
        constraint: {
          name: 'Function Test Coverage',
          description: 'Functions should have at least one test',
          category: 'test',
          derivedFrom: {
            patterns: [],
            callGraphPaths: [],
            boundaries: [],
            testTopology: ['coverage'],
          },
          invariant: {
            type: 'must_have',
            condition: 'Each function must have at least one test',
            predicate: {
              testCoverage: {
                minCoverage: 1,
                types: ['unit'],
              },
            },
          },
          scope: {
            functions: ['.*'],
            exclude: {
              files: ['**/test/**', '**/*.test.*', '**/*.spec.*'],
            },
          },
          confidence: {
            score: coverageRatio,
            evidence: summary.coveredFunctions,
            violations: summary.totalFunctions - summary.coveredFunctions,
            lastVerified: new Date().toISOString(),
          },
          enforcement: {
            level: 'warning',
            guidance: 'Add unit tests for this function',
          },
          status: 'discovered',
          language: 'all',
        },
        evidence: {
          conforming: summary.coveredFunctions,
          violating: summary.totalFunctions - summary.coveredFunctions,
          conformingLocations: [],
          violatingLocations: [],
          sources: ['testTopology'],
        },
        violations: [],
      });
    }

    // Check mock ratio patterns
    if (summary.avgMockRatio < 0.5) {
      invariants.push({
        constraint: {
          name: 'Reasonable Mock Usage',
          description: 'Tests should not over-mock - prefer integration over isolation',
          category: 'test',
          derivedFrom: {
            patterns: [],
            callGraphPaths: [],
            boundaries: [],
            testTopology: ['mocks'],
          },
          invariant: {
            type: 'must_not_have',
            condition: 'Tests should have mock ratio below 70%',
            predicate: {
              testCoverage: {
                maxMockRatio: 0.7,
              },
            },
          },
          scope: {
            files: ['**/*.test.*', '**/*.spec.*'],
          },
          confidence: {
            score: 1 - summary.avgMockRatio,
            evidence: summary.testCases,
            violations: 0,
            lastVerified: new Date().toISOString(),
          },
          enforcement: {
            level: 'info',
            guidance: 'Consider reducing mocks in favor of integration tests',
          },
          status: 'discovered',
          language: 'all',
        },
        evidence: {
          conforming: summary.testCases,
          violating: 0,
          conformingLocations: [],
          violatingLocations: [],
          sources: ['testTopology:mocks'],
        },
        violations: [],
      });
    }

    return invariants;
  }


  // ===========================================================================
  // Error Handling-Based Detection
  // ===========================================================================

  /**
   * Detect invariants from error handling analysis
   */
  private async detectFromErrorHandling(
    _options: ExtractionOptions
  ): Promise<DetectedInvariant[]> {
    const invariants: DetectedInvariant[] = [];
    const analyzer = this.config.errorHandlingAnalyzer!;

    // Get topology and summary
    const topology = analyzer.getTopology();
    const summary = analyzer.getSummary();
    
    if (!topology || !summary || summary.totalFunctions < 5) {return invariants;}

    // Detect async error handling patterns
    const asyncFunctions: Array<{ file: string; line: number; name: string; hasHandling: boolean }> = [];
    
    for (const [_funcId, profile] of topology.functions) {
      if (profile.isAsync) {
        asyncFunctions.push({
          file: profile.file,
          line: profile.line,
          name: profile.qualifiedName,
          hasHandling: profile.hasTryCatch || (profile.asyncHandling?.hasAsyncTryCatch ?? false),
        });
      }
    }

    if (asyncFunctions.length >= 5) {
      const withHandling = asyncFunctions.filter(f => f.hasHandling);
      const withoutHandling = asyncFunctions.filter(f => !f.hasHandling);
      const ratio = withHandling.length / asyncFunctions.length;

      if (ratio >= 0.7) {
        invariants.push({
          constraint: {
            name: 'Async Error Handling',
            description: 'Async functions must have error handling',
            category: 'error',
            derivedFrom: {
              patterns: [],
              callGraphPaths: [],
              boundaries: [],
              errorHandling: ['topology'],
            },
            invariant: {
              type: 'must_have',
              condition: 'Async functions must have try-catch or error handling',
              predicate: {
                functionMustHave: {
                  errorHandling: true,
                  isAsync: true,
                },
              },
            },
            scope: {
              functions: ['.*'],
            },
            confidence: {
              score: ratio,
              evidence: withHandling.length,
              violations: withoutHandling.length,
              lastVerified: new Date().toISOString(),
            },
            enforcement: {
              level: 'warning',
              guidance: 'Add try-catch or error handling to this async function',
            },
            status: 'discovered',
            language: 'all',
          },
          evidence: {
            conforming: withHandling.length,
            violating: withoutHandling.length,
            conformingLocations: withHandling.slice(0, 5).map(f => `${f.file}:${f.line}`),
            violatingLocations: withoutHandling.slice(0, 5).map(f => `${f.file}:${f.line}`),
            sources: ['errorHandling'],
          },
          violations: withoutHandling.slice(0, 20).map(f => ({
            file: f.file,
            line: f.line,
            reason: 'Async function lacks error handling',
          })),
        });
      }
    }

    // Detect error boundary patterns
    const boundaries = topology.boundaries ?? [];
    if (boundaries.length >= 2) {
      const frameworkBoundaries = boundaries.filter(b => b.isFrameworkBoundary);
      
      if (frameworkBoundaries.length > 0) {
        invariants.push({
          constraint: {
            name: 'Error Boundary Pattern',
            description: 'Use framework error boundaries for centralized error handling',
            category: 'error',
            derivedFrom: {
              patterns: [],
              callGraphPaths: [],
              boundaries: [],
              errorHandling: ['boundaries'],
            },
            invariant: {
              type: 'must_have',
              condition: 'Critical paths should be protected by error boundaries',
              predicate: {
                callChain: {
                  from: 'entryPoint',
                  to: 'dataAccess',
                  mustInclude: frameworkBoundaries.map(b => b.name),
                },
              },
            },
            scope: {
              entryPoints: true,
            },
            confidence: {
              score: 0.85,
              evidence: frameworkBoundaries.length,
              violations: 0,
              lastVerified: new Date().toISOString(),
            },
            enforcement: {
              level: 'info',
              guidance: 'Ensure error boundaries protect critical code paths',
            },
            status: 'discovered',
            language: 'all',
          },
          evidence: {
            conforming: frameworkBoundaries.length,
            violating: 0,
            conformingLocations: frameworkBoundaries.slice(0, 5).map(b => `${b.file}:${b.line}`),
            violatingLocations: [],
            sources: ['errorHandling:boundaries'],
          },
          violations: [],
        });
      }
    }

    // Detect swallowed error anti-pattern
    const swallowedCount = summary.topIssues?.find(i => i.type === 'swallowed')?.count ?? 0;
    if (swallowedCount > 0 && summary.totalFunctions > 10) {
      const swallowRatio = swallowedCount / summary.totalFunctions;
      
      if (swallowRatio < 0.1) { // Less than 10% swallow errors = good pattern
        invariants.push({
          constraint: {
            name: 'No Swallowed Errors',
            description: 'Errors must not be silently swallowed',
            category: 'error',
            derivedFrom: {
              patterns: [],
              callGraphPaths: [],
              boundaries: [],
              errorHandling: ['gaps'],
            },
            invariant: {
              type: 'must_not_have',
              condition: 'Catch blocks must not swallow errors silently',
              predicate: {
                functionMustHave: {
                  bodyMustNotContain: ['catch {}', 'catch (e) {}', 'except: pass'],
                },
              },
            },
            scope: {
              functions: ['.*'],
            },
            confidence: {
              score: 1 - swallowRatio,
              evidence: summary.totalFunctions - swallowedCount,
              violations: swallowedCount,
              lastVerified: new Date().toISOString(),
            },
            enforcement: {
              level: 'error',
              guidance: 'Log the error or rethrow it instead of swallowing',
            },
            status: 'discovered',
            language: 'all',
          },
          evidence: {
            conforming: summary.totalFunctions - swallowedCount,
            violating: swallowedCount,
            conformingLocations: [],
            violatingLocations: [],
            sources: ['errorHandling:gaps'],
          },
          violations: [],
        });
      }
    }

    return invariants;
  }


  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private detectLanguageFromPattern(pattern: Pattern): ConstraintLanguage {
    const extensions = new Set<string>();
    for (const loc of pattern.locations) {
      const ext = loc.file.split('.').pop()?.toLowerCase();
      if (ext) {extensions.add(ext);}
    }

    if (extensions.has('ts') || extensions.has('tsx')) {return 'typescript';}
    if (extensions.has('js') || extensions.has('jsx')) {return 'javascript';}
    if (extensions.has('py')) {return 'python';}
    if (extensions.has('java')) {return 'java';}
    if (extensions.has('cs')) {return 'csharp';}
    if (extensions.has('php')) {return 'php';}

    return 'all';
  }

  private buildPredicateFromPattern(pattern: Pattern): ConstraintPredicate {
    const predicate: ConstraintPredicate = {};
    const config = pattern.detector;

    if (config?.config && typeof config.config === 'object') {
      const detectorConfig = config.config;
      
      if (Array.isArray(detectorConfig['decorators']) && detectorConfig['decorators'].length > 0) {
        predicate.functionMustHave = {
          decorator: detectorConfig['decorators'] as string[],
        };
      }

      if (typeof detectorConfig['namePattern'] === 'string') {
        predicate.naming = {
          pattern: detectorConfig['namePattern'],
          scope: 'function',
        };
      }
    }

    return predicate;
  }

  private inferConstraintType(pattern: Pattern): ConstraintType {
    const category = pattern.category;

    switch (category) {
      case 'auth':
        return 'must_precede';
      case 'errors':
        return 'must_wrap';
      case 'logging':
        return 'must_have';
      case 'testing':
        return 'must_have';
      case 'security':
        return 'must_have';
      default:
        return 'must_have';
    }
  }

  private buildScopeFromPattern(pattern: Pattern): ConstraintScope {
    const scope: ConstraintScope = {};

    const directories = new Set<string>();
    for (const loc of pattern.locations) {
      const dir = loc.file.split('/').slice(0, -1).join('/');
      if (dir) {directories.add(dir);}
    }

    if (directories.size > 0) {
      scope.files = Array.from(directories).map(d => `${d}/**/*`);
    }

    return scope;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createInvariantDetector(
  config: InvariantDetectorConfig
): InvariantDetector {
  return new InvariantDetector(config);
}
