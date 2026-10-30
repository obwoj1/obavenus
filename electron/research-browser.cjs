function validateHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Enter a valid http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Research Browser only opens http and https pages without embedded credentials.');
  return url;
}

function createResearchBrowser({ BrowserWindow }) {
  let window;
  function current() {
    if (!window || window.isDestroyed()) throw new Error('Research Browser is not open. Open a page first.');
    if (window.webContents.isLoading()) throw new Error('Wait for the current page to finish loading.');
    return window;
  }
  async function open(rawUrl) {
    const url = validateHttpUrl(rawUrl);
    if (window && !window.isDestroyed()) window.close();
    window = new BrowserWindow({ width: 1160, height: 820, title: 'Obavenus Research Browser', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      try { validateHttpUrl(target); } catch { event.preventDefault(); }
    });
    await window.loadURL(url.toString());
    return { url: url.toString() };
  }
  async function readPage() {
    const active = current();
    return active.webContents.executeJavaScript(`(() => ({ title: document.title.slice(0, 300), url: location.href, text: (document.body?.innerText || '').slice(0, 20000) }))()`);
  }
  async function followLink(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 200) throw new TypeError('Link text must be 1–200 characters.');
    const active = current();
    const result = await active.webContents.executeJavaScript(`(() => { const needle = ${JSON.stringify(text.trim().toLocaleLowerCase())}; const links = [...document.querySelectorAll('a[href]')]; const match = links.find((a) => (a.innerText || a.getAttribute('aria-label') || '').trim().toLocaleLowerCase().includes(needle)); return match ? { href: match.href, text: (match.innerText || '').trim().slice(0, 200) } : null; })()`);
    if (!result) throw new Error('No link with that text was found on the current page.');
    const target = validateHttpUrl(result.href);
    await active.loadURL(target.toString());
    return { url: target.toString(), linkText: result.text };
  }
  return { open, readPage, followLink };
}

module.exports = { createResearchBrowser, validateHttpUrl };
