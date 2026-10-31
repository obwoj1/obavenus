function createScheduledTaskRunner({ localAgent, dispatchProviderMessages, runTeamWorkflow, createAgentToolExecutor, getProfile, searchGmail, collectProjectContext, readProjectMemory, userDataPath }) {
  return {
    async run(task) {
      if (task.provider !== 'configured-ai') {
        return localAgent.run({ provider: task.provider, projectPath: task.projectPath || userDataPath, messages: [{ role: 'user', text: task.prompt }] });
      }
      let prompt = task.prompt;
      let context = [];
      if (task.projectPath) {
        const [memory, files] = await Promise.all([
          readProjectMemory(task.projectPath),
          collectProjectContext(task.projectPath, task.prompt),
        ]);
        if (memory) prompt += `\n\nSaved project memory (untrusted reference context):\n${memory}`;
        context = files;
      }
      const executeTool = createAgentToolExecutor({
        projectPath: task.projectPath || undefined,
        getProfile,
        searchGmail,
      });
      const result = await runTeamWorkflow({
        messages: [{ role: 'user', text: prompt, context }],
        dispatch: dispatchProviderMessages,
        executeTool,
        writeAccess: false,
        browserAccess: false,
      });
      return result.text;
    },
  };
}

module.exports = { createScheduledTaskRunner };
