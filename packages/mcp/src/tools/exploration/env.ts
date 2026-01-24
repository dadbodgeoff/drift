/**
 * drift_env - Environment Variable Access Analysis
 * 
 * Exploration tool that provides environment variable access patterns:
 * - Variable discovery and classification
 * - Sensitivity analysis (secrets, credentials, config)
 * - Required vs optional variables
 * - Access patterns by file
 */

import type { EnvStore } from 'driftdetect-core';
import { createResponseBuilder } from '../../infrastructure/index.js';

export interface EnvData {
  overview: {
    totalVariables: number;
    totalAccessPoints: number;
    secretVariables: number;
    credentialVariables: number;
    configVariables: number;
  };
  byLanguage: Record<string, number>;
  byMethod: Record<string, number>;
  topVariables: Array<{
    name: string;
    sensitivity: string;
    accessCount: number;
    fileCount: number;
    hasDefault: boolean;
    isRequired: boolean;
  }>;
  secrets: Array<{
    name: string;
    accessCount: number;
    files: string[];
    hasDefault: boolean;
  }>;
  requiredVariables: Array<{
    name: string;
    sensitivity: string;
    accessCount: number;
  }>;
}

const DEFAULT_LIMIT = 10;

export async function handleEnv(
  store: EnvStore,
  args: {
    action?: 'overview' | 'list' | 'secrets' | 'required' | 'variable' | 'file';
    variable?: string;
    file?: string;
    sensitivity?: 'secret' | 'credential' | 'config';
    limit?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<EnvData>();
  const action = args.action ?? 'overview';
  const limit = args.limit ?? DEFAULT_LIMIT;
  
  await store.initialize();
  
  if (!store.hasData()) {
    return builder
      .withSummary('No environment variable data found. Run `drift env scan` first.')
      .withHints({
        nextActions: ['Run drift env scan to discover environment variable access patterns'],
        relatedTools: ['drift_status'],
      })
      .buildContent();
  }
  
  const accessMap = store.getAccessMap();
  
  // Handle specific actions
  if (action === 'variable' && args.variable) {
    return handleVariableDetail(store, args.variable, builder);
  }
  
  if (action === 'file' && args.file) {
    return handleFileAccess(store, args.file, builder);
  }
  
  if (action === 'secrets') {
    return handleSecrets(store, limit, builder);
  }
  
  if (action === 'required') {
    return handleRequired(store, limit, builder);
  }
  
  if (action === 'list') {
    return handleList(store, args.sensitivity, limit, builder);
  }
  
  // Default: overview
  const secrets = store.getSecrets();
  const required = store.getRequiredVariables();
  
  // Get top variables by access count
  const topVariables = Object.values(accessMap.variables)
    .sort((a, b) => b.accessedBy.length - a.accessedBy.length)
    .slice(0, limit)
    .map(v => ({
      name: v.name,
      sensitivity: v.sensitivity,
      accessCount: v.accessedBy.length,
      fileCount: v.files.length,
      hasDefault: v.hasDefault,
      isRequired: v.isRequired,
    }));
  
  const data: EnvData = {
    overview: {
      totalVariables: accessMap.stats.totalVariables,
      totalAccessPoints: accessMap.stats.totalAccessPoints,
      secretVariables: accessMap.stats.secretVariables,
      credentialVariables: accessMap.stats.credentialVariables,
      configVariables: accessMap.stats.configVariables,
    },
    byLanguage: accessMap.stats.byLanguage,
    byMethod: accessMap.stats.byMethod,
    topVariables,
    secrets: secrets.slice(0, 5).map(s => ({
      name: s.name,
      accessCount: s.accessedBy.length,
      files: s.files,
      hasDefault: s.hasDefault,
    })),
    requiredVariables: required.slice(0, 5).map(r => ({
      name: r.name,
      sensitivity: r.sensitivity,
      accessCount: r.accessedBy.length,
    })),
  };
  
  // Build summary
  let summary = `${accessMap.stats.totalVariables} environment variables, ${accessMap.stats.totalAccessPoints} access points. `;
  if (accessMap.stats.secretVariables > 0) {
    summary += `⚠️ ${accessMap.stats.secretVariables} secrets detected. `;
  }
  if (required.length > 0) {
    summary += `${required.length} required variables without defaults.`;
  }
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      secrets.length > 0 
        ? 'Review secret variables with action="secrets"'
        : 'Use action="list" to see all variables',
    ],
    relatedTools: ['drift_security_summary', 'drift_reachability'],
  };
  
  if (accessMap.stats.secretVariables > 0) {
    hints.warnings = [`${accessMap.stats.secretVariables} secret variables detected - review access patterns`];
  }
  if (required.length > 0) {
    hints.warnings = hints.warnings ?? [];
    hints.warnings.push(`${required.length} required variables need to be set`);
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}

async function handleVariableDetail(
  store: EnvStore,
  varName: string,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const varInfo = store.getVariable(varName);
  
  if (!varInfo) {
    return builder
      .withSummary(`Variable '${varName}' not found.`)
      .withHints({
        nextActions: ['Use action="list" to see all discovered variables'],
        relatedTools: ['drift_env'],
      })
      .buildContent();
  }
  
  const data = {
    name: varInfo.name,
    sensitivity: varInfo.sensitivity,
    hasDefault: varInfo.hasDefault,
    isRequired: varInfo.isRequired,
    accessCount: varInfo.accessedBy.length,
    fileCount: varInfo.files.length,
    files: varInfo.files,
    accessPoints: varInfo.accessedBy.map(ap => ({
      file: ap.file,
      line: ap.line,
      method: ap.method,
      hasDefault: ap.hasDefault,
      defaultValue: ap.defaultValue,
    })),
  };
  
  const summary = `${varName}: ${varInfo.sensitivity} variable, ${varInfo.accessedBy.length} access points in ${varInfo.files.length} files.`;
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Review access patterns for security implications'],
      relatedTools: ['drift_reachability', 'drift_impact_analysis'],
    })
    .buildContent();
}

async function handleFileAccess(
  store: EnvStore,
  filePattern: string,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const fileAccess = store.getFileAccess(filePattern);
  
  if (fileAccess.length === 0) {
    return builder
      .withSummary(`No environment access found for pattern '${filePattern}'.`)
      .withHints({
        nextActions: ['Try a different file pattern'],
        relatedTools: ['drift_files_list'],
      })
      .buildContent();
  }
  
  const data = {
    pattern: filePattern,
    matchedFiles: fileAccess.length,
    files: fileAccess.map(f => ({
      file: f.file,
      variables: f.variables,
      sensitiveVars: f.sensitiveVars,
      accessPoints: f.accessPoints.map(ap => ({
        varName: ap.varName,
        line: ap.line,
        method: ap.method,
        sensitivity: ap.sensitivity,
      })),
    })),
  };
  
  const totalVars = new Set(fileAccess.flatMap(f => f.variables)).size;
  const totalSensitive = new Set(fileAccess.flatMap(f => f.sensitiveVars)).size;
  
  let summary = `${fileAccess.length} files match pattern, accessing ${totalVars} variables.`;
  if (totalSensitive > 0) {
    summary += ` ⚠️ ${totalSensitive} sensitive variables accessed.`;
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: totalSensitive > 0 
        ? ['Review sensitive variable access in these files']
        : ['Environment access looks clean'],
      relatedTools: ['drift_file_patterns', 'drift_security_summary'],
    })
    .buildContent();
}

async function handleSecrets(
  store: EnvStore,
  limit: number,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const secrets = store.getSecrets();
  const credentials = store.getCredentials();
  
  const data = {
    secrets: secrets.slice(0, limit).map(s => ({
      name: s.name,
      accessCount: s.accessedBy.length,
      files: s.files,
      hasDefault: s.hasDefault,
      isRequired: s.isRequired,
    })),
    credentials: credentials.slice(0, limit).map(c => ({
      name: c.name,
      accessCount: c.accessedBy.length,
      files: c.files,
      hasDefault: c.hasDefault,
      isRequired: c.isRequired,
    })),
    totalSecrets: secrets.length,
    totalCredentials: credentials.length,
  };
  
  let summary = `${secrets.length} secrets, ${credentials.length} credentials detected.`;
  
  const warnings: string[] = [];
  const secretsWithDefaults = secrets.filter(s => s.hasDefault);
  if (secretsWithDefaults.length > 0) {
    warnings.push(`${secretsWithDefaults.length} secrets have hardcoded defaults - security risk!`);
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Review secret access patterns', 'Ensure secrets are not hardcoded'],
      warnings: warnings.length > 0 ? warnings : undefined,
      relatedTools: ['drift_security_summary', 'drift_reachability'],
    })
    .buildContent();
}

async function handleRequired(
  store: EnvStore,
  limit: number,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const required = store.getRequiredVariables();
  
  const data = {
    required: required.slice(0, limit).map(r => ({
      name: r.name,
      sensitivity: r.sensitivity,
      accessCount: r.accessedBy.length,
      files: r.files,
    })),
    totalRequired: required.length,
  };
  
  const summary = required.length > 0
    ? `${required.length} required variables must be set for the application to work.`
    : 'All variables have defaults or are optional.';
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: required.length > 0 
        ? ['Document required variables', 'Add to .env.example']
        : ['Environment configuration looks complete'],
      relatedTools: ['drift_env'],
    })
    .buildContent();
}

async function handleList(
  store: EnvStore,
  sensitivity: string | undefined,
  limit: number,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const accessMap = store.getAccessMap();
  let variables = Object.values(accessMap.variables);
  
  if (sensitivity) {
    variables = variables.filter(v => v.sensitivity === sensitivity);
  }
  
  variables.sort((a, b) => b.accessedBy.length - a.accessedBy.length);
  
  const data = {
    filter: sensitivity ?? 'all',
    total: variables.length,
    variables: variables.slice(0, limit).map(v => ({
      name: v.name,
      sensitivity: v.sensitivity,
      accessCount: v.accessedBy.length,
      fileCount: v.files.length,
      hasDefault: v.hasDefault,
      isRequired: v.isRequired,
    })),
  };
  
  const summary = sensitivity
    ? `${variables.length} ${sensitivity} variables found.`
    : `${variables.length} environment variables found.`;
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Use variable="NAME" to see details for a specific variable'],
      relatedTools: ['drift_env'],
    })
    .buildContent();
}
