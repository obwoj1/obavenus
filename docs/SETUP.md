# Local setup

Use Node.js 24 and npm. From the project folder:

```sh
npm install
npm run dev
```

Obavenus can choose and remember a project folder, list its top-level entries, and preview plain text files up to 64 KB. Previews stay local unless you explicitly add a file to a message; the composer shows attached files before sending. Conversations persist locally and can be reopened from **Recent work**. For OpenAI, choose **Sign in with ChatGPT account** or **Use OpenAI API key** in **Settings**. ChatGPT account access depends on account eligibility, token-sharing consent, and OpenAI approval of the app; it is separate from API billing. For Claude and Grok, enter an API key from that provider. Keys and ChatGPT credentials are encrypted with Electron safeStorage and are never returned to the renderer. Chat history and explicitly attached file text go to the selected provider only when you press **Send**. API-key OpenAI requests set `store: false`; provider retention policies can differ.

Gmail is connected separately from the AI provider. Create a Google Cloud project, enable the Gmail API, and create an OAuth client of type **Desktop app**. Enter its client ID and client secret in Obavenus under **Gmail** and approve the Google sign-in. Obavenus requests only the `gmail.readonly` scope, uses PKCE for sign-in, and stores OAuth tokens and the client secret using Electron safeStorage. Search result snippets are only sent to the AI if you choose **Attach snippet to next message** and then press **Send**. Gmail OAuth consent-screen testing may require adding your Google account as a test user.

Use **Close** in the workspace panel to remove the saved folder selection. Keep secrets out of the renderer and Git history.

The source repository is private at https://github.com/obwoj1/obavenus.

To build a local Apple Silicon app bundle, run `npm run pack:mac`. To create a DMG installer, run `npm run dist:mac`; output goes under `release/`. These local builds are unsigned and not notarized, so macOS may require you to approve the app the first time you open it. Public distribution needs Apple signing and notarization.
