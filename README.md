# Sunday Stride

A live finish-line check-in app for races with registration rosters. Create each race, import its runners, start the shared race clock, and record finishers from the roster autocomplete. Keep the leaderboard open on a projector for live results and race history.

## Race setup

Create a race from the dashboard, then use its race-scoped registration page (`/races/:raceId/registration`) to import runners with a name and date. CSV columns are `id_key, name, category`, with or without a header row:

```csv
id_key,name,category
id_key_1,Mark Collins,Men-5k
id_key_2,Peter Obrien,Men-3k-seniors
id_key_3,Frank Lou,Women-3k
```

Preview the import before applying it. A matching `id_key` updates that runner. Roster entries omitted from a later import remain registered. Invalid rows and duplicate IDs in one file are reported before the import can be applied.

## Finish line and leaderboard

On `/races/:raceId/recording`, start the race clock, then type part of a registered runner’s name. Select a suggestion or press **Enter** to record the top match. Search results show the category and whether that runner already finished; a runner can only be recorded once per race. Finish timestamps are saved by the server and displayed as elapsed time from the race start.

Each race has a `/races/:raceId/leaderboard` page. Select a saved race in the sidebar to view its history. Use the **All**, **3k**, **5k**, and **Seniors** filters. A row’s category dropdown transfers the runner between categories and updates the roster. The edit action can correct the runner name, category, or finish time; deleting a finish keeps the roster entry available for check-in.

The old `/registration`, `/runner-input`, and `/leaderboard` URLs remain as redirects to the selected race.

Only one race can be running at a time. Use **Complete race** to lock check-in and preserve the race in history. **Reset race** clears that race’s finishes and clock while keeping its roster.

## Start the app

Install dependencies from the project root, then run the frontend and API together:

```sh
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/) to continue to the selected race or create a new one. The legacy page paths remain available as redirects. The API runs on port 3001. Stop any earlier dev session using ports 3001 or 5173 before starting another one. Development startup builds the static public-viewer assets, starts a separate read-only leaderboard listener on a private network address, and makes **Share leaderboard** available in the browser app. The QR code opens the read-only `/live/:raceId` page at a different address and port from Vite. If you change the public-viewer frontend code, restart `npm run dev` to rebuild those assets. Viewers must be on the same network, and Windows Firewall/router settings may need to allow the connection.

To build the frontend and start the production preview and API:

```sh
npm start
```

## Windows desktop app

The Tauri shell includes a bundled Node.js sidecar and keeps its SQLite database and backups in the current user's application data folder. The **Projector window** action opens the leaderboard in a second app window. A built Windows x64 NSIS installer uses per-user installation.

On a Windows x64 build machine with Rust/Cargo and Microsoft C++ Build Tools installed:

```sh
npm install
npm run desktop:dev
```

Run `PACKAGE.cmd` from Command Prompt or `bash PACKAGE.sh` from Git Bash to build the Windows x64 NSIS installer. Both scripts validate the toolchain and ensure the root, frontend, backend, Tauri, and Cargo versions match before packaging. Update all five version declarations together when preparing a release; they currently read **1.0.0**. Use `PACKAGE.cmd --check` or `bash PACKAGE.sh --check` to validate prerequisites and versions without building. The shell script is for Git Bash on Windows, not WSL or native Linux/macOS.

The installer is written under `src-tauri/target/release/bundle/nsis/`. `npm run desktop:prepare` stages the sidecar runtime and production dependencies. `node scripts/verify-desktop-runtime.mjs` starts that sidecar against a temporary database and verifies its local API. Run `npm test` for backend and frontend tests.

In browser development mode, race data is stored in `backend/fun-run.sqlite`; any legacy data migration backup is written under `backend/backups/`. In the Windows desktop app, each user's race data and future backups are stored in Tauri's per-user application data directory. The existing archived finishes are not copied into a new desktop database.
