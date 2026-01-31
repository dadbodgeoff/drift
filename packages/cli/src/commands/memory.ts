/**
 * Memory Command - drift memory
 *
 * Enterprise-grade CLI for managing Cortex V2 memories.
 * Provides full CRUD operations, search, learning, health monitoring,
 * validation, consolidation, and integration with the drift ecosystem.
 * 
 * Memory Types:
 * - core: Project identity and preferences (never decays)
 * - tribal: Institutional knowledge, gotchas, warnings (365 day half-life)
 * - procedural: How-to knowledge, step-by-step procedures (180 day half-life)
 * - semantic: Consolidated knowledge from episodic memories (90 day half-life)
 * - episodic: Interaction records, raw material for consolidation (7 day half-life)
 * - pattern_rationale: Why patterns exist in the codebase (180 day half-life)
 * - constraint_override: Approved exceptions to constraints (90 day half-life)
 * - decision_context: Human context for architectural decisions (180 day half-life)
 * - code_smell: Patterns to avoid, anti-patterns (90 day half-life)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

import { createSpinner } from '../ui/spinner.js';

const DRIFT_DIR = '.drift';
const MEMORY_DIR = 'memory';
const MEMORY_DB = 'cortex.db';

// ============================================================================
// Types
// ============================================================================

export interface MemoryOptions {
  format?: 'text' | 'json';
  verbose?: boolean;
}

interface MemoryType {
  name: string;
  icon: string;
  description: string;
  halfLife: string;
}

const MEMORY_TYPES: Record<string, MemoryType> = {
  core: { name: 'core', icon: '🏠', description: 'Project identity and preferences', halfLife: '∞' },
  tribal: { name: 'tribal', icon: '⚠️', description: 'Institutional knowledge, gotchas', halfLife: '365d' },
  procedural: { name: 'procedural', icon: '📋', description: 'How-to knowledge, procedures', halfLife: '180d' },
  semantic: { name: 'semantic', icon: '💡', description: 'Consolidated knowledge', halfLife: '90d' },
  episodic: { name: 'episodic', icon: '💭', description: 'Interaction records', halfLife: '7d' },
  pattern_rationale: { name: 'pattern_rationale', icon: '🎯', description: 'Why patterns exist', halfLife: '180d' },
  constraint_override: { name: 'constraint_override', icon: '✅', description: 'Approved exceptions', halfLife: '90d' },
  decision_context: { name: 'decision_context', icon: '📝', description: 'Decision context', halfLife: '180d' },
  code_smell: { name: 'code_smell', icon: '🚫', description: 'Patterns to avoid', halfLife: '90d' },
};

// ============================================================================
// Cortex Integration
// ============================================================================

/**
 * Get Cortex instance (lazy loaded)
 */
async function getCortex(rootDir: string): Promise<any> {
  try {
    const { getCortex: getGlobalCortex } = await import('driftdetect-cortex');
    
    // Ensure memory directory exists
    const memoryDir = path.join(rootDir, DRIFT_DIR, MEMORY_DIR);
    await fs.mkdir(memoryDir, { recursive: true });
    
    // Configure cortex with the project's database
    const dbPath = path.join(memoryDir, MEMORY_DB);
    return await getGlobalCortex({
      storage: { type: 'sqlite', sqlitePath: dbPath },
      autoInitialize: true,
    });
  } catch (error) {
    throw new Error(`Failed to initialize Cortex: ${error}`);
  }
}

/**
 * Check if memory system is initialized
 */
async function memoryExists(rootDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootDir, DRIFT_DIR, MEMORY_DIR, MEMORY_DB));
    return true;
  } catch {
    return false;
  }
}

/**
 * Show helpful message when no memories exist
 */
function showNoMemoriesMessage(): void {
  console.log();
  console.log(chalk.yellow('⚠️  Memory system not initialized.'));
  console.log();
  console.log(chalk.gray('Initialize the memory system:'));
  console.log();
  console.log(chalk.cyan('  drift memory init'));
  console.log();
  console.log(chalk.gray('Or add your first memory:'));
  console.log();
  console.log(chalk.cyan('  drift memory add tribal "Always use bcrypt for password hashing"'));
  console.log();
}

// ============================================================================
// Formatters
// ============================================================================

function getTypeIcon(type: string): string {
  return MEMORY_TYPES[type]?.icon ?? '📦';
}

function getConfidenceColor(confidence: number): string {
  const percent = Math.round(confidence * 100);
  if (confidence >= 0.8) return chalk.green(`${percent}%`);
  if (confidence >= 0.5) return chalk.yellow(`${percent}%`);
  return chalk.red(`${percent}%`);
}

function getHealthColor(score: number): string {
  if (score >= 80) return chalk.green(`${score}/100 (healthy)`);
  if (score >= 50) return chalk.yellow(`${score}/100 (warning)`);
  return chalk.red(`${score}/100 (critical)`);
}

function getImportanceColor(importance: string): string {
  switch (importance) {
    case 'critical': return chalk.red(importance);
    case 'high': return chalk.yellow(importance);
    case 'normal': return chalk.white(importance);
    case 'low': return chalk.gray(importance);
    default: return importance;
  }
}

function formatMemoryBrief(memory: any): void {
  const icon = getTypeIcon(memory.type);
  const confidence = getConfidenceColor(memory.confidence ?? 1);
  const id = memory.id ?? 'unknown';
  
  console.log(`  ${icon} ${chalk.cyan(id.slice(0, 8))}... ${confidence}`);
  console.log(`    ${chalk.white(memory.summary ?? 'No summary')}`);
  if (memory.tags?.length > 0) {
    console.log(chalk.gray(`    Tags: ${memory.tags.join(', ')}`));
  }
}

function formatMemoryDetailed(memory: any, related: any[] = []): void {
  const icon = getTypeIcon(memory.type);
  
  console.log();
  console.log(chalk.bold(`${icon} ${memory.type.toUpperCase()}`));
  console.log(chalk.gray('═'.repeat(60)));
  console.log();

  // Basic info
  console.log(chalk.bold('Details'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  ID:          ${chalk.cyan(memory.id)}`);
  console.log(`  Type:        ${memory.type}`);
  console.log(`  Confidence:  ${getConfidenceColor(memory.confidence)}`);
  console.log(`  Importance:  ${getImportanceColor(memory.importance)}`);
  console.log(`  Created:     ${new Date(memory.createdAt).toLocaleString()}`);
  console.log(`  Updated:     ${new Date(memory.updatedAt).toLocaleString()}`);
  console.log(`  Accessed:    ${memory.accessCount} times`);
  console.log();

  // Summary
  console.log(chalk.bold('Summary'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`  ${memory.summary}`);
  console.log();

  // Type-specific content
  switch (memory.type) {
    case 'tribal':
      console.log(chalk.bold('Knowledge'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Topic:    ${memory.topic}`);
      console.log(`  Severity: ${memory.severity}`);
      console.log(`  ${memory.knowledge}`);
      if (memory.warnings?.length > 0) {
        console.log();
        console.log(chalk.bold('Warnings'));
        for (const w of memory.warnings) {
          console.log(`  ⚠️  ${w}`);
        }
      }
      break;

    case 'procedural':
      console.log(chalk.bold('Procedure'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Name: ${memory.name}`);
      if (memory.steps?.length > 0) {
        console.log();
        console.log(chalk.bold('Steps'));
        for (const step of memory.steps) {
          console.log(`  ${step.order}. ${step.action}`);
          if (step.details) console.log(chalk.gray(`     ${step.details}`));
        }
      }
      break;

    case 'pattern_rationale':
      console.log(chalk.bold('Pattern'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Pattern:  ${memory.patternName}`);
      console.log(`  Category: ${memory.patternCategory}`);
      console.log();
      console.log(chalk.bold('Rationale'));
      console.log(`  ${memory.rationale}`);
      if (memory.businessContext) {
        console.log();
        console.log(chalk.bold('Business Context'));
        console.log(`  ${memory.businessContext}`);
      }
      break;

    case 'code_smell':
      console.log(chalk.bold('Code Smell'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Name:     ${memory.name}`);
      console.log(`  Severity: ${memory.severity}`);
      console.log(`  Reason:   ${memory.reason}`);
      if (memory.suggestion) {
        console.log();
        console.log(chalk.bold('Suggestion'));
        console.log(`  ${memory.suggestion}`);
      }
      break;

    case 'decision_context':
      console.log(chalk.bold('Decision'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  Summary:     ${memory.decisionSummary}`);
      console.log(`  Still Valid: ${memory.stillValid ? chalk.green('Yes') : chalk.red('No')}`);
      if (memory.businessContext) {
        console.log();
        console.log(chalk.bold('Business Context'));
        console.log(`  ${memory.businessContext}`);
      }
      break;
  }

  // Links
  if (memory.linkedFiles?.length > 0 || memory.linkedPatterns?.length > 0) {
    console.log();
    console.log(chalk.bold('Links'));
    console.log(chalk.gray('─'.repeat(50)));
    if (memory.linkedFiles?.length > 0) {
      console.log(`  Files:    ${memory.linkedFiles.join(', ')}`);
    }
    if (memory.linkedPatterns?.length > 0) {
      console.log(`  Patterns: ${memory.linkedPatterns.join(', ')}`);
    }
  }

  // Tags
  if (memory.tags?.length > 0) {
    console.log();
    console.log(chalk.bold('Tags'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  ${memory.tags.join(', ')}`);
  }

  // Related memories
  if (related.length > 0) {
    console.log();
    console.log(chalk.bold('Related Memories'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const r of related.slice(0, 5)) {
      console.log(`  ${getTypeIcon(r.type)} ${chalk.cyan(r.id.slice(0, 8))}... ${r.summary}`);
    }
    if (related.length > 5) {
      console.log(chalk.gray(`  ... and ${related.length - 5} more`));
    }
  }

  console.log();
}

// ============================================================================
// Subcommand Actions
// ============================================================================

/**
 * Init subcommand - initialize memory system
 */
async function initAction(options: MemoryOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const isTextFormat = format === 'text';

  if (isTextFormat) {
    console.log();
    console.log(chalk.bold('🧠 Initializing Memory System'));
    console.log(chalk.gray('═'.repeat(50)));
  }

  const spinner = isTextFormat ? createSpinner('Creating memory database...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);
    await cortex.storage.close();

    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ 
        success: true, 
        path: path.join(DRIFT_DIR, MEMORY_DIR, MEMORY_DB) 
      }));
      return;
    }

    console.log();
    console.log(chalk.green.bold('✓ Memory system initialized'));
    console.log();
    console.log(chalk.gray(`Database: ${path.join(DRIFT_DIR, MEMORY_DIR, MEMORY_DB)}`));
    console.log();
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold('📌 Next Steps:'));
    console.log(chalk.gray(`  • drift memory add tribal "..."   ${chalk.white('Add tribal knowledge')}`));
    console.log(chalk.gray(`  • drift memory status             ${chalk.white('View memory statistics')}`));
    console.log(chalk.gray(`  • drift memory import <file>      ${chalk.white('Import memories from file')}`));
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`\n❌ Error: ${error}`));
    }
  }
}

/**
 * Status subcommand - show memory system status
 */
async function statusAction(options: MemoryOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Loading memory statistics...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);
    
    // Get statistics
    const countByType = await cortex.storage.countByType();
    const total = Object.values(countByType).reduce((sum: number, count) => sum + (count as number), 0);
    
    // Get sample of memories for analysis
    const memories = await cortex.storage.search({ limit: 500 });
    
    let confidenceSum = 0;
    let lowConfidenceCount = 0;
    let recentlyAccessed = 0;
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const memory of memories) {
      confidenceSum += memory.confidence ?? 1;
      if ((memory.confidence ?? 1) < 0.5) lowConfidenceCount++;
      if (memory.lastAccessed && new Date(memory.lastAccessed) > oneWeekAgo) {
        recentlyAccessed++;
      }
    }

    const avgConfidence = memories.length > 0 ? confidenceSum / memories.length : 0;

    // Get pending consolidation count
    const pendingConsolidation = await cortex.storage.count({
      types: ['episodic'],
      consolidationStatus: 'pending',
    });

    // Calculate health score
    let healthScore = 100;
    if (avgConfidence < 0.5) healthScore -= 20;
    if (lowConfidenceCount > total * 0.3) healthScore -= 15;
    if (pendingConsolidation > 50) healthScore -= 10;
    if (total > 1000) healthScore -= 5;
    healthScore = Math.max(0, healthScore);

    await cortex.storage.close();
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        total,
        byType: countByType,
        avgConfidence,
        lowConfidenceCount,
        recentlyAccessed,
        pendingConsolidation,
        healthScore,
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🧠 Memory System Status'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    // Overview
    console.log(chalk.bold('📊 Overview'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Total Memories:      ${chalk.cyan.bold(total)}`);
    console.log(`  Avg Confidence:      ${getConfidenceColor(avgConfidence)}`);
    console.log(`  Low Confidence:      ${lowConfidenceCount > 0 ? chalk.yellow(lowConfidenceCount) : chalk.green('0')}`);
    console.log(`  Recently Accessed:   ${chalk.cyan(recentlyAccessed)} (last 7 days)`);
    console.log(`  Pending Consolidation: ${pendingConsolidation > 0 ? chalk.yellow(pendingConsolidation) : chalk.green('0')}`);
    console.log();

    // By Type
    console.log(chalk.bold('📋 By Type'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const [type, count] of Object.entries(countByType)) {
      if ((count as number) > 0) {
        const typeInfo = MEMORY_TYPES[type];
        console.log(`  ${typeInfo?.icon ?? '📦'} ${type.padEnd(20)} ${chalk.cyan(count)} ${chalk.gray(`(${typeInfo?.halfLife ?? '?'} half-life)`)}`);
      }
    }
    console.log();

    // Health
    console.log(chalk.bold('💚 Health'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Score: ${getHealthColor(healthScore)}`);
    
    if (lowConfidenceCount > total * 0.3) {
      console.log(chalk.yellow(`  ⚠️  ${lowConfidenceCount} memories have low confidence`));
    }
    if (pendingConsolidation > 50) {
      console.log(chalk.yellow(`  ⚠️  ${pendingConsolidation} episodic memories pending consolidation`));
    }
    if (total > 1000) {
      console.log(chalk.yellow(`  ⚠️  Large memory count - consider running consolidation`));
    }
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}


/**
 * Add subcommand - add a new memory
 */
async function addAction(
  type: string,
  content: string,
  options: MemoryOptions & {
    topic?: string;
    severity?: string;
    importance?: string;
    tags?: string;
    file?: string;
    pattern?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  // Validate type
  if (!MEMORY_TYPES[type]) {
    const validTypes = Object.keys(MEMORY_TYPES).join(', ');
    if (format === 'json') {
      console.log(JSON.stringify({ error: `Invalid type. Valid types: ${validTypes}` }));
    } else {
      console.log(chalk.red(`Invalid memory type: ${type}`));
      console.log(chalk.gray(`Valid types: ${validTypes}`));
    }
    return;
  }

  // Validate content
  if (!content || content.trim().length === 0) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Content cannot be empty' }));
    } else {
      console.log(chalk.red('Content cannot be empty'));
    }
    return;
  }

  try {
    const cortex = await getCortex(rootDir);

    // Parse tags
    const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : undefined;
    const importance = (options.importance ?? 'normal') as 'low' | 'normal' | 'high' | 'critical';

    // Build memory object based on type
    const memory: any = {
      type,
      confidence: 1.0,
      importance,
      tags,
      summary: content.length > 100 ? content.slice(0, 97) + '...' : content,
    };

    // Type-specific fields
    switch (type) {
      case 'tribal':
        memory.topic = options.topic ?? extractTopic(content);
        memory.knowledge = content;
        memory.severity = options.severity ?? 'warning';
        memory.source = { type: 'manual' };
        break;

      case 'procedural':
        memory.name = options.topic ?? extractTopic(content);
        memory.description = content;
        memory.triggers = [options.topic ?? extractTopic(content)];
        memory.steps = [{ order: 1, action: content }];
        memory.usageCount = 0;
        break;

      case 'semantic':
        memory.topic = options.topic ?? extractTopic(content);
        memory.knowledge = content;
        memory.supportingEvidence = 1;
        memory.contradictingEvidence = 0;
        break;

      case 'pattern_rationale':
        memory.patternId = options.pattern ?? 'manual';
        memory.patternName = options.topic ?? extractTopic(content);
        memory.patternCategory = 'manual';
        memory.rationale = content;
        break;

      case 'code_smell':
        memory.name = options.topic ?? extractTopic(content);
        memory.description = content;
        memory.reason = content;
        memory.suggestion = 'Review and fix';
        memory.severity = options.severity ?? 'warning';
        memory.autoDetect = false;
        break;

      case 'decision_context':
        memory.decisionId = 'manual';
        memory.decisionSummary = options.topic ?? extractTopic(content);
        memory.businessContext = content;
        memory.stillValid = true;
        break;

      case 'constraint_override':
        memory.constraintId = options.pattern ?? 'manual';
        memory.constraintName = options.topic ?? extractTopic(content);
        memory.scope = { type: 'global', target: '*' };
        memory.reason = content;
        memory.permanent = false;
        memory.usageCount = 0;
        break;

      default:
        memory.content = content;
    }

    const id = await cortex.add(memory);

    // Link to file if specified
    if (options.file) {
      await cortex.storage.linkToFile(id, options.file);
    }

    // Link to pattern if specified
    if (options.pattern) {
      await cortex.storage.linkToPattern(id, options.pattern);
    }

    await cortex.storage.close();

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, id, type }));
      return;
    }

    console.log();
    console.log(chalk.green.bold('✓ Memory added'));
    console.log();
    console.log(`  ${getTypeIcon(type)} ${chalk.bold('ID:')} ${chalk.cyan(id)}`);
    console.log(`  ${chalk.bold('Type:')} ${type}`);
    console.log(`  ${chalk.bold('Importance:')} ${importance}`);
    if (tags) {
      console.log(`  ${chalk.bold('Tags:')} ${tags.join(', ')}`);
    }
    if (options.file) {
      console.log(`  ${chalk.bold('Linked to:')} ${options.file}`);
    }
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * List subcommand - list memories
 */
async function listAction(options: MemoryOptions & {
  type?: string;
  importance?: string;
  limit?: string;
  minConfidence?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = parseInt(options.limit ?? '20', 10);

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  try {
    const cortex = await getCortex(rootDir);

    const query: any = { limit };
    
    if (options.type) {
      query.types = [options.type];
    }
    if (options.minConfidence) {
      query.minConfidence = parseFloat(options.minConfidence);
    }
    if (options.importance) {
      query.importance = [options.importance];
    }

    const memories = await cortex.storage.search(query);
    await cortex.storage.close();

    if (format === 'json') {
      console.log(JSON.stringify({ memories, total: memories.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🧠 Memories'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (memories.length === 0) {
      console.log(chalk.yellow('No memories match the filters.'));
      console.log();
      return;
    }

    // Group by type
    const byType = new Map<string, any[]>();
    for (const m of memories) {
      const list = byType.get(m.type) ?? [];
      list.push(m);
      byType.set(m.type, list);
    }

    for (const [type, mems] of byType) {
      const typeInfo = MEMORY_TYPES[type];
      console.log(chalk.bold(`${typeInfo?.icon ?? '📦'} ${type.toUpperCase()}`));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const m of mems.slice(0, 10)) {
        formatMemoryBrief(m);
      }
      if (mems.length > 10) {
        console.log(chalk.gray(`  ... and ${mems.length - 10} more`));
      }
      console.log();
    }

    console.log(chalk.gray(`Showing ${memories.length} memories`));
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Show subcommand - show memory details
 */
async function showAction(id: string, options: MemoryOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);
    const memory = await cortex.get(id);
    
    if (!memory) {
      await cortex.storage.close();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Memory not found' }));
      } else {
        console.log(chalk.red(`Memory not found: ${id}`));
      }
      return;
    }

    // Get related memories
    const related = await cortex.storage.getRelated(id);
    
    // Get decay factors
    const decay = cortex.calculateDecay(memory);
    
    await cortex.storage.close();

    if (format === 'json') {
      console.log(JSON.stringify({ memory, related, decay }, null, 2));
      return;
    }

    formatMemoryDetailed(memory, related);

    // Show decay info
    console.log(chalk.bold('📉 Decay'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Current Confidence: ${getConfidenceColor(memory.confidence)}`);
    const effectiveConf = isNaN(decay.finalConfidence) ? memory.confidence : decay.finalConfidence;
    const ageFactor = isNaN(decay.temporalDecay) ? 1 : decay.temporalDecay;
    const usageFactor = isNaN(decay.usageBoost) ? 1 : decay.usageBoost;
    console.log(`  Effective Confidence: ${getConfidenceColor(effectiveConf)}`);
    console.log(`  Age Factor: ${(ageFactor * 100).toFixed(1)}%`);
    console.log(`  Usage Factor: ${(usageFactor * 100).toFixed(1)}%`);
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Search subcommand - search memories
 */
async function searchAction(query: string, options: MemoryOptions & {
  type?: string;
  limit?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const limit = parseInt(options.limit ?? '20', 10);

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Searching...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);

    // Try semantic search first, fall back to text search
    let results: any[] = [];
    
    try {
      const embedding = await cortex.embeddings.embed(query);
      results = await cortex.storage.similaritySearch(embedding, limit);
    } catch {
      // Similarity search failed
    }
    
    // If semantic search returned no results, fall back to text-based search
    if (results.length === 0) {
      const allMemories = await cortex.storage.search({ limit: 1000 });
      const queryLower = query.toLowerCase();
      
      results = allMemories.filter((m: any) => {
        const searchText = `${m.summary} ${m.type} ${m.knowledge ?? ''} ${m.topic ?? ''}`.toLowerCase();
        return searchText.includes(queryLower);
      }).slice(0, limit);
    }

    // Filter by type if specified
    if (options.type) {
      results = results.filter(m => m.type === options.type);
    }

    await cortex.storage.close();
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ query, results, total: results.length }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(`🔍 Search Results for "${query}"`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log();

    if (results.length === 0) {
      console.log(chalk.yellow('No memories found matching your query.'));
      console.log();
      return;
    }

    for (const m of results) {
      formatMemoryBrief(m);
    }

    console.log();
    console.log(chalk.gray(`Found ${results.length} memories`));
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Extract topic from content
 */
function extractTopic(content: string): string {
  // Extract first few words as topic
  const words = content.split(/\s+/).slice(0, 3);
  return words.join(' ');
}


/**
 * Update subcommand - update a memory
 */
async function updateAction(
  id: string,
  options: MemoryOptions & {
    confidence?: string;
    importance?: string;
    tags?: string;
    summary?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);
    
    // Verify memory exists
    const existing = await cortex.get(id);
    if (!existing) {
      await cortex.storage.close();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Memory not found' }));
      } else {
        console.log(chalk.red(`Memory not found: ${id}`));
      }
      return;
    }

    // Build updates
    const updates: any = {};
    if (options.confidence) {
      updates.confidence = parseFloat(options.confidence);
    }
    if (options.importance) {
      updates.importance = options.importance;
    }
    if (options.tags) {
      updates.tags = options.tags.split(',').map(t => t.trim());
    }
    if (options.summary) {
      updates.summary = options.summary;
    }

    await cortex.update(id, updates);
    await cortex.storage.close();

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, id, updates }));
      return;
    }

    console.log();
    console.log(chalk.green.bold('✓ Memory updated'));
    console.log();
    console.log(`  ID: ${chalk.cyan(id)}`);
    for (const [key, value] of Object.entries(updates)) {
      console.log(`  ${key}: ${value}`);
    }
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Delete subcommand - delete a memory
 */
async function deleteAction(id: string, options: MemoryOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);
    
    // Verify memory exists
    const existing = await cortex.get(id);
    if (!existing) {
      await cortex.storage.close();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Memory not found' }));
      } else {
        console.log(chalk.red(`Memory not found: ${id}`));
      }
      return;
    }

    await cortex.delete(id);
    await cortex.storage.close();

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, id }));
      return;
    }

    console.log();
    console.log(chalk.green.bold('✓ Memory deleted'));
    console.log(`  ID: ${chalk.cyan(id)}`);
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Learn subcommand - learn from a correction
 */
async function learnAction(options: MemoryOptions & {
  original: string;
  feedback: string;
  code?: string;
  file?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!options.original || !options.feedback) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Both --original and --feedback are required' }));
    } else {
      console.log(chalk.red('Error: Both --original and --feedback are required'));
      console.log();
      console.log(chalk.gray('Example:'));
      console.log(chalk.cyan('  drift memory learn --original "Used MD5 for hashing" --feedback "Use bcrypt instead"'));
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Learning from correction...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);

    // Check if CortexV2 learn method is available
    let result: any;
    if ('learn' in cortex) {
      result = await cortex.learn(
        options.original,
        options.feedback,
        options.code,
        { activeFile: options.file }
      );
    } else {
      // Fallback: create a tribal memory
      const id = await cortex.add({
        type: 'tribal',
        topic: 'Learned correction',
        knowledge: `Original: ${options.original}\nCorrection: ${options.feedback}`,
        severity: 'warning',
        source: { type: 'manual' },
        summary: `Learned: ${options.feedback.slice(0, 50)}...`,
        confidence: 0.8,
        importance: 'normal',
      });
      
      result = {
        success: true,
        createdMemories: [id],
        principles: [{ statement: options.feedback }],
        category: 'correction',
      };
    }

    await cortex.storage.close();
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log();
    console.log(chalk.green.bold('✓ Learned from correction'));
    console.log();

    if (result.createdMemories?.length > 0) {
      console.log(chalk.bold('📝 Memories Created:'));
      for (const memId of result.createdMemories) {
        console.log(`  ${chalk.cyan(memId)}`);
      }
      console.log();
    }

    if (result.principles?.length > 0) {
      console.log(chalk.bold('💡 Extracted Principles:'));
      for (const p of result.principles) {
        console.log(`  • ${p.statement}`);
      }
      console.log();
    }

    console.log(`Category: ${result.category}`);
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Feedback subcommand - provide feedback on a memory
 */
async function feedbackAction(
  id: string,
  action: string,
  options: MemoryOptions & { details?: string }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!['confirm', 'reject', 'modify'].includes(action)) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Action must be: confirm, reject, or modify' }));
    } else {
      console.log(chalk.red('Action must be: confirm, reject, or modify'));
    }
    return;
  }

  try {
    const cortex = await getCortex(rootDir);
    
    const memory = await cortex.get(id);
    if (!memory) {
      await cortex.storage.close();
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Memory not found' }));
      } else {
        console.log(chalk.red(`Memory not found: ${id}`));
      }
      return;
    }

    const previousConfidence = memory.confidence;
    let newConfidence: number;

    switch (action) {
      case 'confirm':
        newConfidence = Math.min(1.0, previousConfidence + 0.1);
        break;
      case 'reject':
        newConfidence = Math.max(0.1, previousConfidence - 0.3);
        break;
      case 'modify':
        newConfidence = Math.max(0.3, previousConfidence - 0.1);
        break;
      default:
        newConfidence = previousConfidence;
    }

    await cortex.update(id, {
      confidence: newConfidence,
      lastAccessed: new Date().toISOString(),
      accessCount: memory.accessCount + 1,
    });

    await cortex.storage.close();

    if (format === 'json') {
      console.log(JSON.stringify({
        success: true,
        id,
        action,
        previousConfidence,
        newConfidence,
      }));
      return;
    }

    console.log();
    console.log(chalk.green.bold(`✓ Feedback recorded: ${action}`));
    console.log();
    console.log(`  Memory: ${chalk.cyan(id)}`);
    console.log(`  Previous Confidence: ${getConfidenceColor(previousConfidence)}`);
    console.log(`  New Confidence: ${getConfidenceColor(newConfidence)}`);
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Validate subcommand - validate memories
 */
async function validateAction(options: MemoryOptions & {
  scope?: string;
  autoHeal?: boolean;
  removeInvalid?: boolean;
  minConfidence?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const autoHeal = options.autoHeal !== false;
  const minConfidence = parseFloat(options.minConfidence ?? '0.2');

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Validating memories...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);
    const startTime = Date.now();

    // Get memories based on scope
    let memories;
    switch (options.scope) {
      case 'all':
        memories = await cortex.storage.search({ limit: 1000 });
        break;
      case 'recent':
        memories = await cortex.storage.search({ limit: 100 });
        break;
      case 'high_importance':
        memories = await cortex.storage.search({ 
          importance: ['high', 'critical'],
          limit: 500,
        });
        break;
      case 'stale':
      default:
        memories = await cortex.storage.search({ 
          maxConfidence: 0.5,
          limit: 500,
        });
        break;
    }

    const healingStats = {
      confidenceAdjusted: 0,
      summariesFixed: 0,
      memoriesRemoved: 0,
    };

    const issues: any[] = [];
    let valid = 0;
    let stale = 0;
    let healed = 0;

    for (const memory of memories) {
      let hasIssue = false;

      // Check for missing summary
      if (!memory.summary || memory.summary.trim() === '') {
        hasIssue = true;
        if (autoHeal) {
          await cortex.update(memory.id, { summary: `Memory ${memory.id.slice(0, 8)}...` });
          healingStats.summariesFixed++;
          healed++;
        }
        issues.push({ memoryId: memory.id, issue: 'Missing summary', healed: autoHeal });
      }

      // Check for invalid confidence
      if (memory.confidence < 0 || memory.confidence > 1) {
        hasIssue = true;
        if (autoHeal) {
          const fixed = Math.max(0, Math.min(1, memory.confidence));
          await cortex.update(memory.id, { confidence: fixed });
          healingStats.confidenceAdjusted++;
          healed++;
        }
        issues.push({ memoryId: memory.id, issue: 'Invalid confidence', healed: autoHeal });
      }

      // Check for very low confidence
      if (memory.confidence < minConfidence) {
        hasIssue = true;
        stale++;
        if (options.removeInvalid) {
          await cortex.delete(memory.id);
          healingStats.memoriesRemoved++;
          healed++;
        }
        issues.push({ memoryId: memory.id, issue: 'Very low confidence', healed: options.removeInvalid ?? false });
      }

      if (!hasIssue) {
        valid++;
      }
    }

    const duration = Date.now() - startTime;
    await cortex.storage.close();
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        summary: { total: memories.length, valid, stale, healed },
        healingStats,
        duration,
        issues: issues.slice(0, 50),
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🔍 Validation Results'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    console.log(chalk.bold('📊 Summary'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Total Validated: ${chalk.cyan(memories.length)}`);
    console.log(`  Valid:           ${chalk.green(valid)}`);
    console.log(`  Stale:           ${stale > 0 ? chalk.yellow(stale) : chalk.green('0')}`);
    console.log(`  Healed:          ${healed > 0 ? chalk.cyan(healed) : '0'}`);
    console.log(`  Duration:        ${duration}ms`);
    console.log();

    if (healingStats.summariesFixed > 0 || healingStats.confidenceAdjusted > 0 || healingStats.memoriesRemoved > 0) {
      console.log(chalk.bold('🔧 Healing Stats'));
      console.log(chalk.gray('─'.repeat(50)));
      if (healingStats.summariesFixed > 0) {
        console.log(`  Summaries Fixed:     ${healingStats.summariesFixed}`);
      }
      if (healingStats.confidenceAdjusted > 0) {
        console.log(`  Confidence Adjusted: ${healingStats.confidenceAdjusted}`);
      }
      if (healingStats.memoriesRemoved > 0) {
        console.log(`  Memories Removed:    ${healingStats.memoriesRemoved}`);
      }
      console.log();
    }

    if (issues.length > 0 && options.verbose) {
      console.log(chalk.bold('⚠️  Issues'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const issue of issues.slice(0, 10)) {
        const icon = issue.healed ? chalk.green('✓') : chalk.yellow('⚠');
        console.log(`  ${icon} ${chalk.cyan(issue.memoryId.slice(0, 8))}... ${issue.issue}`);
      }
      if (issues.length > 10) {
        console.log(chalk.gray(`  ... and ${issues.length - 10} more`));
      }
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}


/**
 * Consolidate subcommand - consolidate episodic memories
 */
async function consolidateAction(options: MemoryOptions & { dryRun?: boolean }): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const dryRun = options.dryRun ?? false;

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner(dryRun ? 'Analyzing consolidation...' : 'Consolidating memories...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);
    const result = await cortex.consolidate(dryRun);
    await cortex.storage.close();
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ dryRun, ...result }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(dryRun ? '🔍 Consolidation Preview' : '✓ Consolidation Complete'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    console.log(chalk.bold('📊 Results'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Episodes Processed: ${chalk.cyan(result.episodesProcessed)}`);
    console.log(`  Memories Created:   ${chalk.green(result.memoriesCreated)}`);
    console.log(`  Memories Updated:   ${chalk.cyan(result.memoriesUpdated)}`);
    console.log(`  Memories Pruned:    ${result.memoriesPruned > 0 ? chalk.yellow(result.memoriesPruned) : '0'}`);
    console.log(`  Tokens Freed:       ${chalk.cyan(result.tokensFreed)}`);
    console.log(`  Duration:           ${result.duration}ms`);
    console.log();

    if (dryRun) {
      console.log(chalk.gray('This was a dry run. Run without --dry-run to apply changes.'));
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Warnings subcommand - show active warnings
 */
async function warningsAction(options: MemoryOptions & {
  focus?: string;
  severity?: string;
}): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  try {
    const cortex = await getCortex(rootDir);

    // Get tribal warnings
    const tribal = await cortex.search({
      types: ['tribal'],
      importance: ['high', 'critical'],
      limit: 50,
    });

    // Get code smells
    const smells = await cortex.search({
      types: ['code_smell'],
      limit: 50,
    });

    await cortex.storage.close();

    const warnings: any[] = [];

    // Process tribal warnings
    for (const mem of tribal) {
      if (options.severity === 'critical' && mem.severity !== 'critical') continue;
      if (options.focus && !mem.topic?.toLowerCase().includes(options.focus.toLowerCase())) continue;

      warnings.push({
        type: 'tribal',
        severity: mem.severity,
        message: mem.knowledge,
        source: mem.topic,
        confidence: mem.confidence,
      });
    }

    // Process code smells
    for (const mem of smells) {
      if (options.focus && !mem.name?.toLowerCase().includes(options.focus.toLowerCase())) continue;

      warnings.push({
        type: 'code_smell',
        severity: mem.severity,
        message: `${mem.name}: ${mem.reason}`,
        source: mem.name,
        confidence: mem.confidence,
      });
    }

    // Sort by severity
    const severityOrder: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
    warnings.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

    if (format === 'json') {
      console.log(JSON.stringify({
        warnings,
        total: warnings.length,
        bySeverity: {
          critical: warnings.filter(w => w.severity === 'critical').length,
          warning: warnings.filter(w => w.severity === 'warning').length,
          info: warnings.filter(w => w.severity === 'info').length,
        },
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('⚠️  Active Warnings'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    if (warnings.length === 0) {
      console.log(chalk.green('No active warnings.'));
      console.log();
      return;
    }

    for (const w of warnings) {
      const icon = w.severity === 'critical' ? chalk.red('🚨') : 
                   w.severity === 'warning' ? chalk.yellow('⚠️') : 
                   chalk.blue('ℹ️');
      const severityColor = w.severity === 'critical' ? chalk.red : 
                           w.severity === 'warning' ? chalk.yellow : 
                           chalk.gray;
      
      console.log(`${icon} ${severityColor(`[${w.severity.toUpperCase()}]`)} ${w.source}`);
      console.log(`   ${w.message}`);
      console.log(chalk.gray(`   Confidence: ${getConfidenceColor(w.confidence)}`));
      console.log();
    }

    console.log(chalk.gray(`Total: ${warnings.length} warnings`));
    console.log();

  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Why subcommand - get context for a task
 */
async function whyAction(
  focus: string,
  options: MemoryOptions & {
    intent?: string;
    maxTokens?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const intent = (options.intent ?? 'understand_code') as any;
  const maxTokens = parseInt(options.maxTokens ?? '2000', 10);

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Gathering context...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);

    const result = await cortex.retrieval.retrieve({
      intent,
      focus,
      maxTokens,
    });

    await cortex.storage.close();
    spinner?.stop();

    // Organize by type
    const byType: Record<string, any[]> = {};
    for (const m of result.memories) {
      const type = m.memory.type;
      if (!byType[type]) byType[type] = [];
      byType[type].push(m);
    }

    if (format === 'json') {
      console.log(JSON.stringify({
        focus,
        intent,
        tokensUsed: result.tokensUsed,
        totalCandidates: result.totalCandidates,
        retrievalTime: result.retrievalTime,
        memories: result.memories.map((m: any) => ({
          id: m.memory.id,
          type: m.memory.type,
          summary: m.memory.summary,
          relevanceScore: m.relevanceScore,
        })),
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold(`🔍 Context for "${focus}"`));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    console.log(chalk.gray(`Intent: ${intent} | Tokens: ${result.tokensUsed}/${maxTokens} | Time: ${result.retrievalTime}ms`));
    console.log();

    if (result.memories.length === 0) {
      console.log(chalk.yellow('No relevant memories found.'));
      console.log();
      return;
    }

    // Show by type
    for (const [type, memories] of Object.entries(byType)) {
      const typeInfo = MEMORY_TYPES[type];
      console.log(chalk.bold(`${typeInfo?.icon ?? '📦'} ${type.toUpperCase()}`));
      console.log(chalk.gray('─'.repeat(40)));
      
      for (const m of memories.slice(0, 5)) {
        console.log(`  ${chalk.cyan(m.memory.id.slice(0, 8))}... ${m.memory.summary}`);
        console.log(chalk.gray(`    Relevance: ${(m.relevanceScore * 100).toFixed(0)}%`));
      }
      if (memories.length > 5) {
        console.log(chalk.gray(`  ... and ${memories.length - 5} more`));
      }
      console.log();
    }

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Export subcommand - export memories to JSON
 */
async function exportAction(
  output: string,
  options: MemoryOptions & {
    type?: string;
    minConfidence?: string;
    includeArchived?: boolean;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Exporting memories...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);

    const query: any = { limit: 10000 };
    if (options.type) {
      query.types = [options.type];
    }
    if (options.minConfidence) {
      query.minConfidence = parseFloat(options.minConfidence);
    }
    if (options.includeArchived) {
      query.includeArchived = true;
    }

    const memories = await cortex.search(query);
    await cortex.storage.close();

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      count: memories.length,
      memories,
    };

    await fs.writeFile(output, JSON.stringify(exportData, null, 2));
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ success: true, count: memories.length, output }));
      return;
    }

    console.log();
    console.log(chalk.green.bold(`✓ Exported ${memories.length} memories to ${output}`));
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Import subcommand - import memories from JSON
 */
async function importAction(
  input: string,
  options: MemoryOptions & { overwrite?: boolean }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';
  const overwrite = options.overwrite ?? false;

  const spinner = format === 'text' ? createSpinner('Importing memories...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);

    const content = await fs.readFile(input, 'utf-8');
    const data = JSON.parse(content);

    const memories = data.memories ?? data;
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const memory of memories) {
      try {
        const existing = await cortex.get(memory.id);

        if (existing && !overwrite) {
          skipped++;
          continue;
        }

        if (existing) {
          await cortex.update(memory.id, memory);
        } else {
          await cortex.add(memory);
        }

        imported++;
      } catch {
        errors++;
      }
    }

    await cortex.storage.close();
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({ imported, skipped, errors, total: memories.length }));
      return;
    }

    console.log();
    console.log(chalk.green.bold('✓ Import complete'));
    console.log();
    console.log(`  Imported: ${chalk.green(imported)}`);
    console.log(`  Skipped:  ${skipped > 0 ? chalk.yellow(skipped) : '0'}`);
    console.log(`  Errors:   ${errors > 0 ? chalk.red(errors) : '0'}`);
    console.log(`  Total:    ${memories.length}`);
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Health subcommand - comprehensive health report
 */
async function healthAction(options: MemoryOptions): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  if (!(await memoryExists(rootDir))) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: 'Memory system not initialized' }));
    } else {
      showNoMemoriesMessage();
    }
    return;
  }

  const spinner = format === 'text' ? createSpinner('Analyzing memory health...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);

    // Get memory statistics
    const countByType = await cortex.storage.countByType();
    const total = Object.values(countByType).reduce((sum: number, count) => sum + (count as number), 0);
    
    // Get sample of memories for analysis
    const memories = await cortex.storage.search({ limit: 500 });
    
    let confidenceSum = 0;
    let lowConfidenceCount = 0;
    let recentlyAccessed = 0;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    for (const memory of memories) {
      confidenceSum += memory.confidence;
      if (memory.confidence < 0.5) {
        lowConfidenceCount++;
      }
      if (memory.lastAccessed && new Date(memory.lastAccessed) > oneWeekAgo) {
        recentlyAccessed++;
      }
    }

    const avgConfidence = memories.length > 0 ? confidenceSum / memories.length : 0;

    // Identify issues
    const issues: any[] = [];
    const recommendations: string[] = [];

    if (avgConfidence < 0.5) {
      issues.push({
        severity: 'high',
        message: `Average memory confidence is low (${Math.round(avgConfidence * 100)}%)`,
        recommendation: 'Run validation to confirm or remove low-confidence memories',
      });
    }

    if (lowConfidenceCount > memories.length * 0.3) {
      issues.push({
        severity: 'medium',
        message: `${lowConfidenceCount} memories (${Math.round(lowConfidenceCount / memories.length * 100)}%) have low confidence`,
        recommendation: 'Review and validate these memories',
      });
    }

    if (total > 1000) {
      issues.push({
        severity: 'low',
        message: `Large memory count (${total}) may impact performance`,
        recommendation: 'Consider running consolidation to merge similar memories',
      });
    }

    if (recentlyAccessed < memories.length * 0.1) {
      issues.push({
        severity: 'low',
        message: 'Most memories have not been accessed recently',
        recommendation: 'Consider pruning unused memories',
      });
    }

    // Generate recommendations
    if (lowConfidenceCount > 10) {
      recommendations.push('Run `drift memory validate` to clean up low-confidence memories');
    }
    if (total > 500) {
      recommendations.push('Run `drift memory consolidate` to merge similar memories');
    }
    if (avgConfidence < 0.7) {
      recommendations.push('Use `drift memory feedback` to confirm accurate memories');
    }
    if (recommendations.length === 0) {
      recommendations.push('Memory system is healthy. Continue using as normal.');
    }

    // Calculate overall score
    let overallScore = 100;
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical': overallScore -= 30; break;
        case 'high': overallScore -= 20; break;
        case 'medium': overallScore -= 10; break;
        case 'low': overallScore -= 5; break;
      }
    }
    overallScore = Math.max(0, overallScore);

    await cortex.storage.close();
    spinner?.stop();

    if (format === 'json') {
      console.log(JSON.stringify({
        overallScore,
        status: overallScore >= 80 ? 'healthy' : overallScore >= 50 ? 'warning' : 'critical',
        memoryStats: {
          total,
          byType: countByType,
          avgConfidence,
          lowConfidenceCount,
          recentlyAccessed,
        },
        issues,
        recommendations,
      }, null, 2));
      return;
    }

    console.log();
    console.log(chalk.bold('🏥 Memory Health Report'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log();

    console.log(chalk.bold('📊 Overall Health'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Score: ${getHealthColor(overallScore)}`);
    console.log();

    console.log(chalk.bold('📈 Statistics'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`  Total Memories:      ${chalk.cyan(total)}`);
    console.log(`  Avg Confidence:      ${getConfidenceColor(avgConfidence)}`);
    console.log(`  Low Confidence:      ${lowConfidenceCount > 0 ? chalk.yellow(lowConfidenceCount) : chalk.green('0')}`);
    console.log(`  Recently Accessed:   ${chalk.cyan(recentlyAccessed)}`);
    console.log();

    if (issues.length > 0) {
      console.log(chalk.bold('⚠️  Issues'));
      console.log(chalk.gray('─'.repeat(50)));
      for (const issue of issues) {
        const icon = issue.severity === 'high' ? chalk.red('●') : 
                     issue.severity === 'medium' ? chalk.yellow('●') : 
                     chalk.gray('●');
        console.log(`  ${icon} ${issue.message}`);
        console.log(chalk.gray(`    → ${issue.recommendation}`));
      }
      console.log();
    }

    console.log(chalk.bold('💡 Recommendations'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const rec of recommendations) {
      console.log(`  • ${rec}`);
    }
    console.log();

  } catch (error) {
    spinner?.stop();
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}


// ============================================================================
// Command Registration
// ============================================================================

export function createMemoryCommand(): Command {
  const cmd = new Command('memory')
    .description('Manage Cortex V2 memories - institutional knowledge, procedures, patterns, and more')
    .option('-f, --format <format>', 'Output format (text, json)', 'text')
    .option('-v, --verbose', 'Enable verbose output');

  // Initialize
  cmd
    .command('init')
    .description('Initialize the memory system')
    .action(() => initAction(cmd.opts()));

  // Status
  cmd
    .command('status')
    .description('Show memory system status and health')
    .action(() => statusAction(cmd.opts()));

  // Add
  cmd
    .command('add <type> <content>')
    .description('Add a new memory (types: tribal, procedural, semantic, pattern_rationale, code_smell, decision_context, constraint_override)')
    .option('-t, --topic <topic>', 'Topic or name for the memory')
    .option('-s, --severity <severity>', 'Severity level (info, warning, critical)', 'warning')
    .option('-i, --importance <importance>', 'Importance level (low, normal, high, critical)', 'normal')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--file <file>', 'Link to a file')
    .option('--pattern <pattern>', 'Link to a pattern ID')
    .action((type, content, opts) => addAction(type, content, { ...cmd.opts(), ...opts }));

  // List
  cmd
    .command('list')
    .description('List memories')
    .option('-t, --type <type>', 'Filter by memory type')
    .option('-i, --importance <importance>', 'Filter by importance')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .option('--min-confidence <number>', 'Minimum confidence threshold')
    .action((opts) => listAction({ ...cmd.opts(), ...opts }));

  // Show
  cmd
    .command('show <id>')
    .description('Show memory details')
    .action((id) => showAction(id, cmd.opts()));

  // Search
  cmd
    .command('search <query>')
    .description('Search memories')
    .option('-t, --type <type>', 'Filter by memory type')
    .option('-l, --limit <number>', 'Maximum results', '20')
    .action((query, opts) => searchAction(query, { ...cmd.opts(), ...opts }));

  // Update
  cmd
    .command('update <id>')
    .description('Update a memory')
    .option('-c, --confidence <number>', 'New confidence value (0-1)')
    .option('-i, --importance <importance>', 'New importance level')
    .option('--tags <tags>', 'New comma-separated tags')
    .option('--summary <summary>', 'New summary')
    .action((id, opts) => updateAction(id, { ...cmd.opts(), ...opts }));

  // Delete
  cmd
    .command('delete <id>')
    .description('Delete a memory (soft delete)')
    .action((id) => deleteAction(id, cmd.opts()));

  // Learn
  cmd
    .command('learn')
    .description('Learn from a correction')
    .requiredOption('-o, --original <text>', 'Original code or response')
    .requiredOption('-f, --feedback <text>', 'Feedback or correction')
    .option('-c, --code <code>', 'Corrected code')
    .option('--file <file>', 'Related file')
    .action((opts) => learnAction({ ...cmd.opts(), ...opts }));

  // Feedback
  cmd
    .command('feedback <id> <action>')
    .description('Provide feedback on a memory (actions: confirm, reject, modify)')
    .option('-d, --details <text>', 'Additional details')
    .action((id, action, opts) => feedbackAction(id, action, { ...cmd.opts(), ...opts }));

  // Validate
  cmd
    .command('validate')
    .description('Validate memories and optionally heal issues')
    .option('-s, --scope <scope>', 'Scope: all, stale, recent, high_importance', 'stale')
    .option('--auto-heal', 'Automatically heal minor issues', true)
    .option('--remove-invalid', 'Remove memories that cannot be healed')
    .option('--min-confidence <number>', 'Minimum confidence to keep', '0.2')
    .action((opts) => validateAction({ ...cmd.opts(), ...opts }));

  // Consolidate
  cmd
    .command('consolidate')
    .description('Consolidate episodic memories into semantic knowledge')
    .option('--dry-run', 'Preview without making changes')
    .action((opts) => consolidateAction({ ...cmd.opts(), ...opts }));

  // Warnings
  cmd
    .command('warnings')
    .description('Show active warnings from tribal knowledge and code smells')
    .option('--focus <focus>', 'Filter by focus area')
    .option('--severity <severity>', 'Filter by severity (all, critical, warning)', 'all')
    .action((opts) => warningsAction({ ...cmd.opts(), ...opts }));

  // Why
  cmd
    .command('why <focus>')
    .description('Get context for a task - patterns, decisions, tribal knowledge')
    .option('-i, --intent <intent>', 'Intent: add_feature, fix_bug, refactor, security_audit, understand_code, add_test', 'understand_code')
    .option('--max-tokens <number>', 'Maximum tokens to use', '2000')
    .action((focus, opts) => whyAction(focus, { ...cmd.opts(), ...opts }));

  // Export
  cmd
    .command('export <output>')
    .description('Export memories to JSON file')
    .option('-t, --type <type>', 'Filter by memory type')
    .option('--min-confidence <number>', 'Minimum confidence threshold')
    .option('--include-archived', 'Include archived memories')
    .action((output, opts) => exportAction(output, { ...cmd.opts(), ...opts }));

  // Import
  cmd
    .command('import <input>')
    .description('Import memories from JSON file')
    .option('--overwrite', 'Overwrite existing memories with same ID')
    .action((input, opts) => importAction(input, { ...cmd.opts(), ...opts }));

  // Health
  cmd
    .command('health')
    .description('Get comprehensive health report')
    .action(() => healthAction(cmd.opts()));

  return cmd;
}
