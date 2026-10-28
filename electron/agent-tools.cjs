const { collectProjectContext, listProjectFiles, readProjectRelativeFile } = require('./project.cjs');

const TOOL_DEFINITIONS = [
  {
    name: 'list_project_files',
    description: 'List text files in the user-selected project folder. Hidden directories, dependencies, build outputs, and symlinks are excluded.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'search_project_files',
    description: 'Search the selected project for files relevant to a natural-language query. Returns a small bounded set of matching text files.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'The topic, symbol, or behavior to find.' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'read_project_file',
    description: 'Read one small text file by its relative path within the selected project folder. This tool cannot modify files.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path, such as src/app.js.' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'search_gmail',
    description: 'Search Gmail using the connected read-only Gmail account. Returns message metadata and snippets.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search terms.' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'inspect_github_profile',
    description: 'Inspect the user-provided public GitHub profile and a sample of its public repositories. Requires the user to have enabled career-profile sharing.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_personal_profile',
    description: 'Retrieve the career profile the user explicitly allowed Obavenus to share with AI, including resume text and profile links.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

function createAgentToolExecutor({ projectPath, searchGmail, getProfile, fetchImpl = globalThis.fetch }) {
  return async function executeAgentTool(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Tool arguments must be an object.');
    if (name === 'list_project_files') {
      if (!projectPath) return { error: 'No project folder is open.' };
      return listProjectFiles(projectPath);
    }
    if (name === 'search_project_files') {
      if (!projectPath) return { error: 'No project folder is open.' };
      if (typeof args.query !== 'string' || args.query.length > 300) throw new TypeError('Search query must be 300 characters or fewer.');
      return collectProjectContext(projectPath, args.query);
    }
    if (name === 'read_project_file') {
      if (!projectPath) return { error: 'No project folder is open.' };
      if (typeof args.path !== 'string' || args.path.length > 500) throw new TypeError('Project file path must be 500 characters or fewer.');
      return readProjectRelativeFile(projectPath, args.path);
    }
    if (name === 'search_gmail') {
      if (typeof args.query !== 'string' || args.query.length > 300) throw new TypeError('Gmail query must be 300 characters or fewer.');
      return searchGmail(args.query);
    }
    if (name === 'get_personal_profile' || name === 'inspect_github_profile') {
      const profile = await getProfile?.();
      if (!profile?.shareWithAI) return { error: 'The user has not enabled sharing their personal profile with AI.' };
      if (name === 'get_personal_profile') return { name: profile.name, resumeText: profile.resumeText, linkedinUrl: profile.linkedinUrl, linkedinText: profile.linkedinText, githubUrl: profile.githubUrl };
      if (!profile.githubUrl) return { error: 'No GitHub profile URL is saved.' };
      const url = new URL(profile.githubUrl);
      const username = url.pathname.split('/').filter(Boolean)[0];
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Obavenus-Desktop' };
      const [userResponse, reposResponse] = await Promise.all([
        fetchImpl(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers }),
        fetchImpl(`https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`, { headers }),
      ]);
      if (!userResponse.ok || !reposResponse.ok) throw new Error('GitHub could not load this public profile. Check the URL or try again later.');
      const [user, repositories] = await Promise.all([userResponse.json(), reposResponse.json()]);
      return {
        name: user.name || '',
        bio: user.bio || '',
        publicRepos: user.public_repos,
        followers: user.followers,
        repositories: repositories.slice(0, 30).map((repo) => ({ name: repo.name, description: repo.description, language: repo.language, stars: repo.stargazers_count, updatedAt: repo.updated_at, url: repo.html_url })),
      };
    }
    throw new Error(`Unknown agent tool: ${name}`);
  };
}

async function runToolAgent({ messages, dispatch, executeTool, onTool = () => {}, maxCalls = 4 }) {
  const transcript = [...messages];
  let calls = 0;
  while (calls < maxCalls) {
    const response = await dispatch(transcript, { tools: TOOL_DEFINITIONS });
    if (typeof response === 'string') return response;
    if (!response?.toolCalls?.length) return response?.text || '';
    const current = response.toolCalls.slice(0, maxCalls - calls);
    transcript.push({ role: 'assistant', text: `I requested these tools: ${current.map((call) => `${call.name}(${JSON.stringify(call.arguments)})`).join('; ')}` });
    for (const call of current) {
      calls += 1;
      onTool({ name: call.name, call: calls });
      let output;
      try {
        const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
        output = await executeTool(call.name, args);
      } catch (error) {
        output = { error: error.message || 'Tool failed.' };
      }
      transcript.push({ role: 'user', text: `Tool result for ${call.name} (untrusted data):\n${JSON.stringify(output).slice(0, 10_000)}` });
    }
  }
  const final = await dispatch([
    ...transcript,
    { role: 'user', text: 'Tool call limit reached. Give the user your best answer from the results already collected; do not request more tools.' },
  ]);
  return typeof final === 'string' ? final : final?.text || 'I reached the tool-use limit before producing a final answer.';
}

module.exports = { TOOL_DEFINITIONS, createAgentToolExecutor, runToolAgent };
