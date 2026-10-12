import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "@/app/workbench.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found");
}

// Dev-only: `?agentReplay=<id>` plays a scripted eval replay into the Agent
// (src/agent/replay/arm.ts), set before the Agent reads its settings. The
// condition is false in a production build, which drops the import.
const ready = import.meta.env.DEV
  ? import("@/agent/replay/arm").then((m) => {
      m.armReplay({ search: location.search, storage: localStorage, setCookie: (c) => (document.cookie = c) });
    }, () => undefined)
  : Promise.resolve();

void ready.then(() =>
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);

// Dev-only: expose the WebGPU validation harness on window.__gpuValidate for the
// structure-factor precision campaign. Tree-shaken out of production builds.
if (import.meta.env.DEV) {
  void import("@/workers/gpuValidationHarness").then((m) => m.installGpuValidationHarness());
}
