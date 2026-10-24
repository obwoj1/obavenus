const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('obavenus', {
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  getLastProject: () => ipcRenderer.invoke('project:last'),
  closeProject: () => ipcRenderer.invoke('project:close'),
  readProjectFile: (fileName) => ipcRenderer.invoke('project:read-file', fileName),
  getProviderSettings: () => ipcRenderer.invoke('provider:get-settings'),
  saveProviderSettings: (settings) => ipcRenderer.invoke('provider:save-settings', settings),
  clearProviderKey: (provider) => ipcRenderer.invoke('provider:clear-key', provider),
  sendChat: (messages) => ipcRenderer.invoke('provider:send', messages),
});
