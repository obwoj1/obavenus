let socket;
let reconnectTimer;
let desiredConnection = false;
let approvedControl;

function setState(connected) {
  chrome.storage.local.set({ connected });
  chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#718b74' });
}
function connect() {
  desiredConnection = true;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  socket = new WebSocket('ws://127.0.0.1:43137/bridge');
  socket.onopen = () => { socket.send(JSON.stringify({ type: 'pair' })); };
  socket.onmessage = async ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.type === 'paired') { setState(message.accepted); return; }
    if (!message.id) return;
    try {
      const result = await execute(message.command, message.args || {});
      socket.send(JSON.stringify({ id: message.id, result }));
    } catch (error) {
      socket.send(JSON.stringify({ id: message.id, result: { error: error.message || 'Page action failed.' } }));
    }
  };
  socket.onclose = () => { setState(false); clearTimeout(reconnectTimer); if (desiredConnection) reconnectTimer = setTimeout(connect, 2500); };
  socket.onerror = () => socket.close();
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Select an ordinary http or https tab in Chrome first.');
  return tab;
}
async function inspect(tab, action, argument) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (kind, value) => {
    const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();
    if (kind === 'readPage') return { url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 20_000) };
    if (kind === 'followLink') {
      const links = [...document.querySelectorAll('a[href]')].filter((a) => norm(a.innerText || a.getAttribute('aria-label')).toLowerCase().includes(value.toLowerCase()));
      if (links.length !== 1) return { error: links.length ? 'That link label is ambiguous.' : 'No matching link was found.' };
      const target = new URL(links[0].href, location.href);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return { error: 'Refused an unsafe link destination.' };
      location.assign(target.href); return { navigated: true, url: target.href, label: norm(links[0].innerText) };
    }
    if (kind === 'findControl') {
      const controls = [...document.querySelectorAll('button,input[type=button],input[type=submit],[role=button]')].filter((el) => {
        const label = norm(el.innerText || el.value || el.getAttribute('aria-label'));
        return label.toLowerCase().includes(value.toLowerCase()) && !el.disabled && el.getClientRects().length;
      });
      if (controls.length !== 1) return { found: false, message: controls.length ? 'More than one visible control matches; specify a more distinctive label.' : 'No matching visible enabled control was found.' };
      return { found: true, pageUrl: location.href, label: norm(controls[0].innerText || controls[0].value || controls[0].getAttribute('aria-label')) };
    }
    if (kind === 'clickControl') {
      if (location.href !== value.pageUrl) return { error: 'The active page changed after approval. Review it and try again.' };
      const controls = [...document.querySelectorAll('button,input[type=button],input[type=submit],[role=button]')].filter((el) => {
        const label = norm(el.innerText || el.value || el.getAttribute('aria-label'));
        return label === value.label && !el.disabled && el.getClientRects().length;
      });
      if (controls.length !== 1) return { error: 'The approved control is no longer unique and available.' };
      controls[0].click(); return { clicked: true, label: value.label, url: location.href };
    }
    return { error: 'Unsupported Chrome command.' };
  }, args: [action, argument] });
  return result?.result;
}
async function execute(command, args) {
  if (command === 'navigate') {
    const url = new URL(args.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only safe http and https URLs can be opened.');
    const tab = await activeTab(); await chrome.tabs.update(tab.id, { url: url.toString() });
    return { navigated: true, url: url.toString() };
  }
  const tab = await activeTab();
  if (command === 'readPage') return inspect(tab, 'readPage');
  if (command === 'followLink') return inspect(tab, 'followLink', String(args.text || '').slice(0, 200));
  if (command === 'findControl') {
    approvedControl = { tabId: tab.id, pageUrl: tab.url, label: String(args.text || '').slice(0, 200) };
    const found = await inspect(tab, 'findControl', approvedControl.label);
    approvedControl = found.found ? { ...approvedControl, label: found.label, pageUrl: found.pageUrl } : null;
    return found;
  }
  if (command === 'clickControl') {
    if (!approvedControl || approvedControl.tabId !== tab.id || approvedControl.pageUrl !== args.pageUrl || approvedControl.label !== args.label) throw new Error('The approved Chrome tab or control changed. Review it and request approval again.');
    const pinnedTab = await chrome.tabs.get(approvedControl.tabId);
    if (pinnedTab.url !== approvedControl.pageUrl) throw new Error('The approved Chrome page has changed.');
    const clicked = await inspect(pinnedTab, 'clickControl', args);
    approvedControl = null;
    return clicked;
  }
  throw new Error('Unsupported Chrome command.');
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'connect') { connect(); sendResponse({ connecting: true }); }
  if (message?.type === 'disconnect') { desiredConnection = false; clearTimeout(reconnectTimer); socket?.close(); socket = null; approvedControl = null; setState(false); sendResponse({ disconnected: true }); }
  if (message?.type === 'state') sendResponse({ connected: socket?.readyState === WebSocket.OPEN });
  return true;
});
