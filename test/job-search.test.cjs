const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJobTargets, createSearchPlan } = require('../electron/job-search.cjs');

const offers = `Role/Job Title: Software Engineer
Company: SBA (Small Business Administration)
Location: Washington, DC
Base Salary: 172K

Role/Job Title: Software Engineer
Company: DOE (Dept of Energy OCIO)
Location: Washington, DC
Base Salary: 143K

Role/Job Title: Software Engineer
Company: US Treasury
Location: Washington, DC
Base Salary: 153K`;

test('extracts repeated offer blocks into one target per agency', () => {
  assert.deepEqual(parseJobTargets(offers), [
    { title: 'Software Engineer', employer: 'SBA (Small Business Administration)', location: 'Washington, DC' },
    { title: 'Software Engineer', employer: 'DOE (Dept of Energy OCIO)', location: 'Washington, DC' },
    { title: 'Software Engineer', employer: 'US Treasury', location: 'Washington, DC' },
  ]);
});

test('builds official USAJOBS links for each target and related federal roles', () => {
  const plan = createSearchPlan(offers);
  assert.equal(plan.searches.length, 4);
  for (const search of plan.searches) {
    const url = new URL(search.url);
    assert.equal(url.origin, 'https://www.usajobs.gov');
    assert.equal(url.pathname, '/Search/Results');
    assert.equal(url.searchParams.get('l'), 'Washington, DC');
    assert.ok(url.searchParams.get('k'));
  }
  assert.match(plan.searches[0].url, /SBA/);
  assert.match(plan.searches[1].url, /DOE/);
});

test('rejects oversized text and supports a simple title without offer blocks', () => {
  assert.throws(() => parseJobTargets('x'.repeat(50_001)), /50,000/);
  assert.deepEqual(parseJobTargets('Find a software engineer in DC'), [{ title: 'software engineer', employer: '', location: 'Washington, DC' }]);
});
