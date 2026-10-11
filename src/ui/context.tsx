import type { ApplicationContextValue } from "./types";
import type { ButtonHTMLAttributes, FormHTMLAttributes } from "react";
import { createContext, useContext, useRef, useState } from "react";

export const ApplicationContext = createContext<ApplicationContextValue | null>(
  null,
);
export function useApplication() {
  const application = useContext(ApplicationContext);
  if (!application) throw new Error("组件必须放在 ApplicationContext 中");
  return application;
}

// Components send semantic commands; they do not own persistence or queue logic.
export function ActionButton({
  action,
  data = {},
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  action: string;
  data?: Record<string, string | number | undefined>;
}) {
  const { controller } = useApplication();
  const attributes = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [`data-${key}`, value]),
  );
  return (
    <button
      type="button"
      {...props}
      {...attributes}
      data-action={action}
      onClick={() => controller.dispatch(action, data)}
    >
      {children}
    </button>
  );
}

export function ApplicationForm({
  children,
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  const { controller } = useApplication();
  const submitting = useRef(false),
    [pending, setPending] = useState(false);
  return (
    <form
      {...props}
      aria-busy={pending}
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setPending(true);
        try {
          await controller.submit(event);
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}
    >
      {children}
    </form>
  );
}
