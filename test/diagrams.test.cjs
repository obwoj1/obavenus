const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDiagram } = require('../electron/diagrams.cjs');

test('diagram SVG escapes text and contains only offline vector markup', () => {
  const svg = buildDiagram({
    title: 'Plan <today>',
    nodes: [{ id: 'input', label: 'Read <source>' }, { id: 'output', label: 'Write & review' }],
    edges: [{ from: 'input', to: 'output', label: 'verified & cited' }],
  }).toString('utf8');
  assert.match(svg, /<svg xmlns=/);
  assert.match(svg, /Plan &lt;today&gt;/);
  assert.match(svg, /Read &lt;source&gt;/);
  assert.match(svg, /Write &amp; review/);
  assert.match(svg, /verified &amp; cited/);
  assert.doesNotMatch(svg, /<script|<foreignObject|<image|(?:href|src)=/i);
});

test('diagram builder rejects ambiguous IDs and connections outside the graph', () => {
  assert.throws(() => buildDiagram({ title: 'Bad', nodes: [{ id: 'same', label: 'One' }, { id: 'same', label: 'Two' }], edges: [{ from: 'same', to: 'missing' }] }), /unique/);
  assert.throws(() => buildDiagram({ title: 'Bad', nodes: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }], edges: [{ from: 'one', to: 'missing' }] }), /existing node IDs/);
  assert.throws(() => buildDiagram({ title: 'Bad', nodes: [{ id: 'one', label: 'One' }], edges: [{ from: 'one', to: 'one' }] }), /2–30 nodes/);
});
