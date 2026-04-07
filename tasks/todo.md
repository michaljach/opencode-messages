# Todo

- [x] Review OpenCode plugin hooks and Messages.dev webhook/message APIs.
- [x] Build a local OpenCode plugin that receives Messages.dev webhooks and routes iMessage commands into OpenCode sessions.
- [x] Add setup and usage documentation, including tunnel/webhook requirements.
- [x] Verify the plugin loads and passes a syntax check.
- [x] Rework the local plugin into a proper package plugin with a root package entrypoint and manifest.
- [x] Initialize git metadata for this workspace and add the requested GitHub remote.
- [x] Re-verify the packaged plugin entrypoint and local wrapper after the package refactor.

# Notes

- The workspace started empty, so this project is being scaffolded from scratch.
- The first pass prioritized a local-file install under `.opencode/plugins/`.
- The user then clarified they wanted a proper packaged OpenCode plugin.

# Review

- Added `.opencode/plugins/messages-dev-remote.js` with a local webhook server, sender allowlist, session persistence, remote command parsing, and iMessage replies.
- Added `README.md` with setup, required environment variables, tunnel instructions, and supported commands.
- Verified the plugin parses successfully with `npx --yes esbuild .opencode/plugins/messages-dev-remote.js --bundle --format=esm --platform=node --outfile=/tmp/messages-dev-remote.bundle.js`.
- Bun is not installed in this workspace, so I could not do a live runtime startup check against `Bun.serve`.
- Reworked the implementation into a package plugin in `index.js` with `package.json`, and reduced the project-local plugin file to a wrapper re-export.
- Initialized a git repository and added `origin` pointing at `https://github.com/michaljach/opencode-messages`.
- Re-verified both `index.js` and `.opencode/plugins/messages-dev-remote.js` with esbuild after the package refactor.
