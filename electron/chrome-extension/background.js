let socket;
let reconnectTimer;
let desiredConnection = false;
let approvedControl;
let approvedField;
let approvedSelection;

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
    const visibleTextFields = () => [...document.querySelectorAll('input,textarea')].filter((el) => {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const label = norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label') || el.getAttribute('placeholder'));
      const privateField = /password|passcode|one[- ]time|verification code|security code|authenticator|\botp\b|social security|\bssn\b|access token|api key/i.test(`${label} ${el.name || ''} ${el.id || ''}`);
      return ['text','email','search','tel','url','number'].includes(type)
        && !el.disabled && !el.readOnly && !privateField && label && el.getClientRects().length;
    });
    if (kind === 'findField') {
      const wanted = norm(value.label).toLowerCase();
      const fields = visibleTextFields().filter((el) => {
        const label = norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label') || el.getAttribute('placeholder'));
        return label.toLowerCase() === wanted;
      });
      if (fields.length !== 1) return { found: false, message: fields.length ? 'More than one visible field has that exact label.' : 'No normal visible text field has that exact label. Password, verification-code, and credential fields are not supported.' };
      const el = fields[0];
      return { found: true, pageUrl: location.href, label: norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label') || el.getAttribute('placeholder')), fieldType: el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase() };
    }
    const visibleSelects = () => [...document.querySelectorAll('select')].filter((el) => {
      const label = norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label'));
      return !el.disabled && !el.multiple && label && el.getClientRects().length;
    });
    if (kind === 'findSelect') {
      const wanted = norm(value.label).toLowerCase();
      const selects = visibleSelects().filter((el) => norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label')).toLowerCase() === wanted);
      if (selects.length !== 1) return { found: false, message: selects.length ? 'More than one visible dropdown has that exact label.' : 'No normal visible dropdown has that exact label.' };
      const el = selects[0];
      const allOptions = [...el.options].filter((option) => !option.disabled).map((option) => norm(option.textContent)).filter(Boolean);
      const options = allOptions.filter((option, index) => allOptions.indexOf(option) === index && allOptions.lastIndexOf(option) === index).slice(0, 40);
      return { found: true, pageUrl: location.href, label: norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label')), selected: norm(el.selectedOptions?.[0]?.textContent), options };
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
    if (kind === 'fillField') {
      if (location.href !== value.pageUrl) return { error: 'The active page changed after approval. Review it and try again.' };
      const fields = visibleTextFields().filter((el) => {
        const label = norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label') || el.getAttribute('placeholder'));
        const type = el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
        return label === value.fieldLabel && type === value.fieldType;
      });
      if (fields.length !== 1) return { error: 'The approved field is no longer unique and available.' };
      const field = fields[0];
      field.focus();
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
      if (descriptor?.set) descriptor.set.call(field, value.value); else field.value = value.value;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value.value || null }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: field.value === value.value, label: value.fieldLabel, pageUrl: location.href, submitted: false };
    }
    if (kind === 'selectOption') {
      if (location.href !== value.pageUrl) return { error: 'The active page changed after approval. Review it and try again.' };
      const selects = visibleSelects().filter((el) => norm([...(el.labels || [])].map((item) => item.innerText).join(' ') || el.getAttribute('aria-label')) === value.fieldLabel);
      if (selects.length !== 1) return { error: 'The approved dropdown is no longer unique and available.' };
      const select = selects[0];
      const options = [...select.options].filter((option) => !option.disabled && norm(option.textContent) === value.optionLabel);
      if (options.length !== 1) return { error: 'The approved option is no longer unique and available.' };
      select.value = options[0].value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: norm(options[0].textContent), label: value.fieldLabel, pageUrl: location.href };
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
  if (command === 'findField') {
    approvedField = { tabId: tab.id, pageUrl: tab.url, label: String(args.label || '').slice(0, 200) };
    const found = await inspect(tab, 'findField', approvedField);
    approvedField = found.found ? { ...approvedField, label: found.label, fieldType: found.fieldType, pageUrl: found.pageUrl } : null;
    return found;
  }
  if (command === 'fillField') {
    if (!approvedField || approvedField.tabId !== tab.id || approvedField.pageUrl !== args.pageUrl || approvedField.label !== args.fieldLabel || approvedField.fieldType !== args.fieldType) throw new Error('The approved Chrome tab or field changed. Review it and request approval again.');
    const pinnedTab = await chrome.tabs.get(approvedField.tabId);
    if (pinnedTab.url !== approvedField.pageUrl) throw new Error('The approved Chrome page has changed.');
    const filled = await inspect(pinnedTab, 'fillField', args);
    approvedField = null;
    return filled;
  }
  if (command === 'findSelect') {
    approvedSelection = { tabId: tab.id, pageUrl: tab.url, label: String(args.label || '').slice(0, 200) };
    const found = await inspect(tab, 'findSelect', approvedSelection);
    approvedSelection = found.found ? { ...approvedSelection, label: found.label, pageUrl: found.pageUrl } : null;
    return found;
  }
  if (command === 'selectOption') {
    if (!approvedSelection || approvedSelection.tabId !== tab.id || approvedSelection.pageUrl !== args.pageUrl || approvedSelection.label !== args.fieldLabel) throw new Error('The approved Chrome tab or dropdown changed. Review it and request approval again.');
    const pinnedTab = await chrome.tabs.get(approvedSelection.tabId);
    if (pinnedTab.url !== approvedSelection.pageUrl) throw new Error('The approved Chrome page has changed.');
    const selected = await inspect(pinnedTab, 'selectOption', args);
    approvedSelection = null;
    return selected;
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
  if (message?.type === 'disconnect') { desiredConnection = false; clearTimeout(reconnectTimer); socket?.close(); socket = null; approvedControl = null; approvedField = null; approvedSelection = null; setState(false); sendResponse({ disconnected: true }); }
  if (message?.type === 'state') sendResponse({ connected: socket?.readyState === WebSocket.OPEN });
  return true;
});
