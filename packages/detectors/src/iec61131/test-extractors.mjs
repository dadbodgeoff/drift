/**
 * Quick test script for IEC 61131-3 extractors
 * Run with: node packages/detectors/src/iec61131/test-extractors.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simple implementations of the extractors for testing (copy the logic)

// ============================================================================
// Docstring Extractor
// ============================================================================

function extractDocstrings(source) {
  const docstrings = [];
  // Match both (* ... *) and (****...*****) style comments
  const docPattern = /\(\*+\s*\n?([\s\S]*?)\*+\)/g;
  let match;

  while ((match = docPattern.exec(source)) !== null) {
    const content = match[1];
    const line = source.slice(0, match.index).split('\n').length;
    const endLine = source.slice(0, match.index + match[0].length).split('\n').length;

    // Skip single-line inline comments
    if (!content.includes('\n') && content.length < 100) continue;

    // Parse the docstring content
    const parsed = parseDocstringContent(content);
    
    // Find associated block
    const afterDoc = source.slice(match.index + match[0].length);
    const blockMatch = afterDoc.match(/^\s*(FUNCTION_BLOCK|PROGRAM|FUNCTION)\s+(\w+)/i);
    
    docstrings.push({
      ...parsed,
      line,
      endLine,
      associatedBlock: blockMatch ? blockMatch[2] : undefined,
    });
  }

  return docstrings;
}

function parseDocstringContent(content) {
  const lines = content.split('\n').map(l => l.replace(/^\s*\*?\s?/, ''));
  
  let summary = '';
  const params = [];
  const history = [];
  const warnings = [];
  let returns = undefined;

  for (const line of lines) {
    if (line.startsWith('@param')) {
      const paramMatch = line.match(/@param\s+(\w+)\s*[-:]?\s*(.*)/);
      if (paramMatch) {
        params.push({ name: paramMatch[1], description: paramMatch[2] || '' });
      }
    } else if (line.startsWith('@returns') || line.startsWith('@return')) {
      const returnMatch = line.match(/@returns?\s+(.*)/);
      if (returnMatch) returns = returnMatch[1];
    } else if (line.match(/^\d{4}-\d{2}-\d{2}/)) {
      history.push(line);
    } else if (line.toUpperCase().includes('WARNING') || line.toUpperCase().includes('CAUTION')) {
      warnings.push(line);
    } else if (!summary && line.trim() && !line.startsWith('@') && !line.startsWith('HISTORY')) {
      summary = line.trim();
    }
  }

  return { summary, params, returns, history, warnings };
}

// ============================================================================
// Safety Extractor
// ============================================================================

const INTERLOCK_PATTERNS = [
  { pattern: /\b(bIL_\w+)\b/g, type: 'interlock' },
  { pattern: /\b(IL_\w+)\b/g, type: 'interlock' },
  { pattern: /\b(b?Interlock\w*)\b/gi, type: 'interlock' },
  { pattern: /\b(b?Permissive\w*)\b/gi, type: 'permissive' },
  { pattern: /\b(b?EStop\w*|E_Stop\w*|EmergencyStop\w*)\b/gi, type: 'estop' },
];

const BYPASS_PATTERNS = [
  /\b(bDbg_SkipIL)\b/gi,
  /\b(BypassInterlock\w*)\b/gi,
  /\b(IL_Bypass\w*)\b/gi,
  /\b(bBypass\w*)\b/gi,
  /\b(SkipSafety\w*)\b/gi,
];

function extractSafetyInterlocks(source) {
  const interlocks = [];
  const seen = new Set();

  // Find all bypass variables first
  const bypassVars = new Set();
  for (const pattern of BYPASS_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(source)) !== null) {
      bypassVars.add(match[1].toLowerCase());
    }
  }

  // Extract interlocks
  for (const { pattern, type } of INTERLOCK_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[1];
      const nameLower = name.toLowerCase();
      
      if (seen.has(nameLower)) continue;
      seen.add(nameLower);

      const line = source.slice(0, match.index).split('\n').length;
      const isBypassed = bypassVars.has(nameLower);

      interlocks.push({ name, type, line, isBypassed });
    }
  }

  // Add bypass variables
  for (const pattern of BYPASS_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[1];
      const nameLower = name.toLowerCase();
      
      if (seen.has(nameLower)) continue;
      seen.add(nameLower);

      const line = source.slice(0, match.index).split('\n').length;
      interlocks.push({ name, type: 'bypass', line, isBypassed: true });
    }
  }

  return interlocks;
}

// ============================================================================
// Tribal Knowledge Extractor
// ============================================================================

const TRIBAL_PATTERNS = [
  { pattern: /WARNING[:\s]+(.*)/gi, type: 'warning' },
  { pattern: /CAUTION[:\s]+(.*)/gi, type: 'caution' },
  { pattern: /NOTE[:\s]+(.*)/gi, type: 'note' },
  { pattern: /TODO[:\s]+(.*)/gi, type: 'todo' },
  { pattern: /HACK[:\s]+(.*)/gi, type: 'hack' },
  { pattern: /WORKAROUND[:\s]+(.*)/gi, type: 'workaround' },
  { pattern: /DO NOT (CHANGE|MODIFY|REMOVE|DELETE)[^*\n]*/gi, type: 'do-not-change' },
  { pattern: /MAGIC NUMBER[:\s]+(.*)/gi, type: 'magic-number' },
  { pattern: /(\d{4}-\d{2}-\d{2})\s+(\w+)[:\s]+(.*)/g, type: 'history' },
];

function extractTribalKnowledge(source, file) {
  const knowledge = [];
  const lines = source.split('\n');

  for (const { pattern, type } of TRIBAL_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      const content = match[0];
      
      // Get surrounding context
      const startLine = Math.max(0, line - 3);
      const endLine = Math.min(lines.length, line + 3);
      const context = lines.slice(startLine, endLine).join('\n');

      knowledge.push({ type, content, line, context, file });
    }
  }

  return knowledge;
}

// ============================================================================
// State Machine Extractor
// ============================================================================

const STATE_VAR_PATTERNS = [
  /^n?state$/i,
  /^i?step$/i,
  /^n?mode$/i,
  /^n?phase$/i,
  /^seq/i,
  /state$/i,
  /step$/i,
];

function extractStateMachines(source) {
  const machines = [];
  const casePattern = /CASE\s+(\w+)\s+OF/gi;
  let match;

  while ((match = casePattern.exec(source)) !== null) {
    const variable = match[1];
    
    // Only process if it looks like a state variable
    if (!STATE_VAR_PATTERNS.some(p => p.test(variable))) continue;

    const line = source.slice(0, match.index).split('\n').length;
    
    // Extract states from CASE body
    const afterCase = source.slice(match.index);
    const endMatch = afterCase.match(/END_CASE/i);
    const caseBody = endMatch ? afterCase.slice(0, endMatch.index) : afterCase.slice(0, 2000);
    
    const states = [];
    // Only match state labels at the start of a line (with optional whitespace)
    // State labels are: number followed by colon, or identifier followed by colon
    // But NOT assignments like "nState := 10;"
    const statePattern = /^\s*(\d+)\s*:/gm;
    let stateMatch;
    
    while ((stateMatch = statePattern.exec(caseBody)) !== null) {
      const rawValue = stateMatch[1];
      const value = parseInt(rawValue, 10);
      const stateLine = source.slice(0, match.index).split('\n').length + 
                        caseBody.slice(0, stateMatch.index).split('\n').length - 1;
      const lineContent = caseBody.split('\n')[caseBody.slice(0, stateMatch.index).split('\n').length - 1] || '';
      const hasComment = lineContent.includes('(*');
      
      states.push({ value, line: stateLine, hasComment });
    }

    machines.push({
      variable,
      stateCount: states.length,
      states,
      line,
    });
  }

  return machines;
}

// ============================================================================
// Run Tests
// ============================================================================

console.log('='.repeat(70));
console.log('IEC 61131-3 Extractor Tests');
console.log('='.repeat(70));

// Test with sample code
const testCode = `
(*
 * FB_Motor - Standard motor control block
 * 
 * @param bStart - Start command
 * @param bStop - Stop command
 * @returns bRunning - Motor running status
 * 
 * HISTORY:
 * 1989-03-15 JSmith: Initial version
 * 2005-08-22 MJones: Added thermal protection
 *)
FUNCTION_BLOCK FB_Motor
VAR_INPUT
    bStart : BOOL;
    bStop : BOOL;
END_VAR
VAR_OUTPUT
    bRunning : BOOL;
END_VAR
VAR
    bIL_MotorOK : BOOL;  (* Interlock - motor healthy *)
    bDbg_SkipIL : BOOL;  (* DEBUG: Skip interlocks - REMOVE IN PRODUCTION *)
    nState : INT;
END_VAR

(* WARNING: Do not change timing without consulting plant engineer *)
IF bDbg_SkipIL OR bIL_MotorOK THEN
    CASE nState OF
        0: (* Idle *)
            IF bStart THEN nState := 10; END_IF;
        10: (* Starting *)
            nState := 20;
        20: (* Running *)
            bRunning := TRUE;
            IF bStop THEN nState := 30; END_IF;
        30: (* Stopping *)
            bRunning := FALSE;
            nState := 0;
    END_CASE;
END_IF;

END_FUNCTION_BLOCK
`;

console.log('\n--- Docstrings ---');
const docs = extractDocstrings(testCode);
console.log(`Found ${docs.length} docstring(s)`);
for (const doc of docs) {
  console.log(`  Line ${doc.line}: "${doc.summary}" (block: ${doc.associatedBlock || 'none'})`);
  console.log(`    Params: ${doc.params.map(p => p.name).join(', ') || 'none'}`);
  console.log(`    History entries: ${doc.history.length}`);
  console.log(`    Warnings: ${doc.warnings.length}`);
}

console.log('\n--- Safety Interlocks ---');
const safety = extractSafetyInterlocks(testCode);
console.log(`Found ${safety.length} interlock(s)`);
for (const il of safety) {
  console.log(`  Line ${il.line}: ${il.name} (${il.type})${il.isBypassed ? ' [BYPASSED]' : ''}`);
}

console.log('\n--- Tribal Knowledge ---');
const tribal = extractTribalKnowledge(testCode, 'test.st');
console.log(`Found ${tribal.length} item(s)`);
for (const item of tribal) {
  console.log(`  Line ${item.line}: [${item.type}] ${item.content.slice(0, 60)}...`);
}

console.log('\n--- State Machines ---');
const stateMachines = extractStateMachines(testCode);
console.log(`Found ${stateMachines.length} state machine(s)`);
for (const sm of stateMachines) {
  console.log(`  Line ${sm.line}: ${sm.variable} with ${sm.stateCount} states`);
  for (const state of sm.states) {
    console.log(`    State ${state.value} at line ${state.line}${state.hasComment ? ' (documented)' : ''}`);
  }
}

// Test with real file if available
console.log('\n' + '='.repeat(70));
console.log('Testing with LEGACY_BATCH_SYSTEM.st');
console.log('='.repeat(70));

try {
  const legacyPath = join(__dirname, '../../../../../samples/iec61131/factory/LEGACY_BATCH_SYSTEM.st');
  const legacyCode = readFileSync(legacyPath, 'utf-8');
  
  console.log(`\nFile size: ${legacyCode.length} characters, ${legacyCode.split('\n').length} lines`);
  
  const legacyDocs = extractDocstrings(legacyCode);
  console.log(`\nDocstrings: ${legacyDocs.length}`);
  for (const doc of legacyDocs.slice(0, 5)) {
    console.log(`  - ${doc.associatedBlock || 'standalone'}: "${doc.summary?.slice(0, 50)}..."`);
  }
  if (legacyDocs.length > 5) console.log(`  ... and ${legacyDocs.length - 5} more`);
  
  const legacySafety = extractSafetyInterlocks(legacyCode);
  console.log(`\nSafety Interlocks: ${legacySafety.length}`);
  const byType = {};
  for (const il of legacySafety) {
    byType[il.type] = (byType[il.type] || 0) + 1;
  }
  console.log(`  By type: ${JSON.stringify(byType)}`);
  const bypassed = legacySafety.filter(il => il.isBypassed);
  if (bypassed.length > 0) {
    console.log(`  BYPASSED: ${bypassed.map(il => il.name).join(', ')}`);
  }
  
  const legacyTribal = extractTribalKnowledge(legacyCode, 'LEGACY_BATCH_SYSTEM.st');
  console.log(`\nTribal Knowledge: ${legacyTribal.length}`);
  const tribalByType = {};
  for (const item of legacyTribal) {
    tribalByType[item.type] = (tribalByType[item.type] || 0) + 1;
  }
  console.log(`  By type: ${JSON.stringify(tribalByType)}`);
  
  const legacySM = extractStateMachines(legacyCode);
  console.log(`\nState Machines: ${legacySM.length}`);
  for (const sm of legacySM) {
    console.log(`  - ${sm.variable}: ${sm.stateCount} states`);
  }
  
} catch (err) {
  console.log(`Could not read LEGACY_BATCH_SYSTEM.st: ${err.message}`);
}

console.log('\n' + '='.repeat(70));
console.log('All tests completed!');
console.log('='.repeat(70));
