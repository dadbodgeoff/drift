/**
 * drift_incident
 * 
 * Record and retrieve incident postmortems for proactive warnings.
 * Enables learning from past problems.
 */

import { getCortex } from 'driftdetect-cortex';

interface IncidentResult {
  success: boolean;
  action: string;
  incident?: any;
  incidents?: any[];
  warnings?: Array<{ incident: any; matchedTrigger: string }>;
  id?: string;
  message?: string;
}

export const driftIncident = {
  name: 'drift_incident',
  description: 'Record and retrieve incident postmortems. Actions: record (new incident), get (by id), list (all/filtered), search (by keyword), warnings (check for relevant past incidents based on context).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['record', 'get', 'list', 'search', 'warnings', 'resolve', 'add_lesson'], description: 'Action to perform' },
      title: { type: 'string', description: 'Incident title' },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Incident severity' },
      incidentType: { type: 'string', enum: ['outage', 'security', 'data_loss', 'performance', 'integration', 'other'], description: 'Type of incident' },
      impact: { type: 'string', description: 'Impact assessment' },
      affectedSystems: { type: 'array', items: { type: 'string' }, description: 'Systems affected by the incident' },
      rootCause: { type: 'string', description: 'Root cause analysis' },
      contributingFactors: { type: 'array', items: { type: 'string' }, description: 'Contributing factors' },
      resolution: { type: 'string', description: 'How the incident was resolved' },
      lessonsLearned: { type: 'array', items: { type: 'string' }, description: 'Lessons learned from the incident' },
      warningTriggers: { type: 'array', items: { type: 'string' }, description: 'Keywords/conditions that should surface this incident as a warning' },
      id: { type: 'string', description: 'Incident ID' },
      query: { type: 'string', description: 'Search query or context to check for warnings' },
      severityFilter: { type: 'string', enum: ['low', 'medium', 'high', 'critical', 'all'], description: 'Filter by severity' },
      lesson: { type: 'string', description: 'New lesson learned to add' },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<IncidentResult> {
    const cortex = await getCortex();

    switch (params.action) {
      case 'record': {
        if (!params.title || !params.severity || !params.impact || !params.resolution || !params.lessonsLearned) {
          return { success: false, action: 'record', message: 'Missing required fields: title, severity, impact, resolution, lessonsLearned' };
        }

        const memory = {
          type: 'incident',
          title: params.title,
          severity: params.severity,
          incidentType: params.incidentType,
          detectedAt: new Date().toISOString(),
          impact: params.impact,
          affectedSystems: params.affectedSystems || [],
          rootCause: params.rootCause,
          contributingFactors: params.contributingFactors,
          resolution: params.resolution,
          lessonsLearned: params.lessonsLearned,
          warningTriggers: params.warningTriggers || [],
          summary: `🚨 ${params.severity}: ${params.title}`,
          confidence: 1.0,
          importance: params.severity === 'critical' ? 'critical' : 'high',
        };

        const id = await cortex.add(memory as any);
        return { success: true, action: 'record', id, incident: { ...memory, id }, message: `Recorded incident "${params.title}"` };
      }

      case 'get': {
        if (!params.id) {
          return { success: false, action: 'get', message: 'Missing required field: id' };
        }
        const incident = await cortex.get(params.id);
        if (!incident) {
          return { success: false, action: 'get', message: `Incident with id "${params.id}" not found` };
        }
        return { success: true, action: 'get', incident };
      }

      case 'list': {
        const incidents = await cortex.search({ types: ['incident' as any], limit: 100 });
        let filtered = incidents;
        if (params.severityFilter && params.severityFilter !== 'all') {
          filtered = incidents.filter((i: any) => i.severity === params.severityFilter);
        }

        const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        filtered.sort((a: any, b: any) => {
          const severityDiff = (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);
          if (severityDiff !== 0) return severityDiff;
          return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
        });

        return { success: true, action: 'list', incidents: filtered, message: `Found ${filtered.length} incidents` };
      }

      case 'search': {
        if (!params.query) {
          return { success: false, action: 'search', message: 'Missing required field: query' };
        }

        const incidents = await cortex.search({ types: ['incident' as any], limit: 100 });
        const queryLower = params.query.toLowerCase();
        const matching = incidents.filter((incident: any) =>
          incident.title?.toLowerCase().includes(queryLower) ||
          incident.impact?.toLowerCase().includes(queryLower) ||
          incident.rootCause?.toLowerCase().includes(queryLower) ||
          incident.affectedSystems?.some((s: string) => s.toLowerCase().includes(queryLower)) ||
          incident.lessonsLearned?.some((l: string) => l.toLowerCase().includes(queryLower))
        );

        return { success: true, action: 'search', incidents: matching, message: `Found ${matching.length} incidents matching "${params.query}"` };
      }

      case 'warnings': {
        if (!params.query) {
          return { success: false, action: 'warnings', message: 'Missing required field: query (context to check for warnings)' };
        }

        const incidents = await cortex.search({ types: ['incident' as any], limit: 100 });
        const queryLower = params.query.toLowerCase();
        const warnings: Array<{ incident: any; matchedTrigger: string }> = [];

        for (const incident of incidents as any[]) {
          for (const trigger of incident.warningTriggers || []) {
            if (queryLower.includes(trigger.toLowerCase())) {
              warnings.push({ incident, matchedTrigger: trigger });
              break;
            }
          }

          for (const system of incident.affectedSystems || []) {
            if (queryLower.includes(system.toLowerCase())) {
              if (!warnings.find((w) => w.incident.id === incident.id)) {
                warnings.push({ incident, matchedTrigger: `system: ${system}` });
              }
              break;
            }
          }
        }

        const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        warnings.sort((a, b) => (severityOrder[a.incident.severity] || 4) - (severityOrder[b.incident.severity] || 4));

        return {
          success: true,
          action: 'warnings',
          warnings,
          message: warnings.length > 0 ? `⚠️ Found ${warnings.length} relevant past incidents` : 'No relevant past incidents found',
        };
      }

      case 'resolve': {
        if (!params.id || !params.resolution) {
          return { success: false, action: 'resolve', message: 'Missing required fields: id, resolution' };
        }

        const incident = await cortex.get(params.id) as any;
        if (!incident) {
          return { success: false, action: 'resolve', message: `Incident with id "${params.id}" not found` };
        }

        const resolvedAt = new Date().toISOString();
        const duration = incident.detectedAt
          ? `${Math.round((new Date(resolvedAt).getTime() - new Date(incident.detectedAt).getTime()) / 60000)} minutes`
          : undefined;

        await cortex.update(params.id, { resolvedAt, duration, resolution: params.resolution } as any);
        return { success: true, action: 'resolve', incident: { ...incident, resolvedAt, duration, resolution: params.resolution }, message: `Resolved incident "${incident.title}"` };
      }

      case 'add_lesson': {
        if (!params.id || !params.lesson) {
          return { success: false, action: 'add_lesson', message: 'Missing required fields: id, lesson' };
        }

        const incident = await cortex.get(params.id) as any;
        if (!incident) {
          return { success: false, action: 'add_lesson', message: `Incident with id "${params.id}" not found` };
        }

        const lessonsLearned = [...(incident.lessonsLearned || []), params.lesson];
        await cortex.update(params.id, { lessonsLearned } as any);
        return { success: true, action: 'add_lesson', incident: { ...incident, lessonsLearned }, message: `Added lesson to incident "${incident.title}"` };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
