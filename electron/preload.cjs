const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('obavenus', {
  appVersion: () => process.env.npm_package_version ?? '0.1.0',
  chooseProject: () => ipcRenderer.invoke('project:choose'),
});
