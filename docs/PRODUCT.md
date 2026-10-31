# Obavenus

Obavenus is an original Electron desktop app inspired by the broad product category of Universe. The implementation will use its own code, visual language, copy, and assets.

## Product direction

Start with a macOS desktop assistant that combines AI chat with a project workspace. Keep the first version small enough to run locally, then add capabilities in independently reviewable steps.

## Design boundaries

- Treat REA output as technical evidence about the installed app, not as source code to copy.
- Do not reuse Universe source, assets, copy, secrets, or private service endpoints.
- Build new UI and behavior from the product goal and user feedback.
- Keep local file and process access explicit and narrow.

## Current implementation

The current app combines AI chat, local project spaces, and optional Gmail search. Each selected folder is a local space; conversations are associated with the active space and reopen its folder when selected. Spaces and conversation history do not sync or collaborate across accounts. Conversations can be exported as Markdown, including attached reference context, specialist findings, and project artifact change notes. OpenAI can connect through Sign in with ChatGPT or an API key; Gemini supports Google OAuth for the Gemini API using a user-selected Cloud project; Claude and Grok currently use API keys in the provider settings. Claude Code, Codex CLI, and Gemini CLI can also run through the user's existing local CLI installation and sign-in without a new Obavenus API key. Ollama runs open models locally through its loopback-only API. Project files stay local until explicitly attached to a message. Gmail access is read-only, and snippets are shared only when the user attaches them and sends a message.

The Federal Role Finder parses pasted job and offer blocks into titles, agencies, and locations. It always offers official USAJOBS search links; with a user-provided USAJOBS API key it also aggregates open agency-specific and federal IT-series announcements in-app, filters by location/full-time/minimum salary, deduplicates records, and shows available salary, closing date, requirements, required documents, and application steps. Credentials are encrypted locally. Application submission and definitive eligibility decisions remain on USAJOBS and with the applicant.

Team runs include a read-only mode and an explicit per-run project-write mode, and local CLI agents now have provider-specific edit modes that require an open project. Codex uses its workspace-write sandbox; Claude disables Bash and web fetch while enabling accepted file edits; Gemini enables its auto-edit mode. Review changed files in Git after a run. Scheduled local jobs stay read-only.

Local CLI runs use the selected project working directory (or app data without a project), read-only/default CLI permission modes, a bounded timeout, and bounded output. This provides provider CLI account-backed responses without implementing the providers' interactive sign-in flows inside Obavenus.

The composer includes a bundled local workflow library for feature planning, codebase exploration, change review, debugging, technical documentation, and converting an idea into steps. The selected workflow adds focused instructions to that request only; it does not rewrite saved conversation history.

Users can queue a prompt for a later run with a local CLI or the configured AI provider. Provider-backed tasks use the current provider settings when they run and can use the read-only specialist team, project context, and Gmail search tools. Scheduled work cannot write project files or control the browser. Scheduled prompts and results are encrypted in the app's local data store, tasks can be cancelled before they start, and completion sends a desktop notification when supported. Failed runs retry twice; interrupted tasks recover on restart. Tasks run only while the app is available and overdue queued work is picked up at next launch; this is not a cloud scheduler.

The team can launch up to five user-selected custom specialists concurrently with its built-in analysis and review agents. Team browser research is opt-in per run and allows HTTP(S) navigation, page reading, following links, and button actions only after a native confirmation for each click. It runs in a sandboxed Obavenus BrowserWindow with its own persistent sign-in session, separate from Chrome; users can explicitly clear that session. Project-write mode can create bounded text artifacts including Markdown, CSV/TSV, HTML, and code, plus native `.xlsx`, `.docx`, and `.pptx` files inside the selected project.

Obavenus does not yet provide linked remote machines, cloud-synced shared spaces, or autonomous control of an existing Chrome profile. Project memory is encrypted on this Mac and scoped to the selected folder; saved notes are included in later team requests for that project. Saving requires the user to enable project-write mode for that run. It is not shared or synced.
