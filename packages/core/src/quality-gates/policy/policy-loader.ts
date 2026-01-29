/**
 * Policy Loader
 * 
 * @license Apache-2.0
 * 
 * Loads quality gate policies from various sources.
 * FUTURE_GATE: gate:policy-engine (Team tier for multiple custom policies)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DEFAULT_POLICIES } from './default-policies.js';

import type { QualityPolicy, GateId, GateConfig } from '../types.js';

/**
 * Loads quality gate policies from various sources.
 */
export class PolicyLoader {
  private policiesDir: string;

  constructor(projectRoot: string) {
    this.policiesDir = path.join(projectRoot, '.drift', 'quality-gates', 'policies');
  }

  /**
   * Load a policy by ID, inline policy object, or default.
   * @param policyIdOrObject - Policy ID string, inline QualityPolicy object, or undefined for default
   */
  async load(policyIdOrObject?: string | QualityPolicy): Promise<QualityPolicy> {
    // If no argument, return default policy
    if (policyIdOrObject === undefined) {
      return DEFAULT_POLICIES['default']!;
    }

    // If it's already a QualityPolicy object, return it directly
    if (typeof policyIdOrObject === 'object') {
      const validation = this.validatePolicy(policyIdOrObject);
      if (!validation.valid) {
        throw new Error(`Invalid policy: ${validation.errors.join(', ')}`);
      }
      return policyIdOrObject;
    }

    // It's a string policy ID
    const policyId = policyIdOrObject;

    // Check built-in policies first
    const builtIn = DEFAULT_POLICIES[policyId];
    if (builtIn) {
      return builtIn;
    }

    // Try to load from custom policies
    const customPath = path.join(this.policiesDir, 'custom', `${policyId}.json`);
    try {
      const content = await fs.readFile(customPath, 'utf-8');
      const policy = JSON.parse(content) as QualityPolicy;
      
      const validation = this.validatePolicy(policy);
      if (!validation.valid) {
        throw new Error(`Invalid policy: ${validation.errors.join(', ')}`);
      }
      
      return policy;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Policy not found: ${policyId}. Available: ${Object.keys(DEFAULT_POLICIES).join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Get the configuration for a specific gate from a policy.
   * @param policy - The policy to get config from
   * @param gateId - The gate ID
   * @returns The gate config or 'skip' if the gate is disabled
   */
  getGateConfig(policy: QualityPolicy, gateId: GateId): GateConfig | 'skip' {
    const gateConfig = policy.gates[gateId];
    return gateConfig;
  }

  /**
   * Check if a gate is enabled in a policy.
   * @param policy - The policy to check
   * @param gateId - The gate ID
   * @returns true if the gate is enabled, false if skipped or disabled
   */
  isGateEnabled(policy: QualityPolicy, gateId: GateId): boolean {
    const gateConfig = policy.gates[gateId];
    if (gateConfig === 'skip') {
      return false;
    }
    return gateConfig.enabled;
  }

  /**
   * Load the appropriate policy for the current context.
   */
  async loadForContext(context: {
    branch: string;
    paths: string[];
    author?: string;
  }): Promise<QualityPolicy> {
    // List all policies
    const policies = await this.listAll();

    // Find matching policy based on scope (most specific first)
    const sortedPolicies = policies.sort((a, b) => {
      // Policies with more specific scopes come first
      const aSpecificity = this.calculateSpecificity(a);
      const bSpecificity = this.calculateSpecificity(b);
      return bSpecificity - aSpecificity;
    });

    for (const policy of sortedPolicies) {
      if (this.matchesScope(policy, context)) {
        return policy;
      }
    }

    // Fall back to default
    return DEFAULT_POLICIES['default']!;
  }

  /**
   * List all available policies.
   */
  async listAll(): Promise<QualityPolicy[]> {
    const policies: QualityPolicy[] = [];

    // Add built-in policies
    policies.push(...Object.values(DEFAULT_POLICIES));

    // Add custom policies
    try {
      const customDir = path.join(this.policiesDir, 'custom');
      const files = await fs.readdir(customDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) {continue;}
        
        try {
          const content = await fs.readFile(path.join(customDir, file), 'utf-8');
          const policy = JSON.parse(content) as QualityPolicy;
          policies.push(policy);
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Custom directory doesn't exist
    }

    return policies;
  }

  /**
   * Save a custom policy.
   */
  async save(policy: QualityPolicy): Promise<void> {
    const validation = this.validatePolicy(policy);
    if (!validation.valid) {
      throw new Error(`Invalid policy: ${validation.errors.join(', ')}`);
    }

    const customDir = path.join(this.policiesDir, 'custom');
    await fs.mkdir(customDir, { recursive: true });

    const filePath = path.join(customDir, `${policy.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(policy, null, 2));
  }

  /**
   * Validate a policy configuration.
   */
  validatePolicy(policy: QualityPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!policy.id) {
      errors.push('Policy must have an id');
    }
    if (!policy.name) {
      errors.push('Policy must have a name');
    }
    if (!policy.gates) {
      errors.push('Policy must have gates configuration');
    }
    if (!policy.aggregation) {
      errors.push('Policy must have aggregation configuration');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Calculate specificity of a policy scope.
   * More specific scopes have higher values.
   */
  private calculateSpecificity(policy: QualityPolicy): number {
    let specificity = 0;
    const scope = policy.scope;

    if (scope.branches && scope.branches.length > 0) {specificity += 10;}
    if (scope.paths && scope.paths.length > 0) {specificity += 5;}
    if (scope.authors && scope.authors.length > 0) {specificity += 3;}
    if (scope.includeFiles && scope.includeFiles.length > 0) {specificity += 2;}
    if (scope.excludeFiles && scope.excludeFiles.length > 0) {specificity += 1;}

    return specificity;
  }

  /**
   * Check if a policy matches the given context.
   */
  private matchesScope(
    policy: QualityPolicy,
    context: { branch: string; paths: string[]; author?: string }
  ): boolean {
    const scope = policy.scope;

    // Empty scope matches everything
    if (!scope.branches && !scope.paths && !scope.authors) {
      return true;
    }

    // Check branch
    if (scope.branches && scope.branches.length > 0) {
      const branchMatches = scope.branches.some(pattern => 
        this.matchGlob(context.branch, pattern)
      );
      if (!branchMatches) {return false;}
    }

    // Check paths
    if (scope.paths && scope.paths.length > 0) {
      const pathMatches = context.paths.some(p =>
        scope.paths!.some(pattern => this.matchGlob(p, pattern))
      );
      if (!pathMatches) {return false;}
    }

    // Check author
    if (scope.authors && scope.authors.length > 0 && context.author) {
      const authorMatches = scope.authors.some(pattern =>
        this.matchGlob(context.author!, pattern)
      );
      if (!authorMatches) {return false;}
    }

    return true;
  }

  /**
   * Simple glob matching.
   */
  private matchGlob(value: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*')                  // * -> .*
      .replace(/\?/g, '.');                  // ? -> .
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }
}
