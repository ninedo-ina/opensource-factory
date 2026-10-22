# 全量导出与归档（openfactory.archive.v1）

> 需求：REQ-202610-0981（backlog M9-04）｜实现：`edge/src/archive/` + `edge/src/routes/archive.ts` + admin `/archive`
>
> 相关文档：[知识库导出](./knowledge-export.md) · [备份与恢复](./backup-restore.md) · [数据模型](../architecture/data-model.md)

## 1. 定位与边界

M9-04 提供**用户级逻辑归档**：把当前账号在 D1 中的业务数据按统一格式打包下载，
用于长期保存、账号迁移与外部审计。它与 M5-04 的**物理备份**互补：

| 维度 | 全量归档（M9-04） | 物理备份（M5-04） |
| --- | --- | --- |
| 对象 | 单个用户的业务数据 | 整个 D1 / SQLite 数据库 |
| 触发 | 用户在 admin 主动下载 | Celery beat / cron 定时 |
| 存放 | 浏览器直接保存，服务端不留副本 | 服务器 `backups/` 目录 |
| 恢复 | 逻辑导入（按数据集） | 整库快照恢复 |
| 格式 | `openfactory.archive.v1`（ZIP / JSON） | SQLite 快照 / `wrangler d1 export` |

设计约束：

- **只读**：所有查询按 `user_id` 过滤，不新增 D1 表、不写库；
- **不落盘**：归档在请求内实时构建，响应后即释放，平台不保存归档文件；
- **不含秘密**：会话、扩展令牌、Telegram 绑定码、登录安全事件与运维指标永不进入归档；
- **可校验**：每个数据文件都有 SHA-256，ZIP 包内提供 `checksums.sha256`；
- **格式稳定**：`openfactory.archive.v1` 只加字段、不改既有语义。

## 2. 接口

均需登录（Cookie 会话），未登录返回 `401 {"error":"unauthorized"}`。

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/export/archive/summary` | GET | 数据集条数、记录总数、估算大小、可选范围与格式 |
| `/api/export/archive/manifest` | GET | 仅返回 manifest（`?scope=full\|knowledge&format=zip\|json`），便于预览与自动化 |
| `/api/export/archive` | GET | 生成并下载归档（同上参数；默认 `full` + `zip`） |

下载响应头：

```
Content-Type: application/zip | application/json; charset=utf-8
Content-Disposition: attachment; filename="openfactory-archive-YYYY-MM-DD.zip|json"
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

参数非法时回退默认值（未知 `scope` → `full`，未知 `format` → `zip`），不报错。

## 3. 归档范围

### 3.1 `scope=full`（默认）

11 个数据集，覆盖当前用户的全部业务数据：

| key | 数据集 | 来源表 | 说明 |
| --- | --- | --- | --- |
| `profile` | 账号资料 | `users` | id / login / name / email / avatar_url / created_at |
| `repositories` | 收藏仓库 | `my_repositories` + `categories` + `repo_tags` | 含分类名与逗号拼接的标签名 |
| `categories` | 分类 | `categories` | 仅导出被当前用户仓库引用的分类（含父级 / 排序） |
| `tags` | 标签 | `tags` + `repo_tags` | 按标签聚合为 `{id,name,repoIds}` |
| `recommendations` | 智能推荐 | `recommendations` | 当前用户的推荐记录 |
| `recommendation-feedback` | 推荐反馈 | `recommendation_feedback` | 收藏 / 忽略 / 点击等反馈 |
| `notifications` | 站内通知 | `notifications` | 站内信与推送记录 |
| `push-preferences` | 推送偏好 | `push_preferences` | 通道开关、时间、时区、阈值 |
| `reports` | 精选报告 | `curated_reports` | 周报 / 月报正文与统计 |
| `repo-updates` | 更新提醒 | `repo_updates` | Release / Tag 扫描结果 |
| `duplicate-dismissals` | 重复检测忽略记录 | `duplicate_dismissals` | 用户主动忽略的重复簇 |

### 3.2 `scope=knowledge`

只包含前四个数据集（`profile` / `repositories` / `categories` / `tags`），
与 M6-08 知识库导出的数据口径一致，适合轻量迁移。

### 3.3 明确排除

以下数据永不进入归档（`manifest.privacy.excluded` 同步列出）：

`sessions`、`extension_tokens`、`telegram_links`、`telegram_link_codes`、
`login_attempts`、`security_events`、`worker_metrics`、`rate_limit_counters`。

邮箱仅来自用户自己的 GitHub 资料，随归档由用户自行保管。

## 4. 文件布局

### 4.1 ZIP（`format=zip`，默认）

```
openfactory-archive-YYYY-MM-DD.zip
├── manifest.json       # 格式、账号、统计、数据集清单、隐私与恢复说明
├── README.md           # 人类可读的数据集表、校验与恢复步骤
├── checksums.sha256    # manifest / README / data/*.json 的 SHA-256
└── data/
    ├── profile.json
    ├── repositories.json
    ├── categories.json
    ├── tags.json
    └── …               # 按 scope 决定数据集数量
```

- ZIP 使用 **store 模式**（不压缩），复用 M6-08 的最小 writer，无第三方依赖；
- 每个 JSON 文件为 `JSON.stringify(records, null, 2) + "\n"`；
- `checksums.sha256` 为 GNU coreutils 格式（`<64位小写hex>  <相对路径>`），可直接执行：

```bash
unzip openfactory-archive-2026-10-22.zip -d archive
cd archive
sha256sum -c checksums.sha256
```

### 4.2 单文件 JSON（`format=json`）

```json
{
  "manifest": {
    "schema": "openfactory.archive.v1",
    "version": 1,
    "format": "json",
    "checksums": { "algorithm": "sha256", "embedded": true }
  },
  "checksums": {
    "data/profile.json": "<sha256>",
    "data/repositories.json": "<sha256>"
  },
  "data": {
    "profile": [ ... ],
    "repositories": [ ... ]
  }
}
```

JSON 模式的 `checksums` 以 `data/<key>.json` 为键；由于没有独立文件，
`manifest.checksums.embedded` 为 `true`。

## 5. manifest 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schema` | string | 固定 `openfactory.archive.v1` |
| `version` | number | 当前 `1` |
| `archiveId` | string | `arc-<YYYYMMDDHHmmss>-<scope>`，同一生成时刻可复现 |
| `generatedAt` | string | ISO 8601 生成时间 |
| `generator` | object | `{name:"OpenFactory", url}` |
| `format` | string | `zip` / `json` |
| `scope` | string | `full` / `knowledge` |
| `user` | object | `id` / `login` / `name` / `email`（仅本人数据） |
| `stats` | object | `datasets` / `records` / `bytes` / `files` |
| `datasets` | array | 每个数据集：`key` / `label` / `path` / `records` / `bytes` / `sha256` |
| `privacy` | object | `excluded[]` / `notes[]` |
| `restore` | object | `mode:"logical"` + 导入顺序说明 |
| `checksums` | object | `algorithm:"sha256"`；ZIP 带 `file:"checksums.sha256"`，JSON 带 `embedded:true` |

`stats.files`：ZIP 为数据集数 + 3（manifest / README / checksums），JSON 为数据集数。
`stats.bytes` 只统计 `data/*.json` 的 UTF-8 字节数，不含 manifest 与 README。

## 6. 恢复

归档是**逻辑备份**，不包含 D1 自增 ID 以外的部署信息，也没有自动恢复接口。
建议顺序：

1. 解压并校验 `sha256sum -c checksums.sha256`；
2. 读取 `manifest.json`，确认 `schema` / `version` / `user.login`；
3. 先导入 `profile`，再导入 `categories` 与 `tags`；
4. 导入 `repositories`，按 `category_name` / `tag_names` 重建关联；
5. 最后导入活动数据（推荐、通知、报告、更新提醒、忽略记录）。

跨账号导入时必须改写 `user_id`；`repo_tags` 需要按标签名重新解析 `tag_id`。
生产环境批量导入前先在测试库演练，并保留导入前快照。

## 7. 保留策略与安全建议

平台不保存归档副本，保留策略由用户 / 组织自行决定。建议：

- 归档包含邮箱与个人收藏，按内部数据分级至少按「内部」保管；
- 下载后放入加密盘或加密压缩包，不要提交到 Git 仓库；
- 建议每季度生成一次完整归档，重大迁移前额外生成一次；
- 校验和与归档分开存放时，先核对 `checksums.sha256` 的 SHA-256 再使用；
- 不再需要的归档按组织保留周期销毁，避免历史副本扩散。

## 8. 限制与后续

- 当前为**明文归档**，不含加密与签名；如需加密，建议下载后用 age / GPG 二次封装；
- 大账号（十万级记录）会一次性在 Worker 内存中构建，受 Workers 内存与响应体限制，
  后续可评估分卷导出或流式打包；
- 归档只覆盖 D1 业务数据，不含 VPS 本地 SQLite 的向量 / README 镜像与部署配置；
- 自动恢复、定时归档与对象存储托管不在本需求范围，记入 `docs/requirements/open-questions.md` Q37。

## 9. 验证

- `edge/scripts/archive-build.test.mjs`：格式归一、ID / 文件名、manifest 统计、ZIP 条目与逐文件校验和、JSON 单文件、空数据集；
- `edge/scripts/archive-route.test.mjs`：summary 统计、knowledge 范围、下载内容、未登录 401；
- `admin/src/features/archive/archive.test.ts`：工具函数、范围过滤、演示模式 JSON / ZIP 生成。
