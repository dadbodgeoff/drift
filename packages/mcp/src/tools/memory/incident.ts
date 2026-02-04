/**
 * drift_incident
 * 
 * Record and retrieve incident postmortems for proactive warnings.
 * Enables learning from past problems.
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Proactive warning system based on context matching
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface IncidentConfig {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  incidentType?: 'outage' | 'security' | 'data_loss' | 'performance' | 'integration' | 'other' | undefined;
  detectedAt: string;
  resolvedAt?: string | undefined;
  duration?: string | undefined;
  impact: string;
  affectedSystems: string[];
  rootCause?: string | undefined;
  contributingFactors?: string[] | undefined;
  resolution: string;
  lessonsLearned: string[];
  warningTriggers: string[];
  confidence: number;
  summary: string;
}

interface IncidentWarning {
  incident: IncidentConfig;
  matchedTrigger: string;
  relevanceScore: number;
}

interface IncidentResult {
  success: boolean;
  action: string;
  incident?: IncidentConfig;
  incidents?: IncidentConfig[];
  warnings?: IncidentWarning[];
  id?: string;
  message?: string;
  tokensUsed?: number;
  retrievalTimeMs?: number;
  compressionLevel?: number;
  sessionId?: string;
  deduplicatedCount?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function compressIncident(incident: any, level: 1 | 2 | 3): IncidentConfig {
  const base: IncidentConfig = {
    id: incident.id,
    title: incident.title,
    severity: incident.severity,
    incidentType: incident.incidentType,
    detectedAt: incident.detectedAt,
    resolvedAt: incident.resolvedAt,
    duration: incident.duration,
    impact: incident.impact || '',
    affectedSystems: incident.affectedSystems || [],
    rootCause: incident.rootCause,
    contributingFactors: incident.contributingFactors,
    resolution: incident.resolution || '',
    lessonsLearned: incident.lessonsLearned || [],
    warningTriggers: incident.warningTriggers || [],
    confidence: incident.confidence,
    summary: incident.summary,
  };

  if (level === 3) {
    return {
      ...base,
      impact: base.impact.slice(0, 50) + (base.impact.length > 50 ? '...' : ''),
      affectedSystems: base.affectedSystems.slice(0, 3),
      rootCause: base.rootCause?.slice(0, 50),
      contributingFactors: undefined,
      resolution: base.resolution.slice(0, 50) + (base.resolution.length > 50 ? '...' : ''),
      lessonsLearned: base.lessonsLearned.slice(0, 2).map(l => l.slice(0, 50)),
      warningTriggers: base.warningTriggers.slice(0, 3),
    };
  }

  if (level === 2) {
    return {
      ...base,
      impact: base.impact.slice(0, 150) + (base.impact.length > 150 ? '...' : ''),
      affectedSystems: base.affectedSystems.slice(0, 5),
      contributingFactors: base.contributingFactors?.slice(0, 3),
      lessonsLearned: base.lessonsLearned.slice(0, 5),
      warningTriggers: base.warningTriggers.slice(0, 5),
    };
  }

  return base;
}

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ============================================================================
// Tool Definition
// ============================================================================

export const driftIncident = {
  name: 'drift_incident',
  description: 'Record and retrieve incident postmortems. Actions: record, get, list, search, warnings, resolve, add_lesson, relevant.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['record', 'get', 'list', 'search', 'warnings', 'resolve', 'add_lesson', 'relevant'] },
      title: { type: 'string' },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      incidentType: { type: 'string', enum: ['outage', 'security', 'data_loss', 'performance', 'integration', 'other'] },
      impact: { type: 'string' },
      affectedSystems: { type: 'array', items: { type: 'string' } },
      rootCause: { type: 'string' },
      contributingFactors: { type: 'array', items: { type: 'string' } },
      resolution: { type: 'string' },
      lessonsLearned: { type: 'array', items: { type: 'string' } },
      warningTriggers: { type: 'array', items: { type: 'string' } },
      id: { type: 'string' },
      lesson: { type: 'string' },
      query: { type: 'string' },
      severityFilter: { type: 'string', enum: ['low', 'medium', 'high', 'critical', 'all'] },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test', 'diagnose_issue'] },
      focus: { type: 'string' },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<IncidentResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'record': {
        if (!params.title || !params.severity || !params.impact || !params.resolution || !params.lessonsLearned) {
          return { success: false, action: 'record', message: 'Missing required fields' };
        }
        const memory = {
          type: 'incident', title: params.title, severity: params.severity, incidentType: params.incidentType,
          detectedAt: new Date().toISOString(), impact: params.impact, affectedSystems: params.affectedSystems || [],
          rootCause: params.rootCause, contributingFactors: params.contributingFactors, resolution: params.resolution,
          lessonsLearned: params.lessonsLearned, warningTriggers: params.warningTriggers || [],
          summary: `🚨 ${params.severity}: ${params.title}`, confidence: 1.0,
          importance: params.severity === 'critical' ? 'critical' : 'high',
        };
        const id = await cortex.add(memory as any);
        const incident = compressIncident({ ...memory, id }, compressionLevel);
        return { success: true, action: 'record', id, incident, message: `Recorded incident "${params.title}"`,
          tokensUsed: estimateTokens(incident), retrievalTimeMs: Date.now() - startTime, compressionLevel, sessionId: params.sessionId };
      }

      case 'get': {
        if (!params.id) return { success: false, action: 'get', message: 'Missing id' };
        const raw = await cortex.get(params.id);
        if (!raw) return { success: false, action: 'get', message: 'Not found' };
        const incident = compressIncident(raw, compressionLevel);
        return { success: true, action: 'get', incident, tokensUsed: estimateTokens(incident), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'list': {
        const all = await cortex.search({ types: ['incident' as any], limit: 100 });
        let filtered = params.severityFilter && params.severityFilter !== 'all' ? all.filter((i: any) => i.severity === params.severityFilter) : all;
        filtered.sort((a: any, b: any) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4));
        let tokenBudget = maxTokens;
        const incidents: IncidentConfig[] = [];
        let deduplicatedCount = 0;
        for (const raw of filtered) {
          if (excludeIds.has(raw.id)) { deduplicatedCount++; continue; }
          const incident = compressIncident(raw, compressionLevel);
          const tokens = estimateTokens(incident);
          if (tokenBudget - tokens < 0 && incidents.length > 0) break;
          incidents.push(incident);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'list', incidents, message: `Found ${incidents.length} incidents`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel, deduplicatedCount };
      }

      case 'search': {
        if (!params.query) return { success: false, action: 'search', message: 'Missing query' };
        const all = await cortex.search({ types: ['incident' as any], limit: 100 });
        const q = params.query.toLowerCase();
        const scored = all.filter((i: any) => !excludeIds.has(i.id)).map((i: any) => {
          let score = 0;
          if (i.title?.toLowerCase().includes(q)) score += 50;
          if (i.impact?.toLowerCase().includes(q)) score += 30;
          if (i.rootCause?.toLowerCase().includes(q)) score += 40;
          if (i.affectedSystems?.some((s: string) => s.toLowerCase().includes(q))) score += 35;
          return { incident: i, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        let tokenBudget = maxTokens;
        const incidents: IncidentConfig[] = [];
        for (const { incident: raw } of scored) {
          const incident = compressIncident(raw, compressionLevel);
          const tokens = estimateTokens(incident);
          if (tokenBudget - tokens < 0 && incidents.length > 0) break;
          incidents.push(incident);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'search', incidents, message: `Found ${incidents.length} matching`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'warnings': {
        if (!params.query) return { success: false, action: 'warnings', message: 'Missing query' };
        const all = await cortex.search({ types: ['incident' as any], limit: 100 });
        const q = params.query.toLowerCase();
        const warnings: IncidentWarning[] = [];
        for (const raw of all) {
          if (excludeIds.has(raw.id)) continue;
          const rawAny = raw as any;
          let trigger: string | null = null;
          let score = 0;
          for (const t of rawAny.warningTriggers || []) {
            if (q.includes(t.toLowerCase())) { trigger = t; score = 1.0; break; }
          }
          if (!trigger) {
            for (const s of rawAny.affectedSystems || []) {
              if (q.includes(s.toLowerCase())) { trigger = `system: ${s}`; score = 0.8; break; }
            }
          }
          if (trigger) {
            const incident = compressIncident(raw, compressionLevel);
            score *= (5 - (SEVERITY_ORDER[incident.severity] ?? 4)) / 4;
            warnings.push({ incident, matchedTrigger: trigger, relevanceScore: score });
          }
        }
        warnings.sort((a, b) => b.relevanceScore - a.relevanceScore);
        let tokenBudget = maxTokens;
        const filtered: IncidentWarning[] = [];
        for (const w of warnings) {
          const tokens = estimateTokens(w);
          if (tokenBudget - tokens < 0 && filtered.length > 0) break;
          filtered.push(w);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'warnings', warnings: filtered,
          message: filtered.length > 0 ? `⚠️ Found ${filtered.length} relevant incidents` : 'No relevant incidents',
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'resolve': {
        if (!params.id || !params.resolution) return { success: false, action: 'resolve', message: 'Missing id or resolution' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'resolve', message: 'Not found' };
        const resolvedAt = new Date().toISOString();
        const duration = raw.detectedAt ? `${Math.round((new Date(resolvedAt).getTime() - new Date(raw.detectedAt).getTime()) / 60000)} minutes` : undefined;
        await cortex.update(params.id, { resolvedAt, duration, resolution: params.resolution } as any);
        const incident = compressIncident({ ...raw, resolvedAt, duration, resolution: params.resolution }, compressionLevel);
        return { success: true, action: 'resolve', incident, message: `Resolved "${raw.title}"`, retrievalTimeMs: Date.now() - startTime };
      }

      case 'add_lesson': {
        if (!params.id || !params.lesson) return { success: false, action: 'add_lesson', message: 'Missing id or lesson' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'add_lesson', message: 'Not found' };
        const lessonsLearned = [...(raw.lessonsLearned || []), params.lesson];
        await cortex.update(params.id, { lessonsLearned } as any);
        return { success: true, action: 'add_lesson', message: `Added lesson to "${raw.title}"`, retrievalTimeMs: Date.now() - startTime };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) return { success: false, action: 'relevant', message: 'Missing intent or focus' };
        const result = await cortex.retrieval.retrieve({ intent: params.intent as Intent, focus: params.focus, maxTokens: maxTokens / 2 });
        const incidents = result.memories.filter(m => m.memory.type === 'incident' && !excludeIds.has(m.memory.id))
          .slice(0, 10).map(m => compressIncident(m.memory, compressionLevel));
        return { success: true, action: 'relevant', incidents, message: `Found ${incidents.length} relevant incidents`,
          tokensUsed: estimateTokens(incidents), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
