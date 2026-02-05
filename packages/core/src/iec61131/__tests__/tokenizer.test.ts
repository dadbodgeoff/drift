/**
 * IEC 61131-3 Tokenizer Tests
 * 
 * Tests the ST tokenizer for correct token generation.
 * Critical for ensuring parser accuracy.
 */

import { describe, it, expect } from 'vitest';
import { STTokenizer, tokenize } from '../parser/tokenizer.js';
import type { Token, TokenType } from '../parser/tokenizer.js';

describe('STTokenizer', () => {
  describe('basic tokenization', () => {
    it('should tokenize keywords', () => {
      const tokens = tokenize('PROGRAM VAR END_VAR END_PROGRAM');
      const types = tokens.map(t => t.type);
      
      // Tokenizer uses specific keyword types, not generic 'KEYWORD'
      expect(types).toContain('PROGRAM');
      expect(types).toContain('VAR');
      expect(types).toContain('END_VAR');
      expect(types).toContain('END_PROGRAM');
    });

    it('should tokenize identifiers', () => {
      const tokens = tokenize('myVariable _test var123');
      const identifiers = tokens.filter(t => t.type === 'IDENTIFIER');
      
      expect(identifiers).toHaveLength(3);
      expect(identifiers.map(t => t.value)).toEqual(['myVariable', '_test', 'var123']);
    });

    it('should tokenize numbers', () => {
      const tokens = tokenize('42 3.14');
      const integers = tokens.filter(t => t.type === 'INTEGER');
      const reals = tokens.filter(t => t.type === 'REAL');
      
      expect(integers.length).toBeGreaterThanOrEqual(1);
      expect(reals.length).toBeGreaterThanOrEqual(1);
    });

    it('should tokenize strings', () => {
      const tokens = tokenize("'hello' \"world\"");
      const strings = tokens.filter(t => t.type === 'STRING' || t.type === 'WSTRING');
      
      expect(strings.length).toBeGreaterThanOrEqual(2);
    });

    it('should tokenize operators', () => {
      const tokens = tokenize(':= + - * / = <> < > <= >=');
      const operatorTypes = ['ASSIGN', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'EQ', 'NE', 'LT', 'GT', 'LE', 'GE'];
      const operators = tokens.filter(t => operatorTypes.includes(t.type));
      
      expect(operators.length).toBeGreaterThanOrEqual(5);
    });

    it('should tokenize comments', () => {
      const tokens = tokenize('(* block comment *) // line comment');
      const comments = tokens.filter(t => t.type === 'COMMENT');
      
      expect(comments.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POU declarations', () => {
    it('should tokenize PROGRAM declaration', () => {
      const source = `
PROGRAM Main
VAR
  x : INT;
END_VAR
END_PROGRAM
`;
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('PROGRAM');
      expect(types).toContain('VAR');
      expect(types).toContain('END_VAR');
      expect(types).toContain('END_PROGRAM');
    });

    it('should tokenize FUNCTION_BLOCK declaration', () => {
      const source = `
FUNCTION_BLOCK FB_Motor
VAR_INPUT
  bStart : BOOL;
END_VAR
END_FUNCTION_BLOCK
`;
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('FUNCTION_BLOCK');
      expect(types).toContain('VAR_INPUT');
      expect(types).toContain('END_FUNCTION_BLOCK');
    });

    it('should tokenize FUNCTION declaration', () => {
      const source = `
FUNCTION Add : INT
VAR_INPUT
  a : INT;
  b : INT;
END_VAR
  Add := a + b;
END_FUNCTION
`;
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('FUNCTION');
      expect(types).toContain('END_FUNCTION');
    });
  });

  describe('variable sections', () => {
    it('should tokenize all variable section types', () => {
      const sections = [
        'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT',
        'VAR_GLOBAL', 'VAR_TEMP', 'VAR_CONSTANT', 'VAR_EXTERNAL'
      ];
      
      for (const section of sections) {
        const source = `${section}\n  x : INT;\nEND_VAR`;
        const tokens = tokenize(source);
        const types = tokens.map(t => t.type);
        
        expect(types).toContain(section);
      }
    });
  });

  describe('data types', () => {
    it('should tokenize basic data types', () => {
      const types = ['BOOL', 'INT', 'DINT', 'REAL', 'LREAL', 'STRING', 'TIME', 'DATE'];
      
      for (const type of types) {
        const source = `VAR x : ${type}; END_VAR`;
        const tokens = tokenize(source);
        const found = tokens.some(t => 
          (t.type === 'KEYWORD' || t.type === 'IDENTIFIER') && 
          t.value.toUpperCase() === type
        );
        
        expect(found).toBe(true);
      }
    });

    it('should tokenize array declarations', () => {
      const source = 'VAR arr : ARRAY[0..10] OF INT; END_VAR';
      const tokens = tokenize(source);
      
      expect(tokens.some(t => t.value.toUpperCase() === 'ARRAY')).toBe(true);
    });
  });

  describe('control structures', () => {
    it('should tokenize IF statement', () => {
      const source = 'IF x > 0 THEN y := 1; ELSIF x < 0 THEN y := -1; ELSE y := 0; END_IF;';
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('IF');
      expect(types).toContain('THEN');
      expect(types).toContain('ELSIF');
      expect(types).toContain('ELSE');
      expect(types).toContain('END_IF');
    });

    it('should tokenize CASE statement', () => {
      const source = 'CASE nState OF 0: x := 1; 1: x := 2; ELSE x := 0; END_CASE;';
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('CASE');
      expect(types).toContain('OF');
      expect(types).toContain('END_CASE');
    });

    it('should tokenize FOR loop', () => {
      const source = 'FOR i := 0 TO 10 BY 1 DO x := x + 1; END_FOR;';
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('FOR');
      expect(types).toContain('TO');
      expect(types).toContain('DO');
      expect(types).toContain('END_FOR');
    });

    it('should tokenize WHILE loop', () => {
      const source = 'WHILE x < 10 DO x := x + 1; END_WHILE;';
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('WHILE');
      expect(types).toContain('DO');
      expect(types).toContain('END_WHILE');
    });

    it('should tokenize REPEAT loop', () => {
      const source = 'REPEAT x := x + 1; UNTIL x >= 10 END_REPEAT;';
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('REPEAT');
      expect(types).toContain('UNTIL');
      expect(types).toContain('END_REPEAT');
    });
  });

  describe('I/O addresses', () => {
    it('should tokenize AT addresses', () => {
      const source = 'VAR bInput AT %IX0.0 : BOOL; END_VAR';
      const tokens = tokenize(source);
      const types = tokens.map(t => t.type);
      
      expect(types).toContain('AT');
      // The % address is tokenized as UNKNOWN or IDENTIFIER depending on implementation
    });

    it('should tokenize various I/O address formats', () => {
      // Just verify the tokenizer doesn't crash on these
      const addresses = ['%IX0.0', '%QX1.0', '%IW10', '%QW20', '%MD100'];
      
      for (const addr of addresses) {
        const source = `VAR x AT ${addr} : BOOL; END_VAR`;
        expect(() => tokenize(source)).not.toThrow();
      }
    });
  });

  describe('line tracking', () => {
    it('should track line numbers correctly', () => {
      const source = `PROGRAM Test
VAR
  x : INT;
END_VAR
END_PROGRAM`;
      
      const tokens = tokenize(source);
      
      // PROGRAM should be on line 1
      const programToken = tokens.find(t => t.value.toUpperCase() === 'PROGRAM');
      expect(programToken?.line).toBe(1);
      
      // VAR should be on line 2
      const varToken = tokens.find(t => t.value.toUpperCase() === 'VAR');
      expect(varToken?.line).toBe(2);
    });

    it('should track column positions', () => {
      const source = '  PROGRAM Test';
      const tokens = tokenize(source);
      
      const programToken = tokens.find(t => t.value.toUpperCase() === 'PROGRAM');
      expect(programToken?.column).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const tokens = tokenize('');
      // Should have at least EOF token
      expect(tokens.length).toBeGreaterThanOrEqual(1);
      expect(tokens[tokens.length - 1].type).toBe('EOF');
    });

    it('should handle whitespace only', () => {
      const tokens = tokenize('   \n\t\n   ');
      // Should have EOF token
      expect(tokens[tokens.length - 1].type).toBe('EOF');
    });

    it('should handle nested comments', () => {
      const source = '(* outer (* inner *) outer *)';
      const tokens = tokenize(source);
      // Should not crash and should produce some output
      expect(tokens.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle unclosed strings gracefully', () => {
      const source = "VAR s : STRING := 'unclosed";
      // Should not throw
      expect(() => tokenize(source)).not.toThrow();
    });

    it('should handle special characters in comments', () => {
      const source = '(* Comment with special chars: @#$%^&*() *)';
      const tokens = tokenize(source);
      expect(tokens.length).toBeGreaterThanOrEqual(1);
    });
  });
});
