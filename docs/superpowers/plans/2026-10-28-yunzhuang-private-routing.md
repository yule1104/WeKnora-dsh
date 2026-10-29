# 云妆部署级内部知识路由

目标：云妆 18082 全账号、全工作空间使用内部意图判断及不可逆会话锁定；其他入口保持原行为。

## 已实现约束

- 专用后端环境开关 `WEKNORA_PRIVATE_ROUTING_ENABLED=true`。
- `WEKNORA_PRIVATE_CHAT_MODEL_ID` 指向管理员指定的可信模板，`WEKNORA_PRIVATE_CHAT_MODEL_TENANT_ID` 指定模板所属空间（默认 10000）。
- 每个空间自动复制内部模型及“云妆内部问答”；模型参数运行时始终从可信模板读取，不信任可编辑副本。云妆后端拒绝修改受管理模型。
- `WEKNORA_PRIVATE_AUX_MODEL_IDS` 为显式批准的辅助模型 ID 列表，默认空。空列表阻止云端 Embedding、Rerank、VLM、ASR。已有关键词索引允许降级检索；新增向量索引需私域 Embedding。
- 2026-10-29 用户授权暂用现有外部 Embedding 和图片识别：独立设置 `WEKNORA_PRIVATE_ALLOW_EXTERNAL_EMBEDDING=true`、`WEKNORA_PRIVATE_ALLOW_EXTERNAL_VLM=true`。例外只用于各自能力，不放开文本生成、Rerank 或 ASR；未来接入私域替代模型后关闭。入库摘要、问题生成、Wiki 等非公开对话文本调用强制解析到可信内部模型，不再受知识库遗留外部摘要模型配置影响。此临时例外意味着文档切片及图片会发送给相应外部服务，不能称整条入库链路不出私域。
- 发布后端必须保留原版本的解析能力：先执行 `scripts/build-anydoc-lib.sh` 构建匹配源码的静态库，再以 `-tags anydoc` 构建 Go 二进制（标准 Dockerfile 默认 `WITH_ANYDOC=1`）。发布候选与原后端分别读取 `/api/v1/system/parser-engines`，候选不得丢失原先可用的引擎及其格式，并用合成 Markdown、Office 与图片文件执行完整上传入库验收。
- 公开问题使用内置智能推理，只提供通用推理工具，无知识库、MCP、浏览器、技能、文件读取或跨会话记忆。
- 内部引用、附件、旧会话及不确定判断保守进入内部问答。`privacy_locked` 独立持久化且只从 false 变为 true。
- PostgreSQL advisory lock 持续覆盖后台回答，HTTP 断开不会提前释放；同一会话并发请求返回冲突。云妆暂不允许流式过程中的 steer 注入。
- 所有标题使用内部模型；推荐问题用内部模型；Langfuse 禁用。旧版内联视觉模型拒绝执行。
- 当前仅 Go 内置简单格式解析器可用，复杂文档/图像/音频解析在未审批私域处理能力前拒绝执行。

## 共享数据库部署

专用云妆后端、独立 Redis 队列，保持原有数据库和账号。18082 全部动态请求指向专用后端。官方 18080/原 app 不切换。

先备份数据库及容器配置，手动执行 `migrations/versioned/000119_session_private_routing.up.sql` 的兼容增量 DDL，**不推进共享 schema_migrations 版本**；专用后端 `AUTO_MIGRATE=false`，避免旧官方后端重启时遇到无法识别的新版本。后续全后端升级时可由迁移器幂等登记版本。

候选验证后再替换前端容器；保留原容器及旧静态资源。回滚时恢复前端容器即可回到原后端；保留兼容新增列，不回退共享数据。

## 验证

本地覆盖模型地址篡改、分类异常/重复 JSON 字段、显式资料检测、跨空间路由拒绝、内部锁定连续追问、模型不可用、旧会话保守路由及公开文件工具隔离。另执行原有 service/handler/logger/parser/tracing 回归和前端构建。

部署验收使用合成资料及测试会话。实际云端 Mock 只证明功能，不证明数据不出私域。真正上线私域能力需替换可信模板，配置私域辅助模型/解析器，并验证出站网络。
