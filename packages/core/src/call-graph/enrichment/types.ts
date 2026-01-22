/**
 * Enrichment Engine Types
 *
 * Enterprise-grade types for security finding enrichment.
 * Transforms raw vulnerability findings into actionable intelligence
 * by connecting them to their actual data impact through call graph analysis.
 */

import type { DataAccessPoint, SensitiveField, SensitivityType, DataOperation } from '../../boundaries/types.js';
import type { CallPathNode } from '../types.js';

// ============================================================================
// Input Types - Security Findings
// ============================================================================

/**
 * Severity levels following CVSS-like classification
 */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Finding categories aligned with CWE/OWASP
 */
export type FindingCategory =
  | 'injection'           // SQL, NoSQL, Command, LDAP injection
  | 'broken-auth'         // Authentication/session issues
  | 'sensitive-exposure'  // Data exposure, logging secrets
  | 'xxe'                 // XML External Entities
  | 'broken-access'       // Authorization issues
  | 'misconfig'           // Security misconfiguration
  | 'xss'                 // Cross-site scripting
  | 'deserialization'     // Insecure deserialization
  | 'components'          // Vulnerable dependencies
  | 'logging'             // Insufficient logging
  | 'ssrf'                // Server-side request forgery
  | 'other';

/**
 * A security finding from any scanner (SAST, DAST, SCA, etc.)
 * Designed to be scanner-agnostic - can ingest from Semgrep, CodeQL, Snyk, etc.
 */
export interface SecurityFinding {
  /** Unique finding identifier */
  id: string;
  /** Rule/check that triggered this finding */
  ruleId: string;
  /** Human-readable title */
  title: string;
  /** Detailed description */
  description: string;
  /** Finding category */
  category: FindingCategory;
  /** Severity level */
  severity: FindingSeverity;
  /** Source file */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column?: number | undefined;
  /** End line (for multi-line findings) */
  endLine?: number | undefined;
  /** End column */
  endColumn?: number | undefined;
  /** Code snippet at the finding location */
  snippet?: string | undefined;
  /** CWE identifiers */
  cwe?: string[] | undefined;
  /** OWASP category */
  owasp?: string[] | undefined;
  /** CVE if applicable (for dependency vulnerabilities) */
  cve?: string | undefined;
  /** CVSS score if available */
  cvss?: number | undefined;
  /** Scanner that produced this finding */
  scanner?: string | undefined;
  /** Scanner-specific metadata */
  metadata?: Record<string, unknown> | undefined;
}

// ============================================================================
// Data Impact Analysis
// ============================================================================

/**
 * Classification of data sensitivity for impact scoring
 */
export interface DataSensitivityProfile {
  /** Sensitivity type */
  type: SensitivityType;
  /** Regulatory implications */
  regulations: DataRegulation[];
  /** Base impact score (0-100) */
  baseScore: number;
  /** Description of why this is sensitive */
  rationale: string;
}

/**
 * Regulatory frameworks that may apply
 */
export type DataRegulation =
  | 'gdpr'           // EU General Data Protection Regulation
  | 'ccpa'           // California Consumer Privacy Act
  | 'hipaa'          // Health Insurance Portability and Accountability Act
  | 'pci-dss'        // Payment Card Industry Data Security Standard
  | 'sox'            // Sarbanes-Oxley Act
  | 'ferpa'          // Family Educational Rights and Privacy Act
  | 'glba'           // Gramm-Leach-Bliley Act
  | 'coppa'          // Children's Online Privacy Protection Act
  | 'lgpd'           // Brazil's General Data Protection Law
  | 'pipeda';        // Canada's Personal Information Protection

/**
 * A single data access that can be reached from a vulnerability
 */
export interface ReachableData {
  /** The data access point */
  access: DataAccessPoint;
  /** Call path from vulnerability to this access */
  callPath: CallPathNode[];
  /** Depth in call graph */
  depth: number;
  /** Sensitive fields accessed */
  sensitiveFields: SensitiveField[];
  /** Operations performed */
  operations: DataOperation[];
  /** Impact score for this specific access (0-100) */
  impactScore: number;
  /** Why this access matters */
  impactRationale: string;
}

/**
 * Aggregated data impact from a vulnerability
 */
export interface DataImpact {
  /** All tables that can be reached */
  tables: string[];
  /** All sensitive fields that can be reached */
  sensitiveFields: SensitiveFieldImpact[];
  /** Detailed reachable data with paths */
  reachableData: ReachableData[];
  /** Maximum call depth to reach data */
  maxDepth: number;
  /** Total functions in attack surface */
  attackSurfaceSize: number;
  /** Regulatory implications */
  regulations: DataRegulation[];
  /** Overall data impact score (0-100) */
  score: number;
  /** Impact classification */
  classification: ImpactClassification;
}

/**
 * Sensitive field with impact analysis
 */
export interface SensitiveFieldImpact {
  /** Field information */
  field: SensitiveField;
  /** Number of paths to reach this field */
  pathCount: number;
  /** Shortest path depth */
  shortestPath: number;
  /** Operations that can be performed */
  operations: DataOperation[];
  /** Regulatory implications for this field */
  regulations: DataRegulation[];
  /** Impact score for this field (0-100) */
  impactScore: number;
}

/**
 * Impact classification levels
 */
export type ImpactClassification =
  | 'catastrophic'  // 90-100: Mass PII exposure, credentials, financial data
  | 'severe'        // 70-89: Significant sensitive data exposure
  | 'significant'   // 50-69: Moderate sensitive data exposure
  | 'moderate'      // 30-49: Limited sensitive data exposure
  | 'minimal'       // 10-29: Non-sensitive data exposure
  | 'none';         // 0-9: No data access detected

// ============================================================================
// Blast Radius Analysis
// ============================================================================

/**
 * Blast radius - what else could be affected by exploiting this vulnerability
 */
export interface BlastRadius {
  /** Entry points that can reach this vulnerability */
  entryPoints: EntryPointInfo[];
  /** Other vulnerabilities that share code paths */
  relatedVulnerabilities: string[];
  /** Functions in the blast radius */
  affectedFunctions: AffectedFunction[];
  /** Total lines of code in blast radius */
  linesOfCode: number;
  /** Blast radius score (0-100) */
  score: number;
  /** Classification */
  classification: BlastRadiusClassification;
}

/**
 * Entry point information
 */
export interface EntryPointInfo {
  /** Function ID */
  functionId: string;
  /** Function name */
  name: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Entry point type */
  type: EntryPointType;
  /** Is this publicly accessible? */
  isPublic: boolean;
  /** Authentication required? */
  requiresAuth: boolean;
  /** Path to vulnerability */
  pathToVulnerability: CallPathNode[];
}

/**
 * Entry point types
 */
export type EntryPointType =
  | 'api-endpoint'      // REST/GraphQL endpoint
  | 'web-route'         // Web page route
  | 'message-handler'   // Queue/event handler
  | 'scheduled-job'     // Cron/scheduled task
  | 'cli-command'       // CLI entry point
  | 'exported-function' // Library export
  | 'main';             // Main entry point

/**
 * A function affected by the vulnerability
 */
export interface AffectedFunction {
  /** Function ID */
  functionId: string;
  /** Function name */
  name: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** How this function is affected */
  affectedBy: 'direct' | 'caller' | 'callee';
  /** Distance from vulnerability */
  distance: number;
}

/**
 * Blast radius classification
 */
export type BlastRadiusClassification =
  | 'critical'    // Public API, no auth, wide reach
  | 'high'        // Public API with auth, or internal with wide reach
  | 'medium'      // Internal API, moderate reach
  | 'low'         // Limited internal reach
  | 'contained';  // Isolated, minimal reach

// ============================================================================
// Enriched Finding
// ============================================================================

/**
 * Priority score components
 */
export interface PriorityScore {
  /** Overall priority score (0-100) */
  overall: number;
  /** Severity component */
  severityScore: number;
  /** Data impact component */
  dataImpactScore: number;
  /** Blast radius component */
  blastRadiusScore: number;
  /** Exploitability component */
  exploitabilityScore: number;
  /** Priority tier */
  tier: PriorityTier;
  /** Factors that increased priority */
  increasingFactors: string[];
  /** Factors that decreased priority */
  decreasingFactors: string[];
}

/**
 * Priority tiers for remediation
 */
export type PriorityTier =
  | 'P0'  // Fix immediately - active exploitation risk
  | 'P1'  // Fix within 24 hours - critical exposure
  | 'P2'  // Fix within 1 week - significant risk
  | 'P3'  // Fix within 1 month - moderate risk
  | 'P4'; // Fix when convenient - low risk

/**
 * Remediation guidance
 */
export interface RemediationGuidance {
  /** Short summary of what to fix */
  summary: string;
  /** Detailed steps */
  steps: RemediationStep[];
  /** Code examples */
  codeExamples: CodeExample[];
  /** Estimated effort */
  effort: RemediationEffort;
  /** Related documentation */
  references: Reference[];
}

/**
 * A remediation step
 */
export interface RemediationStep {
  /** Step number */
  order: number;
  /** Step description */
  description: string;
  /** File to modify (if applicable) */
  file?: string | undefined;
  /** Line to modify (if applicable) */
  line?: number | undefined;
}

/**
 * Code example for remediation
 */
export interface CodeExample {
  /** Description of the example */
  description: string;
  /** Language */
  language: string;
  /** The vulnerable code */
  vulnerable: string;
  /** The fixed code */
  fixed: string;
}

/**
 * Remediation effort estimate
 */
export interface RemediationEffort {
  /** Estimated time */
  time: 'minutes' | 'hours' | 'days' | 'weeks';
  /** Complexity */
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'architectural';
  /** Risk of regression */
  regressionRisk: 'low' | 'medium' | 'high';
}

/**
 * Reference documentation
 */
export interface Reference {
  /** Reference title */
  title: string;
  /** URL */
  url: string;
  /** Reference type */
  type: 'documentation' | 'cwe' | 'owasp' | 'blog' | 'advisory';
}

/**
 * The fully enriched security finding
 */
export interface EnrichedFinding {
  /** Original finding */
  finding: SecurityFinding;
  /** Data impact analysis */
  dataImpact: DataImpact;
  /** Blast radius analysis */
  blastRadius: BlastRadius;
  /** Priority score */
  priority: PriorityScore;
  /** Remediation guidance */
  remediation: RemediationGuidance;
  /** Enrichment metadata */
  enrichment: EnrichmentMetadata;
}

/**
 * Metadata about the enrichment process
 */
export interface EnrichmentMetadata {
  /** When enrichment was performed */
  enrichedAt: string;
  /** Enrichment engine version */
  engineVersion: string;
  /** Call graph version used */
  callGraphVersion: string;
  /** Confidence in the enrichment (0-1) */
  confidence: number;
  /** Warnings or limitations */
  warnings: string[];
  /** Processing time in ms */
  processingTimeMs: number;
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Options for batch enrichment
 */
export interface EnrichmentOptions {
  /** Maximum call depth to traverse */
  maxDepth?: number | undefined;
  /** Include unresolved calls in analysis */
  includeUnresolved?: boolean | undefined;
  /** Minimum confidence for data access */
  minConfidence?: number | undefined;
  /** Custom sensitivity mappings */
  sensitivityOverrides?: Record<string, SensitivityType> | undefined;
  /** Custom regulation mappings */
  regulationOverrides?: Record<string, DataRegulation[]> | undefined;
  /** Skip blast radius analysis (faster) */
  skipBlastRadius?: boolean | undefined;
  /** Skip remediation guidance (faster) */
  skipRemediation?: boolean | undefined;
  /** Parallel processing limit */
  parallelLimit?: number | undefined;
}

/**
 * Result of batch enrichment
 */
export interface EnrichmentResult {
  /** Enriched findings */
  findings: EnrichedFinding[];
  /** Summary statistics */
  summary: EnrichmentSummary;
  /** Processing metadata */
  metadata: BatchMetadata;
}

/**
 * Summary of enrichment results
 */
export interface EnrichmentSummary {
  /** Total findings processed */
  totalFindings: number;
  /** Findings by priority tier */
  byPriority: Record<PriorityTier, number>;
  /** Findings by impact classification */
  byImpact: Record<ImpactClassification, number>;
  /** Findings by category */
  byCategory: Record<FindingCategory, number>;
  /** Total sensitive fields at risk */
  sensitiveFieldsAtRisk: number;
  /** Total tables at risk */
  tablesAtRisk: number;
  /** Regulations implicated */
  regulationsImplicated: DataRegulation[];
  /** Top priority findings */
  topPriority: EnrichedFinding[];
}

/**
 * Batch processing metadata
 */
export interface BatchMetadata {
  /** Processing start time */
  startedAt: string;
  /** Processing end time */
  completedAt: string;
  /** Total processing time in ms */
  totalTimeMs: number;
  /** Average time per finding in ms */
  avgTimePerFindingMs: number;
  /** Findings that failed enrichment */
  failures: EnrichmentFailure[];
}

/**
 * Enrichment failure information
 */
export interface EnrichmentFailure {
  /** Finding ID */
  findingId: string;
  /** Error message */
  error: string;
  /** Error type */
  type: 'not-found' | 'parse-error' | 'timeout' | 'unknown';
}
