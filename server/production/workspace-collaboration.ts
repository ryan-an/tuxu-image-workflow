import { EventEmitter } from "node:events";
import type { CurrentUser } from "../../shared/access.js";
export interface SheetPresence {
  session: string;
  actor: { id: string; username: string; displayName: string };
  sheetId: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  updatedAt: number;
}
export class WorkspaceCollaboration extends EventEmitter {
  peers = new Map<string, SheetPresence>();
  connections = new Map<string, object>();
  update(
    session: string,
    actor: CurrentUser,
    selection: Omit<SheetPresence, "session" | "actor" | "updatedAt"> | null,
  ) {
    const existing = this.peers.get(session);
    if (existing && existing.actor.id !== actor.id) return;
    if (selection)
      this.peers.set(session, {
        ...selection,
        session,
        actor: {
          id: actor.id,
          username: actor.username,
          displayName: actor.displayName,
        },
        updatedAt: Date.now(),
      });
    else this.peers.delete(session);
    this.emit("event", { type: "presence", peers: this.snapshot() });
  }
  snapshot() {
    for (const [id, peer] of this.peers)
      if (peer.updatedAt < Date.now() - 30000) this.peers.delete(id);
    return [...this.peers.values()];
  }
  changed() {
    this.emit("event", { type: "changed" });
  }
}
