// The only bridge between the page and the main process: named channels from
// the contract, a version, and push events. No Node, no ipcRenderer, no
// arbitrary channel names reach the page.
import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL_NAMES, CHANNEL_PREFIX, EVENT_NAMES, IPC_VERSION } from "../src/shared/ipc/names";

const channels = new Set<string>(CHANNEL_NAMES);
const events = new Set<string>(EVENT_NAMES);

contextBridge.exposeInMainWorld("driftStudio", {
  ipc: IPC_VERSION,
  invoke(channel: string, args: unknown[], requestId?: string): Promise<unknown> {
    if (!channels.has(channel)) return Promise.reject(new Error(`unknown channel ${String(channel).slice(0, 40)}`));
    return ipcRenderer.invoke(`${CHANNEL_PREFIX}${channel}`, Array.isArray(args) ? args : [], typeof requestId === "string" ? requestId : undefined);
  },
  on(event: string, cb: (payload: unknown) => void): () => void {
    if (!events.has(event) || typeof cb !== "function") return () => undefined;
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`studio:event:${event}`, listener);
    return () => ipcRenderer.removeListener(`studio:event:${event}`, listener);
  },
});
