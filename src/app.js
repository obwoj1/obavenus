const form = document.querySelector('#prompt-form');
const promptInput = form.querySelector('textarea');
const runMode = document.querySelector('#run-mode');
const runStatus = document.querySelector('#run-status');
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
const profileDialog = document.querySelector('#profile-dialog');
const profileForm = document.querySelector('#profile-form');
const themeChoice = document.querySelector('#theme-choice');
const THEME_KEY = 'obavenus.theme.v1';

function setTheme(theme) {
  const supported = ['sage', 'dusk', 'mist'].includes(theme) ? theme : 'sage';
  document.body.dataset.theme = supported;
  themeChoice.value = supported;
  try { localStorage.setItem(THEME_KEY, supported); } catch {}
}

try { setTheme(localStorage.getItem(THEME_KEY) || 'sage'); } catch { setTheme('sage'); }
themeChoice.addEventListener('change', () => setTheme(themeChoice.value));

async function editProfile(profile) {
  const value = profile || await window.obavenus.getProfile();
  document.querySelector('#profile-name').value = value.name || '';
  document.querySelector('#profile-resume').value = value.resumeText || '';
  document.querySelector('#profile-linkedin').value = value.linkedinUrl || '';
  document.querySelector('#profile-linkedin-text').value = value.linkedinText || '';
  document.querySelector('#profile-github').value = value.githubUrl || '';
  document.querySelector('#profile-share').checked = value.shareWithAI === true;
  document.querySelector('#profile-form-status').textContent = '';
  profileDialog.showModal();
}

document.querySelector('#profile-open').addEventListener('click', () => editProfile().catch((error) => {
  document.querySelector('#profile-form-status').textContent = error.message || 'Could not load your profile.';
}));
document.querySelector('#profile-resume-file').addEventListener('click', async () => {
  try {
    const file = await window.obavenus.chooseResume();
    if (file) {
      document.querySelector('#profile-resume').value = file.text;
      document.querySelector('#profile-resume-state').textContent = `Loaded ${file.name} · ${file.text.length.toLocaleString()} characters.`;
    }
  } catch (error) { document.querySelector('#profile-resume-state').textContent = error.message || 'Could not read that file.'; }
});
profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#profile-form-status');
  status.textContent = 'Encrypting and saving on this Mac…';
  try {
    await window.obavenus.saveProfile({
      name: document.querySelector('#profile-name').value,
      resumeText: document.querySelector('#profile-resume').value,
      linkedinUrl: document.querySelector('#profile-linkedin').value.trim(),
      linkedinText: document.querySelector('#profile-linkedin-text').value,
      githubUrl: document.querySelector('#profile-github').value.trim(),
      shareWithAI: document.querySelector('#profile-share').checked,
    });
    profileDialog.close();
  } catch (error) { status.textContent = error.message || 'Could not save your profile.'; }
});
document.querySelector('#profile-skip').addEventListener('click', async () => {
  try { await window.obavenus.saveProfile({}); profileDialog.close(); }
  catch (error) { document.querySelector('#profile-form-status').textContent = error.message || 'Could not save this choice.'; }
});

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
        agents: Array.isArray(message.agents) ? message.agents.filter((agent) =>
          agent && typeof agent.role === 'string' && typeof agent.text === 'string',
        ).slice(0, 4).map((agent) => ({ ...agent, tools: Array.isArray(agent.tools) ? agent.tools.filter((tool) => typeof tool === 'string').slice(0, 12) : [] })) : [],
        changes: Array.isArray(message.changes) ? message.changes.filter((change) => change && typeof change.path === 'string').slice(0, 50).map((change) => ({ path: change.path, bytes: Number(change.bytes) || 0, created: change.created === true })) : [],
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
    ? 'Showing the first 80 entries. Team mode reads relevant text files; project writes require selecting “Team · write project files” for that run.'
    : `${project.entries.length} top-level entries · Project writes require selecting “Team · write project files” for that run.`;
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
    if (message.agents?.length) {
      const trace = document.createElement('details');
      trace.className = 'agent-trace';
      const summary = document.createElement('summary');
      summary.textContent = 'Team activity · lead and 2 specialists';
      const list = document.createElement('ol');
      message.agents.forEach((agent) => {
        const item = document.createElement('li');
        const role = document.createElement('strong');
        role.textContent = agent.role;
        item.append(role, document.createTextNode(agent.text));
        if (agent.tools?.length) {
          const used = document.createElement('small');
          used.className = 'message-context';
          used.textContent = `Tools used: ${agent.tools.join(', ')}`;
          item.append(used);
        }
        list.append(item);
      });
      trace.append(summary, list);
      rendered.insertAdjacentElement('afterend', trace);
    }
    if (message.changes?.length) {
      const changed = document.createElement('small');
      changed.className = 'message-context';
      changed.textContent = `Files written in the selected project: ${message.changes.map((change) => `${change.path}${change.created ? ' (created)' : ' (updated)'}`).join(', ')}`;
      rendered.append(changed);
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
  const localMode = /^local-(claude|codex|gemini)(-write)?$/.exec(runMode.value);
  const localWriteAccess = Boolean(localMode?.[2]);
  if ((runMode.value === 'team-write' || localWriteAccess) && !selectedProject) {
    runStatus.hidden = false;
    runStatus.textContent = 'Choose a project folder before enabling project edits.';
    return;
  }

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
  runMode.disabled = true;
  const teamMode = runMode.value.startsWith('team');
  const browserAccess = runMode.value === 'team-browser';
  const localProvider = localMode?.[1] || null;
  const writeAccess = runMode.value === 'team-write' || localWriteAccess;
  runStatus.hidden = !teamMode && !localProvider;
  runStatus.textContent = teamMode ? (browserAccess ? 'Preparing a research team with visible browser access…' : writeAccess ? 'Preparing the project-writing agent…' : 'Preparing the read-only team…') : localProvider ? (localWriteAccess ? 'Preparing the local agent with project-edit access…' : `Checking local ${localProvider} CLI…`) : '';
  const teamRunId = crypto.randomUUID();
  activeTeamRunId = teamMode ? teamRunId : null;
  saveConversations();
  renderMessages();
  promptInput.value = '';

  try {
    const selectedSkillId = document.querySelector('#skill-choice').value;
    const skillCatalog = selectedSkillId ? await window.obavenus.getSkills() : [];
    const selectedSkill = skillCatalog.find((skill) => skill.id === selectedSkillId);
    if (localProvider) {
      const messages = current.messages
        .filter((message) => message.status !== 'pending' && message.status !== 'error')
        .map(({ role, text, context }) => ({ role, text, context }));
      if (selectedSkill) {
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        if (lastUser) lastUser.text += `\n\nSelected Obavenus workflow: ${selectedSkill.name}. ${selectedSkill.instructions}`;
      }
      const status = await window.obavenus.getLocalAgentStatus();
      if (!status[localProvider]?.installed) throw new Error(`${localProvider} CLI is not installed or not on PATH. Install it, sign in with its own CLI, then restart Obavenus.`);
      pendingReply.text = await window.obavenus.runLocalAgent(localProvider, messages, localWriteAccess);
      pendingReply.status = 'complete';
      return;
    }
    const settings = await window.obavenus.getProviderSettings();
    const accountConnectedMode = settings.provider === 'openai' && settings.openaiAuthMethod === 'chatgpt'
      || settings.provider === 'gemini' && settings.geminiAuthMethod === 'google-account';
    if (!settings.configured && !accountConnectedMode) {
      submittedMessage.localOnly = true;
      const providerName = { openai: 'GPT', anthropic: 'Claude', gemini: 'Gemini', xai: 'Grok' }[settings.provider] || 'AI provider';
      pendingReply.text = `Connect ${providerName} in Settings to get a model response. Your prompt stays on this Mac and was not sent.`;
      pendingReply.localOnly = true;
      pendingReply.status = 'error';
    } else {
      const messages = current.messages
        .filter((message) => !message.localOnly && message.status !== 'pending')
        .map(({ role, text, context }) => ({ role, text, context }));
      if (selectedSkill) {
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        if (lastUser) lastUser.text += `\n\nSelected Obavenus workflow: ${selectedSkill.name}. ${selectedSkill.instructions}`;
      }
      if (teamMode) {
        const result = await window.obavenus.runTeam(messages, teamRunId, writeAccess, document.querySelector('#agent-choice').value, browserAccess);
        pendingReply.text = result.text;
        pendingReply.agents = result.agents;
        pendingReply.changes = result.changes || [];
      } else {
        pendingReply.text = await window.obavenus.sendChat(messages);
      }
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
    runMode.disabled = false;
    runStatus.hidden = true;
    runStatus.textContent = '';
    activeTeamRunId = null;
    saveConversations();
    renderRecentWork();
    if (activeConversationId === current.id) renderMessages();
  }
});

let activeTeamRunId = null;
window.obavenus.onAgentProgress((progress) => {
  if (progress.runId !== activeTeamRunId) return;
  runStatus.textContent = `${progress.label}…`;
});

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll('.suggestions button').forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.dataset.mode === 'team') {
      const profile = await window.obavenus.getProfile();
      if (!profile.shareWithAI) {
        await editProfile(profile);
        document.querySelector('#profile-form-status').textContent = 'To run the profile check, enable profile sharing, save, then choose Tech profile check again.';
        return;
      }
      runMode.value = 'team';
    }
    promptInput.value = button.dataset.prompt || button.textContent;
    promptInput.focus();
  });
});

const federalJobsDialog = document.querySelector('#federal-jobs-dialog');
document.querySelector('#federal-jobs-open').addEventListener('click', async () => {
  federalJobsDialog.showModal();
  await updateUSAJobsConnectionStatus();
});
document.querySelector('#federal-jobs-close').addEventListener('click', () => federalJobsDialog.close());
document.querySelector('#federal-jobs-search').addEventListener('click', async () => {
  const results = document.querySelector('#federal-jobs-results');
  results.replaceChildren('Preparing official search links…');
  try {
    const plan = await window.obavenus.findFederalJobs(document.querySelector('#federal-jobs-input').value);
    results.replaceChildren();
    plan.searches.forEach((search) => {
      const card = document.createElement('article');
      card.className = 'job-result';
      const title = document.createElement('strong');
      title.textContent = search.label;
      const detail = document.createElement('small');
      detail.textContent = `Search: ${search.keyword} · ${search.location}`;
      const link = document.createElement('a');
      link.href = search.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = 'Open live USAJOBS results ↗';
      card.append(title, detail, link);
      results.append(card);
    });
    const steps = document.createElement('p');
    steps.textContent = 'Next: open each search, filter to Full-time, check each announcement’s hiring path and closing date, then follow its “How to Apply” section. Save suitable announcements to a USAJOBS account and tailor your federal resume to the specialized experience listed.';
    results.append(steps);
  } catch (error) { results.textContent = error.message || 'Could not build job searches.'; }
});

document.querySelector('#usajobs-save').addEventListener('click', async () => {
  const status = document.querySelector('#usajobs-status');
  status.textContent = 'Encrypting credentials on this Mac…';
  try {
    await window.obavenus.saveUSAJobsCredentials({
      email: document.querySelector('#usajobs-email').value.trim(),
      apiKey: document.querySelector('#usajobs-key').value,
    });
    document.querySelector('#usajobs-key').value = '';
    await updateUSAJobsConnectionStatus('USAJOBS API connected.');
  } catch (error) { status.textContent = error.message || 'Could not save USAJOBS credentials.'; }
});
document.querySelector('#usajobs-disconnect').addEventListener('click', async () => {
  await window.obavenus.clearUSAJobsCredentials();
  await updateUSAJobsConnectionStatus('USAJOBS API key removed.');
});

async function updateUSAJobsConnectionStatus(message = '') {
  const status = document.querySelector('#usajobs-status');
  try {
    const connection = await window.obavenus.getUSAJobsStatus();
    if (connection.email) document.querySelector('#usajobs-email').value = connection.email;
    document.querySelector('#usajobs-disconnect').hidden = !connection.configured;
    document.querySelector('#federal-jobs-live').disabled = !connection.configured;
    document.querySelector('#federal-jobs-live').title = connection.configured ? '' : 'Connect a USAJOBS API key to fetch results inside Obavenus.';
    status.textContent = message || (connection.configured
      ? `Connected as ${connection.email} · API key stored securely.`
      : 'Not connected · public search links work without an API key.');
    return connection;
  } catch (error) { status.textContent = error.message || 'USAJOBS status unavailable.'; return { configured: false }; }
}

document.querySelector('#federal-jobs-live').addEventListener('click', async () => {
  const results = document.querySelector('#federal-jobs-results');
  const input = document.querySelector('#federal-jobs-input').value;
  results.replaceChildren('Searching official USAJOBS announcements…');
  try {
    const salaryValue = Number(document.querySelector('#federal-jobs-min-salary').value);
    const response = await window.obavenus.searchUSAJobsLive(input, {
      location: document.querySelector('#federal-jobs-location').value.trim(),
      fullTime: document.querySelector('#federal-jobs-full-time').checked,
      minimumSalary: Number.isFinite(salaryValue) && salaryValue > 0 ? salaryValue : undefined,
    });
    results.replaceChildren();
    const summary = document.createElement('p');
    summary.textContent = `${response.total} distinct announcements loaded (${response.totalMatches} total matches across ${response.searches.length} searches) · Retrieved ${new Date(response.retrievedAt).toLocaleString()} · live USAJOBS data.`;
    results.append(summary);
    for (const warning of response.warnings || []) {
      const note = document.createElement('p');
      note.textContent = warning;
      results.append(note);
    }
    if (!response.jobs.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No open matches were returned. Broaden the location or remove the minimum-salary filter, then try again.';
      results.append(empty);
      return;
    }
    response.jobs.forEach((job) => {
      const card = document.createElement('article');
      card.className = 'job-result';
      const title = document.createElement('strong');
      title.textContent = job.title;
      const detail = document.createElement('small');
      const pay = job.pay.map((range) => {
        const min = Number(range.minimum);
        const max = Number(range.maximum);
        const interval = range.rate ? ` / ${range.rate}` : '';
        return `${Number.isFinite(min) ? `$${min.toLocaleString()}` : range.minimum || 'Pay not listed'}${Number.isFinite(max) ? `–$${max.toLocaleString()}` : ''}${interval}`;
      }).join(' · ');
      const parsedClose = job.closeDate ? new Date(job.closeDate) : null;
      const closeDate = parsedClose && !Number.isNaN(parsedClose.valueOf()) ? `Closes ${parsedClose.toLocaleDateString()}` : 'Closing date not listed';
      detail.textContent = `${job.agency} · ${job.location} · ${pay || job.grade || 'Pay not listed'} · ${closeDate}`;
      const reason = document.createElement('p');
      const matchBasis = job.matchedAgencies?.length
        ? `target agency (${job.matchedAgencies.join(', ')}) and role`
        : job.similarITMatch ? 'related federal Information Technology Management (2210) occupational series' : 'selected role';
      reason.textContent = `Match basis: ${matchBasis}, selected location${document.querySelector('#federal-jobs-full-time').checked ? ', Full-time schedule' : ''}, and public announcements.`;
      card.append(title, detail, reason);
      if (job.summary) {
        const summary = document.createElement('p');
        summary.textContent = job.summary.slice(0, 900);
        card.append(summary);
      }
      const officialUrl = [job.url, job.applyUrl].find((value) => {
        try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'usajobs.gov' || url.hostname.endsWith('.usajobs.gov')); } catch { return false; }
      });
      if (officialUrl) {
        const link = document.createElement('a');
        link.href = officialUrl;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'Review official announcement and apply ↗';
        card.append(link);
      }
      const instructions = [['Eligibility and requirements', job.requirements], ['Required documents', job.requiredDocuments], ['How to apply', job.howToApply]];
      for (const [label, value] of instructions) if (value) {
        const disclosure = document.createElement('details');
        const heading = document.createElement('summary');
        heading.textContent = label;
        const content = document.createElement('p');
        content.textContent = value.slice(0, 4000);
        disclosure.append(heading, content);
        card.append(disclosure);
      }
      results.append(card);
    });
  } catch (error) {
    results.replaceChildren();
    const failure = document.createElement('p');
    failure.textContent = error.message || 'Could not fetch USAJOBS announcements.';
    results.append(failure);
    const plan = await window.obavenus.findFederalJobs(input).catch(() => null);
    plan?.searches.forEach((search) => {
      const link = document.createElement('a');
      link.href = search.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `Open USAJOBS: ${search.label} ↗`;
      results.append(link);
    });
  }
});

document.querySelector('#open-project').addEventListener('click', chooseProject);
document.querySelector('#projects-nav').addEventListener('click', chooseProject);
document.querySelector('#new-chat').addEventListener('click', startConversation);
document.querySelector('#research-open').addEventListener('click', async () => {
  const status = document.querySelector('#research-status');
  try {
    await window.obavenus.openResearchPage(document.querySelector('#research-url').value.trim());
    status.textContent = 'Opened in a separate browser window. Review the page, then import its text explicitly.';
  } catch (error) { status.textContent = error.message || 'Could not open that page.'; }
});
document.querySelector('#research-import').addEventListener('click', async () => {
  const status = document.querySelector('#research-status');
  try {
    const page = await window.obavenus.importResearchPage();
    if (!page.text.trim()) throw new Error('The current page has no readable text.');
    attachProjectContext(`Web: ${new URL(page.url).hostname} · ${page.title}`.slice(0, 240), `Source: ${page.url}\nTitle: ${page.title}\n\n${page.text}`);
    status.textContent = 'Page text is attached locally; it will be sent only when you submit your next prompt.';
  } catch (error) { status.textContent = error.message || 'Could not import page text.'; }
});
const tasksDialog = document.querySelector('#tasks-dialog');
const taskList = document.querySelector('#scheduled-task-list');
document.querySelector('#tasks-nav').addEventListener('click', async () => {
  await renderScheduledTasks();
  tasksDialog.showModal();
});
document.querySelector('#tasks-close').addEventListener('click', () => tasksDialog.close());
const skillsDialog = document.querySelector('#skills-dialog');
document.querySelector('#skills-nav').addEventListener('click', async () => {
  await renderWorkflowLibrary();
  skillsDialog.showModal();
});
document.querySelector('#workflows-close').addEventListener('click', () => skillsDialog.close());
document.querySelector('#workflow-new').addEventListener('click', () => {
  document.querySelector('#workflow-id').value = '';
  document.querySelector('#workflow-name').value = '';
  document.querySelector('#workflow-instructions').value = '';
  document.querySelector('#workflow-name').focus();
});
document.querySelector('#workflow-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#workflow-status');
  try {
    const saved = await window.obavenus.saveSkill({
      id: document.querySelector('#workflow-id').value || undefined,
      name: document.querySelector('#workflow-name').value,
      instructions: document.querySelector('#workflow-instructions').value,
    });
    status.textContent = 'Workflow saved on this Mac.';
    await refreshSkills(saved.id);
    await renderWorkflowLibrary();
  } catch (error) { status.textContent = error.message || 'Could not save workflow.'; }
});
async function refreshSkills(selectedId = '') {
  const select = document.querySelector('#skill-choice');
  const skills = await window.obavenus.getSkills();
  select.replaceChildren(new Option('No workflow', ''));
  skills.forEach((skill) => select.add(new Option(skill.name, skill.id)));
  if (selectedId) select.value = selectedId;
}
async function renderWorkflowLibrary() {
  const list = document.querySelector('#workflow-list');
  const skills = await window.obavenus.getSkills();
  list.replaceChildren();
  skills.forEach((skill) => {
    const card = document.createElement('article');
    card.className = 'gmail-item';
    const title = document.createElement('strong');
    title.textContent = skill.name;
    const detail = document.createElement('p');
    detail.textContent = skill.instructions;
    card.append(title, detail);
    if (skill.custom) {
      const edit = document.createElement('button');
      edit.className = 'context-action';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        document.querySelector('#workflow-id').value = skill.id;
        document.querySelector('#workflow-name').value = skill.name;
        document.querySelector('#workflow-instructions').value = skill.instructions;
      });
      const remove = document.createElement('button');
      remove.className = 'context-action';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        await window.obavenus.deleteSkill(skill.id);
        if (document.querySelector('#skill-choice').value === skill.id) document.querySelector('#skill-choice').value = '';
        await refreshSkills();
        await renderWorkflowLibrary();
      });
      card.append(edit, remove);
    } else {
      const badge = document.createElement('small');
      badge.textContent = 'Built in';
      card.append(badge);
    }
    list.append(card);
  });
}
const agentsDialog = document.querySelector('#agents-dialog');
document.querySelector('#agents-nav').addEventListener('click', async () => {
  await renderCustomAgents();
  agentsDialog.showModal();
});
document.querySelector('#agents-close').addEventListener('click', () => agentsDialog.close());
document.querySelector('#agent-new').addEventListener('click', () => {
  document.querySelector('#custom-agent-id').value = '';
  document.querySelector('#custom-agent-name').value = '';
  document.querySelector('#custom-agent-instructions').value = '';
  document.querySelector('#custom-agent-name').focus();
});
document.querySelector('#custom-agent-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#agent-status');
  try {
    const saved = await window.obavenus.saveCustomAgent({
      id: document.querySelector('#custom-agent-id').value || undefined,
      name: document.querySelector('#custom-agent-name').value,
      instructions: document.querySelector('#custom-agent-instructions').value,
    });
    status.textContent = 'Profile saved on this Mac.';
    await refreshCustomAgents(saved.id);
    await renderCustomAgents();
  } catch (error) { status.textContent = error.message || 'Could not save profile.'; }
});
async function refreshCustomAgents(selectedId = '') {
  const select = document.querySelector('#agent-choice');
  const agents = await window.obavenus.getCustomAgents();
  select.replaceChildren(new Option('Default specialist', ''));
  agents.forEach((agent) => select.add(new Option(agent.name, agent.id)));
  if (selectedId) select.value = selectedId;
}
async function renderCustomAgents() {
  const list = document.querySelector('#custom-agent-list');
  const agents = await window.obavenus.getCustomAgents();
  list.replaceChildren();
  if (agents.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No custom profiles yet. Create one below to give the team a repeatable specialist perspective.';
    list.append(empty);
  }
  agents.forEach((agent) => {
    const card = document.createElement('article');
    card.className = 'gmail-item';
    const title = document.createElement('strong');
    title.textContent = agent.name;
    const detail = document.createElement('p');
    detail.textContent = agent.instructions;
    const edit = document.createElement('button');
    edit.className = 'context-action';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      document.querySelector('#custom-agent-id').value = agent.id;
      document.querySelector('#custom-agent-name').value = agent.name;
      document.querySelector('#custom-agent-instructions').value = agent.instructions;
    });
    const remove = document.createElement('button');
    remove.className = 'context-action';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      await window.obavenus.deleteCustomAgent(agent.id);
      if (document.querySelector('#agent-choice').value === agent.id) document.querySelector('#agent-choice').value = '';
      await refreshCustomAgents();
      await renderCustomAgents();
    });
    card.append(title, detail, edit, remove);
    list.append(card);
  });
}
refreshCustomAgents().catch(() => {});
document.querySelector('#schedule-toggle').addEventListener('click', () => {
  const panel = document.querySelector('#schedule-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    const earliest = new Date(Date.now() + 60_000);
    earliest.setSeconds(0, 0);
    const local = new Date(earliest.getTime() - earliest.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    document.querySelector('#schedule-at').min = local;
    document.querySelector('#schedule-at').value = local;
  }
});
document.querySelector('#schedule-submit').addEventListener('click', async () => {
  const localMode = /^local-(claude|codex|gemini)(-write)?$/.exec(runMode.value);
  const provider = localMode?.[1] || '';
  const prompt = promptInput.value.trim();
  const executeAt = new Date(document.querySelector('#schedule-at').value).getTime();
  if (!provider) { runStatus.hidden = false; runStatus.textContent = 'Choose a local CLI mode before scheduling.'; return; }
  if (!prompt) { runStatus.hidden = false; runStatus.textContent = 'Enter the task in the composer first.'; return; }
  try {
    await window.obavenus.scheduleLocalTask({ provider, prompt, executeAt });
    promptInput.value = '';
    document.querySelector('#schedule-panel').hidden = true;
    runStatus.hidden = false;
    runStatus.textContent = 'Task queued on this Mac. Open Scheduled tasks to view or cancel it.';
  } catch (error) { runStatus.hidden = false; runStatus.textContent = error.message || 'Could not schedule task.'; }
});
window.obavenus.onScheduledTaskUpdate((task) => {
  if (tasksDialog.open) renderScheduledTasks();
  runStatus.hidden = false;
  runStatus.textContent = `Scheduled task ${task.status}.`;
});
document.querySelector('#email-nav').addEventListener('click', async () => {
  gmailDialog.showModal();
  await updateGmailStatus();
});

async function renderScheduledTasks() {
  const tasks = await window.obavenus.listScheduledTasks();
  taskList.replaceChildren();
  if (!tasks.length) { taskList.textContent = 'No scheduled tasks yet.'; return; }
  tasks.forEach((task) => {
    const card = document.createElement('article');
    card.className = 'gmail-item';
    const title = document.createElement('strong');
    title.textContent = task.prompt.slice(0, 140);
    const meta = document.createElement('small');
    meta.textContent = `${task.provider} · ${task.status}${task.attempts ? ` · attempt ${task.attempts}/3` : ''} · ${new Date(task.executeAt).toLocaleString()}`;
    card.append(title, meta);
    if (task.result || task.error) {
      const details = document.createElement('p');
      details.textContent = task.result || task.error;
      card.append(details);
    }
    if (task.status === 'queued') {
      const cancel = document.createElement('button');
      cancel.className = 'context-action';
      cancel.textContent = 'Cancel task';
      cancel.addEventListener('click', async () => { await window.obavenus.cancelScheduledTask(task.id); await renderScheduledTasks(); });
      card.append(cancel);
    }
    taskList.append(card);
  });
}
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

async function updateProviderDisclosure() {
  const providerName = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google', xai: 'xAI' }[providerSelect.value] || 'selected provider';
  const isChatGPT = providerSelect.value === 'openai' && authMethodSelect.value === 'chatgpt';
  const isGeminiOAuth = providerSelect.value === 'gemini' && geminiAuthSelect.value === 'google-account';
  const profile = await window.obavenus.getProfile().catch(() => ({ shareWithAI: false }));
  const profileNote = profile.shareWithAI ? ' Your saved career profile is also included in AI requests.' : '';
  document.querySelector('#provider-request-disclosure').textContent = isChatGPT
    ? `When you press Send, this chat and attached files go to OpenAI through your ChatGPT account. Requests use store: false; OpenAI’s account data policies still apply.${profileNote}`
    : isGeminiOAuth
      ? `When you press Send, this chat and attached files go to the Gemini API through your Google account. Usage is charged to your selected Google Cloud project.${profileNote}`
    : `When you press Send, this chat and attached files go to ${providerName}. OpenAI API requests use store: false; other providers’ data policies apply.${profileNote}`;
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

refreshSkills().catch(() => {});

window.obavenus.getLastProject().then((project) => {
  if (project) renderProject(project);
});
window.obavenus.getProfile().then((profile) => {
  if (!profile.completed) editProfile(profile);
}).catch(() => {});
