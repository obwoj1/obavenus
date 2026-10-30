# Local setup

Use Node.js 24 and npm. From the project folder:

```sh
npm install
npm run dev
```

Obavenus can choose and remember a project folder, list its top-level entries, and preview plain text files up to 64 KB. Previews stay local unless you explicitly add a file to a message; the composer shows attached files before sending. Conversations persist locally and can be reopened from **Recent work**. For OpenAI, choose **Sign in with ChatGPT account** or **Use OpenAI API key** in **Settings**. ChatGPT account access depends on account eligibility, token-sharing consent, and OpenAI approval of the app; it is separate from API billing. For Gemini, choose **Sign in with Google account** and provide a Google Cloud project ID plus a Google OAuth desktop client. Enable the Generative Language API and configure OAuth consent/test users in Google Cloud. Gemini API usage is billed to that Cloud project, not a Google AI subscription. The OAuth flow requests `cloud-platform` and `generative-language.retriever` scopes; account eligibility and Google OAuth verification settings apply. Claude and Grok currently use API keys in Obavenus. Claude subscription sign-in is supported in Claude Code; xAI's public API uses API keys. API keys and OAuth credentials are encrypted with Electron safeStorage and are never returned to the renderer. Chat history and explicitly attached file text go to the selected provider only when you press **Send**. OpenAI requests set `store: false`; provider retention policies can differ.

For a no-new-API-key option, install and sign in to Claude Code (`claude`), Codex CLI (`codex`), or Gemini CLI (`gemini`) in Terminal, then restart Obavenus and choose that CLI from the composer mode menu. Obavenus discovers standard Homebrew, `~/.local/bin`, and NVM locations. Local runs use the selected project as their working directory (or Obavenus app data when no project is selected), receive recent conversation and only explicitly attached files, and use read-only/default permission modes. The app does not enable permission bypasses. Local runs have a three-minute timeout and a 2 MB output cap. CLI sign-in is managed by each CLI provider; Gemini CLI may require Google Cloud/API setup according to its own configuration.

Choose a reusable workflow beside the composer mode to guide common requests such as feature planning, codebase exploration, change review, debugging, documentation, or turning an idea into steps. These bundled instructions stay local and can be combined with either a provider-backed or local CLI run.

Select **Team · write project files** to let the implementation specialist create or replace supported text files in the open project for that run. The default **Team · read-only** mode does not write. File writes are confined to the selected project and block hidden paths, symlinks, dependencies/build/release folders, binary formats, and files over 256 KB. The answer shows which paths it created or updated. Local CLI providers may have their own tools; Obavenus uses their read-only/default permission modes for this path.

In **Find federal jobs**, paste offer/job descriptions and use **Build official search links** without credentials. For in-app open-announcement aggregation, request a USAJOBS developer API key from the official developer portal, then expand **Connect USAJOBS API**, enter the email used for the request and key, and save. Obavenus encrypts the key on this Mac and sends searches directly to USAJOBS. Current queries cover the listed agencies plus the 2210 IT occupational series and public announcements. Confirm each listing's eligibility, closing date, required documents, and application instructions on its official announcement; Obavenus does not submit applications.

Gmail is connected separately from the AI provider. Create a Google Cloud project, enable the Gmail API, and create an OAuth client of type **Desktop app**. Enter its client ID and client secret in Obavenus under **Gmail** and approve the Google sign-in. Obavenus requests only the `gmail.readonly` scope for Gmail, uses PKCE for sign-in, and stores OAuth tokens and the client secret using Electron safeStorage. Search result snippets are only sent to the AI if you choose **Attach snippet to next message** and then press **Send**. Gmail OAuth consent-screen testing may require adding your Google account as a test user.

Use **Close** in the workspace panel to remove the saved folder selection. Keep secrets out of the renderer and Git history.

The source repository is private at https://github.com/obwoj1/obavenus.

To build a local Apple Silicon app bundle, run `npm run pack:mac`. To create a DMG installer, run `npm run dist:mac`; output goes under `release/`. These local builds are unsigned and not notarized, so macOS may require you to approve the app the first time you open it. Public distribution needs Apple signing and notarization.
