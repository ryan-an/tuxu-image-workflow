import type { HTMLAttributes, ReactNode } from "react";
import "./badge.css";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "info"
  | "success"
  | "warning"
  | "danger";

export function Badge({
  tone = "neutral",
  size = "sm",
  icon,
  unavailable = false,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  size?: "sm" | "md";
  icon?: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <span
      {...props}
      className={`ui-badge ${className}`}
      data-badge-tone={tone}
      data-badge-size={size}
      data-unavailable={unavailable || undefined}
    >
      {icon}
      {children}
    </span>
  );
}
