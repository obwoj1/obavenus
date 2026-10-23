const form = document.querySelector('#prompt-form');
const promptInput = form.querySelector('textarea');
const conversation = document.querySelector('#conversation');
const workspace = document.querySelector('#workspace-label');

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

document.querySelector('#open-project').addEventListener('click', async () => {
  const project = await window.obavenus.chooseProject();
  if (!project) return;
  workspace.replaceChildren();
  const title = document.createElement('span');
  title.textContent = project.name;
  const detail = document.createElement('small');
  detail.textContent = 'Selected project folder';
  workspace.append(title, detail);

  const contextCard = document.querySelector('#context-card');
  contextCard.replaceChildren();
  const contextTitle = document.createElement('strong');
  contextTitle.textContent = project.name;
  const fileList = document.createElement('ul');
  fileList.className = 'file-list';
  project.entries.forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = `${entry.kind === 'folder' ? '▸' : '·'} ${entry.name}`;
    fileList.append(item);
  });
  const note = document.createElement('small');
  note.textContent = project.truncated
    ? 'Showing the first 80 entries. File contents are not read.'
    : `${project.entries.length} top-level entries · contents are not read`;
  contextCard.append(contextTitle, fileList, note);
});
