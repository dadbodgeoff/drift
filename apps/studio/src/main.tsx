import "@drift/ui/styles.css";
import "./app/app.css";
import "./app/directions.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ElectronApi, FixtureApi, type StudioApi } from "./shared/api";

// Electron exposes a bridge from the preload; a plain browser (tests, design
// review) gets fixtures produced by the real drift binary.
function pickApi(): StudioApi {
  if (window.driftStudio) return new ElectronApi(window.driftStudio);
  const q = new URLSearchParams(location.search);
  const delay = Number(q.get("delay") ?? 150);
  // `?local=1` or `?repo=/local/<name>` lists the large fixtures from scripts/make-local-fixtures.mjs.
  const local = q.get("local") === "1" || (q.get("repo") ?? "").startsWith("/local/");
  return new FixtureApi("./", Number.isFinite(delay) ? delay : 150, local);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={pickApi()} />
  </StrictMode>,
);
