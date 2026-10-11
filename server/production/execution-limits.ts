export const stageTimeout = (kind: string) =>
  kind === "prompt-set" ? 600000 : 180000;
// Keep claims valid until after the external call's total timeout.
export const leaseDuration = (kind: string) => stageTimeout(kind) + 60000;
