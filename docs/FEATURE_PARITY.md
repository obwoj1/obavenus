# Universe feature parity audit

This audit uses Universe's public product overview as the comparison source: [universe.works](https://universe.works/), checked 2026-11-01. It tracks user-visible workflow coverage, not internal implementation similarity. Obavenus remains an independent product.

| Workflow | Obavenus evidence | Status |
| --- | --- | --- |
| Work in a user-selected local folder; keep generated files on the Mac | Project-scoped read/write tools, bounded Office artifact generation/editing, undo, and local project memory in `electron/project.cjs`, `electron/agent-tools.cjs`, and `electron/project-memory.cjs` | Implemented locally |
| Use existing AI subscriptions and local models | ChatGPT, Claude Code, Codex CLI, Gemini CLI, Grok Build, and Ollama adapters in `electron/provider.cjs`, `electron/local-agent.cjs`, and provider modules | Implemented, with provider-specific account/API limits |
| Research with a real signed-in browser | Isolated Research Browser and paired Chrome bridge; both support local OCR of bounded screenshots, and Chrome can enumerate ordinary tabs, switch by unique exact URL, read pages, and perform approved actions | Partial: DOM text and OCR are supported; visual screenshot reasoning and broad browser coverage remain limited |
| Delegate to multiple specialists and recover from a failed specialist | Parallel team workflow, profile selection, lead replanning, retry, and synthesis in `electron/orchestrator.cjs` | Implemented locally |
| Reusable skills that shape later runs | Bundled and user-authored workflows can be selected per request or set always-on; custom specialist profiles are also supported | Implemented as instruction workflows; arbitrary executable skill packages are not supported |
| Produce finished work as local files | Text/code, SVG diagrams, native XLSX/DOCX/PPTX generation; XLSX cell updates and unique text edits are undoable | Implemented for these formats; rich Office layout editing and render-based verification remain limited |
| Schedule long-running work and continue after closing the app | Local schedules retry and recover when Obavenus next starts; SSH tasks can be detached or queued on a remote host | Partial: local jobs require the app to run; unattended persistence depends on an available remote machine |
| Connect workspaces with other people and agents | Local spaces, encrypted conversations, project memory, and multi-agent runs exist | Missing: shared cloud spaces, member access, channels, and synchronized collaboration |
| Work directly with mail, calendar, Drive, and other apps | Gmail metadata search and draft creation; Canvas course sync; user-configured read-only MCP tools/resources; paired Chrome for other signed-in sites | Partial: Google Calendar and Drive do not have dedicated connectors; MCP access is read-only and depends on the user's server |
| Keep consequential actions under human control | Per-run project-write mode, undo, paired-Chrome native approvals, Gmail draft-only behavior, and no Canvas submission tool | Implemented for the supported actions |

## Remaining parity work

The largest gaps are shared multi-user spaces/channels, broader app integrations and MCP write actions with explicit approval, unattended local jobs after app exit, visual browser interaction, and deeper Office edit/render verification. Shared spaces and direct third-party app connectors need deliberate account/backend and permission design; they are not supplied by the current single-user local architecture. The local workflow gaps should continue to be closed before expanding those service integrations.
