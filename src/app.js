const form = document.querySelector('#prompt-form');
const promptInput = form.querySelector('textarea');
const conversation = document.querySelector('#conversation');
const workspace = document.querySelector('#workspace-label');
const contextCard = document.querySelector('#context-card');
let selectedProject = null;

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
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  addMessage(prompt, 'user-message');
  addMessage('This is the local UI prototype. Connect an AI provider in a later build step to get an assistant response.', 'assistant-message');
  promptInput.value = '';
  conversation.scrollTop = conversation.scrollHeight;
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

window.obavenus.getLastProject().then((project) => {
  if (project) renderProject(project);
});
