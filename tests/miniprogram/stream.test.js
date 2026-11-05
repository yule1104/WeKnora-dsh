const assert = require("node:assert/strict");
const test = require("node:test");
const { createSSEParser } = require("../../miniprogram/utils/sse");
const { createUtf8Decoder } = require("../../miniprogram/utils/utf8");

function encode(text) {
  return Uint8Array.from(Buffer.from(text, "utf8"));
}

function sseEvent(payload) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

// Fake wx.request that streams `chunks` through onChunkReceived asynchronously.
function streamingWx(chunks, { statusCode = 200, settings, capture } = {}) {
  return {
    getStorageSync() {
      return settings || { apiKey: "sk-test", baseUrl: "https://ai.example.com" };
    },
    request(options) {
      if (capture) capture(options);
      let chunkHandler = () => {};
      let headersHandler = () => {};
      setTimeout(async () => {
        headersHandler({ statusCode });
        for (const chunk of chunks) {
          chunkHandler({ data: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        options.success({ statusCode, data: "" });
      }, 0);
      return {
        onChunkReceived(fn) {
          chunkHandler = fn;
        },
        onHeadersReceived(fn) {
          headersHandler = fn;
        }
      };
    }
  };
}

function loadRequest() {
  delete require.cache[require.resolve("../../miniprogram/utils/request.js")];
  return require("../../miniprogram/utils/request.js");
}

test("utf8 decoder joins multi-byte characters split across chunks", () => {
  const bytes = encode("你好，世界🙂");
  const decoder = createUtf8Decoder();
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += decoder.write(bytes.slice(i, i + 1));
  }
  out += decoder.end();
  assert.equal(out, "你好，世界🙂");
});

test("utf8 decoder replaces truncated trailing bytes on end", () => {
  const bytes = encode("中");
  const decoder = createUtf8Decoder();
  assert.equal(decoder.write(bytes.slice(0, 2)), "");
  assert.equal(decoder.end(), "�");
});

test("SSE parser emits events only once their blank line arrives", () => {
  const parser = createSSEParser();
  assert.deepEqual(parser.feed('event: message\ndata: {"a"'), []);
  assert.deepEqual(parser.feed(":1}\n"), []);
  const events = parser.feed('\nevent: message\ndata: {"b":2}\n\n');
  assert.equal(events.length, 2);
  assert.equal(events[0].data, '{"a":1}');
  assert.equal(events[1].data, '{"b":2}');
  assert.deepEqual(parser.end(), []);
});

test("SSE parser handles CRLF split between chunks and a trailing event without blank line", () => {
  const parser = createSSEParser();
  assert.deepEqual(parser.feed('data: {"x":1}\r'), []);
  assert.equal(parser.feed("\n\r\n").length, 1);
  parser.feed('data: {"y":2}');
  const rest = parser.end();
  assert.equal(rest.length, 1);
  assert.equal(rest[0].data, '{"y":2}');
});

test("knowledgeChat streams answer deltas as chunks arrive", async () => {
  const body =
    sseEvent({ response_type: "references", content: "skip", done: false }) +
    sseEvent({ response_type: "answer", content: "你好", done: false }) +
    sseEvent({ response_type: "answer", content: "，世界", done: false }) +
    sseEvent({ response_type: "answer", content: "", done: true });
  const bytes = encode(body);
  // Split into awkward 7-byte chunks so characters and events straddle boundaries.
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));

  let captured;
  const originalWx = global.wx;
  global.wx = streamingWx(chunks, { capture: (options) => { captured = options; } });
  try {
    const { knowledgeChat } = loadRequest();
    const updates = [];
    const result = await knowledgeChat("session-1", "hello", "kb-1", {
      onAnswer: (delta, full) => updates.push([delta, full])
    });

    assert.equal(result.answer, "你好，世界");
    assert.deepEqual(updates, [["你好", "你好"], ["，世界", "你好，世界"]]);
    assert.equal(captured.enableChunked, true);
    assert.equal(captured.method, "POST");
    assert.equal(captured.header.Accept, "text/event-stream");
    assert.equal(captured.header["X-API-Key"], "sk-test");
    assert.deepEqual(captured.data, { query: "hello", knowledge_base_ids: ["kb-1"] });
  } finally {
    global.wx = originalWx;
  }
});

test("knowledgeChat falls back to whole-body parsing without chunk support", async () => {
  const originalWx = global.wx;
  global.wx = {
    getStorageSync() {
      return { apiKey: "sk-test", baseUrl: "https://ai.example.com" };
    },
    request(options) {
      setTimeout(() => {
        options.success({
          statusCode: 200,
          data:
            sseEvent({ response_type: "answer", content: "Hel" }) +
            sseEvent({ response_type: "answer", content: "lo", done: true })
        });
      }, 0);
      return {};
    }
  };
  try {
    const { knowledgeChat } = loadRequest();
    const deltas = [];
    const result = await knowledgeChat("s", "q", "", { onAnswer: (delta) => deltas.push(delta) });
    assert.equal(result.answer, "Hello");
    assert.deepEqual(deltas, ["Hel", "lo"]);
  } finally {
    global.wx = originalWx;
  }
});

test("knowledgeChat surfaces HTTP errors from a chunked error body", async () => {
  const originalWx = global.wx;
  global.wx = streamingWx([encode('{"error":{"message":"会话不存在"}}')], { statusCode: 404 });
  try {
    const { knowledgeChat } = loadRequest();
    await assert.rejects(knowledgeChat("missing", "q", "kb-1"), /会话不存在/);
  } finally {
    global.wx = originalWx;
  }
});

test("knowledgeChat rejects with the stream error when no answer was produced", async () => {
  const originalWx = global.wx;
  global.wx = streamingWx([encode(sseEvent({ response_type: "error", content: "model unavailable", done: true }))]);
  try {
    const { knowledgeChat } = loadRequest();
    await assert.rejects(knowledgeChat("s", "q", "kb-1"), /model unavailable/);
  } finally {
    global.wx = originalWx;
  }
});

test("chat page renders bubbles and streams the assistant reply", async () => {
  const pageDefinitions = [];
  const originalPage = global.Page;
  const originalWx = global.wx;
  const body =
    sseEvent({ response_type: "answer", content: "第一段" }) +
    sseEvent({ response_type: "answer", content: "第二段", done: true });

  try {
    global.Page = (definition) => pageDefinitions.push(definition);
    const wxMock = streamingWx([encode(body)]);
    const baseRequest = wxMock.request;
    global.wx = {
      ...wxMock,
      setStorageSync() {},
      setTabBarItem() {},
      setNavigationBarTitle() {},
      request(options) {
        if (options.url.endsWith("/api/v1/sessions")) {
          setTimeout(() => options.success({ statusCode: 200, data: { data: { id: "session-9" } } }), 0);
          return {};
        }
        return baseRequest(options);
      }
    };

    for (const mod of ["utils/i18n.js", "utils/config.js", "utils/request.js", "pages/chat/chat.js"]) {
      delete require.cache[require.resolve(`../../miniprogram/${mod}`)];
    }
    require("../../miniprogram/pages/chat/chat.js");
    const def = pageDefinitions[0];
    const page = {
      ...def,
      data: JSON.parse(JSON.stringify(def.data)),
      setData(patch) {
        for (const [key, value] of Object.entries(patch)) {
          const match = key.match(/^messages\[(\d+)\]\.(\w+)$/);
          if (match) {
            this.data.messages[Number(match[1])][match[2]] = value;
          } else {
            this.data[key] = value;
          }
        }
      }
    };
    page.onLoad();
    page.onQueryInput({ detail: { value: "  介绍一下  " } });

    await page.ask();

    assert.equal(page.data.loading, false);
    assert.equal(page.data.query, "");
    assert.equal(page.data.sessionId, "session-9");
    assert.equal(page.data.messages.length, 2);
    assert.deepEqual(
      page.data.messages.map((m) => [m.role, m.content, m.status]),
      [
        ["user", "介绍一下", "done"],
        ["assistant", "第一段第二段", "done"]
      ]
    );
    assert.equal(page.data.sendText, "发送");

    page.newChat();
    assert.deepEqual(page.data.messages, []);
    assert.equal(page.data.sessionId, "");
  } finally {
    global.Page = originalPage;
    global.wx = originalWx;
  }
});
