# Local setup

Use Node.js 24 and npm. From the project folder:

```sh
npm install
npm run dev
```

The first screen is a local UI prototype. It can choose a project folder and display a local conversation placeholder; it does not read project files or call an AI model yet. Keep secrets out of the renderer and Git history when provider support is added.

The Git repository is currently local. GitHub CLI authentication must be restored before creating and pushing the private remote.
