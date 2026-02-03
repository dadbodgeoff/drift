/**
 * drift_telemetry - Manage telemetry settings via MCP
 * 
 * Allows AI agents to help users enable/disable telemetry
 * and check current status.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const DRIFT_DIR = '.drift';

interface TelemetryInput {
  action: 'status' | 'enable' | 'disable';
}

interface TelemetryConfig {
  enabled?: boolean;
  sharePatternSignatures?: boolean;
  shareAggregateStats?: boolean;
  shareUserActions?: boolean;
  installationId?: string;
  enabledAt?: string;
}

interface TelemetryResult {
  success: boolean;
  enabled?: boolean;
  config?: {
    sharePatternSignatures: boolean;
    shareAggregateStats: boolean;
    shareUserActions: boolean;
    installationId?: string;
    enabledAt?: string;
  };
  message?: string;
  error?: string;
}

interface TelemetryContext {
  projectRoot: string;
}

/**
 * Handle telemetry management requests
 */
export async function handleTelemetry(
  input: TelemetryInput,
  context: TelemetryContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { action } = input;
  const { projectRoot } = context;
  
  try {
    const configPath = path.join(projectRoot, DRIFT_DIR, 'config.json');
    
    // Check if drift is initialized
    try {
      await fs.access(configPath);
    } catch {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'NOT_INITIALIZED',
            message: 'Drift not initialized. Run drift_setup action="init" first.',
          }),
        }],
      };
    }
    
    // Load config
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent) as Record<string, unknown>;
    
    let result: TelemetryResult;
    
    switch (action) {
      case 'status':
        result = handleStatus(config);
        break;
      case 'enable':
        result = await handleEnable(config, configPath);
        break;
      case 'disable':
        result = await handleDisable(config, configPath);
        break;
      default:
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'INVALID_ACTION',
              message: `Unknown action: ${action}. Use status, enable, or disable.`,
            }),
          }],
        };
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'TELEMETRY_ERROR',
          message: (error as Error).message,
        }),
      }],
    };
  }
}

function handleStatus(config: Record<string, unknown>): TelemetryResult {
  const telemetry = config['telemetry'] as TelemetryConfig | undefined;
  
  if (!telemetry) {
    return {
      success: true,
      enabled: false,
      message: 'Telemetry not configured. Run with action="enable" to opt-in.',
    };
  }
  
  return {
    success: true,
    enabled: telemetry.enabled ?? false,
    config: {
      sharePatternSignatures: telemetry.sharePatternSignatures ?? false,
      shareAggregateStats: telemetry.shareAggregateStats ?? false,
      shareUserActions: telemetry.shareUserActions ?? false,
      ...(telemetry.installationId ? { installationId: telemetry.installationId } : {}),
      ...(telemetry.enabledAt ? { enabledAt: telemetry.enabledAt } : {}),
    },
  };
}

async function handleEnable(
  config: Record<string, unknown>,
  configPath: string
): Promise<TelemetryResult> {
  const telemetry = (config['telemetry'] as TelemetryConfig) ?? {};
  
  // Generate installation ID if not present
  const installationId = telemetry.installationId ?? crypto.randomUUID();
  const enabledAt = new Date().toISOString();
  
  const updatedTelemetry: TelemetryConfig = {
    enabled: true,
    sharePatternSignatures: true,
    shareAggregateStats: true,
    shareUserActions: false, // Keep this opt-in for privacy
    installationId,
    enabledAt,
  };
  
  config['telemetry'] = updatedTelemetry;
  
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  
  return {
    success: true,
    enabled: true,
    config: {
      sharePatternSignatures: true,
      shareAggregateStats: true,
      shareUserActions: false,
      installationId,
      enabledAt,
    },
    message: 'Telemetry enabled. Thank you for helping improve Drift! No source code is ever sent.',
  };
}

async function handleDisable(
  config: Record<string, unknown>,
  configPath: string
): Promise<TelemetryResult> {
  const telemetry = (config['telemetry'] as TelemetryConfig) ?? {};
  
  const updatedTelemetry: TelemetryConfig = {
    ...telemetry,
    enabled: false,
    sharePatternSignatures: false,
    shareAggregateStats: false,
    shareUserActions: false,
  };
  
  config['telemetry'] = updatedTelemetry;
  
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  
  return {
    success: true,
    enabled: false,
    message: 'Telemetry disabled.',
  };
}

/**
 * Tool definition for drift_telemetry
 */
export const telemetryToolDefinition = {
  name: 'drift_telemetry',
  description: `Manage telemetry settings for Drift. Telemetry helps improve pattern detection by sharing anonymized data (no source code is ever sent).

Actions:
- status: Check current telemetry settings
- enable: Enable telemetry (opt-in to help improve Drift)
- disable: Disable telemetry

Privacy: Only pattern signatures (hashes), categories, and aggregate statistics are shared. No source code, file paths, or identifiable information is transmitted.`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'enable', 'disable'],
        description: 'Action to perform',
      },
    },
    required: ['action'],
  },
};
