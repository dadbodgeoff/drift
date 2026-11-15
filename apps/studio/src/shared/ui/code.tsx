// Opening code from anywhere: features call useOpenCode(); the app shell owns the drawer.
import { createContext, useContext } from "react";

export interface CodeTarget {
  path: string;
  line?: number | null;
  /** Why we are looking: shown above the code. */
  context?: { title: string; detail?: string; tone?: "danger" | "warning" | "info" | "accent" };
  markers?: { line: number; tone: "danger" | "warning" | "info" | "accent" | "success"; label: string }[];
}

export const CodeCtx = createContext<(t: CodeTarget) => void>(() => undefined);

export function useOpenCode() {
  return useContext(CodeCtx);
}
