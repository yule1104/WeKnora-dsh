# Yunzhuang AI Mini Program

This directory contains a WeChat Mini Program plugin for Yunzhuang AI. It gives mobile users a lightweight entry point to:

- configure a Yunzhuang AI API endpoint and tenant API key;
- switch UI language between Chinese and English;
- list available knowledge bases;
- import a URL into a selected knowledge base;
- ask a selected knowledge base through Yunzhuang AI knowledge chat.

## Getting started

1. Open `miniprogram/` in WeChat DevTools.
2. Copy `project.private.config.json.example` to `project.private.config.json` and set your real Mini Program AppID. The shared `project.config.json` intentionally does not include an AppID to avoid forcing maintainers into a placeholder project.
3. Open the **Settings** tab and fill in:
   - API Base URL, for example `https://ai.example.com`;
   - API Key from the Yunzhuang AI tenant settings page;
   - Language (`中文` / `English`, default `中文`).
4. Open the **Knowledge** tab, refresh knowledge bases, and select the target knowledge base.
5. Import a URL or switch to **Chat** to ask questions.

## Language

- Locale strings live in `utils/i18n.js`.
- The selected language is stored in local settings as `locale` (`zh` | `en`).
- Changing language in Settings updates page copy, navigation titles, and tab bar labels immediately.

## Local development notes

- WeChat DevTools may block `localhost` requests when URL validation is enabled. For local testing, either disable domain validation in DevTools or expose Yunzhuang AI through a HTTPS development domain.
- In production Mini Programs, add the Yunzhuang AI API domain to the Mini Program request domain allowlist.
- The chat endpoint returns Server-Sent Events. The Mini Program client parses completed SSE text responses and displays accumulated `answer` chunks.

## Test

```bash
cd miniprogram
npm test
```

## 客户演示前生效检查

- 在微信开发者工具中重新编译 / 上传体验版，确认设置、知识库、问答、中英文切换及默认导航标题均为云妆 AI 品牌。
- 客户端已有的连接参数会在首次启动时迁移至新的本地存储键；旧键仅用于一次性兼容读取，不用于界面展示。
- 将本分支 `config/prompt_templates/` 中的身份模板同步到实际连接的服务环境并重启服务；仅重新编译小程序不会改变服务端回答身份。
- 检查实际使用的 Agent 是否配置了自定义系统提示词；自定义文本会覆盖模板，需同步使用“云妆 AI”产品身份。不要伪称底层模型供应商。
- 重新进入小程序以创建新会话，避免旧历史里错误的自我介绍影响演示。分别测试“你是谁”“你好”“你能做什么”、品牌资料问答和无匹配资料时的回复。
- 本地检查不能代替目标环境的模型调用及真机验证；以体验版实际回复为准。

## 云妆演示服务地址（2026-11-04）

小程序设置页的 API Base URL 使用 `https://wekdsh.pgcodeagent.com/yunzhuang`（不要追加 `/api/v1`）。该路径转发至云妆服务，域名根路径仍指向官方服务。使用云妆租户有效 API Key，保存后刷新知识库并重新进入问答页创建会话。

服务端四份身份模板已部署并持久化挂载；真实身份问答已验证为云妆助手。公网 TLS 1.3 请求正常，TLS 1.2 探测仍被重置；真机需另行验证，开发者工具通过不代表真机通过。
