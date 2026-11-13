import { useLayoutEffect, useRef } from "react";
import {
  readRequirementPosition,
  writeRequirementPosition,
} from "../../integrations/requirement-drafts.js";

export function useRequirementPosition(key: string, templateChoice: string) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const ready = useRef(false);

  function rememberPosition(choice = templateChoice) {
    const element = editor.current;
    if (!ready.current || !element) return;
    writeRequirementPosition(key, choice, {
      start: element.selectionStart,
      end: element.selectionEnd,
      direction: element.selectionDirection,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
    });
  }

  useLayoutEffect(() => {
    ready.current = false;
    const element = editor.current;
    const position = readRequirementPosition(key, templateChoice);
    // DialogHost opens and focuses the dialog after mounting. Restore once its
    // textarea has a visible size, ignoring the initial focus/scroll events.
    const frame = requestAnimationFrame(() => {
      if (!element) return;
      const length = element.value.length;
      element.setSelectionRange(
        Math.min(position?.start ?? 0, length),
        Math.min(position?.end ?? 0, length),
        position?.direction ?? "none",
      );
      element.scrollTop = position?.scrollTop ?? 0;
      element.scrollLeft = position?.scrollLeft ?? 0;
      ready.current = true;
    });
    const onPageHide = () => rememberPosition();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      ready.current = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [key, templateChoice]);

  return { editor, rememberPosition };
}
