# Build log

- Read-only Git review: team agents can inspect the selected folder's branch/status, staged and unstaged diffs, and recent commits through fixed bounded commands, without getting shell or repository write tools.
- Project-guidance workflow: automatically load bounded root `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` for provider, team, scheduled, and local CLI runs; content stays project-scoped and labeled as untrusted.
- Composer layout: replaced the fragile wrapping action row with a responsive grid. Keyboard guidance now gets a full-width row, export/schedule/send stay aligned at desktop and compact widths, and phone layouts stack the send action cleanly.

## 2026-10-23 — Project start

- Created the local Git repository for `Obavenus` on branch `main`.
- Inspected `/Applications/Universe.app/Contents/Info.plist`: display name Universe, bundle ID `ai.universe.desktop`, version `0.4.82`; the bundle includes `Resources/app.asar` and an ARM64 Mach-O executable.
- Ran REA's Hopper overview on the executable. It reported five segments, nine procedures, and four string objects; this is only a shallow native overview.
- Tried REA's JavaScript application analyzer on `app.asar`. It stopped on a declared-versus-observed integrity mismatch for the unpacked `better-sqlite3` native module. REA offered record-and-continue mode, which began inventorying 5,935 files; stopped the broad scan after it proved too slow for this first pass.
- No files from the installed app were copied into this project. The product should be implemented independently.
- Created the first runnable-shell files: a sandboxed Electron window, a narrow preload bridge, and an original dark workspace/chat layout. Added local project-folder selection and a clearly labeled placeholder response; no model or project-file reads are connected yet.
- Set the product name to `Obavenus` in the package metadata, app window, renderer bridge, and UI.
- Added a narrow IPC operation for selecting a project folder, displaying up to 80 immediate entry names without reading file contents, prompt submission with a clear no-model placeholder, and local launch instructions.
- Created the private GitHub repository at https://github.com/obwoj1/obavenus and pushed the `main` branch.
- Added local restoration of the last selected project folder, plus a close action. The saved path stays in Electron's user-data directory; the UI still receives only the folder name and immediate entry names.
- Added a focused test for directory sorting, the 80-entry cap, and keeping the absolute path out of the renderer summary.
- Added explicit top-level text-file preview: only regular files under 64 KB can be opened, and the content remains local and is never sent to a service.
- Added tests for safe file previews, traversal rejection, and the size limit.
- Added local conversation history with a new-chat action and recent-conversation navigation. Conversation prompts and placeholder replies persist in the app's local browser storage; the history is not synced.
- Added OpenAI Responses API support with GPT-5.5 as the default model, encrypted API-key storage through Electron safeStorage, a settings dialog, bounded conversation input, explicit send behavior, and `store: false` requests. The renderer never receives the saved key.
- Added tests for encrypted provider settings, response parsing, stateless requests, and input validation.
- Added opt-in project file attachments from the local preview panel. Users see attached-file chips before sending; the provider caps context size and instructs the model to treat file content as untrusted data.
- Added reproducible Apple Silicon macOS packaging scripts for an app bundle and DMG. The app uses its own bundle ID and product name; signing is intentionally disabled for local builds.
- Added separate encrypted API-key slots and request adapters for OpenAI, Anthropic Claude, and xAI Grok, plus a provider selector in Settings.
- Refreshed the interface with a sage-green and white color palette.
- Added Gmail OAuth with PKCE, loopback callback, encrypted local tokens, read-only search, and explicit attach-to-chat for snippets.
- Updated the Grok default model to the current xAI API model ID.
- Added OpenAI Sign in with ChatGPT through the official local SDK, with OS-backed credential encryption, account-specific model discovery, connection controls, and API-key fallback.
- Kept the ChatGPT provider eligibility and token-sharing limitations visible in setup and settings; Claude and Grok remain API-key based.
- Added Google OAuth for Gemini API access, with PKCE, encrypted credential storage, Cloud project billing attribution, and an API-key option. Google AI subscriptions are not used for API requests.
- Updated product documentation to describe the current app rather than the first prototype.

- Added an API-key-free local CLI route for Claude Code, Codex CLI, and Gemini CLI, using provider read-only/default modes, explicit attachments, and bounded runtime/output with focused tests.
- Added six bundled reusable workflows to the composer, available with both provider and local CLI requests without adding an API dependency.
- Added an encrypted, persistent local scheduled-task queue for the signed-in CLIs, with cancelable queued jobs, completion notifications, and overdue-task pickup on app launch.
- Confirmed Claude Code, Codex CLI, and Gemini CLI are installed on the development Mac; the installed Grok CLI requires an xAI API key, so it remains deferred with other API setup.
- Bumped the app to 0.1.9 for the next local macOS installer.

## Next

- 0.1.73: The composer can select up to three saved workflows at once and remembers the selection locally. Their instructions travel with the task for provider, CLI, remote, and team runs; every team agent receives the shared workflow context.
- 0.1.72: Scheduled local tasks can repeat daily or on weekdays at a chosen local time. Each occurrence retains bounded retries, missed runs resume when Obavenus is available, and recurring schedules remain cancellable.
- 0.1.71: Added per-conversation rename and delete actions to Recent Work. Deletion is confirmed, active responses are protected, and changes persist in encrypted local history.
- 0.1.70: Added an opt-in, bearer-authenticated localhost MCP server for read-only Study course, assignment, file-search, resource, and flashcard access. The token is encrypted with OS-backed storage, the service binds to loopback, and assignment drafts and submission actions are excluded.
- 0.1.69: Assignment workspaces can import bounded reference files into OS-encrypted local storage and include extracted text in the editable assistant prompt; users can remove files, and Canvas sync preserves attachment references.
- 0.1.68: Added a one-click assignment review checklist seeded from explicit requirements and rubric text, with editable student checks and final pre-submission review.
- 0.1.67: Assignment scans now show explicitly detected rubric criteria and named skills, plus locally generated clarification questions for student review.
- 0.1.66: Added an opt-in daily Study digest scheduler that creates one Gmail draft while Obavenus is running, respects quiet hours, stores schedule state encrypted, and never sends messages.
- 0.1.65: Assignment drafts are editable and encrypted with Study data, can be saved from an assistant response, export to Word, and survive Canvas refresh.
- 0.1.64: Study digests can be saved as Gmail drafts; the integration creates drafts only and never sends mail. Gmail OAuth now requests draft permission in addition to message metadata access.

- Added explicit local project-edit modes for the provider CLIs with provider-specific sandbox and permission flags; edits require a selected folder and scheduled work remains read-only.

- Test Sign in with ChatGPT against an eligible account and confirm whether OpenAI accepts the private app client.
- Verify the Gemini OAuth consent setup and a first request against a user-configured Google Cloud project.
- Add streaming responses and cancellation for long-running model requests.
