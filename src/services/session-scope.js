let workspaceId;
let accountId;
let adminMode = false;
export function setSessionWorkspace(id, account, admin = false) {
  workspaceId = id;
  accountId = account;
  adminMode = admin;
}
/** @returns {Record<string, string>} */
export function sessionHeaders() {
  return {
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    ...(accountId ? { "X-Account-Id": accountId } : {}),
    ...(adminMode ? { "X-Admin-Mode": "1" } : {}),
  };
}
export function analysisEventsUrl() {
  return workspaceId
    ? `/api/analysis/events?workspace=${encodeURIComponent(workspaceId)}${accountId ? `&account=${encodeURIComponent(accountId)}` : ""}${adminMode ? "&admin=1" : ""}`
    : "/api/analysis/events";
}

// Native images and noreferrer links cannot send the API workspace headers.
// This changes presentation URLs only; stored asset identifiers stay unchanged.
export function presentationAssetUrl(source) {
  if (
    !adminMode ||
    !workspaceId ||
    !accountId ||
    typeof source !== "string" ||
    typeof window === "undefined"
  )
    return source;
  try {
    const url = new URL(source, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      url.username ||
      url.password ||
      !/^\/api\/assets\/[a-f0-9]{64}(?:\/thumbnail)?$/.test(url.pathname)
    )
      return source;
    url.searchParams.set("workspace", workspaceId);
    url.searchParams.set("admin", "1");
    url.searchParams.set("account", accountId);
    return source.startsWith("/") && !source.startsWith("//")
      ? url.pathname + url.search + url.hash
      : url.href;
  } catch {
    return source;
  }
}
