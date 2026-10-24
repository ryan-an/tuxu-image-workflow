import type { ButtonHTMLAttributes } from "react";
import "./button.css";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm";
  variant?: "primary" | "secondary" | "warning" | "danger" | "ghost";
};

export function Button({
  variant,
  size,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ${className}`}
      data-variant={variant}
      data-size={size}
    />
  );
}
