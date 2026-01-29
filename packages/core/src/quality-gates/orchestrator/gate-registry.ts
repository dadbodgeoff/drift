/**
 * Gate Registry
 * 
 * @license Apache-2.0
 * 
 * Manages gate registration and instantiation.
 * Supports both built-in gates and custom gate registration.
 */

import type { Gate, GateId, GateFactory, GateFactoryContext } from '../types.js';

/**
 * Registry for quality gates.
 * Manages gate registration and instantiation.
 */
export class GateRegistry {
  private gates: Map<GateId, Gate> = new Map();
  private factories: Map<GateId, GateFactory> = new Map();
  private initialized = false;

  constructor() {
    // Built-in gates are registered lazily to avoid circular imports
  }

  /**
   * Initialize with built-in gates.
   * Called lazily on first access.
   */
  private async initializeBuiltInGates(): Promise<void> {
    if (this.initialized) {return;}
    this.initialized = true;

    // Import gates dynamically to avoid circular dependencies
    try {
      const { PatternComplianceGate } = await import('../gates/pattern-compliance/index.js');
      this.register('pattern-compliance', () => new PatternComplianceGate());
    } catch (e) {
      console.error('Failed to load PatternComplianceGate:', e);
    }

    try {
      const { ConstraintVerificationGate } = await import('../gates/constraint-verification/index.js');
      this.register('constraint-verification', () => new ConstraintVerificationGate());
    } catch (e) {
      console.error('Failed to load ConstraintVerificationGate:', e);
    }

    try {
      const { RegressionDetectionGate } = await import('../gates/regression-detection/index.js');
      this.register('regression-detection', () => new RegressionDetectionGate());
    } catch (e) {
      console.error('Failed to load RegressionDetectionGate:', e);
    }

    try {
      const { ImpactSimulationGate } = await import('../gates/impact-simulation/index.js');
      this.register('impact-simulation', () => new ImpactSimulationGate());
    } catch (e) {
      console.error('Failed to load ImpactSimulationGate:', e);
    }

    try {
      const { SecurityBoundaryGate } = await import('../gates/security-boundary/index.js');
      this.register('security-boundary', () => new SecurityBoundaryGate());
    } catch (e) {
      console.error('Failed to load SecurityBoundaryGate:', e);
    }

    try {
      const { CustomRulesGate } = await import('../gates/custom-rules/index.js');
      this.register('custom-rules', () => new CustomRulesGate());
    } catch (e) {
      console.error('Failed to load CustomRulesGate:', e);
    }
  }

  /**
   * Register a gate factory.
   */
  register(gateId: GateId, factory: GateFactory): void {
    this.factories.set(gateId, factory);
    // Clear cached instance if re-registering
    this.gates.delete(gateId);
  }

  /**
   * Get a gate instance.
   */
  async get(gateId: GateId, context?: GateFactoryContext): Promise<Gate> {
    await this.initializeBuiltInGates();

    // Check if already instantiated
    let gate = this.gates.get(gateId);
    if (gate) {return gate;}

    // Get factory
    const factory = this.factories.get(gateId);
    if (!factory) {
      throw new Error(`Unknown gate: ${gateId}`);
    }

    // Create instance
    gate = factory(context ?? { projectRoot: process.cwd() });
    this.gates.set(gateId, gate);

    return gate;
  }

  /**
   * Check if a gate is registered.
   */
  async has(gateId: GateId): Promise<boolean> {
    await this.initializeBuiltInGates();
    return this.factories.has(gateId);
  }

  /**
   * List all registered gate IDs.
   */
  async list(): Promise<GateId[]> {
    await this.initializeBuiltInGates();
    return Array.from(this.factories.keys());
  }

  /**
   * Clear cached gate instances.
   */
  clear(): void {
    this.gates.clear();
  }

  /**
   * Reset the registry (for testing).
   */
  reset(): void {
    this.gates.clear();
    this.factories.clear();
    this.initialized = false;
  }
}

/**
 * Singleton registry instance.
 */
let registryInstance: GateRegistry | null = null;

/**
 * Get the global gate registry.
 */
export function getGateRegistry(): GateRegistry {
  if (!registryInstance) {
    registryInstance = new GateRegistry();
  }
  return registryInstance;
}
