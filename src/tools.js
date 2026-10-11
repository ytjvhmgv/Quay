import { compactDiff } from "./diff.js";
import { applyEdit } from "./edit.js";
import { filesPrefix, objectKey } from "./keys.js";
import { contentTypeFor, isProbablyBinary } from "./mime.js";
import { normalizeRel } from "./paths.js";

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出项目里某一层目录的文件和子目录。path 为空表示项目根目录。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "相对目录，用 / 分隔。根目录传空字符串。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文本文件原文。返回内容没有行号。大文件用 offset 和 limit 分段读。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          offset: { type: "integer", description: "从第几行开始，1 起算。" },
          limit: { type: "integer", description: "最多读多少行，默认 400。" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "新建或整文件覆盖。改已有文件时优先用 edit_file。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "把文件中唯一一段 old_string 替换成 new_string。old_string 必须是 read_file 看到的原文。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "删除文件。删除目录时必须把 recursive 设为 true。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_file",
      description: "移动或重命名文件，也可以移动整个目录。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mkdir",
      description: "创建一个空目录。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "在文本文件里做不区分大小写的字面量搜索，不是正则。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          path: { type: "string", description: "可选，限定文件或目录。" },
          glob: { type: "string", description: "可选，简单通配，例如 *.js。" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "用 HTTP GET 或 POST 请求一个外部 URL，返回响应正文（文本）。只支持 http/https。响应过大时会截断到 50000 字符。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", description: "完整 URL，必须以 http:// 或 https:// 开头。" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"], description: "HTTP 方法，默认 GET。" },
          headers: { type: "object", description: "可选的请求头，键值对。", additionalProperties: { type: "string" } },
          body: { type: "string", description: "可选的请求体，POST/PUT 时使用。" },
          timeout: { type: "integer", description: "超时秒数，1-30，默认 15。" },
        },
        required: ["url"],
      },
    },
  },
];

export const MUTATING_TOOLS = new Set(["write_file", "edit_file", "delete_file", "move_file", "mkdir"]);

function asText(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function relOf(projectId, key) {
  const base = filesPrefix(projectId);
  if (!key.startsWith(base)) throw new Error("对象路径越界");
  return key.slice(base.length);
}

function matchGlob(name, glob) {
  if (!glob) return true;
  const source = String(glob).split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  const re = new RegExp(`^${source}$`, "i");
  return re.test(name) || re.test(name.split("/").pop());
}

async function listFiles(store, projectId, args, progress) {
  const rel = normalizeRel(args.path || "");
  const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
  progress(rel ? `列出目录 ${rel}/` : "列出根目录…");
  const { dirs, files } = await store.listLevel(prefix);
  const lines = [];
  for (const dir of dirs) {
    const name = dir.slice(prefix.length).replace(/\/$/, "");
    if (name) lines.push(`[目录] ${rel ? `${rel}/` : ""}${name}/`);
  }
  for (const file of files) {
    const fileRel = relOf(projectId, file.key);
    if (fileRel.split("/").pop() === ".keep") continue;
    lines.push(`[文件] ${fileRel}  ${file.size} B`);
  }
  if (!lines.length) return rel ? `目录是空的：${rel}` : "项目里还没有文件";
  return lines.join("\n");
}

async function readFileTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  progress(`读取 ${rel}…`);
  const got = await store.getBuffer(objectKey(projectId, rel));
  if (!got) throw new Error(`找不到文件：${rel}`);
  if (got.buffer.length > 1_500_000) throw new Error(`文件太大，不能整份读：${rel}`);
  if (isProbablyBinary(rel, got.buffer)) throw new Error(`这是二进制文件，不能当文本读：${rel}（${got.buffer.length} 字节）`);
  const lines = got.buffer.toString("utf8").split("\n");
  const offset = Math.max(1, Number(args.offset || 1));
  const limit = Math.min(800, Math.max(1, Number(args.limit || 400)));
  if (offset > lines.length) return `文件 ${rel} 一共 ${lines.length} 行，offset ${offset} 已经超出末尾`;
  const end = Math.min(lines.length, offset - 1 + limit);
  const slice = lines.slice(offset - 1, end).join("\n");
  return `文件 ${rel} · 第 ${offset}-${end} 行，共 ${lines.length} 行\n下面是原文，没有行号。\n\n${slice}`;
}

async function writeFileTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  const content = asText(args.content);
  if (content.length > 1_000_000) throw new Error("内容超过 100 万字符");
  const key = objectKey(projectId, rel);
  const existed = await store.head(key);
  progress(`${existed ? "覆盖" : "写入"} ${rel}（${content.length} 字符）…`);
  await store.put(key, content, contentTypeFor(rel));
  await store.touch(projectId);
  return `${existed ? "已覆盖" : "已写入"} ${rel}（${content.length} 字符）`;
}

async function editFileTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  const key = objectKey(projectId, rel);
  const got = await store.getBuffer(key);
  if (!got) throw new Error(`找不到文件：${rel}`);
  if (isProbablyBinary(rel, got.buffer)) throw new Error(`不能编辑二进制文件：${rel}`);
  const before = got.buffer.toString("utf8");
  progress(`编辑 ${rel}…`);
  if (typeof args.old_string !== "string" || typeof args.new_string !== "string") {
    throw new Error("old_string 和 new_string 都必须是字符串");
  }
  const after = applyEdit(before, args.old_string, args.new_string);
  await store.put(key, after, contentTypeFor(rel));
  await store.touch(projectId);
  return `已编辑 ${rel}\n${compactDiff(rel, before, after)}`;
}

async function deleteFileTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  const key = objectKey(projectId, rel);
  progress(`删除 ${rel}…`);
  if (await store.head(key)) {
    await store.del(key);
    await store.touch(projectId);
    return `已删除 ${rel}`;
  }
  const kids = await store.listAll(`${key}/`);
  if (!kids.length) throw new Error(`找不到：${rel}`);
  if (!args.recursive) throw new Error(`这是目录。要连内容一起删除，请把 recursive 设为 true：${rel}`);
  await store.deleteKeys(kids.map((item) => item.key));
  await store.touch(projectId);
  return `已删除目录 ${rel}/（${kids.length} 个对象）`;
}

async function moveFileTool(store, projectId, args, progress) {
  const from = normalizeRel(args.from);
  const to = normalizeRel(args.to);
  if (!from || !to) throw new Error("from 和 to 不能为空");
  if (from === to) throw new Error("源路径和目标路径相同");
  progress(`移动 ${from} → ${to}…`);
  const fromKey = objectKey(projectId, from);
  const toKey = objectKey(projectId, to);
  const file = await store.getBuffer(fromKey);
  if (file) {
    if (await store.head(toKey)) throw new Error("目标已存在");
    await store.put(toKey, file.buffer, file.contentType || contentTypeFor(to));
    await store.del(fromKey);
    await store.touch(projectId);
    return `已移动 ${from} -> ${to}`;
  }
  const kids = await store.listAll(`${fromKey}/`);
  if (!kids.length) throw new Error("找不到文件或目录");
  if ((await store.listAll(`${toKey}/`)).length || await store.head(toKey)) throw new Error("目标已存在");
  for (const item of kids) {
    const rest = item.key.slice(`${fromKey}/`.length);
    const buf = await store.getBuffer(item.key);
    if (!buf) continue;
    await store.put(`${toKey}/${rest}`, buf.buffer, buf.contentType || "application/octet-stream");
  }
  await store.deleteKeys(kids.map((item) => item.key));
  await store.touch(projectId);
  return `已移动目录 ${from}/ -> ${to}/（${kids.length} 个对象）`;
}

async function mkdirTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  progress(`创建目录 ${rel}/…`);
  const prefix = `${filesPrefix(projectId)}${rel}/`;
  if ((await store.listAll(prefix)).length) return `目录已存在：${rel}/`;
  await store.put(`${prefix}.keep`, "", "text/plain; charset=utf-8");
  await store.touch(projectId);
  return `已创建目录 ${rel}/`;
}

async function searchFiles(store, projectId, args, progress) {
  const query = String(args.query || "");
  if (!query.trim()) throw new Error("query 不能为空");
  if (query.length > 200) throw new Error("query 太长");
  const rel = normalizeRel(args.path || "");
  let targets = [];
  if (rel) {
    const one = await store.getBuffer(objectKey(projectId, rel));
    if (one) targets = [{ key: objectKey(projectId, rel), size: one.size, preset: one }];
  }
  if (!targets.length) {
    const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
    targets = await store.listAll(prefix);
  }
  const needle = query.toLowerCase();
  const hits = [];
  let scanned = 0;
  let downloaded = 0;
  let skipped = 0;
  for (const item of targets) {
    const fileRel = relOf(projectId, item.key);
    if (!fileRel || fileRel.split("/").pop() === ".keep") continue;
    if (args.glob && !matchGlob(fileRel, args.glob)) continue;
    if (item.size > 200_000) {
      skipped += 1;
      continue;
    }
    if (scanned >= 150 || downloaded >= 1_500_000 || hits.length >= 40) {
      skipped += 1;
      continue;
    }
    if (scanned % 10 === 0 && scanned > 0) progress(`已扫描 ${scanned} 个文件，找到 ${hits.length} 处匹配…`);
    const got = item.preset || await store.getBuffer(item.key);
    if (!got) continue;
    if (isProbablyBinary(fileRel, got.buffer)) continue;
    scanned += 1;
    downloaded += got.buffer.length;
    const lines = got.buffer.toString("utf8").split("\n");
    lines.forEach((line, index) => {
      if (hits.length >= 40) return;
      if (line.toLowerCase().includes(needle)) {
        hits.push(`${fileRel}:${index + 1}: ${line.trim().slice(0, 240)}`);
      }
    });
  }
  if (!hits.length) return skipped ? "没有匹配。还有文件因为过大或数量上限没有扫描。" : "没有匹配";
  const tail = skipped ? "\n还有文件因为过大或数量上限没有扫描。" : "";
  return `找到 ${hits.length} 处\n${hits.join("\n")}${tail}`;
}

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const BLOCKED_PREFIXES = ["10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "192.168.", "169.254."];

function assertSafeUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error("URL 格式不合法"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("只支持 http/https 协议");
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error(`不允许访问内网地址：${host}`);
  if (BLOCKED_PREFIXES.some((p) => host.startsWith(p))) throw new Error(`不允许访问内网地址：${host}`);
  if (/^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(host)) throw new Error(`不允许访问内网地址：${host}`);
  return parsed.href;
}

function isBinaryContentType(ct) {
  if (!ct) return false;
  const lower = ct.toLowerCase();
  return lower.startsWith("image/") || lower.startsWith("video/") || lower.startsWith("audio/")
    || lower.includes("octet-stream") || lower.includes("zip") || lower.includes("pdf");
}

async function fetchUrl(args, progress) {
  const safeUrl = assertSafeUrl(String(args.url || ""));
  const method = (args.method || "GET").toUpperCase();
  const timeoutSec = Math.min(30, Math.max(1, Number(args.timeout || 15)));
  progress(`${method} ${safeUrl}…`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  let response;
  try {
    const reqInit = {
      method,
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Quay-Agent/1.0",
        Accept: "text/html,application/json,text/plain,*/*;q=0.8",
        ...(args.headers || {}),
      },
    };
    if (args.body && ["POST", "PUT", "PATCH"].includes(method)) reqInit.body = String(args.body);
    response = await fetch(safeUrl, reqInit);
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`请求超时（${timeoutSec}s）：${safeUrl}`);
    throw new Error(`网络错误：${error.message}`);
  } finally {
    clearTimeout(timer);
  }
  const ct = response.headers.get("content-type") || "";
  const status = `${response.status} ${response.statusText}`;
  if (isBinaryContentType(ct)) {
    return `${status} | Content-Type: ${ct} | 二进制内容，无法显示。`;
  }
  const text = await response.text();
  const MAX = 50000;
  const body = text.length > MAX ? text.slice(0, MAX) + `\n…[已截断，共 ${text.length} 字符]` : text;
  // strip excessive whitespace for HTML
  const cleaned = ct.includes("html")
    ? body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s{3,}/g, "\n\n").trim()
    : body;
  return `HTTP ${status}\nContent-Type: ${ct}\nURL: ${safeUrl}\n\n${cleaned}`;
}


export async function executeTool(store, projectId, name, args, onProgress) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  switch (name) {
    case "list_files": return listFiles(store, projectId, args || {}, progress);
    case "read_file": return readFileTool(store, projectId, args || {}, progress);
    case "write_file": return writeFileTool(store, projectId, args || {}, progress);
    case "edit_file": return editFileTool(store, projectId, args || {}, progress);
    case "delete_file": return deleteFileTool(store, projectId, args || {}, progress);
    case "move_file": return moveFileTool(store, projectId, args || {}, progress);
    case "mkdir": return mkdirTool(store, projectId, args || {}, progress);
    case "search_files": return searchFiles(store, projectId, args || {}, progress);
    case "fetch_url": return fetchUrl(args || {}, progress);
    default: throw new Error(`没有这个工具：${name}`);
  }
}
