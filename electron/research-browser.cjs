function validateHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Enter a valid http or https URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Research Browser only opens http and https pages without embedded credentials.');
  return url;
}

function createResearchBrowser({ BrowserWindow, session = null, confirmAction = async () => false }) {
  let window;
  function current() {
    if (!window || window.isDestroyed()) throw new Error('Research Browser is not open. Open a page first.');
    if (window.webContents.isLoading()) throw new Error('Wait for the current page to finish loading.');
    return window;
  }
  async function open(rawUrl) {
    const url = validateHttpUrl(rawUrl);
    if (window && !window.isDestroyed()) window.close();
    window = new BrowserWindow({ width: 1160, height: 820, title: 'Obavenus Research Browser', webPreferences: { partition: 'persist:obavenus-research', contextIsolation: true, nodeIntegration: false, sandbox: true } });
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
  async function clickControl(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 160) throw new TypeError('Control text must contain 1–160 characters.');
    const active = current();
    const needle = text.trim();
    const escapedNeedle = JSON.stringify(needle.toLocaleLowerCase());
    const candidate = await active.webContents.executeJavaScript(`(() => { const needle = ${escapedNeedle}; const controls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')]; const item = controls.find((el) => { const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim(); const rect = el.getBoundingClientRect(); return !el.disabled && rect.width > 0 && rect.height > 0 && text.toLocaleLowerCase().includes(needle); }); if (!item) return null; return { label: (item.innerText || item.value || item.getAttribute('aria-label') || item.title || '').trim().slice(0, 160), url: location.href, kind: (item.getAttribute('type') || item.getAttribute('role') || item.tagName).toLowerCase() }; })()`);
    if (!candidate) throw new Error('No enabled, visible button with that text was found.');
    if (!await confirmAction(candidate)) return { approved: false, label: candidate.label, url: candidate.url };
    const clicked = await active.webContents.executeJavaScript(`(() => { const needle = ${escapedNeedle}; const controls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')]; const item = controls.find((el) => { const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim(); const rect = el.getBoundingClientRect(); return !el.disabled && rect.width > 0 && rect.height > 0 && text.toLocaleLowerCase().includes(needle); }); if (!item) return false; item.click(); return true; })()`);
    if (!clicked) throw new Error('The page changed before the approved control could be activated.');
    return { approved: true, label: candidate.label, url: candidate.url };
  }
  async function clearSession() {
    if (!session) throw new Error('Research Browser session storage is unavailable.');
    if (window && !window.isDestroyed()) { window.close(); window = null; }
    await session.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    await session.clearCache();
    return { cleared: true };
  }
  return { open, readPage, followLink, clickControl, clearSession };
}

module.exports = { createResearchBrowser, validateHttpUrl };
