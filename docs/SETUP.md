# Local setup

Use Node.js 24 and npm. From the project folder:

```sh
npm install
npm run dev
```

Obavenus can choose and remember a project folder, list its top-level entries, and preview plain text files up to 64 KB. File previews remain local. Conversations persist locally and can be reopened from **Recent work**. To enable replies, open **Settings**, set a model (defaults to `gpt-5.5`), and enter an OpenAI API key. The key is encrypted with Electron safeStorage and is never returned to the renderer. Chat history is sent to OpenAI only when you press **Send**; requests set `store: false`, while standard API abuse-monitoring policies may still apply. File previews are not attached to chat requests.

Use **Close** in the workspace panel to remove the saved folder selection. Keep secrets out of the renderer and Git history.

The source repository is private at https://github.com/obwoj1/obavenus.
