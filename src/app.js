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
let pendingContext = [];

const providerDialog = document.querySelector('#provider-dialog');
const providerForm = document.querySelector('#provider-form');
const providerModelInput = document.querySelector('#provider-model');
const providerSelect = document.querySelector('#provider-choice');
const providerKeyInput = document.querySelector('#provider-key');
const providerKeyState = document.querySelector('#provider-key-state');
const providerFormStatus = document.querySelector('#provider-form-status');
const removeProviderKeyButton = document.querySelector('#remove-provider-key');
const authMethodSelect = document.querySelector('#openai-auth-method');
const geminiAuthSelect = document.querySelector('#gemini-auth-method');
const chatgptConnection = document.querySelector('#chatgpt-connection');
const geminiConnection = document.querySelector('#gemini-connection');
const chatgptState = document.querySelector('#chatgpt-session-state');
const chatgptSignInButton = document.querySelector('#chatgpt-sign-in');
const chatgptDisconnectButton = document.querySelector('#chatgpt-disconnect');
const geminiState = document.querySelector('#gemini-session-state');
const geminiSignInButton = document.querySelector('#gemini-sign-in');
const geminiDisconnectButton = document.querySelector('#gemini-disconnect');
const gmailDialog = document.querySelector('#gmail-dialog');

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
        context: Array.isArray(message.context) ? message.context.filter((file) =>
          file && typeof file.name === 'string' && typeof file.content === 'string',
        ).slice(0, 3) : [],
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
  const attachButton = document.createElement('button');
  attachButton.type = 'button';
  attachButton.className = 'context-action';
  attachButton.textContent = '＋ Add to next message';
  attachButton.addEventListener('click', () => attachProjectContext(fileName, result.content));
  contextCard.append(heading, preview, attachButton, note);
}

function attachProjectContext(name, content) {
  if (pendingContext.some((file) => file.name === name)) return;
  if (pendingContext.length >= 3) {
    document.querySelector('#context-card small').textContent = 'You can attach up to three files per message.';
    return;
  }
  const total = pendingContext.reduce((sum, file) => sum + file.content.length, 0) + content.length;
  if (total > 60_000) {
    document.querySelector('#context-card small').textContent = 'Selected context is over the 60,000-character limit.';
    return;
  }
  pendingContext.push({ name, content });
  renderPendingContext();
  const note = document.querySelector('#context-card small');
  if (note) note.textContent = `${name} will be sent with your next message when you press Send.`;
}

function renderPendingContext() {
  const container = document.querySelector('#composer-context');
  container.replaceChildren();
  container.hidden = pendingContext.length === 0;
  pendingContext.forEach((file) => {
    const chip = document.createElement('span');
    chip.className = 'context-chip';
    chip.textContent = `Attached: ${file.name}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${file.name} from next message`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      pendingContext = pendingContext.filter((selected) => selected.name !== file.name);
      renderPendingContext();
    });
    chip.append(remove);
    container.append(chip);
  });
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
    if (message.context?.length) {
      const attached = document.createElement('small');
      attached.className = 'message-context';
      attached.textContent = `Attached project files: ${message.context.map((file) => file.name).join(', ')}`;
      rendered.append(attached);
    }
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
  const submittedMessage = { role: 'user', text: prompt, status: 'complete', context: [...pendingContext] };
  current.messages.push(submittedMessage);
  pendingContext = [];
  renderPendingContext();
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
    const accountConnectedMode = settings.provider === 'openai' && settings.openaiAuthMethod === 'chatgpt'
      || settings.provider === 'gemini' && settings.geminiAuthMethod === 'google-account';
    if (!settings.configured && !accountConnectedMode) {
      submittedMessage.localOnly = true;
      pendingReply.text = 'Connect the selected provider in Settings to get a model response. Your prompt is saved locally and was not sent.';
      pendingReply.localOnly = true;
      pendingReply.status = 'error';
    } else {
      const messages = current.messages
        .filter((message) => !message.localOnly && message.status !== 'pending')
        .map(({ role, text, context }) => ({ role, text, context }));
      pendingReply.text = await window.obavenus.sendChat(messages);
      pendingReply.status = 'complete';
    }
  } catch (error) {
    submittedMessage.localOnly = true;
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
document.querySelector('#email-nav').addEventListener('click', async () => {
  gmailDialog.showModal();
  await updateGmailStatus();
});
document.querySelector('#gmail-close').addEventListener('click', () => gmailDialog.close());
document.querySelector('#gmail-connect').addEventListener('click', async () => {
  const status = document.querySelector('#gmail-status');
  status.textContent = 'Opening Google sign-in…';
  try {
    await window.obavenus.connectGmail({
      clientId: document.querySelector('#gmail-client-id').value.trim(),
      clientSecret: document.querySelector('#gmail-client-secret').value.trim(),
    });
    document.querySelector('#gmail-client-id').value = '';
    document.querySelector('#gmail-client-secret').value = '';
    status.textContent = 'Gmail connected with read-only access.';
    await updateGmailStatus();
    await searchGmail();
  } catch (error) { status.textContent = error.message || 'Could not connect Gmail.'; }
});
document.querySelector('#gmail-disconnect').addEventListener('click', async () => {
  await window.obavenus.disconnectGmail();
  document.querySelector('#gmail-results').replaceChildren();
  await updateGmailStatus();
});
document.querySelector('#gmail-search-button').addEventListener('click', searchGmail);
document.querySelector('#gmail-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); searchGmail(); }
});

async function updateGmailStatus() {
  const status = await window.obavenus.getGmailStatus();
  document.querySelector('#gmail-status').textContent = status.connected
    ? `Connected${status.email ? ` as ${status.email}` : ''} · Gmail read-only`
    : 'Not connected. Create a Desktop app OAuth client and enable Gmail API in Google Cloud.';
  document.querySelector('#gmail-disconnect').hidden = !status.connected;
  document.querySelector('#gmail-inbox').hidden = !status.connected;
  document.querySelector('#gmail-connect').textContent = status.connected ? 'Reconnect Gmail' : 'Connect Gmail';
  if (status.connected) document.querySelector('#gmail-client-id').value = '';
}

async function searchGmail() {
  const results = document.querySelector('#gmail-results');
  results.replaceChildren('Loading mail…');
  try {
    const messages = await window.obavenus.searchGmail(document.querySelector('#gmail-search').value.trim());
    results.replaceChildren();
    if (!messages.length) { results.textContent = 'No matching email.'; return; }
    messages.forEach((email) => {
      const card = document.createElement('article');
      card.className = 'gmail-item';
      const subject = document.createElement('strong');
      subject.textContent = email.subject;
      const from = document.createElement('small');
      from.textContent = `${email.from} · ${email.date}`;
      const snippet = document.createElement('p');
      snippet.textContent = email.snippet;
      const attach = document.createElement('button');
      attach.className = 'context-action';
      attach.type = 'button';
      attach.textContent = '＋ Attach snippet to next message';
      attach.addEventListener('click', () => {
        attachProjectContext(`email-${email.id}.txt`, `Subject: ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}\n\n${email.snippet}`);
        gmailDialog.close();
      });
      card.append(subject, from, snippet, attach);
      results.append(card);
    });
  } catch (error) { results.textContent = error.message || 'Could not search Gmail.'; }
}

async function updateProviderBadge() {
  const badge = document.querySelector('#provider-settings');
  try {
    const settings = await window.obavenus.getProviderSettings();
    const providerName = { openai: settings.openaiAuthMethod === 'chatgpt' ? 'ChatGPT' : 'GPT', anthropic: 'Claude', xai: 'Grok' }[settings.provider] || 'AI';
    const chatgptConnected = settings.provider === 'openai' && settings.openaiAuthMethod === 'chatgpt'
      ? await window.obavenus.getChatGPTSession().then((session) => session.sharing).catch(() => false)
      : false;
    const geminiConnected = settings.provider === 'gemini' && settings.geminiAuthMethod === 'google-account'
      ? await window.obavenus.getGeminiStatus().then((status) => status.connected).catch(() => false)
      : false;
    const displayName = settings.provider === 'gemini' ? 'Gemini' : providerName;
    badge.textContent = (settings.configured || chatgptConnected || geminiConnected)
      ? `${displayName} · ${settings.model} connected · Settings`
      : `${displayName} not connected · Settings`;
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
    providerSelect.value = settings.provider || 'openai';
    authMethodSelect.value = settings.openaiAuthMethod || 'api-key';
    geminiAuthSelect.value = settings.geminiAuthMethod || 'api-key';
    providerModelInput.dataset.provider = providerSelect.value;
    providerModelInput.value = settings.model;
    document.querySelector('#gemini-project-id').value = settings.geminiProjectId || '';
    updateProviderFormLabels();
    updateProviderDisclosure();
    providerKeyState.textContent = settings.configured
      ? 'A key is saved in encrypted device storage. Enter a new key to replace it.'
      : 'No key saved. Your key will be encrypted with macOS Keychain-backed storage.';
    removeProviderKeyButton.hidden = !settings.configured;
    await updateChatGPTControls();
    await updateGeminiControls();
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
      provider: providerSelect.value,
      openaiAuthMethod: authMethodSelect.value,
      geminiAuthMethod: geminiAuthSelect.value,
      geminiProjectId: document.querySelector('#gemini-project-id').value.trim(),
      model: providerModelInput.value,
      apiKey: providerSelect.value === 'openai' && authMethodSelect.value === 'chatgpt' ? '' : providerKeyInput.value,
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
    const settings = await window.obavenus.clearProviderKey(providerSelect.value);
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

providerSelect.addEventListener('change', async () => {
  updateProviderFormLabels();
  updateProviderDisclosure();
  const settings = await window.obavenus.getProviderSettings();
  const connected = settings.connectedProviders?.includes(providerSelect.value);
  providerKeyState.textContent = connected ? 'This provider has a key saved in encrypted device storage.' : 'No key saved for this provider.';
  removeProviderKeyButton.hidden = !connected;
  await updateChatGPTControls();
  await updateGeminiControls();
});

authMethodSelect.addEventListener('change', () => { updateChatGPTControls(); updateProviderDisclosure(); });
geminiAuthSelect.addEventListener('change', () => { updateGeminiControls(); updateProviderDisclosure(); });

geminiSignInButton.addEventListener('click', async () => {
  geminiSignInButton.disabled = true;
  geminiState.textContent = 'Opening secure Google sign-in…';
  try {
    const credentials = {
      projectId: document.querySelector('#gemini-project-id').value.trim(),
      clientId: document.querySelector('#gemini-client-id').value.trim(),
      clientSecret: document.querySelector('#gemini-client-secret').value,
    };
    const status = await window.obavenus.connectGeminiAccount(credentials);
    providerSelect.value = 'gemini';
    geminiAuthSelect.value = 'google-account';
    updateProviderFormLabels();
    updateProviderDisclosure();
    await window.obavenus.saveProviderSettings({
      provider: 'gemini', geminiAuthMethod: 'google-account', geminiProjectId: credentials.projectId,
      model: providerModelInput.value || 'gemini-3.8-flash', apiKey: '',
    });
    document.querySelector('#gemini-client-secret').value = '';
    geminiState.textContent = `Connected${status.email ? ` as ${status.email}` : ''} · project ${status.projectId}.`;
    await updateProviderBadge();
  } catch (error) {
    geminiState.textContent = error.message || 'Google sign-in did not complete.';
  } finally {
    geminiSignInButton.disabled = false;
    await updateGeminiControls();
  }
});

geminiDisconnectButton.addEventListener('click', async () => {
  geminiDisconnectButton.disabled = true;
  try {
    await window.obavenus.disconnectGeminiAccount();
    geminiState.textContent = 'Disconnected.';
    await updateProviderBadge();
  } catch (error) { geminiState.textContent = error.message || 'Could not disconnect Google.'; }
  finally { geminiDisconnectButton.disabled = false; await updateGeminiControls(); }
});

chatgptSignInButton.addEventListener('click', async () => {
  chatgptSignInButton.disabled = true;
  chatgptState.textContent = 'Opening secure ChatGPT sign-in…';
  try {
    const session = await window.obavenus.signInWithChatGPT();
    providerSelect.value = 'openai';
    authMethodSelect.value = 'chatgpt';
    updateProviderFormLabels();
    updateProviderDisclosure();
    await window.obavenus.saveProviderSettings({
      provider: 'openai', openaiAuthMethod: 'chatgpt', model: providerModelInput.value || 'gpt-5.5', apiKey: '',
    });
    chatgptState.textContent = session.sharing
      ? `Connected${session.identity?.email ? ` as ${session.identity.email}` : ''}.`
      : 'Signed in, but token sharing is not enabled for this account.';
    if (session.sharing) {
      try {
        await refreshChatGPTModels();
        await window.obavenus.saveProviderSettings({ provider: 'openai', openaiAuthMethod: 'chatgpt', model: providerModelInput.value, apiKey: '' });
      } catch (error) {
        chatgptState.textContent = `Connected, but the model list could not load: ${error.message || 'try again later.'}`;
      }
    }
    await updateProviderBadge();
  } catch (error) {
    chatgptState.textContent = error.message || 'ChatGPT sign-in did not complete.';
  } finally {
    chatgptSignInButton.disabled = false;
    chatgptDisconnectButton.hidden = !(await window.obavenus.getChatGPTSession().then((session) => session.status === 'connected').catch(() => false));
  }
});

chatgptDisconnectButton.addEventListener('click', async () => {
  chatgptDisconnectButton.disabled = true;
  try {
    await window.obavenus.disconnectChatGPT();
    chatgptState.textContent = 'Disconnected.';
    await updateProviderBadge();
  } catch (error) {
    chatgptState.textContent = error.message || 'Could not disconnect ChatGPT.';
  } finally { chatgptDisconnectButton.disabled = false; await updateChatGPTControls(); }
});

function updateProviderFormLabels() {
  const names = { openai: 'OpenAI', anthropic: 'Anthropic (Claude)', gemini: 'Google Gemini', xai: 'xAI (Grok)' };
  const providerName = names[providerSelect.value] || 'Provider';
  document.querySelector('#provider-key-label').textContent = `${providerName} API key`;
  document.querySelector('#provider-title').textContent = `Connect ${providerName}`;
  document.querySelector('#openai-auth-label').hidden = providerSelect.value !== 'openai';
  authMethodSelect.hidden = providerSelect.value !== 'openai';
  document.querySelector('#gemini-auth-label').hidden = providerSelect.value !== 'gemini';
  geminiAuthSelect.hidden = providerSelect.value !== 'gemini';
  const accountMode = providerSelect.value === 'openai' && authMethodSelect.value === 'chatgpt'
    || providerSelect.value === 'gemini' && geminiAuthSelect.value === 'google-account';
  document.querySelector('#provider-key-label').hidden = accountMode;
  providerKeyInput.hidden = accountMode;
  providerKeyState.hidden = accountMode;
  removeProviderKeyButton.hidden = accountMode;
  chatgptConnection.hidden = providerSelect.value !== 'openai' || authMethodSelect.value !== 'chatgpt';
  geminiConnection.hidden = providerSelect.value !== 'gemini' || geminiAuthSelect.value !== 'google-account';
  const note = document.querySelector('#provider-auth-note');
  note.hidden = !['anthropic', 'xai'].includes(providerSelect.value);
  note.textContent = providerSelect.value === 'anthropic'
    ? 'Claude Pro/Max sign-in is for Anthropic apps such as Claude Code. For third-party apps, Anthropic directs developers to use a Console API key, billed separately from your subscription.'
    : providerSelect.value === 'xai' ? 'Grok subscription sign-in is not available through xAI’s public API. Obavenus uses an xAI API key.' : '';
  const defaults = { openai: 'gpt-5.5', anthropic: 'claude-sonnet-4-6', gemini: 'gemini-3.8-flash', xai: 'grok-4.7' };
  if (providerModelInput.dataset.provider !== providerSelect.value || !providerModelInput.value) providerModelInput.value = defaults[providerSelect.value];
  providerModelInput.dataset.provider = providerSelect.value;
}

function updateProviderDisclosure() {
  const providerName = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google', xai: 'xAI' }[providerSelect.value] || 'selected provider';
  const isChatGPT = providerSelect.value === 'openai' && authMethodSelect.value === 'chatgpt';
  const isGeminiOAuth = providerSelect.value === 'gemini' && geminiAuthSelect.value === 'google-account';
  document.querySelector('#provider-request-disclosure').textContent = isChatGPT
    ? 'When you press Send, this chat and any files you explicitly attached go to OpenAI through your ChatGPT account. Requests use store: false; OpenAI’s account data policies still apply.'
    : isGeminiOAuth
      ? 'When you press Send, this chat and any files you explicitly attached go to the Gemini API through your Google account. Usage is charged to your selected Google Cloud project.'
    : `When you press Send, this chat and any files you explicitly attached go to ${providerName}. OpenAI API requests use store: false; other providers’ data policies apply.`;
}

async function updateChatGPTControls() {
  updateProviderFormLabels();
  if (providerSelect.value !== 'openai') return;
  try {
    const session = await window.obavenus.getChatGPTSession();
    chatgptState.textContent = session.status === 'connected'
      ? `${session.sharing ? 'Connected' : 'Connected · token sharing disabled'}${session.identity?.email ? ` as ${session.identity.email}` : ''}.`
      : session.status === 'reauth_required' ? 'Reconnect your ChatGPT account.' : 'Not connected.';
    chatgptSignInButton.textContent = session.status === 'connected' ? 'Reconnect ChatGPT' : 'Continue with ChatGPT';
    chatgptDisconnectButton.hidden = session.status !== 'connected';
    if (session.sharing) await refreshChatGPTModels();
  } catch (error) { chatgptState.textContent = error.message || 'ChatGPT status unavailable.'; }
}

async function updateGeminiControls() {
  updateProviderFormLabels();
  if (providerSelect.value !== 'gemini') return;
  try {
    const status = await window.obavenus.getGeminiStatus();
    geminiState.textContent = status.connected
      ? `Connected${status.email ? ` as ${status.email}` : ''} · project ${status.projectId}.`
      : 'Not connected.';
    geminiSignInButton.textContent = status.connected ? 'Reconnect Google' : 'Continue with Google';
    geminiDisconnectButton.hidden = !status.connected;
  } catch (error) { geminiState.textContent = error.message || 'Google account status unavailable.'; }
}

async function refreshChatGPTModels() {
  const models = await window.obavenus.getChatGPTModels();
  const options = document.querySelector('#chatgpt-model-options');
  options.replaceChildren(...models.map((item) => {
    const option = document.createElement('option');
    option.value = item.slug;
    option.label = item.displayName;
    return option;
  }));
  if (!models.some((item) => item.slug === providerModelInput.value)) providerModelInput.value = models[0]?.slug || providerModelInput.value;
}

window.obavenus.getLastProject().then((project) => {
  if (project) renderProject(project);
});
