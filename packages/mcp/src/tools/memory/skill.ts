/**
 * drift_skill
 * 
 * Track knowledge domains with proficiency levels and learning resources.
 * Enables tailored explanations and learning path suggestions.
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Learning path tracking
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface SkillResource {
  title: string;
  url?: string | undefined;
  type: 'documentation' | 'tutorial' | 'reference' | 'example' | 'video' | 'book';
  recommended: boolean;
}

interface SkillConfig {
  id: string;
  name: string;
  domain: string;
  subdomain?: string | undefined;
  proficiencyLevel: 'learning' | 'beginner' | 'competent' | 'proficient' | 'expert';
  keyPrinciples?: string[] | undefined;
  commonPatterns?: string[] | undefined;
  antiPatterns?: string[] | undefined;
  gotchas?: string[] | undefined;
  resources?: SkillResource[] | undefined;
  prerequisites?: string[] | undefined;
  nextToLearn?: string[] | undefined;
  relatedSkills?: string[] | undefined;
  scope: 'personal' | 'team' | 'organization';
  confidence: number;
  summary: string;
}

interface SkillResult {
  success: boolean;
  action: string;
  skill?: SkillConfig;
  skills?: SkillConfig[];
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

function compressSkill(skill: any, level: 1 | 2 | 3): SkillConfig {
  const base: SkillConfig = {
    id: skill.id,
    name: skill.name,
    domain: skill.domain,
    subdomain: skill.subdomain,
    proficiencyLevel: skill.proficiencyLevel || 'learning',
    keyPrinciples: skill.keyPrinciples,
    commonPatterns: skill.commonPatterns,
    antiPatterns: skill.antiPatterns,
    gotchas: skill.gotchas,
    resources: skill.resources,
    prerequisites: skill.prerequisites,
    nextToLearn: skill.nextToLearn,
    relatedSkills: skill.relatedSkills,
    scope: skill.scope || 'personal',
    confidence: skill.confidence,
    summary: skill.summary,
  };

  if (level === 3) {
    return {
      ...base,
      keyPrinciples: base.keyPrinciples?.slice(0, 2).map(p => p.slice(0, 50)),
      commonPatterns: base.commonPatterns?.slice(0, 2),
      antiPatterns: base.antiPatterns?.slice(0, 2),
      gotchas: base.gotchas?.slice(0, 2),
      resources: base.resources?.filter(r => r.recommended).slice(0, 2).map(r => ({
        title: r.title.slice(0, 30),
        type: r.type,
        recommended: r.recommended,
      })) as SkillResource[] | undefined,
      prerequisites: base.prerequisites?.slice(0, 2),
      nextToLearn: base.nextToLearn?.slice(0, 2),
      relatedSkills: undefined,
    };
  }

  if (level === 2) {
    return {
      ...base,
      keyPrinciples: base.keyPrinciples?.slice(0, 5),
      commonPatterns: base.commonPatterns?.slice(0, 5),
      antiPatterns: base.antiPatterns?.slice(0, 3),
      gotchas: base.gotchas?.slice(0, 3),
      resources: base.resources?.slice(0, 5),
      prerequisites: base.prerequisites?.slice(0, 3),
      nextToLearn: base.nextToLearn?.slice(0, 3),
      relatedSkills: base.relatedSkills?.slice(0, 5),
    };
  }

  return base;
}

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

const PROFICIENCY_ORDER: Record<string, number> = { expert: 0, proficient: 1, competent: 2, beginner: 3, learning: 4 };

// ============================================================================
// Tool Definition
// ============================================================================

export const driftSkill = {
  name: 'drift_skill',
  description: 'Track knowledge domains with proficiency levels and learning resources. Actions: create, get, list, update, add_resource, relevant.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'get', 'list', 'update', 'add_resource', 'relevant'] },
      name: { type: 'string' },
      domain: { type: 'string' },
      subdomain: { type: 'string' },
      proficiencyLevel: { type: 'string', enum: ['learning', 'beginner', 'competent', 'proficient', 'expert'] },
      keyPrinciples: { type: 'array', items: { type: 'string' } },
      commonPatterns: { type: 'array', items: { type: 'string' } },
      antiPatterns: { type: 'array', items: { type: 'string' } },
      gotchas: { type: 'array', items: { type: 'string' } },
      prerequisites: { type: 'array', items: { type: 'string' } },
      nextToLearn: { type: 'array', items: { type: 'string' } },
      relatedSkills: { type: 'array', items: { type: 'string' } },
      scope: { type: 'string', enum: ['personal', 'team', 'organization'] },
      id: { type: 'string' },
      resource: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, type: { type: 'string' }, recommended: { type: 'boolean' } } },
      query: { type: 'string' },
      domainFilter: { type: 'string' },
      proficiencyFilter: { type: 'string', enum: ['learning', 'beginner', 'competent', 'proficient', 'expert', 'all'] },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test', 'learn'] },
      focus: { type: 'string' },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<SkillResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'create': {
        if (!params.name || !params.domain) {
          return { success: false, action: 'create', message: 'Missing required fields: name, domain' };
        }
        const memory = {
          type: 'skill',
          name: params.name,
          domain: params.domain,
          subdomain: params.subdomain,
          proficiencyLevel: params.proficiencyLevel || 'learning',
          keyPrinciples: params.keyPrinciples,
          commonPatterns: params.commonPatterns,
          antiPatterns: params.antiPatterns,
          gotchas: params.gotchas,
          resources: [],
          prerequisites: params.prerequisites,
          nextToLearn: params.nextToLearn,
          relatedSkills: params.relatedSkills,
          scope: params.scope || 'personal',
          summary: `🧠 ${params.name}: ${params.proficiencyLevel || 'learning'}`,
          confidence: 1.0,
          importance: 'normal',
        };
        const id = await cortex.add(memory as any);
        const skill = compressSkill({ ...memory, id }, compressionLevel);
        return { success: true, action: 'create', id, skill, message: `Created skill "${params.name}"`,
          tokensUsed: estimateTokens(skill), retrievalTimeMs: Date.now() - startTime, compressionLevel, sessionId: params.sessionId };
      }

      case 'get': {
        if (!params.name && !params.id) return { success: false, action: 'get', message: 'Missing name or id' };
        let raw: any = null;
        if (params.id) {
          raw = await cortex.get(params.id);
        } else {
          const all = await cortex.search({ types: ['skill' as any], limit: 100 });
          raw = all.find((s: any) => s.name?.toLowerCase() === params.name.toLowerCase());
        }
        if (!raw) return { success: false, action: 'get', message: 'Skill not found' };
        const skill = compressSkill(raw, compressionLevel);
        return { success: true, action: 'get', skill, tokensUsed: estimateTokens(skill), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'list': {
        const all = await cortex.search({ types: ['skill' as any], limit: 100 });
        let filtered = all;
        if (params.domainFilter) {
          filtered = filtered.filter((s: any) => s.domain?.toLowerCase() === params.domainFilter.toLowerCase());
        }
        if (params.proficiencyFilter && params.proficiencyFilter !== 'all') {
          filtered = filtered.filter((s: any) => s.proficiencyLevel === params.proficiencyFilter);
        }
        filtered.sort((a: any, b: any) => (PROFICIENCY_ORDER[a.proficiencyLevel] ?? 5) - (PROFICIENCY_ORDER[b.proficiencyLevel] ?? 5));
        let tokenBudget = maxTokens;
        const skills: SkillConfig[] = [];
        let deduplicatedCount = 0;
        for (const raw of filtered) {
          if (excludeIds.has(raw.id)) { deduplicatedCount++; continue; }
          const skill = compressSkill(raw, compressionLevel);
          const tokens = estimateTokens(skill);
          if (tokenBudget - tokens < 0 && skills.length > 0) break;
          skills.push(skill);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'list', skills, message: `Found ${skills.length} skills`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel, deduplicatedCount };
      }

      case 'update': {
        if (!params.id) return { success: false, action: 'update', message: 'Missing id' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'update', message: 'Skill not found' };
        const updates: any = {};
        if (params.proficiencyLevel) updates.proficiencyLevel = params.proficiencyLevel;
        if (params.keyPrinciples) updates.keyPrinciples = params.keyPrinciples;
        if (params.commonPatterns) updates.commonPatterns = params.commonPatterns;
        if (params.antiPatterns) updates.antiPatterns = params.antiPatterns;
        if (params.gotchas) updates.gotchas = params.gotchas;
        if (params.nextToLearn) updates.nextToLearn = params.nextToLearn;
        updates.summary = `🧠 ${raw.name}: ${params.proficiencyLevel || raw.proficiencyLevel}`;
        await cortex.update(params.id, updates);
        const skill = compressSkill({ ...raw, ...updates }, compressionLevel);
        return { success: true, action: 'update', skill, message: `Updated skill "${raw.name}"`,
          tokensUsed: estimateTokens(skill), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'add_resource': {
        if (!params.id || !params.resource) return { success: false, action: 'add_resource', message: 'Missing id or resource' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'add_resource', message: 'Skill not found' };
        const resources = raw.resources || [];
        resources.push({
          title: params.resource.title,
          url: params.resource.url,
          type: params.resource.type || 'reference',
          recommended: params.resource.recommended ?? false,
        });
        await cortex.update(params.id, { resources } as any);
        return { success: true, action: 'add_resource', message: `Added resource to "${raw.name}"`, retrievalTimeMs: Date.now() - startTime };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) return { success: false, action: 'relevant', message: 'Missing intent or focus' };
        const result = await cortex.retrieval.retrieve({ intent: params.intent as Intent, focus: params.focus, maxTokens: maxTokens / 2 });
        const skills = result.memories.filter(m => m.memory.type === 'skill' && !excludeIds.has(m.memory.id))
          .slice(0, 10).map(m => compressSkill(m.memory, compressionLevel));
        return { success: true, action: 'relevant', skills, message: `Found ${skills.length} relevant skills`,
          tokensUsed: estimateTokens(skills), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
