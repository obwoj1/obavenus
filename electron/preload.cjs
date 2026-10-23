const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('obavenus', {
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  getLastProject: () => ipcRenderer.invoke('project:last'),
  closeProject: () => ipcRenderer.invoke('project:close'),
});
