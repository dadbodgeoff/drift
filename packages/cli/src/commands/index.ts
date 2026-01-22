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