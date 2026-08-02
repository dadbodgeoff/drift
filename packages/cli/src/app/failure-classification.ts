import { classifyFailure, classifyFailureMessage } from "@drift/core";

/**
 * CLI adapter over the shared failure classifier in @drift/core.
 *
 * The classification itself (codes, actions, retry guidance, the DriftError and corrupt-blob
 * marker precedence) lives in core so the MCP surface reports identical failures (F-2). This
 * adapter only adds the CLI envelope fields: surface, severity, and the diagnostics echo.
 */
export interface OperationalFailure {
  code: string;
  surface: "cli";
  severity: "error";
  safe_to_retry: boolean;
  user_action: string;
  recovery_commands: string[];
  diagnostics: string[];
}

export function operationalFailureFor(error: unknown, message: string): OperationalFailure {
  return withCliEnvelope(classifyFailure(error, message), message);
}

export function operationalFailureForMessage(message: string): OperationalFailure {
  return withCliEnvelope(classifyFailureMessage(message), message);
}

function withCliEnvelope(
  failure: ReturnType<typeof classifyFailureMessage>,
  message: string
): OperationalFailure {
  return {
    code: failure.code,
    surface: "cli",
    severity: "error",
    safe_to_retry: failure.safe_to_retry,
    user_action: failure.user_action,
    recovery_commands: failure.recovery_commands,
    diagnostics: [message]
  };
}
