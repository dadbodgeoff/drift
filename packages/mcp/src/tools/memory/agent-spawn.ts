/**
 * drift_agent_spawn
 * 
 * Create, retrieve, and invoke agent spawn configurations.
 * Enables "spawn my code reviewer" workflows.
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Causal chain support for spawn history
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface AgentSpawnStats {
  invocationCount: number;
  successRate: number;
  avgDurationMs: number;
  lastInvoked?: string;
}

interface AgentSpawnConfig {
  id: string;
  name: string;
  description: string;
  slug: string;
  systemPrompt: string;
  tools: string[];
  constraints?: string[] | undefined;
  triggerPatterns: string[];
  autoSpawn: boolean;
  inheritMemoryTypes?: string[] | undefined;
  inheritDepth?: number | undefined;
  pinnedMemories?: string[] | undefined;
  version: string;
  stats: AgentSpawnStats;
  confidence: number;
  summary: string;
}

interface AgentSpawnResult {
  success: boolean;
  action: string;
  agent?: AgentSpawnConfig;
  agents?: AgentSpawnConfig[];
  id?: string;
  message?: string;
  // Enterprise metadata
  tokensUsed?: number;
  retrievalTimeMs?: number;
  compressionLevel?: number;
  sessionId?: string | undefined;
  deduplicatedCount?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function compressAgent(agent: any, level: 1 | 2 | 3): AgentSpawnConfig {
  const base: AgentSpawnConfig = {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    slug: agent.slug,
    systemPrompt: agent.systemPrompt,
    tools: agent.tools,
    constraints: agent.constraints,
    triggerPatterns: agent.triggerPatterns,
    autoSpawn: agent.autoSpawn ?? false,
    inheritMemoryTypes: agent.inheritMemoryTypes,
    inheritDepth: agent.inheritDepth,
    pinnedMemories: agent.pinnedMemories,
    version: agent.version || '1.0.0',
    stats: agent.stats || { invocationCount: 0, successRate: 1.0, avgDurationMs: 0 },
    confidence: agent.confidence,
    summary: agent.summary,
  };

  // Level 3: Maximum compression - only essential fields
  if (level === 3) {
    return {
      ...base,
      description: base.description.slice(0, 50) + (base.description.length > 50 ? '...' : ''),
      systemPrompt: base.systemPrompt.slice(0, 100) + (base.systemPrompt.length > 100 ? '...' : ''),
      tools: base.tools.slice(0, 5),
      triggerPatterns: base.triggerPatterns.slice(0, 3),
      constraints: undefined,
      inheritMemoryTypes: undefined,
      pinnedMemories: undefined,
    };
  }

  // Level 2: Moderate compression
  if (level === 2) {
    return {
      ...base,
      description: base.description.slice(0, 150) + (base.description.length > 150 ? '...' : ''),
      systemPrompt: base.systemPrompt.slice(0, 300) + (base.systemPrompt.length > 300 ? '...' : ''),
      constraints: base.constraints?.slice(0, 5),
    };
  }

  // Level 1: Full detail
  return base;
}

function estimateTokens(obj: unknown): number {
  const str = JSON.stringify(obj);
  return Math.ceil(str.length / 4);
}

// ============================================================================
// Tool Definition
// ============================================================================

export const driftAgentSpawn = {
  name: 'drift_agent_spawn',
  description: 'Create, retrieve, list, or invoke agent spawn configurations. Use for "spawn my X" workflows. Actions: create (new agent config), get (by slug), list (all agents), search (by trigger phrase), suggest (find best agent for intent).',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'get', 'list', 'search', 'suggest', 'update_stats'],
        description: 'Action to perform',
      },
      // Create params
      name: { type: 'string', description: 'Agent display name (for create)' },
      description: { type: 'string', description: 'What this agent does (for create)' },
      slug: { type: 'string', description: 'Unique slug for invocation (for create/get)' },
      systemPrompt: { type: 'string', description: 'Agent system prompt / personality (for create)' },
      tools: { type: 'array', items: { type: 'string' }, description: 'Tools this agent can use (for create)' },
      constraints: { type: 'array', items: { type: 'string' }, description: 'Things this agent cannot do (for create)' },
      triggerPatterns: { type: 'array', items: { type: 'string' }, description: 'Phrases that invoke this agent (for create/search)' },
      autoSpawn: { type: 'boolean', default: false, description: 'Auto-spawn on trigger match (for create)' },
      inheritMemoryTypes: { type: 'array', items: { type: 'string' }, description: 'Memory types to inherit when spawned (for create)' },
      inheritDepth: { type: 'number', default: 2, description: 'Depth of memory inheritance (for create)' },
      pinnedMemories: { type: 'array', items: { type: 'string' }, description: 'Memory IDs always included (for create)' },
      // Search/suggest params
      query: { type: 'string', description: 'Search query for trigger patterns (for search)' },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test'], description: 'Intent for agent suggestion (for suggest)' },
      focus: { type: 'string', description: 'Focus area for agent suggestion (for suggest)' },
      // Update stats params
      id: { type: 'string', description: 'Agent ID (for update_stats)' },
      success: { type: 'boolean', description: 'Whether invocation was successful (for update_stats)' },
      durationMs: { type: 'number', description: 'Invocation duration in ms (for update_stats)' },
      // Enterprise params
      maxTokens: { type: 'number', default: 2000, description: 'Maximum tokens for response' },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2, description: 'Compression level (1=full, 2=moderate, 3=minimal)' },
      sessionId: { type: 'string', description: 'Session ID for deduplication tracking' },
      excludeIds: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to exclude (already sent)' },
    },
    required: ['action'],
  },

  async execute(params: {
    action: string;
    name?: string;
    description?: string;
    slug?: string;
    systemPrompt?: string;
    tools?: string[];
    constraints?: string[];
    triggerPatterns?: string[];
    autoSpawn?: boolean;
    inheritMemoryTypes?: string[];
    inheritDepth?: number;
    pinnedMemories?: string[];
    query?: string;
    intent?: string;
    focus?: string;
    id?: string;
    success?: boolean;
    durationMs?: number;
    maxTokens?: number;
    compressionLevel?: 1 | 2 | 3;
    sessionId?: string;
    excludeIds?: string[];
  }): Promise<AgentSpawnResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'create': {
        if (!params.name || !params.slug || !params.systemPrompt || !params.tools || !params.triggerPatterns) {
          return { success: false, action: 'create', message: 'Missing required fields: name, slug, systemPrompt, tools, triggerPatterns' };
        }

        const memory = {
          type: 'agent_spawn',
          name: params.name,
          description: params.description || '',
          slug: params.slug,
          systemPrompt: params.systemPrompt,
          tools: params.tools,
          constraints: params.constraints,
          triggerPatterns: params.triggerPatterns,
          autoSpawn: params.autoSpawn ?? false,
          inheritMemoryTypes: params.inheritMemoryTypes,
          inheritDepth: params.inheritDepth ?? 2,
          pinnedMemories: params.pinnedMemories,
          version: '1.0.0',
          stats: { invocationCount: 0, successRate: 1.0, avgDurationMs: 0 },
          summary: `🤖 ${params.name}: ${params.tools.length} tools`,
          confidence: 1.0,
          importance: 'high',
        };

        const id = await cortex.add(memory as any);
        const agent = compressAgent({ ...memory, id }, compressionLevel);

        return {
          success: true,
          action: 'create',
          id,
          agent,
          message: `Created agent "${params.name}" with slug "${params.slug}"`,
          tokensUsed: estimateTokens(agent),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'get': {
        if (!params.slug) {
          return { success: false, action: 'get', message: 'Missing required field: slug' };
        }

        const agents = await cortex.search({ types: ['agent_spawn' as any], limit: 100 });
        const rawAgent = agents.find((a: any) => a.slug === params.slug);

        if (!rawAgent) {
          return { success: false, action: 'get', message: `Agent with slug "${params.slug}" not found` };
        }

        const agent = compressAgent(rawAgent, compressionLevel);
        return {
          success: true,
          action: 'get',
          agent,
          tokensUsed: estimateTokens(agent),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'list': {
        const allAgents = await cortex.search({ types: ['agent_spawn' as any], limit: 100 });
        
        // Filter excluded and apply token budget
        let tokenBudget = maxTokens;
        const agents: AgentSpawnConfig[] = [];
        let deduplicatedCount = 0;

        for (const rawAgent of allAgents) {
          if (excludeIds.has(rawAgent.id)) {
            deduplicatedCount++;
            continue;
          }

          const agent = compressAgent(rawAgent, compressionLevel);
          const agentTokens = estimateTokens(agent);

          if (tokenBudget - agentTokens < 0 && agents.length > 0) {
            break; // Token budget exhausted
          }

          agents.push(agent);
          tokenBudget -= agentTokens;
        }

        return {
          success: true,
          action: 'list',
          agents,
          message: `Found ${agents.length} agent configurations${deduplicatedCount > 0 ? ` (${deduplicatedCount} excluded)` : ''}`,
          tokensUsed: maxTokens - tokenBudget,
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
          deduplicatedCount,
        };
      }

      case 'search': {
        if (!params.query) {
          return { success: false, action: 'search', message: 'Missing required field: query' };
        }

        const allAgents = await cortex.search({ types: ['agent_spawn' as any], limit: 100 });
        const queryLower = params.query.toLowerCase();
        
        // Score and rank matches
        const scored = allAgents
          .filter((a: any) => !excludeIds.has(a.id))
          .map((agent: any) => {
            let score = 0;
            
            // Exact trigger match = highest score
            if (agent.triggerPatterns?.some((p: string) => p.toLowerCase() === queryLower)) {
              score += 100;
            }
            // Partial trigger match
            else if (agent.triggerPatterns?.some((p: string) => 
              p.toLowerCase().includes(queryLower) || queryLower.includes(p.toLowerCase())
            )) {
              score += 50;
            }
            
            // Name match
            if (agent.name?.toLowerCase().includes(queryLower)) {
              score += 30;
            }
            
            // Description match
            if (agent.description?.toLowerCase().includes(queryLower)) {
              score += 10;
            }

            // Boost by success rate and usage
            score *= (agent.stats?.successRate ?? 1.0);
            score += Math.min(agent.stats?.invocationCount ?? 0, 10);

            return { agent, score };
          })
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score);

        // Apply token budget
        let tokenBudget = maxTokens;
        const agents: AgentSpawnConfig[] = [];

        for (const { agent: rawAgent } of scored) {
          const agent = compressAgent(rawAgent, compressionLevel);
          const agentTokens = estimateTokens(agent);

          if (tokenBudget - agentTokens < 0 && agents.length > 0) {
            break;
          }

          agents.push(agent);
          tokenBudget -= agentTokens;
        }

        return {
          success: true,
          action: 'search',
          agents,
          message: `Found ${agents.length} agents matching "${params.query}"`,
          tokensUsed: maxTokens - tokenBudget,
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'suggest': {
        if (!params.intent || !params.focus) {
          return { success: false, action: 'suggest', message: 'Missing required fields: intent, focus' };
        }

        // Use retrieval engine for intent-based matching
        const retrievalResult = await cortex.retrieval.retrieve({
          intent: params.intent as Intent,
          focus: params.focus,
          maxTokens: maxTokens / 2,
        });

        // Find agent_spawn memories from retrieval
        const agentMemories = retrievalResult.memories
          .filter(m => m.memory.type === 'agent_spawn')
          .filter(m => !excludeIds.has(m.memory.id));

        if (agentMemories.length === 0) {
          // Fallback to search
          const allAgents = await cortex.search({ types: ['agent_spawn' as any], limit: 10 });
          const agents = allAgents
            .filter((a: any) => !excludeIds.has(a.id))
            .slice(0, 3)
            .map((a: any) => compressAgent(a, compressionLevel));

          return {
            success: true,
            action: 'suggest',
            agents,
            message: agents.length > 0 
              ? `Suggested ${agents.length} agents for ${params.intent}`
              : 'No agents found. Consider creating one.',
            tokensUsed: estimateTokens(agents),
            retrievalTimeMs: Date.now() - startTime,
            compressionLevel,
            sessionId: params.sessionId,
          };
        }

        const agents = agentMemories
          .slice(0, 5)
          .map(m => compressAgent(m.memory, compressionLevel));

        return {
          success: true,
          action: 'suggest',
          agents,
          message: `Suggested ${agents.length} agents for ${params.intent} on "${params.focus}"`,
          tokensUsed: estimateTokens(agents),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'update_stats': {
        if (!params.id) {
          return { success: false, action: 'update_stats', message: 'Missing required field: id' };
        }

        const agent = await cortex.get(params.id) as any;
        if (!agent) {
          return { success: false, action: 'update_stats', message: `Agent with id "${params.id}" not found` };
        }

        const stats = agent.stats || { invocationCount: 0, successRate: 1.0, avgDurationMs: 0 };
        const newCount = stats.invocationCount + 1;
        const newSuccessRate = params.success !== false
          ? (stats.successRate * stats.invocationCount + 1) / newCount
          : (stats.successRate * stats.invocationCount) / newCount;
        const newAvgDuration = params.durationMs
          ? (stats.avgDurationMs * stats.invocationCount + params.durationMs) / newCount
          : stats.avgDurationMs;

        await cortex.update(params.id, {
          stats: {
            invocationCount: newCount,
            successRate: newSuccessRate,
            avgDurationMs: newAvgDuration,
            lastInvoked: new Date().toISOString(),
          },
        } as any);

        return {
          success: true,
          action: 'update_stats',
          message: `Updated stats for agent "${agent.name}" (${newCount} invocations, ${Math.round(newSuccessRate * 100)}% success)`,
          retrievalTimeMs: Date.now() - startTime,
        };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
