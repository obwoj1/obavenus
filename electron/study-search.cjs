const STOP = new Set('a an and are as at be by can do for from has how i in is it of on or the this to was were what when where which with'.split(' '));

function sections(content) {
  const matches = [...content.matchAll(/(?:^|\n)(Page|Slide)\s+(\d+)\s*\n/g)];
  if (!matches.length) return [{ reference: 'Document', text: content.slice(0, 120_000) }];
  return matches.slice(0, 400).map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    return { reference: `${match[1]} ${match[2]}`, text: content.slice(start, end).trim() };
  }).filter((section) => section.text);
}

function searchStudySources(data, query, courseId = '') {
  if (typeof query !== 'string' || query.length > 300) throw new TypeError('Study search must be 300 characters or fewer.');
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((term) => !STOP.has(term)))];
  if (!terms.length) return [];
  const courses = new Map(data.courses.map((course) => [course.id, course.name]));
  const results = [];
  for (const source of data.sources || []) {
    if (courseId && source.courseId !== courseId) continue;
    for (const section of sections(source.content)) {
      const lower = section.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const count = lower.split(term).length - 1;
        score += Math.min(count, 12) * (term.length > 5 ? 1.3 : 1);
        if (source.name.toLowerCase().includes(term)) score += 2;
      }
      if (!score) continue;
      const firstHit = Math.min(...terms.map((term) => { const at = lower.indexOf(term); return at < 0 ? Number.MAX_SAFE_INTEGER : at; }));
      const start = Math.max(0, firstHit - 180);
      const end = Math.min(section.text.length, start + 520);
      results.push({ sourceId: source.id, fileName: source.name, courseName: courses.get(source.courseId) || 'Personal study file', reference: section.reference, excerpt: `${start ? '…' : ''}${section.text.slice(start, end).trim()}${end < section.text.length ? '…' : ''}`, score });
    }
  }
  return results.sort((a, b) => b.score - a.score || a.fileName.localeCompare(b.fileName)).slice(0, 12);
}

module.exports = { searchStudySources };
