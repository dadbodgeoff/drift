import { createDriftCapabilities,DRIFT_CONTRACT_SCHEMA_VERSION,DRIFT_CORE_VERSION,DRIFT_RULE_ENGINE_VERSION,DRIFT_SCANNER_VERSION,DRIFT_TYPESCRIPT_ADAPTER_VERSION } from "@drift/core";
import { MIGRATIONS } from "@drift/storage";
import { preflightGovernance } from "./governance.js";

export const SUPPORTED_SQLITE_SCHEMA_VERSION = MIGRATIONS.length;

export const DRIFT_CLI_VERSION = "0.1.0";

export function doctorRuntime(): {
  cli_version: string;
  core_version: string;
  scanner_version: string;
  typescript_adapter_version: string;
  rule_engine_version: string;
  contract_schema_version: number;
  supported_sqlite_schema_version: number;
  storage_driver: "sqlite";
} {
  return {
    cli_version: DRIFT_CLI_VERSION,
    core_version: DRIFT_CORE_VERSION,
    scanner_version: DRIFT_SCANNER_VERSION,
    typescript_adapter_version: DRIFT_TYPESCRIPT_ADAPTER_VERSION,
    rule_engine_version: DRIFT_RULE_ENGINE_VERSION,
    contract_schema_version: DRIFT_CONTRACT_SCHEMA_VERSION,
    supported_sqlite_schema_version: SUPPORTED_SQLITE_SCHEMA_VERSION,
    storage_driver: "sqlite"
  };
}

export function versionPayload(): {
  runtime: ReturnType<typeof doctorRuntime>;
  v1_scope: ReturnType<typeof doctorV1Scope>;
} {
  return {
    runtime: doctorRuntime(),
    v1_scope: doctorV1Scope()
  };
}

export function capabilitiesPayload(): {
  runtime: ReturnType<typeof doctorRuntime>;
  v1_scope: ReturnType<typeof doctorV1Scope>;
  governance: ReturnType<typeof preflightGovernance>;
  capabilities: ReturnType<typeof createDriftCapabilities>;
} {
  return {
    runtime: doctorRuntime(),
    v1_scope: doctorV1Scope(),
    governance: preflightGovernance(),
    capabilities: createDriftCapabilities()
  };
}

export function formatCapabilitiesText(payload: ReturnType<typeof capabilitiesPayload>): string {
  return [
    "Drift capabilities",
    `Mode: ${payload.v1_scope.product_mode}`,
    `Wedge: ${payload.v1_scope.primary_wedge}`,
    `Storage: ${payload.capabilities.supported_wedge.storage}`,
    `No-approval CLI: ${payload.capabilities.read_only_cli.join(", ")}`,
    `Human-confirmed CLI: ${payload.capabilities.human_confirmed_cli.join(", ")}`,
    `Read-only MCP: ${payload.capabilities.mcp_read_only_tools.join(", ")}`,
    `MCP mutations: ${payload.capabilities.mcp_mutation_tools.length}`,
    `Deferred: ${payload.capabilities.deferred.join(", ")}`,
    ""
  ].join("\n");
}

export function doctorV1Scope(): {
  product_mode: "local_first_cli";
  primary_wedge: "typescript_api_route_layering";
  mutation_model: "human_confirmed_governance_only";
  source_mutation: false;
  language_adapters: string[];
  deferred: string[];
} {
  return {
    product_mode: "local_first_cli",
    primary_wedge: "typescript_api_route_layering",
    mutation_model: "human_confirmed_governance_only",
    source_mutation: false,
    language_adapters: ["typescript"],
    deferred: ["desktop_ui", "cloud_sync", "python_adapter", "duplicate_helper_detection"]
  };
}

export function assertSupportedLocalDatabase(appliedMigrations: string[]): void {
  if (appliedMigrations.length > SUPPORTED_SQLITE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Drift database migration count ${appliedMigrations.length}. ` +
        `This Drift build supports ${SUPPORTED_SQLITE_SCHEMA_VERSION}.`
    );
  }
  const known = new Set(MIGRATIONS.map((migration) => migration.id));
  const unknown = appliedMigrations.filter((migration) => !known.has(migration));
  if (unknown.length > 0) {
    throw new Error(`Unsupported Drift database migration: ${unknown.join(", ")}.`);
  }
}

export function sqliteSchemaCompatibility(appliedMigrations: string[]): {
  supported: boolean;
  unsupported_migrations: string[];
  missing_migrations: string[];
} {
  const knownMigrations = MIGRATIONS.map((migration) => migration.id);
  const known = new Set(knownMigrations);
  const unsupportedMigrations = appliedMigrations.filter((migration) => !known.has(migration));
  const expectedPrefix = knownMigrations.slice(0, appliedMigrations.length);
  const missingMigrations = expectedPrefix.filter((migration) => !appliedMigrations.includes(migration));
  return {
    supported: appliedMigrations.length <= SUPPORTED_SQLITE_SCHEMA_VERSION &&
      unsupportedMigrations.length === 0 &&
      missingMigrations.length === 0,
    unsupported_migrations: unsupportedMigrations,
    missing_migrations: missingMigrations
  };
}
