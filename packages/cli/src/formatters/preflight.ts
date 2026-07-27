import type { FindingStatus } from "@drift/core";
import type { ParserGapQuality } from "@drift/query";
import { preflightGovernance } from "../domain/governance.js";
import { PreparedConvention,RelevantFile,preflightSummary } from "../domain/preflight.js";

export function formatPrepareText(payload: {
  task: string;
  summary: ReturnType<typeof preflightSummary>;
  governance: ReturnType<typeof preflightGovernance>;
  parser_gap_quality?: ParserGapQuality;
  conventions: PreparedConvention[];
  relevant_files: RelevantFile[];
  next_commands: string[];
}): string {
  const parserGapLines = payload.parser_gap_quality && payload.parser_gap_quality.total_count > 0
    ? [
        "",
        `Parser gaps: ${payload.parser_gap_quality.blocking_count} blocking, ${payload.parser_gap_quality.advisory_count} advisory. Action: ${payload.parser_gap_quality.user_action}`
      ]
    : [];
  return [
    "Drift prepare",
    "",
    `Task: ${payload.task}`,
    `Summary: ${payload.summary.convention_count} convention${payload.summary.convention_count === 1 ? "" : "s"}, ${payload.summary.relevant_file_count} relevant file${payload.summary.relevant_file_count === 1 ? "" : "s"}, ${payload.summary.finding_count} open finding${payload.summary.finding_count === 1 ? "" : "s"}, ${payload.summary.required_check_count} required check${payload.summary.required_check_count === 1 ? "" : "s"}`,
    `Governance: ${payload.governance.read_only ? "read-only" : "mutable"}; human approval required for mutations`,
    ...parserGapLines,
    "",
    "Conventions:",
    ...payload.conventions.map((convention) => `  ${convention.id}: ${convention.statement}`),
    "",
    "Relevant files:",
    ...payload.relevant_files.map((file) => `  ${file.path}`),
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}

export function formatAskText(payload: {
  topic: string;
  answer: { source: string; summary: string };
  governance: ReturnType<typeof preflightGovernance>;
  conventions: PreparedConvention[];
  findings: Array<{ id: string; title: string; status: FindingStatus }>;
  relevant_files: RelevantFile[];
  next_commands: string[];
}): string {
  return [
    "Drift answer",
    "",
    `Topic: ${payload.topic}`,
    `Source: ${payload.answer.source}`,
    payload.answer.summary,
    `Governance: ${payload.governance.read_only ? "read-only" : "mutable"}; human approval required for mutations`,
    "",
    "Conventions:",
    ...(payload.conventions.length > 0
      ? payload.conventions.map((convention) => `  ${convention.id}: ${convention.statement}`)
      : ["  none"]),
    "",
    "Open findings:",
    ...(payload.findings.length > 0
      ? payload.findings.map((finding) => `  ${finding.id} ${finding.status} - ${finding.title}`)
      : ["  none"]),
    "",
    "Relevant files:",
    ...(payload.relevant_files.length > 0
      ? payload.relevant_files.map((file) => `  ${file.path}`)
      : ["  none"]),
    "",
    "Next commands:",
    ...payload.next_commands.map((command) => `  ${command}`),
    ""
  ].join("\n");
}
