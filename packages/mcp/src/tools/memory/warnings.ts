/**
 * drift_memory_warnings
 * 
 * Get active warnings from tribal knowledge and code smells.
 */

import { getCortex } from 'driftdetect-cortex';

/**
 * Memory warnings tool definition
 */
export const memoryWarnings = {
  name: 'drift_memory_warnings',
  description: 'Get active warnings from tribal knowledge and code smells',
  parameters: {
    type: 'object',
    properties: {
      focus: {
        type: 'string',
        description: 'Filter warnings by focus area',
      },
      severity: {
        type: 'string',
        enum: ['all', 'critical', 'warning'],
        default: 'all',
        description: 'Filter by severity',
      },
    },
  },

  async execute(params: { focus?: string; severity?: string }) {
    const cortex = await getCortex();

    // Get tribal warnings
    const tribal = await cortex.search({
      types: ['tribal'],
      importance: ['high', 'critical'],
      limit: 50,
    });

    // Get code smells
    const smells = await cortex.search({
      types: ['code_smell'],
      limit: 50,
    });

    const warnings: Array<{
      type: string;
      severity: string;
      message: string;
      source: string;
      confidence: number;
    }> = [];

    // Process tribal warnings
    for (const mem of tribal) {
      const m = mem as any;
      if (params.severity === 'critical' && m.severity !== 'critical') continue;
      if (params.focus && !m.topic.toLowerCase().includes(params.focus.toLowerCase())) continue;

      warnings.push({
        type: 'tribal',
        severity: m.severity,
        message: m.knowledge,
        source: m.topic,
        confidence: m.confidence,
      });
    }

    // Process code smells
    for (const mem of smells) {
      const m = mem as any;
      if (params.focus && !m.name.toLowerCase().includes(params.focus.toLowerCase())) continue;

      warnings.push({
        type: 'code_smell',
        severity: m.severity,
        message: `${m.name}: ${m.reason}`,
        source: m.name,
        confidence: m.confidence,
      });
    }

    // Sort by severity
    const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
    warnings.sort((a, b) => 
      (severityOrder[a.severity as keyof typeof severityOrder] || 4) - 
      (severityOrder[b.severity as keyof typeof severityOrder] || 4)
    );

    return {
      warnings,
      total: warnings.length,
      bySeverity: {
        critical: warnings.filter(w => w.severity === 'critical').length,
        warning: warnings.filter(w => w.severity === 'warning').length,
        info: warnings.filter(w => w.severity === 'info').length,
      },
    };
  },
};
