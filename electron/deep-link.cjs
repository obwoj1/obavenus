function parseObavenusOpenUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'obavenus:' || url.hostname !== 'open' || url.pathname !== '') return null;
    const allowed = new Set(['source', 'prompt']);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) return null;
    const source = url.searchParams.get('source');
    const prompt = url.searchParams.get('prompt');
    if (source && source !== 'nexus') return null;
    if (prompt !== null && (!source || !prompt.trim() || prompt.length > 2000)) return null;
    return prompt ? { prompt: prompt.trim() } : { prompt: null };
  } catch {
    return null;
  }
}

function isObavenusOpenUrl(rawUrl) { return parseObavenusOpenUrl(rawUrl) !== null; }

module.exports = { isObavenusOpenUrl, parseObavenusOpenUrl };
