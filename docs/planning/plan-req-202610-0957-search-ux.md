# 实施计划 · REQ-202610-0957 检索体验精修（搜索建议 / 历史 / 快捷键）

> 需求：REQ-202610-0957（backlog M6-10）｜ 分支：`feat/req-202610-0957-search-ux`
> 依赖：M6-01 全文检索（REQ-202610-0948）｜ 基线：`feat/req-202610-0948-fulltext-search` @ `e1d9210`

## 1. 现状与缺口

- `/search` 已支持语义检索与 README 全文检索切换（M3-04 / M6-01），但输入框只是一个普通表单：
  没有输入建议、没有最近搜索，用户每次都要重新输入完整描述；
- 检索页没有任何键盘操作约定，`Ctrl / Cmd + K` 只打开全局导航命令面板，无法聚焦检索输入框；
- 用户收藏库与热榜中的仓库名、标签是天然的高质量建议来源，但目前没有被检索框利用；
- 搜索结果页没有「最近搜过什么」的上下文，重复检索成本高。

## 2. 方案总览

```
admin /search
  ├─ 输入框（combobox）
  │    ├─ 聚焦且为空 → 最近搜索（localStorage）+ 热门标签 / 热门仓库（edge）
  │    ├─ 输入 ≥1 字 → 防抖 200ms 调 GET /api/search/suggestions?q=
  │    └─ 键盘：↑ / ↓ 选择、Enter 执行、Esc 关闭、/ 聚焦、Ctrl/Cmd+Enter 检索
  ├─ 搜索历史（localStorage，按查询去重，最多 8 条，可单条删除 / 清空）
  └─ 快捷键帮助面板（? 或按钮打开）
        ↓
GET /api/search/suggestions（edge，登录态）
  ├─ my_repositories：按 user_id 过滤，匹配 name / id / description
  ├─ trending_repositories：匹配 name / id / description / tech_stack
  ├─ tags：join repo_tags + my_repositories，按当前用户过滤
  └─ 去重（同仓库保留「我的仓库」来源）、前缀优先、按热度排序、最多 10 条
```

设计要点：

- **建议只读、按用户隔离**：edge 查询一律带 `user_id = ?`，`trending` 为全局公开数据；
- **优雅降级**：edge 不可用时前端回退演示建议；历史完全存本地，不依赖服务端；
- **不新增表 / 迁移**：建议直接复用 `my_repositories` / `trending_repositories` / `tags` / `repo_tags`；
- **可访问性**：输入框遵循 combobox + listbox 语义，方向键 / Enter / Esc 均可操作，选项有文字标签而非只靠颜色；
- **历史隐私**：只存查询文本、检索方式与范围，不存结果；键名 `of-search-history`，可一键清空。

## 3. 接口契约

`GET /api/search/suggestions?q=<关键词>&limit=<1~10>`（需登录；未登录 `401`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 归一化后的查询（空串表示热门建议） |
| `count` | number | 返回条数 |
| `tookMs` | number | 查询耗时 |
| `items[].id` | string | 稳定标识（仓库为 `source:id`，标签为 `tag:name`） |
| `items[].type` | `repo` \| `tag` | 建议类型 |
| `items[].label` | string | 展示文本（仓库为 `owner/name`，标签为标签名） |
| `items[].value` | string | 选中后写入检索框的值 |
| `items[].description` | string | 仓库简介 / 标签说明（可空） |
| `items[].source` | `my` \| `trending` | 仓库来源（标签为空） |
| `items[].language` | string | 仓库语言（标签为空） |
| `items[].stars` | number | 仓库 Star 数（标签为空） |
| `items[].url` | string | 仓库地址（标签为空） |

排序规则：

1. 名称 / `owner/name` 前缀命中优先于包含命中，包含命中优先于仅简介命中；
2. 有查询时同层先按来源（我的仓库优先于热榜），再按 Star / 今日 Star 降序；空查询按热度降序；
3. 同仓库同时出现在两个来源时只保留「我的仓库」；
4. 标签按使用次数降序；空查询返回热门标签 + 热门仓库各若干。

## 4. 前端行为

| 能力 | 规则 |
| --- | --- |
| 搜索历史 | localStorage `of-search-history`；每次成功检索写入；按归一化查询忽略大小写去重；最多 8 条；可单条删除 / 清空 |
| 建议防抖 | 输入变化后 200ms 请求；请求带 `AbortSignal`，旧请求自动取消；输入为空时展示历史 + 热门 |
| 键盘快捷键 | `/` 聚焦检索框（输入态除外）；`↑` / `↓` 移动高亮；`Enter` 选中或检索；`Esc` 关闭建议；`Ctrl / Cmd + Enter` 立即检索；`Alt + 1 / 2` 切换语义 / 全文；`?` 打开快捷键帮助 |
| 选择建议 | 仓库 / 标签建议写入检索框并立即检索；历史项恢复查询、检索方式与范围后检索 |
| 无后端 | 建议请求失败时使用内置演示建议；历史与快捷键不受影响 |

## 5. 交付物

| 文件 | 说明 |
| --- | --- |
| `edge/src/search/suggestions.ts` | 查询归一化、LIKE 转义、排序去重、响应构建纯函数 |
| `edge/src/routes/search-suggestions.ts` | `GET /api/search/suggestions` 路由与 D1 查询 |
| `edge/src/index.ts` | 挂载建议路由 |
| `edge/scripts/search-suggestions.test.mjs` | 纯函数与路由参数测试 |
| `admin/src/features/search/history.ts` | 搜索历史读写、去重、删除、清空 |
| `admin/src/features/search/suggestions.ts` | 建议分组、扁平化、高亮、键盘索引纯函数 |
| `admin/src/features/search/api.ts` | 建议 DTO、请求封装、演示数据兜底 |
| `admin/src/features/search/index.tsx` | 建议下拉、历史、快捷键与帮助面板 |
| `admin/src/features/search/search.test.ts` | 工具函数测试扩展 |
| `admin/src/features/search/history.test.ts` / `suggestions.test.ts` | 历史与建议纯函数测试 |
| 文档 | 本计划、架构总览 API 表、backlog / roadmap / task-planning、admin / edge README |

## 6. 测试与验收

| 层 | 用例 |
| --- | --- |
| edge | 查询归一化 / 长度截断、limit 夹取、LIKE 通配符转义、仓库去重与来源优先、前缀排序、标签合并、空查询热门建议 |
| admin | 历史解析容错 / 去重 / 上限 / 删除 / 清空；建议分组 / 扁平化 / 键盘循环 / 高亮拆分；API 请求路径与演示兜底 |
| 回归 | `edge npm run typecheck` + `npm test`；`admin npm run lint` + `npm run build` + `npm run test` |
| 手工 | 聚焦输入框看到历史与热门；输入关键词出现建议；方向键 + Enter 可选中；`/` 可聚焦；`Esc` 关闭；历史可清空；接口不可用时仍可检索 |

验收标准：

1. 输入框聚焦且为空时展示最近搜索与热门建议；无历史时展示热门标签 / 仓库；
2. 输入 1~200 字关键词后 200ms 内出现建议，建议只包含当前用户可见仓库与公开热榜；
3. 方向键可在建议间循环移动，Enter 选中并检索，Esc 关闭且不触发检索；
4. 每次检索成功后历史自动记录，重复查询不重复，支持单条删除与清空；
5. `/`、`Ctrl / Cmd + Enter`、`Alt + 1 / 2`、`?` 快捷键在检索页生效，且不会干扰输入框正常输入；
6. edge / admin 检查全绿，文档同步更新。

## 7. 风险与后续

- **建议质量**：D1 只有名称 / 简介 / 标签，无法做语义建议；后续可接 VPS 查询理解词表或热词统计；
- **D1 LIKE 成本**：当前按用户数据量级（千级）可接受；规模增长后建议改为前缀索引或 FTS5；
- **历史仅本机**：localStorage 不跨设备；如需跨端同步，后续可复用用户偏好表；
- **快捷键冲突**：`/` 与 `?` 在输入框 / 可编辑区域不生效；`Ctrl / Cmd + K` 保持全局命令面板不变。
