/**
 * drift_capabilities - Comprehensive Tool Guide
 * 
 * Discovery tool that explains all available tools and when to use them.
 * Helps AI agents understand the tool landscape and choose the right tool.
 * 
 * Enhanced version with:
 * - All 45+ tools documented
 * - Token cost estimates
 * - Use case examples
 * - Tool relationships
 */

import { createResponseBuilder } from '../../infrastructure/index.js';

export interface CapabilitiesData {
  summary: string;
  toolCount: number;
  layers: LayerInfo[];
  quickStart: QuickStartGuide;
  byUseCase: UseCaseGuide[];
  tokenEstimates: TokenEstimate[];
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

export async function handleCapabilities(
  _args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CapabilitiesData>();
  
  // Count total tools
  const toolCount = LAYER_INFO.reduce((sum, layer) => sum + layer.tools.length, 0);
  
  const data: CapabilitiesData = {
    summary: `Drift provides ${toolCount} MCP tools organized in ${LAYER_INFO.length} layers for codebase intelligence.`,
    toolCount,
    layers: LAYER_INFO,
    quickStart: QUICK_START,
    byUseCase: USE_CASE_GUIDES,
    tokenEstimates: TOKEN_ESTIMATES,
  };
  
  return builder
    .withSummary(`Drift provides ${toolCount} MCP tools for codebase intelligence. Start with drift_context for most tasks, or drift_status for a quick health check.`)
    .withData(data)
    .withHints({
      nextActions: [
        'For code generation: drift_context → drift_code_examples → drift_validate_change',
        'For quick status: drift_status',
        'For security review: drift_security_summary → drift_reachability',
        'For refactoring: drift_impact_analysis → drift_coupling',
        'Token costs: low (~200), medium (~1000), high (~3000+)',
        'drift_context is the recommended starting point for most tasks',
      ],
    })
    .buildContent();
}
