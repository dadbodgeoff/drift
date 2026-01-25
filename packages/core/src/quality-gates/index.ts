/**
 * Quality Gates System
 * 
 * @license Apache-2.0
 * 
 * Enterprise-grade quality gates for code changes.
 * Checks pattern compliance, constraint verification, regression detection,
 * impact simulation, security boundaries, and custom rules.
 * 
 * LICENSING NOTE: All features are available to all users initially.
 * The licensing infrastructure is in place but NOT enforced.
 * See FUTURE_GATE comments in types.ts for where license checks should be added.
 */

// Types
export * from './types.js';

// Orchestrator
export { GateOrchestrator } from './orchestrator/index.js';
export { GateRegistry, getGateRegistry } from './orchestrator/index.js';
export { ParallelExecutor } from './orchestrator/index.js';
export { ResultAggregator } from './orchestrator/index.js';

// Gates
export { BaseGate } from './gates/index.js';
export { PatternComplianceGate } from './gates/index.js';
export { ConstraintVerificationGate } from './gates/index.js';
export { RegressionDetectionGate } from './gates/index.js';
export { ImpactSimulationGate } from './gates/index.js';
export { SecurityBoundaryGate } from './gates/index.js';
export { CustomRulesGate } from './gates/index.js';

// Policy
export { PolicyLoader } from './policy/index.js';
export { PolicyEvaluator } from './policy/index.js';
export { DEFAULT_POLICIES } from './policy/index.js';

// Reporters
export { 
  BaseReporter,
  TextReporter,
  JsonReporter,
  GitHubReporter,
  GitLabReporter,
  SarifReporter,
} from './reporters/index.js';
export type { Reporter } from './reporters/index.js';

// Store
export { GateRunStore } from './store/index.js';
export { SnapshotStore } from './store/index.js';

// Factory function for easy instantiation
import { GateOrchestrator } from './orchestrator/index.js';

export function createQualityGateOrchestrator(projectRoot: string): GateOrchestrator {
  return new GateOrchestrator(projectRoot);
}
