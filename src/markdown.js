(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ObavenusMarkdown = api;
})(globalThis, function () {
  const inlinePattern = /(`+)([^`\n]*?)\1|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)|(\*\*|__)(?=\S)(.+?\S)\6|~~(?=\S)(.+?\S)~~|(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)|(?<!_)_(?=\S)(.+?\S)_(?!_)/g;

  function safeHref(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function parseInline(value) {
    const nodes = [];
    const text = String(value ?? '');
    let cursor = 0;
    inlinePattern.lastIndex = 0;
    for (const match of text.matchAll(inlinePattern)) {
      if (match.index > cursor) nodes.push({ type: 'text', value: text.slice(cursor, match.index) });
      if (match[1]) nodes.push({ type: 'code', value: match[2] });
      else if (match[3]) {
        const href = safeHref(match[4]);
        if (href) nodes.push({ type: 'link', href, title: match[5] || '', children: parseInline(match[3]) });
        else nodes.push({ type: 'text', value: match[0] });
      } else if (match[6]) nodes.push({ type: 'strong', children: parseInline(match[7]) });
      else if (match[8]) nodes.push({ type: 'del', children: parseInline(match[8]) });
      else if (match[9] !== undefined) nodes.push({ type: 'em', children: parseInline(match[9]) });
      else if (match[10] !== undefined) nodes.push({ type: 'em', children: parseInline(match[10]) });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) nodes.push({ type: 'text', value: text.slice(cursor) });
    return nodes;
  }

  function isList(line) { return /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line); }
  function isBlockStart(lines, index) {
    const line = lines[index] || '';
    return /^ {0,3}(?:#{1,6}\s|```|~~~|>|\s*$)/.test(line) || /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line) || isList(line);
  }

  function parseBlocks(value) {
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
      if (fence) {
        index += 1;
        const code = [];
        while (index < lines.length && !new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        blocks.push({ type: 'code-block', language: fence[2].slice(0, 32), value: code.join('\n') });
        continue;
      }
      const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) { blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) }); index += 1; continue; }
      if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) { blocks.push({ type: 'hr' }); index += 1; continue; }
      if (/^ {0,3}>/.test(line)) {
        const quote = [];
        while (index < lines.length && /^ {0,3}>/.test(lines[index])) quote.push(lines[index++].replace(/^ {0,3}> ?/, ''));
        blocks.push({ type: 'quote', children: parseBlocks(quote.join('\n')) });
        continue;
      }
      if (isList(line)) {
        const ordered = /^ {0,3}\d/.test(line);
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^ {0,3}(?:([-+*])|(\d+[.)]))\s+(.*)$/);
          if (!item || Boolean(item[2]) !== ordered) break;
          const content = [item[3]];
          index += 1;
          while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !isList(lines[index])) content.push(lines[index++].trim());
          items.push({ type: 'list-item', children: parseBlocks(content.join('\n')) });
        }
        blocks.push({ type: ordered ? 'ordered-list' : 'unordered-list', items });
        continue;
      }
      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) paragraph.push(lines[index++].trim());
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
    }
    return blocks;
  }

  function appendInline(document, parent, nodes) {
    for (const node of nodes) {
      if (node.type === 'text' || node.type === 'code') {
        const element = node.type === 'code' ? document.createElement('code') : document.createTextNode(node.value);
        if (node.type === 'code') element.textContent = node.value;
        parent.append(element);
        continue;
      }
      const tag = { strong: 'strong', em: 'em', del: 'del', link: 'a' }[node.type];
      if (!tag) continue;
      const element = document.createElement(tag);
      if (node.type === 'link') {
        element.href = node.href;
        element.rel = 'noopener noreferrer';
        element.target = '_blank';
        if (node.title) element.title = node.title;
      }
      appendInline(document, element, node.children || []);
      parent.append(element);
    }
  }

  function renderBlocks(document, parent, blocks) {
    for (const block of blocks) {
      if (block.type === 'hr') { parent.append(document.createElement('hr')); continue; }
      if (block.type === 'code-block') {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (block.language) code.className = `language-${block.language.replace(/[^\w+-]/g, '')}`;
        code.textContent = block.value;
        pre.append(code);
        parent.append(pre);
        continue;
      }
      if (block.type === 'ordered-list' || block.type === 'unordered-list') {
        const list = document.createElement(block.type === 'ordered-list' ? 'ol' : 'ul');
        for (const item of block.items) {
          const element = document.createElement('li');
          renderBlocks(document, element, item.children);
          list.append(element);
        }
        parent.append(list);
        continue;
      }
      const tag = block.type === 'heading' ? `h${block.level}` : block.type === 'quote' ? 'blockquote' : 'p';
      const element = document.createElement(tag);
      if (block.type === 'quote') renderBlocks(document, element, block.children);
      else appendInline(document, element, block.children);
      parent.append(element);
    }
  }

  function renderInto(element, markdown) {
    const fragment = element.ownerDocument.createDocumentFragment();
    renderBlocks(element.ownerDocument, fragment, parseBlocks(markdown));
    element.replaceChildren(fragment);
  }

  return { parseBlocks, parseInline, renderInto, safeHref };
});
