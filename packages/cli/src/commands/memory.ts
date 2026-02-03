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
import type { Memory } from 'driftdetect-cortex';

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
  // Core types (domain-agnostic)
  core: { name: 'core', icon: '🏠', description: 'Project identity and preferences', halfLife: '∞' },
  tribal: { name: 'tribal', icon: '⚠️', description: 'Institutional knowledge, gotchas', halfLife: '365d' },
  procedural: { name: 'procedural', icon: '📋', description: 'How-to knowledge, procedures', halfLife: '180d' },
  semantic: { name: 'semantic', icon: '💡', description: 'Consolidated knowledge', halfLife: '90d' },
  episodic: { name: 'episodic', icon: '💭', description: 'Interaction records', halfLife: '7d' },
  decision: { name: 'decision', icon: '⚖️', description: 'Decisions made', halfLife: '180d' },
  insight: { name: 'insight', icon: '💎', description: 'Insights and learnings', halfLife: '90d' },
  reference: { name: 'reference', icon: '📚', description: 'Reference materials', halfLife: '60d' },
  preference: { name: 'preference', icon: '⭐', description: 'User preferences', halfLife: '120d' },
  // Code-specific types
  pattern_rationale: { name: 'pattern_rationale', icon: '🎯', description: 'Why patterns exist', halfLife: '180d' },
  constraint_override: { name: 'constraint_override', icon: '✅', description: 'Approved exceptions', halfLife: '90d' },
  decision_context: { name: 'decision_context', icon: '📝', description: 'Decision context', halfLife: '180d' },
  code_smell: { name: 'code_smell', icon: '🚫', description: 'Patterns to avoid', halfLife: '90d' },
  // Universal memory types (v2)
  agent_spawn: { name: 'agent_spawn', icon: '🤖', description: 'Agent configurations', halfLife: '365d' },
  entity: { name: 'entity', icon: '📦', description: 'Projects, products, teams', halfLife: '180d' },
  goal: { name: 'goal', icon: '🎯', description: 'Objectives with progress', halfLife: '90d' },
  feedback: { name: 'feedback', icon: '📝', description: 'Corrections and learning', halfLife: '120d' },
  workflow: { name: 'workflow', icon: '📋', description: 'Step-by-step processes', halfLife: '180d' },
  conversation: { name: 'conversation', icon: '💬', description: 'Past discussions', halfLife: '30d' },
  incident: { name: 'incident', icon: '🚨', description: 'Postmortems and lessons', halfLife: '365d' },
  meeting: { name: 'meeting', icon: '📅', description: 'Meeting notes', halfLife: '60d' },
  skill: { name: 'skill', icon: '🧠', description: 'Knowledge domains', halfLife: '180d' },
  environment: { name: 'environment', icon: '🌍', description: 'Environment configs', halfLife: '90d' },
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
  if (isNaN(confidence) || confidence === null || confidence === undefined) {
    return chalk.gray('N/A');
  }
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

  // Some types shouldn't be manually added
  const manuallyAddableTypes = ['tribal', 'procedural', 'pattern_rationale', 'code_smell', 'decision_context', 'constraint_override'];
  if (!manuallyAddableTypes.includes(type)) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: `Type '${type}' cannot be manually added. Use: ${manuallyAddableTypes.join(', ')}` }));
    } else {
      console.log(chalk.red(`Type '${type}' cannot be manually added.`));
      console.log(chalk.gray(`Manually addable types: ${manuallyAddableTypes.join(', ')}`));
      if (type === 'episodic') {
        console.log(chalk.gray('Episodic memories are created automatically from interactions.'));
      } else if (type === 'semantic') {
        console.log(chalk.gray('Semantic memories are created through consolidation.'));
      } else if (type === 'core') {
        console.log(chalk.gray('Core memory is created during initialization.'));
      }
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
async function learnAction(
  correction: string,
  options: MemoryOptions & {
    original?: string;
    code?: string;
    file?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  // The correction is the main argument, original is optional context
  const feedback = correction;
  const original = options.original ?? 'Previous approach';

  const spinner = format === 'text' ? createSpinner('Learning from correction...') : null;
  spinner?.start();

  try {
    const cortex = await getCortex(rootDir);

    // Check if CortexV2 learn method is available
    let result: any;
    if ('learn' in cortex) {
      result = await cortex.learn(
        original,
        feedback,
        options.code,
        { activeFile: options.file }
      );
    } else {
      // Fallback: create a tribal memory
      const id = await cortex.add({
        type: 'tribal',
        topic: 'Learned correction',
        knowledge: original !== 'Previous approach' 
          ? `Original: ${original}\nCorrection: ${feedback}`
          : feedback,
        severity: 'warning',
        source: { type: 'manual' },
        summary: feedback.length > 50 ? `${feedback.slice(0, 47)}...` : feedback,
        confidence: 0.8,
        importance: 'normal',
      });
      
      result = {
        success: true,
        createdMemories: [id],
        principles: [{ statement: feedback }],
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
        // Validate required fields
        if (!memory.type || typeof memory.type !== 'string') {
          errors++;
          continue;
        }
        
        // Ensure confidence is a valid number
        if (memory.confidence === undefined || memory.confidence === null || isNaN(memory.confidence)) {
          memory.confidence = 1; // Default to full confidence
        }
        
        // Ensure importance is set
        if (!memory.importance) {
          memory.importance = 'normal';
        }
        
        // Ensure summary is set
        if (!memory.summary) {
          memory.summary = memory.knowledge || memory.description || memory.content || `${memory.type} memory`;
        }

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
      if (typeof memory.confidence === 'number' && !isNaN(memory.confidence)) {
        confidenceSum += memory.confidence;
      }
      if (memory.confidence < 0.5) {
        lowConfidenceCount++;
      }
      if (memory.lastAccessed && new Date(memory.lastAccessed) > oneWeekAgo) {
        recentlyAccessed++;
      }
    }

    const validConfidenceCount = memories.filter((m: Memory) => typeof m.confidence === 'number' && !isNaN(m.confidence)).length;
    const avgConfidence = validConfidenceCount > 0 ? confidenceSum / validConfidenceCount : 0;

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
// Universal Memory Actions
// ============================================================================

/**
 * Agent subcommand - manage agent spawn configurations
 */
async function agentAction(
  action: string,
  options: MemoryOptions & {
    name?: string;
    slug?: string;
    description?: string;
    systemPrompt?: string;
    tools?: string;
    triggers?: string;
    query?: string;
    id?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);

    switch (action) {
      case 'create': {
        if (!options.name || !options.slug || !options.systemPrompt || !options.tools || !options.triggers) {
          if (format === 'json') {
            console.log(JSON.stringify({ error: 'Missing required: --name, --slug, --system-prompt, --tools, --triggers' }));
          } else {
            console.log(chalk.red('Missing required options: --name, --slug, --system-prompt, --tools, --triggers'));
          }
          return;
        }
        const memory = {
          type: 'agent_spawn',
          name: options.name,
          description: options.description || '',
          slug: options.slug,
          systemPrompt: options.systemPrompt,
          tools: options.tools.split(',').map(t => t.trim()),
          triggerPatterns: options.triggers.split(',').map(t => t.trim()),
          autoSpawn: false,
          version: '1.0.0',
          stats: { invocationCount: 0, successRate: 1.0, avgDurationMs: 0 },
          summary: `🤖 ${options.name}: ${options.tools.split(',').length} tools`,
          confidence: 1.0,
          importance: 'high',
        };
        const id = await cortex.add(memory as any);
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ success: true, id, slug: options.slug }));
        } else {
          console.log(chalk.green.bold(`\n✓ Created agent "${options.name}" (${options.slug})`));
          console.log(`  ID: ${chalk.cyan(id)}\n`);
        }
        break;
      }
      case 'list': {
        const agents = await cortex.search({ types: ['agent_spawn' as any], limit: 50 });
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ agents, total: agents.length }, null, 2));
        } else {
          console.log(chalk.bold('\n🤖 Agent Configurations'));
          console.log(chalk.gray('─'.repeat(50)));
          if (agents.length === 0) {
            console.log(chalk.yellow('No agents configured. Create one with: drift memory agent create'));
          } else {
            for (const a of agents) {
              console.log(`  ${chalk.cyan(a.slug?.padEnd(20) || 'unknown')} ${a.name} (${a.tools?.length || 0} tools)`);
            }
          }
          console.log();
        }
        break;
      }
      case 'get': {
        if (!options.slug && !options.id) {
          console.log(chalk.red('Missing --slug or --id'));
          return;
        }
        let agent: any = null;
        if (options.id) {
          agent = await cortex.get(options.id);
        } else {
          const agents = await cortex.search({ types: ['agent_spawn' as any], limit: 100 });
          agent = agents.find((a: any) => a.slug === options.slug);
        }
        await cortex.storage.close();
        if (!agent) {
          console.log(chalk.red('Agent not found'));
          return;
        }
        if (format === 'json') {
          console.log(JSON.stringify(agent, null, 2));
        } else {
          console.log(chalk.bold(`\n🤖 ${agent.name}`));
          console.log(chalk.gray('─'.repeat(50)));
          console.log(`  Slug:     ${chalk.cyan(agent.slug)}`);
          console.log(`  Tools:    ${agent.tools?.join(', ')}`);
          console.log(`  Triggers: ${agent.triggerPatterns?.join(', ')}`);
          console.log(`  Stats:    ${agent.stats?.invocationCount || 0} invocations`);
          console.log();
        }
        break;
      }
      default:
        console.log(chalk.red(`Unknown action: ${action}. Use: create, list, get`));
    }
  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Goal subcommand - track goals with progress
 */
async function goalAction(
  action: string,
  options: MemoryOptions & {
    title?: string;
    description?: string;
    parent?: string;
    progress?: string;
    status?: string;
    id?: string;
    blocker?: string;
    severity?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);

    switch (action) {
      case 'create': {
        if (!options.title || !options.description) {
          console.log(chalk.red('Missing required: --title, --description'));
          return;
        }
        const memory = {
          type: 'goal',
          title: options.title,
          description: options.description,
          parentGoalId: options.parent,
          status: 'active',
          progress: 0,
          successCriteria: [],
          createdDate: new Date().toISOString(),
          blockers: [],
          summary: `🎯 ${options.title}: 0% (active)`,
          confidence: 1.0,
          importance: 'high',
        };
        const id = await cortex.add(memory as any);
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ success: true, id }));
        } else {
          console.log(chalk.green.bold(`\n✓ Created goal "${options.title}"`));
          console.log(`  ID: ${chalk.cyan(id)}\n`);
        }
        break;
      }
      case 'list': {
        const goals = await cortex.search({ types: ['goal' as any], limit: 50 });
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ goals, total: goals.length }, null, 2));
        } else {
          console.log(chalk.bold('\n🎯 Goals'));
          console.log(chalk.gray('─'.repeat(50)));
          if (goals.length === 0) {
            console.log(chalk.yellow('No goals. Create one with: drift memory goal create'));
          } else {
            for (const g of goals) {
              const statusColor = g.status === 'achieved' ? chalk.green : g.status === 'blocked' ? chalk.red : chalk.yellow;
              console.log(`  ${statusColor(`[${g.status}]`.padEnd(12))} ${g.title} (${g.progress || 0}%)`);
            }
          }
          console.log();
        }
        break;
      }
      case 'update': {
        if (!options.id) {
          console.log(chalk.red('Missing --id'));
          return;
        }
        const goal = await cortex.get(options.id) as any;
        if (!goal) {
          console.log(chalk.red('Goal not found'));
          return;
        }
        const updates: any = {};
        if (options.progress) updates.progress = parseInt(options.progress, 10);
        if (options.status) updates.status = options.status;
        updates.summary = `🎯 ${goal.title}: ${options.progress || goal.progress}% (${options.status || goal.status})`;
        await cortex.update(options.id, updates);
        await cortex.storage.close();
        console.log(chalk.green.bold(`\n✓ Updated goal "${goal.title}"\n`));
        break;
      }
      case 'block': {
        if (!options.id || !options.blocker) {
          console.log(chalk.red('Missing --id and --blocker'));
          return;
        }
        const goal = await cortex.get(options.id) as any;
        if (!goal) {
          console.log(chalk.red('Goal not found'));
          return;
        }
        const blockers = goal.blockers || [];
        blockers.push({
          description: options.blocker,
          severity: options.severity || 'medium',
          createdAt: new Date().toISOString(),
        });
        await cortex.update(options.id, { blockers, status: 'blocked' } as any);
        await cortex.storage.close();
        console.log(chalk.yellow.bold(`\n⚠️ Added blocker to "${goal.title}"\n`));
        break;
      }
      case 'complete': {
        if (!options.id) {
          console.log(chalk.red('Missing --id'));
          return;
        }
        const goal = await cortex.get(options.id) as any;
        if (!goal) {
          console.log(chalk.red('Goal not found'));
          return;
        }
        await cortex.update(options.id, {
          status: 'achieved',
          progress: 100,
          achievedDate: new Date().toISOString(),
          summary: `🎯 ${goal.title}: 100% (achieved)`,
        } as any);
        await cortex.storage.close();
        console.log(chalk.green.bold(`\n🎉 Completed goal "${goal.title}"!\n`));
        break;
      }
      default:
        console.log(chalk.red(`Unknown action: ${action}. Use: create, list, update, block, complete`));
    }
  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Incident subcommand - record and retrieve postmortems
 */
async function incidentAction(
  action: string,
  options: MemoryOptions & {
    title?: string;
    severity?: string;
    impact?: string;
    rootCause?: string;
    resolution?: string;
    lessons?: string;
    triggers?: string;
    id?: string;
    query?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);

    switch (action) {
      case 'record': {
        if (!options.title || !options.severity || !options.impact || !options.resolution || !options.lessons) {
          console.log(chalk.red('Missing required: --title, --severity, --impact, --resolution, --lessons'));
          return;
        }
        const memory = {
          type: 'incident',
          title: options.title,
          severity: options.severity,
          detectedAt: new Date().toISOString(),
          impact: options.impact,
          affectedSystems: [],
          rootCause: options.rootCause,
          resolution: options.resolution,
          lessonsLearned: options.lessons.split(',').map(l => l.trim()),
          warningTriggers: options.triggers?.split(',').map(t => t.trim()) || [],
          summary: `🚨 ${options.severity}: ${options.title}`,
          confidence: 1.0,
          importance: options.severity === 'critical' ? 'critical' : 'high',
        };
        const id = await cortex.add(memory as any);
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ success: true, id }));
        } else {
          console.log(chalk.green.bold(`\n✓ Recorded incident "${options.title}"`));
          console.log(`  ID: ${chalk.cyan(id)}\n`);
        }
        break;
      }
      case 'list': {
        const incidents = await cortex.search({ types: ['incident' as any], limit: 50 });
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ incidents, total: incidents.length }, null, 2));
        } else {
          console.log(chalk.bold('\n🚨 Incidents'));
          console.log(chalk.gray('─'.repeat(50)));
          if (incidents.length === 0) {
            console.log(chalk.green('No incidents recorded.'));
          } else {
            for (const i of incidents) {
              const sevColor = i.severity === 'critical' ? chalk.red : i.severity === 'high' ? chalk.yellow : chalk.white;
              console.log(`  ${sevColor(`[${i.severity}]`.padEnd(12))} ${i.title}`);
            }
          }
          console.log();
        }
        break;
      }
      case 'warnings': {
        if (!options.query) {
          console.log(chalk.red('Missing --query'));
          return;
        }
        const incidents = await cortex.search({ types: ['incident' as any], limit: 100 });
        const q = options.query.toLowerCase();
        const warnings: any[] = [];
        for (const inc of incidents) {
          const incAny = inc as any;
          for (const trigger of incAny.warningTriggers || []) {
            if (q.includes(trigger.toLowerCase())) {
              warnings.push({ incident: inc, trigger });
              break;
            }
          }
        }
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ warnings, total: warnings.length }, null, 2));
        } else {
          if (warnings.length === 0) {
            console.log(chalk.green('\n✓ No relevant incident warnings.\n'));
          } else {
            console.log(chalk.yellow.bold(`\n⚠️ Found ${warnings.length} relevant incidents:`));
            for (const w of warnings) {
              console.log(`  🚨 ${w.incident.title}`);
              console.log(chalk.gray(`     Trigger: ${w.trigger}`));
            }
            console.log();
          }
        }
        break;
      }
      default:
        console.log(chalk.red(`Unknown action: ${action}. Use: record, list, warnings`));
    }
  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Workflow subcommand - manage step-by-step processes
 */
async function workflowAction(
  action: string,
  options: MemoryOptions & {
    name?: string;
    slug?: string;
    description?: string;
    steps?: string;
    triggers?: string;
    id?: string;
    query?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);

    switch (action) {
      case 'create': {
        if (!options.name || !options.slug || !options.steps || !options.triggers) {
          console.log(chalk.red('Missing required: --name, --slug, --steps, --triggers'));
          return;
        }
        const stepsList = options.steps.split('|').map((s, i) => ({
          order: i + 1,
          name: `Step ${i + 1}`,
          description: s.trim(),
          required: true,
        }));
        const memory = {
          type: 'workflow',
          name: options.name,
          description: options.description || '',
          slug: options.slug,
          steps: stepsList,
          triggerPhrases: options.triggers.split(',').map(t => t.trim()),
          stats: { executionCount: 0, successRate: 1.0 },
          summary: `📋 ${options.name}: ${stepsList.length} steps`,
          confidence: 1.0,
          importance: 'normal',
        };
        const id = await cortex.add(memory as any);
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ success: true, id, slug: options.slug }));
        } else {
          console.log(chalk.green.bold(`\n✓ Created workflow "${options.name}" (${options.slug})`));
          console.log(`  ID: ${chalk.cyan(id)}\n`);
        }
        break;
      }
      case 'list': {
        const workflows = await cortex.search({ types: ['workflow' as any], limit: 50 });
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ workflows, total: workflows.length }, null, 2));
        } else {
          console.log(chalk.bold('\n📋 Workflows'));
          console.log(chalk.gray('─'.repeat(50)));
          if (workflows.length === 0) {
            console.log(chalk.yellow('No workflows. Create one with: drift memory workflow create'));
          } else {
            for (const w of workflows) {
              console.log(`  ${chalk.cyan(w.slug?.padEnd(20) || 'unknown')} ${w.name} (${w.steps?.length || 0} steps)`);
            }
          }
          console.log();
        }
        break;
      }
      case 'run': {
        if (!options.slug && !options.id) {
          console.log(chalk.red('Missing --slug or --id'));
          return;
        }
        let workflow: any = null;
        if (options.id) {
          workflow = await cortex.get(options.id);
        } else {
          const workflows = await cortex.search({ types: ['workflow' as any], limit: 100 });
          workflow = workflows.find((w: any) => w.slug === options.slug);
        }
        await cortex.storage.close();
        if (!workflow) {
          console.log(chalk.red('Workflow not found'));
          return;
        }
        if (format === 'json') {
          console.log(JSON.stringify(workflow, null, 2));
        } else {
          console.log(chalk.bold(`\n📋 ${workflow.name}`));
          console.log(chalk.gray('═'.repeat(50)));
          for (const step of workflow.steps || []) {
            console.log(`  ${chalk.cyan(`${step.order}.`)} ${step.description}`);
          }
          console.log();
        }
        break;
      }
      default:
        console.log(chalk.red(`Unknown action: ${action}. Use: create, list, run`));
    }
  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Entity subcommand - track projects, products, teams
 */
async function entityAction(
  action: string,
  options: MemoryOptions & {
    type?: string;
    name?: string;
    facts?: string;
    warnings?: string;
    status?: string;
    id?: string;
    query?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);

    switch (action) {
      case 'create': {
        if (!options.type || !options.name || !options.facts) {
          console.log(chalk.red('Missing required: --type, --name, --facts'));
          return;
        }
        const memory = {
          type: 'entity',
          entityType: options.type,
          name: options.name,
          attributes: {},
          status: options.status || 'active',
          keyFacts: options.facts.split(',').map(f => f.trim()),
          warnings: options.warnings?.split(',').map(w => w.trim()),
          relationships: [],
          summary: `📦 ${options.type}: ${options.name}`,
          confidence: 1.0,
          importance: 'normal',
        };
        const id = await cortex.add(memory as any);
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ success: true, id }));
        } else {
          console.log(chalk.green.bold(`\n✓ Created ${options.type} "${options.name}"`));
          console.log(`  ID: ${chalk.cyan(id)}\n`);
        }
        break;
      }
      case 'list': {
        const entities = await cortex.search({ types: ['entity' as any], limit: 50 });
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ entities, total: entities.length }, null, 2));
        } else {
          console.log(chalk.bold('\n📦 Entities'));
          console.log(chalk.gray('─'.repeat(50)));
          if (entities.length === 0) {
            console.log(chalk.yellow('No entities. Create one with: drift memory entity create'));
          } else {
            for (const e of entities) {
              console.log(`  ${chalk.gray(`[${e.entityType}]`.padEnd(12))} ${e.name}`);
            }
          }
          console.log();
        }
        break;
      }
      case 'get': {
        if (!options.name && !options.id) {
          console.log(chalk.red('Missing --name or --id'));
          return;
        }
        let entity: any = null;
        if (options.id) {
          entity = await cortex.get(options.id);
        } else {
          const entities = await cortex.search({ types: ['entity' as any], limit: 100 });
          entity = entities.find((e: any) => e.name?.toLowerCase() === options.name?.toLowerCase());
        }
        await cortex.storage.close();
        if (!entity) {
          console.log(chalk.red('Entity not found'));
          return;
        }
        if (format === 'json') {
          console.log(JSON.stringify(entity, null, 2));
        } else {
          console.log(chalk.bold(`\n📦 ${entity.entityType}: ${entity.name}`));
          console.log(chalk.gray('─'.repeat(50)));
          console.log(`  Status: ${entity.status}`);
          console.log(`  Facts:`);
          for (const f of entity.keyFacts || []) {
            console.log(`    • ${f}`);
          }
          if (entity.warnings?.length > 0) {
            console.log(chalk.yellow(`  Warnings:`));
            for (const w of entity.warnings) {
              console.log(chalk.yellow(`    ⚠️ ${w}`));
            }
          }
          console.log();
        }
        break;
      }
      default:
        console.log(chalk.red(`Unknown action: ${action}. Use: create, list, get`));
    }
  } catch (error) {
    if (format === 'json') {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(chalk.red(`Error: ${error}`));
    }
  }
}

/**
 * Env subcommand - manage environment configurations
 */
async function envMemoryAction(
  action: string,
  options: MemoryOptions & {
    name?: string;
    type?: string;
    warnings?: string;
    endpoints?: string;
    id?: string;
  }
): Promise<void> {
  const rootDir = process.cwd();
  const format = options.format ?? 'text';

  try {
    const cortex = await getCortex(rootDir);

    switch (action) {
      case 'create': {
        if (!options.name || !options.type) {
          console.log(chalk.red('Missing required: --name, --type'));
          return;
        }
        const memory = {
          type: 'environment',
          name: options.name,
          environmentType: options.type,
          config: {},
          warnings: options.warnings?.split(',').map(w => w.trim()) || [],
          endpoints: options.endpoints ? JSON.parse(options.endpoints) : {},
          status: 'unknown',
          summary: `🌍 ${options.type}: ${options.name}`,
          confidence: 1.0,
          importance: options.type === 'production' ? 'high' : 'normal',
        };
        const id = await cortex.add(memory as any);
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ success: true, id }));
        } else {
          console.log(chalk.green.bold(`\n✓ Created environment "${options.name}"`));
          console.log(`  ID: ${chalk.cyan(id)}\n`);
        }
        break;
      }
      case 'list': {
        const envs = await cortex.search({ types: ['environment' as any], limit: 50 });
        await cortex.storage.close();
        if (format === 'json') {
          console.log(JSON.stringify({ environments: envs, total: envs.length }, null, 2));
        } else {
          console.log(chalk.bold('\n🌍 Environments'));
          console.log(chalk.gray('─'.repeat(50)));
          if (envs.length === 0) {
            console.log(chalk.yellow('No environments. Create one with: drift memory env create'));
          } else {
            for (const e of envs) {
              const typeColor = e.environmentType === 'production' ? chalk.red : chalk.cyan;
              console.log(`  ${typeColor(`[${e.environmentType}]`.padEnd(14))} ${e.name}`);
            }
          }
          console.log();
        }
        break;
      }
      default:
        console.log(chalk.red(`Unknown action: ${action}. Use: create, list`));
    }
  } catch (error) {
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
    .description('Add a new memory (types: tribal, procedural, pattern_rationale, code_smell, decision_context, constraint_override)')
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
    .command('learn <correction>')
    .description('Learn from a correction (e.g., "Always use bcrypt with cost factor 12")')
    .option('-o, --original <text>', 'What was originally done (optional context)')
    .option('-c, --code <code>', 'Corrected code example')
    .option('--file <file>', 'Related file')
    .action((correction, opts) => learnAction(correction, { ...cmd.opts(), ...opts }));

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

  // ============================================================================
  // Universal Memory Subcommands
  // ============================================================================

  // Agent
  cmd
    .command('agent <action>')
    .description('Manage agent spawn configurations (actions: create, list, get)')
    .option('-n, --name <name>', 'Agent display name')
    .option('-s, --slug <slug>', 'Unique slug for invocation')
    .option('-d, --description <desc>', 'Agent description')
    .option('--system-prompt <prompt>', 'Agent system prompt')
    .option('--tools <tools>', 'Comma-separated list of tools')
    .option('--triggers <triggers>', 'Comma-separated trigger phrases')
    .option('--id <id>', 'Agent ID (for get)')
    .action((action, opts) => agentAction(action, { ...cmd.opts(), ...opts }));

  // Goal
  cmd
    .command('goal <action>')
    .description('Track goals with progress (actions: create, list, update, block, complete)')
    .option('-t, --title <title>', 'Goal title')
    .option('-d, --description <desc>', 'Goal description')
    .option('-p, --parent <id>', 'Parent goal ID')
    .option('--progress <percent>', 'Progress percentage (0-100)')
    .option('--status <status>', 'Status: active, achieved, abandoned, blocked, at_risk')
    .option('--id <id>', 'Goal ID')
    .option('--blocker <text>', 'Blocker description (for block action)')
    .option('--severity <level>', 'Blocker severity: low, medium, high, critical')
    .action((action, opts) => goalAction(action, { ...cmd.opts(), ...opts }));

  // Incident
  cmd
    .command('incident <action>')
    .description('Record and retrieve incident postmortems (actions: record, list, warnings)')
    .option('-t, --title <title>', 'Incident title')
    .option('-s, --severity <level>', 'Severity: low, medium, high, critical')
    .option('--impact <text>', 'Impact description')
    .option('--root-cause <text>', 'Root cause analysis')
    .option('--resolution <text>', 'How it was resolved')
    .option('--lessons <list>', 'Comma-separated lessons learned')
    .option('--triggers <list>', 'Comma-separated warning triggers')
    .option('--id <id>', 'Incident ID')
    .option('-q, --query <text>', 'Query for warnings action')
    .action((action, opts) => incidentAction(action, { ...cmd.opts(), ...opts }));

  // Workflow
  cmd
    .command('workflow <action>')
    .description('Manage step-by-step processes (actions: create, list, run)')
    .option('-n, --name <name>', 'Workflow name')
    .option('-s, --slug <slug>', 'Unique slug')
    .option('-d, --description <desc>', 'Workflow description')
    .option('--steps <steps>', 'Pipe-separated steps (e.g., "Step 1|Step 2|Step 3")')
    .option('--triggers <triggers>', 'Comma-separated trigger phrases')
    .option('--id <id>', 'Workflow ID')
    .action((action, opts) => workflowAction(action, { ...cmd.opts(), ...opts }));

  // Entity
  cmd
    .command('entity <action>')
    .description('Track projects, products, teams (actions: create, list, get)')
    .option('-t, --type <type>', 'Entity type: project, product, team, client, vendor, system, service')
    .option('-n, --name <name>', 'Entity name')
    .option('--facts <facts>', 'Comma-separated key facts')
    .option('--warnings <warnings>', 'Comma-separated warnings')
    .option('--status <status>', 'Status: active, deprecated, planned, archived')
    .option('--id <id>', 'Entity ID')
    .action((action, opts) => entityAction(action, { ...cmd.opts(), ...opts }));

  // Environment (as 'env' subcommand under memory)
  cmd
    .command('env <action>')
    .description('Manage environment configurations (actions: create, list)')
    .option('-n, --name <name>', 'Environment name')
    .option('-t, --type <type>', 'Type: production, staging, development, testing, sandbox')
    .option('--warnings <warnings>', 'Comma-separated warnings')
    .option('--endpoints <json>', 'JSON object of endpoints')
    .option('--id <id>', 'Environment ID')
    .action((action, opts) => envMemoryAction(action, { ...cmd.opts(), ...opts }));

  return cmd;
}
