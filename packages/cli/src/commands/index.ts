/**
 * Commands module exports
 *
 * Exports all CLI commands for registration with Commander.js
 */

export { initCommand } from './init.js';
export { scanCommand } from './scan.js';
export { checkCommand } from './check.js';
export { statusCommand } from './status.js';
export { approveCommand } from './approve.js';
export { ignoreCommand } from './ignore.js';
export { reportCommand } from './report.js';
export { exportCommand } from './export.js';
export { whereCommand } from './where.js';
export { filesCommand } from './files.js';
export { watchCommandDef as watchCommand } from './watch.js';
export { dashboardCommand } from './dashboard.js';
export { trendsCommand } from './trends.js';
export { parserCommand } from './parser.js';
export { dnaCommand } from './dna/index.js';
export { boundariesCommand } from './boundaries.js';
export { callgraphCommand } from './callgraph.js';
export { projectsCommand } from './projects.js';
export { skillsCommand } from './skills.js';
export { migrateStorageCommand } from './migrate-storage.js';
export { wrappersCommand } from './wrappers.js';

// Analysis commands (L5-L7 layers)
export { createTestTopologyCommand } from './test-topology.js';
export { createCouplingCommand } from './coupling.js';
export { createErrorHandlingCommand } from './error-handling.js';
export { createDecisionsCommand } from './decisions.js';
export { createConstraintsCommand } from './constraints.js';

// Speculative Execution Engine
export { createSimulateCommand } from './simulate.js';

// WPF Framework Support
export { createWpfCommand } from './wpf.js';

// Go Language Support
export { createGoCommand } from './go.js';

// Rust Language Support
export { createRustCommand } from './rust.js';

// C++ Language Support
export { createCppCommand } from './cpp.js';

// TypeScript/JavaScript Language Support
export { createTsCommand } from './ts.js';

// Python Language Support
export { createPyCommand } from './py.js';

// Java Language Support
export { createJavaCommand } from './java.js';

// PHP Language Support
export { createPhpCommand } from './php.js';

// Environment Variable Detection
export { envCommand } from './env.js';

// Constants & Enum Analysis
export { constantsCommand } from './constants.js';

// License Management
export { licenseCommand } from './license.js';

// Quality Gates (Enterprise)
export { createGateCommand } from './gate.js';

// Package Context (Monorepo AI context minimization)
export { contextCommand } from './context.js';

// Telemetry Management (Privacy-first, opt-in)
export { telemetryCommand } from './telemetry.js';

// Audit System (Pattern validation and approval workflows)
export { auditCommand } from './audit.js';

// User Guidance Commands
export { nextStepsCommand } from './next-steps.js';
export { troubleshootCommand } from './troubleshoot.js';

// Cortex V2 Memory Management
export { createMemoryCommand } from './memory.js';

// Unified Setup Wizard
export { setupCommand } from './setup.js';

// Backup & Restore
export { backupCommand } from './backup.js';

// Database Import (Phase 3)
export { importCommand } from './import.js';