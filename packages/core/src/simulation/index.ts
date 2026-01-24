/**
 * Speculative Execution Engine
 *
 * Simulates multiple implementation approaches BEFORE code generation,
 * scoring them by friction, impact, and pattern alignment.
 *
 * @module simulation
 */

// Types
export * from './types.js';

// Language Strategies
export * from './language-strategies/index.js';

// Approach Generator
export {
  ApproachGenerator,
  createApproachGenerator,
  type ApproachGeneratorConfig,
  type GeneratedApproaches,
} from './approach-generator.js';

// Scorers
export * from './scorers/index.js';

// Simulation Engine
export {
  SimulationEngine,
  createSimulationEngine,
  type SimulationEngineConfig,
} from './simulation-engine.js';
