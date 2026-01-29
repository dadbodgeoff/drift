/**
 * Security Boundary Gate
 * 
 * @license Apache-2.0
 * 
 * Enforces security boundaries by checking that sensitive data access
 * has proper authorization in the call chain.
 * 
 * FUTURE_GATE: gate:security-boundary (Enterprise tier)
 */

import { BaseGate } from '../base-gate.js';

import type {
  GateId,
  GateInput,
  GateResult,
  GateConfig,
  SecurityBoundaryConfig,
  SecurityBoundaryDetails,
  GateViolation,
  DataAccessPoint,
  UnauthorizedPath,
  CallGraph,
} from '../../types.js';

/**
 * Security Boundary Gate
 * 
 * Checks that sensitive data access has proper authorization.
 */
export class SecurityBoundaryGate extends BaseGate {
  readonly id: GateId = 'security-boundary';
  readonly name = 'Security Boundary';
  readonly description = 'Enforces authorization for sensitive data access';

  protected async executeGate(input: GateInput): Promise<GateResult> {
    const config = input.config as SecurityBoundaryConfig;
    const callGraph = input.context.callGraph;
    
    if (!callGraph || callGraph.nodes.size === 0) {
      return this.createPassedResult(
        'No call graph available for security analysis',
        {
          newSensitiveAccess: [],
          unauthorizedPaths: [],
          tablesAccessed: [],
          authCoverage: 100,
          protectedTablesStatus: {},
        } as unknown as Record<string, unknown>,
        ['No call graph found. Run `drift callgraph build` first.']
      );
    }

    // Analyze security boundaries
    const analysis = this.analyzeSecurityBoundaries(input.files, callGraph, config);

    // Build violations from unauthorized access
    const violations = this.buildViolations(analysis, config);

    // Determine pass/fail based on thresholds
    const passed = this.evaluateThresholds(analysis, config);
    const score = this.calculateScore(analysis);
    const status = passed ? (violations.length > 0 ? 'warned' : 'passed') : 'failed';

    const details: SecurityBoundaryDetails = {
      newSensitiveAccess: analysis.newSensitiveAccess,
      unauthorizedPaths: analysis.unauthorizedPaths,
      tablesAccessed: analysis.tablesAccessed,
      authCoverage: analysis.authCoverage,
      protectedTablesStatus: analysis.protectedTablesStatus,
    };

    const summary = this.buildSummary(analysis, passed);
    const warnings = this.buildWarnings(analysis, config);

    if (!passed) {
      return this.createFailedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    if (violations.length > 0) {
      return this.createWarnedResult(summary, violations, details as unknown as Record<string, unknown>, score, warnings);
    }

    return {
      gateId: this.id,
      gateName: this.name,
      status,
      passed,
      score,
      summary,
      violations,
      warnings,
      executionTimeMs: 0,
      details: details as unknown as Record<string, unknown>,
    };
  }

  validateConfig(config: GateConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const c = config as SecurityBoundaryConfig;

    if (c.maxDataFlowDepth < 1) {
      errors.push('maxDataFlowDepth must be at least 1');
    }

    return { valid: errors.length === 0, errors };
  }

  getDefaultConfig(): SecurityBoundaryConfig {
    return {
      enabled: true,
      blocking: true,
      allowNewSensitiveAccess: false,
      protectedTables: ['users', 'credentials', 'tokens', 'sessions', 'payments'],
      maxDataFlowDepth: 10,
      requiredAuthPatterns: ['requireAuth', 'authenticate', 'authorize', 'checkPermission', 'verifyToken'],
    };
  }

  /**
   * Analyze security boundaries in changed files.
   */
  private analyzeSecurityBoundaries(
    files: string[],
    callGraph: CallGraph,
    config: SecurityBoundaryConfig
  ): {
    newSensitiveAccess: DataAccessPoint[];
    unauthorizedPaths: UnauthorizedPath[];
    tablesAccessed: string[];
    authCoverage: number;
    protectedTablesStatus: Record<string, 'protected' | 'unprotected' | 'partial'>;
  } {
    const newSensitiveAccess: DataAccessPoint[] = [];
    const unauthorizedPaths: UnauthorizedPath[] = [];
    const tablesAccessed = new Set<string>();
    const protectedTablesStatus: Record<string, 'protected' | 'unprotected' | 'partial'> = {};

    // Find functions in changed files
    const changedFunctions = new Set<string>();
    for (const [nodeId, node] of callGraph.nodes) {
      if (files.some(f => node.file.endsWith(f) || f.endsWith(node.file))) {
        changedFunctions.add(nodeId);
      }
    }

    // Analyze each changed function for data access
    for (const funcId of changedFunctions) {
      const node = callGraph.nodes.get(funcId);
      if (!node) {continue;}

      // Check if function accesses sensitive data
      // In full implementation, this would use SemanticDataAccessScanner
      const accessedData = this.detectDataAccess(node.name, node.file);
      
      for (const data of accessedData) {
        tablesAccessed.add(data.table);

        // Check if this is a protected table
        if (config.protectedTables.includes(data.table)) {
          // Check if auth is in call chain
          const hasAuth = this.hasAuthInCallChain(
            funcId,
            callGraph,
            config.requiredAuthPatterns,
            config.maxDataFlowDepth
          );

          newSensitiveAccess.push({
            file: node.file,
            line: data.line,
            dataAccessed: data.table,
            accessType: data.accessType,
            hasAuth,
          });

          if (!hasAuth) {
            // Find the unauthorized path
            const path = this.findUnauthorizedPath(funcId, callGraph, config.maxDataFlowDepth);
            unauthorizedPaths.push({
              entryPoint: path.entryPoint,
              sensitiveData: data.table,
              path: path.path,
              missingAuth: `No ${config.requiredAuthPatterns.join(' or ')} in call chain`,
            });
          }
        }
      }
    }

    // Calculate auth coverage
    const totalAccess = newSensitiveAccess.length;
    const authorizedAccess = newSensitiveAccess.filter(a => a.hasAuth).length;
    const authCoverage = totalAccess > 0 ? (authorizedAccess / totalAccess) * 100 : 100;

    // Determine protected tables status
    for (const table of config.protectedTables) {
      const accessPoints = newSensitiveAccess.filter(a => a.dataAccessed === table);
      if (accessPoints.length === 0) {
        // Not accessed in changed files
        continue;
      }
      
      const allProtected = accessPoints.every(a => a.hasAuth);
      const noneProtected = accessPoints.every(a => !a.hasAuth);
      
      protectedTablesStatus[table] = allProtected ? 'protected' : noneProtected ? 'unprotected' : 'partial';
    }

    return {
      newSensitiveAccess,
      unauthorizedPaths,
      tablesAccessed: Array.from(tablesAccessed),
      authCoverage,
      protectedTablesStatus,
    };
  }

  /**
   * Detect data access in a function (simplified).
   */
  private detectDataAccess(
    _funcName: string,
    _file: string
  ): Array<{ table: string; line: number; accessType: 'read' | 'write' | 'delete' }> {
    // In full implementation, this would use SemanticDataAccessScanner
    // to detect actual data access patterns
    return [];
  }

  /**
   * Check if auth is in the call chain.
   */
  private hasAuthInCallChain(
    funcId: string,
    callGraph: CallGraph,
    authPatterns: string[],
    maxDepth: number
  ): boolean {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: funcId, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (visited.has(nodeId) || depth > maxDepth) {continue;}
      visited.add(nodeId);

      const node = callGraph.nodes.get(nodeId);
      if (!node) {continue;}

      // Check if this function is an auth function
      if (authPatterns.some(pattern => 
        node.name.toLowerCase().includes(pattern.toLowerCase())
      )) {
        return true;
      }

      // Add callers to queue
      for (const edge of callGraph.edges) {
        if (edge.to === nodeId && !visited.has(edge.from)) {
          queue.push({ nodeId: edge.from, depth: depth + 1 });
        }
      }
    }

    return false;
  }

  /**
   * Find the unauthorized path from entry point to function.
   */
  private findUnauthorizedPath(
    funcId: string,
    callGraph: CallGraph,
    maxDepth: number
  ): { entryPoint: string; path: string[] } {
    const path: string[] = [];
    let current = funcId;
    let depth = 0;

    while (depth < maxDepth) {
      const node = callGraph.nodes.get(current);
      if (!node) {break;}

      path.unshift(node.name);

      // Find caller
      const callerEdge = callGraph.edges.find(e => e.to === current);
      if (!callerEdge) {
        // This is an entry point
        return { entryPoint: node.name, path };
      }

      current = callerEdge.from;
      depth++;
    }

    return { entryPoint: path[0] || 'unknown', path };
  }

  /**
   * Evaluate whether the gate passes based on thresholds.
   */
  private evaluateThresholds(
    analysis: {
      newSensitiveAccess: DataAccessPoint[];
      unauthorizedPaths: UnauthorizedPath[];
      authCoverage: number;
    },
    config: SecurityBoundaryConfig
  ): boolean {
    // Fail if new sensitive access is not allowed and we have any
    if (!config.allowNewSensitiveAccess && analysis.newSensitiveAccess.length > 0) {
      // Only fail if there are unauthorized paths
      if (analysis.unauthorizedPaths.length > 0) {
        return false;
      }
    }

    // Fail if any unauthorized paths exist
    if (analysis.unauthorizedPaths.length > 0) {
      return false;
    }

    return true;
  }

  /**
   * Build violations from unauthorized access.
   */
  private buildViolations(
    analysis: {
      newSensitiveAccess: DataAccessPoint[];
      unauthorizedPaths: UnauthorizedPath[];
    },
    _config: SecurityBoundaryConfig
  ): GateViolation[] {
    const violations: GateViolation[] = [];

    // Violation for each unauthorized path
    for (const path of analysis.unauthorizedPaths) {
      violations.push(this.createViolation({
        severity: 'error',
        file: 'project',
        line: 1,
        column: 1,
        message: `Unauthorized access to ${path.sensitiveData}`,
        explanation: `Path: ${path.path.join(' → ')}\n${path.missingAuth}`,
        ruleId: 'security-unauthorized-access',
        suggestedFix: 'Add authentication/authorization middleware to the call chain',
      }));
    }

    // Warning for new sensitive access (even if authorized)
    for (const access of analysis.newSensitiveAccess.filter(a => a.hasAuth)) {
      violations.push(this.createViolation({
        severity: 'info',
        file: access.file,
        line: access.line,
        column: 1,
        message: `New ${access.accessType} access to ${access.dataAccessed}`,
        explanation: 'This access point has proper authorization',
        ruleId: 'security-new-access',
      }));
    }

    return violations;
  }

  /**
   * Calculate score based on analysis.
   */
  private calculateScore(analysis: {
    newSensitiveAccess: DataAccessPoint[];
    unauthorizedPaths: UnauthorizedPath[];
    authCoverage: number;
  }): number {
    // Base score from auth coverage
    let score = analysis.authCoverage;

    // Heavy penalty for unauthorized paths
    score -= analysis.unauthorizedPaths.length * 20;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Build human-readable summary.
   */
  private buildSummary(
    analysis: {
      newSensitiveAccess: DataAccessPoint[];
      unauthorizedPaths: UnauthorizedPath[];
      authCoverage: number;
      tablesAccessed: string[];
    },
    passed: boolean
  ): string {
    if (analysis.newSensitiveAccess.length === 0) {
      return 'No sensitive data access in changed files';
    }

    if (passed) {
      return `Security boundaries intact: ${analysis.authCoverage.toFixed(0)}% auth coverage, ${analysis.tablesAccessed.length} table${analysis.tablesAccessed.length === 1 ? '' : 's'} accessed`;
    }

    return `Security boundary violations: ${analysis.unauthorizedPaths.length} unauthorized path${analysis.unauthorizedPaths.length === 1 ? '' : 's'} to sensitive data`;
  }

  /**
   * Build warnings for the result.
   */
  private buildWarnings(
    analysis: {
      newSensitiveAccess: DataAccessPoint[];
      unauthorizedPaths: UnauthorizedPath[];
      authCoverage: number;
      protectedTablesStatus: Record<string, 'protected' | 'unprotected' | 'partial'>;
    },
    _config: SecurityBoundaryConfig
  ): string[] {
    const warnings: string[] = [];

    // Warn about partial protection
    const partialTables = Object.entries(analysis.protectedTablesStatus)
      .filter(([, status]) => status === 'partial')
      .map(([table]) => table);
    
    if (partialTables.length > 0) {
      warnings.push(`Partial auth coverage for: ${partialTables.join(', ')}`);
    }

    // Warn about low auth coverage
    if (analysis.authCoverage < 100 && analysis.authCoverage > 0) {
      warnings.push(`Auth coverage is ${analysis.authCoverage.toFixed(0)}% (some access points may be intentionally public)`);
    }

    return warnings;
  }
}
