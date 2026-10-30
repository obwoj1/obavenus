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
  getSkills: () => ipcRenderer.invoke('skills:list'),
  saveSkill: (skill) => ipcRenderer.invoke('skills:save', skill),
  deleteSkill: (id) => ipcRenderer.invoke('skills:delete', id),
  getCustomAgents: () => ipcRenderer.invoke('agents:list-custom'),
  saveCustomAgent: (agent) => ipcRenderer.invoke('agents:save-custom', agent),
  deleteCustomAgent: (id) => ipcRenderer.invoke('agents:delete-custom', id),
  openResearchPage: (url) => ipcRenderer.invoke('browser:open', url),
  importResearchPage: () => ipcRenderer.invoke('browser:import-page'),
  listScheduledTasks: () => ipcRenderer.invoke('tasks:list'),
  scheduleLocalTask: (task) => ipcRenderer.invoke('tasks:schedule', task),
  cancelScheduledTask: (id) => ipcRenderer.invoke('tasks:cancel', id),
  onScheduledTaskUpdate: (callback) => {
    const listener = (_event, task) => callback(task);
    ipcRenderer.on('tasks:updated', listener);
    return () => ipcRenderer.removeListener('tasks:updated', listener);
  },
  getLocalAgentStatus: () => ipcRenderer.invoke('local-agent:status'),
  runLocalAgent: (provider, messages, writeAccess = false) => ipcRenderer.invoke('local-agent:run', { provider, messages, writeAccess }),
  runTeam: (messages, runId, writeAccess = false, agentId = '', browserAccess = false) => ipcRenderer.invoke('agents:run-team', { messages, runId, writeAccess, agentId, browserAccess }),
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
  findFederalJobs: (text) => ipcRenderer.invoke('jobs:search-plan', text),
  getUSAJobsStatus: () => ipcRenderer.invoke('jobs:usajobs-status'),
  saveUSAJobsCredentials: (credentials) => ipcRenderer.invoke('jobs:usajobs-save', credentials),
  clearUSAJobsCredentials: () => ipcRenderer.invoke('jobs:usajobs-clear'),
  searchUSAJobsLive: (text, filters) => ipcRenderer.invoke('jobs:search-live', { text, filters }),
});
