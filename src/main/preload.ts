import { contextBridge, ipcRenderer } from 'electron';
import type { Activity, HarborAPI, TerminalEvent, UpdateState } from '../shared/types';
const api: HarborAPI = {
  platform: process.platform,
  appearance: () => ipcRenderer.invoke('harbor:appearance'),
  setTheme: theme => ipcRenderer.invoke('harbor:set-theme', theme),
  request: (operation, payload, sessionId) => ipcRenderer.invoke('harbor:request', operation, payload, sessionId),
  closeRepository: sessionId => ipcRenderer.invoke('harbor:close-repository', sessionId),
  terminalOpen: (sessionId, cols, rows) => ipcRenderer.invoke('harbor:terminal-open', sessionId, cols, rows),
  terminalStop: (sessionId, id) => ipcRenderer.invoke('harbor:terminal-stop', sessionId, id),
  terminalInput: (sessionId, id, data) => ipcRenderer.send('harbor:terminal-input', sessionId, id, data),
  terminalResize: (sessionId, id, cols, rows) => ipcRenderer.send('harbor:terminal-resize', sessionId, id, cols, rows),
  terminalAck: (sessionId, id, sequence) => ipcRenderer.send('harbor:terminal-ack', sessionId, id, sequence),
  terminalClipboard: (sessionId, id, action, text) => ipcRenderer.invoke('harbor:terminal-clipboard', sessionId, id, action, text),
  onTerminal: listener => { const handler = (_: unknown, event: TerminalEvent) => listener(event); ipcRenderer.on('harbor:terminal-event', handler); return () => ipcRenderer.removeListener('harbor:terminal-event', handler); },
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
