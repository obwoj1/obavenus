const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createUSAJobsStore, createUSAJobsClient, getOrganizationCodes, cleanAnnouncement } = require('../electron/usajobs.cjs');

const codeValues = [
  { Code: 'SB', Value: 'Small Business Administration', Acronym: 'SBA', IsDisabled: 'No' },
  { Code: 'DN', Value: 'Department of Energy', Acronym: 'DOE', IsDisabled: 'No' },
  { Code: 'TR', Value: 'Department of the Treasury', IsDisabled: 'No' },
  { Code: 'SBJF', Value: 'Small Business Administration Hiring Fair', IsDisabled: 'No' },
  { Code: 'SBXX', Value: 'Small Business Administration Old', IsDisabled: 'Yes' },
];

test('resolves active USAJOBS agency codes without hiring fairs or disabled entries', () => {
  assert.deepEqual(getOrganizationCodes('SBA (Small Business Administration)', codeValues), ['SB']);
  assert.deepEqual(getOrganizationCodes('DOE (Dept of Energy OCIO)', codeValues), ['DN']);
  assert.deepEqual(getOrganizationCodes('US Treasury', codeValues), ['TR']);
});

test('USAJOBS credentials are encrypted at rest and never returned in status', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'obavenus-usajobs-'));
  const filePath = path.join(directory, 'credentials.json');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
  };
  try {
    const store = createUSAJobsStore({ filePath, safeStorage });
    await store.save({ email: 'jobs@example.com', apiKey: 'secret-key' });
    const disk = await readFile(filePath, 'utf8');
    assert.equal(disk.includes('secret-key'), false);
    assert.deepEqual(await store.status(), { email: 'jobs@example.com', configured: true });
    assert.deepEqual(await store.credentials(), { email: 'jobs@example.com', apiKey: 'secret-key' });
    await store.clear();
    assert.deepEqual(await store.status(), { email: '', configured: false });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('live search filters full-time, location, public announcements, and deduplicates across agencies', async () => {
  const requests = [];
  const store = { credentials: async () => ({ email: 'jobs@example.com', apiKey: 'secret' }) };
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), headers: options.headers });
    if (String(url).includes('codelist')) return { ok: true, json: async () => ({ CodeList: [{ id: 'AgencySubElement', ValidValue: codeValues }] }) };
    return { ok: true, json: async () => ({ SearchResult: { SearchResultCountAll: 1, SearchResultItems: [{ MatchedObjectId: '100', MatchedObjectDescriptor: { PositionTitle: 'Software Engineer', OrganizationName: 'Test Agency', PositionURI: 'https://www.usajobs.gov/job/100', PositionLocationDisplay: 'Washington, DC', PositionSchedule: [{ Name: 'Full-time' }], ApplicationCloseDate: '2026-12-01', UserArea: { Details: { Requirements: 'Experience with software.' } } } }] } }) };
  };
  const client = createUSAJobsClient({ store, fetchImpl });
  const result = await client.search({ targets: [
    { title: 'Software Engineer', employer: 'Small Business Administration' },
    { title: 'Software Engineer', employer: 'Department of Energy' },
    { title: 'Software Engineer', employer: 'Department of Treasury' },
  ], location: 'Washington, DC', fullTime: true, minimumSalary: 140000 });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].matchedAgencies.length, 3);
  const searches = requests.filter((request) => request.url.pathname.endsWith('/search'));
  assert.equal(searches.length, 4);
  for (const request of searches) {
    assert.equal(request.url.searchParams.get('PositionScheduleTypeCode'), '1');
    assert.equal(request.url.searchParams.get('LocationName'), 'Washington, DC');
    assert.equal(request.url.searchParams.get('WhoMayApply'), 'Public');
    assert.equal(request.url.searchParams.get('RemunerationMinimumAmount'), '140000');
    assert.equal(request.headers['Authorization-Key'], 'secret');
  }
});

test('announcement normalization returns application guidance and official links as bounded fields', () => {
  const job = cleanAnnouncement({ MatchedObjectId: '42', MatchedObjectDescriptor: {
    PositionTitle: 'Developer', ApplyURI: ['https://www.usajobs.gov/apply/42'],
    UserArea: { Details: { RequiredDocuments: 'Resume', HowToApply: 'Apply online' } },
  } });
  assert.equal(job.id, '42');
  assert.equal(job.applyUrl, 'https://www.usajobs.gov/apply/42');
  assert.equal(job.requiredDocuments, 'Resume');
  assert.equal(job.howToApply, 'Apply online');
});

test('a failed agency query returns other agency matches with a visible warning', async () => {
  const store = { credentials: async () => ({ email: 'jobs@example.com', apiKey: 'secret' }) };
  const fetchImpl = async (url) => {
    if (String(url).includes('codelist')) return { ok: true, json: async () => ({ CodeList: [{ id: 'AgencySubElement', ValidValue: codeValues }] }) };
    if (new URL(url).searchParams.get('Organization') === 'DN') return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, json: async () => ({ SearchResult: { SearchResultCountAll: 1, SearchResultItems: [{ MatchedObjectId: '99', MatchedObjectDescriptor: { PositionTitle: 'Software Developer' } }] } }) };
  };
  const client = createUSAJobsClient({ store, fetchImpl });
  const result = await client.search({ targets: [
    { title: 'Software Engineer', employer: 'Small Business Administration' },
    { title: 'Software Engineer', employer: 'Department of Energy' },
  ], location: 'Washington, DC' });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /503/);
});
