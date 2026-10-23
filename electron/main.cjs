const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { readFile, writeFile, mkdir, unlink } = require('node:fs/promises');
const path = require('node:path');
const { describeProject } = require('./project.cjs');

const workspaceFile = () => path.join(app.getPath('userData'), 'workspace.json');

async function saveWorkspace(projectPath) {
  const file = workspaceFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ projectPath }), { mode: 0o600 });
}

ipcMain.handle('project:choose', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;

  const project = await describeProject(result.filePaths[0]);
  await saveWorkspace(project.path);
  return project.summary;
});

ipcMain.handle('project:last', async () => {
  try {
    const saved = JSON.parse(await readFile(workspaceFile(), 'utf8'));
    const project = await describeProject(saved.projectPath);
    return project.summary;
  } catch (error) {
    if (error.code !== 'ENOENT') await unlink(workspaceFile()).catch(() => {});
    return null;
  }
});

ipcMain.handle('project:close', async () => {
  await unlink(workspaceFile()).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return true;
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
