import { completeChat } from "./upstream.js";
import { executeTool, TOOL_DEFS } from "./tools.js";

function clip(text, limit) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[已截断，共 ${value.length} 字符]`;
}

function compact(messages) {
  const keep = 12;
  if (messages.length <= keep) return messages;
  return messages.map((message, index) => {
    if (index === 0 || index >= messages.length - keep) return message;
    if (message.role === "tool") return { ...message, content: "[较早的工具输出已省略]" };
    if (typeof message.content === "string" && message.content.length > 1500) {
      return { ...message, content: `${message.content.slice(0, 1500)}\n...[已截断]` };
    }
    return message;
  });
}

function systemPrompt(project, activeFile) {
  const open = activeFile ? `\n用户正在查看的文件：${activeFile}。需要改它时先 read_file。` : "";
  return `你是 Quay，一个网页里的编程代理。当前项目「${project.name}」的文件全部放在 Cloudflare R2，不是本地磁盘。

规则：
- 不了解文件内容时，先用 list_files、search_files、read_file，不要编造。
- 改已有文件优先 edit_file。只有新文件或需要整文件重写时才 write_file。
- edit_file 的 old_string 必须是文件里的原文，并且只能命中一处。read_file 返回的是原文，没有行号。
- 路径用项目内相对路径，用 / ，不要以 / 开头，不要包含 ..。
- 工具失败时根据错误修正后再试，不要原样重复失败调用。
- 做完后用简体中文说明改了什么。如果用户用别的语言，就跟随用户。
- 不要把密钥写进文件。${open}`;
}

function aborted(partial) {
  const error = new Error("已停止");
  error.aborted = true;
  error.partial = partial;
  return error;
}

function trimTranscript(messages) {
  const max = 40;
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && messages[start].role === "tool") start += 1;
  return messages.slice(start);
}

export async function runAgent({ settings, store, project, chat, model, signal, emit, activeFile }) {
  const openaiMessages = Array.isArray(chat.openaiMessages) ? chat.openaiMessages.slice() : [];
  const segments = [];
  let textBuf = "";
  const flushText = () => {
    if (!textBuf) return;
    segments.push({ type: "text", text: textBuf });
    textBuf = "";
  };
  const maxRounds = Math.min(32, Math.max(1, Number(process.env.AGENT_MAX_ROUNDS || 16)));
  let usedToolRound = false;

  for (let round = 0; round < maxRounds; round += 1) {
    if (signal?.aborted) throw aborted({ segments, textBuf, openaiMessages });
    emit("status", { text: round === 0 ? "正在思考…" : "根据工具结果继续…" });
    let result;
    try {
      result = await completeChat({
        baseUrl: settings.sub2apiBaseUrl,
        apiKey: settings.sub2apiApiKey,
        model,
        messages: compact([
          { role: "system", content: systemPrompt(project, activeFile) },
          ...openaiMessages,
        ]),
        tools: TOOL_DEFS,
        signal,
        onDelta: (text) => {
          textBuf += text;
          emit("delta", { text });
        },
      });
    } catch (error) {
      if (signal?.aborted || error?.aborted) throw aborted({ segments, textBuf, openaiMessages });
      throw error;
    }
    if (signal?.aborted) throw aborted({ segments, textBuf, openaiMessages });

    const calls = result.toolCalls || [];
    if (!calls.length) {
      if (!textBuf && result.content) textBuf = result.content;
      const finalText = textBuf;
      flushText();
      openaiMessages.push({ role: "assistant", content: finalText });
      usedToolRound = false;
      break;
    }

    usedToolRound = true;
    const roundText = textBuf || result.content || "";
    flushText();
    const toolCalls = calls.map((call, index) => ({
      id: call.id || `call_${round}_${index}`,
      type: "function",
      function: {
        name: call.name,
        arguments: call.arguments || "{}",
      },
    }));
    openaiMessages.push({
      role: "assistant",
      content: roundText,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (signal?.aborted) {
        openaiMessages.push({ role: "tool", tool_call_id: call.id, content: "用户已停止" });
        throw aborted({ segments, textBuf, openaiMessages });
      }
      let args = {};
      let parseError = "";
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parseError = "工具参数不是合法 JSON";
      }
      const seg = {
        type: "tool",
        id: call.id,
        name: call.function.name,
        args,
        ok: true,
        result: "",
      };
      segments.push(seg);
      emit("tool", { ...seg, status: "running" });
      const onProgress = (msg) => emit("progress", { id: call.id, text: msg });
      try {
        if (parseError) throw new Error(parseError);
        if (!call.function.name) throw new Error("缺少工具名");
        const output = await executeTool(store, project.id, call.function.name, args, onProgress);
        seg.result = clip(output, 2000);
        openaiMessages.push({ role: "tool", tool_call_id: call.id, content: clip(output, 12000) });
      } catch (error) {
        seg.ok = false;
        seg.result = clip(error.message || String(error), 2000);
        openaiMessages.push({ role: "tool", tool_call_id: call.id, content: seg.result });
      }
      emit("tool", { ...seg, status: seg.ok ? "done" : "error" });
    }
  }

  if (usedToolRound) {
    textBuf += "这一轮工具调用已到上限。可以说「继续」，我会接着做。";
    emit("delta", { text: textBuf });
    flushText();
    openaiMessages.push({ role: "assistant", content: "这一轮工具调用已到上限。" });
  }
  flushText();
  if (!segments.length) segments.push({ type: "text", text: "（模型没有返回内容）" });
  return { segments, openaiMessages: trimTranscript(openaiMessages) };
}
