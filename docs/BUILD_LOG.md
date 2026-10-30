# Build log

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
- Confirmed Claude Code, Codex CLI, and Gemini CLI are installed on the development Mac; the installed Grok CLI requires an xAI API key, so it remains deferred with other API setup.
- Bumped the app to 0.1.7 for the next local macOS installer.

## Next

- Test Sign in with ChatGPT against an eligible account and confirm whether OpenAI accepts the private app client.
- Verify the Gemini OAuth consent setup and a first request against a user-configured Google Cloud project.
- Add streaming responses and cancellation for long-running model requests.
