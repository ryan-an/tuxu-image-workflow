export const DEFAULT_PROMPT_CONCURRENCY = 15;
export const DEFAULT_QUERY_CONCURRENCY = 8;
export const CONCURRENCY_FIELDS = [
  "concurrency",
  "promptConcurrency",
  "queryConcurrency",
];
// Retained only for old clients and portable backups. These fields no longer
// control execution; no historical UI maximum is enforced.
export function validConcurrency(state) {
  return CONCURRENCY_FIELDS.every(
    (field) =>
      state[field] == null ||
      (Number.isSafeInteger(state[field]) && state[field] >= 1),
  );
}
