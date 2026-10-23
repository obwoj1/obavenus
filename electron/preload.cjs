const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('obavenus', {
  chooseProject: () => ipcRenderer.invoke('project:choose'),
});
