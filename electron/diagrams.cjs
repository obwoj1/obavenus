const MAX_NODES = 30;
const MAX_EDGES = 60;

function xml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function wrapLabel(value, width = 28, lines = 3) {
  const words = value.trim().split(/\s+/).flatMap((word) => {
    const characters = Array.from(word);
    const pieces = [];
    while (characters.length > width) pieces.push(characters.splice(0, width).join(''));
    if (characters.length) pieces.push(characters.join(''));
    return pieces;
  });
  const output = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { output.push(line); line = word; }
  }
  if (line) output.push(line);
  const bounded = output.slice(0, lines);
  if (output.length > lines) bounded[lines - 1] = `${bounded[lines - 1].slice(0, width - 1)}…`;
  return bounded;
}

function buildDiagram({ title, nodes, edges }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 160) throw new TypeError('Diagram title must contain 1–160 characters.');
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > MAX_NODES) throw new RangeError(`A diagram needs 2–${MAX_NODES} nodes.`);
  if (!Array.isArray(edges) || edges.length < 1 || edges.length > MAX_EDGES) throw new RangeError(`A diagram needs 1–${MAX_EDGES} connections.`);
  const ids = new Set();
  const normalizedNodes = nodes.map((node) => {
    if (!node || typeof node.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(node.id) || ids.has(node.id)) throw new TypeError('Diagram node IDs must be unique and use letters, numbers, underscores, or hyphens.');
    if (typeof node.label !== 'string' || !node.label.trim() || node.label.length > 120) throw new TypeError('Each diagram node label must contain 1–120 characters.');
    ids.add(node.id);
    return { id: node.id, label: node.label.trim() };
  });
  const normalizedEdges = edges.map((edge) => {
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string' || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) throw new TypeError('Each diagram connection must link two different existing node IDs.');
    if (edge.label !== undefined && (typeof edge.label !== 'string' || edge.label.length > 80)) throw new TypeError('Connection labels must be at most 80 characters.');
    return { from: edge.from, to: edge.to, label: edge.label?.trim() || '' };
  });

  const box = { width: 248, height: 86, gapX: 72, gapY: 72, left: 52, top: 112 };
  const columns = 3;
  const rows = Math.ceil(normalizedNodes.length / columns);
  const width = box.left * 2 + columns * box.width + (columns - 1) * box.gapX;
  const height = box.top + rows * box.height + (rows - 1) * box.gapY + 50;
  const positions = new Map(normalizedNodes.map((node, index) => [node.id, {
    x: box.left + (index % columns) * (box.width + box.gapX),
    y: box.top + Math.floor(index / columns) * (box.height + box.gapY),
  }]));
  const paths = normalizedEdges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const sx = from.x + box.width / 2;
    const sy = from.y + box.height / 2;
    const tx = to.x + box.width / 2;
    const ty = to.y + box.height / 2;
    let startX = sx; let startY = sy; let endX = tx; let endY = ty; let control1X; let control1Y; let control2X; let control2Y;
    if (Math.abs(tx - sx) >= Math.abs(ty - sy)) {
      const direction = tx >= sx ? 1 : -1;
      startX = from.x + (direction > 0 ? box.width : 0);
      endX = to.x + (direction > 0 ? 0 : box.width);
      const bend = Math.max(36, Math.abs(endX - startX) * 0.35);
      control1X = startX + direction * bend; control1Y = startY;
      control2X = endX - direction * bend; control2Y = endY;
    } else {
      const direction = ty >= sy ? 1 : -1;
      startY = from.y + (direction > 0 ? box.height : 0);
      endY = to.y + (direction > 0 ? 0 : box.height);
      const bend = Math.max(36, Math.abs(endY - startY) * 0.35);
      control1X = startX; control1Y = startY + direction * bend;
      control2X = endX; control2Y = endY - direction * bend;
    }
    const label = edge.label ? `<text class="edge-label" x="${(startX + endX) / 2}" y="${(startY + endY) / 2 - 8}" text-anchor="middle">${xml(edge.label)}</text>` : '';
    return `<path class="edge" d="M ${startX} ${startY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${endX} ${endY}" marker-end="url(#arrow)"/>${label}`;
  }).join('');
  const cards = normalizedNodes.map((node, index) => {
    const { x, y } = positions.get(node.id);
    const color = index % 2 ? '#e8f0e7' : '#eff4ec';
    const lines = wrapLabel(node.label).map((line, lineIndex, all) => `<tspan x="${x + box.width / 2}" dy="${lineIndex === 0 ? `${-(all.length - 1) * 9}px` : '18px'}">${xml(line)}</tspan>`).join('');
    return `<g><rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" rx="18" fill="${color}" stroke="#8fa890" stroke-width="1.5"/><text class="node-id" x="${x + 18}" y="${y + 24}">${xml(node.id)}</text><text class="node-label" x="${x + box.width / 2}" y="${y + 52}" text-anchor="middle">${lines}</text></g>`;
  }).join('');
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title)}"><title>${xml(title)}</title><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#78927a"/></marker></defs><rect width="100%" height="100%" rx="24" fill="#fbfcf9"/><text class="title" x="52" y="58">${xml(title)}</text><style>.title{font:600 26px -apple-system,BlinkMacSystemFont,sans-serif;fill:#2d4233}.node-id{font:600 11px -apple-system,BlinkMacSystemFont,sans-serif;fill:#648068}.node-label{font:500 15px -apple-system,BlinkMacSystemFont,sans-serif;fill:#2e4134}.edge{fill:none;stroke:#78927a;stroke-width:2}.edge-label{font:12px -apple-system,BlinkMacSystemFont,sans-serif;fill:#516b57}</style>${paths}${cards}</svg>\n`, 'utf8');
}

module.exports = { buildDiagram, MAX_NODES, MAX_EDGES };
