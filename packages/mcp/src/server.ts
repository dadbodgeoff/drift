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
  type PatternCategory,
  type Pattern,
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
];

export function createDriftMCPServer(config: DriftMCPConfig): Server {
  const server = new Server(
    { name: 'drift', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const patternStore = new PatternStore({ rootDir: config.projectRoot });
  const manifestStore = new ManifestStore(config.projectRoot);
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
