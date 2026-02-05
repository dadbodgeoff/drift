/**
 * Analysis Tools Index
 * 
 * Tools for deeper analysis of codebase patterns and quality.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const TEST_TOPOLOGY_ACTIONS = ['status', 'coverage', 'uncovered', 'mocks', 'affected', 'quality'];
const COUPLING_ACTIONS = ['status', 'cycles', 'hotspots', 'analyze', 'refactor-impact', 'unused-exports'];
const ERROR_HANDLING_ACTIONS = ['status', 'gaps', 'boundaries', 'unhandled', 'analyze'];
const DECISIONS_ACTIONS = ['status', 'list', 'get', 'for-file', 'timeline', 'search', 'mine'];
const CONSTRAINTS_ACTIONS = ['list', 'show', 'extract', 'approve', 'ignore', 'verify'];
const WPF_ACTIONS = ['status', 'bindings', 'mvvm', 'datacontext', 'commands'];
const GO_ACTIONS = ['status', 'routes', 'errors', 'interfaces', 'data-access', 'goroutines'];
const CONSTANTS_ACTIONS = ['status', 'list', 'get', 'usages', 'magic', 'dead', 'secrets', 'inconsistent'];
const AUDIT_ACTIONS = ['status', 'run', 'approve-recommended', 'trends'];

const RUST_ACTIONS = ['status', 'routes', 'errors', 'traits', 'data-access', 'async'];
const CPP_ACTIONS = ['status', 'classes', 'memory', 'templates', 'virtual'];
const TYPESCRIPT_ACTIONS = ['status', 'routes', 'components', 'hooks', 'errors', 'data-access', 'decorators'];
const PYTHON_ACTIONS = ['status', 'routes', 'errors', 'data-access', 'decorators', 'async'];
const JAVA_ACTIONS = ['status', 'routes', 'errors', 'data-access', 'annotations'];
const PHP_ACTIONS = ['status', 'routes', 'errors', 'data-access', 'traits'];
const IEC61131_ACTIONS = ['status', 'docstrings', 'state-machines', 'safety', 'tribal-knowledge', 'blocks', 'all'];

const DECISION_CATEGORIES = [
  'technology-adoption', 'technology-removal', 'pattern-introduction',
  'pattern-migration', 'architecture-change', 'api-change',
  'security-enhancement', 'performance-optimization', 'refactoring',
  'testing-strategy', 'infrastructure', 'other'
];
const TASK_CATEGORIES = [
  'rate-limiting', 'authentication', 'authorization', 'api-endpoint',
  'data-access', 'error-handling', 'caching', 'logging', 'testing',
  'validation', 'middleware', 'refactoring', 'generic'
];
const CONSTANT_CATEGORIES = [
  'config', 'api', 'status', 'error', 'feature_flag', 'limit',
  'regex', 'path', 'env', 'security', 'uncategorized'
];
const CONSTANT_LANGUAGES = [
  'typescript', 'javascript', 'python', 'java', 'csharp', 'php', 'go'
];

const QUALITY_GATE_GATES = ['pattern-compliance', 'constraint-verification', 'regression-detection', 'impact-simulation', 'security-boundary', 'custom-rules'];
const QUALITY_GATE_FORMATS = ['text', 'json', 'github', 'gitlab', 'sarif'];

export const ANALYSIS_TOOLS: Tool[] = [
  {
    name: 'drift_audit',
    description: 'Run pattern audit to detect duplicates, validate cross-references, and generate approval recommendations. Actions: status (show audit status), run (run full audit), approve-recommended (auto-approve ≥90% confidence patterns), trends (show quality trends). Use after scanning to streamline pattern approval workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: AUDIT_ACTIONS,
          description: 'Action to perform: status, run, approve-recommended, trends',
        },
        threshold: {
          type: 'number',
          description: 'Confidence threshold for auto-approve (default: 0.90)',
        },
        compareToPrevious: {
          type: 'boolean',
          description: 'Compare to previous audit for degradation detection (default: true)',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categories to audit (empty = all)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_quality_gate',
    description: 'Run quality gates on code changes. Checks pattern compliance, constraint verification, regression detection, impact simulation, security boundaries, and custom rules. Use before merging PRs to catch architectural drift.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to check (optional - defaults to all changed files)',
        },
        policy: {
          type: 'string',
          description: 'Policy to use: default, strict, relaxed, ci-fast, or custom ID',
        },
        gates: {
          type: 'string',
          description: `Specific gates to run (comma-separated): ${QUALITY_GATE_GATES.join(', ')}`,
        },
        format: {
          type: 'string',
          enum: QUALITY_GATE_FORMATS,
          description: 'Output format (default: json)',
        },
        verbose: {
          type: 'boolean',
          description: 'Include detailed output',
        },
        branch: {
          type: 'string',
          description: 'Current branch name',
        },
        baseBranch: {
          type: 'string',
          description: 'Base branch for comparison (for PRs)',
        },
      },
    },
  },
  {
    name: 'drift_simulate',
    description: 'Speculative Execution Engine: Simulates multiple implementation approaches BEFORE code generation, scoring them by friction, impact, and pattern alignment. Returns ranked approaches with trade-off analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description (e.g., "add rate limiting to API", "implement user authentication")',
        },
        category: {
          type: 'string',
          enum: TASK_CATEGORIES,
          description: 'Task category (auto-detected if not provided)',
        },
        target: {
          type: 'string',
          description: 'Target file or function to focus on',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraints (e.g., "must work with existing auth", "minimal file changes")',
        },
        maxApproaches: {
          type: 'number',
          description: 'Maximum approaches to simulate (default: 5)',
        },
        includeSecurityAnalysis: {
          type: 'boolean',
          description: 'Include security analysis (default: true)',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'drift_test_topology',
    description: 'Analyze test-to-code mappings, mock patterns, and test quality. Actions: status (overview), coverage (file coverage), uncovered (find gaps), mocks (mock analysis), affected (minimum test set), quality (test quality metrics).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: TEST_TOPOLOGY_ACTIONS,
          description: 'Action to perform: status, coverage, uncovered, mocks, affected, quality',
        },
        file: {
          type: 'string',
          description: 'File path for coverage/quality actions',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Changed files for affected action',
        },
        limit: {
          type: 'number',
          description: 'Max results for uncovered action (default: 20)',
        },
        minRisk: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Minimum risk level for uncovered action (default: medium)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_coupling',
    description: 'Analyze module dependencies, detect cycles, and calculate coupling metrics (Robert C. Martin metrics). Actions: status (overview), cycles (dependency cycles), hotspots (highly coupled modules), analyze (specific module), refactor-impact (change impact), unused-exports (dead exports).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: COUPLING_ACTIONS,
          description: 'Action to perform: status, cycles, hotspots, analyze, refactor-impact, unused-exports',
        },
        module: {
          type: 'string',
          description: 'Module path for analyze/refactor-impact actions',
        },
        limit: {
          type: 'number',
          description: 'Max results for hotspots/unused-exports (default: 15/20)',
        },
        minCoupling: {
          type: 'number',
          description: 'Minimum coupling threshold for hotspots (default: 3)',
        },
        maxCycleLength: {
          type: 'number',
          description: 'Maximum cycle length to report (default: 10)',
        },
        minSeverity: {
          type: 'string',
          enum: ['info', 'warning', 'critical'],
          description: 'Minimum severity for cycles (default: info)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_error_handling',
    description: 'Analyze error handling patterns, boundaries, and gaps. Detects unhandled error paths and swallowed exceptions. Actions: status (overview), gaps (find issues), boundaries (error boundaries), unhandled (unhandled paths), analyze (specific function).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ERROR_HANDLING_ACTIONS,
          description: 'Action to perform: status, gaps, boundaries, unhandled, analyze',
        },
        function: {
          type: 'string',
          description: 'Function path for analyze action',
        },
        limit: {
          type: 'number',
          description: 'Max results for gaps action (default: 20)',
        },
        minSeverity: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Minimum severity for gaps/unhandled (default: medium)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_decisions',
    description: 'Mine architectural decisions from git history. Analyzes commits to discover and synthesize ADRs (Architecture Decision Records). Actions: status (overview), list (all decisions), get (decision details), for-file (decisions affecting file), timeline (chronological view), search (find decisions), mine (run mining).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: DECISIONS_ACTIONS,
          description: 'Action to perform: status, list, get, for-file, timeline, search, mine',
        },
        id: {
          type: 'string',
          description: 'Decision ID for get action',
        },
        file: {
          type: 'string',
          description: 'File path for for-file action',
        },
        query: {
          type: 'string',
          description: 'Search query for search action',
        },
        category: {
          type: 'string',
          enum: DECISION_CATEGORIES,
          description: 'Filter by category for list action',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
        since: {
          type: 'string',
          description: 'Start date (ISO format) for mine action',
        },
        until: {
          type: 'string',
          description: 'End date (ISO format) for mine action',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence (0-1) for mine action (default: 0.5)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_constraints',
    description: 'Manage architectural constraints learned from the codebase. Constraints are invariants that MUST be satisfied. Actions: list (all constraints), show (constraint details), extract (discover from codebase), approve (activate constraint), ignore (disable constraint), verify (check file against constraints).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: CONSTRAINTS_ACTIONS,
          description: 'Action to perform: list, show, extract, approve, ignore, verify',
        },
        id: {
          type: 'string',
          description: 'Constraint ID for show/approve/ignore actions',
        },
        file: {
          type: 'string',
          description: 'File path for verify action',
        },
        category: {
          type: 'string',
          enum: ['api', 'auth', 'data', 'error', 'test', 'security', 'structural', 'performance', 'logging', 'validation'],
          description: 'Filter by category',
        },
        status: {
          type: 'string',
          enum: ['discovered', 'approved', 'ignored', 'custom'],
          description: 'Filter by status',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence (0-1)',
        },
        reason: {
          type: 'string',
          description: 'Reason for ignore action',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_wpf',
    description: 'Analyze WPF applications: bindings, MVVM compliance, data flow. Actions: status (project overview), bindings (list all bindings), mvvm (compliance check), datacontext (resolution), commands (list commands).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: WPF_ACTIONS,
          description: 'Action to perform: status, bindings, mvvm, datacontext, commands',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        options: {
          type: 'object',
          properties: {
            unresolvedOnly: {
              type: 'boolean',
              description: 'Show only unresolved bindings',
            },
            limit: {
              type: 'number',
              description: 'Limit number of results',
            },
          },
          description: 'Additional options',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_go',
    description: 'Analyze Go projects: routes, error handling, interfaces, data access, goroutines. Actions: status (project overview), routes (HTTP routes), errors (error handling patterns), interfaces (interface analysis), data-access (database patterns), goroutines (concurrency analysis).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: GO_ACTIONS,
          description: 'Action to perform: status, routes, errors, interfaces, data-access, goroutines',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework (for routes action): gin, echo, chi, fiber, net/http',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_constants',
    description: 'Analyze constants, enums, and exported values. Detects hardcoded secrets, inconsistent values, and magic numbers. Actions: status (overview), list (browse constants), get (constant details), usages (find references), magic (magic values), dead (unused constants), secrets (hardcoded secrets), inconsistent (value mismatches).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: CONSTANTS_ACTIONS,
          description: 'Action to perform: status, list, get, usages, magic, dead, secrets, inconsistent',
        },
        category: {
          type: 'string',
          enum: CONSTANT_CATEGORIES,
          description: 'Filter by category for list action',
        },
        language: {
          type: 'string',
          enum: CONSTANT_LANGUAGES,
          description: 'Filter by language for list action',
        },
        file: {
          type: 'string',
          description: 'Filter by file path for list action',
        },
        search: {
          type: 'string',
          description: 'Search constant names for list action',
        },
        exported: {
          type: 'boolean',
          description: 'Filter by exported status for list action',
        },
        id: {
          type: 'string',
          description: 'Constant ID for get/usages actions',
        },
        name: {
          type: 'string',
          description: 'Constant name for get/usages actions',
        },
        constantId: {
          type: 'string',
          description: 'Constant ID for usages action',
        },
        severity: {
          type: 'string',
          enum: ['info', 'low', 'medium', 'high', 'critical'],
          description: 'Minimum severity for secrets action',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 50)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor',
        },
      },
    },
  },
  {
    name: 'drift_rust',
    description: 'Analyze Rust projects: routes, error handling, traits, data access, async patterns. Actions: status (project overview), routes (HTTP routes - Actix, Axum, Rocket, Warp), errors (error handling - Result, thiserror, anyhow), traits (trait definitions and implementations), data-access (database patterns - SQLx, Diesel, SeaORM), async (async patterns and runtime analysis).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: RUST_ACTIONS,
          description: 'Action to perform: status, routes, errors, traits, data-access, async',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework (for routes and data-access): actix, axum, rocket, warp, sqlx, diesel, sea-orm',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_cpp',
    description: 'Analyze C++ projects: classes, memory management, templates, virtual functions. Actions: status (project overview), classes (class/struct analysis with inheritance), memory (smart pointers, RAII, manual allocation), templates (template classes and functions), virtual (virtual functions and polymorphic hierarchies).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: CPP_ACTIONS,
          description: 'Action to perform: status, classes, memory, templates, virtual',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework: Qt, Boost, Unreal Engine',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_typescript',
    description: 'Analyze TypeScript/JavaScript projects: routes, components, hooks, error handling, data access. Actions: status (project overview), routes (HTTP routes - Express, NestJS, Next.js, Fastify), components (React components), hooks (React hooks usage), errors (error handling patterns), data-access (database patterns - Prisma, TypeORM, Drizzle, Sequelize, Mongoose), decorators (NestJS, TypeORM decorators).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: TYPESCRIPT_ACTIONS,
          description: 'Action to perform: status, routes, components, hooks, errors, data-access, decorators',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework (for routes): express, nestjs, nextjs, fastify',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_python',
    description: 'Analyze Python projects: routes, error handling, data access, async patterns. Actions: status (project overview), routes (HTTP routes - Flask, FastAPI, Django, Starlette), errors (error handling patterns), data-access (database patterns - Django ORM, SQLAlchemy, Tortoise, Peewee), decorators (decorator usage), async (async patterns).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: PYTHON_ACTIONS,
          description: 'Action to perform: status, routes, errors, data-access, decorators, async',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework (for routes): flask, fastapi, django, starlette',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_java',
    description: 'Analyze Java projects: routes, error handling, data access, annotations. Actions: status (project overview), routes (HTTP routes - Spring MVC, JAX-RS, Micronaut, Quarkus), errors (error handling patterns), data-access (database patterns - Spring Data JPA, Hibernate, JDBC, MyBatis), annotations (annotation usage).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: JAVA_ACTIONS,
          description: 'Action to perform: status, routes, errors, data-access, annotations',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework (for routes): spring, jax-rs, micronaut, quarkus',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_php',
    description: 'Analyze PHP projects: routes, error handling, data access, traits. Actions: status (project overview), routes (HTTP routes - Laravel, Symfony, Slim, Lumen), errors (error handling patterns), data-access (database patterns - Eloquent, Doctrine, PDO), traits (trait definitions and usage).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: PHP_ACTIONS,
          description: 'Action to perform: status, routes, errors, data-access, traits',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        framework: {
          type: 'string',
          description: 'Filter by framework (for routes): laravel, symfony, slim, lumen',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'drift_iec61131',
    description: 'Analyze IEC 61131-3 industrial automation code (Structured Text). Extract docstrings, state machines, safety interlocks, and tribal knowledge from legacy PLC codebases. Actions: status (project overview), docstrings (extract documentation - PhD primary request), state-machines (CASE-based state machines), safety (interlocks and bypasses), tribal-knowledge (warnings, workarounds, institutional knowledge), blocks (PROGRAM/FUNCTION_BLOCK/FUNCTION), all (full analysis).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: IEC61131_ACTIONS,
          description: 'Action to perform: status, docstrings, state-machines, safety, tribal-knowledge, blocks, all',
        },
        path: {
          type: 'string',
          description: 'File or directory path (defaults to project root)',
        },
        file: {
          type: 'string',
          description: 'Specific .st file to analyze',
        },
        limit: {
          type: 'number',
          description: 'Limit number of results (default: 50)',
        },
        includeRaw: {
          type: 'boolean',
          description: 'Include raw docstring text in output (default: false)',
        },
      },
      required: ['action'],
    },
  },
];

export { handleTestTopology, type TestTopologyArgs, type TestTopologyAction } from './test-topology.js';
export { handleCoupling, type CouplingArgs, type CouplingAction } from './coupling.js';
export { handleErrorHandling, type ErrorHandlingArgs, type ErrorHandlingAction } from './error-handling.js';
export { handleDecisions, type DecisionsArgs, type DecisionsAction } from './decisions.js';
export { handleSimulate, type SimulateArgs } from './simulate.js';
export { handleConstraints, type ConstraintsArgs, type ConstraintsAction } from './constraints.js';
export { executeWpfTool, type WpfArgs, type WpfAction } from './wpf.js';
export { executeGoTool, type GoArgs, type GoAction } from './go.js';
export { executeRustTool, type RustArgs, type RustAction } from './rust.js';
export { handleConstants, type ConstantsArgs, type ConstantsAction } from './constants.js';
export { handleQualityGate, qualityGateTool, type QualityGateArgs } from './quality-gate.js';
export { executeCppTool, type CppArgs, type CppAction } from './cpp.js';
export { executeTypeScriptTool, type TypeScriptArgs, type TypeScriptAction } from './typescript.js';
export { executePythonTool, type PythonArgs, type PythonAction } from './python.js';
export { executeJavaTool, type JavaArgs, type JavaAction } from './java.js';
export { executePhpTool, type PhpArgs, type PhpAction } from './php.js';
export { handleAudit, auditTool, type AuditArgs } from './audit.js';
export { executeIEC61131Tool, type IEC61131Args, type IEC61131Action } from './iec61131.js';
