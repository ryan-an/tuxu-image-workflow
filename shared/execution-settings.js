export const DEFAULT_PROMPT_CONCURRENCY = 15;
export const DEFAULT_QUERY_CONCURRENCY = 8;
export const CONCURRENCY_FIELDS = [
  "concurrency",
  "promptConcurrency",
  "queryConcurrency",
];
export function executionConcurrency(state) {
  return {
    prompt: state.promptConcurrency ?? DEFAULT_PROMPT_CONCURRENCY,
    submit: state.concurrency ?? 2,
    query: state.queryConcurrency ?? DEFAULT_QUERY_CONCURRENCY,
  };
}
export function validConcurrency(state) {
  const values = executionConcurrency(state);
  return [
    [values.prompt, 30],
    [values.submit, 6],
    [values.query, 16],
  ].every(
    ([value, maximum]) =>
      Number.isInteger(value) && value >= 1 && value <= maximum,
  );
}
