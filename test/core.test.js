import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRel, assertId } from "../src/paths.js";
import { applyEdit } from "../src/edit.js";
import { compactDiff } from "../src/diff.js";
import { absorbToolDelta, chatCompletionsUrl, createSseParser, modelsUrl, toolCallsFromAccum } from "../src/upstream.js";

test("normalize relative paths", () => {
  assert.equal(normalizeRel("a/b"), "a/b");
  assert.equal(normalizeRel("/a//b/"), "a/b");
  assert.equal(normalizeRel("a/./b"), "a/b");
  assert.equal(normalizeRel(""), "");
  assert.throws(() => normalizeRel("../a"));
  assert.throws(() => normalizeRel("a/../../b"));
  assert.throws(() => normalizeRel(".agent/meta.json"));
});

test("ids", () => {
  assert.equal(assertId("p_0123456789ab", "p"), "p_0123456789ab");
  assert.throws(() => assertId("p_nope", "p"));
});

test("unique edit", () => {
  const next = applyEdit("alpha beta alpha", "beta", "gamma");
  assert.equal(next, "alpha gamma alpha");
  assert.throws(() => applyEdit("alpha alpha", "alpha", "beta"));
  assert.throws(() => applyEdit("alpha", "missing", "beta"));
});

test("compact diff keeps the changed lines", () => {
  const diff = compactDiff("a.txt", "one\ntwo\nthree", "one\nTWO\nthree");
  assert.match(diff, /--- a\/a.txt/);
  assert.match(diff, /-two/);
  assert.match(diff, /\+TWO/);
});

test("sub2api urls", () => {
  assert.equal(chatCompletionsUrl("https://gw.example.com/v1"), "https://gw.example.com/v1/chat/completions");
  assert.equal(chatCompletionsUrl("https://gw.example.com"), "https://gw.example.com/v1/chat/completions");
  assert.equal(chatCompletionsUrl("https://gw.example.com/v1/chat/completions"), "https://gw.example.com/v1/chat/completions");
  assert.equal(modelsUrl("https://gw.example.com/v1"), "https://gw.example.com/v1/models");
  assert.equal(modelsUrl("https://gw.example.com/v1/chat/completions"), "https://gw.example.com/v1/models");
});

test("sse tool call assembly", () => {
  const calls = [];
  absorbToolDelta(calls, [{ index: 0, id: "call_1", function: { name: "read_file", arguments: "" } }]);
  absorbToolDelta(calls, [{ index: 0, function: { arguments: "{\"path\":\"a.js\"}" } }]);
  const events = [];
  const parser = createSseParser((data) => events.push(data));
  parser.push('data: {"ok":1}\n\n');
  parser.push("data: [DONE]\n\n");
  assert.deepEqual(toolCallsFromAccum(calls), [{ id: "call_1", name: "read_file", arguments: "{\"path\":\"a.js\"}" }]);
  assert.deepEqual(events, ['{"ok":1}', "[DONE]"]);
});
