const status = document.querySelector('#status');
document.querySelector('#access').addEventListener('click', async () => {
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  status.textContent = granted ? 'Site access enabled. Obavenus can read web tabs during a paired Chrome run.' : 'Site access was not granted.';
});
document.querySelector('#connect').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'connect' });
  status.textContent = result?.connecting ? 'Requesting a connection. Approve the pairing dialog in Obavenus.' : 'Could not start the connection.';
});
document.querySelector('#disconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'disconnect' }); status.textContent = 'Disconnected.';
});
chrome.runtime.sendMessage({ type: 'state' }).then(({ connected }) => { if (connected) status.textContent = 'Connected to Obavenus.'; });
