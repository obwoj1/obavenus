const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { readdir, realpath } = require('node:fs/promises');
const path = require('node:path');

ipcMain.handle('project:choose', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;

  const projectPath = await realpath(result.filePaths[0]);
  const dirents = await readdir(projectPath, { withFileTypes: true });
  const entries = dirents
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'link or special item',
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1))
    .slice(0, 80);

  return { name: path.basename(projectPath), entries, truncated: dirents.length > entries.length };
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: 'Obavenus',
    backgroundColor: '#101116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
