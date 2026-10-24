let workspaceId;
let accountId;
export function setSessionWorkspace(id, account) {
  workspaceId = id;
  accountId = account;
}
/** @returns {Record<string, string>} */
export function sessionHeaders() {
  return {
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    ...(accountId ? { "X-Account-Id": accountId } : {}),
  };
}
export function analysisEventsUrl() {
  return workspaceId
    ? `/api/analysis/events?workspace=${encodeURIComponent(workspaceId)}${accountId ? `&account=${encodeURIComponent(accountId)}` : ""}`
    : "/api/analysis/events";
}
