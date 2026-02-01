/**
 * drift_capabilities - Comprehensive Tool Guide
 * 
 * Discovery tool that explains all available tools and when to use them.
 * Helps AI agents understand the tool landscape and choose the right tool.
 * 
 * Enhanced version with:
 * - All 50 tools documented
 * - Token cost estimates
 * - Use case examples
 * - Tool relationships
 * - Agent Navigation Guide (decision tree)
 */

import { createResponseBuilder } from '../../infrastructure/index.js';

export interface CapabilitiesData {
  summary: string;
  toolCount: number;
  agentNavigationGuide: AgentNavigationGuide;
  layers: LayerInfo[];
  quickStart: QuickStartGuide;
  byUseCase: UseCaseGuide[];
  tokenEstimates: TokenEstimate[];
}

/**
 * Agent Navigation Guide - Decision tree for tool selection
 * Maps user intent keywords to recommended tool sequences
 */
interface AgentNavigationGuide {
  description: string;
  decisionTree: DecisionNode[];
  surgicalLookups: SurgicalLookup[];
  commonMistakes: string[];
}

interface DecisionNode {
  /** Keywords that trigger this path */
  triggers: string[];
  /** What the user is trying to do */
  intent: string;
  /** Ordered sequence of tools to call */
  toolSequence: string[];
  /** Why this sequence */
  rationale: string;
}

interface SurgicalLookup {
  /** The question being asked */
  question: string;
  /** Single tool that answers it */
  tool: string;
  /** Example usage */
  example: string;
}

interface LayerInfo {
  name: string;
  description: string;
  tools: ToolInfo[];
}

interface ToolInfo {
  name: string;
  purpose: string;
  whenToUse: string;
  tokenCost: 'low' | 'medium' | 'high';
  example?: string;
}

interface QuickStartGuide {
  steps: string[];
  commonWorkflows: WorkflowGuide[];
}

interface WorkflowGuide {
  task: string;
  tools: string[];
  description: string;
}

interface UseCaseGuide {
  useCase: string;
  recommendedTools: string[];
  description: string;
}

interface TokenEstimate {
  tool: string;
  inputTokens: string;
  outputTokens: string;
  notes: string;
}

const LAYER_INFO: LayerInfo[] = [
  {
    name: 'Orchestration',
    description: 'Start here. These tools synthesize context from multiple sources.',
    tools: [
      {
        name: 'drift_context',
        purpose: 'Get curated context for any task',
        whenToUse: 'ALWAYS start here for code generation tasks. Returns patterns, examples, files to modify, and warnings.',
        tokenCost: 'medium',
        example: 'intent: "add_feature", focus: "user authentication"',
      },
      {
        name: 'drift_package_context',
        purpose: 'Get context for a specific package in monorepo',
        whenToUse: 'Working in a monorepo and need package-specific patterns.',
        tokenCost: 'medium',
        example: 'package: "@drift/core"',
      },
    ],
  },
  {
    name: 'Discovery',
    description: 'Quick status checks. Always fast, always lightweight.',
    tools: [
      {
        name: 'drift_status',
        purpose: 'Get codebase health snapshot',
        whenToUse: 'First tool to call. Understand overall state before diving deeper.',
        tokenCost: 'low',
      },
      {
        name: 'drift_capabilities',
        purpose: 'List all tools and their purposes',
        whenToUse: 'When unsure which tool to use for a task.',
        tokenCost: 'low',
      },
      {
        name: 'drift_projects',
        purpose: 'List and manage registered projects',
        whenToUse: 'Working across multiple codebases or switching projects.',
        tokenCost: 'low',
      },
    ],
  },
  {
    name: 'Surgical',
    description: 'Ultra-focused lookups for AI code generation. Low token cost, high precision.',
    tools: [
      {
        name: 'drift_signature',
        purpose: 'Get function/class signature without reading entire files',
        whenToUse: 'Need to know a function interface without reading the whole file.',
        tokenCost: 'low',
        example: 'symbol: "createUser"',
      },
      {
        name: 'drift_callers',
        purpose: 'Lightweight "who calls this function" lookup',
        whenToUse: 'Find direct callers of a function. Much faster than full impact analysis.',
        tokenCost: 'low',
        example: 'function: "handleSubmit"',
      },
      {
        name: 'drift_imports',
        purpose: 'Resolve correct import statements',
        whenToUse: 'Get ready-to-use import statements following codebase conventions.',
        tokenCost: 'low',
        example: 'symbols: ["useState", "useEffect"], targetFile: "src/components/MyComponent.tsx"',
      },
      {
        name: 'drift_prevalidate',
        purpose: 'Validate proposed code BEFORE writing',
        whenToUse: 'Check if code follows patterns before committing changes.',
        tokenCost: 'low',
        example: 'code: "...", targetFile: "src/api/users.ts"',
      },
      {
        name: 'drift_similar',
        purpose: 'Find semantically similar code',
        whenToUse: 'Find existing code similar to what you want to create.',
        tokenCost: 'medium',
        example: 'intent: "api_endpoint", description: "user preferences CRUD"',
      },
      {
        name: 'drift_type',
        purpose: 'Expand type definitions to see full structure',
        whenToUse: 'Need to know the shape of a type without reading the file.',
        tokenCost: 'low',
        example: 'type: "UserDTO"',
      },
      {
        name: 'drift_recent',
        purpose: 'Show recent changes in a specific area',
        whenToUse: 'Find recently updated files to use as current examples.',
        tokenCost: 'low',
        example: 'area: "src/api/"',
      },
      {
        name: 'drift_test_template',
        purpose: 'Generate test scaffolding based on existing patterns',
        whenToUse: 'Create a test file matching codebase conventions.',
        tokenCost: 'medium',
        example: 'targetFile: "src/services/user.ts"',
      },
      {
        name: 'drift_dependencies',
        purpose: 'Look up installed dependencies across all languages',
        whenToUse: 'Verify packages are installed before suggesting imports.',
        tokenCost: 'low',
        example: 'search: "react"',
      },
      {
        name: 'drift_middleware',
        purpose: 'Find middleware patterns in the codebase',
        whenToUse: 'Find auth, logging, validation, or error handling middleware.',
        tokenCost: 'low',
        example: 'type: "auth"',
      },
      {
        name: 'drift_hooks',
        purpose: 'Find custom React/Vue hooks',
        whenToUse: 'Find existing hooks before creating new ones.',
        tokenCost: 'low',
        example: 'category: "fetch"',
      },
      {
        name: 'drift_errors',
        purpose: 'Find error types and handling gaps',
        whenToUse: 'Find custom error classes or missing error handling.',
        tokenCost: 'low',
        example: 'action: "types"',
      },
    ],
  },
  {
    name: 'Exploration',
    description: 'Browse and filter. Returns summaries and IDs for detail tools.',
    tools: [
      {
        name: 'drift_patterns_list',
        purpose: 'List patterns with summaries',
        whenToUse: 'Find patterns by category, status, or confidence. Returns IDs for drift_pattern_get.',
        tokenCost: 'low',
      },
      {
        name: 'drift_files_list',
        purpose: 'List files with pattern counts',
        whenToUse: 'Find files relevant to a task or understand pattern distribution.',
        tokenCost: 'low',
      },
      {
        name: 'drift_security_summary',
        purpose: 'Security posture overview',
        whenToUse: 'Before working on security-sensitive code or reviewing data access.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_contracts_list',
        purpose: 'List API contracts and mismatches',
        whenToUse: 'Working on API endpoints or debugging frontend/backend issues.',
        tokenCost: 'low',
      },
      {
        name: 'drift_trends',
        purpose: 'Pattern trend analysis',
        whenToUse: 'Check if code quality is improving or declining over time.',
        tokenCost: 'low',
      },
      {
        name: 'drift_env',
        purpose: 'Analyze environment variable access patterns',
        whenToUse: 'Find which code accesses which env vars, detect secrets.',
        tokenCost: 'low',
        example: 'action: "secrets"',
      },
    ],
  },
  {
    name: 'Detail',
    description: 'Deep dives. Get complete information about specific items.',
    tools: [
      {
        name: 'drift_pattern_get',
        purpose: 'Full pattern details with locations and outliers',
        whenToUse: 'After finding a pattern ID from drift_patterns_list. Get complete info.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_file_patterns',
        purpose: 'All patterns in a specific file',
        whenToUse: 'Before modifying a file. Understand its patterns and conventions.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_code_examples',
        purpose: 'Real code snippets for patterns',
        whenToUse: 'Before generating code. See how patterns are implemented in this codebase.',
        tokenCost: 'high',
      },
      {
        name: 'drift_impact_analysis',
        purpose: 'What breaks if you change X',
        whenToUse: 'Before refactoring. Understand downstream effects of changes.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_reachability',
        purpose: 'What data can code reach (forward/inverse)',
        whenToUse: 'Security review. Understand data access from an entry point.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_explain',
        purpose: 'Comprehensive explanation of code in context',
        whenToUse: 'Need to understand unfamiliar code with full context.',
        tokenCost: 'high',
      },
    ],
  },
  {
    name: 'Analysis',
    description: 'Deep analysis tools for code health and quality.',
    tools: [
      {
        name: 'drift_test_topology',
        purpose: 'Test-to-code mappings and coverage',
        whenToUse: 'Find untested code, affected tests, or analyze test quality.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_coupling',
        purpose: 'Module dependencies and cycles',
        whenToUse: 'Find dependency cycles, highly coupled modules, or plan refactoring.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_error_handling',
        purpose: 'Error handling patterns and gaps',
        whenToUse: 'Find unhandled errors, error boundaries, or error handling gaps.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_wrappers',
        purpose: 'Framework wrapper patterns',
        whenToUse: 'Understand custom abstractions built on framework primitives.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_dna_profile',
        purpose: 'Styling DNA profile',
        whenToUse: 'Understand how components are styled (variants, responsive, theming).',
        tokenCost: 'medium',
      },
      {
        name: 'drift_quality_gate',
        purpose: 'Run quality gates on changes',
        whenToUse: 'Before merging PRs. Check pattern compliance and regressions.',
        tokenCost: 'high',
      },
    ],
  },
  {
    name: 'Language-Specific',
    description: 'Language-aware analysis for 8 supported languages.',
    tools: [
      {
        name: 'drift_typescript',
        purpose: 'TypeScript/JavaScript analysis',
        whenToUse: 'Analyze TS/JS: routes, components, hooks, decorators, data access.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_python',
        purpose: 'Python analysis',
        whenToUse: 'Analyze Python: routes, decorators, async patterns, data access.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_java',
        purpose: 'Java analysis',
        whenToUse: 'Analyze Java: routes, annotations, data access patterns.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_php',
        purpose: 'PHP analysis',
        whenToUse: 'Analyze PHP: routes, traits, data access patterns.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_go',
        purpose: 'Go analysis',
        whenToUse: 'Analyze Go: routes, interfaces, goroutines, data access.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_rust',
        purpose: 'Rust analysis',
        whenToUse: 'Analyze Rust: routes, traits, error handling, async patterns.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_cpp',
        purpose: 'C++ analysis',
        whenToUse: 'Analyze C++: classes, memory management, templates, virtual functions.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_wpf',
        purpose: 'WPF (C#) analysis',
        whenToUse: 'Analyze WPF: bindings, MVVM compliance, DataContext, commands.',
        tokenCost: 'medium',
      },
    ],
  },
  {
    name: 'Generation',
    description: 'AI-assisted code generation and validation.',
    tools: [
      {
        name: 'drift_suggest_changes',
        purpose: 'Get AI-guided fix suggestions',
        whenToUse: 'Need specific code changes for violations or improvements.',
        tokenCost: 'high',
      },
      {
        name: 'drift_validate_change',
        purpose: 'Validate code against patterns',
        whenToUse: 'After generating code. Check if it follows codebase patterns.',
        tokenCost: 'medium',
      },
    ],
  },
  {
    name: 'Enterprise',
    description: 'Advanced features for enterprise workflows.',
    tools: [
      {
        name: 'drift_decisions',
        purpose: 'Architectural decision mining',
        whenToUse: 'Understand past architectural decisions from git history.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_constraints',
        purpose: 'Architectural constraints',
        whenToUse: 'Check or manage architectural invariants.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_simulate',
        purpose: 'Simulate implementation approaches',
        whenToUse: 'Before coding. Compare approaches by friction, impact, alignment.',
        tokenCost: 'high',
      },
      {
        name: 'drift_constants',
        purpose: 'Constants and enum analysis',
        whenToUse: 'Find magic numbers, hardcoded secrets, or inconsistent constants.',
        tokenCost: 'medium',
      },
    ],
  },
  {
    name: 'Memory',
    description: 'Cortex V2 memory system - institutional knowledge that persists across sessions.',
    tools: [
      {
        name: 'drift_memory_status',
        purpose: 'Get memory system status',
        whenToUse: 'Check if memory system is initialized and healthy.',
        tokenCost: 'low',
      },
      {
        name: 'drift_why',
        purpose: 'Get context for a task from memories',
        whenToUse: 'Before starting work. Get relevant tribal knowledge, procedures, and patterns.',
        tokenCost: 'medium',
      },
      {
        name: 'drift_memory_search',
        purpose: 'Search memories semantically',
        whenToUse: 'Find specific knowledge about a topic.',
        tokenCost: 'low',
      },
      {
        name: 'drift_memory_add',
        purpose: 'Add new memory',
        whenToUse: 'Store tribal knowledge, procedures, or patterns for future use.',
        tokenCost: 'low',
      },
      {
        name: 'drift_memory_learn',
        purpose: 'Learn from corrections',
        whenToUse: 'When AI makes a mistake, teach it the correct approach.',
        tokenCost: 'low',
      },
      {
        name: 'drift_memory_for_context',
        purpose: 'Get memories relevant to current context',
        whenToUse: 'Get all relevant memories for a file or task.',
        tokenCost: 'medium',
      },
    ],
  },
];

const QUICK_START: QuickStartGuide = {
  steps: [
    '1. drift_status → Get health overview and pattern counts',
    '2. drift_context → Get curated context for your task',
    '3. drift_code_examples → See how patterns are implemented',
    '4. Generate code following the patterns',
    '5. drift_validate_change → Verify your code matches patterns',
  ],
  commonWorkflows: [
    {
      task: 'Add a new feature',
      tools: ['drift_context', 'drift_code_examples', 'drift_validate_change'],
      description: 'Get context, see examples, generate code, validate.',
    },
    {
      task: 'Fix a bug',
      tools: ['drift_context', 'drift_file_patterns', 'drift_impact_analysis'],
      description: 'Understand context, check file patterns, assess impact.',
    },
    {
      task: 'Refactor code',
      tools: ['drift_impact_analysis', 'drift_coupling', 'drift_test_topology'],
      description: 'Check impact, find coupling issues, ensure test coverage.',
    },
    {
      task: 'Security review',
      tools: ['drift_security_summary', 'drift_reachability', 'drift_error_handling'],
      description: 'Check security posture, data access, error handling.',
    },
    {
      task: 'Understand unfamiliar code',
      tools: ['drift_explain', 'drift_file_patterns', 'drift_impact_analysis'],
      description: 'Get explanation, see patterns, understand dependencies.',
    },
  ],
};

const USE_CASE_GUIDES: UseCaseGuide[] = [
  {
    useCase: 'Code Generation',
    recommendedTools: ['drift_context', 'drift_code_examples', 'drift_validate_change'],
    description: 'Start with drift_context to get patterns, use drift_code_examples for real implementations, validate with drift_validate_change.',
  },
  {
    useCase: 'Security Audit',
    recommendedTools: ['drift_security_summary', 'drift_reachability', 'drift_error_handling'],
    description: 'Get security overview, trace data access paths, check error handling gaps.',
  },
  {
    useCase: 'Refactoring',
    recommendedTools: ['drift_impact_analysis', 'drift_coupling', 'drift_test_topology'],
    description: 'Understand blast radius, find coupling issues, ensure tests cover changes.',
  },
  {
    useCase: 'API Development',
    recommendedTools: ['drift_contracts_list', 'drift_typescript', 'drift_patterns_list'],
    description: 'Check API contracts, analyze routes, find API patterns.',
  },
  {
    useCase: 'Test Coverage',
    recommendedTools: ['drift_test_topology', 'drift_coupling'],
    description: 'Find untested code, understand test-to-code mappings.',
  },
  {
    useCase: 'Architecture Review',
    recommendedTools: ['drift_coupling', 'drift_decisions', 'drift_constraints'],
    description: 'Find cycles, understand past decisions, check constraints.',
  },
];

const TOKEN_ESTIMATES: TokenEstimate[] = [
  { tool: 'drift_status', inputTokens: '~50', outputTokens: '~200', notes: 'Always fast' },
  { tool: 'drift_context', inputTokens: '~100', outputTokens: '~1000-3000', notes: 'Varies by task complexity' },
  { tool: 'drift_code_examples', inputTokens: '~100', outputTokens: '~2000-5000', notes: 'Includes code snippets' },
  { tool: 'drift_patterns_list', inputTokens: '~50', outputTokens: '~500-1500', notes: 'Depends on pattern count' },
  { tool: 'drift_impact_analysis', inputTokens: '~100', outputTokens: '~1000-2000', notes: 'Depends on call graph depth' },
  { tool: 'drift_validate_change', inputTokens: '~500-2000', outputTokens: '~500-1000', notes: 'Input includes code to validate' },
];

/**
 * AGENT NAVIGATION GUIDE
 * This is the decision tree that helps agents pick the right tools
 */
const AGENT_NAVIGATION_GUIDE: AgentNavigationGuide = {
  description: 'Use this guide to select the right tools based on user intent. Match keywords in the user query to find the recommended tool sequence.',
  
  decisionTree: [
    // === CODE GENERATION ===
    {
      triggers: ['add', 'create', 'implement', 'build', 'new feature', 'write code'],
      intent: 'Generate new code following codebase patterns',
      toolSequence: ['drift_context', 'drift_code_examples', 'drift_validate_change'],
      rationale: 'drift_context gives patterns + files to modify. drift_code_examples shows real implementations. drift_validate_change verifies the generated code.',
    },
    {
      triggers: ['modal', 'dialog', 'popup', 'form', 'component'],
      intent: 'Create a UI component',
      toolSequence: ['drift_context', 'drift_similar', 'drift_code_examples'],
      rationale: 'drift_context for component patterns. drift_similar finds similar components. drift_code_examples shows implementations.',
    },
    {
      triggers: ['api', 'endpoint', 'route', 'controller'],
      intent: 'Create an API endpoint',
      toolSequence: ['drift_context', 'drift_typescript', 'drift_code_examples'],
      rationale: 'drift_context for API patterns. drift_typescript action="routes" shows existing routes. drift_code_examples for implementations.',
    },
    
    // === BUG FIXING ===
    {
      triggers: ['fix', 'bug', 'error', 'broken', 'not working', 'issue'],
      intent: 'Fix a bug or error',
      toolSequence: ['drift_context', 'drift_file_patterns', 'drift_callers'],
      rationale: 'drift_context for area patterns. drift_file_patterns shows file conventions. drift_callers shows what calls the buggy code.',
    },
    {
      triggers: ['crash', 'exception', 'unhandled', 'throw'],
      intent: 'Fix error handling issues',
      toolSequence: ['drift_error_handling', 'drift_callers', 'drift_code_examples'],
      rationale: 'drift_error_handling action="gaps" finds unhandled errors. drift_callers shows call chain. drift_code_examples shows error patterns.',
    },
    
    // === REFACTORING ===
    {
      triggers: ['refactor', 'restructure', 'reorganize', 'clean up', 'improve'],
      intent: 'Refactor code safely',
      toolSequence: ['drift_impact_analysis', 'drift_coupling', 'drift_test_topology'],
      rationale: 'drift_impact_analysis shows blast radius. drift_coupling finds dependency issues. drift_test_topology ensures test coverage.',
    },
    {
      triggers: ['move', 'rename', 'extract', 'split'],
      intent: 'Move or rename code',
      toolSequence: ['drift_impact_analysis', 'drift_callers', 'drift_imports'],
      rationale: 'drift_impact_analysis shows what breaks. drift_callers shows all usages. drift_imports helps fix import statements.',
    },
    
    // === SECURITY ===
    {
      triggers: ['security', 'vulnerability', 'audit', 'sensitive', 'secret'],
      intent: 'Security review',
      toolSequence: ['drift_security_summary', 'drift_reachability', 'drift_env'],
      rationale: 'drift_security_summary for overview. drift_reachability traces data access. drift_env shows secret handling.',
    },
    {
      triggers: ['auth', 'authentication', 'authorization', 'permission', 'access control'],
      intent: 'Review auth patterns',
      toolSequence: ['drift_context', 'drift_middleware', 'drift_patterns_list'],
      rationale: 'drift_context focus="auth". drift_middleware shows auth middleware. drift_patterns_list categories=["auth"].',
    },
    
    // === UNDERSTANDING CODE ===
    {
      triggers: ['understand', 'explain', 'how does', 'what does', 'where is'],
      intent: 'Understand existing code',
      toolSequence: ['drift_explain', 'drift_callers', 'drift_file_patterns'],
      rationale: 'drift_explain gives comprehensive explanation. drift_callers shows usage. drift_file_patterns shows conventions.',
    },
    {
      triggers: ['who calls', 'what calls', 'used by', 'dependencies'],
      intent: 'Find code relationships',
      toolSequence: ['drift_callers', 'drift_impact_analysis'],
      rationale: 'drift_callers for direct callers. drift_impact_analysis for full dependency tree.',
    },
    {
      triggers: ['data flow', 'reaches', 'access', 'touches'],
      intent: 'Trace data flow',
      toolSequence: ['drift_reachability', 'drift_security_summary'],
      rationale: 'drift_reachability direction="forward" for what data code can access. direction="inverse" for who can access data.',
    },
    
    // === TESTING ===
    {
      triggers: ['test', 'coverage', 'untested', 'spec'],
      intent: 'Work with tests',
      toolSequence: ['drift_test_topology', 'drift_test_template'],
      rationale: 'drift_test_topology action="status" for overview, action="uncovered" for gaps. drift_test_template generates test scaffolding.',
    },
    
    // === PATTERNS ===
    {
      triggers: ['pattern', 'convention', 'how do we', 'standard', 'best practice'],
      intent: 'Find codebase patterns',
      toolSequence: ['drift_patterns_list', 'drift_code_examples'],
      rationale: 'drift_patterns_list to find patterns. drift_code_examples to see implementations.',
    },
    {
      triggers: ['similar', 'like this', 'example of', 'show me'],
      intent: 'Find similar code',
      toolSequence: ['drift_similar', 'drift_code_examples'],
      rationale: 'drift_similar finds semantically similar code. drift_code_examples shows pattern implementations.',
    },
  ],
  
  surgicalLookups: [
    { question: 'Who calls this function?', tool: 'drift_callers', example: 'function: "handleSubmit"' },
    { question: 'What is this function signature?', tool: 'drift_signature', example: 'symbol: "createUser"' },
    { question: 'What type is this?', tool: 'drift_type', example: 'type: "UserDTO"' },
    { question: 'How do I import X?', tool: 'drift_imports', example: 'symbols: ["useState", "useEffect"], targetFile: "src/components/MyComponent.tsx"' },
    { question: 'What changed recently?', tool: 'drift_recent', example: 'area: "src/api/"' },
    { question: 'What dependencies do we use?', tool: 'drift_dependencies', example: 'search: "react"' },
    { question: 'What middleware exists?', tool: 'drift_middleware', example: 'type: "auth"' },
    { question: 'What hooks exist?', tool: 'drift_hooks', example: 'category: "fetch"' },
    { question: 'What errors can occur?', tool: 'drift_errors', example: 'action: "types"' },
    { question: 'Generate a test template', tool: 'drift_test_template', example: 'targetFile: "src/services/user.ts"' },
    { question: 'Validate my code', tool: 'drift_prevalidate', example: 'code: "...", targetFile: "src/api/users.ts"' },
  ],
  
  commonMistakes: [
    'DON\'T skip drift_context - it synthesizes multiple sources and saves tool calls',
    'DON\'T use drift_code_examples without drift_context first - you need pattern IDs',
    'DON\'T guess file paths - use drift_files_list to find them',
    'DON\'T call language tools (drift_typescript, etc.) for general queries - use drift_context',
    'DO use drift_callers for "who uses X" questions - it\'s fast and precise',
    'DO use drift_similar when creating new code similar to existing code',
    'DO validate generated code with drift_validate_change or drift_prevalidate',
  ],
};

export async function handleCapabilities(
  _args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CapabilitiesData>();
  
  // Count total tools
  const toolCount = LAYER_INFO.reduce((sum, layer) => sum + layer.tools.length, 0);
  
  const data: CapabilitiesData = {
    summary: `Drift provides ${toolCount} MCP tools organized in ${LAYER_INFO.length} layers for codebase intelligence.`,
    toolCount,
    agentNavigationGuide: AGENT_NAVIGATION_GUIDE,
    layers: LAYER_INFO,
    quickStart: QUICK_START,
    byUseCase: USE_CASE_GUIDES,
    tokenEstimates: TOKEN_ESTIMATES,
  };
  
  return builder
    .withSummary(`Drift provides ${toolCount} MCP tools for codebase intelligence. Use the agentNavigationGuide to select tools based on user intent.`)
    .withData(data)
    .withHints({
      nextActions: [
        'FIRST: Check agentNavigationGuide.decisionTree - match user keywords to find tool sequence',
        'For quick lookups: Check agentNavigationGuide.surgicalLookups',
        'For code generation: drift_context → drift_code_examples → drift_validate_change',
        'For quick status: drift_status',
        'Avoid common mistakes listed in agentNavigationGuide.commonMistakes',
      ],
    })
    .buildContent();
}
