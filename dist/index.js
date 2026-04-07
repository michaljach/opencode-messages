// index.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
var SERVICE = "opencode-messages";
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 8787;
var DEFAULT_WEBHOOK_PATH = "/opencode-messages/webhook";
var DEFAULT_STATE_FILE = ".opencode/opencode-messages-state.json";
var DEFAULT_MAX_CHUNK_CHARS = 1800;
var PROCESSED_MESSAGE_LIMIT = 200;
function unwrap(result) {
  return result && typeof result === "object" && "data" in result ? result.data : result;
}
function normalizeHandle(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  return trimmed.replace(/[^+\d]/g, "");
}
function parseList(value) {
  return String(value || "").split(",").map((item) => normalizeHandle(item)).filter(Boolean);
}
function splitText(text, maxChunkChars) {
  const chunks = [];
  let remaining = String(text || "").trim();
  while (remaining.length > maxChunkChars) {
    let cut = remaining.lastIndexOf("\n\n", maxChunkChars);
    if (cut < Math.floor(maxChunkChars / 2)) cut = remaining.lastIndexOf("\n", maxChunkChars);
    if (cut < Math.floor(maxChunkChars / 2)) cut = remaining.lastIndexOf(" ", maxChunkChars);
    if (cut <= 0) cut = maxChunkChars;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : [""];
}
function createEmptyState() {
  return {
    currentSessionBySender: {},
    senderBySession: {},
    permissionsBySender: {},
    processedMessages: []
  };
}
var StateStore = class {
  filePath;
  state;
  constructor(filePath) {
    this.filePath = filePath;
    this.state = createEmptyState();
  }
  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        ...createEmptyState(),
        ...parsed
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") throw error;
      this.state = createEmptyState();
    }
  }
  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.state, null, 2)}
`, "utf8");
  }
  getCurrentSession(sender) {
    return this.state.currentSessionBySender[sender] || null;
  }
  async setCurrentSession(sender, sessionID) {
    this.state.currentSessionBySender[sender] = sessionID;
    this.state.senderBySession[sessionID] = sender;
    await this.save();
  }
  async removeSession(sessionID) {
    const sender = this.state.senderBySession[sessionID];
    delete this.state.senderBySession[sessionID];
    if (sender && this.state.currentSessionBySender[sender] === sessionID) {
      delete this.state.currentSessionBySender[sender];
    }
    await this.save();
  }
  hasProcessedMessage(messageID) {
    return this.state.processedMessages.includes(messageID);
  }
  async rememberProcessedMessage(messageID) {
    this.state.processedMessages.push(messageID);
    if (this.state.processedMessages.length > PROCESSED_MESSAGE_LIMIT) {
      this.state.processedMessages = this.state.processedMessages.slice(-PROCESSED_MESSAGE_LIMIT);
    }
    await this.save();
  }
  async addPermission(sender, permission) {
    const current = this.state.permissionsBySender[sender] || [];
    const withoutOld = current.filter((item) => item.permissionID !== permission.permissionID);
    withoutOld.push(permission);
    this.state.permissionsBySender[sender] = withoutOld;
    await this.save();
  }
  getPermissions(sender) {
    return this.state.permissionsBySender[sender] || [];
  }
  async removePermission(sender, permissionID) {
    this.state.permissionsBySender[sender] = (this.state.permissionsBySender[sender] || []).filter(
      (item) => item.permissionID !== permissionID
    );
    await this.save();
  }
  findPermission(sender, token) {
    const permissions = this.getPermissions(sender);
    if (!permissions.length) return null;
    if (token) return permissions.find((item) => item.permissionID === token) || null;
    return permissions.length === 1 ? permissions[0] : null;
  }
};
function verifyWebhook(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = String(signature).trim();
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(actual, "utf8"));
  } catch {
    return false;
  }
}
async function log(client, level, message, extra = {}) {
  try {
    await client.app.log({
      body: {
        service: SERVICE,
        level,
        message,
        extra
      }
    });
  } catch {
  }
}
async function readConfigFile(worktree) {
  const configPath = join(worktree, "opencode.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.opencodeMessages || {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") throw error;
    return {};
  }
}
function readConfigValue(fileConfig, key, ...envNames) {
  for (const envName of envNames) {
    const value = Bun.env[envName];
    if (value !== void 0 && value !== "") return value;
  }
  return fileConfig[key];
}
async function parseConfig(worktree) {
  const fileConfig = await readConfigFile(worktree);
  const apiKey = String(readConfigValue(fileConfig, "apiKey", "OPENCODE_MESSAGES_API_KEY", "OPENCODE_MESSAGES_DEV_API_KEY") || "");
  const line = normalizeHandle(readConfigValue(fileConfig, "line", "OPENCODE_MESSAGES_LINE", "OPENCODE_MESSAGES_DEV_LINE"));
  const webhookSecret = String(
    readConfigValue(fileConfig, "webhookSecret", "OPENCODE_MESSAGES_WEBHOOK_SECRET", "OPENCODE_MESSAGES_DEV_WEBHOOK_SECRET") || ""
  );
  const publicUrl = String(readConfigValue(fileConfig, "publicUrl", "OPENCODE_MESSAGES_PUBLIC_URL") || "");
  const allowedSendersValue = readConfigValue(
    fileConfig,
    "allowedSenders",
    "OPENCODE_MESSAGES_ALLOWED_SENDERS",
    "OPENCODE_MESSAGES_DEV_ALLOWED_SENDERS"
  );
  const allowedSenders = Array.isArray(allowedSendersValue) ? allowedSendersValue.map((item) => normalizeHandle(item)).filter(Boolean) : parseList(allowedSendersValue);
  const host = String(readConfigValue(fileConfig, "host", "OPENCODE_MESSAGES_HOST", "OPENCODE_MESSAGES_DEV_HOST") || "") || DEFAULT_HOST;
  const port = Number(readConfigValue(fileConfig, "port", "OPENCODE_MESSAGES_PORT", "OPENCODE_MESSAGES_DEV_PORT") || DEFAULT_PORT);
  const webhookPath = String(readConfigValue(fileConfig, "webhookPath", "OPENCODE_MESSAGES_WEBHOOK_PATH", "OPENCODE_MESSAGES_DEV_WEBHOOK_PATH") || "") || DEFAULT_WEBHOOK_PATH;
  const statePathValue = String(readConfigValue(fileConfig, "statePath", "OPENCODE_MESSAGES_STATE_FILE", "OPENCODE_MESSAGES_DEV_STATE_FILE") || "") || DEFAULT_STATE_FILE;
  const statePath = join(worktree, statePathValue);
  const maxChunkChars = Number(
    readConfigValue(fileConfig, "maxChunkChars", "OPENCODE_MESSAGES_MAX_CHUNK_CHARS", "OPENCODE_MESSAGES_DEV_MAX_CHUNK_CHARS") || DEFAULT_MAX_CHUNK_CHARS
  );
  const missing = [];
  if (!apiKey) missing.push("OPENCODE_MESSAGES_API_KEY");
  if (!line) missing.push("OPENCODE_MESSAGES_LINE");
  if (!publicUrl && !webhookSecret) missing.push("OPENCODE_MESSAGES_WEBHOOK_SECRET or OPENCODE_MESSAGES_PUBLIC_URL");
  if (!allowedSenders.length) missing.push("OPENCODE_MESSAGES_ALLOWED_SENDERS");
  if (!Number.isFinite(port) || port <= 0) missing.push("OPENCODE_MESSAGES_PORT");
  return {
    missing,
    config: {
      apiKey,
      line,
      webhookSecret,
      publicUrl,
      allowedSenders: new Set(allowedSenders),
      host,
      port,
      webhookPath,
      statePath,
      maxChunkChars
    }
  };
}
async function messagesFetch(config, path, init = {}) {
  const response = await fetch(`https://api.messages.dev/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...init.headers || {}
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body?.error?.message || response.statusText || "Messages.dev request failed";
    throw new Error(detail);
  }
  return body;
}
function buildWebhookUrl(publicUrl, webhookPath) {
  const url = new URL(publicUrl);
  url.pathname = webhookPath;
  url.search = "";
  url.hash = "";
  return url.toString();
}
async function ensureWebhook(config) {
  if (!config.publicUrl) return config.webhookSecret;
  const webhookURL = buildWebhookUrl(config.publicUrl, config.webhookPath);
  const list = await messagesFetch(config, `/webhooks?from=${encodeURIComponent(config.line)}`);
  const existing = (list.data || []).find(
    (item) => item.url === webhookURL && Array.isArray(item.events) && item.events.includes("message.received") && item.secret
  );
  if (existing?.secret) return existing.secret;
  const created = await messagesFetch(config, "/webhooks", {
    method: "POST",
    body: JSON.stringify({
      from: config.line,
      url: webhookURL,
      events: ["message.received"]
    })
  });
  if (!created?.secret) throw new Error("Messages.dev did not return a webhook secret");
  return created.secret;
}
async function sendMessage(config, to, text) {
  const chunks = splitText(text, config.maxChunkChars);
  for (const chunk of chunks) {
    await messagesFetch(config, "/messages", {
      method: "POST",
      body: JSON.stringify({
        from: config.line,
        to,
        text: chunk
      })
    });
  }
}
function extractText(parts) {
  return (parts || []).filter((part) => part && part.type === "text" && typeof part.text === "string" && part.text.trim()).map((part) => part.text.trim()).join("\n\n").trim();
}
function formatResult(sessionID, result) {
  const info = result?.info || {};
  const errorText = info?.error?.data?.message || info?.error?.message;
  if (errorText) return `Session ${sessionID} failed.

${errorText}`;
  const text = extractText(result?.parts);
  if (text) return `Session ${sessionID}

${text}`;
  return `Session ${sessionID} completed.`;
}
function formatPermissionRequest(permission) {
  const metadata = permission?.metadata ? JSON.stringify(permission.metadata, null, 2) : "";
  const details = metadata ? `

${metadata}` : "";
  return [
    `Permission needed in ${permission.sessionID}.`,
    "",
    permission.title || "OpenCode asked for approval.",
    details,
    "",
    `Reply /approve ${permission.id} or /deny ${permission.id}`
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function formatHelp() {
  return [
    "Remote OpenCode commands:",
    "",
    "/help",
    "/new [title]",
    "/use <session-id>",
    "/status",
    "/abort",
    "/approve <permission-id>",
    "/deny <permission-id>",
    "/cmd </slash-command args>",
    "/shell <command>",
    "Any other text is sent as a normal prompt to the current session."
  ].join("\n");
}
function parseIncomingCommand(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { type: "empty" };
  const [head, ...rest] = trimmed.split(/\s+/);
  const value = trimmed.slice(head.length).trim();
  switch (head.toLowerCase()) {
    case "/help":
      return { type: "help" };
    case "/new":
      return { type: "new", value };
    case "/use":
      return { type: "use", value };
    case "/status":
      return { type: "status" };
    case "/abort":
      return { type: "abort" };
    case "/approve":
      return { type: "approve", value: rest[0] || "" };
    case "/deny":
      return { type: "deny", value: rest[0] || "" };
    case "/cmd":
      return { type: "cmd", value };
    case "/shell":
      return { type: "shell", value };
    default:
      return { type: "prompt", value: trimmed };
  }
}
function getSessionStatus(statusMap, sessionID) {
  if (!statusMap || !sessionID) return "unknown";
  return statusMap[sessionID]?.type || "unknown";
}
var OpencodeMessagesPlugin = async ({ client, worktree }) => {
  const { config, missing } = await parseConfig(worktree);
  if (missing.length) {
    await log(client, "warn", "Plugin disabled because environment is incomplete", { missing });
    return {};
  }
  if (config.publicUrl) {
    try {
      config.webhookSecret = await ensureWebhook(config);
      await log(client, "info", "Messages.dev webhook configured automatically", {
        publicUrl: config.publicUrl,
        webhookPath: config.webhookPath
      });
    } catch (error) {
      await log(client, "error", "Failed to configure Messages.dev webhook", {
        publicUrl: config.publicUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }
  const state = new StateStore(config.statePath);
  await state.load();
  const activeSenders = /* @__PURE__ */ new Set();
  async function ensureSession(sender, preferredTitle) {
    const currentSessionID = state.getCurrentSession(sender);
    if (currentSessionID) return currentSessionID;
    const session = unwrap(
      await client.session.create({
        body: {
          title: preferredTitle || `iMessage ${sender}`
        }
      })
    );
    await state.setCurrentSession(sender, session.id);
    return session.id;
  }
  async function runExclusive(sender, runner) {
    if (activeSenders.has(sender)) {
      await sendMessage(config, sender, "A request is already running for this sender. Wait for it to finish or send /abort.");
      return;
    }
    activeSenders.add(sender);
    try {
      await runner();
    } finally {
      activeSenders.delete(sender);
    }
  }
  async function handleApproval(sender, permission, response) {
    await client.postSessionIdPermissionsPermissionId({
      path: {
        id: permission.sessionID,
        permissionID: permission.permissionID
      },
      body: {
        response
      }
    });
    await state.removePermission(sender, permission.permissionID);
    await sendMessage(config, sender, `Permission ${permission.permissionID} replied with ${response}.`);
  }
  async function handleCommand(sender, text) {
    const command = parseIncomingCommand(text);
    if (command.type === "empty") return;
    if (command.type === "help") {
      await sendMessage(config, sender, formatHelp());
      return;
    }
    if (command.type === "new") {
      const session = unwrap(
        await client.session.create({
          body: {
            title: command.value || `iMessage ${sender}`
          }
        })
      );
      await state.setCurrentSession(sender, session.id);
      await sendMessage(config, sender, `Created session ${session.id}${session.title ? ` (${session.title})` : ""}.`);
      return;
    }
    if (command.type === "use") {
      if (!command.value) {
        await sendMessage(config, sender, "Usage: /use <session-id>");
        return;
      }
      const session = unwrap(
        await client.session.get({
          path: {
            id: command.value
          }
        })
      );
      await state.setCurrentSession(sender, session.id);
      await sendMessage(config, sender, `Current session is now ${session.id}${session.title ? ` (${session.title})` : ""}.`);
      return;
    }
    if (command.type === "status") {
      const sessionID2 = state.getCurrentSession(sender);
      if (!sessionID2) {
        await sendMessage(config, sender, "No current session. Send a prompt or create one with /new.");
        return;
      }
      const statusMap = unwrap(await client.session.status());
      const status = getSessionStatus(statusMap, sessionID2);
      const queued = activeSenders.has(sender) ? "yes" : "no";
      await sendMessage(config, sender, `Current session: ${sessionID2}
Status: ${status}
Active request: ${queued}`);
      return;
    }
    if (command.type === "abort") {
      const sessionID2 = state.getCurrentSession(sender);
      if (!sessionID2) {
        await sendMessage(config, sender, "No current session to abort.");
        return;
      }
      await client.session.abort({
        path: {
          id: sessionID2
        }
      });
      await sendMessage(config, sender, `Abort requested for session ${sessionID2}.`);
      return;
    }
    if (command.type === "approve" || command.type === "deny") {
      const permission = state.findPermission(sender, command.value || "");
      if (!permission) {
        const pending = state.getPermissions(sender);
        const message = pending.length ? `Pending permission IDs:
${pending.map((item) => item.permissionID).join("\n")}` : "No pending permissions for this sender.";
        await sendMessage(config, sender, message);
        return;
      }
      await handleApproval(sender, permission, command.type === "approve" ? "once" : "reject");
      return;
    }
    if (command.type === "cmd") {
      if (!command.value) {
        await sendMessage(config, sender, "Usage: /cmd </slash-command args>");
        return;
      }
      const sessionID2 = await ensureSession(sender);
      const [rawName, ...argumentsParts] = command.value.split(/\s+/);
      const slashCommand = rawName.replace(/^\/+/, "");
      const argumentsValue = argumentsParts.join(" ");
      await runExclusive(sender, async () => {
        await sendMessage(config, sender, `Running /${slashCommand} in session ${sessionID2}.`);
        const result = unwrap(
          await client.session.command({
            path: {
              id: sessionID2
            },
            body: {
              command: slashCommand,
              arguments: argumentsValue
            }
          })
        );
        await sendMessage(config, sender, formatResult(sessionID2, result));
      });
      return;
    }
    if (command.type === "shell") {
      if (!command.value) {
        await sendMessage(config, sender, "Usage: /shell <command>");
        return;
      }
      const sessionID2 = await ensureSession(sender);
      await runExclusive(sender, async () => {
        await sendMessage(config, sender, `Running shell command in session ${sessionID2}.`);
        const result = unwrap(
          await client.session.shell({
            path: {
              id: sessionID2
            },
            body: {
              agent: "build",
              command: command.value
            }
          })
        );
        await sendMessage(config, sender, formatResult(sessionID2, result));
      });
      return;
    }
    const sessionID = await ensureSession(sender);
    await runExclusive(sender, async () => {
      await sendMessage(config, sender, `Queued prompt in session ${sessionID}. I will reply when OpenCode finishes.`);
      const result = unwrap(
        await client.session.prompt({
          path: {
            id: sessionID
          },
          body: {
            parts: [
              {
                type: "text",
                text: command.value || ""
              }
            ]
          }
        })
      );
      await sendMessage(config, sender, formatResult(sessionID, result));
    });
  }
  async function handleWebhookEvent(payload) {
    if (payload?.event !== "message.received") return;
    const sender = normalizeHandle(payload?.data?.sender);
    const messageID = payload?.data?.id || "";
    const text = String(payload?.data?.text || "").trim();
    if (!sender || !messageID || !text) return;
    if (payload?.data?.is_from_me) return;
    if (!config.allowedSenders.has(sender)) {
      await log(client, "warn", "Ignoring message from unauthorized sender", { sender });
      return;
    }
    if (state.hasProcessedMessage(messageID)) return;
    await state.rememberProcessedMessage(messageID);
    try {
      await handleCommand(sender, text);
    } catch (error) {
      await log(client, "error", "Failed to handle remote message", {
        sender,
        messageID,
        error: error instanceof Error ? error.message : String(error)
      });
      await sendMessage(config, sender, `Remote control failed.

${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let server;
  try {
    server = Bun.serve({
      hostname: config.host,
      port: config.port,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/health") {
          return Response.json({
            ok: true,
            service: SERVICE,
            webhookPath: config.webhookPath
          });
        }
        if (request.method !== "POST" || url.pathname !== config.webhookPath) {
          return new Response("Not found", { status: 404 });
        }
        const rawBody = await request.text();
        const signature = request.headers.get("x-webhook-signature");
        if (!verifyWebhook(rawBody, signature, config.webhookSecret)) {
          await log(client, "warn", "Rejected webhook with invalid signature");
          return new Response("Invalid signature", { status: 401 });
        }
        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        queueMicrotask(() => {
          handleWebhookEvent(payload).catch(async (error) => {
            await log(client, "error", "Webhook processing crashed", {
              error: error instanceof Error ? error.message : String(error)
            });
          });
        });
        return Response.json({ ok: true });
      }
    });
  } catch (error) {
    await log(client, "error", "Failed to start opencode-messages bridge", {
      host: config.host,
      port: config.port,
      error: error instanceof Error ? error.message : String(error)
    });
    return {};
  }
  await log(client, "info", "opencode-messages bridge started", {
    host: config.host,
    port: config.port,
    webhookPath: config.webhookPath,
    statePath: config.statePath,
    serverURL: server.url.toString()
  });
  return {
    event: async ({ event }) => {
      if (!event) return;
      if (event.type === "permission.updated" || event.type === "permission.asked") {
        const permission = event.properties;
        const sender = state.state.senderBySession[permission.sessionID];
        if (!sender) return;
        await state.addPermission(sender, {
          permissionID: permission.id,
          sessionID: permission.sessionID,
          title: permission.title
        });
        await sendMessage(config, sender, formatPermissionRequest(permission));
        return;
      }
      if (event.type === "permission.replied") {
        const sender = state.state.senderBySession[event.properties.sessionID];
        if (!sender) return;
        await state.removePermission(sender, event.properties.permissionID);
        return;
      }
      if (event.type === "session.deleted") {
        await state.removeSession(event.properties.info.id);
      }
    }
  };
};
var index_default = OpencodeMessagesPlugin;
export {
  OpencodeMessagesPlugin,
  index_default as default
};
