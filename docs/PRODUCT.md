# Obavenus

Obavenus is an original Electron desktop app inspired by the broad product category of Universe. The implementation will use its own code, visual language, copy, and assets.

## Product direction

Start with a macOS desktop assistant that combines AI chat with a project workspace. Keep the first version small enough to run locally, then add capabilities in independently reviewable steps.

## Design boundaries

- Treat REA output as technical evidence about the installed app, not as source code to copy.
- Do not reuse Universe source, assets, copy, secrets, or private service endpoints.
- Build new UI and behavior from the product goal and user feedback.
- Keep local file and process access explicit and narrow.

## First version

The current app combines AI chat, a local project workspace, and optional Gmail search. OpenAI can connect through Sign in with ChatGPT or an API key; Claude and Grok currently use API keys. Project files stay local until explicitly attached to a message. Gmail access is read-only, and snippets are shared only when the user attaches them and sends a message.
