const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_STATUS_BYTES = 12 * 1024;
const MAX_DIFF_BYTES = 20 * 1024;
const MAX_HISTORY_BYTES = 12 * 1024;
const MAX_BUFFER_BYTES = 512 * 1024;

function gitEnvironment(source = process.env) {
  const env = { ...source, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']) delete env[key];
  return env;
}

async function runGit(projectPath, args, exec = execFileAsync) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) throw new TypeError('Choose an absolute project folder to inspect Git.');
  return exec('git', ['-C', projectPath, '-c', 'core.fsmonitor=false', ...args], {
    cwd: projectPath,
    env: gitEnvironment(),
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  });
}

function bounded(value, limit) {
  const bytes = Buffer.from(value || '', 'utf8');
  if (bytes.length <= limit) return { text: bytes.toString('utf8'), truncated: false };
  return { text: bytes.subarray(0, limit).toString('utf8'), truncated: true };
}

async function runBoundedGit(projectPath, args, limit) {
  try {
    const result = await runGit(projectPath, args);
    return bounded(result.stdout, limit);
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && typeof error.stdout === 'string') {
      return { ...bounded(error.stdout, limit), truncated: true };
    }
    throw error;
  }
}

async function getGitStatus(projectPath) {
  try {
    const status = await runBoundedGit(projectPath, ['status', '--short', '--branch', '--untracked-files=all', '--no-renames', '--', '.'], MAX_STATUS_BYTES);
    return { isRepository: true, status: status.text, truncated: status.truncated };
  } catch (error) {
    if (/not a git repository/i.test(`${error.stderr || ''} ${error.message || ''}`)) return { isRepository: false, status: 'The selected project is not a Git repository.' };
    if (error.code === 'ETIMEDOUT') return { error: 'Git status exceeded its 5 second limit.' };
    throw new Error(`Could not read Git status: ${(error.stderr || error.message || 'Git failed').trim().slice(0, 500)}`);
  }
}

async function getGitDiff(projectPath) {
  try {
    const [staged, unstaged] = await Promise.all([
      runBoundedGit(projectPath, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', '--', '.'], MAX_DIFF_BYTES),
      runBoundedGit(projectPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', '--', '.'], MAX_DIFF_BYTES),
    ]);
    return {
      isRepository: true,
      stagedDiff: staged.text,
      unstagedDiff: unstaged.text,
      truncated: staged.truncated || unstaged.truncated,
      note: 'Untracked file contents are not included; use the project file reader for those paths.',
    };
  } catch (error) {
    if (/not a git repository/i.test(`${error.stderr || ''} ${error.message || ''}`)) return { isRepository: false, stagedDiff: '', unstagedDiff: '' };
    if (error.code === 'ETIMEDOUT') return { error: 'Git diff exceeded its 5 second limit.' };
    throw new Error(`Could not read Git diff: ${(error.stderr || error.message || 'Git failed').trim().slice(0, 500)}`);
  }
}

async function getGitHistory(projectPath) {
  try {
    const history = await runBoundedGit(projectPath, ['log', '-12', '--date=short', '--format=%h %ad %s', '--', '.'], MAX_HISTORY_BYTES);
    return { isRepository: true, commits: history.text, truncated: history.truncated };
  } catch (error) {
    if (/not a git repository/i.test(`${error.stderr || ''} ${error.message || ''}`)) return { isRepository: false, commits: '' };
    if (error.code === 'ETIMEDOUT') return { error: 'Git history exceeded its 5 second limit.' };
    throw new Error(`Could not read Git history: ${(error.stderr || error.message || 'Git failed').trim().slice(0, 500)}`);
  }
}

module.exports = { getGitStatus, getGitDiff, getGitHistory, MAX_STATUS_BYTES, MAX_DIFF_BYTES, MAX_HISTORY_BYTES };
