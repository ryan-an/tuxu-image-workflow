import { StatusSpinner } from "./StatusSpinner.tsx";
import { Badge, type BadgeTone } from "./design-system/Badge";

const statusTones: Record<string, BadgeTone> = {
  waiting: "neutral",
  queued: "neutral",
  cancelled: "neutral",
  ready: "info",
  partial: "warning",
  interrupted: "warning",
  working: "brand",
  running: "brand",
  error: "danger",
  failed: "danger",
  done: "success",
  completed: "success",
};

export function ProductStatusBadge({
  label,
  tone,
  className = "",
  title,
}: {
  label: string;
  tone: string;
  className?: string;
  title?: string;
}) {
  return (
    <Badge
      className={`status-badge ${tone} ${className}`}
      title={title}
      tone={statusTones[tone] || "neutral"}
      icon={
        tone === "working" || tone === "running" ? <StatusSpinner /> : undefined
      }
    >
      {label}
    </Badge>
  );
}
