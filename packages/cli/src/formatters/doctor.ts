export function doctorSymbol(status: "ok" | "warn" | "fail"): string {
  if (status === "ok") {
    return "OK";
  }
  if (status === "warn") {
    return "WARN";
  }
  return "FAIL";
}
