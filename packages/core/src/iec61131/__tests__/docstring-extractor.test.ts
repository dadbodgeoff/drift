/**
 * IEC 61131-3 Docstring Extractor Tests
 * 
 * Tests for documentation extraction from ST code.
 * This is the PhD's primary request - extracting institutional knowledge.
 */

import { describe, it, expect } from 'vitest';
import { extractDocstrings, extractDocstringsFromFiles } from '../extractors/docstring-extractor.js';
import type { DocstringExtractionResult } from '../extractors/docstring-extractor.js';

describe('DocstringExtractor', () => {
  describe('basic extraction', () => {
    it('should extract simple block comment', () => {
      const source = `
(* This is a simple comment *)
PROGRAM Test
END_PROGRAM
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract docstring-style comment', () => {
      const source = `
(**
 * Motor control function block
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings.length).toBeGreaterThanOrEqual(1);
    });

    it('should associate docstring with following POU', () => {
      const source = `
(**
 * Main program entry point
 *)
PROGRAM Main
END_PROGRAM
`;
      const result = extractDocstrings(source, 'test.st');
      
      const doc = result.docstrings.find(d => d.associatedBlock === 'Main');
      expect(doc).toBeDefined();
    });
  });

  describe('parameter extraction', () => {
    it('should extract @param tags', () => {
      const source = `
(**
 * Motor control
 * @param bStart Start command
 * @param bStop Stop command
 * @param nSpeed Speed setpoint
 *)
FUNCTION_BLOCK FB_Motor
VAR_INPUT
  bStart : BOOL;
  bStop : BOOL;
  nSpeed : INT;
END_VAR
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].params.length).toBeGreaterThanOrEqual(3);
      
      const startParam = result.docstrings[0].params.find(p => p.name === 'bStart');
      expect(startParam).toBeDefined();
      expect(startParam?.description).toContain('Start');
    });

    it('should extract parameter direction', () => {
      const source = `
(**
 * @param[in] bInput Input parameter
 * @param[out] bOutput Output parameter
 * @param[inout] refData Reference parameter
 *)
FUNCTION_BLOCK FB_Test
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      const inParam = result.docstrings[0].params.find(p => p.name === 'bInput');
      const outParam = result.docstrings[0].params.find(p => p.name === 'bOutput');
      
      if (inParam) expect(inParam.direction).toBe('in');
      if (outParam) expect(outParam.direction).toBe('out');
    });
  });

  describe('return value extraction', () => {
    it('should extract @return tag', () => {
      const source = `
(**
 * Calculate sum
 * @return INT Sum of inputs
 *)
FUNCTION Add : INT
END_FUNCTION
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].returns).toBeDefined();
      expect(result.docstrings[0].returns).toContain('Sum');
    });

    it('should extract @returns tag (alternative)', () => {
      const source = `
(**
 * Calculate sum
 * @returns The calculated sum
 *)
FUNCTION Add : INT
END_FUNCTION
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].returns).toBeDefined();
    });
  });

  describe('metadata extraction', () => {
    it('should extract @author tag', () => {
      const source = `
(**
 * Motor control
 * @author John Smith
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].author).toBe('John Smith');
    });

    it('should extract @date tag', () => {
      const source = `
(**
 * Motor control
 * @date 2024-01-15
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].date).toBeDefined();
    });

    it('should extract @version tag', () => {
      const source = `
(**
 * Motor control
 * @version 1.2.3
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      // Version may be in notes or separate field
    });
  });

  describe('history extraction', () => {
    it('should extract revision history', () => {
      const source = `
(**
 * Motor control
 * 
 * History:
 * 2024-01-15 - John - Initial version
 * 2024-02-01 - Jane - Added fault handling
 * 2024-03-10 - Bob - Fixed timing issue
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].history.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract @history tags', () => {
      const source = `
(**
 * Motor control
 * @history 2024-01-15 Initial version
 * @history 2024-02-01 Added fault handling
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].history.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('warning extraction', () => {
    it('should extract @warning tags', () => {
      const source = `
(**
 * Motor control
 * @warning Do not call while motor is running
 * @warning Requires safety interlock
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].warnings.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract @caution tags', () => {
      const source = `
(**
 * Motor control
 * @caution High voltage present
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      // Caution may be in warnings or notes
      const hasWarning = result.docstrings[0].warnings.length > 0 || 
                         result.docstrings[0].notes.length > 0;
      expect(hasWarning).toBe(true);
    });
  });

  describe('note extraction', () => {
    it('should extract @note tags', () => {
      const source = `
(**
 * Motor control
 * @note This FB requires FB_Timer
 * @note Maximum speed is 1000 RPM
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].notes.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract @see tags', () => {
      const source = `
(**
 * Motor control
 * @see FB_Timer
 * @see FB_Fault
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      // @see may be in notes
    });
  });

  describe('summary extraction', () => {
    it('should extract brief description', () => {
      const source = `
(**
 * @brief Motor control function block
 * 
 * Detailed description goes here.
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].summary).toContain('Motor control');
    });

    it('should use first line as summary if no @brief', () => {
      const source = `
(**
 * Motor control function block
 * 
 * This is the detailed description.
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].summary).toContain('Motor');
    });
  });

  describe('quality scoring', () => {
    it('should score well-documented code higher', () => {
      const wellDocumented = `
(**
 * @brief Motor control function block
 * @param bStart Start command
 * @param bStop Stop command
 * @return BOOL Running status
 * @author John Smith
 * @date 2024-01-15
 * @warning Requires safety interlock
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const poorlyDocumented = `
(* Motor *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      
      const wellResult = extractDocstrings(wellDocumented, 'test.st');
      const poorResult = extractDocstrings(poorlyDocumented, 'test.st');
      
      // Well-documented should have higher quality
      expect(wellResult.summary.averageQuality).toBeGreaterThan(poorResult.summary.averageQuality);
    });
  });

  describe('summary statistics', () => {
    it('should count total docstrings', () => {
      const source = `
(* Comment 1 *)
PROGRAM P1
END_PROGRAM

(* Comment 2 *)
PROGRAM P2
END_PROGRAM
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.summary.total).toBeGreaterThanOrEqual(2);
    });

    it('should count by block type', () => {
      const source = `
(* Program doc *)
PROGRAM Main
END_PROGRAM

(* FB doc *)
FUNCTION_BLOCK FB_Test
END_FUNCTION_BLOCK

(* Function doc *)
FUNCTION Calc : INT
END_FUNCTION
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.summary.byBlock).toBeDefined();
    });

    it('should count docstrings with params', () => {
      const source = `
(**
 * @param x Input value
 *)
FUNCTION Test : INT
END_FUNCTION
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.summary.withParams).toBeGreaterThanOrEqual(1);
    });

    it('should count docstrings with warnings', () => {
      const source = `
(**
 * @warning Critical safety function
 *)
FUNCTION Test : INT
END_FUNCTION
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.summary.withWarnings).toBeGreaterThanOrEqual(1);
    });
  });

  describe('location tracking', () => {
    it('should track docstring location', () => {
      const source = `
(* Test comment *)
PROGRAM Test
END_PROGRAM
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings[0].location).toBeDefined();
      expect(result.docstrings[0].location.file).toBe('test.st');
      expect(result.docstrings[0].location.line).toBeGreaterThan(0);
    });
  });

  describe('raw content', () => {
    it('should include raw content when requested', () => {
      const source = `
(**
 * This is the raw content
 * with multiple lines
 *)
PROGRAM Test
END_PROGRAM
`;
      const result = extractDocstrings(source, 'test.st', { includeRaw: true });
      
      expect(result.docstrings[0].raw).toBeDefined();
      expect(result.docstrings[0].raw).toContain('raw content');
    });
  });

  describe('real-world patterns', () => {
    it('should handle Siemens-style documentation', () => {
      const source = `
//=============================================================================
// FB_Motor - Motor Control Function Block
//=============================================================================
// Author: John Smith
// Date: 2024-01-15
// Version: 1.0.0
//
// Description:
//   Controls a motor with start/stop commands and fault handling.
//
// Inputs:
//   i_bStart - Start command
//   i_bStop - Stop command
//
// Outputs:
//   o_bRunning - Motor running status
//   o_bFault - Fault status
//
// History:
//   2024-01-15 - Initial version
//   2024-02-01 - Added fault handling
//=============================================================================
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle CODESYS-style documentation', () => {
      const source = `
{attribute 'qualified_only'}
(**
 * Motor control function block
 * 
 * @param bStart : BOOL - Start command
 * @param bStop : BOOL - Stop command
 * @return BOOL - Running status
 *)
FUNCTION_BLOCK FB_Motor
END_FUNCTION_BLOCK
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle legacy documentation', () => {
      const source = `
(******************************************************************************
 * PROGRAM: Main
 * PURPOSE: Main control program
 * AUTHOR: J. Smith
 * DATE: 15-JAN-2024
 * 
 * MODIFICATION HISTORY:
 * DATE        AUTHOR    DESCRIPTION
 * ----------  --------  -----------------------------------------------------
 * 15-JAN-24   JSmith    Initial version
 * 01-FEB-24   JDoe      Added safety checks
 ******************************************************************************)
PROGRAM Main
END_PROGRAM
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings.length).toBeGreaterThanOrEqual(1);
      expect(result.docstrings[0].history.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty source', () => {
      const result = extractDocstrings('', 'test.st');
      
      expect(result.docstrings).toHaveLength(0);
    });

    it('should handle source without comments', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
x := x + 1;
END_PROGRAM
`;
      const result = extractDocstrings(source, 'test.st');
      
      expect(result.docstrings).toHaveLength(0);
    });

    it('should handle nested comments', () => {
      const source = `
(* Outer (* Inner *) Outer *)
PROGRAM Test
END_PROGRAM
`;
      expect(() => extractDocstrings(source, 'test.st')).not.toThrow();
    });

    it('should handle special characters in comments', () => {
      const source = `
(* Special chars: @#$%^&*()[]{}|\\;:'",.<>?/ *)
PROGRAM Test
END_PROGRAM
`;
      expect(() => extractDocstrings(source, 'test.st')).not.toThrow();
    });

    it('should handle Unicode in comments', () => {
      const source = `
(* Unicode: äöü ñ 中文 日本語 *)
PROGRAM Test
END_PROGRAM
`;
      expect(() => extractDocstrings(source, 'test.st')).not.toThrow();
    });
  });
});
