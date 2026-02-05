/**
 * Safety Interlock Extractor
 * 
 * Single responsibility: Extract safety-related patterns
 */

import type { SafetyInterlock } from '../types.js';

// ============================================================================
// Patterns
// ============================================================================

const INTERLOCK_PATTERNS = [
  { pattern: /\b(bIL_\w+)\b/g, type: 'interlock' as const },
  { pattern: /\b(IL_\w+)\b/g, type: 'interlock' as const },
  { pattern: /\b(b?Interlock\w*)\b/gi, type: 'interlock' as const },
  { pattern: /\b(b?Permissive\w*)\b/gi, type: 'permissive' as const },
  { pattern: /\b(b?EStop\w*|E_Stop\w*|EmergencyStop\w*)\b/gi, type: 'estop' as const },
];

const BYPASS_PATTERNS = [
  /\b(bDbg_SkipIL)\b/gi,
  /\b(BypassInterlock\w*)\b/gi,
  /\b(IL_Bypass\w*)\b/gi,
  /\b(bBypass\w*)\b/gi,
  /\b(SkipSafety\w*)\b/gi,
];

// ============================================================================
// Extractor
// ============================================================================

export function extractSafetyInterlocks(source: string): SafetyInterlock[] {
  const interlocks: SafetyInterlock[] = [];
  const seen = new Set<string>();

  // Find all bypass variables first
  const bypassVars = new Set<string>();
  for (const pattern of BYPASS_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(source)) !== null) {
      bypassVars.add(match[1]!.toLowerCase());
    }
  }

  // Extract interlocks
  for (const { pattern, type } of INTERLOCK_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[1]!;
      const nameLower = name.toLowerCase();
      
      // Skip if already seen
      if (seen.has(nameLower)) continue;
      seen.add(nameLower);

      const line = getLineNumber(source, match.index);
      const isBypassed = bypassVars.has(nameLower) || isUsedWithBypass(name, source);

      interlocks.push({
        name,
        type,
        line,
        isBypassed,
      });
    }
  }

  // Add bypass variables as their own entries
  for (const pattern of BYPASS_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[1]!;
      const nameLower = name.toLowerCase();
      
      if (seen.has(nameLower)) continue;
      seen.add(nameLower);

      const line = getLineNumber(source, match.index);

      interlocks.push({
        name,
        type: 'bypass',
        line,
        isBypassed: true,
      });
    }
  }

  return interlocks;
}

// ============================================================================
// Utilities
// ============================================================================

function isUsedWithBypass(name: string, source: string): boolean {
  // Check if the interlock is used in a bypass context
  // e.g., "IF bDbg_SkipIL OR bIL_Air THEN" or "NOT bIL_Air"
  const bypassContexts = [
    new RegExp(`bDbg_SkipIL\\s+OR\\s+${name}`, 'gi'),
    new RegExp(`${name}\\s+OR\\s+bDbg_SkipIL`, 'gi'),
    new RegExp(`NOT\\s+${name}\\s+OR\\s+bBypass`, 'gi'),
  ];
  
  return bypassContexts.some(pattern => pattern.test(source));
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}
