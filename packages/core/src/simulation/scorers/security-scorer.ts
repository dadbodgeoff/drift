/**
 * Security Scorer
 *
 * Calculates security metrics for an approach using reachability analysis:
 * - Security risk score
 * - Data access implications
 * - Auth implications
 * - Security warnings
 *
 * @module simulation/scorers/security-scorer
 */

import { ReachabilityEngine } from '../../call-graph/analysis/reachability.js';

import type { CallGraph } from '../../call-graph/types.js';
import type {
  SimulationApproach,
  SecurityMetrics,
  DataAccessImplication,
  SecurityWarning,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface SecurityScorerConfig {
  projectRoot: string;
  callGraph?: CallGraph | undefined;
  maxDepth?: number | undefined;
}

// ============================================================================
// Security Scorer
// ============================================================================

/**
 * Scores the security implications of an approach
 */
export class SecurityScorer {
  private readonly config: SecurityScorerConfig;
  private reachabilityEngine: ReachabilityEngine | null = null;

  constructor(config: SecurityScorerConfig) {
    this.config = config;
    if (config.callGraph) {
      this.reachabilityEngine = new ReachabilityEngine(config.callGraph);
    }
  }

  /**
   * Calculate security metrics for an approach
   */
  async score(approach: SimulationApproach): Promise<SecurityMetrics> {
    // If no call graph, estimate from approach metadata
    if (!this.reachabilityEngine || !this.config.callGraph) {
      return this.estimateSecurity(approach);
    }

    // Analyze data access implications
    const dataAccessImplications = this.analyzeDataAccess(approach);

    // Analyze auth implications
    const authImplications = this.analyzeAuthImplications(approach);

    // Generate security warnings
    const warnings = this.generateWarnings(approach, dataAccessImplications, authImplications);

    // Calculate security risk score
    const securityRisk = this.calculateSecurityRisk(
      dataAccessImplications,
      authImplications,
      warnings
    );

    return {
      securityRisk,
      dataAccessImplications,
      authImplications,
      warnings,
    };
  }

  // ==========================================================================
  // Data Access Analysis
  // ==========================================================================

  /**
   * Analyze data access implications of the approach
   */
  private analyzeDataAccess(approach: SimulationApproach): DataAccessImplication[] {
    if (!this.reachabilityEngine) {
      return [];
    }

    const implications: DataAccessImplication[] = [];
    const seenAccess = new Set<string>();

    // For each target file, find reachable data
    for (const file of approach.targetFiles) {
      // Find functions in this file
      const functions = this.getFunctionsInFile(file);

      for (const funcId of functions) {
        const result = this.reachabilityEngine.getReachableDataFromFunction(funcId, {
          maxDepth: this.config.maxDepth ?? 10,
          sensitiveOnly: false,
        });

        // Collect data access
        for (const access of result.reachableAccess) {
          const key = `${access.access.table}:${access.access.fields.join(',')}:${access.access.operation}`;
          if (seenAccess.has(key)) {continue;}
          seenAccess.add(key);

          const sensitivity = this.classifySensitivity(access.access.table, access.access.fields);
          
          const implication: DataAccessImplication = {
            table: access.access.table,
            fields: access.access.fields,
            operation: access.access.operation,
            sensitivity,
          };
          
          const throughFunc = access.path[access.path.length - 1]?.functionName;
          if (throughFunc) {
            implication.throughFunction = throughFunc;
          }
          
          implications.push(implication);
        }
      }
    }

    return implications;
  }

  /**
   * Get function IDs in a file
   */
  private getFunctionsInFile(file: string): string[] {
    if (!this.config.callGraph) {return [];}

    const functions: string[] = [];
    for (const [id, func] of this.config.callGraph.functions) {
      if (func.file === file) {
        functions.push(id);
      }
    }
    return functions;
  }

  /**
   * Classify sensitivity of data access
   */
  private classifySensitivity(
    table: string,
    fields: string[]
  ): DataAccessImplication['sensitivity'] {
    const text = `${table} ${fields.join(' ')}`.toLowerCase();

    if (/password|secret|token|api_key|private_key|auth_token|refresh_token/.test(text)) {
      return 'credentials';
    }
    if (/credit_card|card_number|cvv|bank|account_number|salary|income|payment|billing|stripe/.test(text)) {
      return 'financial';
    }
    if (/diagnosis|medical|health|prescription|insurance|hipaa|patient/.test(text)) {
      return 'health';
    }
    if (/ssn|social_security|email|phone|address|dob|birth|name|user/.test(text)) {
      return 'pii';
    }

    return 'unknown';
  }

  // ==========================================================================
  // Auth Analysis
  // ==========================================================================

  /**
   * Analyze authentication/authorization implications
   */
  private analyzeAuthImplications(approach: SimulationApproach): string[] {
    const implications: string[] = [];

    // Check if approach affects auth-related code
    const authKeywords = ['auth', 'login', 'session', 'token', 'jwt', 'permission', 'role', 'guard'];
    
    for (const file of approach.targetFiles) {
      const fileLower = file.toLowerCase();
      for (const keyword of authKeywords) {
        if (fileLower.includes(keyword)) {
          implications.push(`Modifies auth-related file: ${file}`);
          break;
        }
      }
    }

    // Check strategy-specific auth implications
    if (approach.strategy === 'guard' || approach.strategy === 'policy') {
      implications.push('Implements authorization logic');
    }

    if (approach.strategy === 'middleware') {
      implications.push('May intercept requests before auth checks');
    }

    // Check if approach is for auth-related task
    if (approach.followsPatterns?.some(p => p.toLowerCase().includes('auth'))) {
      implications.push('Follows authentication/authorization patterns');
    }

    return implications;
  }

  // ==========================================================================
  // Warning Generation
  // ==========================================================================

  /**
   * Generate security warnings
   */
  private generateWarnings(
    approach: SimulationApproach,
    dataAccess: DataAccessImplication[],
    authImplications: string[]
  ): SecurityWarning[] {
    const warnings: SecurityWarning[] = [];

    // Warn about credential access
    const credentialAccess = dataAccess.filter(d => d.sensitivity === 'credentials');
    if (credentialAccess.length > 0) {
      warnings.push({
        type: 'credential-access',
        message: `Approach may access ${credentialAccess.length} credential field(s)`,
        severity: 'critical',
        recommendation: 'Ensure proper encryption and access controls',
      });
    }

    // Warn about financial data
    const financialAccess = dataAccess.filter(d => d.sensitivity === 'financial');
    if (financialAccess.length > 0) {
      warnings.push({
        type: 'financial-data',
        message: `Approach may access ${financialAccess.length} financial field(s)`,
        severity: 'high',
        recommendation: 'Ensure PCI-DSS compliance',
      });
    }

    // Warn about health data
    const healthAccess = dataAccess.filter(d => d.sensitivity === 'health');
    if (healthAccess.length > 0) {
      warnings.push({
        type: 'health-data',
        message: `Approach may access ${healthAccess.length} health-related field(s)`,
        severity: 'high',
        recommendation: 'Ensure HIPAA compliance',
      });
    }

    // Warn about PII
    const piiAccess = dataAccess.filter(d => d.sensitivity === 'pii');
    if (piiAccess.length > 0) {
      warnings.push({
        type: 'pii-access',
        message: `Approach may access ${piiAccess.length} PII field(s)`,
        severity: 'medium',
        recommendation: 'Ensure GDPR/privacy compliance',
      });
    }

    // Warn about auth modifications
    if (authImplications.length > 0) {
      warnings.push({
        type: 'auth-modification',
        message: 'Approach modifies authentication/authorization code',
        severity: 'high',
        recommendation: 'Review security implications carefully',
      });
    }

    // Warn about distributed changes
    if (approach.strategy === 'distributed' || approach.strategy === 'per-function') {
      warnings.push({
        type: 'distributed-security',
        message: 'Distributed approach may have inconsistent security enforcement',
        severity: 'medium',
        recommendation: 'Consider centralized security checks',
      });
    }

    // Warn about write operations
    const writeOps = dataAccess.filter(d => d.operation === 'write' || d.operation === 'delete');
    if (writeOps.length > 0) {
      warnings.push({
        type: 'data-modification',
        message: `Approach may modify/delete data in ${writeOps.length} location(s)`,
        severity: 'medium',
        recommendation: 'Ensure proper validation and audit logging',
      });
    }

    return warnings;
  }

  // ==========================================================================
  // Risk Calculation
  // ==========================================================================

  /**
   * Calculate overall security risk score (0-100)
   */
  private calculateSecurityRisk(
    dataAccess: DataAccessImplication[],
    authImplications: string[],
    warnings: SecurityWarning[]
  ): number {
    let score = 0;

    // Score based on data sensitivity
    for (const access of dataAccess) {
      switch (access.sensitivity) {
        case 'credentials':
          score += 25;
          break;
        case 'financial':
          score += 20;
          break;
        case 'health':
          score += 18;
          break;
        case 'pii':
          score += 10;
          break;
      }
    }

    // Score based on auth implications
    score += authImplications.length * 10;

    // Score based on warnings
    for (const warning of warnings) {
      switch (warning.severity) {
        case 'critical':
          score += 15;
          break;
        case 'high':
          score += 10;
          break;
        case 'medium':
          score += 5;
          break;
        case 'low':
          score += 2;
          break;
      }
    }

    return Math.min(100, Math.round(score));
  }

  // ==========================================================================
  // Estimation (when no call graph)
  // ==========================================================================

  /**
   * Estimate security when call graph is not available
   */
  private estimateSecurity(approach: SimulationApproach): SecurityMetrics {
    const warnings: SecurityWarning[] = [];
    const authImplications: string[] = [];

    // Check file names for security-related code
    const securityKeywords = ['auth', 'security', 'password', 'token', 'session', 'permission'];
    for (const file of approach.targetFiles) {
      const fileLower = file.toLowerCase();
      for (const keyword of securityKeywords) {
        if (fileLower.includes(keyword)) {
          authImplications.push(`May affect security-related file: ${file}`);
          break;
        }
      }
    }

    // Add general warning
    if (authImplications.length > 0) {
      warnings.push({
        type: 'security-files',
        message: 'Approach affects security-related files',
        severity: 'medium',
        recommendation: 'Review security implications (call graph not available for detailed analysis)',
      });
    }

    // Calculate basic risk score
    let securityRisk = 0;
    securityRisk += authImplications.length * 15;
    securityRisk += approach.targetFiles.length * 2;

    // Strategy-based risk
    const strategyRisk: Record<string, number> = {
      guard: 20,
      policy: 20,
      middleware: 15,
      interceptor: 15,
      filter: 10,
      decorator: 10,
      wrapper: 10,
      custom: 15,
    };
    securityRisk += strategyRisk[approach.strategy] ?? 5;

    return {
      securityRisk: Math.min(100, securityRisk),
      dataAccessImplications: [],
      authImplications,
      warnings,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a security scorer
 */
export function createSecurityScorer(config: SecurityScorerConfig): SecurityScorer {
  return new SecurityScorer(config);
}
