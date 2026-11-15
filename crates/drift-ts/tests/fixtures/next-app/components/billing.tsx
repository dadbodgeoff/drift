"use client";

import { METHODS } from "@/lib/billing-types";

export function Billing() {
  return <ul>{METHODS.map((m) => <li key={m}>{m}</li>)}</ul>;
}
