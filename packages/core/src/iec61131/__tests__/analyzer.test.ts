/**
 * IEC 61131-3 Analyzer Integration Tests
 * 
 * Tests the main analyzer that orchestrates all extractors.
 * Ensures the full pipeline works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IEC61131Analyzer, createAnalyzer } from '../analyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('IEC61131Analyzer', () => {
  let analyzer: IEC61131Analyzer;
  let tempDir: string;

  beforeEach(async () => {
    analyzer = new IEC61131Analyzer();
    
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iec61131-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeTestFile(filename: string, content: string): string {
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  describe('initialization', () => {
    it('should initialize with directory path', async () => {
      writeTestFile('test.st', `
PROGRAM Test
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      
      // Should not throw
      expect(true).toBe(true);
    });

    it('should detect ST files', async () => {
      writeTestFile('program1.st', 'PROGRAM P1 END_PROGRAM');
      writeTestFile('program2.st', 'PROGRAM P2 END_PROGRAM');
      writeTestFile('other.txt', 'Not an ST file');
      
      await analyzer.initialize(tempDir);
      const status = await analyzer.status();
      
      expect(status.files.total).toBe(2);
    });

    it('should handle empty directory', async () => {
      await analyzer.initialize(tempDir);
      const status = await analyzer.status();
      
      expect(status.files.total).toBe(0);
    });
  });

  describe('status', () => {
    it('should return project status', async () => {
      writeTestFile('test.st', `
PROGRAM Main
VAR
  x : INT;
END_VAR
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const status = await analyzer.status();
      
      expect(status.project).toBeDefined();
      expect(status.files).toBeDefined();
      expect(status.analysis).toBeDefined();
      expect(status.health).toBeDefined();
    });

    it('should count POUs', async () => {
      writeTestFile('test.st', `
PROGRAM Main
END_PROGRAM

FUNCTION_BLOCK FB_Test
END_FUNCTION_BLOCK

FUNCTION Calc : INT
END_FUNCTION
`);
      
      await analyzer.initialize(tempDir);
      const status = await analyzer.status();
      
      expect(status.analysis.pous).toBe(3);
    });

    it('should calculate health score', async () => {
      writeTestFile('test.st', `
(**
 * Well documented program
 * @author Test
 *)
PROGRAM Main
VAR
  x : INT;
END_VAR
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const status = await analyzer.status();
      
      expect(status.health.score).toBeGreaterThanOrEqual(0);
      expect(status.health.score).toBeLessThanOrEqual(100);
    });
  });

  describe('docstrings', () => {
    it('should extract docstrings', async () => {
      writeTestFile('test.st', `
(**
 * Main program
 * @param x Input value
 *)
PROGRAM Main
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.docstrings();
      
      expect(result.docstrings.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect limit option', async () => {
      writeTestFile('test.st', `
(* Doc 1 *)
PROGRAM P1 END_PROGRAM
(* Doc 2 *)
PROGRAM P2 END_PROGRAM
(* Doc 3 *)
PROGRAM P3 END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.docstrings(undefined, { limit: 2 });
      
      expect(result.docstrings.length).toBeLessThanOrEqual(2);
    });
  });

  describe('blocks', () => {
    it('should list all POUs', async () => {
      writeTestFile('test.st', `
PROGRAM Main
END_PROGRAM

FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK

FUNCTION Add : INT
END_FUNCTION
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.blocks();
      
      expect(result.blocks.length).toBe(3);
      expect(result.summary.total).toBe(3);
    });

    it('should categorize by type', async () => {
      writeTestFile('test.st', `
PROGRAM P1 END_PROGRAM
PROGRAM P2 END_PROGRAM
FUNCTION_BLOCK FB1 END_FUNCTION_BLOCK
FUNCTION F1 : INT END_FUNCTION
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.blocks();
      
      expect(result.summary.byType.PROGRAM).toBe(2);
      expect(result.summary.byType.FUNCTION_BLOCK).toBe(1);
      expect(result.summary.byType.FUNCTION).toBe(1);
    });
  });

  describe('stateMachines', () => {
    it('should detect state machines', async () => {
      writeTestFile('test.st', `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: (* Idle *);
  1: (* Running *);
  2: (* Done *);
END_CASE;
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.stateMachines();
      
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(1);
    });

    it('should generate visualizations', async () => {
      writeTestFile('test.st', `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
  1: x := 2;
END_CASE;
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.stateMachines();
      
      expect(result.stateMachines[0].visualizations.mermaid).toBeDefined();
    });
  });

  describe('safety', () => {
    it('should detect safety interlocks', async () => {
      writeTestFile('test.st', `
PROGRAM Safety
VAR
  bIL_OK : BOOL;
  bES_OK : BOOL;
END_VAR
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.safety();
      
      expect(result.interlocks.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect bypasses', async () => {
      writeTestFile('test.st', `
PROGRAM Safety
VAR
  bDbg_SkipIL : BOOL;
END_VAR
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.safety();
      
      expect(result.bypasses.length).toBeGreaterThanOrEqual(1);
    });

    it('should generate critical warnings for bypasses', async () => {
      writeTestFile('test.st', `
PROGRAM Safety
VAR
  bBypassSafety : BOOL;
END_VAR
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.safety();
      
      expect(result.criticalWarnings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tribalKnowledge', () => {
    it('should extract tribal knowledge', async () => {
      writeTestFile('test.st', `
PROGRAM Test
(* WARNING: Critical timing *)
(* TODO: Add error handling *)
(* HACK: Workaround for sensor bug *)
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.tribalKnowledge();
      
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it('should classify by importance', async () => {
      writeTestFile('test.st', `
PROGRAM Test
(* DANGER: Risk of injury *)
(* WARNING: Important note *)
(* TODO: Minor task *)
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.tribalKnowledge();
      
      expect(result.summary.byImportance.critical).toBeGreaterThanOrEqual(1);
    });
  });

  describe('variables', () => {
    it('should extract variables', async () => {
      writeTestFile('test.st', `
PROGRAM Test
VAR
  x : INT;
  y : REAL;
  z : BOOL;
END_VAR
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.variables();
      
      expect(result.variables.length).toBeGreaterThanOrEqual(3);
    });

    it('should detect I/O mappings', async () => {
      writeTestFile('test.st', `
PROGRAM Test
VAR
  bInput AT %IX0.0 : BOOL;
  bOutput AT %QX1.0 : BOOL;
END_VAR
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.variables();
      
      expect(result.ioMappings.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('all (full analysis)', () => {
    it('should run complete analysis', async () => {
      writeTestFile('test.st', `
(**
 * Main program
 * @warning Safety critical
 *)
PROGRAM Main
VAR
  nState : INT;
  bIL_OK : BOOL;
END_VAR
(* TODO: Add error handling *)
CASE nState OF
  0: x := 1;
  1: x := 2;
END_CASE;
END_PROGRAM
`);
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.all();
      
      expect(result.status).toBeDefined();
      expect(result.docstrings).toBeDefined();
      expect(result.stateMachines).toBeDefined();
      expect(result.safety).toBeDefined();
      expect(result.tribalKnowledge).toBeDefined();
    });
  });

  describe('file filtering', () => {
    it('should analyze specific file', async () => {
      writeTestFile('file1.st', 'PROGRAM P1 END_PROGRAM');
      writeTestFile('file2.st', 'PROGRAM P2 END_PROGRAM');
      
      await analyzer.initialize(tempDir);
      const result = await analyzer.blocks('file1.st');
      
      expect(result.blocks.length).toBe(1);
      expect(result.blocks[0].name).toBe('P1');
    });
  });

  describe('error handling', () => {
    it('should handle malformed files gracefully', async () => {
      writeTestFile('broken.st', `
PROGRAM Broken
VAR
  x INT  (* Missing colon *)
END_VAR
`);
      
      await analyzer.initialize(tempDir);
      
      // Should not throw
      const status = await analyzer.status();
      expect(status).toBeDefined();
    });

    it('should handle non-existent directory', async () => {
      await expect(analyzer.initialize('/non/existent/path')).rejects.toThrow();
    });
  });

  describe('createAnalyzer factory', () => {
    it('should create analyzer instance', () => {
      const instance = createAnalyzer();
      expect(instance).toBeInstanceOf(IEC61131Analyzer);
    });

    it('should accept options', () => {
      const instance = createAnalyzer({ verbose: true });
      expect(instance).toBeInstanceOf(IEC61131Analyzer);
    });
  });
});

describe('IEC61131Analyzer - Integration with Sample Files', () => {
  /**
   * These tests use the actual sample files if available.
   * They verify the analyzer works with real-world ST code.
   */
  
  const sampleDir = path.resolve(__dirname, '../../../../../../samples/iec61131');
  
  // Skip if sample directory doesn't exist
  const hasSamples = fs.existsSync(sampleDir);
  
  (hasSamples ? describe : describe.skip)('with sample files', () => {
    let analyzer: IEC61131Analyzer;

    beforeEach(async () => {
      analyzer = new IEC61131Analyzer();
      await analyzer.initialize(sampleDir);
    });

    it('should analyze sample files', async () => {
      const status = await analyzer.status();
      
      expect(status.files.total).toBeGreaterThan(0);
      expect(status.analysis.pous).toBeGreaterThan(0);
    });

    it('should detect state machines in samples', async () => {
      const result = await analyzer.stateMachines();
      
      expect(result.stateMachines.length).toBeGreaterThan(0);
    });

    it('should detect safety interlocks in samples', async () => {
      const result = await analyzer.safety();
      
      expect(result.interlocks.length).toBeGreaterThan(0);
    });

    it('should extract tribal knowledge from samples', async () => {
      const result = await analyzer.tribalKnowledge();
      
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('should extract docstrings from samples', async () => {
      const result = await analyzer.docstrings();
      
      expect(result.docstrings.length).toBeGreaterThan(0);
    });

    it('CRITICAL: should detect bypass in LEGACY_BATCH_SYSTEM.st', async () => {
      const result = await analyzer.safety();
      
      // The sample file has bDbg_SkipIL bypass
      const hasBypass = result.bypasses.some(b => 
        b.name.toLowerCase().includes('skip') || 
        b.name.toLowerCase().includes('bypass') ||
        b.name.toLowerCase().includes('dbg')
      );
      
      expect(hasBypass).toBe(true);
    });
  });
});
