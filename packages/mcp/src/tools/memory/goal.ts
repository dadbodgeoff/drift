/**
 * drift_goal
 * 
 * Track goals with progress, blockers, and success criteria.
 * Supports hierarchical goal structures (OKRs, epics, milestones).
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Hierarchical goal tree traversal
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface SuccessCriterion {
  criterion: string;
  met: boolean;
  metAt?: string;
}

interface Blocker {
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

interface GoalConfig {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'achieved' | 'abandoned' | 'blocked' | 'at_risk';
  progress: number;
  successCriteria: SuccessCriterion[];
  targetDate?: string | undefined;
  createdDate: string;
  achievedDate?: string | undefined;
  owner?: string | undefined;
  domain?: string | undefined;
  parentGoalId?: string | undefined;
  childGoalIds?: string[] | undefined;
  blockers: Blocker[];
  lessonsLearned?: string[] | undefined;
  confidence: number;
  summary: string;
}

interface GoalResult {
  success: boolean;
  action: string;
  goal?: GoalConfig;
  goals?: GoalConfig[];
  tree?: GoalTreeNode;
  id?: string;
  message?: string;
  // Enterprise metadata
  tokensUsed?: number;
  retrievalTimeMs?: number;
  compressionLevel?: number;
  sessionId?: string | undefined;
  deduplicatedCount?: number;
}

interface GoalTreeNode {
  goal: GoalConfig;
  children: GoalTreeNode[];
  depth: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function compressGoal(goal: any, level: 1 | 2 | 3): GoalConfig {
  const base: GoalConfig = {
    id: goal.id,
    title: goal.title,
    description: goal.description || '',
    status: goal.status || 'active',
    progress: goal.progress ?? 0,
    successCriteria: goal.successCriteria || [],
    targetDate: goal.targetDate,
    createdDate: goal.createdDate || goal.createdAt,
    achievedDate: goal.achievedDate,
    owner: goal.owner,
    domain: goal.domain,
    parentGoalId: goal.parentGoalId,
    childGoalIds: goal.childGoalIds,
    blockers: goal.blockers || [],
    lessonsLearned: goal.lessonsLearned,
    confidence: goal.confidence,
    summary: goal.summary,
  };

  // Level 3: Maximum compression
  if (level === 3) {
    return {
      ...base,
      description: '',
      successCriteria: base.successCriteria.slice(0, 2).map(c => ({ criterion: c.criterion.slice(0, 30), met: c.met })),
      blockers: base.blockers.filter(b => !b.resolvedAt).slice(0, 2).map(b => ({
        description: b.description.slice(0, 30),
        severity: b.severity,
        createdAt: b.createdAt,
      })),
      lessonsLearned: undefined,
      childGoalIds: base.childGoalIds?.slice(0, 3),
    };
  }

  // Level 2: Moderate compression
  if (level === 2) {
    return {
      ...base,
      description: base.description.slice(0, 100) + (base.description.length > 100 ? '...' : ''),
      successCriteria: base.successCriteria.slice(0, 5),
      blockers: base.blockers.filter(b => !b.resolvedAt).slice(0, 5),
      lessonsLearned: base.lessonsLearned?.slice(0, 3),
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

export const driftGoal = {
  name: 'drift_goal',
  description: 'Track goals with progress, blockers, and success criteria. Actions: create (new goal), get (by id), list (all/filtered), update (progress/status), complete (mark achieved), block (add blocker), unblock (resolve blocker), tree (get goal hierarchy), relevant (find goals for context).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'get', 'list', 'update', 'complete', 'block', 'unblock', 'tree', 'relevant'], description: 'Action to perform' },
      // Create/update params
      title: { type: 'string', description: 'Goal title' },
      description: { type: 'string', description: 'Goal description' },
      parentGoalId: { type: 'string', description: 'Parent goal ID for hierarchy' },
      targetDate: { type: 'string', description: 'Target completion date (ISO format)' },
      successCriteria: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, met: { type: 'boolean' } } }, description: 'Success criteria for the goal' },
      owner: { type: 'string', description: 'Goal owner/assignee' },
      domain: { type: 'string', description: 'Domain classification' },
      id: { type: 'string', description: 'Goal ID' },
      progress: { type: 'number', description: 'Progress percentage (0-100)' },
      status: { type: 'string', enum: ['active', 'achieved', 'abandoned', 'blocked', 'at_risk'], description: 'Goal status' },
      // Blocker params
      blocker: { type: 'object', properties: { description: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } }, description: 'Blocker to add' },
      blockerIndex: { type: 'number', description: 'Index of blocker to resolve' },
      resolution: { type: 'string', description: 'How the blocker was resolved' },
      lessonsLearned: { type: 'array', items: { type: 'string' }, description: 'Lessons learned on completion' },
      // Filter params
      statusFilter: { type: 'string', enum: ['active', 'achieved', 'abandoned', 'blocked', 'at_risk', 'all'], description: 'Filter by status' },
      // Relevant params
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test', 'track_progress'], description: 'Intent for relevance matching' },
      focus: { type: 'string', description: 'Focus area for relevance matching' },
      // Enterprise params
      maxTokens: { type: 'number', default: 2000, description: 'Maximum tokens for response' },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2, description: 'Compression level (1=full, 2=moderate, 3=minimal)' },
      sessionId: { type: 'string', description: 'Session ID for deduplication tracking' },
      excludeIds: { type: 'array', items: { type: 'string' }, description: 'Goal IDs to exclude (already sent)' },
      maxDepth: { type: 'number', default: 3, description: 'Maximum depth for tree traversal' },
    },
    required: ['action'],
  },

  async execute(params: {
    action: string;
    title?: string;
    description?: string;
    parentGoalId?: string;
    targetDate?: string;
    successCriteria?: SuccessCriterion[];
    owner?: string;
    domain?: string;
    id?: string;
    progress?: number;
    status?: 'active' | 'achieved' | 'abandoned' | 'blocked' | 'at_risk';
    blocker?: { description: string; severity: 'low' | 'medium' | 'high' | 'critical' };
    blockerIndex?: number;
    resolution?: string;
    lessonsLearned?: string[];
    statusFilter?: string;
    intent?: string;
    focus?: string;
    maxTokens?: number;
    compressionLevel?: 1 | 2 | 3;
    sessionId?: string;
    excludeIds?: string[];
    maxDepth?: number;
  }): Promise<GoalResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'create': {
        if (!params.title || !params.description) {
          return { success: false, action: 'create', message: 'Missing required fields: title, description' };
        }

        const memory = {
          type: 'goal',
          title: params.title,
          description: params.description,
          parentGoalId: params.parentGoalId,
          status: 'active',
          progress: 0,
          successCriteria: params.successCriteria || [],
          targetDate: params.targetDate,
          createdDate: new Date().toISOString(),
          owner: params.owner,
          domain: params.domain,
          blockers: [],
          summary: `🎯 ${params.title}: 0% (active)`,
          confidence: 1.0,
          importance: 'high',
        };

        const id = await cortex.add(memory as any);

        // Link to parent if specified
        if (params.parentGoalId) {
          const parent = await cortex.get(params.parentGoalId) as any;
          if (parent) {
            const childIds = parent.childGoalIds || [];
            await cortex.update(params.parentGoalId, { childGoalIds: [...childIds, id] } as any);
          }
        }

        const goal = compressGoal({ ...memory, id }, compressionLevel);
        return {
          success: true,
          action: 'create',
          id,
          goal,
          message: `Created goal "${params.title}"`,
          tokensUsed: estimateTokens(goal),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'get': {
        if (!params.id) {
          return { success: false, action: 'get', message: 'Missing required field: id' };
        }
        const rawGoal = await cortex.get(params.id);
        if (!rawGoal) {
          return { success: false, action: 'get', message: `Goal with id "${params.id}" not found` };
        }
        const goal = compressGoal(rawGoal, compressionLevel);
        return {
          success: true,
          action: 'get',
          goal,
          tokensUsed: estimateTokens(goal),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'list': {
        const allGoals = await cortex.search({ types: ['goal' as any], limit: 100 });
        
        // Filter by status
        let filtered = allGoals;
        if (params.statusFilter && params.statusFilter !== 'all') {
          filtered = allGoals.filter((g: any) => g.status === params.statusFilter);
        }

        // Apply token budget and exclusions
        let tokenBudget = maxTokens;
        const goals: GoalConfig[] = [];
        let deduplicatedCount = 0;

        // Sort by progress (active goals first, then by progress)
        filtered.sort((a: any, b: any) => {
          if (a.status === 'active' && b.status !== 'active') return -1;
          if (b.status === 'active' && a.status !== 'active') return 1;
          return (b.progress ?? 0) - (a.progress ?? 0);
        });

        for (const rawGoal of filtered) {
          if (excludeIds.has(rawGoal.id)) {
            deduplicatedCount++;
            continue;
          }

          const goal = compressGoal(rawGoal, compressionLevel);
          const goalTokens = estimateTokens(goal);

          if (tokenBudget - goalTokens < 0 && goals.length > 0) {
            break;
          }

          goals.push(goal);
          tokenBudget -= goalTokens;
        }

        return {
          success: true,
          action: 'list',
          goals,
          message: `Found ${goals.length} goals${deduplicatedCount > 0 ? ` (${deduplicatedCount} excluded)` : ''}`,
          tokensUsed: maxTokens - tokenBudget,
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
          deduplicatedCount,
        };
      }

      case 'update': {
        if (!params.id) {
          return { success: false, action: 'update', message: 'Missing required field: id' };
        }
        const rawGoal = await cortex.get(params.id) as any;
        if (!rawGoal) {
          return { success: false, action: 'update', message: `Goal with id "${params.id}" not found` };
        }

        const updates: any = {};
        if (params.progress !== undefined) updates.progress = params.progress;
        if (params.status) updates.status = params.status;
        if (params.title) updates.title = params.title;
        if (params.description) updates.description = params.description;
        if (params.successCriteria) updates.successCriteria = params.successCriteria;

        const newProgress = params.progress ?? rawGoal.progress;
        const newStatus = params.status ?? rawGoal.status;
        updates.summary = `🎯 ${params.title || rawGoal.title}: ${newProgress}% (${newStatus})`;

        await cortex.update(params.id, updates);
        const goal = compressGoal({ ...rawGoal, ...updates }, compressionLevel);
        
        return {
          success: true,
          action: 'update',
          goal,
          message: `Updated goal "${rawGoal.title}"`,
          tokensUsed: estimateTokens(goal),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'complete': {
        if (!params.id) {
          return { success: false, action: 'complete', message: 'Missing required field: id' };
        }
        const rawGoal = await cortex.get(params.id) as any;
        if (!rawGoal) {
          return { success: false, action: 'complete', message: `Goal with id "${params.id}" not found` };
        }

        const updates: any = {
          status: 'achieved',
          progress: 100,
          achievedDate: new Date().toISOString(),
          lessonsLearned: params.lessonsLearned,
          summary: `🎯 ${rawGoal.title}: 100% (achieved)`,
        };

        if (rawGoal.successCriteria) {
          updates.successCriteria = rawGoal.successCriteria.map((c: any) => ({
            ...c,
            met: true,
            metAt: new Date().toISOString(),
          }));
        }

        await cortex.update(params.id, updates);
        const goal = compressGoal({ ...rawGoal, ...updates }, compressionLevel);
        
        return {
          success: true,
          action: 'complete',
          goal,
          message: `Completed goal "${rawGoal.title}"`,
          tokensUsed: estimateTokens(goal),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'block': {
        if (!params.id || !params.blocker) {
          return { success: false, action: 'block', message: 'Missing required fields: id, blocker' };
        }
        const rawGoal = await cortex.get(params.id) as any;
        if (!rawGoal) {
          return { success: false, action: 'block', message: `Goal with id "${params.id}" not found` };
        }

        const blockers = rawGoal.blockers || [];
        blockers.push({
          description: params.blocker.description,
          severity: params.blocker.severity,
          createdAt: new Date().toISOString(),
        });

        await cortex.update(params.id, {
          blockers,
          status: 'blocked',
          summary: `🎯 ${rawGoal.title}: ${rawGoal.progress}% (blocked)`,
        } as any);

        return {
          success: true,
          action: 'block',
          message: `Added blocker to goal "${rawGoal.title}"`,
          retrievalTimeMs: Date.now() - startTime,
        };
      }

      case 'unblock': {
        if (!params.id || params.blockerIndex === undefined) {
          return { success: false, action: 'unblock', message: 'Missing required fields: id, blockerIndex' };
        }
        const rawGoal = await cortex.get(params.id) as any;
        if (!rawGoal) {
          return { success: false, action: 'unblock', message: `Goal with id "${params.id}" not found` };
        }

        const blockers = rawGoal.blockers || [];
        if (params.blockerIndex >= blockers.length) {
          return { success: false, action: 'unblock', message: `Blocker index ${params.blockerIndex} out of range` };
        }

        blockers[params.blockerIndex].resolvedAt = new Date().toISOString();
        blockers[params.blockerIndex].resolution = params.resolution || '';

        const unresolvedBlockers = blockers.filter((b: any) => !b.resolvedAt);
        const newStatus = unresolvedBlockers.length === 0 ? 'active' : 'blocked';

        await cortex.update(params.id, {
          blockers,
          status: newStatus,
          summary: `🎯 ${rawGoal.title}: ${rawGoal.progress}% (${newStatus})`,
        } as any);

        return {
          success: true,
          action: 'unblock',
          message: `Resolved blocker for goal "${rawGoal.title}"`,
          retrievalTimeMs: Date.now() - startTime,
        };
      }

      case 'tree': {
        if (!params.id) {
          return { success: false, action: 'tree', message: 'Missing required field: id (root goal)' };
        }

        const maxDepth = params.maxDepth ?? 3;
        
        async function buildTree(goalId: string, depth: number): Promise<GoalTreeNode | null> {
          if (depth > maxDepth) return null;
          
          const rawGoal = await cortex.get(goalId) as any;
          if (!rawGoal) return null;

          const goal = compressGoal(rawGoal, compressionLevel);
          const children: GoalTreeNode[] = [];

          if (rawGoal.childGoalIds && depth < maxDepth) {
            for (const childId of rawGoal.childGoalIds) {
              const childNode = await buildTree(childId, depth + 1);
              if (childNode) children.push(childNode);
            }
          }

          return { goal, children, depth };
        }

        const tree = await buildTree(params.id, 0);
        if (!tree) {
          return { success: false, action: 'tree', message: `Goal with id "${params.id}" not found` };
        }

        return {
          success: true,
          action: 'tree',
          tree,
          message: `Built goal tree with ${countNodes(tree)} nodes`,
          tokensUsed: estimateTokens(tree),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) {
          return { success: false, action: 'relevant', message: 'Missing required fields: intent, focus' };
        }

        // Use retrieval engine for intent-based matching
        const retrievalResult = await cortex.retrieval.retrieve({
          intent: params.intent as Intent,
          focus: params.focus,
          maxTokens: maxTokens / 2,
        });

        // Find goal memories from retrieval
        const goalMemories = retrievalResult.memories
          .filter(m => m.memory.type === 'goal')
          .filter(m => !excludeIds.has(m.memory.id));

        const goals = goalMemories
          .slice(0, 10)
          .map(m => compressGoal(m.memory, compressionLevel));

        return {
          success: true,
          action: 'relevant',
          goals,
          message: `Found ${goals.length} relevant goals for ${params.intent}`,
          tokensUsed: estimateTokens(goals),
          retrievalTimeMs: Date.now() - startTime,
          compressionLevel,
          sessionId: params.sessionId,
        };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};

function countNodes(node: GoalTreeNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}
