import React from "react";
import { createRoot } from "react-dom/client";
import { ApplicationErrorBoundary } from "./ui/Application.tsx";
import { AuthRouter } from "./ui/auth/AuthRouter";
import "./workflow.css";
import "./ui/design-system/tokens.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <ApplicationErrorBoundary>
    <AuthRouter />
  </ApplicationErrorBoundary>,
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
  });
