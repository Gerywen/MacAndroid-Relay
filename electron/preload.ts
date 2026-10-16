import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi, TransferUpdate } from '../shared/contracts';
const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`macandroid-relay:${name}`, ...args);
const api: DesktopApi = {
  onCommand: (callback) => {
    const listener = (
      _event: unknown,
      command: Parameters<Parameters<DesktopApi['onCommand']>[0]>[0],
    ) => callback(command);
    ipcRenderer.on('macandroid-relay:command', listener);
    return () => ipcRenderer.removeListener('macandroid-relay:command', listener);
  },
  bootstrap: () => invoke('bootstrap'),
  preferences: (patch) => invoke('preferences', patch),
  navigate: (request) => invoke('navigate', request),
  mutate: (request) => invoke('mutate', request),
  connect: () => invoke('connect'),
  disconnect: () => invoke('disconnect'),
  cancelTransfer: () => invoke('cancel-transfer'),
  transfer: (request) => invoke('transfer', request),
  chooseFolder: () => invoke('choose-folder'),
  openFile: (file) => invoke('open-file', file),
  copyText: (text) => invoke('copy-text', text),
  openHelp: () => invoke('help'),
  diagnostics: () => invoke('diagnostics'),
  filePaths: (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  onTransfer: (callback) => {
    const listener = (_event: unknown, update: TransferUpdate) => callback(update);
    ipcRenderer.on('macandroid-relay:transfer-update', listener);
    return () => ipcRenderer.removeListener('macandroid-relay:transfer-update', listener);
  },
  onDeviceChanged: (callback) => {
    const listener = (_event: unknown, reason: 'change' | 'unavailable' = 'change') =>
      callback(reason);
    ipcRenderer.on('macandroid-relay:device-changed', listener);
    return () => ipcRenderer.removeListener('macandroid-relay:device-changed', listener);
  },
};
contextBridge.exposeInMainWorld('desktop', api);
