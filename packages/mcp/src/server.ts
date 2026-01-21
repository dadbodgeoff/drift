/**
 * Drift MCP Server Implementation
 * 
 * Provides structured access to drift functionality for AI agents.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  PatternStore,
  ManifestStore,
  HistoryStore,
  DNAStore,
  PlaybookGenerator,
  AIContextBuilder,
  GENE_IDS,
  BoundaryStore,
  type PatternCategory,
  type Pattern,
  type GeneId,
  type MutationImpact,
  type ContextLevel,
} from 'driftdetect-core';
import { PackManager, type PackDefinition } from './packs.js';
import { FeedbackManager } from './feedback.js';

const PATTERN_CATEGORIES: PatternCategory[] = [
  'structural', 'components', 'styling', 'api', 'auth', 'errors',
  'data-access', 'testing', 'logging', 'security', 'config',
  'types', 'performance', 'accessibility', 'documentation',
];

export interface DriftMCPConfig {
  projectRoot: string;
}

const TOOLS: Tool[] = [
  {
    name: 'drift_status',
    description: 'Get overall codebase pattern health and statistics. Use this first to understand what patterns drift has learned.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'drift_patterns',
    description: 'Get patterns for specific categories. Returns learned patterns with confidence scores and locations.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: `Categories to query. Valid: ${PATTERN_CATEGORIES.join(', ')}`,
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence score (0.0-1.0)',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_files',
    description: 'Get patterns found in a specific file or file pattern (glob supported).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path or glob pattern (e.g., "src/api/*.ts")',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'drift_where',
    description: 'Find where a pattern is used across the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Pattern name or ID to search for',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'drift_export',
    description: 'Export patterns in AI-optimized format. Use this to get full context for code generation.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categories to export (defaults to all)',
        },
        format: {
          type: 'string',
          enum: ['ai-context', 'json', 'summary'],
          description: 'Export format (default: ai-context)',
        },
        compact: {
          type: 'boolean',
          description: 'Compact output with fewer details',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_contracts',
    description: 'Get frontend/backend API contract status. Shows mismatches between API calls and endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'verified', 'mismatch', 'discovered'],
          description: 'Filter by contract status',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_examples',
    description: 'Get actual code examples for patterns. Returns real code snippets from the codebase that demonstrate how patterns are implemented. Use this to understand HOW to implement patterns. Automatically filters out documentation, config files, and deprecated code.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: `Categories to get examples for. Valid: ${PATTERN_CATEGORIES.join(', ')}`,
        },
        pattern: {
          type: 'string',
          description: 'Specific pattern name or ID to get examples for',
        },
        maxExamples: {
          type: 'number',
          description: 'Maximum examples per pattern (default: 3)',
        },
        contextLines: {
          type: 'number',
          description: 'Lines of context around each match (default: 10)',
        },
        includeDeprecated: {
          type: 'boolean',
          description: 'Include deprecated/legacy code examples (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_pack',
    description: 'Get a pre-defined pattern pack for common development tasks. Packs are cached and auto-invalidate when patterns change. Also supports learning new packs from usage patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'list', 'suggest', 'create', 'delete', 'infer'],
          description: 'Action to perform (default: "get"). "suggest" shows packs based on usage, "infer" suggests from file structure, "create" saves a custom pack, "delete" removes a custom pack',
        },
        name: {
          type: 'string',
          description: 'Pack name for get/create/delete actions',
        },
        refresh: {
          type: 'boolean',
          description: 'Force regenerate the pack even if cached (default: false)',
        },
        list: {
          type: 'boolean',
          description: '[DEPRECATED: use action="list"] List all available packs',
        },
        // For create action
        description: {
          type: 'string',
          description: 'Pack description (for create action)',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categories to include in pack (for create action)',
        },
        patterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pattern name filters (for create action)',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_feedback',
    description: 'Provide feedback on pattern examples to improve future suggestions. Good feedback helps drift learn which files produce useful examples.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['rate', 'stats', 'clear'],
          description: 'Action: "rate" to rate an example, "stats" to see feedback statistics, "clear" to reset all feedback',
        },
        patternId: {
          type: 'string',
          description: 'Pattern ID (for rate action)',
        },
        patternName: {
          type: 'string',
          description: 'Pattern name (for rate action)',
        },
        category: {
          type: 'string',
          description: 'Pattern category (for rate action)',
        },
        file: {
          type: 'string',
          description: 'File path of the example (for rate action)',
        },
        line: {
          type: 'number',
          description: 'Line number of the example (for rate action)',
        },
        rating: {
          type: 'string',
          enum: ['good', 'bad', 'irrelevant'],
          description: 'Rating: "good" = useful example, "bad" = wrong/misleading, "irrelevant" = not related to pattern',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the rating',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_trends',
    description: 'Get pattern trend analysis and regression alerts. Shows how patterns have changed over time. Use this to check codebase health before generating code or to identify patterns that need attention.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Time period to analyze (default: 7d)',
        },
        category: {
          type: 'string',
          description: `Filter trends by category. Valid: ${PATTERN_CATEGORIES.join(', ')}`,
        },
        severity: {
          type: 'string',
          enum: ['all', 'critical', 'warning'],
          description: 'Filter by severity level (default: all)',
        },
        type: {
          type: 'string',
          enum: ['all', 'regressions', 'improvements'],
          description: 'Filter by trend type (default: all)',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_parser_info',
    description: 'Get information about parser capabilities and status. Shows which parsers are available (tree-sitter vs regex), their features, and supported frameworks. Use this to understand parsing capabilities before analyzing Python, C#, TypeScript, or Java code.',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['python', 'csharp', 'typescript', 'java', 'all'],
          description: 'Language to get parser info for (default: all)',
        },
      },
      required: [],
    },
  },
  // DNA Tools
  {
    name: 'drift_dna',
    description: 'Get the styling DNA profile for the codebase. Shows how components are styled (variants, responsive, states, theming, spacing, animation) with confidence scores and exemplar files.',
    inputSchema: {
      type: 'object',
      properties: {
        gene: {
          type: 'string',
          enum: ['variant-handling', 'responsive-approach', 'state-styling', 'theming', 'spacing-philosophy', 'animation-approach'],
          description: 'Specific gene to query (optional)',
        },
        format: {
          type: 'string',
          enum: ['full', 'summary', 'ai-context'],
          description: 'Output format (default: ai-context)',
        },
        level: {
          type: 'number',
          enum: [1, 2, 3, 4],
          description: 'AI context detail level 1-4 (default: 3)',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_playbook',
    description: 'Generate or retrieve the styling playbook documentation. Contains conventions, code examples, and patterns to avoid for each styling concern.',
    inputSchema: {
      type: 'object',
      properties: {
        regenerate: {
          type: 'boolean',
          description: 'Force regeneration of playbook (default: false)',
        },
        section: {
          type: 'string',
          enum: ['variant-handling', 'responsive-approach', 'state-styling', 'theming', 'spacing-philosophy', 'animation-approach'],
          description: 'Specific section to retrieve (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_mutations',
    description: 'Get files that deviate from established styling patterns. Mutations are styling inconsistencies that fragment AI context.',
    inputSchema: {
      type: 'object',
      properties: {
        gene: {
          type: 'string',
          enum: ['variant-handling', 'responsive-approach', 'state-styling', 'theming', 'spacing-philosophy', 'animation-approach'],
          description: 'Filter by gene (optional)',
        },
        impact: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Filter by impact level (optional)',
        },
        suggest: {
          type: 'boolean',
          description: 'Include resolution suggestions (default: false)',
        },
      },
      required: [],
    },
  },
  {
    name: 'drift_dna_check',
    description: 'Check if code follows the established styling DNA. Use before generating component code to ensure consistency.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code snippet to check against DNA',
        },
        file: {
          type: 'string',
          description: 'File path to check (alternative to code)',
        },
        genes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific genes to check (optional, defaults to all)',
        },
      },
      required: [],
    },
  },
  // Data Boundaries Tool
  {
    name: 'drift_boundaries',
    description: 'Get data access boundaries and check for violations. Shows which code accesses which database tables/fields. Use this before generating data access code to understand access rules and restrictions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['overview', 'table', 'file', 'sensitive', 'check', 'rules'],
          description: 'Action to perform (default: overview). "overview" shows summary, "table" shows specific table access, "file" shows what data a file accesses, "sensitive" shows sensitive field access, "check" validates against rules, "rules" shows configured boundaries',
        },
        table: {
          type: 'string',
          description: 'Table name (required for "table" action)',
        },
        file: {
          type: 'string',
          description: 'File path or glob pattern (required for "file" action)',
        },
        includeViolations: {
          type: 'boolean',
          description: 'Include boundary violations in response (default: true)',
        },
      },
      required: [],
    },
  },
];

export function createDriftMCPServer(config: DriftMCPConfig): Server {
  const server = new Server(
    { name: 'drift', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const patternStore = new PatternStore({ rootDir: config.projectRoot });
  const manifestStore = new ManifestStore(config.projectRoot);
  const historyStore = new HistoryStore({ rootDir: config.projectRoot });
  const dnaStore = new DNAStore({ rootDir: config.projectRoot });
  const boundaryStore = new BoundaryStore({ rootDir: config.projectRoot });
  const packManager = new PackManager(config.projectRoot, patternStore);
  const feedbackManager = new FeedbackManager(config.projectRoot);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'drift_status':
          return await handleStatus(patternStore);

        case 'drift_patterns':
          return await handlePatterns(patternStore, args as {
            categories?: string[];
            minConfidence?: number;
          });

        case 'drift_files':
          return await handleFiles(manifestStore, args as {
            path: string;
            category?: string;
          });

        case 'drift_where':
          return await handleWhere(patternStore, args as {
            pattern: string;
            category?: string;
          });

        case 'drift_export':
          return await handleExport(patternStore, args as {
            categories?: string[];
            format?: string;
            compact?: boolean;
          });

        case 'drift_contracts':
          return await handleContracts(config.projectRoot, args as {
            status?: string;
          });

        case 'drift_examples':
          return await handleExamples(config.projectRoot, patternStore, packManager, feedbackManager, args as {
            categories?: string[];
            pattern?: string;
            maxExamples?: number;
            contextLines?: number;
            includeDeprecated?: boolean;
          });

        case 'drift_pack':
          return await handlePack(packManager, args as {
            action?: string;
            name?: string;
            refresh?: boolean;
            list?: boolean;
            description?: string;
            categories?: string[];
            patterns?: string[];
          });

        case 'drift_feedback':
          return await handleFeedback(feedbackManager, args as {
            action?: string;
            patternId?: string;
            patternName?: string;
            category?: string;
            file?: string;
            line?: number;
            rating?: 'good' | 'bad' | 'irrelevant';
            reason?: string;
          });

        case 'drift_trends':
          return await handleTrends(historyStore, args as {
            period?: '7d' | '30d' | '90d';
            category?: string;
            severity?: 'all' | 'critical' | 'warning';
            type?: 'all' | 'regressions' | 'improvements';
          });

        case 'drift_parser_info':
          return await handleParserInfo(args as {
            language?: string;
          });

        case 'drift_dna':
          return await handleDNA(config.projectRoot, dnaStore, args as {
            gene?: string;
            format?: string;
            level?: number;
          });

        case 'drift_playbook':
          return await handlePlaybook(config.projectRoot, dnaStore, args as {
            regenerate?: boolean;
            section?: string;
          });

        case 'drift_mutations':
          return await handleMutations(dnaStore, args as {
            gene?: string;
            impact?: string;
            suggest?: boolean;
          });

        case 'drift_dna_check':
          return await handleDNACheck(config.projectRoot, dnaStore, args as {
            code?: string;
            file?: string;
            genes?: string[];
          });

        case 'drift_boundaries':
          return await handleBoundaries(boundaryStore, args as {
            action?: string;
            table?: string;
            file?: string;
            includeViolations?: boolean;
          });

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  return server;
}

async function handleStatus(store: PatternStore) {
  await store.initialize();
  const stats = store.getStats();

  const result = {
    totalPatterns: stats.totalPatterns,
    byCategory: stats.byCategory,
    byConfidence: stats.byConfidenceLevel,
    byStatus: stats.byStatus,
    totalLocations: stats.totalLocations,
    totalOutliers: stats.totalOutliers,
    categories: PATTERN_CATEGORIES,
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

async function handlePatterns(
  store: PatternStore,
  args: { categories?: string[]; minConfidence?: number }
) {
  await store.initialize();

  let patterns = store.getAll();

  // Filter by categories
  if (args.categories && args.categories.length > 0) {
    const cats = new Set(args.categories);
    patterns = patterns.filter(p => cats.has(p.category));
  }

  // Filter by confidence
  if (args.minConfidence !== undefined) {
    patterns = patterns.filter(p => p.confidence.score >= args.minConfidence!);
  }

  // Format for AI consumption
  const result = patterns.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    description: p.description,
    confidence: p.confidence.score,
    confidenceLevel: p.confidence.level,
    locationCount: p.locations.length,
    outlierCount: p.outliers.length,
    exampleLocations: p.locations.slice(0, 3).map(l => ({
      file: l.file,
      line: l.line,
    })),
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

async function handleFiles(
  store: ManifestStore,
  args: { path: string; category?: string }
) {
  await store.load();

  const query: { path: string; category?: PatternCategory } = {
    path: args.path,
  };
  
  if (args.category) {
    query.category = args.category as PatternCategory;
  }

  const result = store.queryFile(query);

  if (!result) {
    return {
      content: [{ type: 'text', text: `No patterns found in "${args.path}"` }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

async function handleWhere(
  store: PatternStore,
  args: { pattern: string; category?: string }
) {
  await store.initialize();

  const searchTerm = args.pattern.toLowerCase();
  let patterns = store.getAll().filter(p =>
    p.id.toLowerCase().includes(searchTerm) ||
    p.name.toLowerCase().includes(searchTerm)
  );

  if (args.category) {
    patterns = patterns.filter(p => p.category === args.category);
  }

  const result = patterns.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    locations: p.locations.map(l => ({
      file: l.file,
      line: l.line,
      column: l.column,
    })),
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

async function handleExport(
  store: PatternStore,
  args: { categories?: string[]; format?: string; compact?: boolean }
) {
  await store.initialize();

  let patterns = store.getAll();

  // Filter by categories
  if (args.categories && args.categories.length > 0) {
    const cats = new Set(args.categories);
    patterns = patterns.filter(p => cats.has(p.category));
  }

  const format = args.format ?? 'ai-context';

  if (format === 'ai-context') {
    // Optimized format for LLM consumption
    const grouped = new Map<string, Pattern[]>();
    for (const p of patterns) {
      if (!grouped.has(p.category)) {
        grouped.set(p.category, []);
      }
      grouped.get(p.category)!.push(p);
    }

    let output = '# Codebase Patterns\n\n';
    output += `Total: ${patterns.length} patterns across ${grouped.size} categories\n\n`;

    for (const [category, categoryPatterns] of grouped) {
      output += `## ${category.toUpperCase()}\n\n`;

      for (const p of categoryPatterns) {
        output += `### ${p.name}\n`;
        output += `- Confidence: ${(p.confidence.score * 100).toFixed(0)}%\n`;
        output += `- Found in ${p.locations.length} locations\n`;
        if (p.description) {
          output += `- ${p.description}\n`;
        }
        if (!args.compact && p.locations.length > 0) {
          output += `- Examples: ${p.locations.slice(0, 2).map(l => l.file).join(', ')}\n`;
        }
        output += '\n';
      }
    }

    return {
      content: [{ type: 'text', text: output }],
    };
  }

  if (format === 'summary') {
    const stats = store.getStats();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalPatterns: stats.totalPatterns,
          byCategory: stats.byCategory,
          byConfidence: stats.byConfidenceLevel,
        }, null, 2),
      }],
    };
  }

  // JSON format
  return {
    content: [{ type: 'text', text: JSON.stringify(patterns, null, 2) }],
  };
}

async function handleContracts(projectRoot: string, args: { status?: string }) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const contractsDir = path.join(projectRoot, '.drift', 'contracts');

  try {
    const dirs = ['discovered', 'verified', 'mismatch'];
    const contracts: Array<{ status: string; contracts: unknown[] }> = [];

    for (const dir of dirs) {
      if (args.status && args.status !== 'all' && args.status !== dir) {
        continue;
      }

      const dirPath = path.join(contractsDir, dir);
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (file.endsWith('.json') && !file.startsWith('.')) {
            const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
            const data = JSON.parse(content);
            contracts.push({ status: dir, contracts: data.contracts ?? [] });
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(contracts, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `No contracts found. Run \`drift scan\` first.`,
      }],
    };
  }
}

async function handleExamples(
  projectRoot: string,
  store: PatternStore,
  packManager: PackManager,
  feedbackManager: FeedbackManager,
  args: {
    categories?: string[];
    pattern?: string;
    maxExamples?: number;
    contextLines?: number;
    includeDeprecated?: boolean;
  }
) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  // Require at least one filter to avoid processing all 800+ patterns
  if ((!args.categories || args.categories.length === 0) && !args.pattern) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Please specify at least one filter:\n' +
          '- categories: ["auth", "security", "api"] etc.\n' +
          '- pattern: "middleware", "token", "rate-limit" etc.\n\n' +
          'Valid categories: structural, components, styling, api, auth, errors, ' +
          'data-access, testing, logging, security, config, types, performance, ' +
          'accessibility, documentation',
      }],
      isError: true,
    };
  }

  await store.initialize();
  await packManager.initialize();
  await feedbackManager.initialize();

  // Track usage for pack learning
  if (args.categories && args.categories.length > 0) {
    await packManager.trackUsage({
      categories: args.categories,
      patterns: args.pattern ? [args.pattern] : undefined,
      timestamp: new Date().toISOString(),
      context: 'code_generation',
    });
  }

  const maxExamples = args.maxExamples ?? 3;
  const contextLines = args.contextLines ?? 10;
  const includeDeprecated = args.includeDeprecated ?? false;

  let patterns = store.getAll();

  // Filter by categories
  if (args.categories && args.categories.length > 0) {
    const cats = new Set(args.categories);
    patterns = patterns.filter(p => cats.has(p.category));
  }

  // Filter by pattern name/id
  if (args.pattern) {
    const searchTerm = args.pattern.toLowerCase();
    patterns = patterns.filter(p =>
      p.id.toLowerCase().includes(searchTerm) ||
      p.name.toLowerCase().includes(searchTerm) ||
      p.subcategory.toLowerCase().includes(searchTerm)
    );
  }

  // Deduplicate patterns by subcategory to get unique pattern types
  const uniquePatterns = new Map<string, typeof patterns[0]>();
  for (const p of patterns) {
    const key = `${p.category}/${p.subcategory}`;
    if (!uniquePatterns.has(key) || p.locations.length > uniquePatterns.get(key)!.locations.length) {
      uniquePatterns.set(key, p);
    }
  }

  // Limit to 20 unique patterns max to avoid timeout
  const limitedPatterns = Array.from(uniquePatterns.entries()).slice(0, 20);

  // File filtering patterns (same as packs.ts)
  const EXAMPLE_EXCLUDE_PATTERNS: RegExp[] = [
    /README/i, /CHANGELOG/i, /CONTRIBUTING/i, /LICENSE/i, /\.md$/i,
    /\.github\//, /\.gitlab\//, /\.ya?ml$/i, /\.toml$/i,
    /Dockerfile/i, /docker-compose/i,
    /package\.json$/i, /package-lock\.json$/i, /pnpm-lock\.yaml$/i,
    /requirements\.txt$/i, /pyproject\.toml$/i,
    /\.env/i, /dist\//, /build\//, /node_modules\//,
  ];

  const DEPRECATION_MARKERS: RegExp[] = [
    /DEPRECATED/i, /LEGACY/i, /@deprecated/i,
    /TODO:\s*remove/i, /REMOVAL:\s*planned/i,
    /backward.?compat/i, /will be removed/i,
  ];

  const shouldExcludeFile = (filePath: string): boolean => {
    // Check feedback-based exclusion first
    if (feedbackManager.shouldExcludeFile(filePath)) {
      return true;
    }
    return EXAMPLE_EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
  };

  const scoreLocation = (filePath: string): number => {
    let score = 1.0;
    
    // Apply feedback-based scoring
    score *= feedbackManager.getFileScore(filePath);
    
    // Apply heuristic scoring
    if (/\.md$/i.test(filePath)) score *= 0.1;
    if (/README/i.test(filePath)) score *= 0.1;
    if (/\.ya?ml$/i.test(filePath)) score *= 0.2;
    if (/\.json$/i.test(filePath)) score *= 0.3;
    if (/\.(ts|tsx|js|jsx|py|rb|go|rs|java)$/i.test(filePath)) score *= 1.5;
    if (/\/src\//i.test(filePath)) score *= 1.3;
    if (/\.(test|spec)\./i.test(filePath)) score *= 0.7;
    return score;
  };

  // Read actual code snippets
  const fileCache = new Map<string, string[]>();
  const fileContentCache = new Map<string, string>();
  let excludedCount = 0;
  let deprecatedCount = 0;

  async function getFileLines(filePath: string): Promise<string[]> {
    if (fileCache.has(filePath)) {
      return fileCache.get(filePath)!;
    }
    try {
      const fullPath = path.join(projectRoot, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      fileCache.set(filePath, lines);
      fileContentCache.set(filePath, content);
      return lines;
    } catch {
      return [];
    }
  }

  function extractSnippet(lines: string[], startLine: number, endLine?: number): string {
    const start = Math.max(0, startLine - contextLines - 1);
    const end = Math.min(lines.length, (endLine ?? startLine) + contextLines);
    return lines.slice(start, end).join('\n');
  }

  function isDeprecatedContent(content: string): boolean {
    const header = content.slice(0, 500);
    return DEPRECATION_MARKERS.some(pattern => pattern.test(header));
  }

  const results: Array<{
    category: string;
    subcategory: string;
    patternName: string;
    description: string;
    confidence: number;
    examples: Array<{
      file: string;
      line: number;
      code: string;
    }>;
  }> = [];

  for (const [, pattern] of limitedPatterns) {
    const examples: Array<{ file: string; line: number; code: string }> = [];

    // Sort locations by quality score and filter excluded files
    const scoredLocations = pattern.locations
      .map(loc => ({ loc, score: scoreLocation(loc.file) }))
      .filter(({ loc }) => !shouldExcludeFile(loc.file))
      .sort((a, b) => b.score - a.score);

    excludedCount += pattern.locations.length - scoredLocations.length;

    // Get unique files to avoid duplicate examples from same file
    const seenFiles = new Set<string>();
    
    for (const { loc } of scoredLocations) {
      if (seenFiles.has(loc.file)) continue;
      if (examples.length >= maxExamples) break;

      const lines = await getFileLines(loc.file);
      if (lines.length === 0) continue;

      // Check for deprecation markers
      const content = fileContentCache.get(loc.file) || '';
      if (!includeDeprecated && isDeprecatedContent(content)) {
        deprecatedCount++;
        continue;
      }

      const snippet = extractSnippet(lines, loc.line, loc.endLine);
      if (snippet.trim()) {
        examples.push({
          file: loc.file,
          line: loc.line,
          code: snippet,
        });
        seenFiles.add(loc.file);
      }
    }

    if (examples.length > 0) {
      results.push({
        category: pattern.category,
        subcategory: pattern.subcategory,
        patternName: pattern.name,
        description: pattern.description,
        confidence: pattern.confidence.score,
        examples,
      });
    }
  }

  // Format output for AI consumption
  let output = '# Code Pattern Examples\n\n';
  output += `Found ${results.length} unique patterns with code examples.\n`;
  if (excludedCount > 0 || deprecatedCount > 0) {
    output += `*(${excludedCount} non-source files excluded`;
    if (deprecatedCount > 0) {
      output += `, ${deprecatedCount} deprecated files skipped`;
    }
    output += `)*\n`;
  }
  output += '\n';

  // Group by category
  const grouped = new Map<string, typeof results>();
  for (const r of results) {
    if (!grouped.has(r.category)) {
      grouped.set(r.category, []);
    }
    grouped.get(r.category)!.push(r);
  }

  for (const [category, categoryResults] of grouped) {
    output += `## ${category.toUpperCase()}\n\n`;

    for (const r of categoryResults) {
      output += `### ${r.subcategory}\n`;
      output += `**${r.patternName}** (${(r.confidence * 100).toFixed(0)}% confidence)\n`;
      if (r.description) {
        output += `${r.description}\n`;
      }
      output += '\n';

      for (const ex of r.examples) {
        output += `**${ex.file}:${ex.line}**\n`;
        output += '```\n';
        output += ex.code;
        output += '\n```\n\n';
      }
    }
  }

  return {
    content: [{ type: 'text', text: output }],
  };
}

async function handlePack(
  packManager: PackManager,
  args: {
    action?: string;
    name?: string;
    refresh?: boolean;
    list?: boolean;
    description?: string;
    categories?: string[];
    patterns?: string[];
  }
) {
  await packManager.initialize();

  // Determine action (support legacy 'list' boolean)
  const action = args.action ?? (args.list ? 'list' : (args.name ? 'get' : 'list'));

  switch (action) {
    case 'list': {
      const packs = packManager.getAllPacks();
      let output = '# Available Pattern Packs\n\n';
      output += 'Use `drift_pack` with a pack name to get pre-computed pattern context.\n\n';
      output += '## Actions\n';
      output += '- `action="get"` - Get a pack by name (default)\n';
      output += '- `action="list"` - List all packs\n';
      output += '- `action="suggest"` - Suggest packs based on your usage patterns\n';
      output += '- `action="infer"` - Suggest packs from file structure analysis\n';
      output += '- `action="create"` - Create a custom pack\n';
      output += '- `action="delete"` - Delete a custom pack\n\n';
      
      for (const pack of packs) {
        output += `## ${pack.name}\n`;
        output += `${pack.description}\n`;
        output += `- Categories: ${pack.categories.join(', ')}\n`;
        if (pack.patterns) {
          output += `- Pattern filters: ${pack.patterns.join(', ')}\n`;
        }
        output += '\n';
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    }

    case 'suggest': {
      const suggestions = await packManager.suggestPacks();
      
      if (suggestions.length === 0) {
        return {
          content: [{
            type: 'text',
            text: '# No Pack Suggestions Yet\n\n' +
              'Pack suggestions are based on your usage patterns. Keep using `drift_examples` and `drift_pack` ' +
              'with different category combinations, and suggestions will appear here.\n\n' +
              'Alternatively, use `action="infer"` to get suggestions based on file structure analysis.',
          }],
        };
      }

      let output = '# Suggested Packs\n\n';
      output += 'Based on your usage patterns, these category combinations might be useful as packs:\n\n';
      
      for (const s of suggestions) {
        output += `## ${s.name}\n`;
        output += `${s.description}\n`;
        output += `- Categories: ${s.categories.join(', ')}\n`;
        if (s.patterns && s.patterns.length > 0) {
          output += `- Patterns: ${s.patterns.join(', ')}\n`;
        }
        output += `- Used ${s.usageCount} times (last: ${s.lastUsed})\n\n`;
        output += `To create this pack:\n`;
        output += '```\n';
        output += `drift_pack action="create" name="${s.name}" description="${s.description}" categories=${JSON.stringify(s.categories)}\n`;
        output += '```\n\n';
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    }

    case 'infer': {
      const suggestions = await packManager.inferPacksFromStructure();
      
      if (suggestions.length === 0) {
        return {
          content: [{
            type: 'text',
            text: '# No Inferred Packs\n\n' +
              'Could not find significant pattern co-occurrences in the codebase. ' +
              'This usually means patterns are well-separated by file, or the codebase needs more scanning.',
          }],
        };
      }

      let output = '# Inferred Packs from File Structure\n\n';
      output += 'These category combinations frequently appear together in the same files:\n\n';
      
      for (const s of suggestions) {
        output += `## ${s.name}\n`;
        output += `${s.description}\n`;
        output += `- Categories: ${s.categories.join(', ')}\n`;
        output += `- Found in ${s.usageCount} files\n\n`;
        output += `To create this pack:\n`;
        output += '```\n';
        output += `drift_pack action="create" name="${s.name}" description="${s.description}" categories=${JSON.stringify(s.categories)}\n`;
        output += '```\n\n';
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    }

    case 'create': {
      if (!args.name) {
        return {
          content: [{
            type: 'text',
            text: 'Error: Pack name is required for create action.\n\n' +
              'Example: drift_pack action="create" name="my_pack" description="My custom pack" categories=["api", "auth"]',
          }],
          isError: true,
        };
      }

      if (!args.categories || args.categories.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'Error: At least one category is required for create action.\n\n' +
              `Valid categories: ${PATTERN_CATEGORIES.join(', ')}`,
          }],
          isError: true,
        };
      }

      const packDef: PackDefinition = {
        name: args.name,
        description: args.description ?? `Custom pack: ${args.name}`,
        categories: args.categories,
        patterns: args.patterns,
      };

      await packManager.createCustomPack(packDef);

      return {
        content: [{
          type: 'text',
          text: `# Pack Created: ${args.name}\n\n` +
            `Successfully created custom pack "${args.name}".\n\n` +
            `- Categories: ${args.categories.join(', ')}\n` +
            (args.patterns ? `- Patterns: ${args.patterns.join(', ')}\n` : '') +
            `\nUse \`drift_pack name="${args.name}"\` to get the pack content.`,
        }],
      };
    }

    case 'delete': {
      if (!args.name) {
        return {
          content: [{
            type: 'text',
            text: 'Error: Pack name is required for delete action.',
          }],
          isError: true,
        };
      }

      const deleted = await packManager.deleteCustomPack(args.name);

      if (!deleted) {
        return {
          content: [{
            type: 'text',
            text: `Error: Pack "${args.name}" not found or is a built-in pack (cannot delete built-in packs).`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Successfully deleted custom pack "${args.name}".`,
        }],
      };
    }

    case 'get':
    default: {
      if (!args.name) {
        // Fall back to list if no name provided
        return handlePack(packManager, { action: 'list' });
      }

      try {
        const result = await packManager.getPackContent(args.name, {
          refresh: args.refresh ?? false,
        });

        // Track usage for learning
        const pack = packManager.getPack(args.name);
        if (pack) {
          await packManager.trackUsage({
            categories: pack.categories,
            patterns: pack.patterns,
            timestamp: new Date().toISOString(),
            context: 'code_generation',
          });
        }

        let header = '';
        if (result.fromCache) {
          header = `<!-- Served from cache (generated: ${result.generatedAt}) -->\n\n`;
        } else if (result.staleReason) {
          header = `<!-- Regenerated: ${result.staleReason} -->\n\n`;
        } else {
          header = `<!-- Freshly generated -->\n\n`;
        }

        return {
          content: [{ type: 'text', text: header + result.content }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  }
}

async function handleFeedback(
  feedbackManager: FeedbackManager,
  args: {
    action?: string;
    patternId?: string;
    patternName?: string;
    category?: string;
    file?: string;
    line?: number;
    rating?: 'good' | 'bad' | 'irrelevant';
    reason?: string;
  }
) {
  await feedbackManager.initialize();
  
  const action = args.action ?? 'stats';
  
  switch (action) {
    case 'rate': {
      if (!args.file || !args.rating) {
        return {
          content: [{
            type: 'text',
            text: 'Error: "file" and "rating" are required for rate action.\n\n' +
              'Example: drift_feedback action="rate" file="api/routes/auth.py" line=42 ' +
              'rating="good" patternName="token-handling" category="auth"',
          }],
          isError: true,
        };
      }
      
      await feedbackManager.recordFeedback({
        patternId: args.patternId ?? 'unknown',
        patternName: args.patternName ?? 'unknown',
        category: args.category ?? 'unknown',
        file: args.file,
        line: args.line ?? 0,
        rating: args.rating,
        reason: args.reason,
      });
      
      const emoji = args.rating === 'good' ? '👍' : args.rating === 'bad' ? '👎' : '🤷';
      return {
        content: [{
          type: 'text',
          text: `${emoji} Feedback recorded for ${args.file}:${args.line ?? 0}\n\n` +
            `Rating: ${args.rating}\n` +
            (args.reason ? `Reason: ${args.reason}\n` : '') +
            `\nThis feedback will improve future example suggestions.`,
        }],
      };
    }
    
    case 'stats': {
      const stats = await feedbackManager.getStats();
      
      let output = '# Example Feedback Statistics\n\n';
      output += `Total feedback: ${stats.totalFeedback}\n`;
      output += `- Good examples: ${stats.goodExamples}\n`;
      output += `- Bad examples: ${stats.badExamples}\n`;
      output += `- Irrelevant: ${stats.irrelevantExamples}\n\n`;
      
      if (stats.topGoodPatterns.length > 0) {
        output += '## Top Patterns with Good Examples\n';
        for (const p of stats.topGoodPatterns) {
          output += `- ${p.pattern}: ${p.count} good\n`;
        }
        output += '\n';
      }
      
      if (stats.topBadPatterns.length > 0) {
        output += '## Patterns Needing Improvement\n';
        for (const p of stats.topBadPatterns) {
          output += `- ${p.pattern}: ${p.count} bad\n`;
        }
        output += '\n';
      }
      
      if (stats.topBadFiles.length > 0) {
        output += '## Files Producing Poor Examples\n';
        output += 'These files are being deprioritized in example selection:\n';
        for (const f of stats.topBadFiles) {
          output += `- ${f.file}: ${f.count} negative ratings\n`;
        }
      }
      
      return {
        content: [{ type: 'text', text: output }],
      };
    }
    
    case 'clear': {
      await feedbackManager.clearFeedback();
      return {
        content: [{
          type: 'text',
          text: '✅ All feedback has been cleared. Example scoring reset to defaults.',
        }],
      };
    }
    
    default:
      return {
        content: [{
          type: 'text',
          text: `Unknown action: ${action}. Valid actions: rate, stats, clear`,
        }],
        isError: true,
      };
  }
}


async function handleTrends(
  historyStore: HistoryStore,
  args: {
    period?: '7d' | '30d' | '90d';
    category?: string;
    severity?: 'all' | 'critical' | 'warning';
    type?: 'all' | 'regressions' | 'improvements';
  }
) {
  await historyStore.initialize();

  const period = args.period ?? '7d';
  const summary = await historyStore.getTrendSummary(period);

  if (!summary) {
    return {
      content: [{
        type: 'text',
        text: '# No Trend Data Available\n\n' +
          'Pattern trends require at least 2 snapshots. Snapshots are created automatically when you run `drift scan`.\n\n' +
          'Run a few scans over time to start tracking trends.',
      }],
    };
  }

  // Filter by category if specified
  let regressions = summary.regressions;
  let improvements = summary.improvements;

  if (args.category) {
    regressions = regressions.filter(t => t.category === args.category);
    improvements = improvements.filter(t => t.category === args.category);
  }

  // Filter by severity
  if (args.severity && args.severity !== 'all') {
    regressions = regressions.filter(t => t.severity === args.severity);
  }

  // Filter by type
  if (args.type === 'regressions') {
    improvements = [];
  } else if (args.type === 'improvements') {
    regressions = [];
  }

  // Build output
  let output = `# Pattern Trends (${period})\n\n`;
  output += `Period: ${summary.startDate} → ${summary.endDate}\n`;
  output += `Overall trend: **${summary.overallTrend.toUpperCase()}** (${summary.healthDelta >= 0 ? '+' : ''}${(summary.healthDelta * 100).toFixed(1)}% health)\n\n`;

  // Summary stats
  output += `## Summary\n`;
  output += `- Regressions: ${regressions.length}\n`;
  output += `- Improvements: ${improvements.length}\n`;
  output += `- Stable patterns: ${summary.stable}\n\n`;

  // Critical regressions first
  const criticalRegressions = regressions.filter(t => t.severity === 'critical');
  if (criticalRegressions.length > 0) {
    output += `## ⚠️ Critical Regressions\n\n`;
    for (const t of criticalRegressions) {
      output += `### ${t.patternName} (${t.category})\n`;
      output += `- ${t.details}\n`;
      output += `- Metric: ${t.metric}\n`;
      output += `- Change: ${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(1)}%\n\n`;
    }
  }

  // Warning regressions
  const warningRegressions = regressions.filter(t => t.severity === 'warning');
  if (warningRegressions.length > 0) {
    output += `## ⚡ Warning Regressions\n\n`;
    for (const t of warningRegressions) {
      output += `### ${t.patternName} (${t.category})\n`;
      output += `- ${t.details}\n`;
      output += `- Metric: ${t.metric}\n`;
      output += `- Change: ${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(1)}%\n\n`;
    }
  }

  // Improvements
  if (improvements.length > 0) {
    output += `## ✅ Improvements\n\n`;
    for (const t of improvements) {
      output += `### ${t.patternName} (${t.category})\n`;
      output += `- ${t.details}\n`;
      output += `- Metric: ${t.metric}\n`;
      output += `- Change: +${t.changePercent.toFixed(1)}%\n\n`;
    }
  }

  // Category breakdown
  const categoryEntries = Object.entries(summary.categoryTrends);
  if (categoryEntries.length > 0) {
    output += `## Category Trends\n\n`;
    for (const [category, trend] of categoryEntries) {
      const emoji = trend.trend === 'improving' ? '📈' : trend.trend === 'declining' ? '📉' : '➡️';
      output += `- ${emoji} **${category}**: ${trend.trend} (confidence: ${trend.avgConfidenceChange >= 0 ? '+' : ''}${(trend.avgConfidenceChange * 100).toFixed(1)}%, compliance: ${trend.complianceChange >= 0 ? '+' : ''}${(trend.complianceChange * 100).toFixed(1)}%)\n`;
    }
  }

  return {
    content: [{ type: 'text', text: output }],
  };
}

/**
 * Handle drift_parser_info tool
 * 
 * Returns information about parser capabilities and status.
 */
async function handleParserInfo(args: { language?: string }) {
  const language = args.language ?? 'all';
  
  interface ParserInfo {
    treeSitterAvailable: boolean;
    activeParser: string;
    capabilities: Record<string, boolean>;
    supportedFrameworks: string[];
    expectedConfidence?: string | undefined;
    loadingError?: string | undefined;
  }
  
  const info: {
    python?: ParserInfo;
    csharp?: ParserInfo;
    typescript?: ParserInfo;
    java?: ParserInfo;
    php?: ParserInfo;
  } = {};
  
  // Python parser info
  if (language === 'python' || language === 'all') {
    let treeSitterAvailable = false;
    let loadingError: string | undefined;
    
    try {
      const core = await import('driftdetect-core');
      // Check if the functions exist (they may not be exported yet)
      if ('isTreeSitterAvailable' in core && 'getLoadingError' in core) {
        treeSitterAvailable = (core as { isTreeSitterAvailable: () => boolean }).isTreeSitterAvailable();
        loadingError = (core as { getLoadingError: () => string | null }).getLoadingError() ?? undefined;
      }
    } catch {
      loadingError = 'driftdetect-core not available';
    }
    
    info.python = {
      treeSitterAvailable,
      activeParser: treeSitterAvailable ? 'tree-sitter' : 'regex',
      capabilities: {
        basicRouteDetection: true,
        simplePydanticModels: true,
        pydanticModels: treeSitterAvailable,
        nestedTypes: treeSitterAvailable,
        fieldConstraints: treeSitterAvailable,
        inheritance: treeSitterAvailable,
        generics: treeSitterAvailable,
        django: treeSitterAvailable,
        typeHints: treeSitterAvailable,
      },
      supportedFrameworks: treeSitterAvailable 
        ? ['fastapi', 'flask', 'django', 'starlette']
        : ['fastapi', 'flask'],
      expectedConfidence: treeSitterAvailable ? 'high (0.7-0.9)' : 'low (0.3-0.5)',
      loadingError,
    };
  }
  
  // C# parser info
  if (language === 'csharp' || language === 'all') {
    let treeSitterAvailable = false;
    let loadingError: string | undefined;
    
    try {
      const { isCSharpTreeSitterAvailable, getCSharpLoadingError } = await import('driftdetect-core');
      treeSitterAvailable = isCSharpTreeSitterAvailable();
      loadingError = getCSharpLoadingError() ?? undefined;
    } catch {
      loadingError = 'C# parser not available';
    }
    
    info.csharp = {
      treeSitterAvailable,
      activeParser: treeSitterAvailable ? 'tree-sitter' : 'regex',
      capabilities: {
        basicParsing: true,
        classExtraction: treeSitterAvailable,
        methodExtraction: treeSitterAvailable,
        attributeExtraction: treeSitterAvailable,
        aspNetControllers: treeSitterAvailable,
        minimalApis: treeSitterAvailable,
        recordTypes: treeSitterAvailable,
      },
      supportedFrameworks: treeSitterAvailable 
        ? ['asp.net-core', 'minimal-apis', 'web-api']
        : [],
      loadingError,
    };
  }
  
  // TypeScript parser info
  if (language === 'typescript' || language === 'all') {
    info.typescript = {
      treeSitterAvailable: true, // TypeScript uses compiler API, always available
      activeParser: 'typescript-compiler-api',
      capabilities: {
        fullAST: true,
        typeInference: true,
        interfaces: true,
        generics: true,
        decorators: true,
      },
      supportedFrameworks: ['express', 'nestjs', 'fastify'],
    };
  }
  
  // Java parser info
  if (language === 'java' || language === 'all') {
    let javaTreeSitterAvailable = false;
    let javaLoadingError: string | undefined;
    
    try {
      const core = await import('driftdetect-core');
      // Check if the functions exist (they may not be exported yet)
      if ('isJavaTreeSitterAvailable' in core && 'getJavaLoadingError' in core) {
        javaTreeSitterAvailable = (core as { isJavaTreeSitterAvailable: () => boolean }).isJavaTreeSitterAvailable();
        javaLoadingError = (core as { getJavaLoadingError: () => string | null }).getJavaLoadingError() ?? undefined;
      } else {
        javaLoadingError = 'Java parser functions not yet available in driftdetect-core';
      }
    } catch {
      javaLoadingError = 'Java parser not available';
    }
    
    info.java = {
      treeSitterAvailable: javaTreeSitterAvailable,
      activeParser: javaTreeSitterAvailable ? 'tree-sitter' : 'regex',
      capabilities: {
        basicParsing: true,
        classExtraction: javaTreeSitterAvailable,
        methodExtraction: javaTreeSitterAvailable,
        annotationExtraction: javaTreeSitterAvailable,
        springControllers: javaTreeSitterAvailable,
        springData: javaTreeSitterAvailable,
        springSecurity: javaTreeSitterAvailable,
        recordTypes: javaTreeSitterAvailable,
      },
      supportedFrameworks: javaTreeSitterAvailable 
        ? ['spring-boot', 'spring-mvc', 'spring-data', 'spring-security']
        : [],
      loadingError: javaLoadingError,
    };
  }
  
  // PHP parser info
  if (language === 'php' || language === 'all') {
    let phpTreeSitterAvailable = false;
    let phpLoadingError: string | undefined;
    
    try {
      const core = await import('driftdetect-core');
      // Check if the functions exist
      if ('isPhpTreeSitterAvailable' in core && 'getPhpLoadingError' in core) {
        phpTreeSitterAvailable = (core as { isPhpTreeSitterAvailable: () => boolean }).isPhpTreeSitterAvailable();
        phpLoadingError = (core as { getPhpLoadingError: () => string | null }).getPhpLoadingError() ?? undefined;
      } else {
        phpLoadingError = 'PHP parser functions not yet available in driftdetect-core';
      }
    } catch {
      phpLoadingError = 'PHP parser not available';
    }
    
    info.php = {
      treeSitterAvailable: phpTreeSitterAvailable,
      activeParser: phpTreeSitterAvailable ? 'tree-sitter' : 'regex',
      capabilities: {
        basicParsing: true,
        classExtraction: phpTreeSitterAvailable,
        methodExtraction: phpTreeSitterAvailable,
        attributeExtraction: phpTreeSitterAvailable,
        laravelControllers: phpTreeSitterAvailable,
        laravelModels: phpTreeSitterAvailable,
        traitExtraction: phpTreeSitterAvailable,
        enumExtraction: phpTreeSitterAvailable,
      },
      supportedFrameworks: phpTreeSitterAvailable 
        ? ['laravel', 'symfony', 'php8']
        : ['laravel'],
      loadingError: phpLoadingError,
    };
  }
  
  // Build human-readable output
  let output = '# Parser Information\n\n';
  
  if (info.python) {
    const py = info.python;
    output += '## Python\n\n';
    output += `- **Active Parser:** ${py.activeParser}\n`;
    output += `- **Tree-sitter:** ${py.treeSitterAvailable ? '✓ available' : '✗ not installed'}\n`;
    output += `- **Expected Confidence:** ${py.expectedConfidence}\n`;
    output += `- **Supported Frameworks:** ${py.supportedFrameworks.join(', ')}\n\n`;
    
    output += '### Capabilities\n\n';
    for (const [cap, enabled] of Object.entries(py.capabilities)) {
      const emoji = enabled ? '✓' : '✗';
      const capName = cap.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      output += `- ${emoji} ${capName}\n`;
    }
    output += '\n';
    
    if (py.loadingError) {
      output += `> ⚠️ Loading error: ${py.loadingError}\n\n`;
    }
  }
  
  if (info.csharp) {
    const cs = info.csharp;
    output += '## C#\n\n';
    output += `- **Active Parser:** ${cs.activeParser}\n`;
    output += `- **Tree-sitter:** ${cs.treeSitterAvailable ? '✓ available' : '✗ not installed'}\n`;
    
    if (cs.supportedFrameworks.length > 0) {
      output += `- **Supported Frameworks:** ${cs.supportedFrameworks.join(', ')}\n`;
    }
    output += '\n';
    
    output += '### Capabilities\n\n';
    for (const [cap, enabled] of Object.entries(cs.capabilities)) {
      const emoji = enabled ? '✓' : '✗';
      const capName = cap.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      output += `- ${emoji} ${capName}\n`;
    }
    output += '\n';
    
    if (cs.loadingError) {
      output += `> ⚠️ Loading error: ${cs.loadingError}\n\n`;
    }
  }
  
  if (info.typescript) {
    const ts = info.typescript;
    output += '## TypeScript/JavaScript\n\n';
    output += `- **Active Parser:** ${ts.activeParser}\n\n`;
    
    output += '### Capabilities\n\n';
    for (const [cap, enabled] of Object.entries(ts.capabilities)) {
      const emoji = enabled ? '✓' : '✗';
      const capName = cap.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      output += `- ${emoji} ${capName}\n`;
    }
    output += '\n';
  }
  
  if (info.java) {
    const java = info.java;
    output += '## Java\n\n';
    output += `- **Active Parser:** ${java.activeParser}\n`;
    output += `- **Tree-sitter:** ${java.treeSitterAvailable ? '✓ available' : '✗ not installed'}\n`;
    
    if (java.supportedFrameworks.length > 0) {
      output += `- **Supported Frameworks:** ${java.supportedFrameworks.join(', ')}\n`;
    }
    output += '\n';
    
    output += '### Capabilities\n\n';
    for (const [cap, enabled] of Object.entries(java.capabilities)) {
      const emoji = enabled ? '✓' : '✗';
      const capName = cap.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      output += `- ${emoji} ${capName}\n`;
    }
    output += '\n';
    
    if (java.loadingError) {
      output += `> ⚠️ Loading error: ${java.loadingError}\n\n`;
    }
  }
  
  if (info.php) {
    const php = info.php;
    output += '## PHP\n\n';
    output += `- **Active Parser:** ${php.activeParser}\n`;
    output += `- **Tree-sitter:** ${php.treeSitterAvailable ? '✓ available' : '✗ not installed'}\n`;
    
    if (php.supportedFrameworks.length > 0) {
      output += `- **Supported Frameworks:** ${php.supportedFrameworks.join(', ')}\n`;
    }
    output += '\n';
    
    output += '### Capabilities\n\n';
    for (const [cap, enabled] of Object.entries(php.capabilities)) {
      const emoji = enabled ? '✓' : '✗';
      const capName = cap.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      output += `- ${emoji} ${capName}\n`;
    }
    output += '\n';
    
    if (php.loadingError) {
      output += `> ⚠️ Loading error: ${php.loadingError}\n\n`;
    }
  }
  
  // Installation tips
  if ((info.python && !info.python.treeSitterAvailable) || (info.csharp && !info.csharp.treeSitterAvailable) || (info.java && !info.java.treeSitterAvailable) || (info.php && !info.php.treeSitterAvailable)) {
    output += '## Installation Tips\n\n';
    
    if (info.python && !info.python.treeSitterAvailable) {
      output += 'To enable full Python support (Pydantic, Django, nested types):\n';
      output += '```bash\npnpm add tree-sitter tree-sitter-python\n```\n\n';
    }
    
    if (info.csharp && !info.csharp.treeSitterAvailable) {
      output += 'To enable full C# support (ASP.NET, attributes, records):\n';
      output += '```bash\npnpm add tree-sitter tree-sitter-c-sharp\n```\n\n';
    }
    
    if (info.java && !info.java.treeSitterAvailable) {
      output += 'To enable full Java support (Spring Boot, annotations, records):\n';
      output += '```bash\npnpm add tree-sitter tree-sitter-java\n```\n\n';
    }
    
    if (info.php && !info.php.treeSitterAvailable) {
      output += 'To enable full PHP support (Laravel, Symfony, PHP 8 attributes):\n';
      output += '```bash\npnpm add tree-sitter tree-sitter-php\n```\n\n';
    }
  }
  
  return {
    content: [{ type: 'text', text: output }],
  };
}

// ============================================================================
// DNA Handler Functions
// ============================================================================

/**
 * Handle drift_dna tool - Get styling DNA profile
 */
async function handleDNA(
  _projectRoot: string,
  store: DNAStore,
  args: { gene?: string; format?: string; level?: number }
) {
  await store.initialize();
  const profile = await store.load();

  if (!profile) {
    return {
      content: [{
        type: 'text',
        text: '# No DNA Profile Found\n\n' +
          'Run `drift dna scan` to analyze your codebase styling patterns.\n\n' +
          'The DNA profile captures how your codebase handles:\n' +
          '- Variant handling (primary/secondary buttons, sizes)\n' +
          '- Responsive design (mobile-first, breakpoints)\n' +
          '- State styling (hover, focus, disabled)\n' +
          '- Theming (dark mode, CSS variables)\n' +
          '- Spacing philosophy (design tokens, scales)\n' +
          '- Animation approach (transitions, motion)',
      }],
    };
  }

  const format = args.format ?? 'ai-context';

  // Filter by specific gene if requested
  if (args.gene && GENE_IDS.includes(args.gene as GeneId)) {
    const gene = profile.genes[args.gene as GeneId];
    const mutations = profile.mutations.filter(m => m.gene === args.gene);

    let output = `# Gene: ${gene.name}\n\n`;
    output += `${gene.description}\n\n`;
    output += `## Summary\n`;
    output += `- **Dominant Allele:** ${gene.dominant?.name ?? 'None established'}\n`;
    output += `- **Confidence:** ${Math.round(gene.confidence * 100)}%\n`;
    output += `- **Consistency:** ${Math.round(gene.consistency * 100)}%\n\n`;

    if (gene.alleles.length > 0) {
      output += `## Alleles Detected\n\n`;
      for (const allele of gene.alleles) {
        const marker = allele.isDominant ? ' ← DOMINANT' : '';
        output += `### ${allele.name}${marker}\n`;
        output += `- Frequency: ${Math.round(allele.frequency * 100)}% (${allele.fileCount} files)\n`;
        if (allele.examples.length > 0) {
          const ex = allele.examples[0];
          if (ex) {
            output += `- Example: \`${ex.file}:${ex.line}\`\n`;
            output += `\`\`\`\n${ex.code}\n\`\`\`\n`;
          }
        }
        output += '\n';
      }
    }

    if (gene.exemplars.length > 0) {
      output += `## Exemplar Files\n`;
      for (const f of gene.exemplars) {
        output += `- ${f}\n`;
      }
      output += '\n';
    }

    if (mutations.length > 0) {
      output += `## Mutations (${mutations.length})\n\n`;
      for (const m of mutations.slice(0, 5)) {
        output += `- **${m.file}:${m.line}** - ${m.actual} (expected: ${m.expected})\n`;
      }
      if (mutations.length > 5) {
        output += `- ... and ${mutations.length - 5} more\n`;
      }
    }

    return { content: [{ type: 'text', text: output }] };
  }

  // Full profile output
  if (format === 'full' || format === 'json') {
    return {
      content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }],
    };
  }

  if (format === 'summary') {
    let output = `# Styling DNA Summary\n\n`;
    output += `- **Health Score:** ${profile.summary.healthScore}/100\n`;
    output += `- **Framework:** ${profile.summary.dominantFramework}\n`;
    output += `- **Genetic Diversity:** ${profile.summary.geneticDiversity.toFixed(2)}\n`;
    output += `- **Components Analyzed:** ${profile.summary.totalComponentsAnalyzed}\n`;
    output += `- **Mutations:** ${profile.mutations.length}\n\n`;

    output += `## Genes\n\n`;
    output += `| Gene | Dominant | Confidence |\n`;
    output += `|------|----------|------------|\n`;
    for (const geneId of GENE_IDS) {
      const gene = profile.genes[geneId];
      output += `| ${gene.name} | ${gene.dominant?.name ?? 'None'} | ${Math.round(gene.confidence * 100)}% |\n`;
    }

    return { content: [{ type: 'text', text: output }] };
  }

  // AI context format (default)
  const level = (args.level ?? 3) as ContextLevel;
  const builder = new AIContextBuilder();
  const context = builder.build(profile, level);

  return { content: [{ type: 'text', text: context }] };
}

/**
 * Handle drift_playbook tool - Generate styling playbook
 */
async function handlePlaybook(
  _projectRoot: string,
  store: DNAStore,
  args: { regenerate?: boolean; section?: string }
) {
  await store.initialize();
  const profile = await store.load();

  if (!profile) {
    return {
      content: [{
        type: 'text',
        text: '# No DNA Profile Found\n\n' +
          'Run `drift dna scan` first to analyze your codebase styling patterns.',
      }],
    };
  }

  const generator = new PlaybookGenerator();
  const playbook = generator.generate(profile);

  // Filter to specific section if requested
  if (args.section && GENE_IDS.includes(args.section as GeneId)) {
    const gene = profile.genes[args.section as GeneId];
    const sectionRegex = new RegExp(`## ${gene.name}[\\s\\S]*?(?=\\n## |$)`, 'i');
    const match = playbook.match(sectionRegex);

    if (match) {
      return { content: [{ type: 'text', text: match[0] }] };
    }
  }

  return { content: [{ type: 'text', text: playbook }] };
}

/**
 * Handle drift_mutations tool - Get styling mutations
 */
async function handleMutations(
  store: DNAStore,
  args: { gene?: string; impact?: string; suggest?: boolean }
) {
  await store.initialize();
  const profile = await store.load();

  if (!profile) {
    return {
      content: [{
        type: 'text',
        text: '# No DNA Profile Found\n\n' +
          'Run `drift dna scan` first to analyze your codebase styling patterns.',
      }],
    };
  }

  let mutations = profile.mutations;

  // Filter by gene
  if (args.gene && GENE_IDS.includes(args.gene as GeneId)) {
    mutations = mutations.filter(m => m.gene === args.gene);
  }

  // Filter by impact
  if (args.impact) {
    const validImpacts: MutationImpact[] = ['low', 'medium', 'high'];
    if (validImpacts.includes(args.impact as MutationImpact)) {
      mutations = mutations.filter(m => m.impact === args.impact);
    }
  }

  if (mutations.length === 0) {
    return {
      content: [{
        type: 'text',
        text: '# No Mutations Found\n\n' +
          '✓ Your codebase styling is consistent with the established DNA patterns.',
      }],
    };
  }

  // Group by impact
  const byImpact = { high: [] as typeof mutations, medium: [] as typeof mutations, low: [] as typeof mutations };
  for (const m of mutations) byImpact[m.impact].push(m);

  let output = `# Styling Mutations (${mutations.length})\n\n`;
  output += 'Mutations are files that deviate from the established styling DNA.\n\n';

  if (byImpact.high.length > 0) {
    output += `## ⚠️ High Impact (${byImpact.high.length})\n\n`;
    for (const m of byImpact.high) {
      output += `### ${m.file}:${m.line}\n`;
      output += `- **Gene:** ${m.gene}\n`;
      output += `- **Found:** ${m.actual}\n`;
      output += `- **Expected:** ${m.expected}\n`;
      if (args.suggest && m.suggestion) {
        output += `- **Suggestion:** ${m.suggestion}\n`;
      }
      output += '\n';
    }
  }

  if (byImpact.medium.length > 0) {
    output += `## ⚡ Medium Impact (${byImpact.medium.length})\n\n`;
    for (const m of byImpact.medium.slice(0, 10)) {
      output += `- **${m.file}:${m.line}** - ${m.actual} → ${m.expected}\n`;
      if (args.suggest && m.suggestion) {
        output += `  - 💡 ${m.suggestion}\n`;
      }
    }
    if (byImpact.medium.length > 10) {
      output += `- ... and ${byImpact.medium.length - 10} more\n`;
    }
    output += '\n';
  }

  if (byImpact.low.length > 0) {
    output += `## Low Impact (${byImpact.low.length})\n\n`;
    for (const m of byImpact.low.slice(0, 5)) {
      output += `- ${m.file}:${m.line} - ${m.actual}\n`;
    }
    if (byImpact.low.length > 5) {
      output += `- ... and ${byImpact.low.length - 5} more\n`;
    }
  }

  return { content: [{ type: 'text', text: output }] };
}

/**
 * Handle drift_dna_check tool - Check code against DNA
 */
async function handleDNACheck(
  projectRoot: string,
  store: DNAStore,
  args: { code?: string; file?: string; genes?: string[] }
) {
  await store.initialize();
  const profile = await store.load();

  if (!profile) {
    return {
      content: [{
        type: 'text',
        text: '# No DNA Profile Found\n\n' +
          'Run `drift dna scan` first to establish styling patterns.',
      }],
    };
  }

  if (!args.code && !args.file) {
    // Return DNA conventions for code generation
    const builder = new AIContextBuilder();
    const context = builder.build(profile, 3);

    return {
      content: [{
        type: 'text',
        text: '# Styling DNA Conventions\n\n' +
          'Use these conventions when generating component code:\n\n' +
          context,
      }],
    };
  }

  // If file is provided, read it
  let code = args.code ?? '';
  if (args.file) {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      code = await fs.readFile(path.join(projectRoot, args.file), 'utf-8');
    } catch {
      return {
        content: [{
          type: 'text',
          text: `Error: Could not read file "${args.file}"`,
        }],
        isError: true,
      };
    }
  }

  // Simple pattern matching check against DNA
  const issues: Array<{ gene: string; issue: string; suggestion: string }> = [];
  const genesToCheck = args.genes?.filter(g => GENE_IDS.includes(g as GeneId)) ?? [...GENE_IDS];

  for (const geneId of genesToCheck) {
    const gene = profile.genes[geneId as GeneId];
    if (!gene.dominant) continue;

    // Check for non-dominant alleles in the code
    for (const allele of gene.alleles) {
      if (allele.isDominant) continue;

      // Simple heuristic checks based on allele patterns
      const patterns: Record<string, RegExp[]> = {
        'styled-variants': [/styled\.\w+/, /\$\{props\s*=>/],
        'inline-conditionals': [/className=\{[^}]*\?[^}]*\}/],
        'tailwind-desktop-first': [/className="[^"]*\b(lg|xl|2xl):[^"]*\bsm:/],
        'js-responsive': [/useMediaQuery|useBreakpoint/],
        'hardcoded': [/style=\{\{[^}]*padding:\s*['"]?\d+px/],
        'framer-motion': [/<motion\./],
      };

      const allelePatterns = patterns[allele.id];
      if (allelePatterns) {
        for (const pattern of allelePatterns) {
          if (pattern.test(code)) {
            issues.push({
              gene: gene.name,
              issue: `Found ${allele.name} pattern`,
              suggestion: `Consider using ${gene.dominant.name} instead`,
            });
            break;
          }
        }
      }
    }
  }

  if (issues.length === 0) {
    return {
      content: [{
        type: 'text',
        text: '# DNA Check: ✓ Passed\n\n' +
          'The code appears to follow the established styling DNA patterns.',
      }],
    };
  }

  let output = `# DNA Check: ⚠️ ${issues.length} Issue(s) Found\n\n`;
  for (const issue of issues) {
    output += `## ${issue.gene}\n`;
    output += `- **Issue:** ${issue.issue}\n`;
    output += `- **Suggestion:** ${issue.suggestion}\n\n`;
  }

  return { content: [{ type: 'text', text: output }] };
}

/**
 * Handle drift_boundaries tool - Data access boundaries
 */
async function handleBoundaries(
  store: BoundaryStore,
  args: {
    action?: string;
    table?: string;
    file?: string;
    includeViolations?: boolean;
  }
) {
  await store.initialize();

  const action = args.action ?? 'overview';
  const includeViolations = args.includeViolations ?? true;

  switch (action) {
    case 'overview': {
      const accessMap = store.getAccessMap();
      const sensitiveFields = store.getSensitiveAccess();

      let output = '# Data Boundaries Overview\n\n';
      output += `- **Tables:** ${accessMap.stats.totalTables}\n`;
      output += `- **Access Points:** ${accessMap.stats.totalAccessPoints}\n`;
      output += `- **Sensitive Fields:** ${accessMap.stats.totalSensitiveFields}\n`;
      output += `- **ORM Models:** ${accessMap.stats.totalModels}\n\n`;

      if (accessMap.stats.totalTables > 0) {
        output += '## Tables\n\n';
        const tableEntries = Object.entries(accessMap.tables)
          .map(([name, info]) => ({
            name,
            accessCount: info.accessedBy.length,
            hasSensitive: info.sensitiveFields.length > 0,
          }))
          .sort((a, b) => b.accessCount - a.accessCount)
          .slice(0, 10);

        for (const table of tableEntries) {
          const sensitive = table.hasSensitive ? ' ⚠️' : '';
          output += `- **${table.name}**${sensitive}: ${table.accessCount} access points\n`;
        }
        output += '\n';
      }

      if (sensitiveFields.length > 0) {
        output += '## Sensitive Fields\n\n';
        const fieldCounts = new Map<string, number>();
        for (const field of sensitiveFields) {
          const key = field.table ? `${field.table}.${field.field}` : field.field;
          fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
        }

        const sortedFields = Array.from(fieldCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

        for (const [fieldName, count] of sortedFields) {
          output += `- **${fieldName}**: ${count} locations\n`;
        }
        output += '\n';
      }

      if (includeViolations) {
        const rules = store.getRules();
        if (rules) {
          const violations = store.checkAllViolations();
          if (violations.length > 0) {
            output += `## ⚠️ Violations (${violations.length})\n\n`;
            for (const v of violations.slice(0, 5)) {
              output += `- **${v.file}:${v.line}** - ${v.message}\n`;
            }
            if (violations.length > 5) {
              output += `- ... and ${violations.length - 5} more\n`;
            }
          } else {
            output += '## ✓ No Violations\n\nAll data access follows configured boundaries.\n';
          }
        } else {
          output += '## No Rules Configured\n\n';
          output += 'Create `.drift/boundaries/rules.json` to enable boundary enforcement.\n';
          output += 'Run `drift boundaries init-rules` to generate a starter config.\n';
        }
      }

      return { content: [{ type: 'text', text: output }] };
    }

    case 'table': {
      if (!args.table) {
        return {
          content: [{ type: 'text', text: 'Error: table parameter required for "table" action' }],
          isError: true,
        };
      }

      const tableInfo = store.getTableAccess(args.table);
      if (!tableInfo) {
        return {
          content: [{ type: 'text', text: `Table '${args.table}' not found in access map.` }],
        };
      }

      let output = `# Table: ${args.table}\n\n`;
      if (tableInfo.model) {
        output += `**Model:** ${tableInfo.model}\n`;
      }
      output += `**Fields:** ${tableInfo.fields.join(', ') || 'none detected'}\n`;
      output += `**Access Points:** ${tableInfo.accessedBy.length}\n\n`;

      if (tableInfo.sensitiveFields.length > 0) {
        output += '## ⚠️ Sensitive Fields\n\n';
        for (const sf of tableInfo.sensitiveFields) {
          output += `- **${sf.field}** (${sf.sensitivityType})\n`;
        }
        output += '\n';
      }

      output += '## Access Points\n\n';
      const byFile = new Map<string, typeof tableInfo.accessedBy>();
      for (const ap of tableInfo.accessedBy) {
        if (!byFile.has(ap.file)) byFile.set(ap.file, []);
        byFile.get(ap.file)!.push(ap);
      }

      for (const [file, accessPoints] of byFile) {
        output += `### ${file}\n`;
        for (const ap of accessPoints) {
          output += `- Line ${ap.line}: **${ap.operation}** ${ap.fields.join(', ')}\n`;
        }
        output += '\n';
      }

      return { content: [{ type: 'text', text: output }] };
    }

    case 'file': {
      if (!args.file) {
        return {
          content: [{ type: 'text', text: 'Error: file parameter required for "file" action' }],
          isError: true,
        };
      }

      const fileAccess = store.getFileAccess(args.file);

      let output = `# Data Access: ${args.file}\n\n`;

      if (fileAccess.length === 0) {
        output += 'No data access detected for this file/pattern.\n';
      } else {
        for (const fileInfo of fileAccess) {
          output += `## ${fileInfo.file}\n\n`;
          output += `**Tables:** ${fileInfo.tables.join(', ')}\n`;
          output += `**Access Points:** ${fileInfo.accessPoints.length}\n\n`;

          for (const ap of fileInfo.accessPoints) {
            output += `- Line ${ap.line}: **${ap.operation}** ${ap.table} ${ap.fields.join(', ')}\n`;
          }
          output += '\n';
        }
      }

      // Include boundary rules context if available
      const rules = store.getRules();
      if (rules && fileAccess.length > 0) {
        const allTables = new Set(fileAccess.flatMap(f => f.tables));
        const applicableRules = rules.boundaries.filter(b =>
          b.tables?.some(t => allTables.has(t)) ||
          b.fields?.some(f => allTables.has(f.split('.')[0] || ''))
        );

        if (applicableRules.length > 0) {
          output += '## Applicable Boundaries\n\n';
          for (const rule of applicableRules) {
            output += `- **${rule.id}**: ${rule.description}\n`;
            output += `  - Allowed: ${rule.allowedPaths.join(', ')}\n`;
          }
        }
      }

      return { content: [{ type: 'text', text: output }] };
    }

    case 'sensitive': {
      const sensitiveFields = store.getSensitiveAccess();

      let output = '# Sensitive Data Access\n\n';

      if (sensitiveFields.length === 0) {
        output += 'No sensitive fields detected.\n';
        return { content: [{ type: 'text', text: output }] };
      }

      // Group by sensitivity type
      const byType = new Map<string, typeof sensitiveFields>();
      for (const field of sensitiveFields) {
        const type = field.sensitivityType;
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(field);
      }

      for (const [type, fields] of byType) {
        output += `## ${type.toUpperCase()} (${fields.length})\n\n`;
        for (const f of fields) {
          const fieldName = f.table ? `${f.table}.${f.field}` : f.field;
          output += `- **${fieldName}**\n`;
          output += `  - ${f.file}:${f.line}\n`;
        }
        output += '\n';
      }

      return { content: [{ type: 'text', text: output }] };
    }

    case 'check': {
      const rules = store.getRules();

      if (!rules) {
        return {
          content: [{
            type: 'text',
            text: '# No Boundary Rules Configured\n\n' +
              'Create `.drift/boundaries/rules.json` to enable boundary enforcement.\n' +
              'Run `drift boundaries init-rules` to generate a starter config.',
          }],
        };
      }

      const violations = store.checkAllViolations();

      if (violations.length === 0) {
        return {
          content: [{
            type: 'text',
            text: '# ✓ No Boundary Violations\n\n' +
              `Checked ${rules.boundaries.length} rules. All data access follows configured boundaries.`,
          }],
        };
      }

      let output = `# ⚠️ Boundary Violations (${violations.length})\n\n`;

      // Group by severity
      const errors = violations.filter(v => v.severity === 'error');
      const warnings = violations.filter(v => v.severity === 'warning');
      const infos = violations.filter(v => v.severity === 'info');

      if (errors.length > 0) {
        output += `## 🔴 Errors (${errors.length})\n\n`;
        for (const v of errors) {
          output += `### ${v.file}:${v.line}\n`;
          output += `- **Rule:** ${v.ruleId}\n`;
          output += `- **Message:** ${v.message}\n`;
          if (v.suggestion) {
            output += `- **Suggestion:** ${v.suggestion}\n`;
          }
          output += '\n';
        }
      }

      if (warnings.length > 0) {
        output += `## 🟡 Warnings (${warnings.length})\n\n`;
        for (const v of warnings) {
          output += `- **${v.file}:${v.line}** - ${v.message}\n`;
        }
        output += '\n';
      }

      if (infos.length > 0) {
        output += `## ℹ️ Info (${infos.length})\n\n`;
        for (const v of infos.slice(0, 5)) {
          output += `- ${v.file}:${v.line} - ${v.message}\n`;
        }
        if (infos.length > 5) {
          output += `- ... and ${infos.length - 5} more\n`;
        }
      }

      return { content: [{ type: 'text', text: output }] };
    }

    case 'rules': {
      const rules = store.getRules();

      if (!rules) {
        return {
          content: [{
            type: 'text',
            text: '# No Boundary Rules Configured\n\n' +
              'Create `.drift/boundaries/rules.json` to define data access boundaries.\n\n' +
              '## Example Rules\n\n' +
              '```json\n' +
              '{\n' +
              '  "version": "1.0",\n' +
              '  "sensitivity": {\n' +
              '    "critical": ["users.password_hash", "users.ssn"],\n' +
              '    "sensitive": ["users.email", "users.phone"],\n' +
              '    "general": []\n' +
              '  },\n' +
              '  "boundaries": [\n' +
              '    {\n' +
              '      "id": "auth-owns-credentials",\n' +
              '      "description": "Only auth module can access credentials",\n' +
              '      "fields": ["users.password_hash"],\n' +
              '      "allowedPaths": ["**/auth/**"],\n' +
              '      "severity": "error"\n' +
              '    }\n' +
              '  ]\n' +
              '}\n' +
              '```',
          }],
        };
      }

      let output = '# Data Boundary Rules\n\n';

      output += '## Sensitivity Tiers\n\n';
      output += `- **Critical:** ${rules.sensitivity.critical.join(', ') || 'none'}\n`;
      output += `- **Sensitive:** ${rules.sensitivity.sensitive.join(', ') || 'none'}\n`;
      output += '\n';

      output += `## Boundaries (${rules.boundaries.length})\n\n`;
      for (const b of rules.boundaries) {
        const enabled = b.enabled !== false ? '✓' : '○';
        output += `### ${enabled} ${b.id}\n`;
        output += `${b.description}\n\n`;
        if (b.tables) output += `- **Tables:** ${b.tables.join(', ')}\n`;
        if (b.fields) output += `- **Fields:** ${b.fields.join(', ')}\n`;
        if (b.operations) output += `- **Operations:** ${b.operations.join(', ')}\n`;
        output += `- **Allowed:** ${b.allowedPaths.join(', ')}\n`;
        output += `- **Severity:** ${b.severity}\n\n`;
      }

      return { content: [{ type: 'text', text: output }] };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown action: ${action}` }],
        isError: true,
      };
  }
}
