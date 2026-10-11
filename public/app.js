const $ = (sel) => document.querySelector(sel);
const state = {
  projectId: localStorage.getItem("quayProject") || "",
  chatId: localStorage.getItem("quayChat") || "",
  chats: [],
  entries: new Map(),
  openDirs: new Set([""]),
  file: null,
  dirty: false,
  sending: false,
  abort: null,
  status: null,
};

const TOOL_LABEL = {
  list_files: "列出文件",
  read_file: "读取",
  write_file: "写入",
  edit_file: "编辑",
  delete_file: "删除",
  move_file: "移动",
  search_files: "搜索",
  mkdir: "新建目录",
};

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add("hidden"), 3200);
}

async function api(url, options = {}) {
  const opts = { ...options };
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string" && !(opts.body instanceof ArrayBuffer) && !ArrayBuffer.isView(opts.body)) {
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const response = await fetch(url, opts);
  if (response.status === 401) {
    showLogin();
    throw new Error("未登录");
  }
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || "请求失败");
  return data;
}

function showLogin() {
  $("#login").classList.remove("hidden");
  $("#app").classList.add("hidden");
}

function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
}

function setTab(tab) {
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  $("#chat-pane").classList.toggle("show", tab === "chat");
  $("#files-pane").classList.toggle("show", tab === "files");
  $("#chats-pane").classList.toggle("show", tab === "chats");
  if (window.matchMedia("(min-width: 981px)").matches) {
    $("#chat-pane").classList.add("show");
    $("#files-pane").classList.add("show");
    $("#chats-pane").classList.add("show");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch { /* ignore */ }
  return "";
}

function renderMarkdown(text) {
  const fences = [];
  let src = String(text || "").replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const token = `@@FENCE${fences.length}@@`;
    fences.push(`<pre class="code"><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return token;
  });
  src = escapeHtml(src);
  src = src.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  src = src.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  src = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    const href = safeUrl(url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  src = src.replace(/\n/g, "<br>");
  src = src.replace(/@@FENCE(\d+)@@/g, (_, index) => fences[Number(index)] || "");
  return src;
}

function formatSize(size) {
  const n = Number(size || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function toolTitle(seg) {
  const label = TOOL_LABEL[seg.name] || seg.name;
  const target = seg.args?.path || (seg.args?.from ? `${seg.args.from} -> ${seg.args.to || ""}` : seg.args?.query || "");
  return `${label} ${target}`.trim();
}

function renderSegments(container, segments) {
  const TOOL_LABEL = { list_files: "列出文件", read_file: "读取", write_file: "写入", edit_file: "编辑", delete_file: "删除", move_file: "移动", search_files: "搜索", mkdir: "新建目录" };
  const ICON_OK = `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M10.28 3.28a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06L4.25 8.19l4.97-4.97a.75.75 0 0 1 1.06.06Z"/></svg>`;
  const ICON_ERR = `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1Zm-.75 2.75a.75.75 0 0 1 1.5 0v2.5a.75.75 0 0 1-1.5 0v-2.5Zm.75 5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z"/></svg>`;
  const ICON_RUN = `<svg viewBox="0 0 12 12" fill="currentColor" style="animation:spin .8s linear infinite"><path d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1ZM2.5 6a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z" opacity=".3"/><path d="M6 1A5 5 0 0 1 11 6h-1.5A3.5 3.5 0 0 0 6 2.5V1Z"/></svg>`;
  container.innerHTML = "";
  for (const seg of segments || []) {
    if (seg.type === "text") {
      const node = document.createElement("div");
      node.innerHTML = renderMarkdown(seg.text);
      container.append(node);
    } else if (seg.type === "tool") {
      const sc = seg.status === "running" ? "running" : seg.ok === false ? "error" : "done";
      const details = document.createElement("details");
      details.className = `tool-card ${sc}`;
      details.open = sc !== "done";
      const summary = document.createElement("summary");
      const iconSpan = document.createElement("span");
      iconSpan.className = "tool-card-icon";
      iconSpan.innerHTML = sc === "error" ? ICON_ERR : sc === "running" ? ICON_RUN : ICON_OK;
      const labelSpan = document.createElement("span");
      const lname = TOOL_LABEL[seg.name] || seg.name;
      const tgt = seg.args?.path || (seg.args?.from ? `${seg.args.from} → ${seg.args.to || ""}` : seg.args?.query || "");
      labelSpan.textContent = tgt ? `${lname}  ${tgt}` : lname;
      const chip = document.createElement("span");
      chip.className = "tool-status";
      chip.textContent = sc === "running" ? "进行中" : sc === "error" ? "失败" : "完成";
      summary.append(iconSpan, labelSpan, chip);
      details.append(summary);
      if (seg.result) {
        const pre = document.createElement("pre");
        pre.textContent = seg.result;
        details.append(pre);
      }
      container.append(details);
    }
  }
}


function renderMessages(messages) {
  const root = $("#messages");
  root.innerHTML = "";
  if (!state.projectId) {
    root.innerHTML = '<div class="msg-empty">先新建一个项目。每个项目是 R2 里的一块独立工作区。</div>';
    return;
  }
  if (!messages?.length) {
    root.innerHTML = '<div class="msg-empty">直接说要查什么、改什么，我会在这个项目的 R2 文件里查找和修改。</div>';
    return;
  }
  for (const message of messages) root.append(buildMsg(message));
  root.scrollTop = root.scrollHeight;
}

function buildMsg(message) {
  const article = document.createElement("article");
  article.className = `msg ${message.role}${message.error ? " error" : ""}`;
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = message.role === "user" ? "你" : "Q";
  const nameEl = document.createElement("span");
  nameEl.className = "msg-name";
  nameEl.textContent = message.role === "user" ? "你" : "Quay";
  meta.append(avatar, nameEl);
  const body = document.createElement("div");
  body.className = "msg-body";
  if (message.role === "user") body.innerHTML = renderMarkdown(message.content || "");
  else renderSegments(body, message.segments || []);
  article.append(meta, body);
  return article;
}


function liveMessage() {
  const root = $("#messages");
  const article = document.createElement("article");
  article.className = "msg assistant";
  article.dataset.live = "1";
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "Q";
  const nameEl = document.createElement("span");
  nameEl.className = "msg-name";
  nameEl.textContent = "Quay";
  meta.append(avatar, nameEl);
  const body = document.createElement("div");
  body.className = "msg-body segments";
  article.append(meta, body);
  root.append(article);
  root.scrollTop = root.scrollHeight;
  return body;
}


async function refreshStatus() {
  state.status = await api("/api/status");
  $("#r2-pill").classList.toggle("on", state.status.r2Ready);
  $("#model-pill").classList.toggle("on", state.status.modelReady);
  $("#setup-banner").classList.toggle("hidden", state.status.r2Ready && state.status.modelReady);
  if (!$("#model-input").value) $("#model-input").value = state.status.model || localStorage.getItem("quayModel") || "";
  $("#logout").classList.toggle("hidden", !state.status.appPasswordSet);
}

async function loadModels() {
  const data = await api("/api/models");
  const list = $("#model-list");
  list.innerHTML = "";
  // build merged deduplicated list (extraModels already merged server-side)
  const seen = new Set();
  for (const id of data.models || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const option = document.createElement("option");
    option.value = id;
    list.append(option);
  }
  // update model switcher dropdown in topbar if it exists
  const sw = $("#model-switcher");
  if (sw) {
    const prev = sw.value;
    sw.innerHTML = "";
    for (const id of data.models || []) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      if (id === prev || id === (state.status?.model)) opt.selected = true;
      sw.append(opt);
    }
    if (!sw.value && data.models?.length) sw.value = data.models[0];
  }
  // populate composer model select
  const csel = $("#composer-model");
  if (csel) {
    const prev = csel.value;
    csel.innerHTML = '<option value="">跟随顶栏</option>';
    for (const id of data.models || []) {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = id;
      if (id === prev) opt.selected = true;
      csel.append(opt);
    }
  }
  return data.models || [];
}

async function loadProjects() {
  const data = await api("/api/projects");
  const select = $("#project-select");
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = data.projects.length ? "选择项目" : "还没有项目";
  select.append(placeholder);
  for (const project of data.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    select.append(option);
  }
  if (!data.projects.some((project) => project.id === state.projectId)) state.projectId = data.projects[0]?.id || "";
  select.value = state.projectId;
  localStorage.setItem("quayProject", state.projectId);
}

async function loadChats() {
  const list = $("#chat-list");
  list.innerHTML = "";
  if (!state.projectId) {
    state.chats = [];
    renderMessages([]);
    return;
  }
  const data = await api(`/api/projects/${state.projectId}/chats`);
  state.chats = data.chats || [];
  if (!state.chats.some((chat) => chat.id === state.chatId)) state.chatId = state.chats[0]?.id || "";
  for (const chat of state.chats) {
    const row = document.createElement("div");
    row.className = `chat-row${chat.id === state.chatId ? " active" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-btn";
    const icon = document.createElement("span");
    icon.className = "chat-icon";
    icon.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v6.5A1.75 1.75 0 0 1 14.25 12H8.06l-2.573 2.573A1.457 1.457 0 0 1 3 13.543V12H1.75A1.75 1.75 0 0 1 0 10.25v-6.5C0 2.784.784 2 1.75 2Z" opacity=".4"/></svg>`;
    const title = document.createElement("span");
    title.className = "chat-title";
    title.textContent = chat.title || "新对话";
    button.append(icon, title);
    button.addEventListener("click", () => selectChat(chat.id));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "chat-del";
    del.title = "删除";
    del.innerHTML = `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2.22 2.22a.75.75 0 0 1 1.06 0L6 4.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L7.06 6l2.72 2.72a.75.75 0 1 1-1.06 1.06L6 7.06 3.28 9.78a.75.75 0 0 1-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 0 1 0-1.06Z"/></svg>`;
    del.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!await askConfirm(`删除会话「${chat.title}」？`)) return;
      await api(`/api/projects/${state.projectId}/chats/${chat.id}`, { method: "DELETE" });
      if (state.chatId === chat.id) state.chatId = "";
      await loadChats();
      await openCurrentChat();
    });
    row.append(button, del);
    list.append(row);
  }
  localStorage.setItem("quayChat", state.chatId);
}

async function openCurrentChat() {
  if (!state.projectId || !state.chatId) {
    renderMessages([]);
    return;
  }
  const data = await api(`/api/projects/${state.projectId}/chats/${state.chatId}`);
  if (data.chat.model) $("#model-input").value = data.chat.model;
  renderMessages(data.chat.messages || []);
}

async function selectProject(id) {
  state.projectId = id;
  state.chatId = "";
  state.entries.clear();
  state.openDirs = new Set([""]);
  closeFile();
  localStorage.setItem("quayProject", id);
  await loadChats();
  await openCurrentChat();
  await loadTree("");
}

async function selectChat(id) {
  state.chatId = id;
  localStorage.setItem("quayChat", id);
  await loadChats();
  await openCurrentChat();
  if (window.matchMedia("(max-width: 980px)").matches) setTab("chat");
}

async function loadTree(dir) {
  if (!state.projectId) {
    state.entries.set("", []);
    renderTree();
    return;
  }
  const data = await api(`/api/projects/${state.projectId}/tree?path=${encodeURIComponent(dir)}`);
  state.entries.set(dir, data.entries || []);
  renderTree();
}

function renderTree() {
  const root = $("#tree");
  root.innerHTML = "";
  const walk = (dir, depth) => {
    for (const entry of state.entries.get(dir) || []) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `tree-entry${state.file?.path === entry.path ? " active" : ""}`;
      row.style.paddingLeft = `${10 + depth * 14}px`;
      if (entry.type === "dir") {
        const icon = document.createElement("span");
        icon.innerHTML = state.openDirs.has(entry.path)
          ? `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M1 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 .354.854l-4.5 4.5a.5.5 0 0 1-.708 0l-4.5-4.5A.5.5 0 0 1 1 3.5Z"/></svg>`
          : `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3.5 1a.5.5 0 0 0-.354.854l4.5 4.5a.5.5 0 0 0 .708 0l4.5-4.5A.5.5 0 0 0 8.5 1h-5Z"/></svg>`;
        row.append(icon);
      } else {
        const icon = document.createElement("span");
        icon.innerHTML = `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2 1.5c0-.276.224-.5.5-.5h5.086c.133 0 .26.053.354.146l2.414 2.414c.093.094.146.221.146.354V10.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V1.5Z" opacity=".4"/></svg>`;
        row.append(icon);
      }
      const label = document.createElement("span");
      label.className = "tree-name";
      label.textContent = entry.name;
      row.append(label);
      if (entry.type === "file") {
        const size = document.createElement("span");
        size.className = "tree-size";
        size.textContent = formatSize(entry.size);
        row.append(size);
      }
      row.addEventListener("click", () => onTreeClick(entry));
      root.append(row);
      if (entry.type === "dir" && state.openDirs.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  if (!(state.entries.get("") || []).length) {
    root.innerHTML = '<div class="tree-empty">这个项目还没有文件</div>';
    return;
  }
  walk("", 0);
}

async function onTreeClick(entry) {
  if (entry.type === "dir") {
    if (state.openDirs.has(entry.path)) state.openDirs.delete(entry.path);
    else {
      state.openDirs.add(entry.path);
      if (!state.entries.has(entry.path)) await loadTree(entry.path);
    }
    renderTree();
    return;
  }
  await openFile(entry.path);
}

async function openFile(filePath) {
  if (state.dirty && !await askConfirm("当前文件还没保存，仍然切换？")) return;
  const data = await api(`/api/projects/${state.projectId}/file?path=${encodeURIComponent(filePath)}`);
  state.file = data;
  state.dirty = false;
  $("#editor").classList.remove("hidden");
  $("#editor-path").textContent = data.path;
  $("#active-file").textContent = data.path;
  const image = $("#editor-image");
  const text = $("#editor-text");
  if (data.binary && /^image\/(png|jpeg|gif|webp)/.test(data.contentType || "")) {
    image.src = `/api/projects/${state.projectId}/download?path=${encodeURIComponent(data.path)}`;
    image.classList.remove("hidden");
    text.classList.add("hidden");
  } else if (data.binary) {
    image.classList.add("hidden");
    text.classList.remove("hidden");
    text.value = `二进制文件，${formatSize(data.size)}。可以下载。`;
    text.readOnly = true;
  } else {
    image.classList.add("hidden");
    text.classList.remove("hidden");
    text.readOnly = false;
    text.value = data.content || "";
  }
  renderTree();
  if (window.matchMedia("(max-width: 980px)").matches) setTab("files");
}

function closeFile() {
  state.file = null;
  state.dirty = false;
  $("#editor").classList.add("hidden");
  $("#active-file").textContent = "没有打开文件";
}

async function saveOpenFile() {
  if (!state.file || state.file.binary) return;
  await api(`/api/projects/${state.projectId}/file`, {
    method: "PUT",
    body: { path: state.file.path, content: $("#editor-text").value },
  });
  state.dirty = false;
  toast("已保存到 R2");
  await loadTree(parentDir(state.file.path));
}

function parentDir(filePath) {
  const index = String(filePath || "").lastIndexOf("/");
  return index < 0 ? "" : filePath.slice(0, index);
}

function askModal({ title, html, okText = "确定", fields }) {
  return new Promise((resolve) => {
    $("#modal").classList.remove("hidden");
    $("#modal-title").textContent = title;
    $("#modal-ok").textContent = okText;
    const body = $("#modal-body");
    body.innerHTML = html || "";
    const finish = (value) => {
      $("#modal").classList.add("hidden");
      $("#modal-card").onsubmit = null;
      resolve(value);
    };
    $("#modal-cancel").onclick = () => finish(null);
    $("#modal-card").onsubmit = (event) => {
      event.preventDefault();
      if (!fields) return finish(true);
      const data = {};
      for (const field of fields) {
        const node = body.querySelector(`[name="${field}"]`);
        data[field] = node?.type === "checkbox" ? node.checked : node?.value ?? "";
      }
      finish(data);
    };
  });
}

function askConfirm(title) {
  return askModal({ title, html: "<p>这个操作不能自动撤销。</p>", okText: "确认" });
}

async function createProject() {
  const data = await askModal({
    title: "新建项目",
    html: '<label class="field"><span>名称</span><input name="name" required /></label>',
    fields: ["name"],
    okText: "创建",
  });
  if (!data?.name?.trim()) return;
  const created = await api("/api/projects", { method: "POST", body: { name: data.name.trim() } });
  state.projectId = created.project.id;
  state.chatId = created.chat.id;
  await loadProjects();
  await selectProject(state.projectId);
  state.chatId = created.chat.id;
  await loadChats();
  await openCurrentChat();
}

async function sendMessage(text) {
  if (!state.projectId) return toast("先新建项目");
  if (!text.trim() || state.sending) return;
  if (!state.chatId) {
    const created = await api(`/api/projects/${state.projectId}/chats`, {
      method: "POST",
      body: { model: $("#model-input").value.trim() },
    });
    state.chatId = created.chat.id;
    await loadChats();
  }
  state.sending = true;
  $("#send").disabled = true;
  $("#stop").classList.remove("hidden");
  const userText = text.trim();
  $("#prompt").value = "";
  const existing = $("#messages .empty");
  if (existing) existing.remove();
  const user = document.createElement("article");
  user.className = "msg user";
  const selModel = ($("#composer-model")?.value || $("#model-input").value || "").trim();
  const selEffort = $("#composer-effort")?.value || "default";
  const modelTag = selModel ? ` · ${selModel}` : "";
  const effortTag = selEffort && selEffort !== "default" ? ` · ${selEffort}` : "";
  user.innerHTML = `<div class="msg-meta"><div class="msg-avatar" style="background:var(--accent-dim);color:var(--accent)">你</div><span class="msg-name">你</span><span class="msg-time">${modelTag}${effortTag}</span></div><div class="msg-body">${renderMarkdown(userText)}</div>`;
  $("#messages").append(user);
  const live = liveMessage();
  const segments = [];
  let textBuf = "";
  const paint = () => {
    const view = segments.slice();
    if (textBuf) view.push({ type: "text", text: textBuf });
    renderSegments(live, view.length ? view : [{ type: "text", text: "正在思考…" }]);
    $("#messages").scrollTop = $("#messages").scrollHeight;
  };
  paint();
  const ctrl = new AbortController();
  state.abort = ctrl;
  try {
    const response = await fetch(`/api/projects/${state.projectId}/chats/${state.chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: userText,
        model: ($("#composer-model")?.value || $("#model-input").value || "").trim(),
        reasoningEffort: $("#composer-effort")?.value || "default",
        contextWindow: state.status?.contextWindow || 0,
        activeFile: state.file?.path || "",
      }),
      signal: ctrl.signal,
    });
    if (response.status === 401) {
      showLogin();
      return;
    }
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/event-stream")) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "发送失败");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let changed = false;
    const handle = (raw) => {
      let event = "message";
      const dataLines = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) return;
      const data = JSON.parse(dataLines.join("\n"));
      if (event === "delta") {
        textBuf += data.text || "";
        paint();
      } else if (event === "tool") {
        if (textBuf) {
          segments.push({ type: "text", text: textBuf });
          textBuf = "";
        }
        const index = segments.findIndex((seg) => seg.type === "tool" && seg.id === data.id);
        const seg = {
          type: "tool",
          id: data.id,
          name: data.name,
          args: data.args || {},
          ok: data.status !== "error",
          status: data.status,
          result: data.result || "",
        };
        if (index >= 0) segments[index] = seg;
        else segments.push(seg);
        paint();
      } else if (event === "progress") {
        // tool execution progress: show as a faint text delta so user sees activity
        const progressText = data.text ? `\n_${data.text}_` : "";
        // Update the currently-running tool card subtitle if visible
        const liveTool = live.querySelector(".tool-card.running summary span:not(.tool-card-icon):not(.tool-status)");
        if (liveTool && data.text) liveTool.title = data.text;
        // Also send as a tiny delta so it shows up as italic hint beneath current text
        // We don't accumulate it into textBuf; render it separately as a transient hint
        const hint = live.querySelector(".progress-hint") || (() => {
          const el = document.createElement("div");
          el.className = "progress-hint";
          live.append(el);
          return el;
        })();
        hint.textContent = data.text || "";
        $("#messages").scrollTop = $("#messages").scrollHeight;
      } else if (event === "done") {
        // clear progress hint
        live.querySelector(".progress-hint")?.remove();
        changed = Boolean(data.changed);
        if (data.title) {
          const found = state.chats.find((chat) => chat.id === state.chatId);
          if (found) found.title = data.title;
        }
      } else if (event === "error") {
        live.querySelector(".progress-hint")?.remove();
        throw new Error(data.message || "生成失败");
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let idx = buffer.indexOf("\n\n");
      while (idx >= 0) {
        handle(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf("\n\n");
      }
    }
    await loadChats();
    if (changed) {
      state.entries.clear();
      await loadTree("");
      for (const dir of state.openDirs) if (dir) await loadTree(dir);
      if (state.file && !state.dirty) await openFile(state.file.path);
    }
  } catch (error) {
    if (error.name === "AbortError") toast("已停止");
    else {
      live.append(Object.assign(document.createElement("div"), { className: "form-error", textContent: error.message }));
      toast(error.message);
    }
  } finally {
    state.sending = false;
    state.abort = null;
    $("#send").disabled = false;
    $("#stop").classList.add("hidden");
  }
}

function settingsForm(values) {
  const v = values || {};
  return `
    <div class="settings-section">
      <div class="settings-section-title">Cloudflare R2</div>
      <div class="grid-2">
        <div class="field"><label>Account ID</label><input name="r2AccountId" value="${escapeHtml(v.r2AccountId || "")}" placeholder="abc123..." /></div>
        <div class="field"><label>Bucket 名称</label><input name="r2Bucket" value="${escapeHtml(v.r2Bucket || "")}" placeholder="quay" /></div>
        <div class="field"><label>Access Key ID</label><input name="r2AccessKeyId" value="${escapeHtml(v.r2AccessKeyId || "")}" /></div>
        <div class="field"><label>Secret Access Key</label><input name="r2SecretAccessKey" type="password" value="${escapeHtml(v.r2SecretAccessKey || "")}" /></div>
      </div>
      <div class="field"><label>自定义 Endpoint（可留空，按 Account ID 自动生成）</label><input name="r2Endpoint" value="${escapeHtml(v.r2Endpoint || "")}" placeholder="https://<id>.r2.cloudflarestorage.com" /></div>
      <div class="check-row"><input id="chk-path" name="r2ForcePathStyle" type="checkbox" ${v.r2ForcePathStyle ? "checked" : ""} /><label for="chk-path">强制 Path-Style（连不上时开）</label></div>
      <div class="test-row"><button type="button" class="btn-ghost btn-sm" data-test="r2">测试 R2 连接</button><span class="test-result" data-for="r2"></span></div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">sub2api 模型网关</div>
      <div class="field"><label>Base URL</label><input name="sub2apiBaseUrl" value="${escapeHtml(v.sub2apiBaseUrl || "")}" placeholder="https://your-sub2api.example.com/v1" /></div>
      <div class="grid-2">
        <div class="field"><label>API Key</label><input name="sub2apiApiKey" type="password" value="${escapeHtml(v.sub2apiApiKey || "")}" /></div>
        <div class="field"><label>默认模型</label><input name="sub2apiModel" value="${escapeHtml(v.sub2apiModel || "")}" list="model-list" placeholder="模型名称" /></div>
      </div>
      <div class="test-row"><button type="button" class="btn-ghost btn-sm" data-test="model">测试模型接口</button><span class="test-result" data-for="model"></span></div>
      <div class="field" style="margin-top:12px">
        <label>自定义模型列表（每行一个，会和接口返回的合并）</label>
        <textarea name="extraModels" rows="4" placeholder="gpt-4o&#10;claude-opus-4-5&#10;gemini-pro">${escapeHtml((v.extraModels || []).join("\n"))}</textarea>
      </div>
      <div class="field" style="margin-top:10px">
        <label>上下文窗口大小（tokens，0 = 自动 60k chars）</label>
        <input name="contextWindow" type="number" min="0" step="1000" value="${v.contextWindow || 0}" placeholder="如 1000000 表示 1M" />
        <p class="hint-text">填写模型实际支持的上下文 token 数。工具返回内容和文件读取分块大小会按此比例放大（约 3 字符/token）。0 表示使用默认值（60K 字符）。</p>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">访问控制</div>
      <div class="field"><label>访问密码（留空表示不修改当前密码）</label><input name="appPassword" type="password" placeholder="输入新密码…" /></div>
      <div class="check-row"><input id="chk-clear-pw" name="clearAppPassword" type="checkbox" /><label for="chk-clear-pw">清除已保存的访问密码，改回环境变量或无密码</label></div>
    </div>

    <p class="hint-text">密钥框里出现星号时，不改就不要动它。这里保存的值优先级高于环境变量。<br>可用「重置设置」按钮清除所有保存的覆盖，还原为环境变量。</p>
  `;
}

function readSettingsForm() {
  const body = $("#modal-body");
  const data = {};
  for (const name of ["r2AccountId", "r2Bucket", "r2AccessKeyId", "r2SecretAccessKey", "r2Endpoint", "sub2apiBaseUrl", "sub2apiApiKey", "sub2apiModel", "appPassword"]) {
    data[name] = body.querySelector(`[name="${name}"]`)?.value ?? "";
  }
  data.r2ForcePathStyle = Boolean(body.querySelector('[name="r2ForcePathStyle"]')?.checked);
  data.clearAppPassword = Boolean(body.querySelector('[name="clearAppPassword"]')?.checked);
  const extraRaw = body.querySelector('[name="extraModels"]')?.value ?? "";
  data.extraModels = extraRaw.split("\n").map(m => m.trim()).filter(Boolean);
  data.contextWindow = Number(body.querySelector('[name="contextWindow"]')?.value || 0) || 0;
  return data;
}

async function openSettings() {
  const current = await api("/api/settings");
  $("#modal").classList.remove("hidden");
  $("#modal-title").textContent = "连接设置";
  $("#modal-ok").textContent = "保存";
  $("#modal-body").innerHTML = settingsForm(current);

  // wire test buttons (inline in form)
  $("#modal-body").querySelectorAll("[data-test]").forEach((btn) => {
    const target = btn.dataset.test;
    const resultEl = $("#modal-body").querySelector(`[data-for="${target}"]`);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      if (resultEl) resultEl.textContent = "测试中…";
      try {
        const result = await api("/api/settings/test", { method: "POST", body: { ...readSettingsForm(), target } });
        if (resultEl) { resultEl.textContent = "✓ " + (result.message || "成功"); resultEl.style.color = "var(--green)"; }
        toast(result.message || "连接成功");
      } catch (error) {
        if (resultEl) { resultEl.textContent = "✗ " + error.message; resultEl.style.color = "var(--red)"; }
        toast(error.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // reset button — append to footer
  const footer = document.querySelector(".modal-footer");
  let resetBtn = footer.querySelector("#settings-reset");
  if (!resetBtn) {
    resetBtn = document.createElement("button");
    resetBtn.id = "settings-reset";
    resetBtn.type = "button";
    resetBtn.className = "btn-ghost";
    resetBtn.style.marginRight = "auto";
    resetBtn.textContent = "重置设置";
    footer.prepend(resetBtn);
  }
  resetBtn.onclick = async () => {
    if (!await askConfirm("清除所有保存的覆盖设置，还原为环境变量？")) return;
    await api("/api/settings", { method: "DELETE" });
    toast("已还原为环境变量");
    $("#modal").classList.add("hidden");
    footer.querySelector("#settings-reset")?.remove();
    await refreshStatus();
  };

  $("#modal-cancel").onclick = () => { $("#modal").classList.add("hidden"); footer.querySelector("#settings-reset")?.remove(); };
  ($("#modal-x") || {}).onclick = () => { $("#modal").classList.add("hidden"); const f = document.querySelector(".modal-footer"); f?.querySelector("#settings-reset")?.remove(); };
  $("#modal-card").onsubmit = async (event) => {
    event.preventDefault();
    const ok = $("#modal-ok");
    ok.disabled = true;
    try {
      await api("/api/settings", { method: "PUT", body: readSettingsForm() });
      $("#modal").classList.add("hidden");
      footer.querySelector("#settings-reset")?.remove();
      toast("设置已保存");
      await refreshStatus();
      await loadModels();
      if (!$("#model-input").value && state.status?.model) $("#model-input").value = state.status.model;
    } catch (error) {
      toast(error.message);
    } finally {
      ok.disabled = false;
    }
  };
}


$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: { password: $("#password").value } });
    await bootApp();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#project-select").addEventListener("change", (event) => selectProject(event.target.value).catch((error) => toast(error.message)));
$("#new-project").addEventListener("click", () => createProject().catch((error) => toast(error.message)));
$("#rename-project").addEventListener("click", async () => {
  if (!state.projectId) return;
  const data = await askModal({
    title: "重命名项目",
    html: '<label class="field"><span>名称</span><input name="name" required /></label>',
    fields: ["name"],
  });
  if (!data?.name?.trim()) return;
  await api(`/api/projects/${state.projectId}`, { method: "PATCH", body: { name: data.name.trim() } });
  await loadProjects();
});
$("#delete-project").addEventListener("click", async () => {
  if (!state.projectId) return;
  if (!await askConfirm("删除整个项目以及 R2 里的文件？")) return;
  await api(`/api/projects/${state.projectId}`, { method: "DELETE" });
  state.projectId = "";
  state.chatId = "";
  closeFile();
  await loadProjects();
  await selectProject($("#project-select").value);
});
$("#new-chat").addEventListener("click", async () => {
  if (!state.projectId) return toast("先新建项目");
  const created = await api(`/api/projects/${state.projectId}/chats`, { method: "POST", body: { model: $("#model-input").value.trim() } });
  state.chatId = created.chat.id;
  await loadChats();
  await openCurrentChat();
});
$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage($("#prompt").value).catch((error) => toast(error.message));
});
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});
$("#stop").addEventListener("click", () => state.abort?.abort());
$("#model-input").addEventListener("change", () => localStorage.setItem("quayModel", $("#model-input").value.trim()));
$("#open-settings").addEventListener("click", () => openSettings().catch((error) => toast(error.message)));
$("#banner-settings").addEventListener("click", () => openSettings().catch((error) => toast(error.message)));
$("#logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: {} });
  showLogin();
});
$("#new-file").addEventListener("click", async () => {
  if (!state.projectId) return;
  const data = await askModal({
    title: "新建文件",
    html: '<label class="field"><span>相对路径</span><input name="path" placeholder="src/app.js" required /></label>',
    fields: ["path"],
  });
  if (!data?.path) return;
  await api(`/api/projects/${state.projectId}/file`, { method: "PUT", body: { path: data.path.trim(), content: "" } });
  await loadTree(parentDir(data.path.trim()));
  await openFile(data.path.trim());
});
$("#new-folder").addEventListener("click", async () => {
  if (!state.projectId) return;
  const data = await askModal({
    title: "新建目录",
    html: '<label class="field"><span>相对路径</span><input name="path" placeholder="src" required /></label>',
    fields: ["path"],
  });
  if (!data?.path) return;
  await api(`/api/projects/${state.projectId}/file`, { method: "PUT", body: { path: `${data.path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/.keep`, content: "" } });
  state.openDirs.add(data.path.trim());
  await loadTree("");
  await loadTree(data.path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
});
$("#upload-btn").addEventListener("click", () => $("#upload-input").click());
$("#upload-input").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  for (const file of files) {
    await fetch(`/api/projects/${state.projectId}/raw?path=${encodeURIComponent(file.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || "上传失败");
    });
  }
  event.target.value = "";
  toast(`已上传 ${files.length} 个文件`);
  await loadTree("");
});
$("#refresh-tree").addEventListener("click", async () => {
  const dirs = [...state.openDirs];
  state.entries.clear();
  for (const dir of dirs) await loadTree(dir);
});
$("#save-file").addEventListener("click", () => saveOpenFile().catch((error) => toast(error.message)));
$("#editor-text").addEventListener("input", () => { state.dirty = true; });
$("#download-file").addEventListener("click", () => {
  if (!state.file) return;
  window.open(`/api/projects/${state.projectId}/download?path=${encodeURIComponent(state.file.path)}`, "_blank");
});
$("#delete-file").addEventListener("click", async () => {
  if (!state.file) return;
  if (!await askConfirm(`删除 ${state.file.path}？`)) return;
  await api(`/api/projects/${state.projectId}/file?path=${encodeURIComponent(state.file.path)}`, { method: "DELETE" });
  const dir = parentDir(state.file.path);
  closeFile();
  await loadTree(dir);
});
$("#close-file").addEventListener("click", () => {
  if (state.dirty && !confirm("还有未保存的修改，关闭？")) return;
  closeFile();
  renderTree();
});
document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});
window.addEventListener("resize", () => setTab(document.querySelector(".tabs button.active")?.dataset.tab || "chat"));

const treeEl = $("#tree");
treeEl.addEventListener("dragover", (event) => event.preventDefault());
treeEl.addEventListener("drop", async (event) => {
  event.preventDefault();
  if (!state.projectId) return;
  const files = [...event.dataTransfer.files];
  for (const file of files) {
    await fetch(`/api/projects/${state.projectId}/raw?path=${encodeURIComponent(file.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  }
  toast(`已上传 ${files.length} 个文件`);
  await loadTree("");
});

async function bootApp() {
  showApp();
  setTab("chat");
  await refreshStatus();
  await loadModels().catch(() => {});
  await loadProjects();
  await selectProject(state.projectId);
}

async function boot() {
  const data = await api("/api/bootstrap");
  if (data.authRequired && !data.signedIn) showLogin();
  else await bootApp();
}

boot().catch((error) => {
  $("#login").classList.remove("hidden");
  $("#login-error").textContent = error.message;
});
