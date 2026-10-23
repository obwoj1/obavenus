const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('orbit', {
  appVersion: () => process.env.npm_package_version ?? '0.1.0',
});
