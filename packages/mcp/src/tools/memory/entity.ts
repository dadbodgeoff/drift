/**
 * drift_entity
 * 
 * Track projects, products, teams, clients, and systems as first-class entities.
 * Enables context-aware interactions with entity knowledge.
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Relationship graph traversal
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface EntityRelationship {
  targetEntityId: string;
  targetEntityName: string;
  relationshipType: 'owns' | 'depends_on' | 'integrates_with' | 'managed_by' | 'related_to';
}

interface EntityConfig {
  id: string;
  entityType: 'project' | 'product' | 'team' | 'client' | 'vendor' | 'system' | 'service' | 'other';
  name: string;
  aliases?: string[] | undefined;
  attributes: Record<string, unknown>;
  status: 'active' | 'deprecated' | 'planned' | 'archived' | 'maintenance';
  keyFacts: string[];
  warnings?: string[] | undefined;
  owner?: string | undefined;
  domain?: string | undefined;
  relationships: EntityRelationship[];
  confidence: number;
  summary: string;
}

interface EntityResult {
  success: boolean;
  action: string;
  entity?: EntityConfig;
  entities?: EntityConfig[];
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

function compressEntity(entity: any, level: 1 | 2 | 3): EntityConfig {
  const base: EntityConfig = {
    id: entity.id,
    entityType: entity.entityType,
    name: entity.name,
    aliases: entity.aliases,
    attributes: entity.attributes || {},
    status: entity.status || 'active',
    keyFacts: entity.keyFacts || [],
    warnings: entity.warnings,
    owner: entity.owner,
    domain: entity.domain,
    relationships: entity.relationships || [],
    confidence: entity.confidence,
    summary: entity.summary,
  };

  if (level === 3) {
    return {
      ...base,
      aliases: undefined,
      attributes: {},
      keyFacts: base.keyFacts.slice(0, 2).map(f => f.slice(0, 50)),
      warnings: base.warnings?.slice(0, 1),
      relationships: base.relationships.slice(0, 3).map(r => ({
        targetEntityId: r.targetEntityId,
        targetEntityName: r.targetEntityName,
        relationshipType: r.relationshipType,
      })),
    };
  }

  if (level === 2) {
    return {
      ...base,
      aliases: base.aliases?.slice(0, 3),
      keyFacts: base.keyFacts.slice(0, 5),
      warnings: base.warnings?.slice(0, 3),
      relationships: base.relationships.slice(0, 5),
    };
  }

  return base;
}

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

// ============================================================================
// Tool Definition
// ============================================================================

export const driftEntity = {
  name: 'drift_entity',
  description: 'Track projects, products, teams, clients, and systems. Actions: create, get, list, update, link, search, relevant.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'get', 'list', 'update', 'link', 'search', 'relevant'] },
      entityType: { type: 'string', enum: ['project', 'product', 'team', 'client', 'vendor', 'system', 'service', 'other'] },
      name: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      attributes: { type: 'object' },
      status: { type: 'string', enum: ['active', 'deprecated', 'planned', 'archived', 'maintenance'] },
      keyFacts: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      owner: { type: 'string' },
      domain: { type: 'string' },
      id: { type: 'string' },
      targetEntityId: { type: 'string' },
      relationshipType: { type: 'string', enum: ['owns', 'depends_on', 'integrates_with', 'managed_by', 'related_to'] },
      query: { type: 'string' },
      typeFilter: { type: 'string', enum: ['project', 'product', 'team', 'client', 'vendor', 'system', 'service', 'other', 'all'] },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test'] },
      focus: { type: 'string' },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<EntityResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'create': {
        if (!params.entityType || !params.name || !params.keyFacts) {
          return { success: false, action: 'create', message: 'Missing required fields: entityType, name, keyFacts' };
        }
        const memory = {
          type: 'entity',
          entityType: params.entityType,
          name: params.name,
          aliases: params.aliases,
          attributes: params.attributes || {},
          status: params.status || 'active',
          keyFacts: params.keyFacts,
          warnings: params.warnings,
          owner: params.owner,
          domain: params.domain,
          relationships: [],
          summary: `📦 ${params.entityType}: ${params.name}`,
          confidence: 1.0,
          importance: 'normal',
        };
        const id = await cortex.add(memory as any);
        const entity = compressEntity({ ...memory, id }, compressionLevel);
        return { success: true, action: 'create', id, entity, message: `Created ${params.entityType} "${params.name}"`,
          tokensUsed: estimateTokens(entity), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'get': {
        if (!params.name && !params.id) return { success: false, action: 'get', message: 'Missing name or id' };
        let raw: any = null;
        if (params.id) {
          raw = await cortex.get(params.id);
        } else {
          const all = await cortex.search({ types: ['entity' as any], limit: 100 });
          const nameLower = params.name.toLowerCase();
          raw = all.find((e: any) => e.name?.toLowerCase() === nameLower || e.aliases?.some((a: string) => a.toLowerCase() === nameLower));
        }
        if (!raw) return { success: false, action: 'get', message: 'Entity not found' };
        const entity = compressEntity(raw, compressionLevel);
        return { success: true, action: 'get', entity, tokensUsed: estimateTokens(entity), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'list': {
        const all = await cortex.search({ types: ['entity' as any], limit: 100 });
        let filtered = params.typeFilter && params.typeFilter !== 'all' ? all.filter((e: any) => e.entityType === params.typeFilter) : all;
        let tokenBudget = maxTokens;
        const entities: EntityConfig[] = [];
        let deduplicatedCount = 0;
        for (const raw of filtered) {
          if (excludeIds.has(raw.id)) { deduplicatedCount++; continue; }
          const entity = compressEntity(raw, compressionLevel);
          const tokens = estimateTokens(entity);
          if (tokenBudget - tokens < 0 && entities.length > 0) break;
          entities.push(entity);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'list', entities, message: `Found ${entities.length} entities`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel, deduplicatedCount };
      }

      case 'update': {
        if (!params.id) return { success: false, action: 'update', message: 'Missing id' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'update', message: 'Entity not found' };
        const updates: any = {};
        if (params.name) updates.name = params.name;
        if (params.aliases) updates.aliases = params.aliases;
        if (params.attributes) updates.attributes = { ...raw.attributes, ...params.attributes };
        if (params.status) updates.status = params.status;
        if (params.keyFacts) updates.keyFacts = params.keyFacts;
        if (params.warnings) updates.warnings = params.warnings;
        if (params.owner) updates.owner = params.owner;
        updates.summary = `📦 ${raw.entityType}: ${params.name || raw.name}`;
        await cortex.update(params.id, updates);
        const entity = compressEntity({ ...raw, ...updates }, compressionLevel);
        return { success: true, action: 'update', entity, message: `Updated "${raw.name}"`,
          tokensUsed: estimateTokens(entity), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'link': {
        if (!params.id || !params.targetEntityId || !params.relationshipType) {
          return { success: false, action: 'link', message: 'Missing id, targetEntityId, or relationshipType' };
        }
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'link', message: 'Entity not found' };
        const target = await cortex.get(params.targetEntityId) as any;
        if (!target) return { success: false, action: 'link', message: 'Target entity not found' };
        const relationships = raw.relationships || [];
        relationships.push({
          targetEntityId: params.targetEntityId,
          targetEntityName: target.name,
          relationshipType: params.relationshipType,
        });
        await cortex.update(params.id, { relationships } as any);
        const entity = compressEntity({ ...raw, relationships }, compressionLevel);
        return { success: true, action: 'link', entity, message: `Linked "${raw.name}" ${params.relationshipType} "${target.name}"`,
          tokensUsed: estimateTokens(entity), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'search': {
        if (!params.query) return { success: false, action: 'search', message: 'Missing query' };
        const all = await cortex.search({ types: ['entity' as any], limit: 100 });
        const q = params.query.toLowerCase();
        const scored = all.filter((e: any) => !excludeIds.has(e.id)).map((e: any) => {
          let score = 0;
          if (e.name?.toLowerCase() === q) score += 100;
          else if (e.name?.toLowerCase().includes(q)) score += 50;
          if (e.aliases?.some((a: string) => a.toLowerCase().includes(q))) score += 40;
          if (e.keyFacts?.some((f: string) => f.toLowerCase().includes(q))) score += 20;
          if (e.domain?.toLowerCase().includes(q)) score += 15;
          return { entity: e, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        let tokenBudget = maxTokens;
        const entities: EntityConfig[] = [];
        for (const { entity: raw } of scored) {
          const entity = compressEntity(raw, compressionLevel);
          const tokens = estimateTokens(entity);
          if (tokenBudget - tokens < 0 && entities.length > 0) break;
          entities.push(entity);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'search', entities, message: `Found ${entities.length} matching`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) return { success: false, action: 'relevant', message: 'Missing intent or focus' };
        const result = await cortex.retrieval.retrieve({ intent: params.intent as Intent, focus: params.focus, maxTokens: maxTokens / 2 });
        const entities = result.memories.filter(m => m.memory.type === 'entity' && !excludeIds.has(m.memory.id))
          .slice(0, 10).map(m => compressEntity(m.memory, compressionLevel));
        return { success: true, action: 'relevant', entities, message: `Found ${entities.length} relevant entities`,
          tokensUsed: estimateTokens(entities), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
