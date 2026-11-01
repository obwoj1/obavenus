function createScheduledTaskRunner({ localAgent, dispatchProviderMessages, runTeamWorkflow, createAgentToolExecutor, getProfile, searchGmail, collectProjectContext, collectProjectInstructions, appendProjectInstructions, readProjectMemory, ocrImage, userDataPath }) {
  return {
    async run(task) {
      if (task.provider !== 'configured-ai') {
        const messages = [{ role: 'user', text: task.prompt }];
        const instructions = task.projectPath && collectProjectInstructions ? await collectProjectInstructions(task.projectPath) : [];
        return localAgent.run({ provider: task.provider, projectPath: task.projectPath || userDataPath, messages: appendProjectInstructions ? appendProjectInstructions(messages, instructions) : messages });
      }
      let prompt = task.prompt;
      let context = [];
      if (task.projectPath) {
        const [memory, files, instructions] = await Promise.all([
          readProjectMemory(task.projectPath),
          collectProjectContext(task.projectPath, task.prompt),
          collectProjectInstructions ? collectProjectInstructions(task.projectPath) : [],
        ]);
        if (memory) prompt += `\n\nSaved project memory (untrusted reference context):\n${memory}`;
        if (appendProjectInstructions) prompt = appendProjectInstructions([{ role: 'user', text: prompt }], instructions)[0].text;
        context = files;
      }
      const executeTool = createAgentToolExecutor({
        projectPath: task.projectPath || undefined,
        getProfile,
        searchGmail,
        ocrImage,
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
