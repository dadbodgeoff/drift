/**
 * drift_meeting
 * 
 * Store meeting summaries with agenda, decisions, and action items.
 * Enables "what did we decide in the last planning meeting" queries.
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

interface MeetingActionItem {
  item: string;
  assignee?: string | undefined;
  dueDate?: string | undefined;
  status: 'pending' | 'done' | 'cancelled';
}

interface MeetingConfig {
  id: string;
  title: string;
  meetingType: 'standup' | 'planning' | 'retro' | 'review' | '1on1' | 'all_hands' | 'workshop' | 'other';
  scheduledAt: string;
  duration?: string | undefined;
  participants: string[];
  organizer?: string | undefined;
  agenda?: string[] | undefined;
  meetingSummary: string;
  decisions?: string[] | undefined;
  actionItems?: MeetingActionItem[] | undefined;
  nextMeeting?: string | undefined;
  openQuestions?: string[] | undefined;
  relatedMeetings?: string[] | undefined;
  relatedGoals?: string[] | undefined;
  domain?: string | undefined;
  confidence: number;
  summary: string;
}

interface MeetingResult {
  success: boolean;
  action: string;
  meeting?: MeetingConfig;
  meetings?: MeetingConfig[];
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

function compressMeeting(meeting: any, level: 1 | 2 | 3): MeetingConfig {
  const base: MeetingConfig = {
    id: meeting.id,
    title: meeting.title,
    meetingType: meeting.meetingType || 'other',
    scheduledAt: meeting.scheduledAt || meeting.createdAt,
    duration: meeting.duration,
    participants: meeting.participants || [],
    organizer: meeting.organizer,
    agenda: meeting.agenda,
    meetingSummary: meeting.meetingSummary || meeting.summary || '',
    decisions: meeting.decisions,
    actionItems: meeting.actionItems,
    nextMeeting: meeting.nextMeeting,
    openQuestions: meeting.openQuestions,
    relatedMeetings: meeting.relatedMeetings,
    relatedGoals: meeting.relatedGoals,
    domain: meeting.domain,
    confidence: meeting.confidence,
    summary: meeting.summary,
  };

  if (level === 3) {
    return {
      ...base,
      agenda: base.agenda?.slice(0, 3),
      meetingSummary: base.meetingSummary.slice(0, 100) + (base.meetingSummary.length > 100 ? '...' : ''),
      decisions: base.decisions?.slice(0, 2).map(d => d.slice(0, 50)),
      actionItems: base.actionItems?.filter(a => a.status !== 'done').slice(0, 2).map(a => ({
        item: a.item.slice(0, 40),
        status: a.status,
      })) as MeetingActionItem[] | undefined,
      openQuestions: base.openQuestions?.slice(0, 2),
      relatedMeetings: undefined,
      relatedGoals: undefined,
    };
  }

  if (level === 2) {
    return {
      ...base,
      agenda: base.agenda?.slice(0, 5),
      meetingSummary: base.meetingSummary.slice(0, 300) + (base.meetingSummary.length > 300 ? '...' : ''),
      decisions: base.decisions?.slice(0, 5),
      actionItems: base.actionItems?.slice(0, 5),
      openQuestions: base.openQuestions?.slice(0, 3),
      relatedMeetings: base.relatedMeetings?.slice(0, 3),
      relatedGoals: base.relatedGoals?.slice(0, 3),
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

export const driftMeeting = {
  name: 'drift_meeting',
  description: 'Store meeting summaries with agenda, decisions, and action items. Actions: record, get, list, search, update_action, relevant.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['record', 'get', 'list', 'search', 'update_action', 'relevant'] },
      title: { type: 'string' },
      meetingType: { type: 'string', enum: ['standup', 'planning', 'retro', 'review', '1on1', 'all_hands', 'workshop', 'other'] },
      scheduledAt: { type: 'string' },
      duration: { type: 'string' },
      participants: { type: 'array', items: { type: 'string' } },
      organizer: { type: 'string' },
      agenda: { type: 'array', items: { type: 'string' } },
      meetingSummary: { type: 'string' },
      decisions: { type: 'array', items: { type: 'string' } },
      actionItems: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, assignee: { type: 'string' }, dueDate: { type: 'string' } } } },
      nextMeeting: { type: 'string' },
      openQuestions: { type: 'array', items: { type: 'string' } },
      relatedGoals: { type: 'array', items: { type: 'string' } },
      domain: { type: 'string' },
      id: { type: 'string' },
      actionIndex: { type: 'number' },
      actionStatus: { type: 'string', enum: ['pending', 'done', 'cancelled'] },
      query: { type: 'string' },
      typeFilter: { type: 'string', enum: ['standup', 'planning', 'retro', 'review', '1on1', 'all_hands', 'workshop', 'other', 'all'] },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test', 'recall'] },
      focus: { type: 'string' },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<MeetingResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'record': {
        if (!params.title || !params.meetingSummary || !params.participants) {
          return { success: false, action: 'record', message: 'Missing required fields: title, meetingSummary, participants' };
        }
        const memory = {
          type: 'meeting',
          title: params.title,
          meetingType: params.meetingType || 'other',
          scheduledAt: params.scheduledAt || new Date().toISOString(),
          duration: params.duration,
          participants: params.participants,
          organizer: params.organizer,
          agenda: params.agenda,
          meetingSummary: params.meetingSummary,
          decisions: params.decisions,
          actionItems: params.actionItems?.map((a: any) => ({ ...a, status: 'pending' })),
          nextMeeting: params.nextMeeting,
          openQuestions: params.openQuestions,
          relatedGoals: params.relatedGoals,
          domain: params.domain,
          summary: `📅 ${params.meetingType || 'meeting'}: ${params.title}`,
          confidence: 1.0,
          importance: 'normal',
        };
        const id = await cortex.add(memory as any);
        const meeting = compressMeeting({ ...memory, id }, compressionLevel);
        return { success: true, action: 'record', id, meeting, message: `Recorded meeting "${params.title}"`,
          tokensUsed: estimateTokens(meeting), retrievalTimeMs: Date.now() - startTime, compressionLevel, sessionId: params.sessionId };
      }

      case 'get': {
        if (!params.id) return { success: false, action: 'get', message: 'Missing id' };
        const raw = await cortex.get(params.id);
        if (!raw) return { success: false, action: 'get', message: 'Not found' };
        const meeting = compressMeeting(raw, compressionLevel);
        return { success: true, action: 'get', meeting, tokensUsed: estimateTokens(meeting), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'list': {
        const all = await cortex.search({ types: ['meeting' as any], limit: 100 });
        let filtered = params.typeFilter && params.typeFilter !== 'all' ? all.filter((m: any) => m.meetingType === params.typeFilter) : all;
        filtered.sort((a: any, b: any) => new Date(b.scheduledAt || b.createdAt).getTime() - new Date(a.scheduledAt || a.createdAt).getTime());
        let tokenBudget = maxTokens;
        const meetings: MeetingConfig[] = [];
        let deduplicatedCount = 0;
        for (const raw of filtered) {
          if (excludeIds.has(raw.id)) { deduplicatedCount++; continue; }
          const meeting = compressMeeting(raw, compressionLevel);
          const tokens = estimateTokens(meeting);
          if (tokenBudget - tokens < 0 && meetings.length > 0) break;
          meetings.push(meeting);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'list', meetings, message: `Found ${meetings.length} meetings`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel, deduplicatedCount };
      }

      case 'search': {
        if (!params.query) return { success: false, action: 'search', message: 'Missing query' };
        const all = await cortex.search({ types: ['meeting' as any], limit: 100 });
        const q = params.query.toLowerCase();
        const scored = all.filter((m: any) => !excludeIds.has(m.id)).map((m: any) => {
          let score = 0;
          if (m.title?.toLowerCase().includes(q)) score += 50;
          if (m.meetingSummary?.toLowerCase().includes(q)) score += 30;
          if (m.decisions?.some((d: string) => d.toLowerCase().includes(q))) score += 40;
          if (m.agenda?.some((a: string) => a.toLowerCase().includes(q))) score += 25;
          return { meeting: m, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        let tokenBudget = maxTokens;
        const meetings: MeetingConfig[] = [];
        for (const { meeting: raw } of scored) {
          const meeting = compressMeeting(raw, compressionLevel);
          const tokens = estimateTokens(meeting);
          if (tokenBudget - tokens < 0 && meetings.length > 0) break;
          meetings.push(meeting);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'search', meetings, message: `Found ${meetings.length} matching`,
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
        await cortex.update(params.id, { actionItems } as any);
        return { success: true, action: 'update_action', message: `Updated action item status to "${params.actionStatus}"`, retrievalTimeMs: Date.now() - startTime };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) return { success: false, action: 'relevant', message: 'Missing intent or focus' };
        const result = await cortex.retrieval.retrieve({ intent: params.intent as Intent, focus: params.focus, maxTokens: maxTokens / 2 });
        const meetings = result.memories.filter(m => m.memory.type === 'meeting' && !excludeIds.has(m.memory.id))
          .slice(0, 10).map(m => compressMeeting(m.memory, compressionLevel));
        return { success: true, action: 'relevant', meetings, message: `Found ${meetings.length} relevant meetings`,
          tokensUsed: estimateTokens(meetings), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
