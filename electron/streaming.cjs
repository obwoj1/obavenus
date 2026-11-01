const MAX_FRAME_CHARACTERS = 2_000_000;

async function consumeSse(response, onEvent, signal) {
  if (!response?.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw new Error('The provider did not return a readable event stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  async function dispatchFrame(frame) {
    let event = 'message';
    const data = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? '' : line.slice(separator + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) await onEvent(event, data.join('\n'));
  }
  for await (const chunk of response.body) {
    signal?.throwIfAborted();
    buffer += (typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    if (buffer.length > MAX_FRAME_CHARACTERS && !buffer.includes('\n\n')) throw new RangeError('A provider event exceeded the stream safety limit.');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      if (boundary > MAX_FRAME_CHARACTERS) throw new RangeError('A provider event exceeded the stream safety limit.');
      await dispatchFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await dispatchFrame(buffer);
  signal?.throwIfAborted();
}

async function consumeNdjson(response, onItem, signal) {
  if (!response?.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw new Error('The local model did not return a readable stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  async function dispatchLine(line) {
    if (!line.trim()) return;
    if (line.length > MAX_FRAME_CHARACTERS) throw new RangeError('A local-model response exceeded the stream safety limit.');
    await onItem(JSON.parse(line));
  }
  for await (const chunk of response.body) {
    signal?.throwIfAborted();
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      await dispatchLine(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_FRAME_CHARACTERS) throw new RangeError('A local-model response exceeded the stream safety limit.');
  }
  buffer += decoder.decode();
  if (buffer.trim()) await dispatchLine(buffer.replace(/\r$/, ''));
  signal?.throwIfAborted();
}

module.exports = { consumeSse, consumeNdjson, MAX_FRAME_CHARACTERS };
