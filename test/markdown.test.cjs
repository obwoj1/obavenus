const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBlocks, parseInline, renderInto, safeHref } = require('../src/markdown.js');

test('assistant markdown handles paragraphs, headings, emphasis, lists, quotes, and fenced code', () => {
  const blocks = parseBlocks([
    '# Summary',
    '',
    'A **strong** point, *emphasis*, ~~removed~~, and `inline code`.',
    '',
    '- First',
    '- Second',
    '',
    '> A cited point',
    '',
    '```js',
    'const answer = 42;',
    '```',
  ].join('\n'));

  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'paragraph', 'unordered-list', 'quote', 'code-block']);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[1].children.map((node) => node.type), ['text', 'strong', 'text', 'em', 'text', 'del', 'text', 'code', 'text']);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].children[0].children[0].value, 'A cited point');
  assert.equal(blocks[4].language, 'js');
  assert.equal(blocks[4].value, 'const answer = 42;');
});

test('markdown links allow web and mail destinations while rejecting script and file schemes', () => {
  assert.equal(safeHref('https://example.com/path'), 'https://example.com/path');
  assert.equal(safeHref('mailto:help@example.com'), 'mailto:help@example.com');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('file:///etc/passwd'), '');
  const [safe, unsafe] = parseInline('[docs](https://example.com) [bad](javascript:alert(1))');
  assert.equal(safe.type, 'link');
  assert.equal(safe.href, 'https://example.com/');
  assert.equal(unsafe.type, 'text');
});

test('raw HTML stays plain text and never becomes a renderer instruction', () => {
  const [block] = parseBlocks('<script>alert("x")</script>');
  assert.equal(block.type, 'paragraph');
  assert.deepEqual(block.children, [{ type: 'text', value: '<script>alert("x")</script>' }]);
});

test('renderer creates only safe DOM elements and keeps untrusted HTML in text nodes', () => {
  function element(tagName) {
    return {
      tagName,
      children: [],
      append(...children) { this.children.push(...children); },
      set textContent(value) { this.children = [{ nodeType: 'text', value }]; },
    };
  }
  const document = {
    createDocumentFragment: () => element('#fragment'),
    createElement: (tag) => element(tag),
    createTextNode: (value) => ({ nodeType: 'text', value }),
  };
  const root = { ownerDocument: document, replaceChildren(fragment) { this.children = fragment.children; } };
  renderInto(root, '<img src=x onerror=alert(1)>\n\n[Guide](https://example.com)');

  const [paragraph, linkParagraph] = root.children;
  assert.equal(paragraph.tagName, 'p');
  assert.equal(paragraph.children[0].value, '<img src=x onerror=alert(1)>');
  assert.equal(paragraph.children[0].tagName, undefined);
  const link = linkParagraph.children[0];
  assert.equal(link.tagName, 'a');
  assert.equal(link.href, 'https://example.com/');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.target, '_blank');
});
