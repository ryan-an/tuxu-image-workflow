import { createElement, type ComponentProps } from "react";
import "./select.css";

export type SelectProps = Omit<
  ComponentProps<"select">,
  "size" | "multiple"
> & {
  size?: "sm" | "md";
};

/** Native values, events and form submission, with a shared control and picker. */
export function Select({
  size = "md",
  className = "",
  children,
  ...props
}: SelectProps) {
  return (
    <select {...props} className={`ui-select ${className}`} data-size={size}>
      <button type="button" tabIndex={-1} className="ui-select-trigger">
        {createElement("selectedcontent", { className: "ui-select-value" })}
      </button>
      {children}
    </select>
  );
}
