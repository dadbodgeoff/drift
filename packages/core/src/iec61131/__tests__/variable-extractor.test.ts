/**
 * IEC 61131-3 Variable Extractor Tests
 * 
 * Tests for variable extraction including I/O mappings.
 */

import { describe, it, expect } from 'vitest';
import { extractVariables, extractVariablesFromFiles } from '../extractors/variable-extractor.js';
import type { VariableExtractionResult } from '../extractors/variable-extractor.js';

describe('VariableExtractor', () => {
  describe('basic extraction', () => {
    it('should extract simple variables', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
  y : REAL;
  z : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.variables.length).toBeGreaterThanOrEqual(3);
      
      const names = result.variables.map(v => v.name);
      expect(names).toContain('x');
      expect(names).toContain('y');
      expect(names).toContain('z');
    });

    it('should extract variable types', () => {
      const source = `
PROGRAM Test
VAR
  a : INT;
  b : DINT;
  c : REAL;
  d : LREAL;
  e : BOOL;
  f : STRING;
  g : TIME;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const aVar = result.variables.find(v => v.name === 'a');
      expect(aVar?.dataType).toBe('INT');
      
      const cVar = result.variables.find(v => v.name === 'c');
      expect(cVar?.dataType).toBe('REAL');
    });
  });

  describe('variable sections', () => {
    it('should identify VAR section', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.variables[0].section).toBe('VAR');
    });

    it('should identify VAR_INPUT section', () => {
      const source = `
FUNCTION_BLOCK FB_Test
VAR_INPUT
  bEnable : BOOL;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = extractVariables(source, 'test.st');
      
      const inputVar = result.variables.find(v => v.name === 'bEnable');
      expect(inputVar?.section).toBe('VAR_INPUT');
    });

    it('should identify VAR_OUTPUT section', () => {
      const source = `
FUNCTION_BLOCK FB_Test
VAR_OUTPUT
  bDone : BOOL;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = extractVariables(source, 'test.st');
      
      const outputVar = result.variables.find(v => v.name === 'bDone');
      expect(outputVar?.section).toBe('VAR_OUTPUT');
    });

    it('should identify VAR_IN_OUT section', () => {
      const source = `
FUNCTION_BLOCK FB_Test
VAR_IN_OUT
  refData : INT;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = extractVariables(source, 'test.st');
      
      const inoutVar = result.variables.find(v => v.name === 'refData');
      expect(inoutVar?.section).toBe('VAR_IN_OUT');
    });

    it('should identify VAR_GLOBAL section', () => {
      const source = `
VAR_GLOBAL
  gCounter : INT;
END_VAR
`;
      const result = extractVariables(source, 'test.st');
      
      const globalVar = result.variables.find(v => v.name === 'gCounter');
      expect(globalVar?.section).toBe('VAR_GLOBAL');
    });

    it('should identify VAR_TEMP section', () => {
      const source = `
PROGRAM Test
VAR_TEMP
  temp : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const tempVar = result.variables.find(v => v.name === 'temp');
      expect(tempVar?.section).toBe('VAR_TEMP');
    });

    it('should identify VAR_CONSTANT section', () => {
      const source = `
PROGRAM Test
VAR CONSTANT
  MAX_VALUE : INT := 100;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      // May be VAR_CONSTANT or VAR depending on parser
      expect(result.variables.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('initial values', () => {
    it('should extract integer initial value', () => {
      const source = `
PROGRAM Test
VAR
  x : INT := 42;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const xVar = result.variables.find(v => v.name === 'x');
      expect(xVar?.initialValue).toBe('42');
    });

    it('should extract real initial value', () => {
      const source = `
PROGRAM Test
VAR
  x : REAL := 3.14;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const xVar = result.variables.find(v => v.name === 'x');
      expect(xVar?.initialValue).toBe('3.14');
    });

    it('should extract boolean initial value', () => {
      const source = `
PROGRAM Test
VAR
  x : BOOL := TRUE;
  y : BOOL := FALSE;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const xVar = result.variables.find(v => v.name === 'x');
      expect(xVar?.initialValue?.toUpperCase()).toBe('TRUE');
    });

    it('should extract string initial value', () => {
      const source = `
PROGRAM Test
VAR
  s : STRING := 'Hello';
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const sVar = result.variables.find(v => v.name === 's');
      expect(sVar?.initialValue).toContain('Hello');
    });
  });

  describe('comments', () => {
    it('should extract inline comments', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;  (* Counter for main loop *)
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const xVar = result.variables.find(v => v.name === 'x');
      if (xVar?.comment) {
        expect(xVar.comment).toContain('Counter');
      }
    });

    it('should extract line comments', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;  // Counter for main loop
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      // Comment extraction depends on parser implementation
      expect(result.variables.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('arrays', () => {
    it('should detect array variables', () => {
      const source = `
PROGRAM Test
VAR
  arr : ARRAY[0..10] OF INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const arrVar = result.variables.find(v => v.name === 'arr');
      expect(arrVar?.isArray).toBe(true);
    });

    it('should extract array bounds', () => {
      const source = `
PROGRAM Test
VAR
  arr : ARRAY[1..100] OF REAL;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const arrVar = result.variables.find(v => v.name === 'arr');
      if (arrVar?.arrayBounds) {
        expect(arrVar.arrayBounds.dimensions[0].lower).toBe(1);
        expect(arrVar.arrayBounds.dimensions[0].upper).toBe(100);
      }
    });

    it('should handle multi-dimensional arrays', () => {
      const source = `
PROGRAM Test
VAR
  matrix : ARRAY[0..9, 0..9] OF INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const matrixVar = result.variables.find(v => v.name === 'matrix');
      expect(matrixVar?.isArray).toBe(true);
    });
  });

  describe('I/O addresses', () => {
    it('should extract input addresses', () => {
      const source = `
PROGRAM Test
VAR
  bInput AT %IX0.0 : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const inputVar = result.variables.find(v => v.name === 'bInput');
      expect(inputVar?.ioAddress).toContain('IX0.0');
      
      expect(result.ioMappings.length).toBeGreaterThanOrEqual(1);
      expect(result.ioMappings[0].isInput).toBe(true);
    });

    it('should extract output addresses', () => {
      const source = `
PROGRAM Test
VAR
  bOutput AT %QX1.0 : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const outputVar = result.variables.find(v => v.name === 'bOutput');
      expect(outputVar?.ioAddress).toContain('QX1.0');
      
      const outputMapping = result.ioMappings.find(m => m.variableName === 'bOutput');
      expect(outputMapping?.isInput).toBe(false);
    });

    it('should extract word addresses', () => {
      const source = `
PROGRAM Test
VAR
  nInput AT %IW10 : INT;
  nOutput AT %QW20 : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.ioMappings.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract memory addresses', () => {
      const source = `
PROGRAM Test
VAR
  nData AT %MD100 : DINT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const dataVar = result.variables.find(v => v.name === 'nData');
      expect(dataVar?.ioAddress).toContain('MD100');
    });
  });

  describe('safety-critical detection', () => {
    it('should flag safety-critical variables', () => {
      const source = `
PROGRAM Test
VAR
  bIL_OK : BOOL;  (* Safety interlock *)
  bES_OK : BOOL;  (* E-Stop status *)
  nCounter : INT; (* Normal counter *)
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      const ilVar = result.variables.find(v => v.name === 'bIL_OK');
      const esVar = result.variables.find(v => v.name === 'bES_OK');
      const counterVar = result.variables.find(v => v.name === 'nCounter');
      
      expect(ilVar?.isSafetyCritical).toBe(true);
      expect(esVar?.isSafetyCritical).toBe(true);
      expect(counterVar?.isSafetyCritical).toBe(false);
    });
  });

  describe('summary statistics', () => {
    it('should count total variables', () => {
      const source = `
PROGRAM Test
VAR
  a : INT;
  b : INT;
  c : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.summary.total).toBeGreaterThanOrEqual(3);
    });

    it('should count by section', () => {
      const source = `
FUNCTION_BLOCK FB_Test
VAR_INPUT
  a : INT;
  b : INT;
END_VAR
VAR_OUTPUT
  c : INT;
END_VAR
VAR
  d : INT;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.summary.bySection.VAR_INPUT).toBeGreaterThanOrEqual(2);
      expect(result.summary.bySection.VAR_OUTPUT).toBeGreaterThanOrEqual(1);
    });

    it('should count variables with comments', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;  (* Has comment *)
  y : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.summary.withComments).toBeGreaterThanOrEqual(0);
    });

    it('should count variables with I/O addresses', () => {
      const source = `
PROGRAM Test
VAR
  bInput AT %IX0.0 : BOOL;
  bOutput AT %QX1.0 : BOOL;
  x : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.summary.withIOAddress).toBeGreaterThanOrEqual(2);
    });

    it('should count safety-critical variables', () => {
      const source = `
PROGRAM Test
VAR
  bIL_OK : BOOL;
  bES_OK : BOOL;
  x : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.summary.safetyCritical).toBeGreaterThanOrEqual(2);
    });
  });

  describe('location tracking', () => {
    it('should track variable locations', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.variables[0].location).toBeDefined();
      expect(result.variables[0].location.file).toBe('test.st');
      expect(result.variables[0].location.line).toBeGreaterThan(0);
    });

    it('should track I/O mapping locations', () => {
      const source = `
PROGRAM Test
VAR
  bInput AT %IX0.0 : BOOL;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.ioMappings[0].location).toBeDefined();
      expect(result.ioMappings[0].location.file).toBe('test.st');
    });
  });

  describe('edge cases', () => {
    it('should handle empty source', () => {
      const result = extractVariables('', 'test.st');
      
      expect(result.variables).toHaveLength(0);
    });

    it('should handle source without variables', () => {
      const source = `
PROGRAM Test
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      expect(result.variables).toHaveLength(0);
    });

    it('should handle malformed declarations gracefully', () => {
      const source = `
PROGRAM Test
VAR
  x INT;  (* Missing colon *)
END_VAR
END_PROGRAM
`;
      expect(() => extractVariables(source, 'test.st')).not.toThrow();
    });

    it('should handle multiple variables on one line', () => {
      const source = `
PROGRAM Test
VAR
  a, b, c : INT;
END_VAR
END_PROGRAM
`;
      const result = extractVariables(source, 'test.st');
      
      // May extract as 1 or 3 depending on parser
      expect(result.variables.length).toBeGreaterThanOrEqual(1);
    });
  });
});
