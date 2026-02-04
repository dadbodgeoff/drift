/**
 * drift_env - Environment Variable Access Analysis
 * 
 * Exploration tool that provides environment variable access patterns:
 * - Variable discovery and classification
 * - Sensitivity analysis (secrets, credentials, config)
 * - Required vs optional variables
 * - Access patterns by file
 */

import { createResponseBuilder } from '../../infrastructure/index.js';

import type { EnvStore } from 'driftdetect-core';
import type { UnifiedStore } from 'driftdetect-core/storage';

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
      .withData({
        overview: {
          totalVariables: 0,
          totalAccessPoints: 0,
          secretVariables: 0,
          credentialVariables: 0,
          configVariables: 0,
        },
        byLanguage: {},
        byMethod: {},
        topVariables: [],
        secrets: [],
        requiredVariables: [],
      } as EnvData)
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
  
  const summary = `${secrets.length} secrets, ${credentials.length} credentials detected.`;
  
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

/**
 * SQLite-backed handler for environment variable analysis
 * Reads from UnifiedStore instead of JSON EnvStore
 */
export async function handleEnvWithSqlite(
  store: UnifiedStore,
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
  
  // Get data from SQLite repositories
  const variables = await store.environment.getVariables();
  const accessPoints = await store.environment.getAccessPoints();
  
  if (variables.length === 0) {
    return builder
      .withSummary('No environment variable data found. Run `drift env scan` first.')
      .withData({
        overview: {
          totalVariables: 0,
          totalAccessPoints: 0,
          secretVariables: 0,
          credentialVariables: 0,
          configVariables: 0,
        },
        byLanguage: {},
        byMethod: {},
        topVariables: [],
        secrets: [],
        requiredVariables: [],
      } as EnvData)
      .withHints({
        nextActions: ['Run drift env scan to discover environment variable access patterns'],
        relatedTools: ['drift_status'],
      })
      .buildContent();
  }
  
  // Handle specific variable lookup
  if (action === 'variable' && args.variable) {
    return handleVariableDetailWithSqlite(store, args.variable, builder);
  }
  
  // Handle file access lookup
  if (action === 'file' && args.file) {
    return handleFileAccessWithSqlite(store, args.file, builder);
  }
  
  // Handle secrets lookup
  if (action === 'secrets') {
    return handleSecretsWithSqlite(store, limit, builder);
  }
  
  // Handle required variables lookup
  if (action === 'required') {
    return handleRequiredWithSqlite(store, limit, builder);
  }
  
  // Handle list action
  if (action === 'list') {
    return handleListWithSqlite(store, args.sensitivity, limit, builder);
  }
  
  // Default: overview
  const secrets = await store.environment.getSecrets();
  const required = await store.environment.getRequired();
  
  // Calculate stats
  const secretCount = variables.filter(v => v.sensitivity === 'secret').length;
  const credentialCount = variables.filter(v => v.sensitivity === 'credential').length;
  const configCount = variables.filter(v => v.sensitivity === 'config').length;
  
  // Group by language and method
  const byLanguage: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  for (const ap of accessPoints) {
    const lang = ap.language ?? 'unknown';
    const method = ap.method ?? 'unknown';
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    byMethod[method] = (byMethod[method] ?? 0) + 1;
  }
  
  // Build variable access counts
  const varAccessCounts = new Map<string, { count: number; files: Set<string> }>();
  for (const ap of accessPoints) {
    const existing = varAccessCounts.get(ap.var_name);
    if (existing) {
      existing.count++;
      existing.files.add(ap.file);
    } else {
      varAccessCounts.set(ap.var_name, { count: 1, files: new Set([ap.file]) });
    }
  }
  
  // Get top variables by access count
  const topVariables = variables
    .map(v => {
      const accessInfo = varAccessCounts.get(v.name) ?? { count: 0, files: new Set() };
      return {
        name: v.name,
        sensitivity: v.sensitivity,
        accessCount: accessInfo.count,
        fileCount: accessInfo.files.size,
        hasDefault: Boolean(v.has_default),
        isRequired: Boolean(v.is_required),
      };
    })
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, limit);
  
  const data: EnvData = {
    overview: {
      totalVariables: variables.length,
      totalAccessPoints: accessPoints.length,
      secretVariables: secretCount,
      credentialVariables: credentialCount,
      configVariables: configCount,
    },
    byLanguage,
    byMethod,
    topVariables,
    secrets: secrets.slice(0, 5).map(s => {
      const accessInfo = varAccessCounts.get(s.name) ?? { count: 0, files: new Set() };
      return {
        name: s.name,
        accessCount: accessInfo.count,
        files: Array.from(accessInfo.files),
        hasDefault: Boolean(s.has_default),
      };
    }),
    requiredVariables: required.slice(0, 5).map(r => {
      const accessInfo = varAccessCounts.get(r.name) ?? { count: 0, files: new Set() };
      return {
        name: r.name,
        sensitivity: r.sensitivity,
        accessCount: accessInfo.count,
      };
    }),
  };
  
  // Build summary
  let summary = `${variables.length} environment variables, ${accessPoints.length} access points. `;
  if (secretCount > 0) {
    summary += `⚠️ ${secretCount} secrets detected. `;
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
  
  if (secretCount > 0) {
    hints.warnings = [`${secretCount} secret variables detected - review access patterns`];
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

async function handleVariableDetailWithSqlite(
  store: UnifiedStore,
  varName: string,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const varInfo = await store.environment.getVariable(varName);
  
  if (!varInfo) {
    return builder
      .withSummary(`Variable '${varName}' not found.`)
      .withHints({
        nextActions: ['Use action="list" to see all discovered variables'],
        relatedTools: ['drift_env'],
      })
      .buildContent();
  }
  
  const accessPoints = await store.environment.getAccessPoints(varName);
  const files = new Set(accessPoints.map(ap => ap.file));
  
  const data = {
    name: varInfo.name,
    sensitivity: varInfo.sensitivity,
    hasDefault: Boolean(varInfo.has_default),
    isRequired: Boolean(varInfo.is_required),
    accessCount: accessPoints.length,
    fileCount: files.size,
    files: Array.from(files),
    accessPoints: accessPoints.map(ap => ({
      file: ap.file,
      line: ap.line,
      method: ap.method,
      hasDefault: Boolean(ap.has_default),
      defaultValue: ap.default_value,
    })),
  };
  
  const summary = `${varName}: ${varInfo.sensitivity} variable, ${accessPoints.length} access points in ${files.size} files.`;
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Review access patterns for security implications'],
      relatedTools: ['drift_reachability', 'drift_impact_analysis'],
    })
    .buildContent();
}

async function handleFileAccessWithSqlite(
  store: UnifiedStore,
  filePattern: string,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const allAccessPoints = await store.environment.getAccessPoints();
  const variables = await store.environment.getVariables();
  
  // Filter access points by file pattern
  const matchingAccessPoints = allAccessPoints.filter(ap => 
    ap.file.includes(filePattern) || ap.file.match(new RegExp(filePattern.replace(/\*/g, '.*')))
  );
  
  if (matchingAccessPoints.length === 0) {
    return builder
      .withSummary(`No environment access found for pattern '${filePattern}'.`)
      .withHints({
        nextActions: ['Try a different file pattern'],
        relatedTools: ['drift_files_list'],
      })
      .buildContent();
  }
  
  // Group by file
  const fileMap = new Map<string, typeof matchingAccessPoints>();
  for (const ap of matchingAccessPoints) {
    const existing = fileMap.get(ap.file);
    if (existing) {
      existing.push(ap);
    } else {
      fileMap.set(ap.file, [ap]);
    }
  }
  
  // Build variable sensitivity map
  const varSensitivity = new Map(variables.map(v => [v.name, v.sensitivity]));
  
  const fileAccess = Array.from(fileMap.entries()).map(([file, aps]) => {
    const vars = new Set(aps.map(ap => ap.var_name));
    const sensitiveVars = Array.from(vars).filter(v => {
      const sens = varSensitivity.get(v);
      return sens === 'secret' || sens === 'credential';
    });
    
    return {
      file,
      variables: Array.from(vars),
      sensitiveVars,
      accessPoints: aps.map(ap => ({
        varName: ap.var_name,
        line: ap.line,
        method: ap.method,
        sensitivity: varSensitivity.get(ap.var_name) ?? 'config',
      })),
    };
  });
  
  const data = {
    pattern: filePattern,
    matchedFiles: fileAccess.length,
    files: fileAccess,
  };
  
  const totalVars = new Set(matchingAccessPoints.map(ap => ap.var_name)).size;
  const totalSensitive = new Set(
    matchingAccessPoints
      .filter(ap => {
        const sens = varSensitivity.get(ap.var_name);
        return sens === 'secret' || sens === 'credential';
      })
      .map(ap => ap.var_name)
  ).size;
  
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

async function handleSecretsWithSqlite(
  store: UnifiedStore,
  limit: number,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const secrets = await store.environment.getSecrets();
  const accessPoints = await store.environment.getAccessPoints();
  
  // Build access counts
  const varAccessCounts = new Map<string, { count: number; files: Set<string> }>();
  for (const ap of accessPoints) {
    const existing = varAccessCounts.get(ap.var_name);
    if (existing) {
      existing.count++;
      existing.files.add(ap.file);
    } else {
      varAccessCounts.set(ap.var_name, { count: 1, files: new Set([ap.file]) });
    }
  }
  
  const secretVars = secrets.filter(s => s.sensitivity === 'secret');
  const credentialVars = secrets.filter(s => s.sensitivity === 'credential');
  
  const data = {
    secrets: secretVars.slice(0, limit).map(s => {
      const accessInfo = varAccessCounts.get(s.name) ?? { count: 0, files: new Set() };
      return {
        name: s.name,
        accessCount: accessInfo.count,
        files: Array.from(accessInfo.files),
        hasDefault: Boolean(s.has_default),
        isRequired: Boolean(s.is_required),
      };
    }),
    credentials: credentialVars.slice(0, limit).map(c => {
      const accessInfo = varAccessCounts.get(c.name) ?? { count: 0, files: new Set() };
      return {
        name: c.name,
        accessCount: accessInfo.count,
        files: Array.from(accessInfo.files),
        hasDefault: Boolean(c.has_default),
        isRequired: Boolean(c.is_required),
      };
    }),
    totalSecrets: secretVars.length,
    totalCredentials: credentialVars.length,
  };
  
  const summary = `${secretVars.length} secrets, ${credentialVars.length} credentials detected.`;
  
  const warnings: string[] = [];
  const secretsWithDefaults = secrets.filter(s => s.has_default);
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

async function handleRequiredWithSqlite(
  store: UnifiedStore,
  limit: number,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const required = await store.environment.getRequired();
  const accessPoints = await store.environment.getAccessPoints();
  
  // Build access counts
  const varAccessCounts = new Map<string, { count: number; files: Set<string> }>();
  for (const ap of accessPoints) {
    const existing = varAccessCounts.get(ap.var_name);
    if (existing) {
      existing.count++;
      existing.files.add(ap.file);
    } else {
      varAccessCounts.set(ap.var_name, { count: 1, files: new Set([ap.file]) });
    }
  }
  
  const data = {
    required: required.slice(0, limit).map(r => {
      const accessInfo = varAccessCounts.get(r.name) ?? { count: 0, files: new Set() };
      return {
        name: r.name,
        sensitivity: r.sensitivity,
        accessCount: accessInfo.count,
        files: Array.from(accessInfo.files),
      };
    }),
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

async function handleListWithSqlite(
  store: UnifiedStore,
  sensitivity: string | undefined,
  limit: number,
  builder: ReturnType<typeof createResponseBuilder>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let variables = await store.environment.getVariables(sensitivity as 'secret' | 'credential' | 'config' | undefined);
  const accessPoints = await store.environment.getAccessPoints();
  
  // Build access counts
  const varAccessCounts = new Map<string, { count: number; files: Set<string> }>();
  for (const ap of accessPoints) {
    const existing = varAccessCounts.get(ap.var_name);
    if (existing) {
      existing.count++;
      existing.files.add(ap.file);
    } else {
      varAccessCounts.set(ap.var_name, { count: 1, files: new Set([ap.file]) });
    }
  }
  
  // Sort by access count
  const sortedVars = variables
    .map(v => {
      const accessInfo = varAccessCounts.get(v.name) ?? { count: 0, files: new Set() };
      return {
        name: v.name,
        sensitivity: v.sensitivity,
        accessCount: accessInfo.count,
        fileCount: accessInfo.files.size,
        hasDefault: Boolean(v.has_default),
        isRequired: Boolean(v.is_required),
      };
    })
    .sort((a, b) => b.accessCount - a.accessCount);
  
  const data = {
    filter: sensitivity ?? 'all',
    total: sortedVars.length,
    variables: sortedVars.slice(0, limit),
  };
  
  const summary = sensitivity
    ? `${sortedVars.length} ${sensitivity} variables found.`
    : `${sortedVars.length} environment variables found.`;
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints({
      nextActions: ['Use variable="NAME" to see details for a specific variable'],
      relatedTools: ['drift_env'],
    })
    .buildContent();
}
