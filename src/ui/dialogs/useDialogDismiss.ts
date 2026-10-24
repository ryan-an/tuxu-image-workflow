import { useRef } from "react";
import type { MouseEvent, PointerEvent, SyntheticEvent } from "react";

function outsideDialog(event: MouseEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget;
  const bounds = dialog.getBoundingClientRect();
  return (
    event.target === dialog &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  );
}

// Both ends of the gesture must be on the backdrop, so selecting text or
// dragging a file from inside the dialog cannot accidentally dismiss it.
export function useDialogDismiss(onClose: () => void, disabled = false) {
  const startedOutside = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) {
      startedOutside.current = event.button === 0 && outsideDialog(event);
    },
    onPointerCancel() {
      startedOutside.current = false;
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismiss = startedOutside.current && outsideDialog(event);
      startedOutside.current = false;
      if (dismiss && !disabled) onClose();
    },
    onCancel(event: SyntheticEvent<HTMLDialogElement>) {
      event.preventDefault();
      if (!disabled) onClose();
    },
  };
}
