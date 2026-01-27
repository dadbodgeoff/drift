#!/usr/bin/env npx ts-node
/**
 * Documentation Validator
 * 
 * Validates that CLI commands mentioned in documentation actually exist.
 * Run this in CI to catch documentation drift before it ships.
 * 
 * Usage:
 *   npx ts-node scripts/validate-docs.ts
 *   pnpm run validate-docs
 * 
 * Exit codes:
 *   0 - All commands valid
 *   1 - Invalid commands found
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface ValidationResult {
  file: string;
  line: number;
  command: string;
  valid: boolean;
  suggestion?: string;
}

// Get all valid CLI commands by parsing --help output
function getValidCommands(): Set<string> {
  const commands = new Set<string>();
  
  try {
    // Get main commands
    const helpOutput = execSync('npx driftdetect --help', { 
      encoding: 'utf-8',
      cwd: path.join(__dirname, '..')
    });
    
    // Parse command names from help output
    const commandRegex = /^\s{2}(\w[\w-]*)/gm;
    let match;
    while ((match = commandRegex.exec(helpOutput)) !== null) {
      const cmd = match[1];
      // Filter out noise (examples, descriptions)
      if (!['Options', 'Commands', 'Examples', 'Documentation'].includes(cmd)) {
        commands.add(cmd);
      }
    }
    
    // Add known subcommands for commands that have them
    const subcommandParents = [
      'callgraph', 'boundaries', 'test-topology', 'coupling', 
      'error-handling', 'constraints', 'skills', 'projects',
      'dna', 'env', 'constants', 'gate', 'context', 'telemetry',
      'ts', 'py', 'java', 'php', 'go', 'rust', 'cpp', 'wpf'
    ];
    
    for (const parent of subcommandParents) {
      try {
        const subHelp = execSync(`npx driftdetect ${parent} --help`, {
          encoding: 'utf-8',
          cwd: path.join(__dirname, '..')
        });
        
        // Parse subcommands
        const subRegex = /^\s{2}(\w[\w-]*)/gm;
        while ((match = subRegex.exec(subHelp)) !== null) {
          const sub = match[1];
          if (!['Options', 'Commands', 'Arguments'].includes(sub)) {
            commands.add(`${parent} ${sub}`);
          }
        }
      } catch {
        // Command might not have subcommands
      }
    }
    
  } catch (error) {
    console.error('Failed to get CLI commands:', error);
    process.exit(1);
  }
  
  return commands;
}

// Extract drift commands from markdown files
function extractCommandsFromFile(filePath: string): Array<{ line: number; command: string }> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const commands: Array<{ line: number; command: string }> = [];
  
  // Match patterns like:
  // drift <command>
  // $ drift <command>
  // `drift <command>`
  // npx driftdetect <command>
  const patterns = [
    /(?:^|\s|\$\s*|`)(drift\s+[\w-]+(?:\s+[\w-]+)?)/g,
    /(?:^|\s|\$\s*|`)(npx\s+driftdetect\s+[\w-]+(?:\s+[\w-]+)?)/g,
  ];
  
  lines.forEach((line, index) => {
    // Skip code comments and non-command lines
    if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
      return;
    }
    
    for (const pattern of patterns) {
      let match;
      pattern.lastIndex = 0; // Reset regex state
      while ((match = pattern.exec(line)) !== null) {
        let cmd = match[1]
          .replace(/^(npx\s+driftdetect|drift)\s+/, '') // Remove prefix
          .replace(/\s+<.*$/, '') // Remove arguments like <pattern-id>
          .replace(/\s+\[.*$/, '') // Remove optional args like [options]
          .replace(/\s+--.*$/, '') // Remove flags
          .replace(/\s+".*$/, '') // Remove quoted strings
          .replace(/\s+\$.*$/, '') // Remove variable references
          .replace(/\s+\|.*$/, '') // Remove pipes
          .trim();
        
        if (cmd && cmd.length > 0 && !cmd.includes('`')) {
          commands.push({ line: index + 1, command: cmd });
        }
      }
    }
  });
  
  return commands;
}

// Validate a command against known commands
function validateCommand(command: string, validCommands: Set<string>): { valid: boolean; suggestion?: string } {
  // Direct match
  if (validCommands.has(command)) {
    return { valid: true };
  }
  
  // Check if it's a valid parent command (e.g., "callgraph" without subcommand)
  const parts = command.split(' ');
  if (parts.length === 1 && validCommands.has(parts[0])) {
    return { valid: true };
  }
  
  // Check parent + subcommand
  if (parts.length >= 2) {
    const parentSub = `${parts[0]} ${parts[1]}`;
    if (validCommands.has(parentSub)) {
      return { valid: true };
    }
    // Parent exists but subcommand doesn't
    if (validCommands.has(parts[0])) {
      // Find similar subcommands
      const similar = Array.from(validCommands)
        .filter(c => c.startsWith(parts[0] + ' '))
        .map(c => c.split(' ')[1]);
      if (similar.length > 0) {
        return { 
          valid: false, 
          suggestion: `Valid subcommands for '${parts[0]}': ${similar.join(', ')}`
        };
      }
    }
  }
  
  // Find similar commands
  const similar = Array.from(validCommands)
    .filter(c => c.includes(command) || command.includes(c.split(' ')[0]))
    .slice(0, 3);
  
  if (similar.length > 0) {
    return { valid: false, suggestion: `Did you mean: ${similar.join(', ')}?` };
  }
  
  return { valid: false };
}

async function main() {
  console.log('🔍 Validating documentation against CLI commands...\n');
  
  // Get valid commands
  console.log('Loading valid CLI commands...');
  const validCommands = getValidCommands();
  console.log(`Found ${validCommands.size} valid commands/subcommands\n`);
  
  // Find all markdown files
  const docsDir = path.join(__dirname, '..');
  const patterns = [
    'wiki/**/*.md',
    'README.md',
    'docs/**/*.md',
  ];
  
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: docsDir });
    files.push(...matches.map(f => path.join(docsDir, f)));
  }
  
  console.log(`Scanning ${files.length} documentation files...\n`);
  
  // Validate each file
  const results: ValidationResult[] = [];
  const seenCommands = new Set<string>();
  
  for (const file of files) {
    const commands = extractCommandsFromFile(file);
    const relativePath = path.relative(docsDir, file);
    
    for (const { line, command } of commands) {
      // Skip duplicates within same file
      const key = `${file}:${command}`;
      if (seenCommands.has(key)) continue;
      seenCommands.add(key);
      
      const { valid, suggestion } = validateCommand(command, validCommands);
      
      if (!valid) {
        results.push({
          file: relativePath,
          line,
          command,
          valid: false,
          suggestion,
        });
      }
    }
  }
  
  // Report results
  if (results.length === 0) {
    console.log('✅ All documented commands are valid!\n');
    process.exit(0);
  }
  
  console.log(`❌ Found ${results.length} invalid command reference(s):\n`);
  
  // Group by file
  const byFile = new Map<string, ValidationResult[]>();
  for (const result of results) {
    const existing = byFile.get(result.file) || [];
    existing.push(result);
    byFile.set(result.file, existing);
  }
  
  for (const [file, fileResults] of byFile) {
    console.log(`📄 ${file}`);
    for (const result of fileResults) {
      console.log(`   Line ${result.line}: 'drift ${result.command}'`);
      if (result.suggestion) {
        console.log(`   └─ ${result.suggestion}`);
      }
    }
    console.log();
  }
  
  console.log('Run with --fix to see suggested corrections.\n');
  process.exit(1);
}

main().catch(console.error);
