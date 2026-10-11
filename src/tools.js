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
      name: "read_file_full",
      description: "读取整个文件的完整内容，不分段，不截断行。适合 150KB 以内的文件。比 read_file 更适合需要完整阅读的场景。",
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
      name: "grep",
      description: "在文件或目录里用正则表达式搜索，返回匹配行及行号。比 search_files 更精准，支持正则。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string", description: "JavaScript 正则表达式字符串，不带 / /。" },
          path: { type: "string", description: "可选，限定文件或目录。" },
          case_sensitive: { type: "boolean", description: "是否区分大小写，默认 false。" },
          max_results: { type: "integer", description: "最多返回多少条，默认 60。" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "outline",
      description: "提取代码文件的骨架：函数、类、方法定义行。快速了解大文件结构，不需要读完整内容。支持 Python、JS/TS、Go、Rust、Java、C/C++ 等。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "文件路径。" },
        },
        required: ["path"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "diff_files",
      description: "对比项目里两个文件，输出 unified diff。不需要先读文件内容，直接调用即可。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path_a: { type: "string", description: "第一个文件的路径（原始）。" },
          path_b: { type: "string", description: "第二个文件的路径（新版）。" },
          context: { type: "integer", description: "上下文行数，默认 5。" },
        },
        required: ["path_a", "path_b"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "batch_read",
      description: "一次读取多个文件的完整内容，合并返回。省去多轮工具调用。每个文件最大 80KB。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "文件路径列表，最多 8 个。",
          },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_definition",
      description: "在代码文件里定位函数、类、变量的定义位置，返回匹配行及上下文。比 grep 更语义化，自动生成合适的搜索模式。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string", description: "要查找的函数名、类名或变量名。" },
          path: { type: "string", description: "可选，限定搜索范围到某个文件或目录。" },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_symbol",
      description: "在项目里全局重命名一个标识符（函数名、变量名、类名等）。会在所有文本文件里做精确的词边界替换。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          old_name: { type: "string", description: "当前的名字。" },
          new_name: { type: "string", description: "新名字。" },
          path: { type: "string", description: "可选，限定范围到某个文件或目录。" },
          extensions: {
            type: "array",
            items: { type: "string" },
            description: "可选，只在这些扩展名的文件里替换，例如 [\".py\", \".js\"]。",
          },
        },
        required: ["old_name", "new_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stats",
      description: "统计项目或目录的文件数量、行数、各语言占比。快速了解项目规模。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "可选，限定统计范围。空表示整个项目。" },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "insert_lines",
      description: "在文件指定行号之后插入若干行文本。比 edit_file 更适合纯插入操作。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          after_line: { type: "integer", description: "在第几行之后插入，0 表示在文件开头插入。" },
          content: { type: "string", description: "要插入的文本内容。" },
        },
        required: ["path", "after_line", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_lines",
      description: "替换文件中指定行范围（含首尾行）的内容。适合整块代码替换。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          start_line: { type: "integer", description: "开始行（1 起算，含）。" },
          end_line: { type: "integer", description: "结束行（含）。" },
          content: { type: "string", description: "替换成的新内容。" },
        },
        required: ["path", "start_line", "end_line", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "todo_scan",
      description: "扫描项目里所有 TODO、FIXME、HACK、XXX、BUG 注释，按文件汇总输出。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "可选，限定扫描范围。" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "可选，只查这些标签，如 [\"TODO\",\"FIXME\"]。默认全部。",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dependency_graph",
      description: "分析项目里的 import/require 关系，输出文件依赖图（谁引用了谁）。支持 JS/TS/Python。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "可选，限定分析范围。" },
          format: { type: "string", enum: ["list", "tree"], description: "输出格式：list 逐条列出，tree 缩进树形。默认 list。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_detect",
      description: "检测项目里的重复或高度相似的代码块（按函数/类级别）。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "可选，限定范围。" },
          min_lines: { type: "integer", description: "最少多少行才算重复块，默认 6。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_file",
      description: "根据模板描述生成新文件内容，写入到指定路径。适合快速创建样板代码（如 React 组件、Python class、Go handler 等）。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "要生成的文件路径。" },
          template: { type: "string", description: "描述要生成什么，例如：'Python FastAPI router，包含 GET /items 和 POST /items'。" },
          context: { type: "string", description: "可选的上下文说明，例如项目已有的类名、风格约定等。" },
        },
        required: ["path", "template"],
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

export const MUTATING_TOOLS = new Set(["write_file", "edit_file", "delete_file", "move_file", "mkdir", "rename_symbol", "insert_lines", "replace_lines", "generate_file"]);

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

async function readFileFullTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  progress(`完整读取 ${rel}…`);
  const got = await store.getBuffer(objectKey(projectId, rel));
  if (!got) throw new Error(`找不到文件：${rel}`);
  const MAX = 150_000;
  if (got.buffer.length > MAX) throw new Error(`文件太大（${got.buffer.length} 字节），超过 150KB 限制。请用 read_file 分段读取，或用 outline 先看结构。`);
  if (isProbablyBinary(rel, got.buffer)) throw new Error(`这是二进制文件：${rel}`);
  const text = got.buffer.toString("utf8");
  const lines = text.split("\n");
  return `文件 ${rel} 完整内容（共 ${lines.length} 行，${got.buffer.length} 字节）\n\n${text}`;
}

async function grepTool(store, projectId, args, progress) {
  const pattern = String(args.pattern || "");
  if (!pattern) throw new Error("pattern 不能为空");
  let re;
  try {
    re = new RegExp(pattern, args.case_sensitive ? "" : "i");
  } catch (e) {
    throw new Error(`正则表达式不合法：${e.message}`);
  }
  const maxResults = Math.min(200, Math.max(1, Number(args.max_results || 60)));
  const rel = normalizeRel(args.path || "");
  progress(`搜索 /${pattern}/ in ${rel || "项目根目录"}…`);

  let targets = [];
  if (rel) {
    const key = objectKey(projectId, rel);
    const single = await store.getBuffer(key);
    if (single) targets = [{ key, size: single.buffer.length, preset: single }];
  }
  if (!targets.length) {
    const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
    targets = await store.listAll(prefix);
  }

  const hits = [];
  let scanned = 0;
  for (const item of targets) {
    const fileRel = item.key.slice(filesPrefix(projectId).length);
    if (!fileRel || fileRel.split("/").pop() === ".keep") continue;
    if (item.size > 500_000) continue;
    if (hits.length >= maxResults) break;
    const got = item.preset || await store.getBuffer(item.key);
    if (!got || isProbablyBinary(fileRel, got.buffer)) continue;
    scanned++;
    const lines = got.buffer.toString("utf8").split("\n");
    for (let i = 0; i < lines.length && hits.length < maxResults; i++) {
      if (re.test(lines[i])) {
        hits.push(`${fileRel}:${i + 1}: ${lines[i].trimEnd().slice(0, 300)}`);
      }
    }
  }
  if (!hits.length) return `没有找到 /${pattern}/（扫描了 ${scanned} 个文件）`;
  return `找到 ${hits.length} 处匹配（扫描 ${scanned} 个文件）\n${hits.join("\n")}`;
}

const OUTLINE_PATTERNS = [
  // Python
  { re: /^(async\s+)?def\s+\w+|^class\s+\w+/, label: "py" },
  // JS/TS
  { re: /^(export\s+)?(default\s+)?(async\s+)?function\s+\w+|^(export\s+)?(default\s+)?class\s+\w+|(const|let|var)\s+\w+\s*=\s*(async\s+)?\(|^\s+(async\s+)?\w+\s*\(.*\)\s*\{/, label: "js" },
  // Go
  { re: /^func\s+/, label: "go" },
  // Rust
  { re: /^(pub\s+)?(async\s+)?fn\s+\w+|^(pub\s+)?struct\s+\w+|^(pub\s+)?impl\s+/, label: "rs" },
  // Java / C#
  { re: /^\s*(public|private|protected|static|abstract|override|async)\s+.*\s+\w+\s*\(/, label: "java" },
  // C/C++
  { re: /^\w[\w\s\*]+\w\s*\([^;]*\)\s*\{?$/, label: "c" },
];

async function outlineTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  progress(`提取 ${rel} 骨架…`);
  const got = await store.getBuffer(objectKey(projectId, rel));
  if (!got) throw new Error(`找不到文件：${rel}`);
  if (isProbablyBinary(rel, got.buffer)) throw new Error(`不能分析二进制文件：${rel}`);
  const lines = got.buffer.toString("utf8").split("\n");
  const ext = rel.split(".").pop()?.toLowerCase() || "";
  // pick patterns relevant to extension
  const patterns = OUTLINE_PATTERNS.filter(p => {
    if (["py"].includes(ext)) return p.label === "py";
    if (["js", "ts", "jsx", "tsx", "mjs", "cjs"].includes(ext)) return p.label === "js";
    if (ext === "go") return p.label === "go";
    if (ext === "rs") return p.label === "rs";
    if (["java", "cs"].includes(ext)) return p.label === "java";
    if (["c", "cpp", "h", "hpp"].includes(ext)) return p.label === "c";
    return true; // try all for unknown extensions
  });

  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (patterns.some(p => p.re.test(line)) && line.trim().length > 2) {
      hits.push(`${String(i + 1).padStart(5)}: ${line.trimEnd().slice(0, 200)}`);
    }
  }
  if (!hits.length) return `${rel} 共 ${lines.length} 行，未识别到函数/类定义。可以用 read_file 逐段阅读。`;
  return `${rel} 骨架（共 ${lines.length} 行，${hits.length} 个定义）\n\n${hits.join("\n")}`;
}


// ─── insert_lines ───────────────────────────────────────────
async function insertLines(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  const afterLine = Math.max(0, Number(args.after_line || 0));
  const content = asText(args.content);
  progress(`在 ${rel} 第 ${afterLine} 行后插入…`);
  const got = await store.getBuffer(objectKey(projectId, rel));
  if (!got) throw new Error(`找不到文件：${rel}`);
  if (isProbablyBinary(rel, got.buffer)) throw new Error(`不能编辑二进制文件：${rel}`);
  const lines = got.buffer.toString("utf8").split("\n");
  if (afterLine > lines.length) throw new Error(`after_line (${afterLine}) 超过文件总行数 (${lines.length})`);
  const newLines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  lines.splice(afterLine, 0, ...newLines);
  const after = lines.join("\n");
  await store.put(objectKey(projectId, rel), after, contentTypeFor(rel));
  await store.touch(projectId);
  return `已在 ${rel} 第 ${afterLine} 行后插入 ${newLines.length} 行，文件现共 ${lines.length} 行`;
}

// ─── replace_lines ──────────────────────────────────────────
async function replaceLines(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  const start = Math.max(1, Number(args.start_line || 1));
  const end = Math.max(start, Number(args.end_line || start));
  const content = asText(args.content);
  progress(`替换 ${rel} 第 ${start}-${end} 行…`);
  const got = await store.getBuffer(objectKey(projectId, rel));
  if (!got) throw new Error(`找不到文件：${rel}`);
  if (isProbablyBinary(rel, got.buffer)) throw new Error(`不能编辑二进制文件：${rel}`);
  const lines = got.buffer.toString("utf8").split("\n");
  if (end > lines.length) throw new Error(`end_line (${end}) 超过文件总行数 (${lines.length})`);
  const newLines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  lines.splice(start - 1, end - start + 1, ...newLines);
  const after = lines.join("\n");
  await store.put(objectKey(projectId, rel), after, contentTypeFor(rel));
  await store.touch(projectId);
  return `已替换 ${rel} 第 ${start}-${end} 行（${end - start + 1} 行 → ${newLines.length} 行），文件现共 ${lines.length} 行`;
}

// ─── todo_scan ──────────────────────────────────────────────
async function todoScan(store, projectId, args, progress) {
  const rel = normalizeRel(args.path || "");
  const tags = (args.tags || ["TODO", "FIXME", "HACK", "XXX", "BUG"]).map(t => String(t).toUpperCase());
  const tagPattern = new RegExp(`\\b(${tags.join("|")})\\b[:\\s]?(.*)`, "i");
  progress("扫描 TODO/FIXME…");
  const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
  const all = await store.listAll(prefix);
  const byFile = {};
  for (const item of all) {
    const fileRel = item.key.slice(filesPrefix(projectId).length);
    if (!fileRel || fileRel.split("/").pop() === ".keep") continue;
    if (item.size > 300_000) continue;
    const got = await store.getBuffer(item.key);
    if (!got || isProbablyBinary(fileRel, got.buffer)) continue;
    const lines = got.buffer.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = tagPattern.exec(lines[i]);
      if (!m) continue;
      if (!byFile[fileRel]) byFile[fileRel] = [];
      byFile[fileRel].push(`  L${i + 1} [${m[1].toUpperCase()}] ${m[2].trim().slice(0, 120)}`);
    }
  }
  const files = Object.keys(byFile);
  if (!files.length) return `没有找到 ${tags.join("/")} 注释`;
  const total = Object.values(byFile).reduce((s, a) => s + a.length, 0);
  const out = files.map(f => `${f}\n${byFile[f].join("\n")}`).join("\n\n");
  return `共 ${total} 条 ${tags.join("/")} （${files.length} 个文件）\n\n${out}`;
}

// ─── dependency_graph ───────────────────────────────────────
const IMPORT_RE = {
  js: [
    /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/,
    /^\s*(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    /^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  ],
  py: [
    /^\s*from\s+([\w.]+)\s+import/,
    /^\s*import\s+([\w.]+)/,
  ],
};

async function dependencyGraph(store, projectId, args, progress) {
  const rel = normalizeRel(args.path || "");
  const format = args.format === "tree" ? "tree" : "list";
  progress("分析 import 依赖…");
  const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
  const all = await store.listAll(prefix);
  const graph = {};
  for (const item of all) {
    const fileRel = item.key.slice(filesPrefix(projectId).length);
    if (!fileRel) continue;
    const ext = fileRel.split(".").pop().toLowerCase();
    let patterns;
    if (["js", "ts", "jsx", "tsx", "mjs", "cjs"].includes(ext)) patterns = IMPORT_RE.js;
    else if (ext === "py") patterns = IMPORT_RE.py;
    else continue;
    if (item.size > 200_000) continue;
    const got = await store.getBuffer(item.key);
    if (!got || isProbablyBinary(fileRel, got.buffer)) continue;
    const deps = new Set();
    for (const line of got.buffer.toString("utf8").split("\n")) {
      for (const re of patterns) {
        const m = re.exec(line);
        if (m) { deps.add(m[1]); break; }
      }
    }
    if (deps.size) graph[fileRel] = [...deps];
  }
  if (!Object.keys(graph).length) return "没有找到可分析的 import 语句";
  const lines = Object.entries(graph).map(([file, deps]) =>
    `${file}\n${deps.map(d => `  → ${d}`).join("\n")}`
  );
  return `依赖关系（${Object.keys(graph).length} 个文件）\n\n${lines.join("\n\n")}`;
}

// ─── duplicate_detect ───────────────────────────────────────
async function duplicateDetect(store, projectId, args, progress) {
  const rel = normalizeRel(args.path || "");
  const minLines = Math.max(4, Number(args.min_lines || 6));
  progress("检测重复代码块…");
  const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
  const all = await store.listAll(prefix);
  // collect all non-empty non-blank lines with file+linenum
  const blocks = []; // {hash, file, start, lines[]}
  for (const item of all) {
    const fileRel = item.key.slice(filesPrefix(projectId).length);
    if (!fileRel || item.size > 200_000) continue;
    const got = await store.getBuffer(item.key);
    if (!got || isProbablyBinary(fileRel, got.buffer)) continue;
    const lines = got.buffer.toString("utf8").split("\n");
    // sliding window of minLines
    for (let i = 0; i <= lines.length - minLines; i++) {
      const chunk = lines.slice(i, i + minLines).map(l => l.trim()).filter(l => l.length > 2);
      if (chunk.length < minLines) continue;
      const key = chunk.join("\n");
      blocks.push({ key, file: fileRel, start: i + 1 });
    }
  }
  // find duplicates
  const seen = new Map();
  for (const b of blocks) {
    if (!seen.has(b.key)) seen.set(b.key, []);
    seen.get(b.key).push(`${b.file}:${b.start}`);
  }
  const dups = [...seen.entries()].filter(([, locs]) => locs.length > 1);
  if (!dups.length) return `没有发现 ${minLines}+ 行的重复块`;
  const out = dups.slice(0, 20).map(([code, locs], i) => {
    const preview = code.split("\n").slice(0, 3).join("\n").slice(0, 200);
    return `[${i + 1}] 重复于 ${locs.length} 处：${locs.join("、")}\n${preview}`;
  }).join("\n\n");
  return `发现 ${dups.length} 组重复（展示前 20 组）\n\n${out}`;
}

// ─── generate_file ──────────────────────────────────────────
// This tool writes a placeholder and instructs the model to fill in.
// The model itself generates content—no extra LLM call needed here.
async function generateFile(store, projectId, args, progress) {
  const rel = normalizeRel(args.path);
  if (!rel) throw new Error("path 不能为空");
  const existing = await store.head(objectKey(projectId, rel));
  if (existing) throw new Error(`文件已存在：${rel}。如需覆盖请先 delete_file 或直接用 write_file。`);
  // Return a prompt for the model to now call write_file with full content
  const ctx = args.context ? `\n上下文：${args.context}` : "";
  return `请你现在调用 write_file 把以下文件写入到 ${rel}：\n模板要求：${args.template}${ctx}\n\n请直接生成完整内容并写入，不要再询问。`;
}


// ─── diff_files ────────────────────────────────────────────
async function diffFiles(store, projectId, args, progress) {
  const relA = normalizeRel(args.path_a);
  const relB = normalizeRel(args.path_b);
  if (!relA || !relB) throw new Error("path_a 和 path_b 都不能为空");
  progress(`对比 ${relA} ↔ ${relB}…`);
  const [gotA, gotB] = await Promise.all([
    store.getBuffer(objectKey(projectId, relA)),
    store.getBuffer(objectKey(projectId, relB)),
  ]);
  if (!gotA) throw new Error(`找不到文件：${relA}`);
  if (!gotB) throw new Error(`找不到文件：${relB}`);
  if (isProbablyBinary(relA, gotA.buffer)) throw new Error(`${relA} 是二进制文件`);
  if (isProbablyBinary(relB, gotB.buffer)) throw new Error(`${relB} 是二进制文件`);
  const a = gotA.buffer.toString("utf8").split("\n");
  const b = gotB.buffer.toString("utf8").split("\n");
  const ctx = Math.max(1, Math.min(20, Number(args.context || 5)));
  // simple LCS-based diff
  const patch = unifiedDiff(a, b, relA, relB, ctx);
  if (!patch) return `两个文件内容完全相同：${relA} ↔ ${relB}`;
  return patch.length > 30000 ? patch.slice(0, 30000) + "\n…[已截断]" : patch;
}

function unifiedDiff(aLines, bLines, nameA, nameB, ctx) {
  // Myers diff O(ND) - simplified
  const m = aLines.length, n = bLines.length;
  const max = m + n;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  let found = false;
  outer: for (let d = 0; d <= max; d++) {
    const snap = new Int32Array(v);
    trace.push(snap);
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max;
      let x;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) x = v[ki + 1];
      else x = v[ki - 1] + 1;
      let y = x - k;
      while (x < m && y < n && aLines[x] === bLines[y]) { x++; y++; }
      v[ki] = x;
      if (x >= m && y >= n) { found = true; break outer; }
    }
  }
  if (!found) return null;
  // backtrack
  const ops = []; // {type:'=','+'|'-', a, b}
  let x = m, y = n;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d];
    const ki = (x - y) + max;
    let prevK;
    if (d === 0) { prevK = ki; }
    else if ((x - y) === -d || ((x - y) !== d && snap[ki - 1] < snap[ki + 1])) prevK = ki + 1;
    else prevK = ki - 1;
    const prevX = snap[prevK], prevY = prevX - (prevK - max);
    while (x > prevX && y > prevY) { x--; y--; ops.push({ t: "=", a: x, b: y }); }
    if (d > 0) {
      if (prevK === ki + 1) { y--; ops.push({ t: "+", b: y }); }
      else { x--; ops.push({ t: "-", a: x }); }
    }
  }
  ops.reverse();
  // build hunks
  const changes = ops.filter(o => o.t !== "=");
  if (!changes.length) return null;
  const lines = [`--- a/${nameA}`, `+++ b/${nameB}`];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === "=") { i++; continue; }
    const start = Math.max(0, i - ctx);
    let end = i;
    while (end < ops.length && (ops[end].t !== "=" || end - i < ctx)) end++;
    end = Math.min(ops.length, end + ctx);
    let aStart = ops[start].a ?? (ops[start].b ?? 0);
    const hunk = [];
    for (let j = start; j < end; j++) {
      const op = ops[j];
      if (op.t === "=") hunk.push(` ${aLines[op.a]}`);
      else if (op.t === "-") hunk.push(`-${aLines[op.a]}`);
      else hunk.push(`+${bLines[op.b]}`);
    }
    lines.push(`@@ -${aStart + 1} +${aStart + 1} @@`);
    lines.push(...hunk);
    i = end;
  }
  return lines.join("\n");
}

// ─── batch_read ────────────────────────────────────────────
async function batchRead(store, projectId, args, progress) {
  const paths = (args.paths || []).slice(0, 8);
  if (!paths.length) throw new Error("paths 不能为空");
  const MAX_EACH = 80_000;
  const results = [];
  for (const p of paths) {
    const rel = normalizeRel(p);
    progress(`读取 ${rel}…`);
    const got = await store.getBuffer(objectKey(projectId, rel));
    if (!got) { results.push(`=== ${rel} ===\n[找不到文件]`); continue; }
    if (isProbablyBinary(rel, got.buffer)) { results.push(`=== ${rel} ===\n[二进制文件，跳过]`); continue; }
    const text = got.buffer.toString("utf8");
    const body = text.length > MAX_EACH ? text.slice(0, MAX_EACH) + `\n…[已截断，共 ${text.length} 字符]` : text;
    results.push(`=== ${rel} (${got.buffer.length} 字节) ===\n${body}`);
  }
  return results.join("\n\n");
}

// ─── find_definition ───────────────────────────────────────
async function findDefinition(store, projectId, args, progress) {
  const symbol = String(args.symbol || "").trim();
  if (!symbol) throw new Error("symbol 不能为空");
  if (!/^[\w$.\-]+$/.test(symbol)) throw new Error("symbol 只能包含字母、数字、下划线、$、-、点");
  const rel = normalizeRel(args.path || "");
  progress(`查找定义 ${symbol}…`);

  // build patterns for common definition styles
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^(async\\s+)?def\\s+${escaped}\\s*\\(`),           // Python def
    new RegExp(`^class\\s+${escaped}[\\s:(]`),                      // Python/JS class
    new RegExp(`(function\\s+${escaped}|${escaped}\\s*[:=]\\s*(async\\s+)?function|${escaped}\\s*[:=]\\s*(async\\s+)?\\()`), // JS function
    new RegExp(`^(pub\\s+)?(async\\s+)?fn\\s+${escaped}\\s*[<(]`), // Rust
    new RegExp(`^func\\s+\\S*\\s*${escaped}\\s*\\(`),               // Go
    new RegExp(`(const|let|var|export)\\s+(const\\s+)?${escaped}\\s*=`), // JS const/let
    new RegExp(`^\\s*${escaped}\\s*\\(`),                           // method call-like def
  ];

  let targets = [];
  if (rel) {
    const key = objectKey(projectId, rel);
    const single = await store.getBuffer(key);
    if (single) targets = [{ key, size: single.buffer.length, preset: single }];
  }
  if (!targets.length) {
    const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
    targets = await store.listAll(prefix);
  }

  const CTX = 3;
  const hits = [];
  for (const item of targets) {
    const fileRel = item.key.slice(filesPrefix(projectId).length);
    if (!fileRel || fileRel.split("/").pop() === ".keep") continue;
    if (hits.length >= 20) break;
    const got = item.preset || await store.getBuffer(item.key);
    if (!got || isProbablyBinary(fileRel, got.buffer)) continue;
    const lines = got.buffer.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (patterns.some(p => p.test(lines[i]))) {
        const from = Math.max(0, i - 1);
        const to = Math.min(lines.length, i + CTX + 1);
        const snippet = lines.slice(from, to).map((l, j) => `${from + j + 1}: ${l}`).join("\n");
        hits.push(`\n📍 ${fileRel}:${i + 1}\n${snippet}`);
      }
    }
  }
  if (!hits.length) return `没有找到 ${symbol} 的定义。试试用 grep 搜索更宽泛的模式。`;
  return `找到 ${hits.length} 处定义\n${hits.join("\n")}`;
}

// ─── rename_symbol ─────────────────────────────────────────
async function renameSymbol(store, projectId, args, progress) {
  const oldName = String(args.old_name || "").trim();
  const newName = String(args.new_name || "").trim();
  if (!oldName || !newName) throw new Error("old_name 和 new_name 都不能为空");
  if (oldName === newName) throw new Error("新旧名字相同");
  if (!/^[\w$]+$/.test(oldName) || !/^[\w$]+$/.test(newName)) throw new Error("名字只能包含字母、数字、下划线、$");
  const rel = normalizeRel(args.path || "");
  const exts = (args.extensions || []).map(e => String(e).toLowerCase());
  progress(`重命名 ${oldName} → ${newName}…`);

  const prefix = rel ? (await store.head(objectKey(projectId, rel))
    ? null : `${filesPrefix(projectId)}${rel}/`)
    : filesPrefix(projectId);

  let targets;
  if (!prefix) {
    targets = [{ key: objectKey(projectId, rel) }];
  } else {
    targets = await store.listAll(prefix);
  }

  const re = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  let changed = 0;
  const changedFiles = [];
  for (const item of targets) {
    const fileRel = item.key.slice(filesPrefix(projectId).length);
    if (!fileRel) continue;
    const ext = "." + fileRel.split(".").pop().toLowerCase();
    if (exts.length && !exts.includes(ext)) continue;
    const got = await store.getBuffer(item.key);
    if (!got || isProbablyBinary(fileRel, got.buffer)) continue;
    const before = got.buffer.toString("utf8");
    if (!re.test(before)) { re.lastIndex = 0; continue; }
    re.lastIndex = 0;
    const after = before.replace(re, newName);
    const count = (before.match(re) || []).length;
    re.lastIndex = 0;
    await store.put(item.key, after, contentTypeFor(fileRel));
    changed += count;
    changedFiles.push(`  ${fileRel}（${count} 处）`);
  }
  if (!changedFiles.length) return `没有找到 ${oldName}（词边界匹配），没有修改任何文件。`;
  await store.touch(projectId);
  return `已将 ${oldName} 重命名为 ${newName}，共修改 ${changedFiles.length} 个文件，${changed} 处替换：\n${changedFiles.join("\n")}`;
}

// ─── stats ─────────────────────────────────────────────────
const LANG_EXT = {
  ".py": "Python", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".jsx": "JavaScript",
  ".go": "Go", ".rs": "Rust", ".java": "Java", ".cs": "C#",
  ".c": "C", ".cpp": "C++", ".h": "C/C++", ".hpp": "C++",
  ".rb": "Ruby", ".php": "PHP", ".swift": "Swift", ".kt": "Kotlin",
  ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".less": "Less",
  ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
  ".md": "Markdown", ".txt": "Text", ".sh": "Shell", ".bash": "Shell",
  ".sql": "SQL", ".vue": "Vue", ".svelte": "Svelte",
};

async function statsTool(store, projectId, args, progress) {
  const rel = normalizeRel(args.path || "");
  const prefix = rel ? `${filesPrefix(projectId)}${rel}/` : filesPrefix(projectId);
  progress("统计项目文件…");
  const all = await store.listAll(prefix);
  const files = all.filter(item => {
    const name = item.key.split("/").pop();
    return name && name !== ".keep";
  });

  const langCount = {};
  const langLines = {};
  let totalFiles = 0, totalSize = 0, totalLines = 0;
  let binaryCount = 0;
  const sampleSize = Math.min(files.length, 200);

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const fileRel = item.key.slice(filesPrefix(projectId).length);
    const ext = "." + (fileRel.split(".").pop() || "").toLowerCase();
    const lang = LANG_EXT[ext] || "Other";
    totalFiles++;
    totalSize += item.size || 0;
    langCount[lang] = (langCount[lang] || 0) + 1;

    if (i < sampleSize && item.size < 200_000) {
      const got = await store.getBuffer(item.key);
      if (got && !isProbablyBinary(fileRel, got.buffer)) {
        const lines = got.buffer.toString("utf8").split("\n").length;
        totalLines += lines;
        langLines[lang] = (langLines[lang] || 0) + lines;
      } else if (got) binaryCount++;
    }
  }

  const langTable = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .map(([lang, count]) => {
      const lines = langLines[lang] ? ` · ${langLines[lang].toLocaleString()} 行` : "";
      return `  ${lang.padEnd(14)} ${count} 文件${lines}`;
    }).join("\n");

  const sizeStr = totalSize < 1024 ? `${totalSize} B`
    : totalSize < 1048576 ? `${(totalSize / 1024).toFixed(1)} KB`
    : `${(totalSize / 1048576).toFixed(1)} MB`;

  return `项目统计${rel ? ` (${rel}/)` : ""}
文件总数：${totalFiles}（二进制 ${binaryCount}）
总大小：${sizeStr}
采样行数：${totalLines.toLocaleString()} 行（前 ${sampleSize} 个文件）

语言分布：
${langTable}`;
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
    case "read_file_full": return readFileFullTool(store, projectId, args || {}, progress);
    case "grep": return grepTool(store, projectId, args || {}, progress);
    case "outline": return outlineTool(store, projectId, args || {}, progress);
    case "diff_files": return diffFiles(store, projectId, args || {}, progress);
    case "batch_read": return batchRead(store, projectId, args || {}, progress);
    case "find_definition": return findDefinition(store, projectId, args || {}, progress);
    case "rename_symbol": return renameSymbol(store, projectId, args || {}, progress);
    case "stats": return statsTool(store, projectId, args || {}, progress);
    case "insert_lines": return insertLines(store, projectId, args || {}, progress);
    case "replace_lines": return replaceLines(store, projectId, args || {}, progress);
    case "todo_scan": return todoScan(store, projectId, args || {}, progress);
    case "dependency_graph": return dependencyGraph(store, projectId, args || {}, progress);
    case "duplicate_detect": return duplicateDetect(store, projectId, args || {}, progress);
    case "generate_file": return generateFile(store, projectId, args || {}, progress);
    case "fetch_url": return fetchUrl(args || {}, progress);
    default: throw new Error(`没有这个工具：${name}`);
  }
}
