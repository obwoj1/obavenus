const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('obavenus', {
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  getLastProject: () => ipcRenderer.invoke('project:last'),
  closeProject: () => ipcRenderer.invoke('project:close'),
  readProjectFile: (fileName) => ipcRenderer.invoke('project:read-file', fileName),
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  clearProfile: () => ipcRenderer.invoke('profile:clear'),
  chooseResume: () => ipcRenderer.invoke('profile:choose-resume'),
  getProviderSettings: () => ipcRenderer.invoke('provider:get-settings'),
  saveProviderSettings: (settings) => ipcRenderer.invoke('provider:save-settings', settings),
  clearProviderKey: (provider) => ipcRenderer.invoke('provider:clear-key', provider),
  sendChat: (messages) => ipcRenderer.invoke('provider:send', messages),
  runTeam: (messages, runId) => ipcRenderer.invoke('agents:run-team', { messages, runId }),
  onAgentProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('agents:progress', listener);
    return () => ipcRenderer.removeListener('agents:progress', listener);
  },
  getChatGPTSession: () => ipcRenderer.invoke('chatgpt:session'),
  signInWithChatGPT: () => ipcRenderer.invoke('chatgpt:sign-in'),
  disconnectChatGPT: () => ipcRenderer.invoke('chatgpt:disconnect'),
  getChatGPTModels: () => ipcRenderer.invoke('chatgpt:models'),
  getGeminiStatus: () => ipcRenderer.invoke('gemini:status'),
  connectGeminiAccount: (credentials) => ipcRenderer.invoke('gemini:connect', credentials),
  disconnectGeminiAccount: () => ipcRenderer.invoke('gemini:disconnect'),
  getGmailStatus: () => ipcRenderer.invoke('gmail:status'),
  connectGmail: (credentials) => ipcRenderer.invoke('gmail:connect', credentials),
  disconnectGmail: () => ipcRenderer.invoke('gmail:disconnect'),
  searchGmail: (query) => ipcRenderer.invoke('gmail:search', query),
});
