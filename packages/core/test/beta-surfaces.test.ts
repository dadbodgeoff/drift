import { describe, expect, it } from "vitest";
import {
  BetaDoctorResponseSchema,
  BetaStartResponseSchema,
  BETA_DOCTOR_RESPONSE_SCHEMA,
  BETA_START_RESPONSE_SCHEMA
} from "../src/index.js";

describe("beta surface schemas", () => {
  it("requires response_schema on start output", () => {
    const result = BetaStartResponseSchema.safeParse({
      repo: {},
      scan: {},
      candidates: [],
      summary: {},
      onboarding: {},
      state: {},
      baselined_count: 0,
      machine_contract_versions: {},
      engine: {},
      v1_scope: {},
      next_commands: []
    });
    expect(result.success).toBe(false);
  });

  it("accepts the required start beta contract shape", () => {
    expect(BetaStartResponseSchema.parse({
      response_schema: BETA_START_RESPONSE_SCHEMA,
      repo: { id: "repo_abc" },
      scan: { id: "scan_abc" },
      candidates: [],
      summary: {
        files_indexed: 1,
        facts_count: 2,
        diagnostics_count: 0,
        candidates_count: 0,
        engine_source: "rust"
      },
      onboarding: {
        status: "ready",
        accepted_default: false,
        contract_ready: true,
        baselined_count: 0,
        candidate_count: 0
      },
      state: {
        repo_id: "repo_abc",
        repo_root: "/tmp/repo",
        database_path: "/tmp/drift.sqlite"
      },
      baselined_count: 0,
      machine_contract_versions: { schema_version: "drift.machine_contract_versions.v1" },
      engine: {},
      v1_scope: {},
      next_commands: []
    }).response_schema).toBe(BETA_START_RESPONSE_SCHEMA);
  });

  it("locks start engine_source to beta contract values", () => {
    const payload = {
      response_schema: BETA_START_RESPONSE_SCHEMA,
      repo: { id: "repo_abc" },
      scan: { id: "scan_abc" },
      candidates: [],
      summary: {
        files_indexed: 1,
        facts_count: 2,
        diagnostics_count: 0,
        candidates_count: 0,
        engine_source: "typescript_fallback"
      },
      onboarding: {
        status: "ready",
        accepted_default: false,
        contract_ready: true,
        baselined_count: 0,
        candidate_count: 0
      },
      state: {
        repo_id: "repo_abc",
        repo_root: "/tmp/repo",
        database_path: "/tmp/drift.sqlite"
      },
      baselined_count: 0,
      machine_contract_versions: { schema_version: "drift.machine_contract_versions.v1" },
      engine: {},
      v1_scope: {},
      next_commands: []
    };

    expect(BetaStartResponseSchema.parse(payload).summary.engine_source).toBe("typescript_fallback");
    expect(BetaStartResponseSchema.safeParse({
      ...payload,
      summary: { ...payload.summary, engine_source: "typescript" }
    }).success).toBe(false);
  });

  it("requires response_schema on doctor output", () => {
    const result = BetaDoctorResponseSchema.safeParse({
      status: "ok",
      repo_root: "/tmp/repo",
      database_path: "/tmp/drift.sqlite",
      runtime: {},
      machine_contract_versions: {},
      engine: {},
      v1_scope: {},
      state_summary: {},
      checks: [],
      next_command: null,
      next_commands: []
    });
    expect(result.success).toBe(false);
  });

  it("accepts the required doctor beta contract shape", () => {
    expect(BetaDoctorResponseSchema.parse({
      response_schema: BETA_DOCTOR_RESPONSE_SCHEMA,
      status: "warn",
      repo_root: "/tmp/repo",
      database_path: "/tmp/drift.sqlite",
      runtime: {},
      machine_contract_versions: { schema_version: "drift.machine_contract_versions.v1" },
      engine: {},
      v1_scope: {},
      state_summary: {},
      checks: [],
      next_command: null,
      next_commands: []
    }).response_schema).toBe(BETA_DOCTOR_RESPONSE_SCHEMA);
  });
});
