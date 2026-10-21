import { useId, useState } from "react";
import "./workspace-title.css";

export function WorkspaceTitle({ name }: { name: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const characters = Array.from(name);
  const label =
    characters.length > 28 ? `${characters.slice(0, 28).join("")}…` : name;
  return (
    <div
      className="workspace-title"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          event.stopPropagation();
        }
      }}
    >
      <h1
        tabIndex={0}
        aria-label={name}
        aria-describedby={open ? id : undefined}
      >
        {label}
      </h1>
      <div className="workspace-title-popover" hidden={!open}>
        <div id={id} className="workspace-title-card" role="tooltip">
          <span className="workspace-title-caption">完整产品名称</span>
          <p>{name}</p>
        </div>
      </div>
    </div>
  );
}
