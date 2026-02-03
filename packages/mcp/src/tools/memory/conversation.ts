/**
 * drift_conversation
 * 
 * Store and retrieve summarized past discussions.
 * Enables "what did we discuss about X" queries.
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Action item tracking
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface ActionItem {
  item: string;
  assignee?: string | undefined;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  dueDate?: string | undefined;
  completedAt?: string | undefined;
}

interface ConversationConfig {
  id: string;
  title: string;
  participants: string[];
  conversationSummary: string;
  keyDecisions?: string[] | undefined;
  topics?: string[] | undefined;
  actionItems?: ActionItem[] | undefined;
  openQuestions?: string[] | undefined;
  relatedConversations?: string[] | undefined;
  relatedEntities?: string[] | undefined;
  startedAt: string;
  endedAt?: string | undefined;
  messageCount?: number | undefined;
  domain?: string | undefined;
  confidence: number;
  summary: string;
}

interface ConversationResult {
  success: boolean;
  action: string;
  conversation?: ConversationConfig;
  conversations?: ConversationConfig[];
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

function compressConversation(conv: any, level: 1 | 2 | 3): ConversationConfig {
  const base: ConversationConfig = {
    id: conv.id,
    title: conv.title,
    participants: conv.participants || [],
    conversationSummary: conv.conversationSummary || '',
    keyDecisions: conv.keyDecisions,
    topics: conv.topics,
    actionItems: conv.actionItems,
    openQuestions: conv.openQuestions,
    relatedConversations: conv.relatedConversations,
    relatedEntities: conv.relatedEntities,
    startedAt: conv.startedAt || conv.createdAt,
    endedAt: conv.endedAt,
    messageCount: conv.messageCount,
    domain: conv.domain,
    confidence: conv.confidence,
    summary: conv.summary,
  };

  if (level === 3) {
    return {
      ...base,
      conversationSummary: base.conversationSummary.slice(0, 100) + (base.conversationSummary.length > 100 ? '...' : ''),
      keyDecisions: base.keyDecisions?.slice(0, 2).map(d => d.slice(0, 50)),
      topics: base.topics?.slice(0, 3),
      actionItems: base.actionItems?.filter(a => a.status !== 'done').slice(0, 2).map(a => ({
        item: a.item.slice(0, 40),
        status: a.status,
      })) as ActionItem[] | undefined,
      openQuestions: base.openQuestions?.slice(0, 2),
      relatedConversations: undefined,
      relatedEntities: undefined,
    };
  }

  if (level === 2) {
    return {
      ...base,
      conversationSummary: base.conversationSummary.slice(0, 300) + (base.conversationSummary.length > 300 ? '...' : ''),
      keyDecisions: base.keyDecisions?.slice(0, 5),
      topics: base.topics?.slice(0, 5),
      actionItems: base.actionItems?.slice(0, 5),
      openQuestions: base.openQuestions?.slice(0, 3),
      relatedConversations: base.relatedConversations?.slice(0, 3),
      relatedEntities: base.relatedEntities?.slice(0, 3),
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

export const driftConversation = {
  name: 'drift_conversation',
  description: 'Store and retrieve summarized past discussions. Actions: record, get, list, search, update_action, relevant.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['record', 'get', 'list', 'search', 'update_action', 'relevant'] },
      title: { type: 'string' },
      participants: { type: 'array', items: { type: 'string' } },
      conversationSummary: { type: 'string' },
      keyDecisions: { type: 'array', items: { type: 'string' } },
      topics: { type: 'array', items: { type: 'string' } },
      actionItems: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, assignee: { type: 'string' }, dueDate: { type: 'string' } } } },
      openQuestions: { type: 'array', items: { type: 'string' } },
      relatedEntities: { type: 'array', items: { type: 'string' } },
      domain: { type: 'string' },
      id: { type: 'string' },
      actionIndex: { type: 'number' },
      actionStatus: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'] },
      query: { type: 'string' },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test', 'recall'] },
      focus: { type: 'string' },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<ConversationResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'record': {
        if (!params.title || !params.conversationSummary || !params.participants) {
          return { success: false, action: 'record', message: 'Missing required fields: title, conversationSummary, participants' };
        }
        const memory = {
          type: 'conversation',
          title: params.title,
          participants: params.participants,
          conversationSummary: params.conversationSummary,
          keyDecisions: params.keyDecisions,
          topics: params.topics,
          actionItems: params.actionItems?.map((a: any) => ({ ...a, status: 'pending' })),
          openQuestions: params.openQuestions,
          relatedEntities: params.relatedEntities,
          startedAt: new Date().toISOString(),
          domain: params.domain,
          summary: `💬 ${params.title}: ${params.participants.length} participants`,
          confidence: 1.0,
          importance: 'normal',
        };
        const id = await cortex.add(memory as any);
        const conversation = compressConversation({ ...memory, id }, compressionLevel);
        return { success: true, action: 'record', id, conversation, message: `Recorded conversation "${params.title}"`,
          tokensUsed: estimateTokens(conversation), retrievalTimeMs: Date.now() - startTime, compressionLevel, sessionId: params.sessionId };
      }

      case 'get': {
        if (!params.id) return { success: false, action: 'get', message: 'Missing id' };
        const raw = await cortex.get(params.id);
        if (!raw) return { success: false, action: 'get', message: 'Not found' };
        const conversation = compressConversation(raw, compressionLevel);
        return { success: true, action: 'get', conversation, tokensUsed: estimateTokens(conversation), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'list': {
        const all = await cortex.search({ types: ['conversation' as any], limit: 100 });
        all.sort((a: any, b: any) => new Date(b.startedAt || b.createdAt).getTime() - new Date(a.startedAt || a.createdAt).getTime());
        let tokenBudget = maxTokens;
        const conversations: ConversationConfig[] = [];
        let deduplicatedCount = 0;
        for (const raw of all) {
          if (excludeIds.has(raw.id)) { deduplicatedCount++; continue; }
          const conversation = compressConversation(raw, compressionLevel);
          const tokens = estimateTokens(conversation);
          if (tokenBudget - tokens < 0 && conversations.length > 0) break;
          conversations.push(conversation);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'list', conversations, message: `Found ${conversations.length} conversations`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel, deduplicatedCount };
      }

      case 'search': {
        if (!params.query) return { success: false, action: 'search', message: 'Missing query' };
        const all = await cortex.search({ types: ['conversation' as any], limit: 100 });
        const q = params.query.toLowerCase();
        const scored = all.filter((c: any) => !excludeIds.has(c.id)).map((c: any) => {
          let score = 0;
          if (c.title?.toLowerCase().includes(q)) score += 50;
          if (c.conversationSummary?.toLowerCase().includes(q)) score += 30;
          if (c.topics?.some((t: string) => t.toLowerCase().includes(q))) score += 40;
          if (c.keyDecisions?.some((d: string) => d.toLowerCase().includes(q))) score += 35;
          return { conversation: c, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        let tokenBudget = maxTokens;
        const conversations: ConversationConfig[] = [];
        for (const { conversation: raw } of scored) {
          const conversation = compressConversation(raw, compressionLevel);
          const tokens = estimateTokens(conversation);
          if (tokenBudget - tokens < 0 && conversations.length > 0) break;
          conversations.push(conversation);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'search', conversations, message: `Found ${conversations.length} matching`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'update_action': {
        if (!params.id || params.actionIndex === undefined || !params.actionStatus) {
          return { success: false, action: 'update_action', message: 'Missing id, actionIndex, or actionStatus' };
        }
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'update_action', message: 'Not found' };
        const actionItems = raw.actionItems || [];
        if (params.actionIndex >= actionItems.length) {
          return { success: false, action: 'update_action', message: 'Action index out of range' };
        }
        actionItems[params.actionIndex].status = params.actionStatus;
        if (params.actionStatus === 'done') {
          actionItems[params.actionIndex].completedAt = new Date().toISOString();
        }
        await cortex.update(params.id, { actionItems } as any);
        return { success: true, action: 'update_action', message: `Updated action item status to "${params.actionStatus}"`, retrievalTimeMs: Date.now() - startTime };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) return { success: false, action: 'relevant', message: 'Missing intent or focus' };
        const result = await cortex.retrieval.retrieve({ intent: params.intent as Intent, focus: params.focus, maxTokens: maxTokens / 2 });
        const conversations = result.memories.filter(m => m.memory.type === 'conversation' && !excludeIds.has(m.memory.id))
          .slice(0, 10).map(m => compressConversation(m.memory, compressionLevel));
        return { success: true, action: 'relevant', conversations, message: `Found ${conversations.length} relevant conversations`,
          tokensUsed: estimateTokens(conversations), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
