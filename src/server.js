import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.js";
import {
  clearCookie,
  passwordsMatch,
  readCookie,
  sessionCookie,
  signSession,
  verifySession,
} from "./auth.js";
import {
  clearOverrides,
  getSettings,
  modelReady,
  previewSettings,
  publicSettings,
  r2Ready,
  saveSettings,
} from "./config.js";
import { chatKey, chatsPrefix, filesPrefix, metaKey, objectKey, projectPrefix } from "./keys.js";
import { contentTypeFor, isProbablyBinary } from "./mime.js";
import { assertId, newId, normalizeRel, safeName } from "./paths.js";
import { getStore, resetStoreCache } from "./r2store.js";
import { MUTATING_TOOLS } from "./tools.js";
import { modelsUrl } from "./upstream.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const running = new Set();
const loginAttempts = new Map();
const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex");
  const started = Date.now();
  res.on("finish", () => {
    if (req.path === "/healthz") return;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function authed(req) {
  const settings = getSettings();
  if (!settings.appPassword) return true;
  return verifySession(readCookie(req), settings.appPassword);
}

function requireAuth(req, res, next) {
  if (authed(req)) return next();
  res.status(401).json({ error: "未登录" });
}

function pid(req) {
  try {
    return assertId(req.params.id, "p");
  } catch (error) {
    error.status = 400;
    throw error;
  }
}

function cid(req) {
  try {
    return assertId(req.params.chatId, "c");
  } catch (error) {
    error.status = 400;
    throw error;
  }
}

function viewChat(chat, full = false) {
  const base = {
    id: chat.id,
    title: chat.title,
    model: chat.model || "",
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
  if (full) base.messages = chat.messages || [];
  return base;
}

function titleFrom(text) {
  const line = String(text || "").trim().split("\n")[0] || "新对话";
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/api/bootstrap", (req, res) => {
  const settings = getSettings();
  res.json({ authRequired: Boolean(settings.appPassword), signedIn: authed(req) });
});

app.post("/api/login", (req, res) => {
  const settings = getSettings();
  if (!settings.appPassword) return res.json({ ok: true, authRequired: false });
  const ip = req.ip || "local";
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter((at) => now - at < 10 * 60 * 1000);
  if (recent.length >= 8) return res.status(429).json({ error: "尝试太多次了，请稍后再来" });
  if (!passwordsMatch(req.body?.password || "", settings.appPassword)) {
    recent.push(now);
    loginAttempts.set(ip, recent);
    return res.status(401).json({ error: "密码不对" });
  }
  loginAttempts.delete(ip);
  res.setHeader("Set-Cookie", sessionCookie(signSession(settings.appPassword)));
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearCookie());
  res.json({ ok: true });
});

app.use("/api", requireAuth);

app.get("/api/status", (_req, res) => {
  const settings = getSettings();
  res.json({
    r2Ready: r2Ready(settings),
    modelReady: modelReady(settings),
    model: settings.sub2apiModel,
    bucket: settings.r2Bucket,
    baseUrl: settings.sub2apiBaseUrl,
    appPasswordSet: Boolean(settings.appPassword),
  });
});

app.get("/api/settings", (_req, res) => res.json(publicSettings()));
app.put("/api/settings", (req, res) => {
  resetStoreCache();
  res.json(saveSettings(req.body || {}));
});
app.delete("/api/settings", (_req, res) => {
  resetStoreCache();
  res.json(clearOverrides());
});

app.post("/api/settings/test", wrap(async (req, res) => {
  const settings = previewSettings(req.body || {});
  const target = req.body?.target;
  if (target === "r2") {
    const store = getStore(settings);
    await store.listLevel(filesPrefix("probe"));
    return res.json({ ok: true, message: "R2 可以列出对象" });
  }
  if (target === "model") {
    if (!settings.sub2apiBaseUrl || !settings.sub2apiApiKey) throw fail("还没有填写 sub2api 地址和密钥");
    const response = await fetch(modelsUrl(settings.sub2apiBaseUrl), {
      headers: { Authorization: `Bearer ${settings.sub2apiApiKey}` },
    });
    const text = await response.text();
    if (!response.ok) throw fail(`模型接口返回 ${response.status}：${text.slice(0, 300)}`, 502);
    return res.json({ ok: true, message: "可以连上 sub2api 的模型列表" });
  }
  throw fail("未知的测试目标");
}));

app.get("/api/models", wrap(async (_req, res) => {
  const settings = getSettings();
  if (!settings.sub2apiBaseUrl || !settings.sub2apiApiKey) return res.json({ models: [] });
  try {
    const response = await fetch(modelsUrl(settings.sub2apiBaseUrl), {
      headers: { Authorization: `Bearer ${settings.sub2apiApiKey}` },
    });
    if (!response.ok) return res.json({ models: [], warning: (await response.text()).slice(0, 300) });
    const json = await response.json();
    const models = (json.data || []).map((item) => item.id).filter(Boolean);
    res.json({ models });
  } catch (error) {
    res.json({ models: [], warning: error.message });
  }
}));

app.get("/api/projects", wrap(async (_req, res) => {
  const store = getStore(getSettings());
  const { dirs } = await store.listLevel("projects/");
  const projects = [];
  for (const dir of dirs.slice(0, 100)) {
    const id = dir.slice("projects/".length).replace(/\/$/, "");
    if (!/^p_[a-f0-9]{12}$/.test(id)) continue;
    const meta = await store.getJson(metaKey(id));
    if (meta) projects.push(meta);
  }
  projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ projects });
}));

app.post("/api/projects", wrap(async (req, res) => {
  const store = getStore(getSettings());
  const name = safeName(req.body?.name);
  const now = new Date().toISOString();
  const project = { id: newId("p"), name, createdAt: now, updatedAt: now };
  await store.putJson(metaKey(project.id), project);
  const chat = {
    id: newId("c"),
    title: "新对话",
    model: getSettings().sub2apiModel || "",
    createdAt: now,
    updatedAt: now,
    messages: [],
    openaiMessages: [],
  };
  await store.putJson(chatKey(project.id, chat.id), chat);
  res.status(201).json({ project, chat: viewChat(chat, true) });
}));

app.patch("/api/projects/:id", wrap(async (req, res) => {
  const id = pid(req);
  const store = getStore(getSettings());
  const meta = await store.getJson(metaKey(id));
  if (!meta) throw fail("找不到项目", 404);
  meta.name = safeName(req.body?.name);
  meta.updatedAt = new Date().toISOString();
  await store.putJson(metaKey(id), meta);
  res.json({ project: meta });
}));

app.delete("/api/projects/:id", wrap(async (req, res) => {
  const id = pid(req);
  const store = getStore(getSettings());
  const keys = await store.listAll(projectPrefix(id));
  await store.deleteKeys(keys.map((item) => item.key));
  res.json({ ok: true });
}));

app.get("/api/projects/:id/tree", wrap(async (req, res) => {
  const id = pid(req);
  const rel = normalizeRel(req.query.path || "");
  const store = getStore(getSettings());
  const prefix = rel ? `${filesPrefix(id)}${rel}/` : filesPrefix(id);
  const { dirs, files } = await store.listLevel(prefix);
  const entries = [];
  for (const dir of dirs) {
    const name = dir.slice(prefix.length).replace(/\/$/, "");
    if (!name) continue;
    entries.push({ name, path: rel ? `${rel}/${name}` : name, type: "dir" });
  }
  for (const file of files) {
    const fileRel = file.key.slice(filesPrefix(id).length);
    const name = fileRel.split("/").pop();
    if (!name || name === ".keep") continue;
    entries.push({ name, path: fileRel, type: "file", size: file.size });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  res.json({ path: rel, entries });
}));

app.get("/api/projects/:id/file", wrap(async (req, res) => {
  const id = pid(req);
  const rel = normalizeRel(req.query.path || "");
  if (!rel) throw fail("path 不能为空");
  const store = getStore(getSettings());
  const got = await store.getBuffer(objectKey(id, rel));
  if (!got) throw fail("找不到文件", 404);
  if (isProbablyBinary(rel, got.buffer)) {
    return res.json({ path: rel, binary: true, size: got.size, contentType: got.contentType || contentTypeFor(rel) });
  }
  res.json({
    path: rel,
    binary: false,
    size: got.size,
    contentType: got.contentType || contentTypeFor(rel),
    content: got.buffer.toString("utf8"),
  });
}));

app.put("/api/projects/:id/file", wrap(async (req, res) => {
  const id = pid(req);
  const rel = normalizeRel(req.body?.path || "");
  if (!rel) throw fail("path 不能为空");
  const content = String(req.body?.content ?? "");
  if (content.length > 1_000_000) throw fail("内容超过 100 万字符");
  const store = getStore(getSettings());
  await store.put(objectKey(id, rel), content, contentTypeFor(rel));
  await store.touch(id);
  res.json({ ok: true, path: rel });
}));

app.put("/api/projects/:id/raw", express.raw({ limit: "30mb", type: () => true }), wrap(async (req, res) => {
  const id = pid(req);
  const rel = normalizeRel(req.query.path || "");
  if (!rel) throw fail("path 不能为空");
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const store = getStore(getSettings());
  await store.put(objectKey(id, rel), body, contentTypeFor(rel));
  await store.touch(id);
  res.json({ ok: true, path: rel, size: body.length });
}));

app.delete("/api/projects/:id/file", wrap(async (req, res) => {
  const id = pid(req);
  const rel = normalizeRel(req.query.path || "");
  if (!rel) throw fail("path 不能为空");
  const store = getStore(getSettings());
  const key = objectKey(id, rel);
  if (await store.head(key)) await store.del(key);
  else {
    const kids = await store.listAll(`${key}/`);
    if (!kids.length) throw fail("找不到文件", 404);
    await store.deleteKeys(kids.map((item) => item.key));
  }
  await store.touch(id);
  res.json({ ok: true });
}));

app.get("/api/projects/:id/download", wrap(async (req, res) => {
  const id = pid(req);
  const rel = normalizeRel(req.query.path || "");
  if (!rel) throw fail("path 不能为空");
  const store = getStore(getSettings());
  const got = await store.getBuffer(objectKey(id, rel));
  if (!got) throw fail("找不到文件", 404);
  const name = rel.split("/").pop();
  res.setHeader("Content-Type", got.contentType || contentTypeFor(rel));
  res.setHeader("Content-Length", String(got.buffer.length));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.end(got.buffer);
}));

app.get("/api/projects/:id/chats", wrap(async (req, res) => {
  const id = pid(req);
  const store = getStore(getSettings());
  const objects = await store.listAll(chatsPrefix(id));
  const chats = [];
  for (const item of objects) {
    if (!item.key.endsWith(".json")) continue;
    const chat = await store.getJson(item.key);
    if (chat) chats.push(viewChat(chat));
  }
  chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ chats });
}));

app.post("/api/projects/:id/chats", wrap(async (req, res) => {
  const id = pid(req);
  const store = getStore(getSettings());
  const now = new Date().toISOString();
  const chat = {
    id: newId("c"),
    title: "新对话",
    model: String(req.body?.model || getSettings().sub2apiModel || ""),
    createdAt: now,
    updatedAt: now,
    messages: [],
    openaiMessages: [],
  };
  await store.putJson(chatKey(id, chat.id), chat);
  res.status(201).json({ chat: viewChat(chat, true) });
}));

app.get("/api/projects/:id/chats/:chatId", wrap(async (req, res) => {
  const id = pid(req);
  const chatId = cid(req);
  const store = getStore(getSettings());
  const chat = await store.getJson(chatKey(id, chatId));
  if (!chat) throw fail("找不到对话", 404);
  res.json({ chat: viewChat(chat, true) });
}));

app.delete("/api/projects/:id/chats/:chatId", wrap(async (req, res) => {
  const id = pid(req);
  const chatId = cid(req);
  const store = getStore(getSettings());
  await store.del(chatKey(id, chatId));
  res.json({ ok: true });
}));

app.post("/api/projects/:id/chats/:chatId/messages", wrap(async (req, res) => {
  const id = pid(req);
  const chatId = cid(req);
  const settings = getSettings();
  if (!r2Ready(settings)) throw fail("先配置 Cloudflare R2");
  if (!modelReady(settings) && !String(req.body?.model || "").trim()) throw fail("先配置 sub2api 模型");
  const content = String(req.body?.content || "").trim();
  if (!content) throw fail("消息不能为空");
  if (content.length > 32000) throw fail("消息太长了");
  const lock = `${id}:${chatId}`;
  if (running.has(lock)) throw fail("这条对话正在生成", 409);
  const store = getStore(settings);
  const project = await store.getJson(metaKey(id));
  if (!project) throw fail("找不到项目", 404);
  const chat = await store.getJson(chatKey(id, chatId));
  if (!chat) throw fail("找不到对话", 404);
  let activeFile = "";
  try {
    activeFile = normalizeRel(req.body?.activeFile || "");
  } catch {
    activeFile = "";
  }
  const model = String(req.body?.model || chat.model || settings.sub2apiModel || "").trim();
  if (!model) throw fail("还没有选择模型");
  if (!settings.sub2apiBaseUrl || !settings.sub2apiApiKey) throw fail("先配置 sub2api 地址和密钥");

  running.add(lock);
  const now = new Date().toISOString();
  chat.messages = chat.messages || [];
  chat.openaiMessages = chat.openaiMessages || [];
  chat.model = model;
  chat.updatedAt = now;
  if (!chat.title || chat.title === "新对话") chat.title = titleFrom(content);
  chat.messages.push({ role: "user", content, at: now });
  chat.openaiMessages.push({ role: "user", content });
  await store.putJson(chatKey(id, chatId), chat);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ac = new AbortController();
  const stop = () => {
    if (!res.writableEnded) ac.abort();
  };
  res.on("close", stop);

  const saveAssistant = async (segments, openaiMessages) => {
    chat.messages.push({ role: "assistant", at: new Date().toISOString(), segments });
    if (openaiMessages) chat.openaiMessages = openaiMessages;
    chat.updatedAt = new Date().toISOString();
    await store.putJson(chatKey(id, chatId), chat);
  };

  try {
    const result = await runAgent({
      settings,
      store,
      project,
      chat,
      model,
      signal: ac.signal,
      emit: send,
      activeFile,
    });
    await saveAssistant(result.segments, result.openaiMessages);
    const changed = result.segments.some((seg) => seg.type === "tool" && seg.ok && MUTATING_TOOLS.has(seg.name));
    send("done", { message: chat.messages.at(-1), title: chat.title, changed, aborted: false });
  } catch (error) {
    if (error?.aborted) {
      const partial = error.partial || { segments: [], textBuf: "" };
      const segments = partial.segments.slice();
      if (partial.textBuf) segments.push({ type: "text", text: partial.textBuf });
      if (!segments.length) segments.push({ type: "text", text: "已停止。" });
      await saveAssistant(segments, partial.openaiMessages);
      send("done", { message: chat.messages.at(-1), title: chat.title, changed: true, aborted: true });
    } else {
      chat.messages.push({
        role: "assistant",
        error: true,
        at: new Date().toISOString(),
        segments: [{ type: "text", text: error.message || "生成失败" }],
      });
      chat.updatedAt = new Date().toISOString();
      await store.putJson(chatKey(id, chatId), chat);
      send("error", { message: error.message || "生成失败" });
    }
  } finally {
    running.delete(lock);
    if (!res.writableEnded) res.end();
  }
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "没有这个接口" }));
app.use(express.static(publicDir, {
  etag: true,
  maxAge: 0,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-cache");
  },
}));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || "请求失败" });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => {
  console.log(`Quay listening on ${port}`);
});
