import path from "node:path";

const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".html", ".css", ".md",
  ".txt", ".svg", ".py", ".go", ".rs", ".yml", ".yaml", ".toml", ".xml", ".csv",
  ".sh", ".env", ".sql", ".java", ".c", ".h", ".cpp", ".hpp", ".rb", ".php",
  ".vue", ".svelte", ".scss", ".less", ".ini", ".cfg", ".conf", ".log", ".lock",
]);

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".py": "text/plain; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".wasm", ".mp4", ".mp3", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dll",
  ".bin", ".7z", ".rar",
]);

export function contentTypeFor(filePath) {
  const ext = path.posix.extname(String(filePath || "")).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

export function isBinaryExtension(filePath) {
  const ext = path.posix.extname(String(filePath || "")).toLowerCase();
  return BINARY_EXT.has(ext);
}

export function isProbablyBinary(filePath, buffer) {
  if (isBinaryExtension(filePath)) return true;
  const ext = path.posix.extname(String(filePath || "")).toLowerCase();
  if (TEXT_EXT.has(ext)) {
    const n = Math.min(buffer.length, 8000);
    for (let i = 0; i < n; i += 1) if (buffer[i] === 0) return true;
    return false;
  }
  const n = Math.min(buffer.length, 8000);
  let odd = 0;
  for (let i = 0; i < n; i += 1) {
    const byte = buffer[i];
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) odd += 1;
  }
  return n > 0 && odd / n > 0.08;
}
