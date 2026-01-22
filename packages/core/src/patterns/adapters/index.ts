/**
 * Pattern System Adapters
 *
 * Adapters for bridging the legacy pattern storage systems
 * to the new unified IPatternRepository interface.
 *
 * @module patterns/adapters
 */

export {
  PatternStoreAdapter,
  createPatternStoreAdapter,
} from './pattern-store-adapter.js';

export {
  createPatternServiceFromStore,
} from './service-factory.js';
