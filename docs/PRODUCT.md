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

The current app combines AI chat, a local project workspace, and optional Gmail search. OpenAI can connect through Sign in with ChatGPT or an API key; Gemini supports Google OAuth for the Gemini API using a user-selected Cloud project; Claude and Grok currently use API keys in the provider settings. Claude Code, Codex CLI, and Gemini CLI can also run through the user's existing local CLI installation and sign-in without a new Obavenus API key. Project files stay local until explicitly attached to a message. Gmail access is read-only, and snippets are shared only when the user attaches them and sends a message.

The Federal Role Finder parses pasted job and offer blocks into titles, agencies, and locations. It always offers official USAJOBS search links; with a user-provided USAJOBS API key it also aggregates open agency-specific and federal IT-series announcements in-app, filters by location/full-time/minimum salary, deduplicates records, and shows available salary, closing date, requirements, required documents, and application steps. Credentials are encrypted locally. Application submission and definitive eligibility decisions remain on USAJOBS and with the applicant.

Team runs include a read-only mode and an explicit per-run project-write mode, and local CLI agents now have provider-specific edit modes that require an open project. Codex uses its workspace-write sandbox; Claude disables Bash and web fetch while enabling accepted file edits; Gemini enables its auto-edit mode. Review changed files in Git after a run. Scheduled local jobs stay read-only.

Local CLI runs use the selected project working directory (or app data without a project), read-only/default CLI permission modes, a bounded timeout, and bounded output. This provides provider CLI account-backed responses without implementing the providers' interactive sign-in flows inside Obavenus.

The composer includes a bundled local workflow library for feature planning, codebase exploration, change review, debugging, technical documentation, and converting an idea into steps. The selected workflow adds focused instructions to that request only; it does not rewrite saved conversation history.

Users can queue a prompt for a later local CLI run. Scheduled prompts and results are encrypted in the app's local data store, tasks can be cancelled before they start, and completion sends a desktop notification when supported. Failed runs retry twice; interrupted tasks recover on restart. Tasks run only while the app is available and overdue queued work is picked up at next launch; this is not a cloud scheduler.

The team can launch up to five user-selected custom specialists concurrently with its built-in analysis and review agents. Team browser research is opt-in per run and is limited to public HTTP(S) navigation, page reading, and following links in an isolated Obavenus BrowserWindow. Project-write mode can create supported text artifacts including Markdown, CSV/TSV, HTML, and code, bounded to 256 KB inside the selected project.

Obavenus does not yet provide linked remote machines, cloud-synced shared spaces, autonomous Chrome-profile control, native binary office-file generation, or cross-run durable agent memory. These require separate implementations and user-visible controls and should not be described as implemented.
