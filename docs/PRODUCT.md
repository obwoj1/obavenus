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

The first prototype is an AI chat and project workspace. The initial UI is local-only; model access and reading project files are not connected yet.
