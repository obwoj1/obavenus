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
  const projectName = await window.obavenus.chooseProject();
  if (!projectName) return;
  workspace.replaceChildren();
  const title = document.createElement('span');
  title.textContent = projectName;
  const detail = document.createElement('small');
  detail.textContent = 'Project selected on this Mac';
  workspace.append(title, detail);
});
