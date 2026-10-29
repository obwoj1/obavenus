const USAJOBS_SEARCH = 'https://www.usajobs.gov/Search/Results';

function parseJobTargets(text) {
  if (typeof text !== 'string' || text.length > 50_000) throw new TypeError('Paste up to 50,000 characters of job or offer details.');
  const records = text.split(/(?=Role\s*\/\s*Job Title\s*:)/i).filter((part) => /Role\s*\/\s*Job Title\s*:/i.test(part));
  const targets = records.map((record) => {
    const value = (label) => record.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im'))?.[1]?.trim() || '';
    return { title: value('Role\\s*\\/\\s*Job Title') || 'Software Engineer', employer: value('Company'), location: value('Location') || 'Washington, DC' };
  }).filter((target) => target.employer || target.title);
  if (!targets.length) {
    const title = text.match(/(?:software engineer|software developer|IT specialist)/i)?.[0] || 'Software Engineer';
    const location = text.match(/Washington\s*,?\s*DC/i)?.[0] || 'Washington, DC';
    return [{ title, employer: '', location }];
  }
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.title}|${target.employer}|${target.location}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function createSearchPlan(text) {
  const targets = parseJobTargets(text);
  const location = targets[0].location;
  const searches = targets.map((target) => {
    const shortAgency = /small business administration|\bSBA\b/i.test(target.employer) ? 'SBA'
      : /department of energy|\bDOE\b/i.test(target.employer) ? 'DOE'
        : /treasury/i.test(target.employer) ? 'Treasury' : target.employer;
    const keyword = [target.title, shortAgency].filter(Boolean).join(' ');
    const url = new URL(USAJOBS_SEARCH);
    url.searchParams.set('k', keyword);
    url.searchParams.set('l', target.location);
    return { label: `${target.employer || 'Federal'} · ${target.title}`, keyword, location: target.location, url: url.toString() };
  });
  const related = new URL(USAJOBS_SEARCH);
  related.searchParams.set('k', 'software engineer');
  related.searchParams.set('l', location);
  searches.push({ label: 'Similar federal software and IT roles', keyword: 'software engineer', location, url: related.toString() });
  return { targets, searches, source: 'USAJOBS', generatedAt: new Date().toISOString() };
}

module.exports = { parseJobTargets, createSearchPlan };
