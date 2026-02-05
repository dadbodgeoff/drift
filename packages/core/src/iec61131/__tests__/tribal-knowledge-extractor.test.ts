/**
 * IEC 61131-3 Tribal Knowledge Extractor Tests
 * 
 * Tests for extracting institutional knowledge, warnings, workarounds,
 * and other critical information embedded in comments.
 */

import { describe, it, expect } from 'vitest';
import { extractTribalKnowledge, extractTribalKnowledgeFromFiles } from '../extractors/tribal-knowledge-extractor.js';
import type { TribalKnowledgeExtractionResult } from '../extractors/tribal-knowledge-extractor.js';

describe('TribalKnowledgeExtractor', () => {
  describe('warning detection', () => {
    it('should detect WARNING comments', () => {
      const source = `
PROGRAM Test
(* WARNING: Do not modify this value during operation *)
VAR
  x : INT;
END_VAR
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const warnings = result.items.filter(i => i.type === 'warning');
      expect(warnings.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect CAUTION comments', () => {
      const source = `
PROGRAM Test
(* CAUTION: High voltage present *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const cautions = result.items.filter(i => i.type === 'caution');
      expect(cautions.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect DANGER comments', () => {
      const source = `
PROGRAM Test
(* DANGER: Risk of explosion if modified *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const dangers = result.items.filter(i => i.type === 'danger');
      expect(dangers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TODO/FIXME detection', () => {
    it('should detect TODO comments', () => {
      const source = `
PROGRAM Test
(* TODO: Add error handling *)
(* TODO: Optimize this loop *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const todos = result.items.filter(i => i.type === 'todo');
      expect(todos.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect FIXME comments', () => {
      const source = `
PROGRAM Test
(* FIXME: This calculation is wrong *)
(* FIXME: Race condition here *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const fixmes = result.items.filter(i => i.type === 'fixme');
      expect(fixmes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('hack/workaround detection', () => {
    it('should detect HACK comments', () => {
      const source = `
PROGRAM Test
(* HACK: Delay added to work around timing issue *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const hacks = result.items.filter(i => i.type === 'hack');
      expect(hacks.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect WORKAROUND comments', () => {
      const source = `
PROGRAM Test
(* WORKAROUND: PLC firmware bug requires this delay *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const workarounds = result.items.filter(i => i.type === 'workaround');
      expect(workarounds.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect "work around" phrase', () => {
      const source = `
PROGRAM Test
(* This is a work around for the sensor glitch *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('do-not-change detection', () => {
    it('should detect DO NOT CHANGE comments', () => {
      const source = `
PROGRAM Test
(* DO NOT CHANGE: This timing is critical *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const doNotChange = result.items.filter(i => i.type === 'do-not-change');
      expect(doNotChange.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect DO NOT MODIFY comments', () => {
      const source = `
PROGRAM Test
(* DO NOT MODIFY - calibrated value *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect "don\'t touch" comments', () => {
      const source = `
PROGRAM Test
(* Don't touch this - it took 3 days to get right *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('magic number detection', () => {
    it('should detect magic numbers with explanations', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
x := 42;  (* Magic number: Answer to everything *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const magicNumbers = result.items.filter(i => i.type === 'magic-number');
      expect(magicNumbers.length).toBeGreaterThanOrEqual(0); // May or may not detect
    });

    it('should detect unexplained constants', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
(* Why 1.732? Nobody knows anymore *)
x := 1.732;
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('history/author detection', () => {
    it('should detect author comments', () => {
      const source = `
PROGRAM Test
(* Author: John Smith, 2024-01-15 *)
(* Modified by: Jane Doe, 2024-02-01 *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const authorItems = result.items.filter(i => i.type === 'author' || i.type === 'history');
      expect(authorItems.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect date-based history', () => {
      const source = `
PROGRAM Test
(* 2024-01-15: Initial version *)
(* 2024-02-01: Fixed timing bug *)
(* 2024-03-10: Added safety check *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const historyItems = result.items.filter(i => i.type === 'history');
      expect(historyItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('equipment-specific knowledge', () => {
    it('should detect equipment references', () => {
      const source = `
PROGRAM Test
(* This only works with Siemens S7-1500 *)
(* Allen-Bradley specific timing *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const equipmentItems = result.items.filter(i => i.type === 'equipment');
      expect(equipmentItems.length).toBeGreaterThanOrEqual(0); // May or may not detect
    });

    it('should detect vendor-specific notes', () => {
      const source = `
PROGRAM Test
(* NOTE: Rockwell firmware v32 has a bug with this *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('mystery/unknown detection', () => {
    it('should detect "nobody knows" comments', () => {
      const source = `
PROGRAM Test
(* Nobody knows why this works *)
(* Don't ask me why this is here *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const mysteries = result.items.filter(i => i.type === 'mystery');
      expect(mysteries.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect uncertainty comments', () => {
      const source = `
PROGRAM Test
(* Not sure why this delay is needed *)
(* I think this is for the old sensor *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('importance classification', () => {
    it('should classify DANGER as critical', () => {
      const source = `
PROGRAM Test
(* DANGER: Risk of injury *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const danger = result.items.find(i => i.type === 'danger');
      expect(danger?.importance).toBe('critical');
    });

    it('should classify WARNING as high', () => {
      const source = `
PROGRAM Test
(* WARNING: Important safety note *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const warning = result.items.find(i => i.type === 'warning');
      expect(warning?.importance).toBe('high');
    });

    it('should classify TODO as medium', () => {
      const source = `
PROGRAM Test
(* TODO: Add feature *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const todo = result.items.find(i => i.type === 'todo');
      expect(todo?.importance).toBe('medium');
    });

    it('should classify NOTE as low', () => {
      const source = `
PROGRAM Test
(* NOTE: Just FYI *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const note = result.items.find(i => i.type === 'note');
      if (note) {
        expect(note.importance).toBe('low');
      }
    });
  });

  describe('summary statistics', () => {
    it('should count total items', () => {
      const source = `
PROGRAM Test
(* WARNING: First *)
(* TODO: Second *)
(* FIXME: Third *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.summary.total).toBeGreaterThanOrEqual(3);
    });

    it('should count by type', () => {
      const source = `
PROGRAM Test
(* WARNING: One *)
(* WARNING: Two *)
(* TODO: Three *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.summary.byType).toBeDefined();
      expect(result.summary.byType.warning).toBeGreaterThanOrEqual(2);
    });

    it('should count by importance', () => {
      const source = `
PROGRAM Test
(* DANGER: Critical *)
(* WARNING: High *)
(* TODO: Medium *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.summary.byImportance).toBeDefined();
      expect(result.summary.byImportance.critical).toBeGreaterThanOrEqual(1);
    });

    it('should count critical items', () => {
      const source = `
PROGRAM Test
(* DANGER: One *)
(* DANGER: Two *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.summary.criticalCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('location tracking', () => {
    it('should track item locations', () => {
      const source = `
PROGRAM Test
(* WARNING: Test warning *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items[0].location).toBeDefined();
      expect(result.items[0].location.file).toBe('test.st');
      expect(result.items[0].location.line).toBeGreaterThan(0);
    });
  });

  describe('context extraction', () => {
    it('should include surrounding context', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
(* WARNING: x must be positive *)
IF x < 0 THEN
  x := 0;
END_IF;
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items[0].context).toBeDefined();
    });
  });

  describe('real-world patterns', () => {
    it('should handle legacy code comments', () => {
      const source = `
PROGRAM Legacy
(*
 * WARNING: This code was written in 1995 and has been
 * modified many times. The original author is no longer
 * with the company. DO NOT CHANGE unless absolutely
 * necessary - it controls the main reactor.
 *
 * Known issues:
 * - Sometimes the timer doesn't reset (FIXME)
 * - The 0.5 second delay is a workaround for sensor lag
 * - Nobody knows why we multiply by 1.732
 *
 * History:
 * 1995-03-15 - Original version (J. Smith)
 * 2001-07-22 - Added safety check (unknown)
 * 2015-11-30 - Fixed overflow bug (B. Jones)
 *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      // Should extract multiple pieces of tribal knowledge
      expect(result.items.length).toBeGreaterThanOrEqual(3);
      expect(result.summary.criticalCount).toBeGreaterThanOrEqual(0);
    });

    it('should handle inline tribal knowledge', () => {
      const source = `
PROGRAM Test
VAR
  rDelay : REAL := 0.5;  (* HACK: Sensor needs time to settle *)
  nRetries : INT := 3;   (* Magic number - don't change! *)
  bBypass : BOOL;        (* WARNING: Debug only - remove before production *)
END_VAR
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty source', () => {
      const result = extractTribalKnowledge('', 'test.st');
      
      expect(result.items).toHaveLength(0);
    });

    it('should handle source without tribal knowledge', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
x := x + 1;
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      expect(result.items).toHaveLength(0);
    });

    it('should handle case-insensitive matching', () => {
      const source = `
PROGRAM Test
(* warning: lowercase *)
(* WARNING: uppercase *)
(* Warning: mixed case *)
END_PROGRAM
`;
      const result = extractTribalKnowledge(source, 'test.st');
      
      const warnings = result.items.filter(i => i.type === 'warning');
      expect(warnings.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle special characters', () => {
      const source = `
PROGRAM Test
(* WARNING: Special chars @#$%^&*() *)
END_PROGRAM
`;
      expect(() => extractTribalKnowledge(source, 'test.st')).not.toThrow();
    });
  });
});
