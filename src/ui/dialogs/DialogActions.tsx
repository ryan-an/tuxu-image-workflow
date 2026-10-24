import type { ReactNode } from "react";
import "./dialog-actions.css";

export function DialogActions({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`dialog-actions ${className}`}>{children}</div>;
}
