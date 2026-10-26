import { EventEmitter } from "node:events";
export class AnalysisEvents extends EventEmitter {
  constructor() {
    super();
    // Independent workers and connected editors each own a removable listener.
    this.setMaxListeners(128);
  }
  latest = new Map<string, any>();
  publish(event: any) {
    if (event.finished) this.latest.delete(event.id);
    else this.latest.set(event.id, event);
    this.emit("progress", event);
  }
}
