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

## Next

- Add selective context handoff so the user can choose which opened files to include in a future model request.
- Connect a model provider through a main-process-only secret path after the user chooses a provider.
