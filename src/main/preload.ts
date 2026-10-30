import { contextBridge, ipcRenderer } from 'electron';
import type { Activity, HarborAPI, UpdateState } from '../shared/types';
const api: HarborAPI = {
  request: (operation, payload, sessionId) => ipcRenderer.invoke('harbor:request', operation, payload, sessionId),
  closeRepository: sessionId => ipcRenderer.invoke('harbor:close-repository', sessionId),
  pickDirectory: () => ipcRenderer.invoke('harbor:pick-directory'),
  cancel: id => ipcRenderer.invoke('harbor:cancel', id),
  recent: () => ipcRenderer.invoke('harbor:recent'),
  version: () => ipcRenderer.invoke('harbor:version'),
  aiSettings: () => ipcRenderer.invoke('harbor:ai-settings'),
  saveAiSettings: settings => ipcRenderer.invoke('harbor:save-ai-settings', settings),
  updateStatus: () => ipcRenderer.invoke('harbor:update-status'),
  updateAction: action => ipcRenderer.invoke('harbor:update-action', action),
  saveUpdateAutoCheck: enabled => ipcRenderer.invoke('harbor:update-auto-check', enabled),
  onUpdate: listener => { const handler = (_: unknown, state: UpdateState) => listener(state); ipcRenderer.on('harbor:update', handler); return () => ipcRenderer.removeListener('harbor:update', handler); },
  onActivity: listener => { const handler = (_: unknown, event: Activity) => listener(event); ipcRenderer.on('harbor:activity', handler); return () => ipcRenderer.removeListener('harbor:activity', handler); }
};
contextBridge.exposeInMainWorld('harbor', api);
