import { contextBridge, ipcRenderer } from 'electron';
import type { Activity, HarborAPI } from '../shared/types';
const api: HarborAPI = {
  request: (operation, payload, sessionId) => ipcRenderer.invoke('harbor:request', operation, payload, sessionId),
  closeRepository: sessionId => ipcRenderer.invoke('harbor:close-repository', sessionId),
  pickDirectory: () => ipcRenderer.invoke('harbor:pick-directory'),
  cancel: id => ipcRenderer.invoke('harbor:cancel', id),
  recent: () => ipcRenderer.invoke('harbor:recent'),
  version: () => ipcRenderer.invoke('harbor:version'),
  onActivity: listener => { const handler = (_: unknown, event: Activity) => listener(event); ipcRenderer.on('harbor:activity', handler); return () => ipcRenderer.removeListener('harbor:activity', handler); }
};
contextBridge.exposeInMainWorld('harbor', api);
