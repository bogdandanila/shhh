import { contextBridge, ipcRenderer } from 'electron';

const ALLOWED_INVOKE = ['history:list', 'history:copy', 'perm:status', 'perm:request', 'stt:status', 'stt:useLocal', 'stt:useCloud', 'llm:status', 'llm:set', 'llm:disable'];
const ALLOWED_ON = ['overlay:state', 'rec:cmd', 'stt:progress'];

contextBridge.exposeInMainWorld('shhh', {
  invoke: (ch: string, ...args: unknown[]) => {
    if (!ALLOWED_INVOKE.includes(ch)) throw new Error(`blocked channel ${ch}`);
    return ipcRenderer.invoke(ch, ...args);
  },
  on: (ch: string, fn: (...args: unknown[]) => void) => {
    if (!ALLOWED_ON.includes(ch)) throw new Error(`blocked channel ${ch}`);
    ipcRenderer.on(ch, (_e, ...args) => fn(...args));
  },
  send: (ch: string, ...args: unknown[]) => {
    if (!ch.startsWith('rec:') && ch !== 'overlay:clicked') throw new Error(`blocked channel ${ch}`);
    ipcRenderer.send(ch, ...args);
  },
});
