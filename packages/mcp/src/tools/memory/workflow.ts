/**
 * drift_workflow
 * 
 * Store and execute step-by-step processes with guidance.
 * Enables "how do I deploy to production" workflows.
 * 
 * Enterprise Features:
 * - Token-aware responses with compression levels
 * - Session tracking to avoid duplicate sends
 * - Retrieval integration with intent-based weighting
 * - Step-by-step execution tracking
 * - Full metadata tracking
 */

import { getCortex, type Intent } from 'driftdetect-cortex';

// ============================================================================
// Type Definitions
// ============================================================================

interface WorkflowStep {
  order: number;
  name: string;
  description: string;
  tools?: string[] | undefined;
  estimatedDuration?: string | undefined;
  tips?: string[] | undefined;
  required?: boolean | undefined;
  verification?: string | undefined;
  stepNumber?: number | undefined;
  totalSteps?: number | undefined;
}

interface WorkflowStats {
  executionCount: number;
  successRate: number;
  avgDuration?: string;
  lastExecuted?: string;
}

interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  slug: string;
  steps: WorkflowStep[];
  triggerPhrases: string[];
  prerequisites?: string[] | undefined;
  domain?: string | undefined;
  stats: WorkflowStats;
  confidence: number;
  summary: string;
}

interface WorkflowResult {
  success: boolean;
  action: string;
  workflow?: WorkflowConfig;
  workflows?: WorkflowConfig[];
  id?: string;
  message?: string;
  currentStep?: number;
  tokensUsed?: number;
  retrievalTimeMs?: number;
  compressionLevel?: number;
  sessionId?: string;
  deduplicatedCount?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function compressWorkflow(workflow: any, level: 1 | 2 | 3): WorkflowConfig {
  const base: WorkflowConfig = {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || '',
    slug: workflow.slug,
    steps: workflow.steps || [],
    triggerPhrases: workflow.triggerPhrases || [],
    prerequisites: workflow.prerequisites,
    domain: workflow.domain,
    stats: workflow.stats || { executionCount: 0, successRate: 1.0 },
    confidence: workflow.confidence,
    summary: workflow.summary,
  };

  if (level === 3) {
    return {
      ...base,
      description: '',
      steps: base.steps.slice(0, 3).map(s => ({
        order: s.order,
        name: s.name.slice(0, 30),
        description: s.description.slice(0, 50),
        required: s.required,
      })),
      triggerPhrases: base.triggerPhrases.slice(0, 2),
      prerequisites: undefined,
    };
  }

  if (level === 2) {
    return {
      ...base,
      description: base.description.slice(0, 100) + (base.description.length > 100 ? '...' : ''),
      steps: base.steps.map(s => ({
        order: s.order,
        name: s.name,
        description: s.description.slice(0, 100),
        tools: s.tools?.slice(0, 3),
        required: s.required,
        verification: s.verification,
      })),
      triggerPhrases: base.triggerPhrases.slice(0, 5),
      prerequisites: base.prerequisites?.slice(0, 3),
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

export const driftWorkflow = {
  name: 'drift_workflow',
  description: 'Store and retrieve step-by-step processes. Actions: create, get, list, search, execute, complete, relevant.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'get', 'list', 'search', 'execute', 'complete', 'relevant'] },
      name: { type: 'string' },
      description: { type: 'string' },
      slug: { type: 'string' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            order: { type: 'number' },
            name: { type: 'string' },
            description: { type: 'string' },
            tools: { type: 'array', items: { type: 'string' } },
            estimatedDuration: { type: 'string' },
            tips: { type: 'array', items: { type: 'string' } },
            required: { type: 'boolean' },
            verification: { type: 'string' },
          },
        },
      },
      triggerPhrases: { type: 'array', items: { type: 'string' } },
      prerequisites: { type: 'array', items: { type: 'string' } },
      domain: { type: 'string' },
      id: { type: 'string' },
      query: { type: 'string' },
      durationMs: { type: 'number' },
      wasSuccessful: { type: 'boolean' },
      intent: { type: 'string', enum: ['add_feature', 'fix_bug', 'refactor', 'security_audit', 'understand_code', 'add_test', 'execute_workflow'] },
      focus: { type: 'string' },
      maxTokens: { type: 'number', default: 2000 },
      compressionLevel: { type: 'number', enum: [1, 2, 3], default: 2 },
      sessionId: { type: 'string' },
      excludeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },

  async execute(params: any): Promise<WorkflowResult> {
    const startTime = Date.now();
    const cortex = await getCortex();
    const compressionLevel = params.compressionLevel ?? 2;
    const maxTokens = params.maxTokens ?? 2000;
    const excludeIds = new Set(params.excludeIds ?? []);

    switch (params.action) {
      case 'create': {
        if (!params.name || !params.slug || !params.steps || !params.triggerPhrases) {
          return { success: false, action: 'create', message: 'Missing required fields: name, slug, steps, triggerPhrases' };
        }
        const memory = {
          type: 'workflow',
          name: params.name,
          description: params.description || '',
          slug: params.slug,
          steps: params.steps,
          triggerPhrases: params.triggerPhrases,
          prerequisites: params.prerequisites,
          domain: params.domain,
          stats: { executionCount: 0, successRate: 1.0 },
          summary: `📋 ${params.name}: ${params.steps.length} steps`,
          confidence: 1.0,
          importance: 'normal',
        };
        const id = await cortex.add(memory as any);
        const workflow = compressWorkflow({ ...memory, id }, compressionLevel);
        return { success: true, action: 'create', id, workflow, message: `Created workflow "${params.name}"`,
          tokensUsed: estimateTokens(workflow), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'get': {
        if (!params.slug && !params.id) return { success: false, action: 'get', message: 'Missing slug or id' };
        let raw: any = null;
        if (params.id) {
          raw = await cortex.get(params.id);
        } else {
          const all = await cortex.search({ types: ['workflow' as any], limit: 100 });
          raw = all.find((w: any) => w.slug === params.slug);
        }
        if (!raw) return { success: false, action: 'get', message: 'Workflow not found' };
        const workflow = compressWorkflow(raw, compressionLevel);
        return { success: true, action: 'get', workflow, tokensUsed: estimateTokens(workflow), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'list': {
        const all = await cortex.search({ types: ['workflow' as any], limit: 100 });
        let tokenBudget = maxTokens;
        const workflows: WorkflowConfig[] = [];
        let deduplicatedCount = 0;
        for (const raw of all) {
          if (excludeIds.has(raw.id)) { deduplicatedCount++; continue; }
          const workflow = compressWorkflow(raw, compressionLevel);
          const tokens = estimateTokens(workflow);
          if (tokenBudget - tokens < 0 && workflows.length > 0) break;
          workflows.push(workflow);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'list', workflows, message: `Found ${workflows.length} workflows`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel, deduplicatedCount };
      }

      case 'search': {
        if (!params.query) return { success: false, action: 'search', message: 'Missing query' };
        const all = await cortex.search({ types: ['workflow' as any], limit: 100 });
        const q = params.query.toLowerCase();
        const scored = all.filter((w: any) => !excludeIds.has(w.id)).map((w: any) => {
          let score = 0;
          if (w.triggerPhrases?.some((p: string) => p.toLowerCase() === q)) score += 100;
          else if (w.triggerPhrases?.some((p: string) => p.toLowerCase().includes(q) || q.includes(p.toLowerCase()))) score += 50;
          if (w.name?.toLowerCase().includes(q)) score += 30;
          if (w.description?.toLowerCase().includes(q)) score += 10;
          score *= (w.stats?.successRate ?? 1.0);
          return { workflow: w, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        let tokenBudget = maxTokens;
        const workflows: WorkflowConfig[] = [];
        for (const { workflow: raw } of scored) {
          const workflow = compressWorkflow(raw, compressionLevel);
          const tokens = estimateTokens(workflow);
          if (tokenBudget - tokens < 0 && workflows.length > 0) break;
          workflows.push(workflow);
          tokenBudget -= tokens;
        }
        return { success: true, action: 'search', workflows, message: `Found ${workflows.length} matching`,
          tokensUsed: maxTokens - tokenBudget, retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      case 'execute': {
        if (!params.slug && !params.id) return { success: false, action: 'execute', message: 'Missing slug or id' };
        let raw: any = null;
        if (params.id) {
          raw = await cortex.get(params.id);
        } else {
          const all = await cortex.search({ types: ['workflow' as any], limit: 100 });
          raw = all.find((w: any) => w.slug === params.slug);
        }
        if (!raw) return { success: false, action: 'execute', message: 'Workflow not found' };
        // Use level 1 compression for execution to get full step details
        const workflow = compressWorkflow(raw, 1);
        workflow.steps = workflow.steps.sort((a, b) => a.order - b.order).map((step, i) => ({
          ...step,
          stepNumber: i + 1,
          totalSteps: workflow.steps.length,
        }));
        return { success: true, action: 'execute', workflow, currentStep: 1,
          message: `Starting workflow "${workflow.name}" with ${workflow.steps.length} steps`,
          tokensUsed: estimateTokens(workflow), retrievalTimeMs: Date.now() - startTime, compressionLevel: 1 };
      }

      case 'complete': {
        if (!params.id) return { success: false, action: 'complete', message: 'Missing id' };
        const raw = await cortex.get(params.id) as any;
        if (!raw) return { success: false, action: 'complete', message: 'Workflow not found' };
        const stats = raw.stats || { executionCount: 0, successRate: 1.0 };
        const newCount = stats.executionCount + 1;
        const newSuccessRate = params.wasSuccessful !== false
          ? (stats.successRate * stats.executionCount + 1) / newCount
          : (stats.successRate * stats.executionCount) / newCount;
        const newAvgDuration = params.durationMs
          ? stats.avgDuration ? `${Math.round((parseInt(stats.avgDuration) * stats.executionCount + params.durationMs) / newCount)}ms` : `${params.durationMs}ms`
          : stats.avgDuration;
        await cortex.update(params.id, {
          stats: { executionCount: newCount, successRate: newSuccessRate, avgDuration: newAvgDuration, lastExecuted: new Date().toISOString() },
        } as any);
        return { success: true, action: 'complete',
          message: `Completed "${raw.name}" (${newCount} executions, ${Math.round(newSuccessRate * 100)}% success)`,
          retrievalTimeMs: Date.now() - startTime };
      }

      case 'relevant': {
        if (!params.intent || !params.focus) return { success: false, action: 'relevant', message: 'Missing intent or focus' };
        const result = await cortex.retrieval.retrieve({ intent: params.intent as Intent, focus: params.focus, maxTokens: maxTokens / 2 });
        const workflows = result.memories.filter(m => m.memory.type === 'workflow' && !excludeIds.has(m.memory.id))
          .slice(0, 10).map(m => compressWorkflow(m.memory, compressionLevel));
        return { success: true, action: 'relevant', workflows, message: `Found ${workflows.length} relevant workflows`,
          tokensUsed: estimateTokens(workflows), retrievalTimeMs: Date.now() - startTime, compressionLevel };
      }

      default:
        return { success: false, action: params.action, message: `Unknown action: ${params.action}` };
    }
  },
};
