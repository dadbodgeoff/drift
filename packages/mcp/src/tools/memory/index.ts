/**
 * Memory MCP Tools
 * 
 * MCP tool interfaces for Drift Cortex memory system.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export { memoryStatus } from './status.js';
export { memoryAdd } from './add.js';
export { memorySearch } from './search.js';
export { memoryGet } from './get.js';
export { memoryUpdate } from './update.js';
export { memoryDelete } from './delete.js';
export { memoryValidate } from './validate.js';
export { memoryConsolidate } from './consolidate.js';
export { memoryForContext } from './for-context.js';
export { memoryWarnings } from './warnings.js';
export { memoryLearn } from './learn.js';
export { memorySuggest } from './suggest.js';
export { driftWhy } from './why.js';
export { memoryExport } from './export.js';
export { memoryImport } from './import.js';

// New v2 tools
export { driftMemoryExplain } from './explain.js';
export { driftMemoryFeedback } from './feedback.js';
export { driftMemoryHealth } from './health.js';
export { driftMemoryPredict } from './predict.js';
export { driftMemoryConflicts } from './conflicts.js';
export { driftMemoryGraph } from './graph.js';
export { driftMemoryQuery } from './query.js';
export { driftMemoryContradictions } from './contradictions.js';

// Universal memory tools (v2)
export { driftAgentSpawn } from './agent-spawn.js';
export { driftGoal } from './goal.js';
export { driftIncident } from './incident.js';
export { driftWorkflow } from './workflow.js';
export { driftEntity } from './entity.js';
export { driftConversation } from './conversation.js';
export { driftMeeting } from './meeting.js';
export { driftSkill } from './skill.js';
export { driftEnvironment } from './environment.js';

// Import tool definitions for registry
import { memoryStatus } from './status.js';
import { memoryAdd } from './add.js';
import { memorySearch } from './search.js';
import { memoryGet } from './get.js';
import { memoryValidate } from './validate.js';
import { memoryForContext } from './for-context.js';
import { memoryLearn } from './learn.js';
import { driftWhy } from './why.js';
import { driftMemoryExplain } from './explain.js';
import { driftMemoryFeedback } from './feedback.js';
import { driftMemoryHealth } from './health.js';
import { driftMemoryPredict } from './predict.js';
import { driftMemoryConflicts } from './conflicts.js';
import { driftMemoryGraph } from './graph.js';
import { driftMemoryQuery } from './query.js';
import { driftMemoryContradictions } from './contradictions.js';
import { driftAgentSpawn } from './agent-spawn.js';
import { driftGoal } from './goal.js';
import { driftIncident } from './incident.js';
import { driftWorkflow } from './workflow.js';
import { driftEntity } from './entity.js';
import { driftConversation } from './conversation.js';
import { driftMeeting } from './meeting.js';
import { driftSkill } from './skill.js';
import { driftEnvironment } from './environment.js';

/**
 * Memory tools for MCP registry
 * 
 * These are the Cortex V2 memory tools that provide:
 * - Memory retrieval with compression and session tracking
 * - Learning from corrections and feedback
 * - Causal narratives and explanations
 * - Health monitoring and validation
 * - Universal memory types (agent spawns, goals, incidents, workflows, entities)
 */
export const MEMORY_TOOLS: Tool[] = [
  // Core tools
  {
    name: memoryStatus.name,
    description: memoryStatus.description,
    inputSchema: memoryStatus.parameters as Tool['inputSchema'],
  },
  {
    name: driftWhy.name,
    description: driftWhy.description,
    inputSchema: driftWhy.parameters as Tool['inputSchema'],
  },
  {
    name: memoryForContext.name,
    description: memoryForContext.description,
    inputSchema: memoryForContext.parameters as Tool['inputSchema'],
  },
  {
    name: memorySearch.name,
    description: memorySearch.description,
    inputSchema: memorySearch.parameters as Tool['inputSchema'],
  },
  {
    name: memoryGet.name,
    description: memoryGet.description,
    inputSchema: memoryGet.parameters as Tool['inputSchema'],
  },
  {
    name: memoryAdd.name,
    description: memoryAdd.description,
    inputSchema: memoryAdd.parameters as Tool['inputSchema'],
  },
  {
    name: memoryLearn.name,
    description: memoryLearn.description,
    inputSchema: memoryLearn.parameters as Tool['inputSchema'],
  },
  {
    name: memoryValidate.name,
    description: memoryValidate.description,
    inputSchema: memoryValidate.parameters as Tool['inputSchema'],
  },
  // V2 tools
  {
    name: driftMemoryExplain.name,
    description: driftMemoryExplain.description,
    inputSchema: driftMemoryExplain.parameters as Tool['inputSchema'],
  },
  {
    name: driftMemoryFeedback.name,
    description: driftMemoryFeedback.description,
    inputSchema: driftMemoryFeedback.parameters as Tool['inputSchema'],
  },
  {
    name: driftMemoryHealth.name,
    description: driftMemoryHealth.description,
    inputSchema: driftMemoryHealth.parameters as Tool['inputSchema'],
  },
  {
    name: driftMemoryPredict.name,
    description: driftMemoryPredict.description,
    inputSchema: driftMemoryPredict.parameters as Tool['inputSchema'],
  },
  {
    name: driftMemoryConflicts.name,
    description: driftMemoryConflicts.description,
    inputSchema: driftMemoryConflicts.parameters as Tool['inputSchema'],
  },
  {
    name: driftMemoryGraph.name,
    description: driftMemoryGraph.description,
    inputSchema: driftMemoryGraph.parameters as Tool['inputSchema'],
  },
  {
    name: driftMemoryQuery.name,
    description: driftMemoryQuery.description,
    inputSchema: driftMemoryQuery.parameters as Tool['inputSchema'],
  },
  {
    name: driftMemoryContradictions.name,
    description: driftMemoryContradictions.description,
    inputSchema: driftMemoryContradictions.parameters as Tool['inputSchema'],
  },
  // Universal memory tools (v2)
  {
    name: driftAgentSpawn.name,
    description: driftAgentSpawn.description,
    inputSchema: driftAgentSpawn.parameters as Tool['inputSchema'],
  },
  {
    name: driftGoal.name,
    description: driftGoal.description,
    inputSchema: driftGoal.parameters as Tool['inputSchema'],
  },
  {
    name: driftIncident.name,
    description: driftIncident.description,
    inputSchema: driftIncident.parameters as Tool['inputSchema'],
  },
  {
    name: driftWorkflow.name,
    description: driftWorkflow.description,
    inputSchema: driftWorkflow.parameters as Tool['inputSchema'],
  },
  {
    name: driftEntity.name,
    description: driftEntity.description,
    inputSchema: driftEntity.parameters as Tool['inputSchema'],
  },
  {
    name: driftConversation.name,
    description: driftConversation.description,
    inputSchema: driftConversation.parameters as Tool['inputSchema'],
  },
  {
    name: driftMeeting.name,
    description: driftMeeting.description,
    inputSchema: driftMeeting.parameters as Tool['inputSchema'],
  },
  {
    name: driftSkill.name,
    description: driftSkill.description,
    inputSchema: driftSkill.parameters as Tool['inputSchema'],
  },
  {
    name: driftEnvironment.name,
    description: driftEnvironment.description,
    inputSchema: driftEnvironment.parameters as Tool['inputSchema'],
  },
];
