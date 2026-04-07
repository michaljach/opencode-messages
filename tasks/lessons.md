# Lessons

- When asked to create an OpenCode plugin, package it as a real plugin package with a root entrypoint and `package.json`, not only as a project-local `.opencode/plugins` script.
- If the user says local modifications are their manual changes, do not suggest reverting or implicitly treating them as cleanup work; preserve them and call them out separately from my commits.
- For setup simplification, prefer reducing configuration to the file the user already must edit instead of adding a new CLI or extra config file when the user explicitly asks for fewer moving parts.
