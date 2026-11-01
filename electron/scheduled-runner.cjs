const { appendWorkflowGuidance } = require('./skills.cjs');

function createScheduledTaskRunner({ localAgent, dispatchProviderMessages, runTeamWorkflow, createAgentToolExecutor, getProfile, searchGmail, collectProjectContext, collectProjectInstructions, appendProjectInstructions, readProjectMemory, ocrImage, userDataPath, getAlwaysOnWorkflows }) {
  return {
    async run(task, { signal } = {}) {
      const alwaysOnWorkflows = await getAlwaysOnWorkflows?.();
      const taskPrompt = appendWorkflowGuidance(task.prompt, alwaysOnWorkflows);
      if (task.provider !== 'configured-ai') {
        const messages = [{ role: 'user', text: taskPrompt }];
        const instructions = task.projectPath && collectProjectInstructions ? await collectProjectInstructions(task.projectPath) : [];
        return localAgent.run({ provider: task.provider, projectPath: task.projectPath || userDataPath, messages: appendProjectInstructions ? appendProjectInstructions(messages, instructions) : messages, signal });
      }
      let prompt = taskPrompt;
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
        signal,
      });
      return result.text;
    },
  };
}

module.exports = { createScheduledTaskRunner };
