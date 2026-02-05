/**
 * ST Timer/Counter Extractor
 * 
 * Single responsibility: Extract timer and counter instantiations
 */

import type { STTimerInstance, STCounterInstance, STTimerType, STCounterType } from '../types.js';

export interface TimerCounterExtractorResult {
  timers: STTimerInstance[];
  counters: STCounterInstance[];
}

const TIMER_TYPES: STTimerType[] = ['TON', 'TOF', 'TP', 'TONR'];
const COUNTER_TYPES: STCounterType[] = ['CTU', 'CTD', 'CTUD'];

// Pattern: instanceName : TimerType or instanceName : CounterType
const INSTANCE_PATTERN = /(\w+)\s*:\s*(TON|TOF|TP|TONR|CTU|CTD|CTUD)\b/gi;

export function extractTimersAndCounters(source: string): TimerCounterExtractorResult {
  const timers: STTimerInstance[] = [];
  const counters: STCounterInstance[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    let match;
    const pattern = new RegExp(INSTANCE_PATTERN.source, INSTANCE_PATTERN.flags);
    
    while ((match = pattern.exec(line)) !== null) {
      const name = match[1]!;
      const type = match[2]!.toUpperCase();

      if (TIMER_TYPES.includes(type as STTimerType)) {
        timers.push({ name, type: type as STTimerType, line: lineNum });
      } else if (COUNTER_TYPES.includes(type as STCounterType)) {
        counters.push({ name, type: type as STCounterType, line: lineNum });
      }
    }
  }

  return { timers, counters };
}
