# WeKnora Mini Program

This directory contains a WeChat Mini Program plugin for WeKnora. It gives mobile users a lightweight entry point to:

- configure a WeKnora API endpoint and tenant API key;
- switch UI language between Chinese and English;
- list available knowledge bases;
- import a URL into a selected knowledge base;
- ask a selected knowledge base through WeKnora knowledge chat.

## Getting started

1. Open `miniprogram/` in WeChat DevTools.
2. Copy `project.private.config.json.example` to `project.private.config.json` and set your real Mini Program AppID. The shared `project.config.json` intentionally does not include an AppID to avoid forcing maintainers into a placeholder project.
3. Open the **Settings** tab and fill in:
   - API Base URL, for example `https://weknora.example.com`;
   - API Key from the WeKnora tenant settings page;
   - Language (`中文` / `English`, default `中文`).
4. Open the **Knowledge** tab, refresh knowledge bases, and select the target knowledge base.
5. Import a URL or switch to **Chat** to ask questions.

## Language

- Locale strings live in `utils/i18n.js`.
- The selected language is stored in local settings as `locale` (`zh` | `en`).
- Changing language in Settings updates page copy, navigation titles, and tab bar labels immediately.

## Local development notes

- WeChat DevTools may block `localhost` requests when URL validation is enabled. For local testing, either disable domain validation in DevTools or expose WeKnora through a HTTPS development domain.
- In production Mini Programs, add the WeKnora API domain to the Mini Program request domain allowlist.
- The chat endpoint returns Server-Sent Events. The Chat tab is a bubble-style multi-turn conversation that reuses one session until **新对话 / New chat** is tapped.
- Answers are streamed: `wx.request` is called with `enableChunked: true` and `onChunkReceived` (base library ≥ 2.20.2). `utils/utf8.js` decodes chunks without breaking multi-byte characters, `utils/sse.js` (`createSSEParser`) parses events across chunk boundaries, and only `response_type: "answer"` content is rendered (batched every ~80 ms). On base libraries without chunked transfer the full SSE body is parsed once the request completes.
- Any reverse proxy in front of the API must not buffer `text/event-stream` responses (e.g. nginx `proxy_buffering off;`), otherwise the answer still arrives all at once.

## Test

```bash
cd miniprogram
npm test
```
