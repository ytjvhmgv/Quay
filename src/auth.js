import crypto from "node:crypto";
import { getSessionSecret } from "./config.js";

const COOKIE = "quay_session";

export function signSession(password) {
  const payload = {
    exp: Date.now() + 14 * 24 * 60 * 60 * 1000,
    pw: crypto.createHash("sha256").update(String(password)).digest("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token, password) {
  if (!token || !password) return false;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return false;
  const expected = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return false;
    const pw = crypto.createHash("sha256").update(String(password)).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(String(payload.pw)));
  } catch {
    return false;
  }
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookie(token) {
  const secure = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || "");
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=1209600",
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearCookie() {
  const secure = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || "");
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function passwordsMatch(input, expected) {
  const a = Buffer.from(String(input ?? ""));
  const b = Buffer.from(String(expected ?? ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
