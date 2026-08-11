import type { DataOperationRisk } from "@drift/core";

export interface ClassifyDataOperationRiskInput {
  receiver_name?: string;
  operation_name: string;
}

export function classifyDataOperationRisk(input: ClassifyDataOperationRiskInput): DataOperationRisk {
  const receiver = input.receiver_name?.toLowerCase() ?? "";
  const operation = input.operation_name.toLowerCase();

  if (receiver === "process.env" || receiver.startsWith("process.env.")) {
    return risk("env_secret_read", "secret_access", "secret_access", "high");
  }

  if (receiver.includes("stripe") || receiver.includes("payment")) {
    return risk("payment_operation", mutationEffect(operation), "external_effect", "high");
  }

  if (receiver.includes("email") || receiver.includes("mailer")) {
    return risk("email_send", "external_effect", "external_effect", "high");
  }

  if (receiver.includes("queue") || receiver.includes("publisher")) {
    return risk("queue_publish", "side_effect", "side_effect", "medium");
  }

  if (receiver.includes("cache")) {
    return risk("cache_operation", mutationEffect(operation), operationRisk(operation), "medium");
  }

  if (receiver.includes("fetch") || receiver.includes("http") || receiver.includes("api")) {
    return risk("http_api_call", "network_effect", "external_effect", "medium");
  }

  if (receiver.includes("prisma") || receiver.includes("db") || receiver.includes("database")) {
    const effect = ormEffect(operation);
    return risk("orm_operation", effect, operationRisk(operation), "high");
  }

  return risk("external_service_call", mutationEffect(operation), "unknown", "heuristic");
}

function ormEffect(operation: string): DataOperationRisk["effect"] {
  if (operation.startsWith("find") || operation === "get" || operation === "select" || operation === "query") {
    return "read";
  }
  if (operation.startsWith("delete") || operation === "remove" || operation === "destroy") {
    return "delete";
  }
  if (operation.startsWith("create") || operation.startsWith("update") || operation === "upsert") {
    return "write";
  }
  return "mutation";
}

function mutationEffect(operation: string): DataOperationRisk["effect"] {
  if (operation.startsWith("delete") || operation === "remove" || operation === "destroy") {
    return "delete";
  }
  if (operation.startsWith("get") || operation.startsWith("find") || operation === "read") {
    return "read";
  }
  return "side_effect";
}

function operationRisk(operation: string): DataOperationRisk["risk"] {
  if (operation.startsWith("delete") || operation === "remove" || operation === "destroy") {
    return "destructive_write";
  }
  if (operation.startsWith("find") || operation === "get" || operation === "select" || operation === "query") {
    return "read";
  }
  if (operation.startsWith("create") || operation.startsWith("update") || operation === "upsert") {
    return "write";
  }
  return "unknown";
}

function risk(
  operationFamily: DataOperationRisk["operation_family"],
  effect: DataOperationRisk["effect"],
  riskKind: DataOperationRisk["risk"],
  confidenceLabel: DataOperationRisk["confidence_label"]
): DataOperationRisk {
  return {
    schema_version: "drift.data_operation_risk.v1",
    operation_family: operationFamily,
    effect,
    risk: riskKind,
    confidence_label: confidenceLabel
  };
}
