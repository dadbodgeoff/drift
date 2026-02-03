/**
 * Gate Orchestrator
 * 
 * @license Apache-2.0
 * 
 * Main orchestrator for quality gates.
 * Coordinates gate execution and aggregates results.
 */

import { GateRegistry, getGateRegistry } from './gate-registry.js';
import { ParallelExecutor } from './parallel-executor.js';
import { ResultAggregator } from './result-aggregator.js';
import { PolicyEvaluator } from '../policy/policy-evaluator.js';
import { PolicyLoader } from '../policy/policy-loader.js';

import type {
  QualityGateOptions,
  QualityGateResult,
  QualityPolicy,
  GateId,
  GateResult,
  GateInput,
  GateContext,
  Pattern,
  Constraint,
  CallGraph,
  HealthSnapshot,
  CustomRule,
} from '../types.js';

/**
 * Main orchestrator for quality gates.
 * Coordinates gate execution and aggregates results.
 */
export class GateOrchestrator {
  private registry: GateRegistry;
  private executor: ParallelExecutor;
  private aggregator: ResultAggregator;
  private policyLoader: PolicyLoader;
  private policyEvaluator: PolicyEvaluator;
  // projectRoot is stored for future use when integrating with data stores
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.registry = getGateRegistry();
    this.executor = new ParallelExecutor();
    this.aggregator = new ResultAggregator();
    this.policyLoader = new PolicyLoader(projectRoot);
    this.policyEvaluator = new PolicyEvaluator();
  }

  /**
   * Run quality gates with the given options.
   */
  async run(options: QualityGateOptions): Promise<QualityGateResult> {
    const startTime = Date.now();

    // Ensure registry is initialized before proceeding
    await this.registry.list();

    // Load policy first (needed for empty result too)
    const policy = await this.loadPolicy(options);

    // Resolve files to check
    const files = await this.resolveFiles(options);
    
    // Determine which gates to run
    const gatesToRun = this.determineGates(options, policy);

    if (files.length === 0) {
      return this.createEmptyResult(options, startTime, policy, gatesToRun);
    }

    if (gatesToRun.length === 0) {
      return this.createEmptyResult(options, startTime, policy, [], 'No gates enabled in policy');
    }

    // Build shared context
    const context = await this.buildContext(options, policy);

    // Execute gates
    const gateResults = await this.executeGates(
      gatesToRun,
      files,
      options,
      policy,
      context
    );

    // Evaluate policy
    const evaluation = this.policyEvaluator.evaluate(gateResults, policy);

    // Aggregate results
    const result = this.aggregator.aggregate(
      gateResults,
      evaluation,
      policy,
      {
        files,
        startTime,
        options,
      }
    );

    // Save to history if configured
    if (options.saveHistory !== false) {
      await this.saveToHistory(result, options);
    }

    return result;
  }

  /**
   * Resolve files to check.
   */
  private async resolveFiles(options: QualityGateOptions): Promise<string[]> {
    if (options.files && options.files.length > 0) {
      return options.files;
    }

    // Default to all files if none specified
    // In a real implementation, this would use git to get staged/changed files
    return [];
  }

  /**
   * Load the appropriate policy.
   */
  private async loadPolicy(options: QualityGateOptions): Promise<QualityPolicy> {
    if (typeof options.policy === 'object') {
      return options.policy;
    }

    if (typeof options.policy === 'string') {
      return this.policyLoader.load(options.policy);
    }

    // Auto-detect based on context
    return this.policyLoader.loadForContext({
      branch: options.branch ?? 'main',
      paths: options.files ?? [],
    });
  }

  /**
   * Determine which gates to run.
   */
  private determineGates(
    options: QualityGateOptions,
    policy: QualityPolicy
  ): GateId[] {
    // If specific gates requested, use those
    if (options.gates && options.gates.length > 0) {
      return options.gates;
    }

    // Otherwise, use gates from policy
    const gates: GateId[] = [];
    for (const [gateId, config] of Object.entries(policy.gates)) {
      if (config !== 'skip' && config.enabled) {
        gates.push(gateId as GateId);
      }
    }

    return gates;
  }

  /**
   * Build shared context for gates.
   */
  private async buildContext(
    options: QualityGateOptions,
    policy: QualityPolicy
  ): Promise<GateContext> {
    const context: GateContext = {};

    // Load patterns if any gate needs them
    const needsPatterns = this.gatesNeed(policy, ['pattern-compliance', 'regression-detection']);
    if (needsPatterns) {
      context.patterns = await this.loadPatterns();
    }

    // Load constraints if needed
    const needsConstraints = this.gatesNeed(policy, ['constraint-verification']);
    if (needsConstraints) {
      context.constraints = await this.loadConstraints();
    }

    // Load call graph if needed
    const needsCallGraph = this.gatesNeed(policy, ['impact-simulation', 'security-boundary']);
    if (needsCallGraph) {
      const callGraph = await this.loadCallGraph();
      if (callGraph) {
        context.callGraph = callGraph;
      }
    }

    // Load previous snapshot if needed
    const needsSnapshot = this.gatesNeed(policy, ['regression-detection']);
    if (needsSnapshot) {
      const snapshot = await this.loadPreviousSnapshot(options);
      if (snapshot) {
        context.previousSnapshot = snapshot;
      }
    }

    // Load custom rules if needed
    const needsRules = this.gatesNeed(policy, ['custom-rules']);
    if (needsRules) {
      context.customRules = await this.loadCustomRules(policy);
    }

    return context;
  }

  /**
   * Check if any of the specified gates are enabled.
   */
  private gatesNeed(policy: QualityPolicy, gateIds: GateId[]): boolean {
    for (const gateId of gateIds) {
      const config = policy.gates[gateId];
      if (config !== 'skip' && config.enabled) {
        return true;
      }
    }
    return false;
  }

  /**
   * Execute gates in parallel where possible.
   */
  private async executeGates(
    gatesToRun: GateId[],
    files: string[],
    options: QualityGateOptions,
    policy: QualityPolicy,
    context: GateContext
  ): Promise<Record<GateId, GateResult>> {
    const results: Record<GateId, GateResult> = {} as Record<GateId, GateResult>;

    // Build inputs for each gate
    const inputs: Array<{ gateId: GateId; input: GateInput }> = [];
    for (const gateId of gatesToRun) {
      const config = policy.gates[gateId];
      if (config === 'skip') {continue;}

      inputs.push({
        gateId,
        input: {
          files,
          projectRoot: options.projectRoot,
          branch: options.branch ?? 'main',
          baseBranch: options.baseBranch,
          commitSha: options.commitSha,
          isCI: options.ci ?? false,
          config,
          context,
        } as GateInput,
      });
    }

    // Execute in parallel
    const gateResults = await this.executor.execute(inputs, this.registry);

    // Map results
    for (const { gateId, result } of gateResults) {
      results[gateId] = result;
    }

    return results;
  }

  /**
   * Create result for empty file list or no gates.
   */
  private createEmptyResult(
    options: QualityGateOptions,
    startTime: number,
    policy: QualityPolicy,
    gatesToRun: GateId[] = [],
    reason = 'No files to check'
  ): QualityGateResult {
    const result: QualityGateResult = {
      passed: true,
      status: 'passed',
      score: 100,
      summary: reason,
      gates: {} as Record<GateId, GateResult>,
      violations: [],
      warnings: [reason],
      policy: { id: policy.id, name: policy.name },
      metadata: {
        executionTimeMs: Date.now() - startTime,
        filesChecked: 0,
        gatesRun: gatesToRun,
        gatesSkipped: [],
        timestamp: new Date().toISOString(),
        branch: options.branch ?? 'main',
        ci: options.ci ?? false,
      },
      exitCode: 0,
    };
    
    if (options.commitSha) {
      result.metadata.commitSha = options.commitSha;
    }
    
    return result;
  }

  // =========================================================================
  // Data Loading Methods
  // These integrate with existing Drift services when available
  // =========================================================================

  /**
   * Load patterns from the pattern store.
   */
  private async loadPatterns(): Promise<Pattern[]> {
    try {
      // Dynamically import to avoid circular dependencies
      const { createPatternStore } = await import('../../storage/store-factory.js');
      const { createPatternServiceFromStore } = await import('../../patterns/adapters/service-factory.js');
      const { PatternStore } = await import('../../store/pattern-store.js');
      
      const store = await createPatternStore({ rootDir: this.projectRoot });
      
      // Cast to PatternStore for service factory compatibility
      // The factory returns either PatternStore or HybridPatternStore, both implement the interface
      const service = createPatternServiceFromStore(store as InstanceType<typeof PatternStore>, this.projectRoot);
      
      // Get approved patterns (summaries first)
      const result = await service.listByStatus('approved', { limit: 1000 });
      
      // Fetch full pattern data for each pattern (needed for locations/outliers)
      const patterns: Pattern[] = [];
      for (const summary of result.items) {
        const full = await service.getPattern(summary.id);
        if (full) {
          patterns.push({
            id: full.id,
            name: full.name,
            category: full.category,
            status: full.status,
            confidence: full.confidence,
            locations: full.locations ?? [],
            outliers: full.outliers ?? [],
          });
        }
      }
      
      // Close store if it has a close method
      if (store.close) {
        await store.close();
      }
      
      return patterns;
    } catch {
      // Pattern service not available, return empty array
      return [];
    }
  }

  /**
   * Load constraints from the constraint store.
   */
  private async loadConstraints(): Promise<Constraint[]> {
    // Constraints will be loaded by the orchestrator when constraint store is available
    // For now, return empty array - constraints can be passed via context
    return [];
  }

  /**
   * Load call graph from the call graph analyzer.
   */
  private async loadCallGraph(): Promise<CallGraph | undefined> {
    // Call graph will be loaded by the orchestrator when call graph store is available
    // For now, return undefined - call graph can be passed via context
    return undefined;
  }

  /**
   * Load previous snapshot for regression detection.
   */
  private async loadPreviousSnapshot(_options: QualityGateOptions): Promise<HealthSnapshot | undefined> {
    // Snapshots will be loaded by the orchestrator when snapshot store is available
    // For now, return undefined - snapshot can be passed via context
    return undefined;
  }

  /**
   * Load custom rules from policy configuration.
   */
  private async loadCustomRules(policy: QualityPolicy): Promise<CustomRule[]> {
    const rulesConfig = policy.gates['custom-rules'];
    if (rulesConfig === 'skip' || !rulesConfig.enabled) {
      return [];
    }

    const rules: CustomRule[] = [];

    // Add inline rules
    if (rulesConfig.inlineRules) {
      rules.push(...rulesConfig.inlineRules);
    }

    // Load rules from files would be implemented in the custom rules gate
    
    return rules;
  }

  /**
   * Save result to history.
   */
  private async saveToHistory(_result: QualityGateResult, _options: QualityGateOptions): Promise<void> {
    // History saving will be implemented when gate run store is integrated
    // For now, this is a no-op
  }
}
