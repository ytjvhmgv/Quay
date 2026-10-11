export class UpstreamError extends Error {
  constructor(status, detail) {
    super(`模型接口返回 ${status}：${String(detail).slice(0, 800)}`);
    this.status = status;
    this.detail = String(detail).slice(0, 2000);
    this.name = "UpstreamError";
  }
}

export function chatCompletionsUrl(baseUrl) {
  let base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("还没有配置 SUB2API_BASE_URL");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function modelsUrl(baseUrl) {
  let base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("还没有配置 SUB2API_BASE_URL");
  if (base.endsWith("/chat/completions")) {
    base = base.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1/models`;
}

export function createSseParser(onEvent) {
  let buffer = "";
  return {
    push(text) {
      buffer += String(text).replace(/\r\n/g, "\n");
      let idx = buffer.indexOf("\n\n");
      while (idx >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = [];
        for (const line of raw.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length) onEvent(dataLines.join("\n"));
        idx = buffer.indexOf("\n\n");
      }
    },
    flush() {
      if (buffer.trim()) this.push("\n\n");
    },
  };
}

export function absorbToolDelta(calls, deltaCalls) {
  for (const call of deltaCalls || []) {
    const index = call.index ?? 0;
    if (!calls[index]) calls[index] = { id: "", name: "", arguments: "" };
    if (call.id) calls[index].id += call.id;
    const fn = call.function || {};
    if (fn.name) calls[index].name += fn.name;
    if (typeof fn.arguments === "string") calls[index].arguments += fn.arguments;
  }
  return calls;
}

export function toolCallsFromAccum(calls) {
  return calls.filter(Boolean).filter((call) => call.name).map((call, index) => ({
    id: call.id || `call_${index}`,
    name: call.name,
    arguments: call.arguments || "{}",
  }));
}

function textFrom(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    }).join("");
  }
  return "";
}

function messageFromCompletion(json, onDelta) {
  if (json?.error) {
    const message = json.error.message || JSON.stringify(json.error);
    throw new UpstreamError(json.error.code || 502, message);
  }
  const message = json.choices?.[0]?.message || {};
  const content = textFrom(message.content);
  if (content) onDelta(content);
  const toolCalls = (message.tool_calls || []).map((call, index) => ({
    id: call.id || `call_${index}`,
    name: call.function?.name || "",
    arguments: call.function?.arguments || "{}",
  })).filter((call) => call.name);
  return { content, toolCalls };
}

async function readError(response) {
  const detail = await response.text();
  throw new UpstreamError(response.status, detail.slice(0, 2000));
}

export async function completeChat({ baseUrl, apiKey, model, messages, tools, signal, onDelta, reasoningEffort }) {
  if (!apiKey) throw new Error("还没有配置 SUB2API_API_KEY");
  if (!model) throw new Error("还没有选择模型");
  const url = chatCompletionsUrl(baseUrl);
  const body = { model, messages };
  const maxTokens = Number(process.env.SUB2API_MAX_TOKENS || "");
  if (Number.isFinite(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  // reasoning effort — different models use different parameter names
  if (reasoningEffort && reasoningEffort !== "default") {
    // Claude / Anthropic style: thinking
    if (/claude|anthropic/i.test(model)) {
      const budgetMap = { low: 1024, medium: 8192, high: 16000, max: 32000 };
      body.thinking = { type: "enabled", budget_tokens: budgetMap[reasoningEffort] || 8192 };
    } else {
      // OpenAI / most others: reasoning_effort
      body.reasoning_effort = reasoningEffort;
    }
  }
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  try {
    return await sendChat(url, apiKey, { ...body, stream: true }, signal, onDelta);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof UpstreamError && error.status === 400 && /stream/i.test(error.detail)) {
      return sendChat(url, apiKey, { ...body, stream: false }, signal, onDelta);
    }
    throw error;
  }
}

async function sendChat(url, apiKey, body, signal, onDelta) {
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timeoutMs = Math.min(900000, Math.max(30000, Number(process.env.SUB2API_TIMEOUT_MS || 420000)));
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) await readError(response);
    const type = response.headers.get("content-type") || "";
    if (!body.stream || !type.includes("text/event-stream")) {
      return messageFromCompletion(await response.json(), onDelta);
    }
    return await readStream(response, onDelta);
  } catch (error) {
    if (signal?.aborted) {
      const aborted = new Error("已停止");
      aborted.aborted = true;
      throw aborted;
    }
    if (timedOut) throw new Error(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）。高推理强度会想更久，可以改成中或低再试。`);
    if (error instanceof UpstreamError) throw error;
    if (error?.name === "AbortError") throw new Error("模型请求已中断");
    throw new Error(`无法连接 sub2api：${error.message || error}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = [];
  let content = "";
  const parser = createSseParser((data) => {
    if (data === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.error) {
      throw new UpstreamError(json.error.code || 502, json.error.message || JSON.stringify(json.error));
    }
    const delta = json.choices?.[0]?.delta || {};
    const piece = textFrom(delta.content);
    if (piece) {
      content += piece;
      onDelta(piece);
    }
    absorbToolDelta(calls, delta.tool_calls);
  });
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
  return { content, toolCalls: toolCallsFromAccum(calls) };
}
