/**
 * Safety Interlock Extractor
 * 
 * CRITICAL: Detects safety-related patterns in IEC 61131-3 code.
 * Zero tolerance for false negatives on bypass detection.
 * 
 * Detects:
 * - Safety interlocks (bIL_, IL_, Interlock)
 * - Permissives
 * - E-Stop signals
 * - Safety relays and devices
 * - BYPASS CONDITIONS (CRITICAL)
 */

import type {
  SafetyInterlock,
  SafetyBypass,
  SafetyAnalysisResult,
  SafetyCriticalWarning,
  SafetySummary,
  SafetyInterlockType,
  SafetySeverity,
} from '../types.js';
import { generateId } from '../utils/id-generator.js';

// ============================================================================
// EXTRACTION RESULT
// ============================================================================

export interface SafetyExtractionResult extends SafetyAnalysisResult {
  file: string;
}

export interface SafetyExtractionOptions {
  strict?: boolean;
  customPatterns?: SafetyPattern[];
}

interface SafetyPattern {
  pattern: RegExp;
  type: SafetyInterlockType;
  confidence: number;
}

// ============================================================================
// PATTERNS - COMPREHENSIVE SAFETY DETECTION
// ============================================================================

// Interlock patterns - HIGH CONFIDENCE
const INTERLOCK_PATTERNS: SafetyPattern[] = [
  // Standard IEC patterns - case insensitive
  { pattern: /\b(bIL_\w+)\b/gi, type: 'interlock', confidence: 0.95 },
  { pattern: /\b(IL_\w+)\b/gi, type: 'interlock', confidence: 0.90 },
  { pattern: /\b(b?Interlock\w*)\b/gi, type: 'interlock', confidence: 0.85 },
  { pattern: /\b(\w*_Interlock\w*)\b/gi, type: 'interlock', confidence: 0.85 },
  { pattern: /\b(b?SafetyInterlock\w*)\b/gi, type: 'interlock', confidence: 0.90 },
  
  // Permissive patterns
  { pattern: /\b(b?Permissive\w*)\b/gi, type: 'permissive', confidence: 0.85 },
  { pattern: /\b(bPerm_\w+)\b/gi, type: 'permissive', confidence: 0.90 },
  { pattern: /\b(\w*Permit\w*)\b/gi, type: 'permissive', confidence: 0.80 },
  
  // E-Stop patterns
  { pattern: /\b(b?EStop\w*)\b/gi, type: 'estop', confidence: 0.95 },
  { pattern: /\b(b?E_Stop\w*)\b/gi, type: 'estop', confidence: 0.95 },
  { pattern: /\b(b?EmergencyStop\w*)\b/gi, type: 'estop', confidence: 0.95 },
  { pattern: /\b(bES_\w+)\b/gi, type: 'estop', confidence: 0.90 },
  { pattern: /\b(\w*Emergency\w*Stop\w*)\b/gi, type: 'estop', confidence: 0.90 },
  
  // Safety relay patterns
  { pattern: /\b(b?SafetyRelay\w*)\b/gi, type: 'safety-relay', confidence: 0.90 },
  { pattern: /\b(SR_\w+)\b/gi, type: 'safety-relay', confidence: 0.85 },
  { pattern: /\b(bSR_\w+)\b/gi, type: 'safety-relay', confidence: 0.90 },
  
  // Safety device patterns
  { pattern: /\b(b?LightCurtain\w*)\b/gi, type: 'safety-device', confidence: 0.85 },
  { pattern: /\b(LC_\w+)\b/gi, type: 'safety-device', confidence: 0.85 },
  { pattern: /\b(b?SafetyMat\w*)\b/gi, type: 'safety-device', confidence: 0.85 },
  { pattern: /\b(b?GuardDoor\w*)\b/gi, type: 'safety-device', confidence: 0.85 },
  { pattern: /\b(b?SafetyGate\w*)\b/gi, type: 'safety-device', confidence: 0.85 },
  
  // Generic safety patterns (Siemens/Rockwell style)
  { pattern: /\b(i_b\w*Safety\w*)\b/gi, type: 'interlock', confidence: 0.85 },
  { pattern: /\b(o_b\w*Safety\w*)\b/gi, type: 'interlock', confidence: 0.85 },
  { pattern: /\b(b?SafetyChain\w*)\b/gi, type: 'interlock', confidence: 0.90 },
  { pattern: /\b(Safety_\w+)\b/gi, type: 'interlock', confidence: 0.80 },
  { pattern: /\b(\w*_Safety\w*)\b/gi, type: 'interlock', confidence: 0.75 },
];

// BYPASS PATTERNS - CRITICAL - ZERO FALSE NEGATIVES
const BYPASS_PATTERNS: SafetyPattern[] = [
  // Explicit bypass patterns
  { pattern: /\b(bDbg_SkipIL)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bDbg_Skip\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bDebug_Bypass\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bDbgBypass\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bDbg_Override\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(BypassInterlock\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(IL_Bypass\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(SkipSafety\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(Debug_NoIL\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bSkip_IL\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  
  // Generic bypass patterns - CRITICAL
  { pattern: /\b(bBypass\w*)\b/gi, type: 'bypass', confidence: 0.95 },
  { pattern: /\b(\w*Bypass\w*)\b/gi, type: 'bypass', confidence: 0.85 },
  { pattern: /\b(bypass_\w+)\b/gi, type: 'bypass', confidence: 0.95 },
  
  // Skip patterns - CRITICAL
  { pattern: /\b(bSkip\w*)\b/gi, type: 'bypass', confidence: 0.90 },
  { pattern: /\b(skip_\w+)\b/gi, type: 'bypass', confidence: 0.90 },
  { pattern: /\b(bSkipSafety\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bSkipInterlock\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bSkipCheck\w*)\b/gi, type: 'bypass', confidence: 0.90 },
  
  // Override patterns - CRITICAL
  { pattern: /\b(bOverride\w*)\b/gi, type: 'bypass', confidence: 0.90 },
  { pattern: /\b(override_\w+)\b/gi, type: 'bypass', confidence: 0.90 },
  { pattern: /\b(bOverrideSafety\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bSafetyOverride\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bOverride_IL\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  
  // Disable patterns - CRITICAL
  { pattern: /\b(bDisable\w*)\b/gi, type: 'bypass', confidence: 0.90 },
  { pattern: /\b(disable_\w+)\b/gi, type: 'bypass', confidence: 0.90 },
  { pattern: /\b(bDisableSafety\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bSafetyDisable\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bDisable_IL\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(disable_interlock\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  
  // Force patterns - CRITICAL
  { pattern: /\b(bForce\w*)\b/gi, type: 'bypass', confidence: 0.85 },
  { pattern: /\b(force_\w+)\b/gi, type: 'bypass', confidence: 0.85 },
  { pattern: /\b(bForceSafety\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bForce_IL\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bForceInterlock\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(force_safety_ok\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  
  // Test/simulation mode patterns (often bypass safety)
  { pattern: /\b(bTestMode)\b/gi, type: 'bypass', confidence: 0.80 },
  { pattern: /\b(bSimulation)\b/gi, type: 'bypass', confidence: 0.80 },
  { pattern: /\b(bDebugMode)\b/gi, type: 'bypass', confidence: 0.85 },
  { pattern: /\b(bMaintenanceMode)\b/gi, type: 'bypass', confidence: 0.75 },
  
  // Maintenance/Service patterns - CRITICAL
  { pattern: /\b(bMaintBypass\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bMaint\w*Bypass\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bServiceBypass\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bService\w*Bypass\w*)\b/gi, type: 'bypass', confidence: 1.0 },
  { pattern: /\b(bCommissioningMode\w*)\b/gi, type: 'bypass', confidence: 0.85 },
  
  // Abbreviations that might slip through
  { pattern: /\b(bDbgSkpIL)\b/gi, type: 'bypass', confidence: 0.95 },
  { pattern: /\b(bSkpIntlk)\b/gi, type: 'bypass', confidence: 0.95 },
];

// Bypass context patterns - detect bypass via assignment
const BYPASS_CONTEXT_PATTERNS = [
  /IF\s+\w*[Bb]ypass\w*\s+(?:OR|THEN)/gi,
  /IF\s+\w*[Dd]ebug\w*\s+(?:OR|THEN)/gi,
  /IF\s+\w*[Tt]est\w*\s+(?:OR|THEN)/gi,
  /NOT\s+\w*[Ii]nterlock\w*\s+OR\s+\w*[Bb]ypass/gi,
  /:=\s*FALSE\s*;\s*\(\*.*[Bb]ypass/gi,
];

// ============================================================================
// EXTRACTOR
// ============================================================================

export function extractSafetyInterlocks(
  source: string,
  filePath: string,
  options: SafetyExtractionOptions = {}
): SafetyExtractionResult {
  const { customPatterns = [] } = options;

  const interlocks: SafetyInterlock[] = [];
  const bypasses: SafetyBypass[] = [];
  const criticalWarnings: SafetyCriticalWarning[] = [];
  const seen = new Set<string>();

  // Combine patterns
  const allInterlockPatterns = [...INTERLOCK_PATTERNS, ...customPatterns.filter(p => p.type !== 'bypass')];
  const allBypassPatterns = [...BYPASS_PATTERNS, ...customPatterns.filter(p => p.type === 'bypass')];

  // First pass: Find all bypass variables
  const bypassVars = new Set<string>();
  for (const { pattern } of allBypassPatterns) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      bypassVars.add(match[1]!.toLowerCase());
    }
  }

  // Check for bypass context patterns
  for (const pattern of BYPASS_CONTEXT_PATTERNS) {
    if (pattern.test(source)) {
      const match = source.match(pattern);
      if (match) {
        criticalWarnings.push({
          type: 'bypass-detected',
          message: `Potential safety bypass pattern detected: ${match[0].slice(0, 50)}`,
          severity: 'critical',
          location: {
            file: filePath,
            line: getLineNumber(source, source.indexOf(match[0])),
            column: 1,
          },
          remediation: 'Review this code path for safety bypass conditions',
        });
      }
    }
  }

  // Extract interlocks
  for (const { pattern, type, confidence } of allInterlockPatterns) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[1]!;
      const nameLower = name.toLowerCase();
      
      if (seen.has(nameLower)) continue;
      seen.add(nameLower);

      const line = getLineNumber(source, match.index);
      const isBypassed = bypassVars.has(nameLower) || isUsedWithBypass(name, source);
      const severity = determineSeverity(type, isBypassed);

      const interlock: SafetyInterlock = {
        id: generateId(),
        name,
        type,
        location: {
          file: filePath,
          line,
          column: match.index - source.lastIndexOf('\n', match.index),
        },
        pouId: null,
        isBypassed,
        bypassCondition: isBypassed ? findBypassCondition(name, source) : null,
        confidence,
        severity,
        relatedInterlocks: findRelatedInterlocks(name, source),
      };

      interlocks.push(interlock);

      // Add warning if bypassed
      if (isBypassed) {
        criticalWarnings.push({
          type: 'bypass-detected',
          message: `Safety interlock '${name}' may be bypassed`,
          severity: 'critical',
          location: interlock.location,
          remediation: 'Review bypass conditions and ensure proper safety measures',
        });
      }
    }
  }

  // Extract bypass variables as separate entries
  for (const { pattern } of allBypassPatterns) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(source)) !== null) {
      const name = match[1]!;
      const nameLower = name.toLowerCase();
      
      if (seen.has(nameLower)) continue;
      seen.add(nameLower);

      const line = getLineNumber(source, match.index);
      const affectedInterlocks = findAffectedInterlocks(name, source, interlocks);

      const bypass: SafetyBypass = {
        id: generateId(),
        name,
        location: {
          file: filePath,
          line,
          column: match.index - source.lastIndexOf('\n', match.index),
        },
        pouId: null,
        affectedInterlocks,
        condition: findBypassUsageCondition(name, source),
        severity: 'critical',
      };

      bypasses.push(bypass);

      // Always add critical warning for bypass variables
      criticalWarnings.push({
        type: 'bypass-detected',
        message: `⚠️ SAFETY BYPASS VARIABLE DETECTED: ${name}`,
        severity: 'critical',
        location: bypass.location,
        remediation: 'This variable can bypass safety interlocks. Review immediately.',
      });
    }
  }

  // Calculate summary
  const summary = calculateSummary(interlocks, bypasses, criticalWarnings);

  return {
    file: filePath,
    interlocks,
    bypasses,
    criticalWarnings,
    summary,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isUsedWithBypass(name: string, source: string): boolean {
  const bypassContexts = [
    new RegExp(`\\w*[Bb]ypass\\w*\\s+OR\\s+${escapeRegex(name)}`, 'gi'),
    new RegExp(`${escapeRegex(name)}\\s+OR\\s+\\w*[Bb]ypass\\w*`, 'gi'),
    new RegExp(`NOT\\s+${escapeRegex(name)}\\s+OR\\s+\\w*[Bb]ypass`, 'gi'),
    new RegExp(`\\w*[Dd]ebug\\w*\\s+OR\\s+${escapeRegex(name)}`, 'gi'),
    new RegExp(`${escapeRegex(name)}\\s+OR\\s+\\w*[Dd]ebug\\w*`, 'gi'),
  ];
  
  return bypassContexts.some(pattern => pattern.test(source));
}

function findBypassCondition(name: string, source: string): string | null {
  // Look for patterns like "IF bBypass OR bIL_Air THEN"
  const patterns = [
    new RegExp(`IF\\s+(\\w*[Bb]ypass\\w*\\s+OR\\s+${escapeRegex(name)})\\s+THEN`, 'gi'),
    new RegExp(`IF\\s+(${escapeRegex(name)}\\s+OR\\s+\\w*[Bb]ypass\\w*)\\s+THEN`, 'gi'),
    new RegExp(`IF\\s+(NOT\\s+${escapeRegex(name)}\\s+OR\\s+\\w*[Bb]ypass\\w*)\\s+THEN`, 'gi'),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return match[1] || null;
    }
  }

  return null;
}

function findBypassUsageCondition(bypassName: string, source: string): string | null {
  // Find how the bypass variable is used
  const pattern = new RegExp(`IF\\s+([^;]*${escapeRegex(bypassName)}[^;]*)\\s+THEN`, 'gi');
  const match = source.match(pattern);
  return match ? match[1]?.trim() || null : null;
}

function findRelatedInterlocks(name: string, source: string): string[] {
  const related: string[] = [];
  
  // Look for interlocks used in the same IF statement
  const ifPattern = new RegExp(`IF\\s+[^;]*${escapeRegex(name)}[^;]*THEN`, 'gi');
  const matches = source.match(ifPattern);
  
  if (matches) {
    for (const match of matches) {
      // Extract other interlock names from the condition
      const interlockPattern = /\b(bIL_\w+|IL_\w+|b?Interlock\w*)\b/gi;
      let ilMatch: RegExpExecArray | null;
      
      while ((ilMatch = interlockPattern.exec(match)) !== null) {
        const ilName = ilMatch[1]!;
        if (ilName.toLowerCase() !== name.toLowerCase() && !related.includes(ilName)) {
          related.push(ilName);
        }
      }
    }
  }

  return related;
}

function findAffectedInterlocks(
  bypassName: string, 
  source: string,
  interlocks: SafetyInterlock[]
): string[] {
  const affected: string[] = [];
  
  // Check which interlocks are used with this bypass
  for (const il of interlocks) {
    const pattern = new RegExp(
      `(${escapeRegex(bypassName)}\\s+OR\\s+${escapeRegex(il.name)}|${escapeRegex(il.name)}\\s+OR\\s+${escapeRegex(bypassName)})`,
      'gi'
    );
    if (pattern.test(source)) {
      affected.push(il.name);
    }
  }

  return affected;
}

function determineSeverity(type: SafetyInterlockType, isBypassed: boolean): SafetySeverity {
  if (isBypassed) return 'critical';
  
  switch (type) {
    case 'estop':
      return 'critical';
    case 'interlock':
    case 'safety-relay':
      return 'high';
    case 'permissive':
    case 'safety-device':
      return 'medium';
    case 'bypass':
      return 'critical';
    default:
      return 'medium';
  }
}

function calculateSummary(
  interlocks: SafetyInterlock[],
  bypasses: SafetyBypass[],
  warnings: SafetyCriticalWarning[]
): SafetySummary {
  const byType: Record<SafetyInterlockType, number> = {
    'interlock': 0,
    'permissive': 0,
    'estop': 0,
    'safety-relay': 0,
    'safety-device': 0,
    'bypass': 0,
  };

  for (const il of interlocks) {
    byType[il.type]++;
  }
  byType['bypass'] = bypasses.length;

  return {
    totalInterlocks: interlocks.length,
    byType,
    bypassCount: bypasses.length,
    criticalWarningCount: warnings.filter(w => w.severity === 'critical').length,
  };
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function extractSafetyFromFiles(
  files: Array<{ path: string; content: string }>,
  options?: SafetyExtractionOptions
): SafetyAnalysisResult {
  const allInterlocks: SafetyInterlock[] = [];
  const allBypasses: SafetyBypass[] = [];
  const allWarnings: SafetyCriticalWarning[] = [];

  for (const file of files) {
    const result = extractSafetyInterlocks(file.content, file.path, options);
    allInterlocks.push(...result.interlocks);
    allBypasses.push(...result.bypasses);
    allWarnings.push(...result.criticalWarnings);
  }

  const summary: SafetySummary = {
    totalInterlocks: allInterlocks.length,
    byType: {
      'interlock': allInterlocks.filter(i => i.type === 'interlock').length,
      'permissive': allInterlocks.filter(i => i.type === 'permissive').length,
      'estop': allInterlocks.filter(i => i.type === 'estop').length,
      'safety-relay': allInterlocks.filter(i => i.type === 'safety-relay').length,
      'safety-device': allInterlocks.filter(i => i.type === 'safety-device').length,
      'bypass': allBypasses.length,
    },
    bypassCount: allBypasses.length,
    criticalWarningCount: allWarnings.filter(w => w.severity === 'critical').length,
  };

  return {
    interlocks: allInterlocks,
    bypasses: allBypasses,
    criticalWarnings: allWarnings,
    summary,
  };
}
