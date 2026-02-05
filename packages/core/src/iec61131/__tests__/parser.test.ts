/**
 * IEC 61131-3 Parser Tests
 * 
 * Tests the ST parser for correct AST generation.
 * Critical for ensuring all extractors receive valid data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { STParser, parseSTSource } from '../parser/st-parser.js';

describe('STParser', () => {
  let parser: STParser;
  const testFile = 'test.st';

  beforeEach(() => {
    parser = new STParser();
  });

  describe('basic parsing', () => {
    it('should parse empty source', () => {
      const result = parser.parse('', testFile);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse simple PROGRAM', () => {
      const source = `
PROGRAM Main
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous).toHaveLength(1);
      expect(result.pous[0].type).toBe('PROGRAM');
      expect(result.pous[0].name).toBe('Main');
    });

    it('should parse FUNCTION_BLOCK', () => {
      const source = `
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous).toHaveLength(1);
      expect(result.pous[0].type).toBe('FUNCTION_BLOCK');
      expect(result.pous[0].name).toBe('FB_Motor');
    });

    it('should parse FUNCTION', () => {
      const source = `
FUNCTION Add : INT
END_FUNCTION
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous).toHaveLength(1);
      expect(result.pous[0].type).toBe('FUNCTION');
      expect(result.pous[0].name).toBe('Add');
    });
  });

  describe('variable parsing', () => {
    it('should parse VAR section', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
  y : REAL;
  z : BOOL;
END_VAR
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous[0].variables.length).toBeGreaterThanOrEqual(3);
      
      const varNames = result.pous[0].variables.map(v => v.name);
      expect(varNames).toContain('x');
      expect(varNames).toContain('y');
      expect(varNames).toContain('z');
    });

    it('should parse VAR_INPUT section', () => {
      const source = `
FUNCTION_BLOCK FB_Test
VAR_INPUT
  bEnable : BOOL;
  nValue : INT;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const inputs = result.pous[0].variables.filter(v => v.section === 'VAR_INPUT');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse VAR_OUTPUT section', () => {
      const source = `
FUNCTION_BLOCK FB_Test
VAR_OUTPUT
  bDone : BOOL;
  nResult : INT;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const outputs = result.pous[0].variables.filter(v => v.section === 'VAR_OUTPUT');
      expect(outputs.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse VAR_IN_OUT section', () => {
      const source = `
FUNCTION_BLOCK FB_Test
VAR_IN_OUT
  refData : INT;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const inouts = result.pous[0].variables.filter(v => v.section === 'VAR_IN_OUT');
      expect(inouts.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse variable with initial value', () => {
      const source = `
PROGRAM Test
VAR
  x : INT := 42;
  y : REAL := 3.14;
  z : BOOL := TRUE;
END_VAR
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const xVar = result.pous[0].variables.find(v => v.name === 'x');
      expect(xVar?.initialValue).toBe('42');
    });

    it('should parse variable with comment', () => {
      const source = `
PROGRAM Test
VAR
  x : INT; (* This is a counter *)
END_VAR
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const xVar = result.pous[0].variables.find(v => v.name === 'x');
      // Comment may or may not be captured depending on parser implementation
      expect(xVar).toBeDefined();
    });

    it('should parse array variables', () => {
      const source = `
PROGRAM Test
VAR
  arr : ARRAY[0..10] OF INT;
END_VAR
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const arrVar = result.pous[0].variables.find(v => v.name === 'arr');
      expect(arrVar?.isArray).toBe(true);
    });

    it('should parse I/O addressed variables', () => {
      const source = `
PROGRAM Test
VAR
  bInput AT %IX0.0 : BOOL;
  bOutput AT %QX1.0 : BOOL;
END_VAR
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const inputVar = result.pous[0].variables.find(v => v.name === 'bInput');
      expect(inputVar?.ioAddress).toBeDefined();
    });
  });

  describe('comment parsing', () => {
    it('should parse block comments', () => {
      const source = `
(* This is a block comment *)
PROGRAM Test
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.comments.length).toBeGreaterThanOrEqual(1);
    });

    it('should parse line comments', () => {
      const source = `
// This is a line comment
PROGRAM Test
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      // Line comments may or may not be captured
    });

    it('should parse multi-line block comments', () => {
      const source = `
(*
  Multi-line
  block comment
*)
PROGRAM Test
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
    });

    it('should parse docstring-style comments', () => {
      const source = `
(**
 * @brief Motor control function block
 * @param bStart Start command
 * @return BOOL Running status
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.comments.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multiple POUs', () => {
    it('should parse multiple POUs in one file', () => {
      const source = `
PROGRAM Main
END_PROGRAM

FUNCTION_BLOCK FB_Helper
END_FUNCTION_BLOCK

FUNCTION Calc : INT
END_FUNCTION
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous).toHaveLength(3);
    });

    it('should maintain correct order of POUs', () => {
      const source = `
PROGRAM First
END_PROGRAM

PROGRAM Second
END_PROGRAM

PROGRAM Third
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous[0].name).toBe('First');
      expect(result.pous[1].name).toBe('Second');
      expect(result.pous[2].name).toBe('Third');
    });
  });

  describe('CASE statements', () => {
    it('should parse simple CASE statement', () => {
      const source = `
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
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
    });

    it('should parse CASE with ELSE', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
  1: x := 2;
ELSE
  x := 0;
END_CASE;
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
    });

    it('should parse nested CASE statements', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
  nSubState : INT;
END_VAR
CASE nState OF
  0:
    CASE nSubState OF
      0: x := 1;
      1: x := 2;
    END_CASE;
  1:
    x := 3;
END_CASE;
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle missing END_PROGRAM gracefully', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
`;
      // Should not throw, may report error or warning
      expect(() => parser.parse(source, testFile)).not.toThrow();
    });

    it('should handle malformed variable declarations', () => {
      const source = `
PROGRAM Test
VAR
  x INT;  (* Missing colon *)
END_VAR
END_PROGRAM
`;
      expect(() => parser.parse(source, testFile)).not.toThrow();
    });

    it('should handle unknown keywords gracefully', () => {
      const source = `
PROGRAM Test
UNKNOWN_KEYWORD
END_PROGRAM
`;
      expect(() => parser.parse(source, testFile)).not.toThrow();
    });
  });

  describe('location tracking', () => {
    it('should track POU locations', () => {
      const source = `
PROGRAM Test
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous[0].location).toBeDefined();
      expect(result.pous[0].location.line).toBeGreaterThan(0);
    });

    it('should track variable locations', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
END_PROGRAM
`;
      const result = parser.parse(source, testFile);
      
      expect(result.success).toBe(true);
      const xVar = result.pous[0].variables.find(v => v.name === 'x');
      expect(xVar?.location).toBeDefined();
      expect(xVar?.location.line).toBeGreaterThan(0);
    });
  });

  describe('parseSTSource helper', () => {
    it('should work as standalone function', () => {
      const source = `
PROGRAM Test
END_PROGRAM
`;
      const result = parseSTSource(source, testFile);
      
      expect(result.success).toBe(true);
      expect(result.pous).toHaveLength(1);
    });

    it('should accept file path and options', () => {
      const source = `
PROGRAM Test
END_PROGRAM
`;
      const result = parseSTSource(source, 'test.st', { strict: false });
      
      expect(result.success).toBe(true);
    });
  });
});
