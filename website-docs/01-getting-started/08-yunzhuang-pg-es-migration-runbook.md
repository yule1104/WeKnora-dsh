# 云妆 WeKnora：ParadeDB 迁移至 PostgreSQL 17 + Elasticsearch 8

本文记录 2026-10-16 在 v0.8.3 生产服务器上的迁移演练与切换。以后迁往阿里云或升级 WeKnora 时，应先按目标版本源码和升级须知重新核对迁移、索引字段、向量维度及云服务的 TLS 要求。**不要把生产 `.env`、备份或测试账号提交到 Git。**

## 基线与目标

- 原部署：`/opt/weknora-v0.8.3`，Compose 项目 `weknora-v082`，ParadeDB `v0.25.11-pg17`，迁移版本 118。原数据库容器 `WeKnora-postgres` 和卷 `weknora-v082_postgres-data` 保留；切换后容器停止。
- 新部署：`/opt/weknora-v0.8.3-pg-es`。独立 Compose 项目 `weknora-migration` 管理 `WeKnora-pg17`、`WeKnora-es`，使用独立卷 `weknora-pg17-data`、`weknora-es-data`，并加入现有 WeKnora Docker 网络；两个新容器均不发布宿主机端口。
- 新业务库 `weknora_prod`、Langfuse 库 `weknora_langfuse`、ES 索引 `weknora_prod_v083`。PostgreSQL 镜像 `pgvector/pgvector:pg17`，实测 PostgreSQL 17.10、vector 0.8.5；ES 镜像 `elasticsearch:8.17.0`，拉取时的 digest 为 `sha256:0681af5779b516b0652df86aa1db52e225f2d4e68bb3a3099534377b7f788739`。
- 官方前端仍为 `18080`，云妆前端仍为 `18082`，后端 `127.0.0.1:18081`。前端和后端仍使用原 v0.8.3 镜像，云妆镜像仍为 `weknora-ui:yunzhuang-v083-1e391c7`。

## 迁移做法

1. **先读生产事实。** 查 `schema_migrations`、每个数据库的扩展、`embeddings` 各维度分布、租户 `retriever_engines`、知识库 `vector_store_id`，以及磁盘、内存和 `vm.max_map_count`。本次 13,225 条向量全部为 1024 维，因而可以使用单个 ES 索引；以后出现不同维度时，不能直接复用此索引方案。
2. **做两轮备份。** 演练前生成 PostgreSQL 自定义格式备份和配置备份；停止 WeKnora、解析器、Langfuse 及相关写入服务后，再生成最终 `pg_dumpall`、WeKnora/Langfuse 自定义格式备份、配置包和旧数据卷归档。最终备份位于 `/opt/weknora-pg-es-migration-20261016/final/`，其中 `SHA256SUMS` 已逐项校验，压缩包已通过 `gzip -t`。该目录含敏感数据，应限制访问并按保留策略处理。
3. **在独立库恢复。** 先等待新 PostgreSQL 日志出现 `PostgreSQL init process complete`。对 WeKnora 的 `pg_restore` TOC 仅移除新库没有的 ParadeDB/PostGIS/pg_ivm 扩展及其配置表数据、`embeddings_search_idx` BM25 索引；保留 `vector`、`pg_trgm`、`uuid-ossp`、业务表、序列、外键和原始 `embeddings`。特别注意过滤 `COMMENT ON SCHEMA topology`、`paradedb._typmod_cache` 的数据和序列，否则恢复中途会失败。Langfuse 库单独完整恢复。使用 `--exit-on-error`，任何错误都应重建**新库**后重试，不能忽略。
4. **导入 ES。** 在应用启动前创建 `weknora_prod_v083`，设 1 个分片、0 个副本；`embedding` 为 1024 维 `dense_vector`，ID 字段为 `keyword`，`content` 为 `text`。从恢复后的 `embeddings` 逐批导入，使用原行 ID 作为 ES `_id`，从 `chunks.flags` 补齐 `is_recommended`。逐批检查 bulk 响应中的 `errors`，最后比较 PostgreSQL 行数和 ES `_count`。脚本和演练日志保存在 `/opt/weknora-pg-es-migration-20261016/`。本次没有重新解析旧文档，也没有重新生成向量。
5. **改部署配置并切换。** 候选 `.env` 设置 `DB_HOST=WeKnora-pg17`、`DB_NAME=weknora_prod`、`RETRIEVE_DRIVER=elasticsearch_v8`、`ELASTICSEARCH_ADDR=http://WeKnora-es:9200` 和 ES 认证、索引名。Langfuse 的硬编码 `postgres:5432` 连接改到 `WeKnora-pg17:5432`，库名改为 `weknora_langfuse`。候选 Compose 删除旧 `postgres` 服务和相关 `depends_on`，避免以后 `up` 时自动启动旧库；不要使用 `--remove-orphans` 或 `down -v`。最终备份后用最终快照重新恢复新库、重建 ES 索引，再启动服务。

## 实测验收

- 恢复后的 `schema_migrations=118`、`dirty=false`；新库没有 `pg_search`。排除旧扩展自带的 `spatial_ref_sys` 后，WeKnora 的 75 张业务表、Langfuse 的 72 张表均存在。切换后重新逐表比较：没有业务表缺失或行数下降，增加的记录来自验收及后台任务。核对脚本使用 `docker exec -i` 向 `psql` 传入 SQL；少了 `-i` 会得到两个空结果文件，造成虚假的“相等”。
- ES 导入 13,225 条、`_count=13225`；中文关键词查询返回结果，自身向量相似度为 1.0。应用日志显示 `Skip embedding: true`、ES 引擎注册成功，实际知识检索同时召回关键词和 1024 维向量结果，重排成功。
- 测试账号登录成功；现有知识库可读。临时文档上传并解析到 `completed`，之后删除；`embeddings` 与 ES 文档数均回到 13,225。问答 SSE 返回 `complete`、正文和 14 条引用，测试会话已删除。Langfuse web 返回 HTTP 200，web/worker 无启动错误。两个前端及后端健康接口均返回 HTTP 200。
- 旧 `WeKnora-postgres` 为停止状态，原数据卷仍挂载在旧容器上。新 PG 和 ES 健康且没有宿主机公开端口。文件、Redis、Neo4j、Langfuse ClickHouse 和 MinIO 沿用原有数据卷。

## 回退与下一次演练

若在开放正常写入前验收失败，停止新应用和 Langfuse，启动旧 ParadeDB，并用旧部署配置启动应用。验收写入可以舍弃。**开放写入后旧库不会自动同步**；直接切回会丢失新数据，必须先处理增量写入或从新环境备份恢复。保持最终备份和旧卷，直到观察期结束。

本次 ES 使用内建全文分析器，中文排序可能与 ParadeDB 的 Lindera BM25 不同；迁到阿里云前应以代表性查询评估排序质量。当前 WeKnora v0.8.3 的 PostgreSQL DSN 固定 `sslmode=disable`，同机 Docker 演练不能证明阿里云 RDS TLS 连接可用；进入云上实施前须单独解决并验证这一点。
