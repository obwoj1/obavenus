const form = document.querySelector('#prompt-form');
const promptInput = form.querySelector('textarea');
const conversation = document.querySelector('#conversation');
const workspace = document.querySelector('#workspace-label');
const contextCard = document.querySelector('#context-card');
let selectedProject = null;
const CONVERSATIONS_KEY = 'obavenus.conversations.v1';
const LOCAL_PLACEHOLDER = 'This is the local UI prototype. Connect an AI provider in a later build step to get an assistant response.';
let conversations = loadConversations();
let activeConversationId = conversations.at(-1)?.id ?? null;
let sending = false;

const providerDialog = document.querySelector('#provider-dialog');
const providerForm = document.querySelector('#provider-form');
const providerModelInput = document.querySelector('#provider-model');
const providerKeyInput = document.querySelector('#provider-key');
const providerKeyState = document.querySelector('#provider-key-state');
const providerFormStatus = document.querySelector('#provider-form-status');
const removeProviderKeyButton = document.querySelector('#remove-provider-key');

function loadConversations() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((conversation) =>
      typeof conversation.id === 'string'
      && typeof conversation.title === 'string'
      && Array.isArray(conversation.messages),
    ).map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      messages: conversation.messages.filter((message) =>
        (message.role === 'user' || message.role === 'assistant')
        && typeof message.text === 'string'
        && message.status !== 'pending',
      ).map((message) => ({
        role: message.role,
        text: message.text,
        localOnly: message.localOnly === true || message.text === LOCAL_PLACEHOLDER,
        status: message.status === 'error' ? 'error' : 'complete',
      })),
    }));
  } catch {
    return [];
  }
}

function saveConversations() {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations.slice(-50)));
  } catch {
    // Keep the current conversation usable when local storage is unavailable.
  }
}

function renderEmptyWorkspace() {
  workspace.replaceChildren('No project open');
  const detail = document.createElement('small');
  detail.textContent = 'Choose a folder to add project context';
  const openButton = document.createElement('button');
  openButton.id = 'open-project';
  openButton.type = 'button';
  openButton.textContent = 'Open project folder';
  openButton.addEventListener('click', chooseProject);
  workspace.append(detail, openButton);

  contextCard.replaceChildren();
  const contextTitle = document.createElement('strong');
  contextTitle.textContent = 'Nothing connected yet';
  contextCard.append(contextTitle, 'Choose a project folder to see its top-level file names. Obavenus does not read their contents yet.');
}

function renderProject(project) {
  selectedProject = project;
  workspace.replaceChildren();
  const title = document.createElement('span');
  title.textContent = project.name;
  const detail = document.createElement('small');
  detail.textContent = 'Selected project folder · saved on this Mac';
  const changeButton = document.createElement('button');
  changeButton.type = 'button';
  changeButton.textContent = 'Change folder';
  changeButton.addEventListener('click', chooseProject);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close-workspace';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', closeProject);
  workspace.append(title, detail, changeButton, closeButton);

  contextCard.replaceChildren();
  const contextTitle = document.createElement('strong');
  contextTitle.textContent = project.name;
  const fileList = document.createElement('ul');
  fileList.className = 'file-list';
  project.entries.forEach((entry) => {
    const item = document.createElement('li');
    if (entry.kind === 'file') {
      const openFile = document.createElement('button');
      openFile.type = 'button';
      openFile.textContent = `· ${entry.name}`;
      openFile.addEventListener('click', () => openProjectFile(entry.name));
      item.append(openFile);
    } else {
      item.textContent = `${entry.kind === 'folder' ? '▸' : '·'} ${entry.name}`;
    }
    fileList.append(item);
  });
  const note = document.createElement('small');
  note.textContent = project.truncated
    ? 'Showing the first 80 entries. File contents are not read.'
    : `${project.entries.length} top-level entries · contents are not read`;
  contextCard.append(contextTitle, fileList, note);
}

async function openProjectFile(fileName) {
  contextCard.replaceChildren();
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'context-action';
  backButton.textContent = '← Back to files';
  backButton.addEventListener('click', () => renderProject(selectedProject));
  contextCard.append(backButton);

  let result;
  try {
    result = await window.obavenus.readProjectFile(fileName);
  } catch (error) {
    const message = document.createElement('small');
    message.textContent = error.message || 'This file could not be opened.';
    contextCard.append(message);
    return;
  }

  const heading = document.createElement('strong');
  heading.textContent = fileName;
  const preview = document.createElement('pre');
  preview.className = 'file-preview';
  preview.textContent = result.content;
  const note = document.createElement('small');
  note.textContent = `${result.size.toLocaleString()} bytes · opened on request · not sent anywhere`;
  contextCard.append(heading, preview, note);
}

async function chooseProject() {
  const project = await window.obavenus.chooseProject();
  if (project) renderProject(project);
}

async function closeProject() {
  await window.obavenus.closeProject();
  selectedProject = null;
  renderEmptyWorkspace();
}

function addMessage(text, kind) {
  const message = document.createElement('div');
  message.className = `message ${kind}`;
  message.textContent = text;
  form.insertAdjacentElement('beforebegin', message);
  return message;
}

function getActiveConversation() {
  return conversations.find((item) => item.id === activeConversationId);
}

function renderMessages() {
  conversation.querySelectorAll('.message').forEach((message) => message.remove());
  const current = getActiveConversation();
  const title = document.querySelector('#welcome-title');
  title.textContent = current?.messages.length ? current.title : 'What are we working on?';
  current?.messages.forEach((message) => {
    const rendered = addMessage(message.text, message.role === 'user' ? 'user-message' : 'assistant-message');
    if (message.status === 'pending') rendered.classList.add('pending');
  });
  renderRecentWork();
}

function renderRecentWork() {
  const list = document.querySelector('#recent-work');
  list.replaceChildren();
  [...conversations].reverse().slice(0, 20).forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `recent-item${item.id === activeConversationId ? ' active' : ''}`;
    button.textContent = item.title;
    button.title = item.title;
    button.addEventListener('click', () => {
      activeConversationId = item.id;
      renderMessages();
    });
    list.append(button);
  });
}

function startConversation() {
  const item = {
    id: crypto.randomUUID(),
    title: 'New conversation',
    createdAt: new Date().toISOString(),
    messages: [],
  };
  conversations.push(item);
  activeConversationId = item.id;
  saveConversations();
  renderMessages();
  promptInput.focus();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || sending) return;

  let current = getActiveConversation();
  if (!current) {
    current = {
      id: crypto.randomUUID(),
      title: 'New conversation',
      createdAt: new Date().toISOString(),
      messages: [],
    };
    conversations.push(current);
    activeConversationId = current.id;
  }
  if (current.messages.length === 0) current.title = prompt.slice(0, 48);
  current.messages.push({ role: 'user', text: prompt, status: 'complete' });
  const pendingReply = {
    role: 'assistant',
    text: 'Thinking…',
    status: 'pending',
  };
  current.messages.push(pendingReply);
  sending = true;
  promptInput.disabled = true;
  form.querySelector('.send').disabled = true;
  form.querySelector('.send').textContent = 'Sending…';
  saveConversations();
  renderMessages();
  promptInput.value = '';

  try {
    const settings = await window.obavenus.getProviderSettings();
    if (!settings.configured) {
      pendingReply.text = 'Connect an OpenAI API key in Settings to get a model response. Your prompt is saved locally and was not sent.';
      pendingReply.localOnly = true;
      pendingReply.status = 'error';
    } else {
      const messages = current.messages
        .filter((message) => !message.localOnly && message.status !== 'pending')
        .map(({ role, text }) => ({ role, text }));
      pendingReply.text = await window.obavenus.sendChat(messages);
      pendingReply.status = 'complete';
    }
  } catch (error) {
    pendingReply.text = `Request failed: ${error.message || 'Unknown error.'}`;
    pendingReply.localOnly = true;
    pendingReply.status = 'error';
  } finally {
    sending = false;
    promptInput.disabled = false;
    form.querySelector('.send').disabled = false;
    form.querySelector('.send').textContent = 'Send ↗';
    saveConversations();
    renderRecentWork();
    if (activeConversationId === current.id) renderMessages();
  }
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll('.suggestions button').forEach((button) => {
  button.addEventListener('click', () => {
    promptInput.value = button.textContent;
    promptInput.focus();
  });
});

document.querySelector('#open-project').addEventListener('click', chooseProject);
document.querySelector('#projects-nav').addEventListener('click', chooseProject);
document.querySelector('#new-chat').addEventListener('click', startConversation);

async function updateProviderBadge() {
  const badge = document.querySelector('#provider-settings');
  try {
    const settings = await window.obavenus.getProviderSettings();
    badge.textContent = settings.configured
      ? `${settings.model} connected · Settings`
      : `${settings.model} not connected · Settings`;
    return settings;
  } catch {
    badge.textContent = 'Provider settings unavailable';
    return { model: 'gpt-5.5', configured: false };
  }
}

document.querySelector('#provider-settings').addEventListener('click', async () => {
  providerFormStatus.textContent = '';
  providerKeyInput.value = '';
  try {
    const settings = await window.obavenus.getProviderSettings();
    providerModelInput.value = settings.model;
    providerKeyState.textContent = settings.configured
      ? 'A key is saved in encrypted device storage. Enter a new key to replace it.'
      : 'No key saved. Your key will be encrypted with macOS Keychain-backed storage.';
    removeProviderKeyButton.hidden = !settings.configured;
  } catch (error) {
    providerFormStatus.textContent = error.message || 'Could not load settings.';
  }
  providerDialog.showModal();
});

document.querySelector('#cancel-provider-settings').addEventListener('click', () => providerDialog.close());

providerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  providerFormStatus.textContent = 'Saving settings…';
  try {
    const settings = await window.obavenus.saveProviderSettings({
      model: providerModelInput.value,
      apiKey: providerKeyInput.value,
    });
    providerKeyInput.value = '';
    providerKeyState.textContent = settings.configured ? 'Key saved in encrypted device storage.' : 'No key saved.';
    removeProviderKeyButton.hidden = !settings.configured;
    providerFormStatus.textContent = 'Settings saved.';
    await updateProviderBadge();
  } catch (error) {
    providerFormStatus.textContent = error.message || 'Could not save settings.';
  }
});

removeProviderKeyButton.addEventListener('click', async () => {
  providerFormStatus.textContent = 'Removing saved key…';
  try {
    const settings = await window.obavenus.clearProviderKey();
    providerKeyInput.value = '';
    providerKeyState.textContent = 'No key saved.';
    removeProviderKeyButton.hidden = true;
    providerFormStatus.textContent = 'Saved key removed.';
    await updateProviderBadge();
  } catch (error) {
    providerFormStatus.textContent = error.message || 'Could not remove the saved key.';
  }
});

renderMessages();
updateProviderBadge();

window.obavenus.getLastProject().then((project) => {
  if (project) renderProject(project);
});
