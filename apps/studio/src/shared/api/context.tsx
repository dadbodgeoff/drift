import { type ReactNode, createContext, useContext } from "react";
import type { StudioApi } from "./types";

const Ctx = createContext<StudioApi | null>(null);

export function ApiProvider({ api, children }: { api: StudioApi; children: ReactNode }) {
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApi(): StudioApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApi needs an <ApiProvider>");
  return v;
}
