/**
 * Intelligent Tool Filtering
 * 
 * Automatically detects project languages and filters MCP tools to only
 * expose relevant ones. This reduces AI context overhead and improves
 * tool selection accuracy.
 * 
 * Design principles (Anthropic/OpenAI style):
 * 1. Zero config - works out of the box with smart defaults
 * 2. Intelligent detection - scans project for language markers
 * 3. Escape hatches - config override for edge cases
 * 4. Core tools always available - status, context, patterns, etc.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { shouldIgnoreDirectory } from 'driftdetect-core';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Supported languages with their detection markers
 */
export type Language = 
  | 'typescript' 
  | 'javascript' 
  | 'python' 
  | 'java' 
  | 'php' 
  | 'go' 
  | 'rust' 
  | 'cpp' 
  | 'csharp'
  | 'wpf'
  | 'iec61131';

/**
 * Language detection markers
 */
const LANGUAGE_MARKERS: Record<Language, {
  files: string[];
  extensions: string[];
  configFiles: string[];
}> = {
  typescript: {
    files: [],
    extensions: ['.ts', '.tsx'],
    configFiles: ['tsconfig.json', 'tsconfig.base.json'],
  },
  javascript: {
    files: [],
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    configFiles: ['package.json', 'jsconfig.json'],
  },
  python: {
    files: [],
    extensions: ['.py', '.pyw', '.pyi'],
    configFiles: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
  },
  java: {
    files: [],
    extensions: ['.java'],
    configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  },
  php: {
    files: [],
    extensions: ['.php'],
    configFiles: ['composer.json', 'artisan'],
  },
  go: {
    files: [],
    extensions: ['.go'],
    configFiles: ['go.mod', 'go.sum'],
  },
  rust: {
    files: [],
    extensions: ['.rs'],
    configFiles: ['Cargo.toml', 'Cargo.lock'],
  },
  cpp: {
    files: [],
    extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hxx'],
    configFiles: ['CMakeLists.txt', 'Makefile', 'vcxproj'],
  },
  csharp: {
    files: [],
    extensions: ['.cs'],
    configFiles: ['*.csproj', '*.sln'],
  },
  wpf: {
    files: [],
    extensions: ['.xaml'],
    configFiles: [],
  },
  iec61131: {
    files: [],
    extensions: ['.st', '.stx', '.scl', '.pou', '.exp'],
    configFiles: [],
  },
};

/**
 * Tool to language mapping
 */
const LANGUAGE_TOOLS: Record<Language, string[]> = {
  typescript: ['drift_typescript'],
  javascript: ['drift_typescript'], // Same tool handles both
  python: ['drift_python'],
  java: ['drift_java'],
  php: ['drift_php'],
  go: ['drift_go'],
  rust: ['drift_rust'],
  cpp: ['drift_cpp'],
  csharp: [], // No specific tool yet
  wpf: ['drift_wpf'],
  iec61131: ['drift_iec61131'],
};

/**
 * Core tools that are always available regardless of language
 */
const CORE_TOOLS = [
  // Setup (must be available before project is initialized)
  'drift_setup',
  'drift_telemetry',
  
  // Curation (pattern approval with verification)
  'drift_curate',
  
  // Orchestration
  'drift_context',
  'drift_package_context',
  
  // Discovery
  'drift_status',
  'drift_capabilities',
  'drift_projects',
  
  // Surgical (language-agnostic)
  'drift_signature',
  'drift_callers',
  'drift_imports',
  'drift_prevalidate',
  'drift_similar',
  'drift_type',
  'drift_recent',
  'drift_test_template',
  'drift_dependencies',
  'drift_middleware',
  'drift_hooks',
  'drift_errors',
  
  // Exploration
  'drift_patterns_list',
  'drift_security_summary',
  'drift_contracts_list',
  'drift_trends',
  'drift_env',
  
  // Detail
  'drift_pattern_get',
  'drift_code_examples',
  'drift_files_list',
  'drift_file_patterns',
  'drift_impact_analysis',
  'drift_reachability',
  'drift_dna_profile',
  'drift_wrappers',
  
  // Analysis (language-agnostic)
  'drift_quality_gate',
  'drift_simulate',
  'drift_test_topology',
  'drift_coupling',
  'drift_error_handling',
  'drift_decisions',
  'drift_constraints',
  'drift_constants',
  'drift_audit',
  
  // Industrial Automation (IEC 61131-3)
  'drift_iec61131',
  
  // Generation
  'drift_suggest_changes',
  'drift_validate_change',
  'drift_explain',
];

/**
 * Detect languages used in a project
 */
export function detectProjectLanguages(projectRoot: string): Language[] {
  const detected = new Set<Language>();
  
  // Check for config files first (most reliable)
  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS) as [Language, typeof LANGUAGE_MARKERS[Language]][]) {
    for (const configFile of markers.configFiles) {
      if (configFile.includes('*')) {
        // Glob pattern - check if any matching file exists
        const pattern = configFile.replace('*', '');
        try {
          const files = fs.readdirSync(projectRoot);
          if (files.some(f => f.endsWith(pattern))) {
            detected.add(lang);
          }
        } catch {
          // Directory not readable
        }
      } else {
        const configPath = path.join(projectRoot, configFile);
        if (fs.existsSync(configPath)) {
          detected.add(lang);
        }
      }
    }
  }
  
  // If no config files found, scan for source files (limited depth)
  if (detected.size === 0) {
    const extensions = scanForExtensions(projectRoot, 2);
    for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS) as [Language, typeof LANGUAGE_MARKERS[Language]][]) {
      if (markers.extensions.some(ext => extensions.has(ext))) {
        detected.add(lang);
      }
    }
  }
  
  // Special case: WPF detection (C# + XAML)
  if (detected.has('csharp') && detected.has('wpf')) {
    // Keep both
  } else if (detected.has('wpf') && !detected.has('csharp')) {
    // XAML without C# is unusual, but keep it
  }
  
  // JavaScript is implied by TypeScript
  if (detected.has('typescript')) {
    detected.delete('javascript'); // TypeScript tool handles both
  }
  
  return Array.from(detected);
}

/**
 * Scan directory for file extensions (limited depth)
 */
function scanForExtensions(dir: string, maxDepth: number, currentDepth = 0): Set<string> {
  const extensions = new Set<string>();
  
  if (currentDepth >= maxDepth) {return extensions;}
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip directories using enterprise-grade ignore list
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name)) {
          continue;
        }
        const subExtensions = scanForExtensions(
          path.join(dir, entry.name),
          maxDepth,
          currentDepth + 1
        );
        subExtensions.forEach(ext => extensions.add(ext));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext) {extensions.add(ext);}
      }
    }
  } catch {
    // Directory not readable
  }
  
  return extensions;
}

/**
 * Filter tools based on detected languages
 */
export function filterToolsForProject(
  allTools: Tool[],
  projectRoot: string,
  options?: {
    /** Override detected languages */
    languages?: Language[];
    /** Additional tools to include */
    include?: string[];
    /** Tools to exclude */
    exclude?: string[];
    /** Disable filtering (expose all tools) */
    disableFiltering?: boolean;
  }
): Tool[] {
  // If filtering disabled, return all tools
  if (options?.disableFiltering) {
    return allTools;
  }
  
  // Detect or use provided languages
  const languages = options?.languages ?? detectProjectLanguages(projectRoot);
  
  // Build set of allowed tool names
  const allowedTools = new Set<string>(CORE_TOOLS);
  
  // Add language-specific tools
  for (const lang of languages) {
    const langTools = LANGUAGE_TOOLS[lang] ?? [];
    langTools.forEach(tool => allowedTools.add(tool));
  }
  
  // Add explicitly included tools
  if (options?.include) {
    options.include.forEach(tool => allowedTools.add(tool));
  }
  
  // Remove explicitly excluded tools
  if (options?.exclude) {
    options.exclude.forEach(tool => allowedTools.delete(tool));
  }
  
  // Filter tools
  return allTools.filter(tool => allowedTools.has(tool.name));
}

/**
 * Get tool filter configuration from .drift/config.json
 */
export function getToolFilterConfig(projectRoot: string): {
  languages?: Language[];
  include?: string[];
  exclude?: string[];
  disableFiltering?: boolean;
} {
  const configPath = path.join(projectRoot, '.drift', 'config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      if (config.mcp?.tools) {
        return {
          languages: config.mcp.tools.languages,
          include: config.mcp.tools.include,
          exclude: config.mcp.tools.exclude,
          disableFiltering: config.mcp.tools.all === true,
        };
      }
    }
  } catch {
    // Config not readable or invalid
  }
  
  return {};
}

/**
 * Get filtered tools for a project (main entry point)
 */
export function getFilteredTools(allTools: Tool[], projectRoot: string): {
  tools: Tool[];
  detectedLanguages: Language[];
  filteredCount: number;
  totalCount: number;
} {
  const config = getToolFilterConfig(projectRoot);
  const detectedLanguages = config.languages ?? detectProjectLanguages(projectRoot);
  
  const filteredTools = filterToolsForProject(allTools, projectRoot, {
    ...config,
    languages: detectedLanguages,
  });
  
  return {
    tools: filteredTools,
    detectedLanguages,
    filteredCount: filteredTools.length,
    totalCount: allTools.length,
  };
}
