import { api } from "./workspace-client.js";
import { analysisEventsUrl } from "./session-scope.js";
import { uid } from "../../shared/model.js";

export class WorkspaceCollaborationClient {
  constructor(repository, bridge, onPeers) {
    Object.assign(this, { repository, bridge, onPeers });
    this.session = uid();
  }
  start() {
    if (typeof EventSource === "undefined") return;
    this.closed = false;
    const url = analysisEventsUrl().replace(
      "/api/analysis/events",
      "/api/workspace/events",
    );
    this.events = new EventSource(
      `${url}${url.includes("?") ? "&" : "?"}session=${this.session}`,
    );
    this.events.onopen = () => {
      if (this.selection) this.send();
    };
    this.events.onmessage = (message) => {
      if (this.closed) return;
      const event = JSON.parse(message.data);
      if (event.type === "changed")
        void this.repository.refresh().catch(() => {});
      if (event.type === "presence") {
        const peers = event.peers.filter(
          (peer) => peer.session !== this.session,
        );
        this.bridge.showCollaborators(peers);
        this.onPeers(peers);
      }
    };
    this.bridge.onSelection = (selection) => this.select(selection);
    this.visibility = () => {
      if (document.hidden) {
        this.select(null);
      } else this.bridge.publishSelection();
    };
    document.addEventListener("visibilitychange", this.visibility);
    this.heartbeat = setInterval(() => {
      if (this.selection && !document.hidden) void this.send();
    }, 10000);
  }
  select(selection) {
    this.selection = selection;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.send(), selection ? 60 : 0);
  }
  send() {
    if (this.closed) return;
    // Chain updates so delayed HTTP responses cannot move the cursor backwards.
    const selection = this.selection;
    this.chain = (this.chain || Promise.resolve())
      .catch(() => {})
      .then(() =>
        api("/api/workspace/presence", { session: this.session, selection }),
      )
      .catch(() => {});
    return this.chain;
  }
  stop() {
    this.select(null);
    clearTimeout(this.timer);
    void this.send();
    this.closed = true;
    this.events?.close();
    clearInterval(this.heartbeat);
    document.removeEventListener("visibilitychange", this.visibility);
    this.bridge.onSelection = null;
    this.bridge.showCollaborators([]);
  }
}
