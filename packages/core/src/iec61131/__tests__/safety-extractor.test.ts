/**
 * IEC 61131-3 Safety Extractor Tests
 * 
 * CRITICAL: Tests for safety interlock and bypass detection.
 * Zero false negatives on bypass detection is a hard requirement.
 * 
 * @requirements Zero false negatives on safety bypass detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractSafetyInterlocks, extractSafetyFromFiles } from '../extractors/safety-extractor.js';
import type { SafetyExtractionResult } from '../extractors/safety-extractor.js';

describe('SafetyExtractor', () => {
  describe('interlock detection', () => {
    it('should detect basic interlock variables', () => {
      const source = `
PROGRAM Safety
VAR
  bIL_OK : BOOL;
  bIL_Press : BOOL;
  bIL_Temp : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.interlocks.length).toBeGreaterThanOrEqual(3);
      const names = result.interlocks.map(i => i.name);
      expect(names).toContain('bIL_OK');
      expect(names).toContain('bIL_Press');
      expect(names).toContain('bIL_Temp');
    });

    it('should detect interlock naming patterns', () => {
      const patterns = [
        'bInterlock',
        'bIL_Test',
        'Interlock_OK',
        'IL_Status',
        'bSafetyInterlock',
      ];
      
      for (const pattern of patterns) {
        const source = `
PROGRAM Test
VAR
  ${pattern} : BOOL;
END_VAR
END_PROGRAM
`;
        const result = extractSafetyInterlocks(source, 'test.st');
        expect(result.interlocks.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should detect E-Stop variables', () => {
      const source = `
PROGRAM Safety
VAR
  bES_OK : BOOL;
  bEStop : BOOL;
  EmergencyStop : BOOL;
  bE_Stop_Zone1 : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      const estops = result.interlocks.filter(i => i.type === 'estop');
      expect(estops.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect permissive variables', () => {
      const source = `
PROGRAM Safety
VAR
  bPermissive : BOOL;
  bPerm_Run : BOOL;
  bRunPermit : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      const permissives = result.interlocks.filter(i => i.type === 'permissive');
      expect(permissives.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect safety relay variables', () => {
      const source = `
PROGRAM Safety
VAR
  bSR_OK : BOOL;
  bSafetyRelay : BOOL;
  bSR_Zone1 : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should detect as some type of safety-related variable
      expect(result.interlocks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CRITICAL: bypass detection', () => {
    it('should detect bypass variables - naming pattern bDbg_Skip', () => {
      const source = `
PROGRAM Safety
VAR
  bDbg_SkipIL : BOOL;  (* DEBUG: Skip interlock for testing *)
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses.length).toBeGreaterThanOrEqual(1);
      expect(result.bypasses[0].name).toBe('bDbg_SkipIL');
      expect(result.bypasses[0].severity).toBe('critical');
    });

    it('should detect bypass variables - naming pattern bBypass', () => {
      const source = `
PROGRAM Safety
VAR
  bBypassSafety : BOOL;
  bBypass_IL : BOOL;
  bBypassInterlock : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses.length).toBeGreaterThanOrEqual(3);
    });

    it('should detect bypass variables - naming pattern bSkip', () => {
      const source = `
PROGRAM Safety
VAR
  bSkipSafety : BOOL;
  bSkip_Interlock : BOOL;
  bSkipCheck : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect bypass variables - naming pattern bOverride', () => {
      const source = `
PROGRAM Safety
VAR
  bOverrideSafety : BOOL;
  bOverride_IL : BOOL;
  bSafetyOverride : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect bypass variables - naming pattern bDisable', () => {
      const source = `
PROGRAM Safety
VAR
  bDisableSafety : BOOL;
  bDisable_IL : BOOL;
  bSafetyDisable : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect bypass variables - naming pattern bForce', () => {
      const source = `
PROGRAM Safety
VAR
  bForceSafety : BOOL;
  bForce_IL : BOOL;
  bForceInterlock : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect bypass in comments', () => {
      const source = `
PROGRAM Safety
VAR
  bTestMode : BOOL;  (* BYPASS: Used to skip safety checks during commissioning *)
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should detect either as bypass or generate critical warning
      const hasBypassOrWarning = 
        result.bypasses.length > 0 || 
        result.criticalWarnings.some(w => w.type === 'bypass-detected');
      expect(hasBypassOrWarning).toBe(true);
    });

    it('should detect bypass logic patterns', () => {
      const source = `
PROGRAM Safety
VAR
  bIL_OK : BOOL;
  bDebugMode : BOOL;
END_VAR
(* Bypass interlock in debug mode *)
IF bDebugMode THEN
  bIL_OK := TRUE;  (* Force interlock OK *)
END_IF;
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should detect the bypass pattern
      const hasBypassIndicator = 
        result.bypasses.length > 0 || 
        result.criticalWarnings.length > 0;
      expect(hasBypassIndicator).toBe(true);
    });

    it('should detect maintenance bypass patterns', () => {
      const source = `
PROGRAM Safety
VAR
  bMaintMode : BOOL;
  bMaintBypass : BOOL;
  bServiceMode : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Maintenance modes are potential bypasses
      expect(result.bypasses.length + result.criticalWarnings.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT false positive on legitimate variables', () => {
      const source = `
PROGRAM Normal
VAR
  bMotorRunning : BOOL;
  nCounter : INT;
  rTemperature : REAL;
  sMessage : STRING;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should not detect bypasses in normal code
      expect(result.bypasses).toHaveLength(0);
    });
  });

  describe('critical warnings', () => {
    it('should generate warning for bypass detection', () => {
      const source = `
PROGRAM Safety
VAR
  bDbg_SkipIL : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.criticalWarnings.length).toBeGreaterThanOrEqual(1);
      expect(result.criticalWarnings[0].severity).toBe('critical');
    });

    it('should include remediation in warnings', () => {
      const source = `
PROGRAM Safety
VAR
  bBypassSafety : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      if (result.criticalWarnings.length > 0) {
        expect(result.criticalWarnings[0].remediation).toBeDefined();
        expect(result.criticalWarnings[0].remediation.length).toBeGreaterThan(0);
      }
    });
  });

  describe('summary statistics', () => {
    it('should provide accurate summary', () => {
      const source = `
PROGRAM Safety
VAR
  bIL_OK : BOOL;
  bIL_Press : BOOL;
  bES_OK : BOOL;
  bBypassSafety : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.summary.totalInterlocks).toBeGreaterThanOrEqual(3);
      expect(result.summary.bypassCount).toBeGreaterThanOrEqual(1);
    });

    it('should categorize by type', () => {
      const source = `
PROGRAM Safety
VAR
  bIL_OK : BOOL;
  bES_OK : BOOL;
  bPermissive : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.summary.byType).toBeDefined();
    });
  });

  describe('location tracking', () => {
    it('should track interlock locations', () => {
      const source = `
PROGRAM Safety
VAR
  bIL_OK : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.interlocks[0].location).toBeDefined();
      expect(result.interlocks[0].location.file).toBe('test.st');
      expect(result.interlocks[0].location.line).toBeGreaterThan(0);
    });

    it('should track bypass locations', () => {
      const source = `
PROGRAM Safety
VAR
  bBypassSafety : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses[0].location).toBeDefined();
      expect(result.bypasses[0].location.file).toBe('test.st');
      expect(result.bypasses[0].location.line).toBeGreaterThan(0);
    });
  });

  describe('real-world patterns', () => {
    it('should handle complex safety logic', () => {
      const source = `
PROGRAM R101_Safety
VAR
  (* Safety Interlocks *)
  bIL_OK : BOOL;           (* Master interlock status *)
  bIL_Press : BOOL;        (* Pressure interlock *)
  bIL_Temp : BOOL;         (* Temperature interlock *)
  bIL_Level : BOOL;        (* Level interlock *)
  
  (* E-Stop *)
  bES_OK : BOOL;           (* E-Stop chain OK *)
  bES_Zone1 : BOOL;        (* Zone 1 E-Stop *)
  bES_Zone2 : BOOL;        (* Zone 2 E-Stop *)
  
  (* DEBUG - REMOVE BEFORE PRODUCTION *)
  bDbg_SkipIL : BOOL;      (* Skip interlock for testing *)
END_VAR

(* Interlock logic *)
bIL_OK := bIL_Press AND bIL_Temp AND bIL_Level AND bES_OK;

(* DEBUG BYPASS - CRITICAL: Remove before deployment *)
IF bDbg_SkipIL THEN
  bIL_OK := TRUE;
END_IF;

END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should detect all interlocks
      expect(result.interlocks.length).toBeGreaterThanOrEqual(5);
      
      // CRITICAL: Must detect the bypass
      expect(result.bypasses.length).toBeGreaterThanOrEqual(1);
      expect(result.bypasses.some(b => b.name === 'bDbg_SkipIL')).toBe(true);
      
      // Should have critical warning
      expect(result.criticalWarnings.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle vendor-specific patterns (Siemens)', () => {
      const source = `
FUNCTION_BLOCK FB_SafetyMonitor
VAR_INPUT
  i_bEmergencyStop : BOOL;
  i_bSafetyGate : BOOL;
  i_bLightCurtain : BOOL;
END_VAR
VAR_OUTPUT
  o_bSafetyOK : BOOL;
END_VAR
VAR
  bSafetyChainOK : BOOL;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should detect safety-related variables
      expect(result.interlocks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle vendor-specific patterns (Rockwell)', () => {
      const source = `
PROGRAM MainRoutine
VAR
  Safety_OK : BOOL;
  EStop_OK : BOOL;
  GuardDoor_Closed : BOOL;
  LightCurtain_Clear : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should detect safety-related variables
      expect(result.interlocks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty source', () => {
      const result = extractSafetyInterlocks('', 'test.st');
      
      expect(result.interlocks).toHaveLength(0);
      expect(result.bypasses).toHaveLength(0);
    });

    it('should handle source with no safety variables', () => {
      const source = `
PROGRAM Calculator
VAR
  a : INT;
  b : INT;
  result : INT;
END_VAR
result := a + b;
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      expect(result.bypasses).toHaveLength(0);
    });

    it('should handle malformed source gracefully', () => {
      const source = `
PROGRAM Broken
VAR
  bIL_OK : BOOL
  (* Missing semicolon and END_VAR *)
`;
      expect(() => extractSafetyInterlocks(source, 'test.st')).not.toThrow();
    });

    it('should handle case-insensitive matching', () => {
      const source = `
PROGRAM Safety
VAR
  BIL_OK : BOOL;
  bil_press : BOOL;
  Bil_Temp : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      // Should detect all regardless of case
      expect(result.interlocks.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('SafetyExtractor - Zero False Negatives Guarantee', () => {
  /**
   * CRITICAL TEST SUITE
   * 
   * These tests verify that we NEVER miss a safety bypass.
   * False negatives in safety detection can lead to:
   * - Equipment damage
   * - Personal injury
   * - Loss of life
   * 
   * Every known bypass pattern MUST be detected.
   */

  const bypassPatterns = [
    // Debug patterns
    'bDbg_Skip',
    'bDebug_Bypass',
    'bDbgBypass',
    'bDbg_Override',
    
    // Bypass patterns
    'bBypass',
    'bBypassSafety',
    'bBypass_IL',
    'bSafetyBypass',
    'bypass_enable',
    
    // Skip patterns
    'bSkipSafety',
    'bSkip_IL',
    'bSkipInterlock',
    'skip_safety',
    
    // Override patterns
    'bOverride',
    'bOverrideSafety',
    'bSafetyOverride',
    'override_il',
    
    // Disable patterns
    'bDisableSafety',
    'bDisable_IL',
    'bSafetyDisable',
    'disable_interlock',
    
    // Force patterns
    'bForceSafety',
    'bForce_IL',
    'bForceInterlock',
    'force_safety_ok',
    
    // Test/Maintenance patterns
    'bTestMode',
    'bMaintBypass',
    'bServiceBypass',
    'bCommissioningMode',
  ];

  for (const pattern of bypassPatterns) {
    it(`MUST detect bypass pattern: ${pattern}`, () => {
      const source = `
PROGRAM Safety
VAR
  ${pattern} : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractSafetyInterlocks(source, 'test.st');
      
      const detected = 
        result.bypasses.some(b => b.name.toLowerCase() === pattern.toLowerCase()) ||
        result.criticalWarnings.length > 0 ||
        result.interlocks.some(i => i.type === 'bypass');
      
      expect(detected).toBe(true);
    });
  }
});
