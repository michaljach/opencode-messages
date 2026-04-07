# opencode-messages

Installable OpenCode plugin package for controlling a running OpenCode instance from your iPhone over iMessage using [Messages.dev](https://www.messages.dev/).

The package exports `OpencodeMessagesPlugin` and also includes a thin local wrapper at `.opencode/plugins/opencode-messages.ts` for development in this repo.

It:

- receives `message.received` webhooks from Messages.dev
- verifies the webhook signature
- maps each allowed sender to an OpenCode session
- sends prompts, slash commands, shell commands, and permission replies into OpenCode
- sends the resulting assistant response back over iMessage

## What It Supports

- normal prompt messages
- `/new [title]`
- `/use <session-id>`
- `/status`
- `/abort`
- `/cmd </slash-command args>`
- `/shell <command>`
- `/approve <permission-id>`
- `/deny <permission-id>`

## Install

Published package usage in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-messages"]
}
```

Until you publish it, you can use the included local wrapper in this repo or copy `index.ts` into your own package.

## Setup

1. Install the package through OpenCode once it is published, or use the local wrapper in `.opencode/plugins/opencode-messages.ts` while developing.
2. Export the required environment variables before launching OpenCode:

```bash
export OPENCODE_MESSAGES_DEV_API_KEY="sk_live_..."
export OPENCODE_MESSAGES_DEV_LINE="+15551234567"
export OPENCODE_MESSAGES_DEV_WEBHOOK_SECRET="whsec_..."
export OPENCODE_MESSAGES_DEV_ALLOWED_SENDERS="+15559876543"
```

3. Optional environment variables:

```bash
export OPENCODE_MESSAGES_DEV_HOST="127.0.0.1"
export OPENCODE_MESSAGES_DEV_PORT="8787"
export OPENCODE_MESSAGES_DEV_WEBHOOK_PATH="/opencode-messages/webhook"
export OPENCODE_MESSAGES_DEV_STATE_FILE=".opencode/opencode-messages-state.json"
export OPENCODE_MESSAGES_DEV_MAX_CHUNK_CHARS="1800"
```

4. Start OpenCode in the target project.
5. Expose the local webhook server over HTTPS. A tunnel is the simplest way. Example with `cloudflared`:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

6. In Messages.dev, create a webhook for your configured line:
   URL: `https://<your-public-host>/opencode-messages/webhook`
   Events: `message.received`

7. Send `/help` from your allowed iPhone number.

## Package Layout

- `index.ts`: package entrypoint for npm/plugin installation
- `.opencode/plugins/opencode-messages.ts`: local development wrapper that re-exports the package plugin

## Notes

- The plugin only accepts senders listed in `OPENCODE_MESSAGES_DEV_ALLOWED_SENDERS`.
- State is persisted in `.opencode/opencode-messages-state.json` so sender-to-session mappings survive restarts.
- Permission prompts from OpenCode are sent back to iMessage, and you can reply with `/approve <id>` or `/deny <id>`.
- Incoming webhooks must reach the machine running OpenCode. Messages.dev requires an HTTPS endpoint for webhook delivery.

## Health Check

The plugin exposes a local health endpoint:

```text
GET /health
```

Example:

```bash
curl http://127.0.0.1:8787/health
```
