function isObavenusOpenUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'obavenus:' && url.hostname === 'open' && url.pathname === '';
  } catch {
    return false;
  }
}

module.exports = { isObavenusOpenUrl };
