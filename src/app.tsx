import React from "react";
import { createRoot } from "react-dom/client";
import { Application, ApplicationErrorBoundary } from "./ui/Application.tsx";
import { createApplicationController } from "./application/controller.js";
import "./workflow.css";
const controller = createApplicationController();
const root = createRoot(document.getElementById("root")!);
root.render(
  <ApplicationErrorBoundary>
    <Application controller={controller} />
  </ApplicationErrorBoundary>,
);
void controller.start();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    controller.dispose();
    root.unmount();
  });
