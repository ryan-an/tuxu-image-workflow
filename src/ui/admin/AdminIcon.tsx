import type { ReactNode } from "react";

export type AdminIconName =
  | "users"
  | "workspaces"
  | "audit"
  | "plus"
  | "edit"
  | "key"
  | "logout"
  | "block"
  | "check"
  | "trash";
export function AdminIcon({ name }: { name: AdminIconName }) {
  const paths: Record<AdminIconName, ReactNode> = {
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a5 5 0 0 1 10 0v3M16 5a3 3 0 0 1 0 6M17 15a4 4 0 0 1 4 4v2" />
      </>
    ),
    workspaces: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    audit: (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M8 11h8M8 16h5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    edit: (
      <>
        <path d="m16 3 5 5-12 12H4v-5L16 3ZM13 6l5 5" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="8" r="5" />
        <path d="m12 12 9 9M17 17l3-3M14 14l3-3" />
      </>
    ),
    logout: (
      <>
        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M10 12h11m-4-4 4 4-4 4" />
      </>
    ),
    block: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m6 6 12 12" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
      </>
    ),
  };
  return (
    <svg
      className="admin-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
