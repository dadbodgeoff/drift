/**
 * IEC 61131-3 Module
 * 
 * Enterprise-grade detection for industrial automation code.
 * Extracts docstrings, tribal knowledge, safety interlocks, and state machines.
 */

// Types
export * from './types.js';

// Extractors
export * from './extractors/index.js';

// Detectors
export * from './detectors/index.js';

// Convenience function to register all IEC 61131-3 detectors
import { DetectorRegistry } from '../registry/detector-registry.js';
import { STDocstringDetector } from './detectors/docstring-detector.js';
import { TribalKnowledgeDetector } from './detectors/tribal-knowledge-detector.js';
import { SafetyInterlockDetector } from './detectors/safety-detector.js';
import { StateMachineDetector } from './detectors/state-machine-detector.js';

/**
 * Register all IEC 61131-3 detectors with a registry
 * 
 * @param registry - The detector registry to register with
 */
export function registerIEC61131Detectors(registry: DetectorRegistry): void {
  registry.register(new STDocstringDetector());
  registry.register(new TribalKnowledgeDetector());
  registry.register(new SafetyInterlockDetector());
  registry.register(new StateMachineDetector());
}
