const { mkdir, readFile, writeFile, unlink } = require('node:fs/promises');
const path = require('node:path');

const MAX_RESUME_CHARS = 50_000;

function validateUrl(value, host) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 300) throw new TypeError(`Enter a valid ${host} profile URL.`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`Enter a valid ${host} profile URL.`); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== host || url.username || url.password) throw new TypeError(`Use an https://${host}/ profile URL.`);
  return url.toString();
}

function createProfileStore({ filePath, safeStorage }) {
  return {
    async get() {
      try {
        const encrypted = await readFile(filePath);
        const profile = JSON.parse(safeStorage.decryptString(encrypted));
        return { name: profile.name || '', resumeText: profile.resumeText || '', linkedinUrl: profile.linkedinUrl || '', linkedinText: profile.linkedinText || '', githubUrl: profile.githubUrl || '', shareWithAI: profile.shareWithAI === true, completed: profile.completed === true };
      } catch (error) {
        if (error.code === 'ENOENT') return { name: '', resumeText: '', linkedinUrl: '', githubUrl: '', shareWithAI: false, completed: false };
        throw error;
      }
    },
    async save(input = {}) {
      const name = input.name === undefined ? '' : input.name;
      const resumeText = input.resumeText === undefined ? '' : input.resumeText;
      if (typeof name !== 'string' || name.length > 100) throw new TypeError('Name must be 100 characters or fewer.');
      if (typeof resumeText !== 'string' || resumeText.length > MAX_RESUME_CHARS) throw new RangeError('Resume text must be 50,000 characters or fewer.');
      const linkedinText = input.linkedinText === undefined ? '' : input.linkedinText;
      if (typeof linkedinText !== 'string' || linkedinText.length > 25_000) throw new RangeError('LinkedIn profile text must be 25,000 characters or fewer.');
      const profile = {
        name: name.trim(),
        resumeText: resumeText.trim(),
        linkedinUrl: validateUrl(input.linkedinUrl, 'www.linkedin.com'),
        linkedinText: linkedinText.trim(),
        githubUrl: validateUrl(input.githubUrl, 'github.com'),
        shareWithAI: input.shareWithAI === true,
        completed: true,
      };
      if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS secure storage is unavailable. Your profile was not saved.');
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, safeStorage.encryptString(JSON.stringify(profile)), { mode: 0o600 });
      return { ...profile };
    },
    async clear() {
      await unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      return true;
    },
  };
}

module.exports = { createProfileStore, MAX_RESUME_CHARS };
