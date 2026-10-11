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
  container.innerHTML = "";
  for (const seg of segments || []) {
    if (seg.type === "text") {
      const node = document.createElement("div");
      node.className = "text";
      node.innerHTML = renderMarkdown(seg.text);
      container.append(node);
    } else if (seg.type === "tool") {
      const details = document.createElement("details");
      details.className = `tool${seg.ok === false ? " bad" : ""}`;
      details.open = seg.ok === false || seg.status === "running";
      const summary = document.createElement("summary");
      const status = seg.status === "running" ? "进行中" : seg.ok === false ? "失败" : "完成";
      summary.textContent = `${toolTitle(seg)} · ${status}`;
      const pre = document.createElement("pre");
      pre.textContent = seg.result || "";
      details.append(summary, pre);
      container.append(details);
    }
  }
}

function renderMessages(messages) {
  const root = $("#messages");
  root.innerHTML = "";
  if (!state.projectId) {
    root.innerHTML = '<div class="empty">先新建一个项目。每个项目是 R2 里的一块工作区。</div>';
    return;
  }
  if (!messages?.length) {
    root.innerHTML = '<div class="empty">直接说要查什么、改什么。我会在这个项目的 R2 文件里查找和修改。</div>';
    return;
  }
  for (const message of messages) {
    const article = document.createElement("article");
    article.className = `msg ${message.role}${message.error ? " error" : ""}`;
    const name = document.createElement("div");
    name.className = "msg-name";
    name.textContent = message.role === "user" ? "你" : "Quay";
    const body = document.createElement("div");
    if (message.role === "user") body.innerHTML = renderMarkdown(message.content || "");
    else renderSegments(body, message.segments || []);
    article.append(name, body);
    root.append(article);
  }
  root.scrollTop = root.scrollHeight;
}

function liveMessage() {
  const root = $("#messages");
  const article = document.createElement("article");
  article.className = "msg assistant";
  article.dataset.live = "1";
  article.innerHTML = '<div class="msg-name">Quay</div><div class="segments"></div>';
  root.append(article);
  root.scrollTop = root.scrollHeight;
  return article.querySelector(".segments");
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
  for (const id of data.models || []) {
    const option = document.createElement("option");
    option.value = id;
    list.append(option);
  }
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
    row.className = "chat-item-wrap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-item${chat.id === state.chatId ? " active" : ""}`;
    const title = document.createElement("span");
    title.textContent = chat.title || "新对话";
    button.append(title);
    button.addEventListener("click", () => selectChat(chat.id));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost";
    del.textContent = "删";
    del.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!await askConfirm(`删除会话「${chat.title}」？`)) return;
      await api(`/api/projects/${state.projectId}/chats/${chat.id}`, { method: "DELETE" });
      if (state.chatId === chat.id) state.chatId = "";
      await loadChats();
      await openCurrentChat();
    });
    row.style.display = "flex";
    row.append(button, del);
    button.style.flex = "1";
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
      row.className = `tree-row${state.file?.path === entry.path ? " active" : ""}`;
      row.style.paddingLeft = `${10 + depth * 14}px`;
      const label = document.createElement("span");
      label.textContent = `${entry.type === "dir" ? (state.openDirs.has(entry.path) ? "▾ " : "▸ ") : ""}${entry.name}`;
      row.append(label);
      if (entry.type === "file") {
        const size = document.createElement("small");
        size.textContent = formatSize(entry.size);
        row.append(size);
      }
      row.addEventListener("click", () => onTreeClick(entry));
      root.append(row);
      if (entry.type === "dir" && state.openDirs.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  if (!(state.entries.get("") || []).length) {
    root.innerHTML = '<div class="empty">这个项目还没有文件。</div>';
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
  user.innerHTML = `<div class="msg-name">你</div><div>${renderMarkdown(userText)}</div>`;
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
        model: $("#model-input").value.trim(),
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
      } else if (event === "done") {
        changed = Boolean(data.changed);
        if (data.title) {
          const found = state.chats.find((chat) => chat.id === state.chatId);
          if (found) found.title = data.title;
        }
      } else if (event === "error") {
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

function settingsForm(values = {}) {
  const v = values;
  return `
    <div class="grid-2">
      <label class="field">R2 Account ID<input name="r2AccountId" value="${escapeHtml(v.r2AccountId || "")}" /></label>
      <label class="field">R2 Bucket<input name="r2Bucket" value="${escapeHtml(v.r2Bucket || "")}" /></label>
      <label class="field">Access Key ID<input name="r2AccessKeyId" value="${escapeHtml(v.r2AccessKeyId || "")}" /></label>
      <label class="field">Secret Access Key<input name="r2SecretAccessKey" type="password" value="${escapeHtml(v.r2SecretAccessKey || "")}" /></label>
    </div>
    <label class="field">R2 Endpoint，可留空自动拼<input name="r2Endpoint" value="${escapeHtml(v.r2Endpoint || "")}" /></label>
    <label class="check"><input name="r2ForcePathStyle" type="checkbox" ${v.r2ForcePathStyle ? "checked" : ""}/> 强制 path-style</label>
    <label class="field">sub2api Base URL<input name="sub2apiBaseUrl" placeholder="https://example.com/v1" value="${escapeHtml(v.sub2apiBaseUrl || "")}" /></label>
    <div class="grid-2">
      <label class="field">sub2api API Key<input name="sub2apiApiKey" type="password" value="${escapeHtml(v.sub2apiApiKey || "")}" /></label>
      <label class="field">默认模型<input name="sub2apiModel" value="${escapeHtml(v.sub2apiModel || "")}" /></label>
    </div>
    <label class="field">访问密码，留空表示不改<input name="appPassword" type="password" /></label>
    <label class="check"><input name="clearAppPassword" type="checkbox" /> 清除已保存的访问密码，改回环境变量或无密码</label>
    <p class="hint">密钥输入框里的星号表示已经保存。不想改就不要动它。环境变量仍然是部署时的默认值，这里保存的内容会覆盖它们。</p>
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
  return data;
}

async function openSettings() {
  const current = await api("/api/settings");
  $("#modal").classList.remove("hidden");
  $("#modal-title").textContent = "连接设置";
  $("#modal-body").innerHTML = settingsForm(current);
  const extra = document.createElement("div");
  extra.className = "icon-buttons";
  extra.style.marginTop = "8px";
  const testR2 = document.createElement("button");
  testR2.type = "button";
  testR2.textContent = "测试 R2";
  const testModel = document.createElement("button");
  testModel.type = "button";
  testModel.textContent = "测试模型";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ghost";
  reset.textContent = "恢复环境变量";
  extra.append(testR2, testModel, reset);
  $("#modal-body").append(extra);
  const test = async (target) => {
    try {
      const result = await api("/api/settings/test", { method: "POST", body: { ...readSettingsForm(), target } });
      toast(result.message || "连接成功");
    } catch (error) {
      toast(error.message);
    }
  };
  testR2.onclick = () => test("r2");
  testModel.onclick = () => test("model");
  reset.onclick = async () => {
    await api("/api/settings", { method: "DELETE" });
    toast("已恢复为环境变量");
    $("#modal").classList.add("hidden");
    await refreshStatus();
  };
  $("#modal-ok").textContent = "保存";
  $("#modal-cancel").onclick = () => $("#modal").classList.add("hidden");
  $("#modal-card").onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api("/api/settings", { method: "PUT", body: readSettingsForm() });
      $("#modal").classList.add("hidden");
      toast("设置已保存");
      await refreshStatus();
      await loadModels();
      if (!$("#model-input").value && state.status.model) $("#model-input").value = state.status.model;
    } catch (error) {
      toast(error.message);
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
