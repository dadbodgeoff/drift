/**
 * Logging detectors module exports
 *
 * Detects logging and observability patterns including:
 * - Structured logging format
 * - Log levels
 * - Context fields
 * - Correlation IDs
 * - PII redaction
 * - Metric naming
 * - Health checks
 *
 * @requirements 15.1-15.7 - Logging patterns
 */

// Structured Format Detector
export {
  type StructuredFormatPatternType,
  type StructuredFormatPatternInfo,
  type StructuredFormatAnalysis,
  JSON_LOGGING_PATTERNS,
  KEY_VALUE_LOGGING_PATTERNS,
  WINSTON_PATTERNS,
  PINO_PATTERNS,
  BUNYAN_PATTERNS,
  CONSOLE_LOG_PATTERNS,
  shouldExcludeFile as shouldExcludeStructuredFile,
  detectJSONLogging,
  detectWinstonLogger,
  detectPinoLogger,
  detectConsoleLog,
  analyzeStructuredFormat,
  StructuredFormatDetector,
  createStructuredFormatDetector,
} from './structured-format.js';

// Log Levels Detector
export {
  type LogLevelPatternType,
  type LogLevelPatternInfo,
  type LogLevelAnalysis,
  DEBUG_LEVEL_PATTERNS,
  INFO_LEVEL_PATTERNS,
  WARN_LEVEL_PATTERNS,
  ERROR_LEVEL_PATTERNS,
  FATAL_LEVEL_PATTERNS,
  TRACE_LEVEL_PATTERNS,
  LEVEL_CONFIG_PATTERNS,
  shouldExcludeFile as shouldExcludeLogLevelFile,
  analyzeLogLevels,
  LogLevelsDetector,
  createLogLevelsDetector,
} from './log-levels.js';

// Context Fields Detector
export {
  type ContextFieldPatternType,
  type ContextFieldPatternInfo,
  type ContextFieldAnalysis,
  REQUEST_ID_PATTERNS as CONTEXT_REQUEST_ID_PATTERNS,
  USER_ID_PATTERNS as CONTEXT_USER_ID_PATTERNS,
  TIMESTAMP_PATTERNS,
  SERVICE_NAME_PATTERNS,
  CUSTOM_CONTEXT_PATTERNS,
  shouldExcludeFile as shouldExcludeContextFile,
  analyzeContextFields,
  ContextFieldsDetector,
  createContextFieldsDetector,
} from './context-fields.js';

// Correlation IDs Detector
export {
  type CorrelationIdPatternType,
  type CorrelationIdPatternInfo,
  type CorrelationIdAnalysis,
  CORRELATION_ID_PATTERNS,
  TRACE_ID_PATTERNS,
  SPAN_ID_PATTERNS,
  REQUEST_ID_PATTERNS,
  PROPAGATION_PATTERNS,
  shouldExcludeFile as shouldExcludeCorrelationFile,
  analyzeCorrelationIds,
  CorrelationIdsDetector,
  createCorrelationIdsDetector,
} from './correlation-ids.js';

// PII Redaction Detector
export {
  type PIIRedactionPatternType,
  type PIIRedactionPatternInfo,
  type PIIRedactionAnalysis,
  REDACT_FUNCTION_PATTERNS,
  MASK_FUNCTION_PATTERNS,
  SANITIZE_FUNCTION_PATTERNS,
  SENSITIVE_FIELD_PATTERNS,
  REDACTION_CONFIG_PATTERNS,
  shouldExcludeFile as shouldExcludePIIFile,
  analyzePIIRedaction,
  PIIRedactionDetector,
  createPIIRedactionDetector,
} from './pii-redaction.js';

// Metric Naming Detector
export {
  type MetricNamingPatternType,
  type MetricNamingPatternInfo,
  type MetricNamingAnalysis,
  COUNTER_METRIC_PATTERNS,
  GAUGE_METRIC_PATTERNS,
  HISTOGRAM_METRIC_PATTERNS,
  SUMMARY_METRIC_PATTERNS,
  METRIC_PREFIX_PATTERNS,
  shouldExcludeFile as shouldExcludeMetricFile,
  analyzeMetricNaming,
  MetricNamingDetector,
  createMetricNamingDetector,
} from './metric-naming.js';

// Health Checks Detector
export {
  type HealthCheckPatternType,
  type HealthCheckPatternInfo,
  type HealthCheckAnalysis,
  HEALTH_ENDPOINT_PATTERNS,
  LIVENESS_PROBE_PATTERNS,
  READINESS_PROBE_PATTERNS,
  HEALTH_CHECK_FUNCTION_PATTERNS,
  DEPENDENCY_CHECK_PATTERNS,
  shouldExcludeFile as shouldExcludeHealthFile,
  analyzeHealthChecks,
  HealthChecksDetector,
  createHealthChecksDetector,
} from './health-checks.js';

// Import factory functions for createAllLoggingDetectors
import { createStructuredFormatDetector } from './structured-format.js';
import { createLogLevelsDetector } from './log-levels.js';
import { createContextFieldsDetector } from './context-fields.js';
import { createCorrelationIdsDetector } from './correlation-ids.js';
import { createPIIRedactionDetector } from './pii-redaction.js';
import { createMetricNamingDetector } from './metric-naming.js';
import { createHealthChecksDetector } from './health-checks.js';

// Convenience factory for all logging detectors
export function createAllLoggingDetectors() {
  return {
    structuredFormat: createStructuredFormatDetector(),
    logLevels: createLogLevelsDetector(),
    contextFields: createContextFieldsDetector(),
    correlationIds: createCorrelationIdsDetector(),
    piiRedaction: createPIIRedactionDetector(),
    metricNaming: createMetricNamingDetector(),
    healthChecks: createHealthChecksDetector(),
  };
}

// ============================================================================
// Learning-Based Detectors
// ============================================================================

// Log Levels Learning Detector
export {
  LogLevelsLearningDetector,
  createLogLevelsLearningDetector,
  type LogLevelConventions,
  type LoggerLibrary,
} from './log-levels-learning.js';

// Metric Naming Learning Detector
export {
  MetricNamingLearningDetector,
  createMetricNamingLearningDetector,
  type MetricNamingConventions,
  type MetricNamingStyle,
} from './metric-naming-learning.js';

// Structured Format Learning Detector
export {
  StructuredFormatLearningDetector,
  createStructuredFormatLearningDetector,
  type StructuredFormatConventions,
  type LoggingLibrary,
  type LogFormat,
} from './structured-format-learning.js';

// Context Fields Learning Detector
export {
  ContextFieldsLearningDetector,
  createContextFieldsLearningDetector,
  type ContextFieldsConventions,
  type ContextFieldStyle,
} from './context-fields-learning.js';

// Correlation IDs Learning Detector
export {
  CorrelationIdsLearningDetector,
  createCorrelationIdsLearningDetector,
  type CorrelationIdsConventions,
  type CorrelationIdName,
} from './correlation-ids-learning.js';

// Health Checks Learning Detector
export {
  HealthChecksLearningDetector,
  createHealthChecksLearningDetector,
  type HealthChecksConventions,
  type HealthCheckType,
  type ResponseFormat,
} from './health-checks-learning.js';

// PII Redaction Learning Detector
export {
  PIIRedactionLearningDetector,
  createPIIRedactionLearningDetector,
  type PIIRedactionConventions,
  type RedactionMethod,
  type PIIFieldPattern,
} from './pii-redaction-learning.js';

// ============================================================================
// Semantic Detectors (Language-Agnostic)
// ============================================================================

export {
  StructuredLoggingSemanticDetector,
  createStructuredLoggingSemanticDetector,
} from './structured-logging-semantic.js';

export {
  LogLevelsSemanticDetector,
  createLogLevelsSemanticDetector,
} from './log-levels-semantic.js';

export {
  ContextFieldsSemanticDetector,
  createContextFieldsSemanticDetector,
} from './context-fields-semantic.js';

export {
  CorrelationIdsSemanticDetector,
  createCorrelationIdsSemanticDetector,
} from './correlation-ids-semantic.js';

export {
  PIIRedactionSemanticDetector,
  createPIIRedactionSemanticDetector,
} from './pii-redaction-semantic.js';

export {
  MetricsSemanticDetector,
  createMetricsSemanticDetector,
} from './metrics-semantic.js';

export {
  HealthChecksSemanticDetector,
  createHealthChecksSemanticDetector,
} from './health-checks-semantic.js';

// ============================================================================
// ASP.NET Core Detectors (C#)
// ============================================================================

export {
  ILoggerPatternsDetector,
  createILoggerPatternsDetector,
  type ILoggerPatternInfo,
  type ILoggerAnalysis,
} from './aspnet/ilogger-patterns-detector.js';
