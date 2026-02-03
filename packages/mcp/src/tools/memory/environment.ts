/**
 * drift_environment
 * 
 * Store environment configurations, access instructions, and warnings.
 * Enables context-aware environment interactions.
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Security-aware credential handling (location only, never actual secrets)
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface CredentialInfo {
  type: string;
  location: string;  // Where to find them, NOT the actual credentials
  rotationSchedule?: string | undefined;
}

interface EnvironmentConfig {
  id: string;
  name: string;
  environmentType: 'production' | 'staging' | 'development' | 'testing' | 'sandbox' | 'other';
  config: Record<string, unknown>;
  accessInstructions?: string | undefined;
  credentials?: CredentialInfo | undefined;
  warnings: string[];
  restrictions?: string[] | undefined;
  dependsOn?: string[] | undefined;
  usedBy?: string[] | undefined;
  endpoints?: Record<string, string> | undefined;
  healthCheckUrl?: string | undefined;
  lastVerified?: string | undefined;
  status?: 'healthy' | 'degraded' | 'down' | 'unknown' | undefined;
  owner?: string | undefined;
  confidence: number;
  summary: string;
}

interface EnvironmentResult {
  success: boolean;
  action: string;
  environment?: EnvironmentConfig;
  environments?: EnvironmentConfig[];
  id?: string;
  message?: string;
  tokensUsed?: number;
  retrievalTimeMs?: number;
  compressionLevel?: number;
  sessionId?: string | undefined;
  deduplicatedCount?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function compressEnvironment(env: any, level: 1 | 2 | 3): EnvironmentConfig {
  const base: EnvironmentConfig = {
    id: env.id,
    name: env.name,
    environmentType: env.environmentType || 'other',
    config: env.config || {},
    accessInstructions: env.accessInstructions,
    credentials: env.credentials,
    warnings: env.warnings || [],
    restrictions: env.restrictions,
    dependsOn: env.dependsOn,
    usedBy: env.usedBy,
    endpoints: env.endpoints,
    healthCheckUrl: env.healthCheckUrl,
    lastVerified: env.lastVerified,
    status: env.status,
    owner: env.owner,
    confidence: env.confidence,
    summary: env.summary,
  };

  if (level === 3) {
    return {
      ...base,
      config: {},  // Omit config details at max compression
      accessInstructions: base.accessInstructions?.slice(0, 50),
      credentials: base.credentials ? { type: base.credentials.type, location: '[redacted]' } : undefined,
      warnings: base.warnings.slice(0, 2).map(w => w.slice(0, 50)),
      restrictions: base.restrictions?.slice(0, 2),
      dependsOn: base.dependsOn?.slice(0, 2),
      usedBy: undefined,
      endpoints: undefined,
    };
  }

  if (level === 2) {
    return {
      ...base,
      accessInstructions: base.accessInstructions?.slice(0, 200),
      warnings: base.warnings.slice(0, 5),
      restrictions: base.restrictions?.slice(0, 5),
      dependsOn: base.dependsOn?.slice(0, 5),
      usedBy: base.usedBy?.slice(0, 5),
    };
  }

  return base;
}

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

const ENV_TYPE_ORDER: Record<string, number> = { production: 0, staging: 1, development: 2, testing: 3, sandbox: 4, other: 5 };

// ============================================================================
// Tool Definition
// ============================================================================

export const driftEnvironment = {
  name: 'drift_environment',
  description: 'Store environment configurations, access instructions, and warnings. Actions: create, get, list, update, check_health, relevant.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'get', 'list', 'update', 'check_health', 'relevant'] },
      name: { type: 'string' },
      environmentType: { type: 'string', enum: ['production', 'staging', 'development', 'testing', 'sandbox', 'other'] },
      config: { type: 'object' },
      accessInstructions: { type: 'string' },
      credentials: { type: 'object', properties: { type: { type: 'string' }, location: { type: 'string' }, rotationSchedule: { type: 'string' } } },
      warnings: { type: 'array', items: { type: 'string' } },
      restrictions: { type: 'array', items: { type: 'string' } },
      dependsOn: { type: 'array', items: { type: 'string' } },
      usedBy: { type: 'array', items: { type: 'string' } },
      endpoints: { type: 'object' },
      healthCheckUrl: { type: 'string' },
      owner: { type: 'string' },
      id: { type: 'string' },
      status: { type: 'string', enum: ['healthy', 'degraded', 'down', 'unknown'] },
      query: { type: 'string' },
      typeFilter: { type: 'string', enum: ['production', 'staging', 'development', 'testing', 'sandbox', 'other', 'all'] },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test', 'deploy'] },
      focus: { type: 'string' },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<EnvironmentResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'create': {
        if (!params.name || !params.environmentType) {
          return { success: false, action: 'create', message: 'Missing required fields: name, environmentType' };
        }
        const memory = {
          type: 'environment',
          name: params.name,
          environmentType: params.environmentType,
          config: params.config || {},
          accessInstructions: params.accessInstructions,
          credentials: params.credentials,
          warnings: params.warnings || [],
          restrictions: params.restrictions,
          dependsOn: params.dependsOn,
          usedBy: params.usedBy,
          endpoints: params.endpoints,
          healthCheckUrl: params.healthCheckUrl,
          status: 'unknown',
          owner: params.owner,
          summary: `🌍 ${params.environmentType}: ${params.name}`,
          confidence: 1.0,
          importance: params.environmentType === 'production' ? 'high' : 'normal',
        };
        const id = await cortex.add(memory as any);
        const environment = compressEnvironment({ ...memory, id }, compressionLevel);
        return { success: true, action: 'create', id, environment, message: `Created environment "${params.name}"`,
          tokensUsed: estimateTokens(environment), retrievalTimeMs: Date.now() - startTime, compressionLevel, sessionId: params.sessionId };
      }

      case 'get': {
        if (!params.name && !params.id) return { success: false, action: 'get', message: 'Missing name or id' };
        let raw: any = null;
        if (params.id) {
          raw = await cortex.get(params.id);
        } else {
          const all = await cortex.search({ types: ['environment' as any], limit: 100 });
          raw = all.find((e: any) => e.name?.toLowerCase() === params.name.toLowerCase());
        }
        if (!raw) return { success: false, action: 'get', message: 'Environment not found' };
        const environment = compressEnvironment(raw, compressionLevel);
        return { success: true, action: 'get', environment, tokensUsed: estimateTokens(environment), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'list': {
        const all = await cortex.search({ types: ['environment' as any], limit: 100 });
        let filtered = params.typeFilter && params.typeFilter !== 'all' ? all.filter((e: any) => e.environmentType === params.typeFilter) : all;
        filtered.sort((a: any, b: any) => (ENV_TYPE_ORDER[a.environmentType] ?? 6) - (ENV_TYPE_ORDER[b.environmentType] ?? 6));
        let tokenBudget = maxTokens;
        const environments: EnvironmentConfig[] = [];
        let deduplicatedCount = 0;
        for (const raw of filtered) {
          if (excludeIds.has(raw.id)) { deduplicatedCount++; continue; }
          const environment = compressEnvironment(raw, compressionLevel);
          const tokens = estimateTokens(environment);
          if (tokenBudget - tokens < 0 && environments.length > 0) break;
          environments.push(environment);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'list', environments, message: `Found ${environments.length} environments`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel, deduplicatedCount };
      }

      case 'update': {
        if (!params.id) return { success: false, action: 'update', message: 'Missing id' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'update', message: 'Environment not found' };
        const updates: any = {};
        if (params.config) updates.config = { ...raw.config, ...params.config };
        if (params.accessInstructions) updates.accessInstructions = params.accessInstructions;
        if (params.credentials) updates.credentials = params.credentials;
        if (params.warnings) updates.warnings = params.warnings;
        if (params.restrictions) updates.restrictions = params.restrictions;
        if (params.endpoints) updates.endpoints = { ...raw.endpoints, ...params.endpoints };
        if (params.status) updates.status = params.status;
        if (params.owner) updates.owner = params.owner;
        await cortex.update(params.id, updates);
        const environment = compressEnvironment({ ...raw, ...updates }, compressionLevel);
        return { success: true, action: 'update', environment, message: `Updated environment "${raw.name}"`,
          tokensUsed: estimateTokens(environment), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'check_health': {
        if (!params.id) return { success: false, action: 'check_health', message: 'Missing id' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'check_health', message: 'Environment not found' };
        
        // Update last verified timestamp
        const updates: any = {
          lastVerified: new Date().toISOString(),
          status: params.status || raw.status || 'unknown',
        };
        await cortex.update(params.id, updates);
        
        const environment = compressEnvironment({ ...raw, ...updates }, compressionLevel);
        return { success: true, action: 'check_health', environment, 
          message: `Health check recorded for "${raw.name}": ${updates.status}`,
          tokensUsed: estimateTokens(environment), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) return { success: false, action: 'relevant', message: 'Missing intent or focus' };
        const result = await cortex.retrieval.retrieve({ intent: params.intent as Intent, focus: params.focus, maxTokens: maxTokens / 2 });
        const environments = result.memories.filter(m => m.memory.type === 'environment' && !excludeIds.has(m.memory.id))
          .slice(0, 10).map(m => compressEnvironment(m.memory, compressionLevel));
        return { success: true, action: 'relevant', environments, message: `Found ${environments.length} relevant environments`,
          tokensUsed: estimateTokens(environments), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
