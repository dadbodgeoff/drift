/**
 * Next Steps Command - drift next-steps
 *
 * Analyzes the current project state and recommends the most relevant
 * next actions based on project type, patterns found, and current status.
 *
 * This is the "what should I do next?" command for new users.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

import { createCLIPatternService } from '../services/pattern-service-factory.js';
import { createSpinner } from '../ui/spinner.js';

export interface NextStepsOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
}

const DRIFT_DIR = '.drift';

interface ProjectAnalysis {
  initialized: boolean;
  scanned: boolean;
  hasPatterns: boolean;
  patternCount: number;
  discoveredCount: number;
  approvedCount: number;
  languages: string[];
  frameworks: string[];
  hasCallGraph: boolean;
  hasTestTopology: boolean;
  hasCoupling: boolean;
  hasErrorHandling: boolean;
  hasBoundaries: boolean;
}

interface NextStep {
  priority: 'high' | 'medium' | 'low';
  command: string;
  description: string;
  reason: string;
}

/**
 * Detect languages in the project
 */
async function detectLanguages(rootDir: string): Promise<string[]> {
  const languages: string[] = [];
  const extensions: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.java': 'java',
    '.cs': 'csharp',
    '.php': 'php',
    '.go': 'go',
    '.rs': 'rust',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.h': 'cpp',
  };

  async function scanDir(dir: string, depth = 0): Promise<void> {
    if (depth > 3) {return;} // Don't go too deep
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || 
            entry.name === 'vendor' || entry.name === 'dist' || entry.name === 'build') {
          continue;
        }
        
        if (entry.isDirectory()) {
          await scanDir(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const lang = extensions[ext];
          if (lang && !languages.includes(lang)) {
            languages.push(lang);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  await scanDir(rootDir);
  return languages;
}

/**
 * Detect frameworks based on config files
 */
async function detectFrameworks(rootDir: string): Promise<string[]> {
  const frameworks: string[] = [];
  
  const frameworkFiles: Record<string, string> = {
    'package.json': 'node',
    'next.config.js': 'nextjs',
    'next.config.mjs': 'nextjs',
    'nuxt.config.js': 'nuxt',
    'angular.json': 'angular',
    'vue.config.js': 'vue',
    'svelte.config.js': 'svelte',
    'requirements.txt': 'python',
    'pyproject.toml': 'python',
    'manage.py': 'django',
    'pom.xml': 'maven',
    'build.gradle': 'gradle',
    'composer.json': 'php',
    'artisan': 'laravel',
    'go.mod': 'go',
    'Cargo.toml': 'rust',
    'CMakeLists.txt': 'cmake',
  };

  for (const [file, framework] of Object.entries(frameworkFiles)) {
    try {
      await fs.access(path.join(rootDir, file));
      if (!frameworks.includes(framework)) {
        frameworks.push(framework);
      }
    } catch {
      // File doesn't exist
    }
  }

  // Check package.json for specific frameworks
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (deps['react']) {frameworks.push('react');}
    if (deps['express']) {frameworks.push('express');}
    if (deps['@nestjs/core']) {frameworks.push('nestjs');}
    if (deps['fastify']) {frameworks.push('fastify');}
    if (deps['koa']) {frameworks.push('koa');}
  } catch {
    // No package.json
  }

  return [...new Set(frameworks)];
}

/**
 * Check if analysis data exists
 */
async function checkAnalysisData(rootDir: string): Promise<{
  hasCallGraph: boolean;
  hasTestTopology: boolean;
  hasCoupling: boolean;
  hasErrorHandling: boolean;
  hasBoundaries: boolean;
}> {
  const driftDir = path.join(rootDir, DRIFT_DIR);
  
  const checks = {
    hasCallGraph: false,
    hasTestTopology: false,
    hasCoupling: false,
    hasErrorHandling: false,
    hasBoundaries: false,
  };

  try {
    await fs.access(path.join(driftDir, 'call-graph'));
    checks.hasCallGraph = true;
  } catch { /* */ }

  try {
    await fs.access(path.join(driftDir, 'test-topology'));
    checks.hasTestTopology = true;
  } catch { /* */ }

  try {
    await fs.access(path.join(driftDir, 'module-coupling'));
    checks.hasCoupling = true;
  } catch { /* */ }

  try {
    await fs.access(path.join(driftDir, 'error-handling'));
    checks.hasErrorHandling = true;
  } catch { /* */ }

  try {
    await fs.access(path.join(driftDir, 'boundaries'));
    checks.hasBoundaries = true;
  } catch { /* */ }

  return checks;
}

/**
 * Analyze the project state
 */
async function analyzeProject(rootDir: string): Promise<ProjectAnalysis> {
  const analysis: ProjectAnalysis = {
    initialized: false,
    scanned: false,
    hasPatterns: false,
    patternCount: 0,
    discoveredCount: 0,
    approvedCount: 0,
    languages: [],
    frameworks: [],
    hasCallGraph: false,
    hasTestTopology: false,
    hasCoupling: false,
    hasErrorHandling: false,
    hasBoundaries: false,
  };

  // Check if initialized
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR));
    analysis.initialized = true;
  } catch {
    return analysis;
  }

  // Check if scanned (has patterns directory with content)
  try {
    const patternsDir = path.join(rootDir, DRIFT_DIR, 'patterns', 'discovered');
    const files = await fs.readdir(patternsDir);
    analysis.scanned = files.length > 0;
  } catch {
    // Check lake patterns as fallback
    try {
      const lakeDir = path.join(rootDir, DRIFT_DIR, 'lake', 'patterns');
      const files = await fs.readdir(lakeDir);
      analysis.scanned = files.length > 0;
    } catch { /* */ }
  }

  // Get pattern counts
  if (analysis.scanned) {
    try {
      const service = createCLIPatternService(rootDir);
      const status = await service.getStatus();
      analysis.hasPatterns = status.totalPatterns > 0;
      analysis.patternCount = status.totalPatterns;
      analysis.discoveredCount = status.byStatus.discovered;
      analysis.approvedCount = status.byStatus.approved;
    } catch {
      // Pattern service not available
    }
  }

  // Detect languages and frameworks
  analysis.languages = await detectLanguages(rootDir);
  analysis.frameworks = await detectFrameworks(rootDir);

  // Check analysis data
  const analysisData = await checkAnalysisData(rootDir);
  Object.assign(analysis, analysisData);

  return analysis;
}

/**
 * Generate next steps based on analysis
 */
function generateNextSteps(analysis: ProjectAnalysis): NextStep[] {
  const steps: NextStep[] = [];

  // Not initialized
  if (!analysis.initialized) {
    steps.push({
      priority: 'high',
      command: 'drift init',
      description: 'Initialize Drift in this project',
      reason: 'Drift is not yet initialized. This creates the .drift/ directory and configuration.',
    });
    return steps;
  }

  // Not scanned
  if (!analysis.scanned) {
    steps.push({
      priority: 'high',
      command: 'drift scan',
      description: 'Scan your codebase for patterns',
      reason: 'No patterns found. Run a scan to discover your codebase conventions.',
    });
    return steps;
  }

  // Has discovered patterns to review
  if (analysis.discoveredCount > 0) {
    steps.push({
      priority: 'high',
      command: 'drift status --detailed',
      description: 'Review discovered patterns',
      reason: `You have ${analysis.discoveredCount} patterns awaiting review. Approve the ones that represent your conventions.`,
    });

    if (analysis.discoveredCount > 5) {
      steps.push({
        priority: 'medium',
        command: 'drift approve --category api',
        description: 'Approve patterns by category',
        reason: 'With many patterns, approving by category is faster than one-by-one.',
      });
    }
  }

  // Language-specific commands
  if (analysis.languages.includes('typescript') || analysis.languages.includes('javascript')) {
    steps.push({
      priority: 'medium',
      command: 'drift ts status',
      description: 'Analyze TypeScript/JavaScript project',
      reason: 'Get TypeScript-specific insights: routes, components, hooks, error handling.',
    });
    
    if (analysis.frameworks.includes('react')) {
      steps.push({
        priority: 'medium',
        command: 'drift ts components',
        description: 'List React components',
        reason: 'See all React components and their patterns.',
      });
    }
    
    if (analysis.frameworks.includes('express') || analysis.frameworks.includes('nestjs') || analysis.frameworks.includes('fastify')) {
      steps.push({
        priority: 'medium',
        command: 'drift ts routes',
        description: 'List API routes',
        reason: 'See all HTTP endpoints in your backend.',
      });
    }
  }

  if (analysis.languages.includes('python')) {
    steps.push({
      priority: 'medium',
      command: 'drift py status',
      description: 'Analyze Python project',
      reason: 'Get Python-specific insights: routes, decorators, async patterns.',
    });
  }

  if (analysis.languages.includes('go')) {
    steps.push({
      priority: 'medium',
      command: 'drift go status',
      description: 'Analyze Go project',
      reason: 'Get Go-specific insights: routes, interfaces, goroutines.',
    });
  }

  if (analysis.languages.includes('rust')) {
    steps.push({
      priority: 'medium',
      command: 'drift rust status',
      description: 'Analyze Rust project',
      reason: 'Get Rust-specific insights: traits, error handling, async patterns.',
    });
  }

  if (analysis.languages.includes('java')) {
    steps.push({
      priority: 'medium',
      command: 'drift java status',
      description: 'Analyze Java project',
      reason: 'Get Java-specific insights: routes, annotations, data access.',
    });
  }

  if (analysis.languages.includes('php')) {
    steps.push({
      priority: 'medium',
      command: 'drift php status',
      description: 'Analyze PHP project',
      reason: 'Get PHP-specific insights: routes, traits, data access.',
    });
  }

  // Build analysis data if not present
  if (!analysis.hasCallGraph) {
    steps.push({
      priority: 'medium',
      command: 'drift callgraph build',
      description: 'Build call graph',
      reason: 'Enables impact analysis and data flow tracking.',
    });
  }

  if (!analysis.hasTestTopology) {
    steps.push({
      priority: 'medium',
      command: 'drift test-topology build',
      description: 'Build test topology',
      reason: 'Maps tests to code for coverage analysis and affected test detection.',
    });
  }

  if (!analysis.hasCoupling) {
    steps.push({
      priority: 'low',
      command: 'drift coupling build',
      description: 'Build coupling analysis',
      reason: 'Detects dependency cycles and highly coupled modules.',
    });
  }

  if (!analysis.hasErrorHandling) {
    steps.push({
      priority: 'low',
      command: 'drift error-handling build',
      description: 'Build error handling map',
      reason: 'Finds error handling gaps and unhandled exceptions.',
    });
  }

  // MCP setup suggestion
  steps.push({
    priority: 'medium',
    command: 'npx driftdetect-mcp',
    description: 'Connect to AI agents via MCP',
    reason: 'Let Claude, Cursor, or other AI agents use your patterns for better code generation.',
  });

  // Dashboard
  steps.push({
    priority: 'low',
    command: 'drift dashboard',
    description: 'Launch web dashboard',
    reason: 'Visual exploration of patterns, violations, and codebase health.',
  });

  return steps;
}

/**
 * Next steps command action
 */
async function nextStepsAction(options: NextStepsOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  const spinner = format === 'text' ? createSpinner('Analyzing project...') : null;
  spinner?.start();

  const analysis = await analyzeProject(rootDir);
  const steps = generateNextSteps(analysis);

  spinner?.stop();

  // JSON output
  if (format === 'json') {
    console.log(JSON.stringify({
      analysis,
      steps,
    }, null, 2));
    return;
  }

  // Text output
  console.log();
  console.log(chalk.bold('🧭 Drift - Next Steps'));
  console.log(chalk.gray('═'.repeat(60)));
  console.log();

  // Project status summary
  console.log(chalk.bold('Project Status'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Initialized:  ${analysis.initialized ? chalk.green('✓') : chalk.red('✗')}`);
  console.log(`  Scanned:      ${analysis.scanned ? chalk.green('✓') : chalk.red('✗')}`);
  console.log(`  Patterns:     ${chalk.cyan(analysis.patternCount)} (${chalk.green(analysis.approvedCount)} approved, ${chalk.yellow(analysis.discoveredCount)} pending)`);
  
  if (analysis.languages.length > 0) {
    console.log(`  Languages:    ${chalk.cyan(analysis.languages.join(', '))}`);
  }
  if (analysis.frameworks.length > 0) {
    console.log(`  Frameworks:   ${chalk.cyan(analysis.frameworks.join(', '))}`);
  }
  console.log();

  // Analysis data status
  console.log(chalk.bold('Analysis Data'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Call Graph:      ${analysis.hasCallGraph ? chalk.green('✓ built') : chalk.gray('○ not built')}`);
  console.log(`  Test Topology:   ${analysis.hasTestTopology ? chalk.green('✓ built') : chalk.gray('○ not built')}`);
  console.log(`  Coupling:        ${analysis.hasCoupling ? chalk.green('✓ built') : chalk.gray('○ not built')}`);
  console.log(`  Error Handling:  ${analysis.hasErrorHandling ? chalk.green('✓ built') : chalk.gray('○ not built')}`);
  console.log();

  // Recommended next steps
  console.log(chalk.bold('Recommended Next Steps'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log();

  const highPriority = steps.filter(s => s.priority === 'high');
  const mediumPriority = steps.filter(s => s.priority === 'medium');
  const lowPriority = steps.filter(s => s.priority === 'low');

  if (highPriority.length > 0) {
    console.log(chalk.red.bold('  🔴 High Priority'));
    for (const step of highPriority) {
      console.log();
      console.log(`     ${chalk.cyan(step.command)}`);
      console.log(`     ${step.description}`);
      console.log(chalk.gray(`     → ${step.reason}`));
    }
    console.log();
  }

  if (mediumPriority.length > 0) {
    console.log(chalk.yellow.bold('  🟡 Recommended'));
    for (const step of mediumPriority.slice(0, 5)) {
      console.log();
      console.log(`     ${chalk.cyan(step.command)}`);
      console.log(`     ${step.description}`);
      if (options.verbose) {
        console.log(chalk.gray(`     → ${step.reason}`));
      }
    }
    if (mediumPriority.length > 5) {
      console.log(chalk.gray(`\n     ... and ${mediumPriority.length - 5} more`));
    }
    console.log();
  }

  if (lowPriority.length > 0 && options.verbose) {
    console.log(chalk.blue.bold('  🔵 Optional'));
    for (const step of lowPriority.slice(0, 3)) {
      console.log();
      console.log(`     ${chalk.cyan(step.command)}`);
      console.log(`     ${step.description}`);
    }
    console.log();
  }

  // Quick tip
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray('Tip: Run with --verbose to see all recommendations and reasons.'));
  console.log();
}

export const nextStepsCommand = new Command('next-steps')
  .description('Get personalized recommendations for what to do next')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('-v, --verbose', 'Show all recommendations with detailed reasons')
  .action(nextStepsAction);
