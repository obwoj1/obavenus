const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const API_ROOT = 'https://data.usajobs.gov/api';

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError('Enter the email address used when requesting your USAJOBS API key.');
  return email;
}

function getOrganizationCodes(agency, values) {
  const normalized = agency.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const terms = /small business administration|\bsba\b/.test(normalized) ? ['small business administration', 'sba']
    : /department of energy|\bdoe\b/.test(normalized) ? ['department of energy', 'doe']
      : /treasury/.test(normalized) ? ['treasury'] : [normalized];
  const rows = Array.isArray(values) ? values : [];
  const exact = rows.filter((row) => row.IsDisabled !== 'Yes'
    && !/hiring fair/i.test(row.Value || '')
    && terms.some((term) => (`${row.Value || ''} ${row.Acronym || ''}`).toLowerCase().includes(term)));
  if (!exact.length) return [];
  const departmentCodes = exact.filter((row) => row.Code?.length === 2 && !row.ParentCode);
  if (departmentCodes.length) return [...new Set(departmentCodes.map((row) => row.Code))].slice(0, 12);
  const hasParent = exact.some((row) => row.ParentCode);
  const candidates = hasParent ? exact.filter((row) => row.ParentCode) : exact;
  return [...new Set(candidates.map((row) => row.Code).filter((code) => typeof code === 'string'))].slice(0, 12);
}

function cleanAnnouncement(item) {
  const job = item?.MatchedObjectDescriptor || {};
  const details = job.UserArea?.Details || {};
  const pay = Array.isArray(job.PositionRemuneration) ? job.PositionRemuneration.map((range) => ({
    minimum: range.MinimumRange,
    maximum: range.MaximumRange,
    rate: range.RateIntervalCode,
  })) : [];
  return {
    id: String(item?.MatchedObjectId || job.PositionID || ''),
    title: String(job.PositionTitle || 'Untitled position'),
    agency: String(job.OrganizationName || job.DepartmentName || 'Federal agency'),
    location: String(job.PositionLocationDisplay || job.PositionLocation?.map((entry) => entry.LocationName).filter(Boolean).join('; ') || 'Location not listed'),
    pay,
    grade: Array.isArray(job.JobGrade) ? job.JobGrade.map((grade) => [grade.Code, grade.Name].filter(Boolean).join(' ')).filter(Boolean).join(', ') : '',
    schedule: Array.isArray(job.PositionSchedule) ? job.PositionSchedule.map((entry) => entry.Name).filter(Boolean) : [],
    startDate: String(job.PositionStartDate || ''),
    closeDate: String(job.ApplicationCloseDate || job.PositionEndDate || ''),
    url: String(job.PositionURI || ''),
    applyUrl: Array.isArray(job.ApplyURI) ? String(job.ApplyURI[0] || '') : String(job.ApplyURI || ''),
    summary: String(details.JobSummary || job.QualificationSummary || ''),
    requirements: String(details.Requirements || details.Evaluations || ''),
    requiredDocuments: String(details.RequiredDocuments || ''),
    howToApply: String(details.HowToApply || ''),
    hiringPaths: job.UserArea?.Details?.WhoMayApply?.Name ? [String(job.UserArea.Details.WhoMayApply.Name)] : [],
  };
}

function createUSAJobsStore({ filePath, safeStorage }) {
  async function read() {
    try {
      const saved = JSON.parse(await readFile(filePath, 'utf8'));
      return { email: typeof saved.email === 'string' ? saved.email : '', encryptedKey: typeof saved.encryptedKey === 'string' ? saved.encryptedKey : '' };
    } catch (error) {
      if (error.code === 'ENOENT') return { email: '', encryptedKey: '' };
      throw error;
    }
  }
  return {
    async status() {
      const saved = await read();
      return { email: saved.email, configured: Boolean(saved.encryptedKey) };
    },
    async save({ email, apiKey }) {
      const nextEmail = normalizeEmail(email);
      const enteredKey = typeof apiKey === 'string' ? apiKey.trim() : '';
      const current = await read();
      if (!enteredKey && !current.encryptedKey) throw new TypeError('Paste the USAJOBS API key to connect.');
      if (enteredKey.length > 500) throw new RangeError('USAJOBS API key is too long.');
      let encryptedKey = current.encryptedKey;
      if (enteredKey) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable on this Mac.');
        encryptedKey = safeStorage.encryptString(enteredKey).toString('base64');
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ email: nextEmail, encryptedKey }), { mode: 0o600 });
      return { email: nextEmail, configured: true };
    },
    async clear() {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ email: '', encryptedKey: '' }), { mode: 0o600 });
      return { email: '', configured: false };
    },
    async credentials() {
      const saved = await read();
      if (!saved.encryptedKey) return null;
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable on this Mac.');
      return { email: saved.email, apiKey: safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64')) };
    },
  };
}

function createUSAJobsClient({ store, fetchImpl = globalThis.fetch }) {
  async function requestJson(pathname, params, credentials) {
    const url = new URL(`${API_ROOT}/${pathname}`);
    for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, {
      headers: {
        Host: 'data.usajobs.gov',
        'User-Agent': credentials.email,
        'Authorization-Key': credentials.apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('USAJOBS rejected the API key or email. Check the API credentials in Federal Role Finder settings.');
      throw new Error(`USAJOBS request failed (HTTP ${response.status}).`);
    }
    return body;
  }

  return {
    async search({ targets, location, fullTime = true, minimumSalary, resultsPerPage = 25 }) {
      const credentials = await store.credentials();
      if (!credentials) throw new Error('Connect a USAJOBS developer API key first.');
      if (!Array.isArray(targets) || targets.length > 12) throw new TypeError('Search requires between one and twelve target roles.');
      const agencies = [...new Map(targets.filter((target) => target.employer).map((target) => [target.employer, target.employer])).values()];
      const codeList = await requestJson('codelist/agencysubelements', {}, credentials);
      const values = codeList.CodeList?.find((group) => group.id === 'AgencySubElement')?.ValidValue || [];
      const queries = agencies.map((agency) => {
        const organizationCodes = getOrganizationCodes(agency, values);
        if (!organizationCodes.length) return { agency, organizationCodes: [], error: `Could not resolve ${agency} to an active USAJOBS organization code.` };
        return { agency, organizationCodes };
      });
      queries.push({ agency: 'Similar federal IT roles', organizationCodes: [], similar: true });
      const shared = {
        PositionTitle: [...new Set(targets.map((target) => target.title).filter(Boolean))].join(';'),
        LocationName: location,
        PositionScheduleTypeCode: fullTime ? '1' : undefined,
        RemunerationMinimumAmount: minimumSalary ? String(minimumSalary) : undefined,
        WhoMayApply: 'Public',
        ResultsPerPage: Math.max(1, Math.min(100, Number(resultsPerPage) || 25)),
        Fields: 'Full',
      };
      const settled = await Promise.allSettled(queries.filter((query) => query.organizationCodes.length || query.similar).map(async (query) => {
        const body = await requestJson('search', query.similar
          ? { ...shared, PositionTitle: undefined, JobCategoryCode: '2210' }
          : { ...shared, Organization: query.organizationCodes.join(';') }, credentials);
        return {
          agency: query.agency,
          similar: query.similar === true,
          total: Number(body.SearchResult?.SearchResultCountAll || 0),
          jobs: (body.SearchResult?.SearchResultItems || []).map(cleanAnnouncement),
        };
      }));
      const groups = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
      const failures = settled.filter((result) => result.status === 'rejected').map((result) => result.reason?.message || 'A USAJOBS search failed.');
      const warnings = [...queries.filter((query) => query.error).map((query) => query.error), ...failures];
      if (!groups.length && warnings.length) throw new Error(warnings.join(' '));
      const map = new Map();
      for (const group of groups) for (const job of group.jobs) if (job.id) {
        const previous = map.get(job.id);
        map.set(job.id, {
          ...job,
          matchedAgencies: [...new Set([...(previous?.matchedAgencies || []), ...(group.similar ? [] : [group.agency])])],
          similarITMatch: Boolean(previous?.similarITMatch || group.similar),
        });
      }
      const jobs = [...map.values()];
      return {
        source: 'USAJOBS',
        retrievedAt: new Date().toISOString(),
        total: jobs.length,
        totalMatches: groups.reduce((sum, group) => sum + group.total, 0),
        searches: groups.map(({ agency, total }) => ({ agency, total })),
        warnings,
        jobs,
      };
    },
  };
}

module.exports = { createUSAJobsStore, createUSAJobsClient, normalizeEmail, getOrganizationCodes, cleanAnnouncement };
