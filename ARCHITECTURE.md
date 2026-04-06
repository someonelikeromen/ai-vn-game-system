# 无限武库 游戏系统 — 程序架构说明文档

> 最后更新：2026-03-18  
> 适用版本：当前代码库（内容层内置 + 运行时编辑器支持 + 抽卡系统 + 世界身份继承 + 控制台分流 + 人性化统一 UI 皮肤 + 世界时间轴同步系统 + 回归主世界兑换）

---

## 目录

1. [总体架构](#1-总体架构)
2. [目录结构](#2-目录结构)
3. [核心层 src/core/](#3-核心层-srccore)
4. [内容层 src/content/](#4-内容层-srccontent)
5. [引擎层 src/engine/](#5-引擎层-srcengine)
6. [功能层 src/features/](#6-功能层-srcfeatures)
7. [路由层 src/routes/](#7-路由层-srcroutes)
8. [前端文件 public/](#8-前端文件-public)
9. [数据文件 data/](#9-数据文件-data)
10. [数据流全链路](#10-数据流全链路)
11. [内容层数据流](#11-内容层数据流)
12. [关键数据结构](#12-关键数据结构)

---

## 1. 总体架构

```
浏览器 (前端 HTML/JS)
    │  HTTP / SSE
    ▼
Express 服务器 (server.js)  ── config.json ──▶ 读取 LLM 设置
    │
    ├── 路由层 (src/routes/)
    │       └── 各功能域路由文件（game / session / shop / gacha / world / preset / worldbook / ...）
    │
    ├── 游戏循环 (src/engine/gameLoop.js)
    │       ├── 提示词组装 (promptBuilder.js)
    │       │       └── 变量快照 (varEngine.js)
    │       ├── LLM 调用 (llmClient.js)  ──▶ 外部 OpenAI 兼容 API
    │       └── 正则管道 (regexPipeline.js)
    │               └── 变量解析 (varEngine.js)
    │
    ├── 内容层 (src/content/)
    │       ├── presets.js   ── 171 条提示词（内置，含禁用项）
    │       ├── worldbook.js ── 8 条世界书条目（含禁用项）
    │       ├── regex.js     ── 23 条正则规则（含禁用项）
    │       ├── charCard.js  ── 角色卡基础信息
    │       └── index.js     ── 统一导出 + ST JSON 格式转换
    │
    ├── 存档管理 (src/core/session.js)  ──▶ data/sessions/*.json
    │
    ├── 运行时覆盖 (data/content-overrides.json)
    │       ──▶ 编辑器保存后优先于内置内容
    │
    ├── 商城子系统 (src/features/shop/)
    ├── 抽卡子系统 (src/features/gacha/)
    ├── 世界档案子系统 (src/features/world/)
    ├── 角色生成子系统 (src/features/character/)
    │
    └── 日志 (src/core/logger.js)  ──▶ data/logs/YYYY-MM-DD.log
```

---

## 2. 目录结构

```
game-system/
├── server.js                   # Express 主入口，注册路由，依赖注入
├── config.json                 # 运行时配置（LLM API、用户设置）
│                               # ⚠️ charCardPath / presetPath 已清空（使用内置内容）
├── package.json
├── start.bat
├── README.md
├── ARCHITECTURE.md
├── CHANGELOG.md
│
├── src/
│   ├── core/                   # 基础设施层
│   │   ├── config.js           # 配置读写 + 资产加载（含 mtime 缓存 + 覆盖支持）
│   │   ├── configLoader.js     # ST JSON 解析（人物卡 / 预设 → 内部格式）
│   │   ├── llmClient.js        # OpenAI 兼容 HTTP 客户端（流式支持）
│   │   ├── logger.js           # 日志系统
│   │   ├── session.js          # 存档内存管理 + 磁盘持久化
│   │   └── sessionLock.js      # 会话并发互斥锁
│   │
│   ├── content/                # 内置内容层（不依赖外部文件）
│   │   ├── index.js            # 统一导出：getBuiltinCharCard / getBuiltinPreset
│   │   │                       #   + getBuiltinWorldbookRaw / buildPresetSTJson
│   │   ├── presets.js          # PROMPTS 数组（171 条，按 prompt_order 顺序）
│   │   │                       #   + PRESET_SETTINGS
│   │   ├── worldbook.js        # ENTRIES_RAW（8 条，含禁用项）
│   │   │                       #   + getAllEntries()（启用项，游戏引擎格式）
│   │   ├── regex.js            # ALL_RULES（23 条正则，含禁用项）
│   │   └── charCard.js         # 角色卡基础信息（name/firstMessage/...）
│   │
│   ├── engine/                 # 游戏引擎层
│   │   ├── gameLoop.js         # 游戏回合主循环（SSE 流式）
│   │   ├── promptBuilder.js    # LLM 消息数组组装（system/history/user/assistant）
│   │   ├── regexPipeline.js    # 正则规则应用管道
│   │   └── varEngine.js        # statData 变量操作 + UpdateVariable VM 执行
│   │
│   ├── features/               # 功能子系统
│   │   ├── shop/
│   │   │   ├── shopEngine.js   # 商城评估 + 兑换逻辑
│   │   │   ├── shopPrompt.js   # 三轮评估协议提示词
│   │   │   └── shopStore.js    # 商城物品持久化
│   │   ├── gacha/
│   │   │   └── gachaEngine.js  # 抽卡池定义 + 抽卡逻辑（保底100抽）
│   │   ├── world/
│   │   │   ├── worldAnchorPrompt.js  # 世界档案生成提示词
│   │   │   ├── worldArchiveStore.js  # 世界档案持久化
│   │   │   └── worldEngine.js        # 世界档案应用到会话（身份继承逻辑）
│   │   └── character/
│   │       ├── characterEngine.js    # 角色生成引擎
│   │       ├── characterPrompt.js    # 角色生成提示词
│   │       └── characterStore.js     # 角色档案持久化
│   │
│   └── routes/                 # HTTP 路由层（依赖注入模式）
│       ├── index.js            # registerAllRoutes() 统一注册
│       ├── gameRoutes.js       # 游戏消息 / 重新生成 / 使用锚点
│       ├── sessionRoutes.js    # 存档增删查 / 新建存档（世界身份选项）
│       ├── shopRoutes.js       # 商城评估 / 兑换 / 物品管理
│       ├── gachaRoutes.js      # 抽卡 API
│       ├── worldRoutes.js      # 世界书编辑 + 世界档案 CRUD + 锚点生成/兑换
│       ├── presetRoutes.js     # 预设编辑（GET/POST，读写 content-overrides.json）
│       ├── characterRoutes.js  # 角色生成 / 档案管理
│       ├── configRoutes.js     # 配置读写 API
│       └── logRoutes.js        # 日志查看 API
│
├── public/                     # 前端静态文件
│   ├── index.html / app.js / style.css          # 主游戏界面
│   ├── shop.html / shop.js / shop.css           # 商城界面
│   ├── character.html / character.js / ...      # 角色生成界面
│   ├── preset.html / preset.js / preset.css     # 预设管理界面（支持内容编辑/开关/排序/正则）
│   └── worldbook.html / worldbook.js / ...      # 世界书管理界面（支持内容编辑/开关/排序）
│
├── data/                       # 运行时数据
│   ├── sessions/               # 存档文件（UUID.json）
│   ├── logs/                   # 日志文件（YYYY-MM-DD.log）
│   ├── content-overrides.json  # 编辑器运行时覆盖（preset + worldbook.entries）
│   ├── characters.json
│   ├── shop-items.json
│   └── world-archives.json
│
└── tools/
    └── backfillWorldIdentity.js  # 一次性数据迁移工具
```

---

## 3. 核心层 src/core/

### `config.js`

**职责**：配置读写、LLM 配置构建、游戏资产加载（含 mtime 缓存 + 运行时覆盖支持）

**关键导出**：

| 函数/常量 | 说明 |
|---|---|
| `getConfig()` | 读取 config.json |
| `updateConfig(updates)` | 更新 config.json |
| `buildLLMConfig(userConfig)` | 构建主 LLM 配置 |
| `buildShopLLMConfig(userConfig)` | 构建商城 LLM 配置 |
| `loadGameAssets(userConfig)` | 加载 charCard + preset（含 mtime 缓存） |
| `invalidateAssetsCache()` | 强制使资产缓存失效 |
| `getUserPersona(userConfig)` | 用户人物设置 |
| `CONFIG_PATH` | config.json 路径 |
| `OVERRIDES_PATH` | data/content-overrides.json 路径 |

**资产加载优先级**：
```
content-overrides.json (编辑器保存)
    ↓ 优先
config.json charCardPath / presetPath (外部文件，已清空)
    ↓ 兜底
src/content/ 内置 JS 内容
```

**mtime 缓存机制**：
- `_assetsCache` 保存上次加载结果
- 每次调用检查 `content-overrides.json` 的 `mtimeMs`
- 仅在文件变化时重新加载
- `invalidateAssetsCache()` 由路由在保存时主动调用

### `configLoader.js`

**职责**：解析外部 SillyTavern JSON 格式（人物卡、预设）为内部数据结构

**关键函数**：

| 函数 | 说明 |
|---|---|
| `loadCharacterCard(path)` | 解析人物卡 JSON → charCard 对象 |
| `parseWorldBook(book)` | 解析 character_book → worldBook 数组（仅启用项） |
| `loadPreset(path)` | 解析预设 JSON → preset 对象 |
| `loadPresetFromData(raw)` | 从已解析对象解析 preset（用于覆盖文件） |

### `session.js`

**职责**：会话（存档）内存管理 + 磁盘持久化

- 内存 Map：`sessionId → session 对象`
- 磁盘：`data/sessions/UUID.json`
- 会话结构：`{ id, name, history[], statData, charProfile, createdAt, ... }`

### `sessionLock.js`

**职责**：防止同一会话并发修改（同一会话的请求串行化）

---

## 4. 内容层 src/content/

内容层将所有游戏内容（提示词、世界书、正则规则）内置于代码中，不再依赖外部 JSON 文件。

### 数据流

```
JS 文件（默认值）     编辑器 UI（运行时修改）
       │                      │
       ▼                      ▼
 getBuiltinPreset()    data/content-overrides.json
       │                      │
       └──────────────────────┘
              优先：overrides
              兜底：built-in
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
  loadGameAssets()     GET /api/preset/data
  (promptBuilder 使用)  (编辑器 UI 使用)
```

### `presets.js`

- `PROMPTS`：171 条提示词对象数组，顺序严格对应原 `prompt_order[0].order`
- `PRESET_SETTINGS`：`{ temperature, maxTokens, showThoughts, assistantPrefill, continuePostfix }`
- 提示词以 `nsfw` 为分界点：之前 → system message，之后（system role）→ last user message，`assistant` role → prefill

### `worldbook.js`

- `ENTRIES_RAW`：8 条原始格式条目（含 3 条禁用项），字段与 SillyTavern character_book.entries 兼容
- `getAllEntries()`：过滤启用项，转换为游戏引擎格式（camelCase 字段）

### `regex.js`

- `ALL_RULES`：23 条正则规则（含 9 条禁用项）
- `OUTPUT_RULES`：placement 包含 2（AI 输出）的规则子集
- `INPUT_RULES`：placement 包含 1（用户输入）的规则子集

### `index.js`（统一导出）

| 函数 | 说明 |
|---|---|
| `getBuiltinCharCard()` | 返回游戏引擎格式的 charCard |
| `getBuiltinPreset()` | 返回游戏引擎格式的 preset |
| `getBuiltinWorldbookRaw()` | 返回原始 ST JSON 格式世界书条目（含禁用项，供编辑器使用） |
| `buildPresetSTJson()` | 将内置 preset 转换为 ST JSON 格式（供编辑器 GET 返回） |

---

## 5. 引擎层 src/engine/

### `gameLoop.js`

**职责**：游戏回合主循环，协调 prompt 构建 → LLM 调用 → 正则处理 → 状态更新

**主要函数**：
- `runStreamTurn(session, userInput, opts, onChunk, onDone, onError)` — 流式回合
- 处理 `<UpdateVariable>` 标签（VM 执行 statData 更新）
- 处理 `<SystemGrant>` 标签（物品/能力发放）

### `promptBuilder.js`

**职责**：将 preset.prompts + charCard + statData + history 组装为 LLM messages 数组

**消息结构**：
```
messages[0]    system   buildSystemPrompt()  — preset prompts before 'nsfw' + worldbook pos:0/1
messages[1..N-2] user/assistant  — chat history
messages[N-2]  system   backendDataStream   — varEngine 渲染的状态快照（history ≥ 4 时注入）
messages[N-1]  user     buildUserSuffix()   — worldbook pos:4 depth:0 + UpdateVariable + nsfw + format prompts
messages[N]    assistant  prefill            — role:'assistant' prompts
```

**关键函数**：
- `buildSystemPrompt(preset, charCard, userPersona, vars)` — 系统消息
- `buildUserSuffix(preset, charCard, statData, userPersona, userInput)` — 最后用户消息
- `buildContextWindow(preset, charCard, statData, history, userPersona, userInput)` — 完整 messages 数组
- `promptForPhase(p, phase)` — 判断 preset prompt 是否在指定阶段生效（依据 `p._phases`，无该字段则全阶段生效）

**Preset Prompt `_phases` 字段**：
- 每条 preset.prompts 条目可携带 `_phases: number[]`（如 `[3]`、`[1,3]`）
- `buildPhase1Messages` 和 `buildPhase3Messages` 均通过 `promptForPhase` 过滤用户消息 parts 和 assistant prefill
- 未设置 `_phases` 的条目保持原有行为（Phase 1 和 Phase 3 均注入）
- 可在预设编辑器 UI 的"生效阶段"复选框中配置，保存后持久化到 preset JSON

### `varEngine.js`

**职责**：statData 树操作 + UpdateVariable VM 执行 + 后端数据流渲染

**主要函数**：
- `runUpdateVariable(code, statData)` — 在沙箱中执行 UpdateVariable 代码块
- `renderBackendDataStream(statData, history)` — 生成注入到消息的状态快照文本
- `syncWorldIdentity(statData, worldKey)` — 同步 CharacterSheet.WorldContext 到当前世界
- `buildStatSnapshot(statData)` — 构建前端显示用的状态快照

### `regexPipeline.js`

**职责**：按 placement 应用正则规则（用户输入 / AI 输出 / 显示渲染）

---

## 6. 功能层 src/features/

### 商城子系统 `features/shop/`

- `shopEngine.js`：三轮评估协议（LLM 调用），物品属性生成，兑换逻辑，积分扣除
- `shopPrompt.js`：完整 16★ 星级评估提示词（含 Anti-Feat 协议）
- `shopStore.js`：`data/shop-items.json` 读写

### 抽卡子系统 `features/gacha/`

- `gachaEngine.js`：抽卡池定义（6 档：low/mid/high/stellar/galactic/beyond）
  - 保底次数：全部为 **100 抽**（pityHard）
  - `drawFromPool(session, allItems, poolId, drawCount)` — 执行抽卡，返回物品数组

### 世界档案子系统 `features/world/`

- `worldAnchorPrompt.js`：世界档案生成提示词（三步 Anti-Feat 协议，整数 0-16★ 输出）
- `worldArchiveStore.js`：`data/world-archives.json` 读写，含 `detectTierRange()`
- `worldEngine.js`：`applyWorldArchiveToSession(session, archive, opts)` — 将世界档案写入 session
  - `opts.inheritIdentity`：是否继承世界身份（false 时 WorldIdentity=null，Location 使用通用描述）
  - 创建的 archiveEntry 包含完整 `TimeFlow`（`type:ratio, ratioToBase:'1:1'`）和 `Time.TotalSeconds=0`

### 世界时间轴同步系统

**数据字段**（均在 `statData.Multiverse` 下）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `BaselineSeconds` | float | 基准时间轴累计秒数，服务端维护 |
| `OriginWorldKey` | string | 主世界名称，首次 use-anchor 时自动设定 |
| `CurrentWorldElapsedSeconds` | int (临时) | Phase 4 LLM 写入的触发字段，服务端读后删除 |
| `Archive.Time.TotalSeconds` | float | 该世界累计秒数，服务端维护 |
| `Archive.Time.Clock` | `["HH:MM:SS","Time"]` | 由服务端从 TotalSeconds 计算，LLM 禁止写入 |
| `Archive.Time.JustEntered` | bool (临时) | use-anchor/return-home 写入，Phase 4 后删除 |
| `Archive.TimeFlow.ratioToBase` | string | `"BASE:WORLD"` 格式，如 `"1:3"` |

**数据流**：
1. Phase 4 LLM：估算当前世界流逝秒数（精确到秒），输出 `CurrentWorldElapsedSeconds`，可选更新叙事 `Time.Date`
2. `propagateWorldTime(statData)`（`varEngine.js`）：在 `processUpdateVariables` 之后调用；读取秒数→更新当前世界 TotalSeconds/Clock→计算 baseElapsed→传播到所有背景世界
3. 变量回退：所有时间字段在 `statData` 中，`statSnapshotBefore` 快照自动覆盖

**回归主世界**：`POST /api/shop/return-home`（`gameRoutes.js`），消耗 20,000 积分，切换 `CurrentWorldName = OriginWorldKey`，设置 `JustEntered=true`。商城页侧边栏显示固定卡片。

### 角色生成子系统 `features/character/`

- `characterEngine.js` / `characterPrompt.js` / `characterStore.js`

---

## 7. 路由层 src/routes/

所有路由使用**依赖注入模式**：`registerRoutes(app, deps)` ，deps 由 server.js 提供。

### `index.js`

```js
function registerAllRoutes(app, deps) {
  // 按顺序注册所有路由模块
}
```

### 主要路由

| 路由文件 | 路径前缀 | 主要端点 |
|---|---|---|
| `gameRoutes.js` | `/api/sessions/:id/` | `POST /message`（SSE）, `POST /regenerate`, `POST /use-anchor` |
| `sessionRoutes.js` | `/api/sessions` | GET（列表）, POST（新建，含 worldAnchorOptions + inheritIdentity）, DELETE |
| `shopRoutes.js` | `/api/shop/` | 评估、兑换、物品 CRUD |
| `gachaRoutes.js` | `/api/sessions/:id/gacha/` | `POST /draw` |
| `worldRoutes.js` | `/api/worldbook/`, `/api/worldanchor/` | 世界书编辑、档案 CRUD、生成（SSE）、兑换锚点 |
| `presetRoutes.js` | `/api/preset/` | `GET /data`（overrides优先/内置兜底）, `POST /data`（写 overrides） |
| `characterRoutes.js` | `/api/characters/` | 生成、CRUD |
| `configRoutes.js` | `/api/config` | 读写 config.json |
| `logRoutes.js` | `/api/logs/` | 日志查看 |

### 预设/世界书编辑器路由详解

**GET /api/preset/data**：
1. 若 `content-overrides.json` 存在且有 `preset` 字段 → 直接返回
2. 否则调 `buildPresetSTJson()` 从内置内容组装 ST JSON 返回

**POST /api/preset/data**：
1. 保存完整 ST JSON 到 `content-overrides.json` 的 `preset` 字段
2. 调 `invalidateAssetsCache()` 使资产缓存失效（下一条消息即刻重载）

**GET /api/worldbook/data**：
1. 若 overrides 有 `worldbook.entries` → 直接返回（含禁用项）
2. 否则返回 `getBuiltinWorldbookRaw()`（含禁用项）

**POST /api/worldbook/data**：
1. 保存 entries 到 `content-overrides.json` 的 `worldbook.entries`
2. 调 `invalidateAssetsCache()`

---

## 8. 前端文件 public/

| 文件 | 功能 |
|---|---|
| `index.html` / `app.js` | 主游戏界面（对话、状态栏、新建存档向导） |
| `hub.html` / `hub.js` / `hub.css` | 控制台入口（一体化接口配置 + 页面分工导航） |
| `shop.html` / `shop.js` / `shop.css` | 商城界面（评估、兑换、抽卡、世界锚点；**兑换项生成**页对 Companion/Mech/WorldTraverse 及**其余类型**（`buildAbilityCoreHtml`）展示与详情一致的结构化面板；`collectShopEffectRows` 含 `SubMoves` 与 `itemOperations`） |
| `character.html` / `character.js` | 角色生成界面（档案列表接入统一骨架/空状态，高风险删除走统一确认弹窗） |
| `preset.html` / `preset.js` | 预设编辑器（提示词开关/排序/内容编辑 + 正则规则管理；删除/离开/重载确认接入统一确认弹窗） |
| `ui-humanized.css` | 全站统一覆盖层（字体、按钮、状态栏、弹窗可读性） |
| `ui-feedback.js` / `ui-feedback.css` | 全站反馈层（统一 toast、危险操作确认弹窗、加载骨架/空状态） |

### UI 设计风格（人性化统一皮肤）

前端在保留深色基础上，新增 `ui-humanized.css` 作为统一覆盖层，核心目标是降低“终端感”，提升新手可读性与跨页面一致性：

| 维度 | 规范值 |
|---|---|
| 字体 | 统一使用中文友好的 UI 字体栈（`Microsoft YaHei UI`/`PingFang SC`/`Segoe UI`） |
| 状态栏 | `stat-float` 与主界面字体/间距同步，不再使用独立终端字体 |
| 弹窗 | 商城详情弹窗宽度提升至 `min(96vw, 1040px)`，避免信息展示不全 |
| 按钮 | 全站按钮圆角与交互反馈统一（更大点击面积） |
| 页面分工 | 配置与导航集中到 `/hub`，游戏页聚焦“对话与状态” |
| 反馈系统 | 统一 `UIFeedback`：已覆盖主页/设置/商城/角色/预设的 toast + 高风险 confirm + 骨架/空状态模板 |

### 设置页职责重组（`settings.html`）

- `接口与模型` 面板统一承载：主接口配置 + 商城接口覆盖（可选）
- 通过“继承主接口”的默认策略实现傻瓜化配置：只填主接口即可开局
- 多阶段、外观、其他信息保留独立面板，避免与接口配置混杂

### 世界身份继承 UI（app.js + shop.js）

- **新建存档选择世界时**：每个世界下方有切换按钮（"✓ 继承世界身份" / "✕ 不继承身份"）
- **商城兑换锚点后**：立即弹出身份选择弹窗（继承 / 外来者 / 稍后手动激活）
- **HUD 世界标签页使用锚点时**：`window.confirm` 确认是否继承身份

---

## 9. 数据文件 data/

| 文件 | 内容 | 读写方 |
|---|---|---|
| `sessions/*.json` | 会话存档（history + statData） | `session.js` |
| `content-overrides.json` | 编辑器保存的完整预设/世界书状态 | `presetRoutes.js`, `worldRoutes.js` |
| `characters.json` | 角色档案库 | `characterStore.js` |
| `shop-items.json` | 已生成的商城物品 | `shopStore.js` |
| `world-archives.json` | 已生成的世界档案 | `worldArchiveStore.js` |
| `logs/YYYY-MM-DD.log` | 分天日志 | `logger.js` |

### `content-overrides.json` 格式

```json
{
  "preset": {
    "prompts": [...],
    "prompt_order": [{ "character_id": 100001, "order": [...] }],
    "extensions": { "SPreset": { "RegexBinding": { "regexes": [...] } } },
    "temperature": 1.0,
    "max_new_tokens": 8192
  },
  "worldbook": {
    "entries": [...]
  }
}
```

---

## 10. 数据流全链路

### 游戏消息处理（POST /api/sessions/:id/message）

```
用户输入
    │
    ▼
regexPipeline.processForPrompt()   ← INPUT_RULES 应用
    │
    ▼
loadGameAssets(config)             ← mtime 缓存，overrides 优先
    │ { charCard, preset }
    ▼
promptBuilder.buildContextWindow()
    │ messages[]
    ├── messages[0]: system  ← preset prompts before nsfw + worldbook pos:0/1
    ├── messages[1..N-2]: history
    ├── messages[N-2]: system ← backendDataStream（statData 快照，history ≥ 4）
    ├── messages[N-1]: user  ← worldbook pos:4 depth:0 + UpdateVariable + nsfw + format
    └── messages[N]: assistant ← prefill
    │
    ▼
llmClient.createCompletion()       ← SSE 流式返回
    │ accumulated response
    ▼
regexPipeline.processAIOutput()    ← OUTPUT_RULES 应用
    │
    ▼
varEngine.runUpdateVariable()      ← <UpdateVariable> 执行，更新 statData
    │
    ▼
处理 <SystemGrant>                 ← 物品/能力发放到 Arsenal
    │
    ▼
session.saveSession()              ← 持久化
    │
    ▼
regexPipeline.processForDisplay()  ← 显示渲染（markdownOnly 规则）
    │
    ▼
SSE 返回前端
```

### 内容编辑热重载

```
编辑器 UI (preset.html / worldbook.html)
    │ POST /api/preset/data 或 POST /api/worldbook/data
    ▼
写入 data/content-overrides.json
    │ invalidateAssetsCache()
    ▼
下一条游戏消息调用 loadGameAssets()
    │ mtime 变化 → 重新读取 overrides
    ▼
新内容立即生效
```

---

## 11. 内容层数据流

```
src/content/presets.js     → PROMPTS[171]
src/content/worldbook.js   → ENTRIES_RAW[8]
src/content/regex.js       → ALL_RULES[23]
src/content/charCard.js    → CHAR_CARD
         │
         ▼
src/content/index.js
  getBuiltinPreset()        → { prompts[171], regexRules[23], ... }
  getBuiltinCharCard()      → { name, worldBook[5启用], ... }
  buildPresetSTJson()       → ST JSON 格式（供编辑器 GET）
  getBuiltinWorldbookRaw()  → 原始格式条目[8]（供编辑器 GET，含禁用项）
         │
    ┌────┴──────────────────────────────────┐
    │                                       │
    ▼                                       ▼
loadGameAssets()                 GET /api/preset/data
（游戏引擎使用）                    GET /api/worldbook/data
    │  先检查 content-overrides.json         │  先检查 content-overrides.json
    │  有 → loadPresetFromData(overrides)    │  有 → 直接返回 overrides 内容
    │  无 → getBuiltinPreset()               │  无 → buildPresetSTJson() / getBuiltinWorldbookRaw()
    ▼
promptBuilder.buildContextWindow()
```

---

## 12. 关键数据结构

### charCard（游戏引擎格式）

```js
{
  name: string,
  description: string,
  personality: string,
  scenario: string,
  systemPrompt: string,
  firstMessage: string,
  alternateGreetings: string[],
  worldBook: [{
    id, comment, keys[], content,
    enabled, constant,
    extPosition,  // 0=worldInfoBefore, 1=worldInfoAfter, 4=lastUserMsg
    depth,        // 0=最后消息注入, 4=深度4注入
    insertionOrder,
    role, probability, sticky,
    selective, selectiveLogic, secondaryKeys[]
  }],
  localRegex: [],
  worldName: string,
  depthPrompt: null
}
```

### preset（游戏引擎格式）

```js
{
  prompts: [{
    identifier: string,  // UUID 或固定名（'main', 'nsfw', ...）
    name: string,
    enabled: boolean,
    content: string,
    role: 'system' | 'assistant',
    isMainSystemPrompt: boolean,
    marker: boolean,     // true = 系统标记位（worldInfoBefore 等）
    injectionPosition, injectionDepth, injectionOrder,
    forbidOverrides: boolean
  }],
  regexRules: [...],     // 23 条正则规则
  temperature, maxTokens, showThoughts, assistantPrefill, continuePostfix,
  ...
}
```

### statData（会话状态树）

```js
{
  CharacterSheet: {
    UserPanel: {
      Name, Appearance: { Gender, Age, ... },
      Personality: { Alignment, Traits[] },
    },
    CoreSystem: { Tier: { NormalTier, StarMedals } },
    Resources: { Points, StarMedals: { '1': n, ... } },
    Loadout: {
      PassiveAbilities[], PowerSources[], ApplicationTechniques[],
      Inventory[], Knowledge[], Companions[], Mechs[]
    },
    ShopInventory[],
    WorldContext: { ... }  // 当前世界身份（inheritIdentity=false 时清空）
  },
  Multiverse: {
    ActiveWorldKey: string,
    Archives: {
      [worldKey]: {
        WorldName, Time, Location,
        SocialWeb, WorldRules[], PowerSystems[],
        WorldIdentity: null | { title, occupation, background, ... }
      }
    }
  },
  Arsenal: {
    WorldAnchors[],   // 已购买待激活的锚点
    GachaState: { [poolId]: { pityCount } },
    GachaPending[]    // 待确认的抽卡结果
  }
}
```

### session（存档对象）

```js
{
  id: string,           // UUID
  name: string,
  history: [{
    role: 'user' | 'assistant',
    content: string,    // 原始内容（含 UpdateVariable 等标签）
    promptContent: string, // 用于 prompt 的版本（剥离显示专用标签）
    displayContent: string // 用于显示的版本（经显示管道处理）
  }],
  statData: { ... },    // 见上方 statData 结构
  charProfile: { name, gender, age, ... },
  createdAt: ISO string,
  worldAnchorOptions: [{ id, inheritIdentity }]
}
```
