import crypto from "node:crypto";

export function normalizeRel(input) {
  if (input == null) return "";
  let value = String(input).replace(/\\/g, "/").trim();
  value = value.replace(/^\/+/, "");
  const parts = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("路径不能包含 ..");
    if (part.includes("\0")) throw new Error("非法路径");
    parts.push(part);
  }
  const rel = parts.join("/");
  if (rel === ".agent" || rel.startsWith(".agent/")) {
    throw new Error("不能访问代理内部目录");
  }
  return rel;
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function assertId(id, prefix) {
  const re = new RegExp(`^${prefix}_[a-f0-9]{12}$`);
  if (!re.test(String(id || ""))) throw new Error("编号不合法");
  return String(id);
}

export function safeName(name) {
  const text = String(name || "").trim().replace(/\s+/g, " ");
  if (!text) throw new Error("名称不能为空");
  if (text.length > 60) throw new Error("名称不能超过 60 个字");
  return text;
}
