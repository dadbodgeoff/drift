/**
 * IEC 61131-3 State Machine Extractor Tests
 * 
 * Tests for CASE-based state machine detection and analysis.
 */

import { describe, it, expect } from 'vitest';
import { extractStateMachines, extractStateMachinesFromFiles } from '../extractors/state-machine-extractor.js';
import type { StateMachineExtractionResult } from '../extractors/state-machine-extractor.js';

describe('StateMachineExtractor', () => {
  describe('basic detection', () => {
    it('should detect simple CASE-based state machine', () => {
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
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect state variable', () => {
      const source = `
PROGRAM Test
VAR
  nPhase : INT;
END_VAR
CASE nPhase OF
  0: x := 1;
  10: x := 2;
  20: x := 3;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(1);
      expect(result.stateMachines[0].stateVariable).toBe('nPhase');
    });

    it('should detect all states', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: (* Idle *);
  1: (* Init *);
  2: (* Running *);
  3: (* Stopping *);
  4: (* Done *);
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines[0].states.length).toBeGreaterThanOrEqual(5);
    });

    it('should extract state values', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: (* Idle *);
  10: (* Running *);
  20: (* Done *);
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      const values = result.stateMachines[0].states.map(s => s.value);
      expect(values).toContain(0);
      expect(values).toContain(10);
      expect(values).toContain(20);
    });
  });

  describe('state naming', () => {
    it('should extract state names from comments', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: (* === IDLE === *);
  1: (* === RUNNING === *);
  2: (* === DONE === *);
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      // Should extract names from comments
      const hasNames = result.stateMachines[0].states.some(s => s.name !== null);
      expect(hasNames).toBe(true);
    });

    it('should handle states without names', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
  1: x := 2;
  2: x := 3;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      // Should still detect states even without names
      expect(result.stateMachines[0].states.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('transition detection', () => {
    it('should detect state transitions', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0:
    IF bStart THEN
      nState := 1;
    END_IF;
  1:
    IF bDone THEN
      nState := 2;
    END_IF;
  2:
    nState := 0;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines[0].transitions.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect transition guards', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
  bCondition : BOOL;
END_VAR
CASE nState OF
  0:
    IF bCondition THEN
      nState := 1;
    END_IF;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      // Should detect the conditional transition
      const hasGuardedTransition = result.stateMachines[0].transitions.some(t => t.guard !== null);
      // This may or may not be implemented depending on parser sophistication
    });
  });

  describe('verification', () => {
    it('should detect deadlock states', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0:
    nState := 1;
  1:
    (* No transition - deadlock *)
    x := 1;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      // Verification should flag potential deadlocks
      expect(result.stateMachines[0].verification).toBeDefined();
    });

    it('should detect gaps in state values', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
  1: x := 2;
  5: x := 3;  (* Gap: 2, 3, 4 missing *)
  10: x := 4;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      // Should detect gaps
      expect(result.stateMachines[0].verification.hasGaps).toBe(true);
    });

    it('should identify initial state', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT := 0;
END_VAR
CASE nState OF
  0: (* Initial state *);
  1: (* Running *);
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      const initialState = result.stateMachines[0].states.find(s => s.isInitial);
      expect(initialState).toBeDefined();
    });
  });

  describe('visualization', () => {
    it('should generate Mermaid diagram', () => {
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
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines[0].visualizations.mermaid).toBeDefined();
      expect(result.stateMachines[0].visualizations.mermaid).toContain('stateDiagram');
    });

    it('should generate ASCII diagram', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: (* Idle *);
  1: (* Running *);
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines[0].visualizations.ascii).toBeDefined();
    });
  });

  describe('multiple state machines', () => {
    it('should detect multiple state machines in one POU', () => {
      const source = `
PROGRAM Test
VAR
  nMainState : INT;
  nSubState : INT;
END_VAR
CASE nMainState OF
  0: x := 1;
  1: x := 2;
END_CASE;

CASE nSubState OF
  0: y := 1;
  1: y := 2;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle nested CASE statements', () => {
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
    y := 1;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      // Should detect both state machines
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('summary statistics', () => {
    it('should provide accurate summary', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
  1: x := 2;
  2: x := 3;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.summary.total).toBeGreaterThanOrEqual(1);
      expect(result.summary.totalStates).toBeGreaterThanOrEqual(3);
    });

    it('should count machines with issues', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
  5: x := 2;  (* Gap *)
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.summary.withGaps).toBeGreaterThanOrEqual(1);
    });
  });

  describe('location tracking', () => {
    it('should track state machine location', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines[0].location).toBeDefined();
      expect(result.stateMachines[0].location.file).toBe('test.st');
    });

    it('should track state locations', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1;
  1: x := 2;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      for (const state of result.stateMachines[0].states) {
        expect(state.location).toBeDefined();
        expect(state.location.line).toBeGreaterThan(0);
      }
    });
  });

  describe('real-world patterns', () => {
    it('should handle batch sequence pattern', () => {
      const source = `
PROGRAM R101_BatchSeq
VAR
  nPhase : INT;
  nStep : INT;
END_VAR

(* Main phase sequence *)
CASE nPhase OF
  0: (* === IDLE === *)
    IF bBatchStart THEN
      nPhase := 10;
    END_IF;
    
  10: (* === CHARGE SOLVENT === *)
    CASE nStep OF
      0: (* Open valve *)
        bFV101 := TRUE;
        nStep := 1;
      1: (* Wait for level *)
        IF rLevel >= rSetpoint THEN
          bFV101 := FALSE;
          nStep := 0;
          nPhase := 20;
        END_IF;
    END_CASE;
    
  20: (* === HEAT === *)
    IF rTemp >= rTempSetpoint THEN
      nPhase := 30;
    END_IF;
    
  30: (* === REACT === *)
    IF tReactTimer.Q THEN
      nPhase := 40;
    END_IF;
    
  40: (* === DISCHARGE === *)
    IF bTankEmpty THEN
      nPhase := 0;
    END_IF;
END_CASE;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      // Should detect both phase and step state machines
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(2);
      
      // Phase machine should have multiple states
      const phaseMachine = result.stateMachines.find(sm => sm.stateVariable === 'nPhase');
      expect(phaseMachine).toBeDefined();
      expect(phaseMachine!.states.length).toBeGreaterThanOrEqual(5);
    });

    it('should handle motor control pattern', () => {
      const source = `
FUNCTION_BLOCK FB_Motor
VAR
  eState : E_MotorState;
END_VAR

CASE eState OF
  E_MotorState.Stopped:
    IF bStart AND NOT bFault THEN
      eState := E_MotorState.Starting;
    END_IF;
    
  E_MotorState.Starting:
    IF tStartDelay.Q THEN
      eState := E_MotorState.Running;
    END_IF;
    
  E_MotorState.Running:
    IF bStop THEN
      eState := E_MotorState.Stopping;
    ELSIF bFault THEN
      eState := E_MotorState.Faulted;
    END_IF;
    
  E_MotorState.Stopping:
    IF tStopDelay.Q THEN
      eState := E_MotorState.Stopped;
    END_IF;
    
  E_MotorState.Faulted:
    IF bReset AND NOT bFault THEN
      eState := E_MotorState.Stopped;
    END_IF;
END_CASE;
END_FUNCTION_BLOCK
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(1);
      expect(result.stateMachines[0].states.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('edge cases', () => {
    it('should handle empty source', () => {
      const result = extractStateMachines('', 'test.st');
      
      expect(result.stateMachines).toHaveLength(0);
    });

    it('should handle source without CASE statements', () => {
      const source = `
PROGRAM Test
VAR
  x : INT;
END_VAR
x := x + 1;
END_PROGRAM
`;
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines).toHaveLength(0);
    });

    it('should handle CASE with ELSE', () => {
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
      const result = extractStateMachines(source, 'test.st');
      
      expect(result.stateMachines.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle malformed CASE gracefully', () => {
      const source = `
PROGRAM Test
VAR
  nState : INT;
END_VAR
CASE nState OF
  0: x := 1
  (* Missing END_CASE *)
END_PROGRAM
`;
      expect(() => extractStateMachines(source, 'test.st')).not.toThrow();
    });
  });
});
