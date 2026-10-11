import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { r2Ready } from "./config.js";
import { chatKey, chatsPrefix, filesPrefix, metaKey, projectPrefix } from "./keys.js";

const clients = new Map();

function isMissing(error) {
  const status = error?.$metadata?.httpStatusCode;
  return status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
}

function wrapR2(error) {
  const message = error?.message || String(error);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(message)) {
    return Object.assign(new Error("连不上 Cloudflare R2，请检查 Account ID 和 Endpoint"), { status: 502 });
  }
  if (/AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|403/.test(message)) {
    return Object.assign(new Error("R2 拒绝访问，请检查 Access Key、Secret 和存储桶权限"), { status: 400 });
  }
  if (/NoSuchBucket/.test(message)) {
    return Object.assign(new Error("R2 存储桶不存在"), { status: 400 });
  }
  return error;
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createStore(settings) {
  const client = new S3Client({
    region: "auto",
    endpoint: settings.r2Endpoint,
    forcePathStyle: Boolean(settings.r2ForcePathStyle),
    credentials: {
      accessKeyId: settings.r2AccessKeyId,
      secretAccessKey: settings.r2SecretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucket = settings.r2Bucket;

  async function send(command) {
    try {
      return await client.send(command);
    } catch (error) {
      throw wrapR2(error);
    }
  }

  return {
    bucket,
    async listLevel(prefix) {
      const dirs = [];
      const files = [];
      let token;
      do {
        const out = await send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: token,
          MaxKeys: 1000,
        }));
        for (const item of out.CommonPrefixes || []) dirs.push(item.Prefix);
        for (const item of out.Contents || []) {
          if (item.Key && item.Key !== prefix) files.push({ key: item.Key, size: item.Size || 0 });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return { dirs, files };
    },
    async listAll(prefix) {
      const files = [];
      let token;
      do {
        const out = await send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }));
        for (const item of out.Contents || []) {
          if (item.Key) files.push({ key: item.Key, size: item.Size || 0 });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
        if (files.length >= 5000) break;
      } while (token);
      return files;
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: out.ContentLength || 0, contentType: out.ContentType || "" };
      } catch (error) {
        if (isMissing(error)) return null;
        throw wrapR2(error);
      }
    },
    async getBuffer(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const buffer = await bodyToBuffer(out.Body);
        return { buffer, contentType: out.ContentType || "", size: buffer.length };
      } catch (error) {
        if (isMissing(error)) return null;
        throw wrapR2(error);
      }
    },
    async put(key, body, contentType) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
      await send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: contentType || "application/octet-stream",
      }));
    },
    async putJson(key, value) {
      await this.put(key, JSON.stringify(value, null, 2), "application/json; charset=utf-8");
    },
    async getJson(key) {
      const got = await this.getBuffer(key);
      if (!got) return null;
      return JSON.parse(got.buffer.toString("utf8"));
    },
    async del(key) {
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async deleteKeys(keys) {
      const list = keys.filter(Boolean);
      for (let i = 0; i < list.length; i += 1000) {
        const chunk = list.slice(i, i + 1000);
        try {
          await send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }));
        } catch {
          for (const key of chunk) await this.del(key);
        }
      }
    },
    async touch(projectId) {
      const meta = await this.getJson(metaKey(projectId));
      if (!meta) return;
      meta.updatedAt = new Date().toISOString();
      await this.putJson(metaKey(projectId), meta);
    },
    filesPrefix,
    projectPrefix,
    metaKey,
    chatKey,
    chatsPrefix,
  };
}

export function resetStoreCache() {
  clients.clear();
}

export function getStore(settings) {
  if (!r2Ready(settings)) {
    throw Object.assign(new Error("Cloudflare R2 还没有配置完整"), { status: 400 });
  }
  const cacheKey = [
    settings.r2Endpoint,
    settings.r2AccessKeyId,
    settings.r2SecretAccessKey,
    settings.r2Bucket,
    settings.r2ForcePathStyle,
  ].join("|");
  if (!clients.has(cacheKey)) clients.set(cacheKey, createStore(settings));
  return clients.get(cacheKey);
}
