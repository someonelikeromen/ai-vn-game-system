## [v0.39] — 商城生成预览与同伴详情完整结构化展示（2026-04-06）

### 修改文件
- `public/shop.js`
- `public/shop.css`
- `ARCHITECTURE.md`

### 修改内容
- 兑换项生成页：`buildStructuredPreviewHtml` 在预览区嵌入与商城详情同源的结构化面板（`buildCompanionCoreHtml` / `buildMechCoreHtml` / `buildArchiveDetailSection`），同伴类不再仅显示文案字段与空的「获得内容」列表
- **非同伴类型**：抽取 `buildAbilityCoreHtml`，生成页对 PassiveAbility / PowerSource / ApplicationTechnique / Inventory / Knowledge 等与商城弹窗同源的「兑换结构」全幅展示（可省略与左侧字段重复的描述/三轮报告）；`collectShopEffectRows` 补充 `SubMoves` 子招式与 `itemOperations`
- 同伴详情与核心 HTML：抽取 `buildCompanionCoreHtml`，技巧区展开 `subTechniques` 数组与 `SubMoves` 对象子招式；补充扮演模型（PersonalityModel）、知识库 RootNodes、`DynamicStatus.CurrentForm`
- 机体详情：抽取 `buildMechCoreHtml`；核心部件可显示部位 Visuals；机体智能表补充人格字段；`SpecialSystems` 非数组时安全归一

### 修改原因
- 生成页未遍历 `effects.companions`，用户看不到兑换写入的完整结构；商店同伴详情未渲染 LLM 常用的 `SubMoves` 嵌套与扮演扩展字段
- 非同伴兑换项生成后仅见扁平「获得内容」列表，与商城详情双栏不一致

### 修改结果
- 生成后即可预览完整同伴/机体/世界坐标面板；**通用兑换项**与商城详情一致展示描述/属性增量/获得内容/三轮报告（生成页去重）；商店列表 `collectShopEffectRows` 覆盖 SubMoves 与物品操作

## [v0.38] — SystemRedeemItem 兜底验证：商城缺失物品后台补充评估（2026-03-20）

### 修改文件
- `src/engine/gameLoop.js`

### 修改内容
- Finalize 的 SystemRedeemItem 处理块：区分"命中"与"未命中"两种情况
  - 命中（在 shopStore 或 evaluatedItems 中找到）→ 直接 0 价格兑换（原有逻辑）
  - 未命中 → 收集到 `fallbackRedeemNames` 并触发后台 `processRedeemFallbackAsync`
- 新增 `processRedeemFallbackAsync(sessionId, missedNames, snapshot)`：对未命中的物品名做一次批量 LLM 评估（使用 `buildNarrativeItemBatchMessages`），评估结果入库后以 0 价格 `executeRedemption` 写入会话

### 修改原因
- Phase 4 可能输出 `<SystemRedeemItem>` 中包含 Phase 2 未评估到（如 Phase 2 评估失败或 Phase 4 生成了额外物品）的物品名
- 原代码遇此情况仅 warn + skip，导致物品丢失；需做一次兜底验证

### 修改结果
- 所有 `<SystemRedeemItem>` 标签都能被处理：有档案的直接兑换，无档案的后台补充评估后再兑换
- 兜底评估为异步（setImmediate），不阻塞当前回合响应

## [v0.37] — Phase 4 SystemRedeemItem 标签：叙事获得物品自动免费兑换（2026-03-20）

### 修改文件
- `src/engine/gameLoop.js`
- `src/engine/promptBuilder.js`

### 修改内容
- `gameLoop.js`：新增 `parseSystemRedeemItemTags(text)` 函数，解析 Phase 4 输出中的 `<SystemRedeemItem>物品名</SystemRedeemItem>` 标签
- `gameLoop.js` Finalize：UpdateVariable 执行后，解析 `phase4Response` 中的 SystemRedeemItem 标签，从 `evaluatedItems` 中按名称匹配，调用 `shopEngine.executeRedemption(freeItem, session, vars)`（price=0）完成完整兑换（Loadout、ShopInventory、属性加成、能量池等）
- `promptBuilder.js`：Phase 4 物品提示块改为 `<SystemRedeemItem>` 输出指引，明确"获得→输出标签、消耗/失去→_.remove、未发生→不输出"三种规则，不再要求 LLM 手动写 effects

### 修改原因
- 原方案要求 Phase 4 手动写入 effects 数据，容易漏写或格式错误
- `shopEngine.executeRedemption` 已有完整的多字段写入逻辑（EnergyPools、ShopInventory、Loadout 等），应复用

### 修改结果
- Phase 4 只需判断叙事中是否确实发生了物品获取，输出对应标签
- 系统自动调用商城兑换流程完成完整状态写入，与扭蛋/商城兑换等价

## [v0.36] — Phase 2 同步物品评估 + reqItemUpdate/reqCombatEnemies 完整处理（2026-03-20）

### 修改文件
- `src/features/shop/shopPrompt.js`
- `src/engine/gameLoop.js`
- `src/engine/promptBuilder.js`

### 修改内容
- `shopPrompt.js`：新增 `buildNarrativeItemBatchMessages(itemDescriptions, previousItems, sessionSnapshot)` —— 使用与扭蛋批量生成相同的系统提示词框架，将最多 10 件指定物品一次性批量评估（返回 JSON 数组），并附带差价/已有物品状态上下文
- `gameLoop.js`：Phase 2 中新增**同步** reqItemUpdate 评估步骤：调用 `buildNarrativeItemBatchMessages` + `parseGachaBatchResponse`，将物品以**正常（评估）价格**加入商店，结果存入 `evaluatedItems`
- `gameLoop.js`：Phase 2 中对 `reqCombatEnemies` 未在现有 NPC 档案命中的敌人，异步触发 `processNarrativeSpawnsAsync` 生成实体档案（上限 10 个）
- `promptBuilder.js`：`buildPhase3Messages` 的 `phaseContextParts` 新增 `evaluatedItems` 注入块（物品名/星级/type/描述摘要）
- `promptBuilder.js`：`buildPhase4Messages` 新增 `evaluatedItems` 参数，在系统提示中注入每件物品的完整 `effects` JSON，并附带「获得/消耗/升级」写入指南

### 修改原因
- 之前 `reqItemUpdate` 被完全忽略；`reqCombatEnemies` 搜不到时无生成
- 物品评估需在 Phase 3 之前完成，才能将信息注入叙事和变量更新上下文
- 正常定价入库（而非免费自动应用）符合游戏经济系统设计，玩家仍需主动兑换

### 修改结果
- Phase 2 完成后 `evaluatedItems` 即可用：P3 知道本回合预期哪些物品，P4 有精确的 effects 数据可直接写入 statData
- `reqCombatEnemies` 中未命中的敌人后台自动生成 NPC 档案，下次战斗即可命中
- 物品以正常价格入库，玩家在商店页面自行兑换

## [v0.35] — Preset 提示词原子支持 Phase 过滤 + 三条 CoT 原子（2026-03-19）

### 修改文件
- `public/preset.html`
- `public/preset.js`
- `src/engine/promptBuilder.js`
- `src/content/presets.js`

### 修改内容
- `preset.html`：prompt 编辑模态框新增"生效阶段"勾选区（Phase 1/2/3/4 复选框），留空表示全阶段生效
- `preset.js`：`openPromptModal` 读取 `p._phases` 并勾选对应复选框；保存时将选中值写回 `p._phases`（无选中则删除该字段）
- `promptBuilder.js`：新增 `promptForPhase(p, phase)` helper；`buildPhase1Messages` 和 `buildPhase3Messages` 的用户消息循环与 assistant prefill 过滤均加入 `_phases` 判断
- `presets.js`：追加三条默认禁用（`enabled: false`）、仅 Phase 3（`_phases: [3]`）的 CoT 原子：
  - `cot_combat`（战斗推演 CoT）：五步推演战斗态势、伤害、节奏
  - `cot_psychology`（人物心理模拟 CoT）：逐一剖析 NPC 情绪、动机、决策
  - `cot_environment`（环境物理反应 CoT）：分析场景物理要素、感官细节、环境限制

### 修改原因
- 原 Preset 提示词无法区分阶段，战斗/心理/环境 CoT 等叙事专属指令会误入 Phase 1 规划请求
- 需要按需开关特定 CoT 原子，不影响其他阶段

### 修改结果
- 在预设编辑器中可为任意提示词设置生效阶段，Phase 1 和 Phase 3 自动按 `_phases` 过滤
- 三条 CoT 原子随时可在预设管理界面单独启用，仅影响 Phase 3 叙事生成

---

## [v0.34] — 用户消息立即落盘，防止服务器重启导致对话丢失（2026-03-19）

### 修改文件
- `src/engine/gameLoop.js`

### 修改内容
- 单阶段与多阶段 turn 中，`addMessage(user)` 之后立即调用 `saveSession()`

### 修改原因
- 服务器在 turn 进行中被重启，导致该轮内容丢失；原先只在 Phase 4 结束后才写盘

### 修改结果
- 即使重启，用户消息至少不会丢失；前端可显示"上次回复未完成"

## [v0.33] — 修正 PHASE1 reqItemUpdate 判断标准：载具/首次使用也应填入（2026-03-19）

### 修改文件
- `src/content/worldbook.js`

### 修改内容
- ID 65 prompt 中 `reqItemUpdate` 字段描述扩展：将"获得/使用/失去"扩充为"获得/使用/消耗/失去/首次驾驶或激活"，并增加载具（Inventory/Loadout）示例
- 新增明确判断标准：**只要 outline 中规划了任何物品/载具/能力的变动（哪怕是"尝试登机"、"首次使用"、"暂时持有"），都应列入**，由 Phase 4 根据实际叙事结果决定是否写入变量

### 修改原因
- 模型规划"找到战术机并尝试登机"时，因 prompt 描述模糊，判断"只是尝试、还未获得"而留空 reqItemUpdate，导致 Phase 4 缺少更新提示，战术机未被写入角色装备

### 修改结果
- 凡是 outline 中涉及任何装备/载具变动（含尝试、临时持有），Phase 1 都会在 reqItemUpdate 中标注，Phase 4 再根据叙事结果决定实际变量更新内容

## [v0.32] — 支持为各推理阶段单独配置 API、模型（2026-03-19）

### 修改文件
- `src/core/config.js`
- `src/engine/gameLoop.js`
- `public/settings.html`
- `public/settings.js`

### 修改内容
- `config.js`：新增 `buildPhaseLLMConfig(base, opts)` helper，将 base LLM config 与 phase 级别的 model/baseUrl/apiKey/maxTokens 合并（空值继承 base）
- `gameLoop.js`：Phase 1 / Phase 3 / Phase 4 均改为使用 `buildPhaseLLMConfig` 构建独立 config；Phase 3 原先直接使用 `llmConfig`，现在也支持独立覆盖
- `settings.html`：多阶段推理面板重构，Phase 1、Phase 3、Phase 4 各自有独立的 BaseURL、API Key、模型、Max Tokens 输入框及"获取模型列表"下拉
- `settings.js`：load/save 新增 `phase1/3/4BaseUrl`、`phase1/3/4ApiKey`、`phase1/3/4MaxTokens` 字段；各阶段"获取列表"按钮自动 fallback 到主接口地址；通用 `data-toggle-pw` 密码显隐绑定

### 修改原因
- 不同阶段对模型能力要求差异大（规划阶段可用轻量模型节省成本，生成阶段需要高质量模型），且部分场景需要不同的 API 提供商

### 修改结果
- 可为 Phase 1/3/4 分别指定不同的 API 地址、密钥和模型，留空字段则继承主接口设置

## [v0.31] — 扩展 PHASE1 规划字段：outline/logQueryTerms 不限数量，reqItemUpdate 改为含子系统的数组（2026-03-19）

### 修改文件
- `src/content/worldbook.js`
- `src/engine/gameLoop.js`
- `src/engine/promptBuilder.js`

### 修改内容
- worldbook.js ID 65 prompt：`outline` 示例扩展至4拍并移除"3~5个"数量限制；`logQueryTerms` 移除"1~8个"上限；`reqItemUpdate` 从空字符串改为数组格式，并要求每项注明所属子系统（如 "瑞士军刀（Inventory）"）
- gameLoop.js：`reqItemUpdate` 解析从 `String()` 改为 `Array`，兼容旧字符串回退（包裹为单元素数组）；初始值从 `''` 改为 `[]`
- promptBuilder.js：更新 JSDoc 注释中的字段类型说明

### 修改原因
- 原 prompt 对节拍数和关键词数施加了硬性上限，导致模型在复杂回合只生成少量节拍/检索词
- `reqItemUpdate` 作为单字符串无法同时描述多件道具/能力及其所属子系统，信息量不足

### 修改结果
- 模型可按实际剧情需求输出任意数量的节拍和检索词
- `reqItemUpdate` 可携带完整的多道具/子系统信息，便于后续 Phase 3/4 上下文注入

## [v0.30] — 修复 PHASE1 JSON 解析被 think 块误导导致回合中止（2026-03-19）

### 修改文件
- `src/engine/gameLoop.js`

### 修改内容
- PHASE1 JSON 提取前，先用正则剥离 `<think>...</think>` 块内容
- 正则优先匹配 ` ```json ` 明确类型的代码块，其次匹配任意包裹 `{}` 的代码块，最后回退裸 `{}` 匹配

### 修改原因
- 模型（如 gemini）返回带 `<think>` 思考块的响应时，思考块内的文本（如"不使用\`\`\`yaml格式包裹）"）包含反引号序列，旧正则 ` ```(?:json)? ` 会命中该位置并提取 "yaml格式包裹)，..." 作为 JSON 内容，导致解析失败并 abort 整个回合

### 修改结果
- 即使模型输出带 `<think>` 块，PHASE1 也能正确定位并解析 JSON 输出

## [v0.29] — 全局字体变量覆盖：style.css 所有硬编码 px 替换为 CSS 变量（2026-03-18）

### 修改文件
- `public/style.css`

### 修改内容
- 将侧边栏（`.sidebar-header`、`.session-item-name`、`.session-item-meta`、`.session-delete-btn`）的硬编码字体尺寸替换为 `var(--font-ui)` / `var(--font-sm)`
- 将顶栏（`#topbar h1`、`.session-name-label`）替换为 CSS 变量
- 将聊天区域（`.msg-meta`、`.think-block summary`、`.think-content`、`.options-hint`、`.options-toggle`、`.msg-action-btn`、`.msg-inline-edit textarea`、`.msg-inline-edit-btns button`）替换为 CSS 变量
- 将欢迎屏幕（`#welcome-screen p`）、模态标题（`.modal h2`）替换为变量
- 将新游戏向导所有 `ng-*` 元素字体替换为 CSS 变量
- 将状态浮窗中 `.sf-sys-label`、`.sf-char-name`、`.stat-tab`、`.stat-tab-zh`、`.stat-float-btn` 及所有 HUD 子元素（dim / mood / trigger / rel / ctx）替换为 `var(--font-stat)`

### 修改原因
- 之前外观设置字体调节后主界面左侧及其他区域无变化，根本原因是 `style.css` 中大量元素使用了硬编码 `px` 值，不受 CSS 变量控制

### 修改结果
- 所有主界面区域（顶栏、侧边栏、对话区、状态面板）的字体大小现在均随外观设置中的字体滑块实时变化

## [v0.28] — 字体调节升级：滑块+数值输入+实时预览，范围扩展至 8–38px（2026-03-18）

### 修改文件
- `public/theme.js`
- `public/settings.html`
- `public/settings.js`
- `public/settings.css`

### 修改内容
- **`theme.js`**：字体存储从 enum 键（xs/sm/md/lg/xl）改为直接存储 px 数值（`uiFontPx`/`chatFontPx`/`statFontPx`），自动迁移旧版 enum 值；字体范围 8–38px
- **`settings.html`**：字体区块从按钮网格改为三行滑块+数值输入+实时预览的布局；每行右侧有重置按钮；HUD 区域预览使用等宽字体样式
- **`settings.js`**：重写字体控件逻辑，滑块与数字输入双向同步，输入时实时更新全局字体并刷新预览文字；重置按钮恢复默认值
- **`settings.css`**：添加 `.st-font-slider-block`、`.st-font-slider`、`.st-font-input`、`.st-font-preview`、`.st-font-reset-btn` 等新样式；自定义滑块外观（青蓝色发光拖把手）

### 修改原因
- 原有的 5 档按钮无法精细调节字体大小，且上限仅 18–19px，满足不了大字号需求

### 修改结果
- 三个字体区域均可通过滑块拖动或直接输入 8–38 的任意整数 px 值，旁边实时预览效果

## [v0.27] — 前端整体科幻风格增强、分区字体调节、状态栏拖动优化、商品详情页修复（2026-03-18）

### 修改文件
- `public/ui-humanized.css`
- `public/theme.js`
- `public/style.css`
- `public/settings.html`
- `public/settings.js`
- `public/settings.css`
- `public/panel.js`
- `public/index.html`
- `public/shop.html`
- `public/shop.css`

### 修改内容
- **科幻风格恢复**：重写 `ui-humanized.css`，移除破坏终端 HUD 风格的强制覆盖，恢复等宽字体、青蓝发光边框、扫描线渐变；为状态栏 Header 添加发光底边和深色渐变背景
- **分区字体调节**：`theme.js` 扩展为支持三个独立字体配置（`uiFontSize`、`chatFontSize`、`statFontSize`），通过内联 `<style>` 标签动态注入 `:root` CSS 变量；`settings.html` 将原单一字体选择器拆分为三个分区域选择器；`style.css` 的 HUD 字体改用 `--font-stat` 变量
- **状态栏拖动优化**：`panel.js` 改进拖动逻辑，新增触摸屏支持、视口边界夹持保护、拖动中关闭过渡动画；`index.html` 在状态栏 Header 添加 `⠿` 拖动把手图标，扩大可拖动区域
- **商品详情页位置修复**：`shop.html` 将 `#detailModal` 的 class 从 `.modal`（与 `style.css` 冲突）改为 `.shop-modal-overlay`；`shop.css` 重写对应的遮罩层和弹窗样式，增加入场动画和毛玻璃效果

### 修改原因
- `ui-humanized.css` 原先强制覆盖了 `style.css` 的科幻风格，与状态栏 HUD 风格不一致
- 用户需要针对不同区域（UI、聊天内容、状态栏）独立调整字体大小
- 状态栏拖动区域过窄，且缺乏清晰的拖动指示
- 商品详情弹窗因 `.modal` 类名被 `style.css` 的窄弹框样式覆盖，导致显示位置/尺寸异常

### 修改结果
- 整体界面恢复青蓝色终端科幻风格，与状态栏 HUD 视觉保持一致
- 可分别调节 UI、聊天正文、状态面板三个区域的字体大小
- 状态栏可通过 Header 全区域拖动，移动端同样支持触摸拖动
- 商品详情弹窗正确居中显示，尺寸扩展至 96vw / 1040px

## [v0.26] — 反馈系统全站收口：角色页/预设页接入统一提示与确认（2026-03-18）

### 修改文件
- `public/character.html`
- `public/character.js`
- `public/preset.html`
- `public/preset.js`
- `ARCHITECTURE.md`

### 修改内容
- 角色页与预设页接入 `ui-feedback.css` / `ui-feedback.js`，统一使用 `UIFeedback.toast`
- 角色页高风险操作（未答完继续生成、删除档案）改为统一危险确认弹窗
- 预设页所有删除/离开/重载确认从原生 `confirm` 迁移到统一危险确认弹窗
- 角色档案列表、预设初始加载阶段接入骨架反馈，角色档案空列表/失败态接入统一空状态模板

### 修改原因
- 之前统一反馈能力主要集中在主页/设置/商城，角色与预设页仍存在交互风格断层
- 原生确认框样式与文案能力有限，不利于“人性化傻瓜化”一致体验

### 修改结果
- 全前端关键页面的提示、确认、加载/空状态体验统一完成
- 高风险操作确认文案和样式一致，误操作防护更直观

---

## [v0.25] — 体验优化四件套：体检、统一提示、防误操作、加载骨架（2026-03-18）

### 修改文件
- `public/ui-feedback.js`
- `public/ui-feedback.css`
- `public/hub.html`
- `public/hub.css`
- `public/hub.js`
- `public/index.html`
- `public/app.js`
- `public/settings.html`
- `public/settings.js`
- `public/shop.html`
- `public/shop.js`
- `ARCHITECTURE.md`

### 修改内容
- 新增全站反馈层 `UIFeedback`：统一 toast、危险操作确认弹窗、骨架屏/空状态模板
- `hub` 新增“开局体检”卡片：检查主接口/商城继承策略/关键字段完整性，并支持一键连通性测试
- `app.js`、`settings.js`、`shop.js` 的提示消息统一切换到 `UIFeedback.toast`（保留旧逻辑兜底）
- 商城关键高风险操作改为统一确认弹窗（批量兑换、兑换确认、随机穿越、删除商品、删除档案、丢弃待领取）
- 增加加载/空状态优化：主页存档列表与商城列表接入骨架/空状态指引文案

### 修改原因
- 提示与确认逻辑分散在多个页面，体验不一致，且误操作防护不足
- 数据加载阶段反馈不明显，用户容易误判为“卡死”
- 新用户需要更直观的“配置是否可用”入口

### 修改结果
- 前端反馈交互从“页面自管”升级为“统一反馈层”
- 高风险操作具备一致的二次确认样式与文案
- 首屏即能完成配置体检与连通性验证，加载与空状态可理解性更强

---

## [v0.24] — 第二轮前端重组：设置页接口合并 + 商城详情双栏化（2026-03-18）

### 修改文件
- `public/settings.html`
- `public/settings.js`
- `public/settings.css`
- `public/shop.js`
- `public/shop.css`
- `ARCHITECTURE.md`

### 修改内容
- 将设置页原「AI 接口」与「商城接口」职责合并为一个统一入口「接口与模型」
- 商城接口改为“可选覆盖”区块，主接口测试与商城接口测试并列，形成一站式配置流程
- `shop-api` 哈希路由映射到统一接口面板，旧入口兼容
- 商城商品详情（能力类）改为双栏布局：左侧核心信息（描述/属性/对比），右侧获得内容与评估报告
- 增加详情布局响应式规则，小屏自动退化为单栏

### 修改原因
- 进一步降低新用户理解成本，避免“主接口和商城接口分散在不同面板”造成配置混乱
- 商城详情信息密度高，单列滚动阅读效率低

### 修改结果
- 设置页形成更明确的“先主接口、后按需覆盖”的傻瓜化操作路径
- 商城详情阅读路径更稳定，信息对照更清晰

---

## [v0.23] — 前端重组：新增控制台 + 全站人性化统一样式（2026-03-18）

### 修改文件
- `server.js`
- `public/index.html`
- `public/settings.html`
- `public/shop.html`
- `public/character.html`
- `public/preset.html`
- `public/hub.html`
- `public/hub.css`
- `public/hub.js`
- `public/ui-humanized.css`
- `ARCHITECTURE.md`

### 修改内容
- 新增 `/hub` 控制台页面：将主接口与商城接口集中到同一处进行配置，并提供前端页面职责分工导航入口
- 主页面、商城、主角、预设、设置页均接入控制台入口，页面职责改为“主页对话、控制台配置、功能页执行”
- 新增 `ui-humanized.css` 作为全站统一覆盖层：统一字体体系、按钮圆角、状态栏文字风格
- 优化商城详情弹窗宽度与内容可读性，缓解详情信息展示不全的问题

### 修改原因
- 现有页面入口与配置分散，不利于新用户快速理解“先配什么、再去哪”
- 状态栏与其他页面字体风格割裂，导致整体视觉不一致
- 商城详情在复杂条目下阅读体验差

### 修改结果
- 形成“控制台集中配置 + 各页面专注功能”的新前端分工结构
- 全站字体/按钮/状态栏风格更统一，更偏向人性化和傻瓜化使用
- 商城详情信息展示更完整，可读性提升

---

## [v0.22] — 设置页清理：移除冗余路径字段 + 扩展字体档位（2026-03-18）

### 修改文件
- `public/settings.html`
- `public/settings.js`
- `public/theme.js`
- `public/style.css`

### 修改内容
- 删除「其他」面板中「文件路径」分组（角色卡路径、预设路径输入框）
- 同步移除 `loadConfig` / `saveConfig` 中对应的字段读写逻辑
- 字体大小新增 `xs`（10px）档位，使范围覆盖标准(14px) ±4px（10px ~ 18px）
- `theme.js` `VALID_FONTSIZES` 数组加入 `'xs'`，`style.css` 补充 `.font-xs` 变量

### 修改原因
- 内容已完全内置（`src/content/`），角色卡/预设路径配置项对用户无实际意义，保留会造成困惑
- 用户需要在 14px 标准字体基础上有向下调整 4px（10px）的空间

### 修改结果
- 「其他」面板仅保留玩家信息配置，页面更简洁
- 字体档位：极小(10px)、小(12px)、标准(14px)、大(16px)、特大(18px)，覆盖标准 ±4px 全范围

---

## [v0.21] — 世界时间轴同步系统 + 回归主世界兑换（2026-03-17）

### 修改文件
- `src/features/world/worldEngine.js`
- `src/features/shop/shopEngine.js`
- `src/engine/varEngine.js`
- `src/engine/gameLoop.js`
- `src/engine/promptBuilder.js`
- `src/routes/gameRoutes.js`
- `src/routes/shopRoutes.js`
- `public/shop.html`
- `public/shop.js`
- `public/shop.css`

### 修改内容

**世界时间轴同步系统**

- **新增数据字段**：`Multiverse.BaselineSeconds`（基准时间轴累计秒数）、`Multiverse.OriginWorldKey`（主世界名称）、`Multiverse.CurrentWorldElapsedSeconds`（LLM写入的临时触发字段）、`Archive.Time.TotalSeconds`（各世界累计秒数）；`Time.Clock` 格式统一为 `"HH:MM:SS"` 由服务端生成
- **`worldEngine.js`**：archiveEntry 补全 `TimeFlow` 字段（`type:ratio, ratioToBase:'1:1'`）并初始化 `Time.TotalSeconds=0`、`Time.Clock='00:00:00'`
- **`shopEngine.js`**：WorldTraverse archiveEntry 同步追加 `Time.TotalSeconds=0`、`Time.Clock='00:00:00'`
- **`varEngine.js`**：新增 `parseFlowRate(timeFlow)`、`formatHHMMSS(seconds)`、`propagateWorldTime(statData)` 三个函数并导出；`propagateWorldTime` 在 Phase 4 后读取 `CurrentWorldElapsedSeconds`，更新当前世界时钟，计算基准流逝量，按 FlowRate 传播到所有背景世界，清除 `JustEntered` 标志
- **`gameLoop.js`**：导入 `propagateWorldTime`，在两处 `processUpdateVariables + runAutoCalc` 之间插入调用
- **`promptBuilder.js`**：新增 `buildTimeSyncBlock(statData)` 函数，在 `buildPhase4Messages` 系统消息末尾追加原子化时间同步任务块；区分普通回合模式和 `JustEntered` 刚进入世界模式，指示 LLM 估算当前世界流逝秒数（精确到秒）并更新叙事日期
- **`gameRoutes.js`**：`use-anchor` 路由补全 `Time.TotalSeconds` 初始化、设置 `JustEntered=true`、首次激活自动写入 `OriginWorldKey`；新增 `POST /api/shop/return-home` 路由（扣除 20000 积分，切换 CurrentWorldName 到 OriginWorldKey，设置 JustEntered）

**回归主世界兑换**

- **`shopEngine.js`**：`buildApplyScript` 新增 `WorldReturn` 类型分支，设置 `CurrentWorldName = OriginWorldKey`
- **`shopRoutes.js`**：typeMap 注册 `WorldReturn: '回归主世界'`
- **`shop.html` + `shop.js` + `shop.css`**：侧边栏底部新增"回归主世界"固定卡片，当 `currentWorld !== originWorld` 时显示；显示主世界名称、当前世界名称、积分余额；积分不足时禁用按钮

### 修改原因
- 多世界穿越时各世界时间独立流逝，但原系统缺乏统一时间轴，LLM 无法正确推算跨世界时间关系
- 玩家需要花费资源回归起始世界，作为游戏平衡机制

### 修改结果
- Phase 4 LLM 只需估算当前世界流逝秒数，服务端自动按 FlowRate 比例同步所有背景世界时钟（精确到秒）
- 变量回退时时间字段随 `statSnapshotBefore` 快照自动恢复
- 商城页新增回归主世界卡片，消耗 20,000 积分可返回 OriginWorldKey 世界

## [v0.20] — 全局 UI 终端风格统一，从紫色系切换为 cyan 终端 HUD 风格（2026-03-17）

### 修改文件
- `public/style.css`
- `public/shop.css`
- `public/character.css`
- `public/preset.css`
- `public/settings.css`

### 修改内容
- **CSS 变量**：将 `style.css` 的 `:root` 背景层（`--bg` ~ `--bg5`）从紫调深色改为更纯粹的近黑终端色（`#04040c` 系列）；边框从不透明紫色改为半透明 cyan（`rgba(0,180,255,…)`）；主色 `--accent` / `--accent2` / `--accent3` 从紫色改为 `#0090b8` / `#00d4ff` / `#00ff88` 终端三色；阴影改为 cyan 光晕
- **Topbar**：背景改为 `#020208`，底部渐变线改为 cyan→green；标题改用 `Courier New` 等宽字体、大写 + cyan 渐变
- **Sidebar**：背景 `#020208`，header 标签改用 monospace 大写 + cyan 低透明文字；激活项改为 cyan 渐变背景 + cyan 左边框
- **按钮系统**：`.btn` hover 改为 cyan；`.btn.primary` 渐变改为 `#0090b8→#006688`；发送键同步更新；所有输入框 focus 光晕改为 cyan
- **消息气泡**：AI 消息左边框改为 cyan；流式光标颜色改为 `#00d4ff`；Think 块 streaming 状态改为 cyan 边框
- **Modal / Form**：modal 背景 `#07070f`，边框改为 cyan glow，标题改用等宽字体；表单 focus 改为 cyan
- **Toast / Wizard / Phase**：Toast info 改为 cyan；Wizard 步骤激活色改为 cyan；Phase 进度条左边框改为 cyan；步骤字体改为 monospace
- **Theme Variants**：主题中 `theme-blue` / `theme-green` 的边框也更新为 `rgba()` 透明格式；`theme-oled` 边框同步改为 cyan 半透明；默认主题名从"幽暗·星域"更新为"终端·青蓝"
- **shop.css**：header 背景 `#020208` + cyan 渐变线；侧边栏 `#030309`；卡片边框改为 cyan 半透明；按钮、购物车、弹窗等全面 cyan 化；字段 label 改为 monospace
- **character.css**：`:root` 变量整体切换为 cyan 系；header、按钮、表单输入、Tags、能力卡片、Type/Traversal 选择器全部 cyan 化
- **preset.css**：两处 `:root` 变量块均更新为 cyan 系；topbar、按钮、toggle、modal、toast 全部 cyan 化
- **settings.css**：topbar 底部渐变线、返回按钮、标题、保存按钮、导航激活项、toggle、group-title、info-box、theme-card 选中状态全部 cyan 化

### 修改原因
- 全局 UI 与状态栏（stat-float）的终端 HUD 风格不一致；状态栏早已使用 cyan + monospace + 发光边框，主界面仍为旧的紫色系
- 用户要求以状态栏为基准对整体 UI 进行同风格统一改造

### 修改结果
- 整个系统界面统一为超深蓝黑背景 + 电子青蓝发光边框 + 绿色 accent + 等宽字体系统标签的终端 HUD 风格
- 各页面（主聊天、商城、角色、预设、设置）视觉语言一致
- 语义色（HP/危险/警告/成功）保留不变

## [v0.19] — 各阶段添加3次重试，失败/太短则中止后续阶段（2026-03-17）

### 修改文件
- `src/engine/gameLoop.js`
- `public/app.js`

### 修改内容
- 新增常量 `MAX_RETRIES = 3`、`MIN_P1_CHARS = 50`、`MIN_P3_CHARS = 100`
- **Phase 1**：替换单次 try/catch 为最多 4 次尝试的重试循环；每次尝试依次检查：LLM 调用异常、响应过短（< 50 chars）、无 JSON、JSON 解析失败；任一条件耗尽重试次数后中止整个回合（res.end() + return）
- **Phase 3**：替换单次调用为最多 4 次尝试的重试循环；每次重试前向前端发送 `phase { status: 'retry', attempt }` 事件，并检查响应长度（< 100 chars）；耗尽重试后中止回合
- **Phase 4**：`MAX_P4_RETRIES` 由硬编码 `2` 改为引用 `MAX_RETRIES`（即 3 次重试）
- **前端**：`readSSEStream` 中新增对 `phase 3 retry` 事件的处理：清空 `state.streamingText`、`bubble.innerHTML`、`hasNarrativeText`，并显示重试进度指示器

### 修改原因
- Phase 1/3 此前只有单次机会，LLM 偶发空响应或截断响应会导致后续阶段使用无效输入
- Phase 4 的重试上限偏低（2次），与 Phase 1/3 不一致

### 修改结果
- 每个 LLM 阶段最多尝试 4 次（1 初始 + 3 重试）
- 任一阶段彻底失败则立即中止，不进行后续阶段，避免浪费 LLM 调用
- 前端 Phase 3 重试时自动清空已流式输出的内容并显示"第N次重试"提示

## [v0.18] — 修复停止按钮后锁无法释放、Phase4重试阻塞问题（2026-03-17）

### 修改文件
- `src/core/llmClient.js`
- `src/engine/gameLoop.js`

### 修改内容
- `llmClient.js`：`handleStreamResponse` 添加 `res.on('close', resolve)` 处理器，防止 Promise 因 socket 被 `req.destroy()` 关闭后只触发 `'close'`（无 `'end'`/`'error'`）而永久悬挂
- `gameLoop.js`：`runMultiPhaseTurn` 的 Phase 4 重试循环顶部添加 `if (clientAborted) break;`，避免客户端已断开时继续重试 LLM 调用
- `gameLoop.js`：`runMultiPhaseTurn` 在 Phase 4 结束、进入 FINALIZE 前添加 `clientAborted` 提前退出，避免处理空响应并保存不完整消息
- `gameLoop.js`：`runSinglePhaseTurn` 在 LLM 调用完成、开始变量处理前添加 `clientAborted` 提前退出

### 修改原因
- 停止按钮按下后，前端关闭 SSE 连接，`req.on('close')` 触发 `req.destroy()` 销毁 LLM HTTP socket
- 但 Node.js HTTP 流在 socket 被 destroy 时往往只触发 `'close'` 而非 `'end'`，导致 `createCompletion` Promise 悬挂长达 29 秒（直到 LLM 服务端超时）
- 29 秒后以 0 chars 解析，Phase 4 completeness check 失败，触发重试，锁始终无法释放
- 后续 retrace/message 请求全部返回 409，用户无法开始新的交互

### 修改结果
- 停止后 `createCompletion` 毫秒级解析（socket close 立即触发 resolve）
- Phase 4 重试循环检测到 `clientAborted` 立即 break，不再发起无效 LLM 调用
- `runStreamTurn` 函数提前 return，会话锁立即释放
- 后续 retrace/message/regenerate 请求可以正常获得锁并执行

# [v0.17] - 淇鐐瑰嚮鍋滄鍚庣珛鍗冲彂閫佷粛鏄剧ず"姝ｅ湪澶勭悊涓?锛?026-03-17锛?
### 淇敼鏂囦欢
- `src/routes/gameRoutes.js`

### 淇敼鍐呭
- 鏂板 waitForLock(sessionId, ms=1500) 杈呭姪鍑芥暟锛氬湪浼氳瘽閿佽鍗犵敤鏃惰疆璇㈢瓑寰呮渶澶?1500ms锛堟瘡 150ms 妫€鏌ヤ竴娆★級锛岃嫢閿佸湪绛夊緟绐楀彛鍐呴噴鏀惧垯鑷姩缁х画锛屽惁鍒欐墠杩斿洖 409
- message銆乺egenerate銆乺etrace 涓変釜绔偣鐨?hasLock 鍗虫椂鎷掔粷閫昏緫鏀逛负璋冪敤 waitForLock

### 淇敼鍘熷洜
- 鐐瑰嚮鍋滄鎸夐挳鍚庡墠绔珛鍒绘仮澶嶅彲杈撳叆鐘舵€侊紝浣嗗悗绔渶瑕佸嚑涓簨浠跺惊鐜懆鏈熸墠鑳藉鐞嗚繛鎺ュ叧闂€侀攢姣?LLM 璇锋眰銆侀噴鏀句細璇濋攣
- 鐢ㄦ埛鍦ㄨ繖娈垫瀬鐭獥鍙ｆ湡鍐呭彂閫佹柊娑堟伅灏变細鎾炲埌鍗虫椂 409 鎷掔粷

### 淇敼缁撴灉
- 鐐瑰嚮鍋滄鍚庣珛鍗冲彂閫侊紝鏈嶅姟绔渶澶氱瓑寰?1.5 绉掞紙閫氬父 <200ms 灏变細閲婃斁锛夛紝绛夐攣閲婃斁鍚庣洿鎺ョ户缁鐞嗭紝鏃犻渶鐢ㄦ埛閲嶈瘯

---
# [v0.16] - 淇鍒囨崲鍟嗗簵椤甸潰鍚庝細璇濋攣鏈噴鏀惧鑷存帓闃燂紙2026-03-17锛?
### 淇敼鏂囦欢
- `src/engine/gameLoop.js`
- `public/app.js`

### 淇敼鍐呭
- gameLoop.js锛氫慨澶?req.on('close') 绔炴€佹潯浠讹紝close 浜嬩欢瑙﹀彂鏃?llmNodeReq 涓?null 瀵艰嚧 clientAborted 鏈璁剧疆锛屽悗鍙?LLM 璋冪敤缁х画杩愯鎸佹湁閿?- gameLoop.js锛氭墍鏈?onRequest 鍥炶皟鏂板 if (clientAborted) nReq.destroy()锛岀‘淇濆嵆渚?close 宸插湪璧嬪€煎墠瑙﹀彂锛屽悗缁?LLM 璇锋眰涔熻绔嬪嵆閿€姣?- app.js锛氱偣鍑诲晢搴楁寜閽墠鍏堣皟鐢?stopGeneration()锛屼富鍔ㄤ腑姝㈠鎴风 fetch

### 淇敼鍘熷洜
- 鍒囨崲鍒板晢搴楅〉闈㈠啀鍥炴潵鍚庡彂閫佹秷鎭彁绀?褰撳墠瀛樻。姝ｅ湪澶勭悊涓?锛?09 琚攣锛?- 澶氶樁娈垫祦绋嬪鑸寮€鏃?llmNodeReq 鍙兘涓?null锛屽鑷?clientAborted 鏈缃?
### 淇敼缁撴灉
- 鍒囨崲鍟嗗簵鍚庡悗绔珛鍗充腑姝?LLM 璋冪敤骞堕噴鏀句細璇濋攣
- 鍥炲埌鏁呬簨椤甸潰鍙珛鍗虫甯稿彂閫佹秷鎭?
---
# [v0.15] 鈥?Phase 4 鎴柇淇 + 缁啓閲嶈瘯锛?026-03-16锛?
### 淇敼鏂囦欢
- src/core/llmClient.js
- src/engine/gameLoop.js

### 淇敼鍐呭
- llmClient.js锛歮axTokens 涓?null/0/undefined 鏃朵笉鍚?API 鍙戦€?max_tokens 瀛楁锛堜笉闄愬埗杈撳嚭闀垮害锛夛紱鏂板 opts.onFinishReason 鍥炶皟锛屽彲鎹曡幏娴佸紡鍝嶅簲鐨?finish_reason
- gameLoop.js Phase 4锛氬幓鎺夌‖缂栫爜鐨?maxTokens: 2048 涓婇檺锛屾敼涓?null锛涙坊鍔犳渶澶?娆＄画鍐欓噸璇曗€斺€旇嫢 UpdateVariable 鏍囩鏈棴鍚堬紝灏嗛儴鍒嗗搷搴斾綔涓?assistant prefill锛岃拷鍔犺缁х画娑堟伅閲嶈皟 LLM

### 淇敼鍘熷洜
- 鏃ュ織涓?Phase 4锛圲pdateVariable锛変粎杈撳嚭 313 瀛楃渚挎埅鏂紝UpdateVariable 鍧楁湭闂悎
- 鍘熸湁 maxTokens: 2048 杩囧皬锛屼笖鏃犲畬鏁存€ф鏌?
### 淇敼缁撴灉
- Phase 4 涓嶅啀鍙?token 涓婇檺绾︽潫
- 鑻ヨ緭鍑轰笉瀹屾暣锛岃嚜鍔ㄧ画鍐欐渶澶?娆★紝纭繚鏍囩瀹屾暣鍖归厤

---

﻿# 鏃犻檺姝﹀簱 娓告垙绯荤粺 鈥?鐗堟湰鍙樻洿鏃ュ織

> 鏍煎紡锛氭瘡鏉¤褰曞寘鍚?**淇敼鏂囦欢**銆?*淇敼鍐呭**銆?*淇敼鍘熷洜**銆?*淇敼缁撴灉**

---

## [v0.1] 鈥?鍒濆鏋勫缓锛堢害 2026-02-22 鍓嶏級

### 鍒濆鍔熻兘鍩虹嚎
- Express 鏈嶅姟鍣?+ 瀛樻。绠＄悊锛坄session.js`锛?- 浜虹墿鍗?棰勮瑙ｆ瀽锛坄configLoader.js`锛?- 鎻愮ず璇嶇粍瑁咃紙`promptBuilder.js`锛?- LLM 娴佸紡璋冪敤锛坄llmClient.js`锛?- 姝ｅ垯澶勭悊绠￠亾锛坄regexPipeline.js`锛?- 鍙橀噺寮曟搸锛坄varEngine.js`锛?- 鍩虹鏃ュ織锛坄logger.js`锛?- 鍟嗗煄鐢熸垚/鍏戞崲锛坄shopEngine.js`, `shopPrompt.js`, `shopStore.js`锛?- 涓栫晫妗ｆ绠＄悊锛坄worldAnchorPrompt.js`, `worldArchiveStore.js`锛?- 涓绘父鎴忕晫闈€佸晢鍩庣晫闈€佽鑹茬敓鎴愮晫闈?
---

## [v0.2] 鈥?鎻愮ず璇嶆敞鍏ヤ綅缃慨澶嶏紙2026-02-23锛?
### 淇敼鏂囦欢
- `src/promptBuilder.js`
- `src/varEngine.js`

### 淇敼鍐呭
- 淇浜嗕笘鐣屼功鏉＄洰鐨勬敞鍏ヤ綅缃€昏緫锛歚extPosition === 0` 鐨勫父椹绘潯鐩敞鍏ョ郴缁熸秷鎭紝`extPosition === 4 + depth === 0` 鐨勬潯鐩敞鍏ユ渶鍚庝竴鏉＄敤鎴锋秷鎭紙UpdateVariable 鍧楋級
- 淇浜?`CharacterSheet` 绛夌姸鎬佹暟鎹簲鍦ㄥ彉閲忔洿鏂拌鍒欙紙UpdateVariable锛夐儴鍒嗗睍绀虹殑闂锛屼箣鍓嶆敞鍏ヤ綅缃敊璇鑷?AI 鏃犳硶姝ｇ‘鐪嬪埌鐘舵€佸揩鐓?
### 淇敼鍘熷洜
- 鐢ㄦ埛鍙嶆槧鎬濈淮閾俱€侀€夐」绛夊唴瀹规棤娉曟甯告覆鏌擄紱鍙橀噺鏇存柊浣嶇疆涓嶅锛屽唴瀹逛笉瀹屾暣

### 淇敼缁撴灉
- UpdateVariable 蹇収姝ｇ‘鍑虹幇鍦ㄦ渶鍚庝竴鏉＄敤鎴锋秷鎭腑
- AI 鑳芥纭鍙栧拰鏇存柊 statData

---

## [v0.3] 鈥?鎬濈淮閾炬覆鏌撲慨澶?+ 閫夐」闈㈡澘浼樺寲锛?026-02-23锛?
### 淇敼鏂囦欢
- `src/regexPipeline.js`
- `public/app.js`
- `public/index.html`
- `public/style.css`

### 淇敼鍐呭
- 淇鎬濈淮閾炬湭瀹屽叏鎶樺彔鐨勯棶棰橈細鍦?`fullDisplayPipeline` 涓鍔?`<think>` 鍓嶇紑鍓ョ锛岄槻姝㈤璁?Rule 0 灏嗗叾杞负瀛楅潰 "think" 鏂囨湰
- 寮曞叆 `renderMixed()` 鍑芥暟锛氫唬鐮佸洿鏍忥紙``` ` `` `锛夊唴鍐呭鐩存帴娉ㄥ叆涓哄師濮?HTML锛屽叾浣欒蛋 `renderPlainText`
- 鍓嶇閫夐」闈㈡澘鏀逛负鍦ㄨ緭鍏ユ爮涓婃柟鏄剧ず鍥涗釜妯帓鎸夐挳锛岀偣鍑诲悗濉厖鍒拌緭鍏ユ锛堢敤鎴峰彲鍦ㄩ€夐」鍩虹涓婁慨鏀癸級
- 淇浜嗛儴鍒嗕腑鏂囧瓧绗﹀湪 Node.js 缁堢涓嬬殑涔辩爜闂锛圔uffer.concat 瑙ｇ爜锛?
### 淇敼鍘熷洜
- 鎬濈淮閾句粛鏈夐儴鍒嗘湭琚姌鍙犲鐞嗭紱閫夐」鏈互浜や簰鎸夐挳褰㈠紡鍛堢幇

### 淇敼缁撴灉
- 鎬濈淮閾惧畬鏁存姌鍙犱负鍙睍寮€鐨?details 缁勪欢
- 閫夐」鏄剧ず涓烘í鎺掓寜閽紝鏀寔鐢ㄦ埛淇敼鍚庡彂閫?
---

## [v0.4] 鈥?鐘舵€佸揩鐓т笌閲嶅鐞嗗姛鑳斤紙2026-02-23锛?
### 淇敼鏂囦欢
- `server.js`
- `src/session.js`
- `public/app.js`

### 淇敼鍐呭
- 姣忔潯 AI 鍥炲娑堟伅鐜板湪闄勫甫 `statSnapshotBefore`锛氳褰曡娑堟伅鐢熸垚鍓嶇殑 statData 蹇収
- 鏂板 `POST /api/sessions/:id/messages/:idx/reprocess-vars`锛氫粠鎸囧畾娑堟伅鐨?`statSnapshotBefore` 閲嶆柊瑙ｆ瀽 UpdateVariable锛屽疄鐜板彉閲忛噸鏂板鐞?- 鏂板 `POST /api/sessions/:id/messages/:idx/reprocess-display`锛氶噸鏂拌窇鏄剧ず姝ｅ垯锛屽埛鏂?HTML
- 鍓嶇娣诲姞"閲嶆柊澶勭悊鍙橀噺"鍜?閲嶆柊澶勭悊姝ｅ垯"鎸夐挳

### 淇敼鍘熷洜
- 鐢ㄦ埛闇€瑕佸湪閲嶆柊鍙戦€佹秷鎭悗锛岃兘浠庝笂涓€娆＄殑鐘舵€侀噸鏂板鐞嗗彉閲忥紝鑰屼笉蹇呮墜鍔ㄤ慨姝?
### 淇敼缁撴灉
- 鍙€変腑浠绘剰鍘嗗彶 AI 娑堟伅閲嶆柊澶勭悊鍙橀噺锛岀姸鎬佹爲鍑嗙‘鍥炴粴骞舵洿鏂?
---

## [v0.5] 鈥?鍏」鏂扮壒鎬э紙2026-02-26锛屽ぇ鐗堟湰锛?
### 5.1 鏃ュ織瀹屾暣鎬т慨澶?
**淇敼鏂囦欢**锛歚src/logger.js`

**淇敼鍐呭**锛?- `chatReq()` 鍜?`chatResp()` 浠?`writeAsync`锛堝紓姝ワ紝鍙兘涓㈠け锛夋敼涓?`write`锛堝悓姝ワ紝淇濊瘉鍐欏叆锛?- `log.tail()` 鏂板 `Infinity` 鍙傛暟鏀寔锛屽彲鑾峰彇鍏ㄩ儴鏃ュ織琛岋紙鑰岄潪浠呮渶鍚?N 琛岋級

**淇敼鍘熷洜**锛歀LM 璇锋眰/鍝嶅簲鏃ュ織鏄帓鏌ラ棶棰樻渶閲嶈鐨勮褰曪紝鏈嶅姟宕╂簝鏃跺紓姝ュ啓鍏ュ彲鑳藉鑷翠涪澶?
**淇敼缁撴灉**锛欳HAT 绾у埆鏃ュ織纭繚鍦ㄤ换浣曟儏鍐典笅閮藉畬鏁磋惤鐩橈紱"鍏ㄩ儴鏃ュ織"鎸夐挳鍙煡鐪嬪叏閲忚褰?
---

### 5.2 鏂版父鎴忛鏉¤緭鍏?
**淇敼鏂囦欢**锛歚public/index.html`銆乣public/app.js`

**淇敼鍐呭**锛?- 鏂板缓娓告垙鍚戝绗笁姝ワ紙瀛樻。璁剧疆锛夋坊鍔?`<textarea id="ng-first-input">` 杈撳叆妗?- `confirmNewGame()` 璇诲彇璇ヨ緭鍏ユ鍐呭锛岀敤浣滅涓€鏉?`<input>` 娑堟伅锛堢暀绌哄垯浣跨敤 `[娓告垙寮€濮媇`锛?
**淇敼鍘熷洜**锛氱敤鎴峰笇鏈涘湪寤烘。鏃跺氨棰勮寮€鍦烘儏澧冿紝鑰岄潪鍙兘浣跨敤榛樿寮€鍦虹櫧

**淇敼缁撴灉**锛氬彲鍦ㄥ缓妗ｆ椂鑷畾涔夌涓€鏉＄帺瀹惰緭鍏ュ唴瀹?
---

### 5.3 澶氫笘鐣屼功鍔犺浇

**淇敼鏂囦欢**锛歚public/index.html`銆乣public/app.js`銆乣server.js`

**淇敼鍐呭**锛?- 鏂板缓娓告垙鍚戝绗簩姝ョ殑涓栫晫鍒楄〃鏀逛负澶氶€夛紙澶嶉€夋锛?- `ngState.selectedWorlds` 鏀逛负鏁扮粍 `[{id, name}]`
- `POST /api/sessions` 鎺ユ敹 `worldAnchorIds`锛堟暟缁勶紝鏇夸唬鏃х殑鍗曞€?`worldAnchorId`锛?- 鏈嶅姟绔亶鍘嗘暟缁勶紝瀵规瘡涓?ID 璋冪敤 `applyWorldArchiveToSession()`
- `session.statData.Multiverse.CurrentWorldName` 鏀逛负鏁扮粍鏍煎紡锛歚[[world1, world2], 'ActiveWorlds']`

**淇敼鍘熷洜**锛氭敮鎸佸悓鏃舵縺娲诲涓笘鐣岃儗鏅紙濡?鐏奖+鍜掓湳浜ゅ弶"绫诲満鏅級

**淇敼缁撴灉**锛氬缓妗ｆ椂鍙嬀閫夊涓笘鐣屾。妗堬紝鍧囪娉ㄥ叆 statData 鍜?CurrentWorldName

---

### 5.4 鐘舵€侀潰鏉跨編鍖?
**淇敼鏂囦欢**锛歚public/style.css`銆乣public/app.js`

**淇敼鍐呭**锛?- `.stat-float` 閲嶆柊璁捐鏍峰紡锛堟洿澶у搴︺€佹瘺鐜荤拑鏁堟灉銆佹笎鍙樿儗鏅級
- 鏂板 `.stat-hero-card`锛氶《閮ㄨ鑹蹭俊鎭崱鐗囷紙鍚嶇О/绉板彿/韬唤/鏍囩锛?- 鏂板 `.stat-world-banner`锛氬綋鍓嶄笘鐣屾í骞咃紙涓栫晫鍚?浣嶇疆/鏃堕棿锛?- `STAT_SECTIONS` 鏁扮粍澧炲姞 `cls` 灞炴€х敤浜庤壊褰╁尯鍒?- `renderStatFloat()` 閲嶆瀯锛氬厛娓叉煋 Hero 鍗＄墖鍜屼笘鐣屾í骞咃紝鍐嶆覆鏌撳悇鐘舵€佸尯鍧?
**淇敼鍘熷洜**锛氶粯璁ょ姸鎬侀潰鏉跨己涔忓眰娆℃劅鍜屽彲璇绘€?
**淇敼缁撴灉**锛氱姸鎬侀潰鏉挎湁鏄庢樉鐨勮瑙夊眰娆★紱Hero 鍗＄墖绐佸嚭瑙掕壊鏍稿績淇℃伅锛涗繚鎸佸彲鎵╁睍鎬?
---

### 5.5 鍟嗗煄璐墿杞?
**淇敼鏂囦欢**锛歚public/shop.html`銆乣public/shop.css`銆乣public/shop.js`

**淇敼鍐呭**锛?- `shop.html` 娣诲姞璐墿杞︽寜閽紙鍚暟閲忚鏍?`#cartBadge`锛夊拰璐墿杞﹂潰鏉?`#cartPanel`
- `state.cart = []`锛宍state.cartOpen` 绠＄悊璐墿杞︾姸鎬?- 闈炲凡鍏戞崲鐗╁搧鍗＄墖娣诲姞"馃洅"鍔犺喘鎸夐挳
- 鏂板鍑芥暟锛?  - `toggleCart(itemId)` 鈥?鍔犲叆/绉婚櫎璐墿杞︼紝鏇存柊瑙掓爣
  - `updateCartBadge()` 鈥?鍒锋柊瑙掓爣鏁伴噺
  - `renderCartPanel()` 鈥?娓叉煋璐墿杞︾墿鍝佸垪琛?+ 鎬讳环 + 浼氳瘽閫夋嫨
  - `checkoutCart()` 鈥?鎵归噺鍏戞崲鍏ㄩ儴璐墿杞︾墿鍝侊紝鍚堝苟 prefillText

**淇敼鍘熷洜**锛氱敤鎴峰笇鏈涗竴娆℃€ч€夊畾澶氫欢鐗╁搧缁熶竴鍏戞崲

**淇敼缁撴灉**锛氬晢鍩庢敮鎸佽喘鐗╄溅鎵归噺鍏戞崲锛屽厬鎹㈠悗鑷姩棰勫～鍏呮父鎴忚緭鍏ユ

---

### 5.6 涓栫晫閿氱偣浣滀负鐗╁搧鍏ュ簱

**淇敼鏂囦欢**锛歚server.js`銆乣src/shopEngine.js`

**淇敼鍐呭**锛?- `POST /api/worldanchor/pull`锛氫笘鐣岄敋鐐硅 pull 鍚庯紝涓嶅啀鐩存帴婵€娲伙紝鑰屾槸浣滀负鐗╁搧璁板綍鍒?`session.statData.CharacterSheet.ShopInventory`
- `shopEngine.executeRedemption()`锛氬厬鎹㈠畬鎴愬悗灏嗚褰曟帹鍏?`CharacterSheet.ShopInventory`
- 鏂板 `buildPrefillText(item)` 鍑芥暟锛氭牴鎹墿鍝佺被鍨嬬敓鎴愯嚜鐒惰瑷€棰勫～鍏呮枃鏈紙濡?銆愮郴缁熴€戣鍔ㄨ兘鍔涖€怷XX銆戯紙Y鏄燂級宸插厬鎹㈠苟瀹屾垚鍐呭寲"锛?- 杩斿洖鍊间腑鍖呭惈 `prefillText`

**淇敼鍘熷洜**锛氫笘鐣岄敋鐐瑰拰鑳藉姏鐗╁搧搴斿厛浣滀负"宸叉寔鏈夌墿鍝?瀛樺湪锛岃€岄潪绔嬪嵆鏇存敼娓告垙鐘舵€侊紱闇€瑕侀濉厖寮曞鐜╁鑷劧鍙欒堪鑾峰緱杩囩▼

**淇敼缁撴灉**锛氬厬鎹㈠悗鐗╁搧杩涘叆搴撳瓨锛涢濉厖鏂囨湰鑷姩鍑虹幇鍦ㄦ父鎴忚緭鍏ユ

---

### 5.7 杈撳叆妗嗛濉厖锛圠ocalStorage 妗ユ帴锛?
**淇敼鏂囦欢**锛歚public/shop.js`銆乣public/app.js`

**淇敼鍐呭**锛?- `doRedeem()`銆乣doPull()`銆乣checkoutCart()` 鎴愬姛鍚庡啓鍏?`localStorage.pendingShopPrefill`锛堝惈 sessionId銆乼ext銆乼imestamp锛?- `app.js` 鏂板 `applyPendingShopPrefill(sessionId)`锛氬姞杞藉瓨妗ｆ椂妫€鏌?localStorage锛岃嫢鏈?10 鍒嗛挓鍐呫€佸尮閰嶅綋鍓?session 鐨勯濉厖鍒欒嚜鍔ㄥ～鍏ヨ緭鍏ユ

**淇敼鍘熷洜**锛氬晢鍩庨〉鍜屾父鎴忎富椤垫槸涓嶅悓椤甸潰锛岄渶瑕佽法椤甸潰浼犻€掗濉厖淇℃伅

**淇敼缁撴灉**锛氫粠鍟嗗煄杩斿洖娓告垙椤甸潰鏃讹紝杈撳叆妗嗚嚜鍔ㄥ嚭鐜拌喘涔板唴瀹圭殑鑷劧璇█鎻忚堪

---

### 5.8 涓栫晫涔﹁鍒欒ˉ鍏咃紙鏃犻檺姝﹀簱demov1.3 (5).json锛?
**淇敼鏂囦欢**锛歚D:\test2\鏃犻檺姝﹀簱demov1.3 (5).json`锛堜笘鐣屼功 Meta-Rule 鏉＄洰锛?
**淇敼鍐呭**锛堥€氳繃 Node.js 鑴氭湰绋嬪簭鍖栦慨鏀癸級锛?- **瑙勫垯 5 鈥?鍏戞崲鐨勬棤鐥涘唴鍖栧師鍒?*锛氬厬鎹笉閫犳垚鐥涜嫤锛屾弿杩颁负鑷劧鍏峰鎴栬嚜琛屼慨鐐煎埌姝ゆ按骞?- **瑙勫垯 6 鈥?琚姩鎶€鑳界殑闈欓粯杩愯浆鍘熷垯**锛氳鍔ㄦ妧鑳戒竴鐩寸敓鏁堬紝绂佹鍑虹幇"姝ゅ埢鎮勭劧杩愯浆"绛変富鍔ㄦ縺娲绘弿鍐?- **瑙勫垯 7 鈥?鍏戞崲浜嬩欢鐨勫彊浜嬪鐞嗗師鍒?*锛氱敤鎴峰厬鎹㈣緭鍏ユ椂涓嶇敓鎴?UpdateVariable 鍧楋紝涓撴敞鍙欎簨

**淇敼鍘熷洜**锛氱敤鎴峰弽鏄?AI 瀵硅鍔ㄦ妧鑳界殑鎻忓啓鏂瑰紡涓嶆纭紝浼氬嚭鐜?绯荤粺婵€娲昏鍔?绫诲彊浜嬶紱鍏戞崲鏃朵笉搴旂敓鎴愬彉閲忔洿鏂拌鍙?
**淇敼缁撴灉**锛欰I 瀵硅鍔ㄦ妧鑳界殑鎻忓啓鏇磋嚜鐒讹紱鍏戞崲浜嬩欢涓嶄骇鐢熺郴缁熸劅鐨勫彉閲忓潡

---

## [v0.6] 鈥?鑳藉姏鍐呭寲 + 绌胯秺鏂瑰紡 + 瑙掕壊绫诲瀷宸紓鍖栵紙2026-02-26锛?
### 6.1 涓栫晫涔︼細鑳藉姏鍐呭寲鍘熷垯鍔犲己

**淇敼鏂囦欢**锛歚D:\test2\鏃犻檺姝﹀簱demov1.3 (5).json`锛堜笘鐣屼功 Meta-Rule 鏉＄洰 + 鏇存柊瑙勫垯鏉＄洰锛?
**淇敼鍐呭**锛?- **瑙勫垯 3锛堣兘鍔涘唴鍖栧師鍒欙級** 鎺緸寮哄寲锛氫粠"鍏呭垎铻嶅叆"鏀逛负"绯荤粺鍙槸鍙鍖栨帴鍙ｏ紝瑙掕壊鑳藉姏鑴辩绯荤粺渚濈劧瀛樺湪锛涚郴缁熶笉璧嬩簣鑳藉姏锛屽彧鏄収浜畠浠?
- **鏇存柊瑙勫垯鏉＄洰** 鏂板瑙勫垯 8锛?  - 鑳藉姏鐨勬湰璐細PassiveAbilities 姘歌繙鐢熸晥鏃犲紑鍏筹紝PowerSources/Techniques 鏄?鑷繁鐨勬妧鑹?鑰岄潪澶栨寕
  - 寰界珷瀹屾暣鎬э細StarMedals 鍙兘浠ユ暣鏋氭暣鏁板舰寮忓瓨鍦紝绂佹纰庣墖/鍗婃灇褰㈡€?- **瑙勫垯 8 鈥?寰界珷瀹屾暣鎬у師鍒?*锛圡eta-Rule锛夛細鏄庣‘绂佹鐢熸垚寰界珷纰庣墖/娈嬬己褰㈡€?- **瑙勫垯 9 鈥?鏈湡涓庣┛瓒婅€呭彊浜嬪尯鍒?*锛氭湰鍦熻鑹叉湁鑷劧鐩磋锛涚┛瓒婅€呮湁淇℃伅宸拰鏂囧寲閿欎綅鎰燂紝浣嗕笉鍙ｅご瀹ｆ壃

**淇敼鍘熷洜**锛氱敤鎴疯姹傚己璋冩妧鑳?鐭ヨ瘑/閬撳叿绛夐兘鏄鑹茶嚜韬浐鏈夌殑锛岀郴缁熷彧鏄樉绀哄伐鍏凤紱寰界珷涓嶅簲鍑虹幇纰庣墖

**淇敼缁撴灉**锛欰I 鎻忓啓鎶€鑳戒娇鐢ㄦ洿鑷劧锛屼笉渚濊禆"绯荤粺"鍙欒堪锛涘窘绔犺瘎浼颁笉鍐嶅嚭鐜扮鐗囧舰寮?
---

### 6.2 鎬濈淮閾撅紙CoT锛夛細澧炲姞鐘舵€佹劅鐭ユ楠?
**淇敼鏂囦欢**锛歚D:\test2\Izumi Reload 0211.json`锛坄鍙洖鎬濈淮閾綻 prompt锛宨d: `ffa1f75e-9cfd-4c99-892a-ffe0b27f5945`锛?
**淇敼鍐呭**锛?- 鍦ㄧ幇鏈夋€濈淮閾炬湯灏炬敞鍏?**"鏃犻檺姝﹀簱涓撻」妫€鏌?** 姝ラ锛?  - 鏌ラ槄 `CharacterSheet.UserPanel.Personality`锛岀‘璁ゆ湰杞涓烘槸鍚︾鍚堣鑹叉€ф牸
  - 妫€鏌?`PassiveAbilities`锛堜竴鐩寸敓鏁堬紝鏃犻渶婵€娲绘弿鍐欙級
  - 纭 `PowerSources/ApplicationTechniques` 浣跨敤鎰熻鍍?鑷繁鐨勬妧鑹?
  - 鑻ヨ緭鍏ュ惈"璐拱浜?鍏戞崲浜?锛岃烦杩?UpdateVariable锛屼笓娉ㄥ彊浜?  - 鏌ラ槄 `Origin.Type`锛屽尯鍒嗘湰鍦?绌胯秺鑰呭彊浜嬫柟寮?
**淇敼鍘熷洜**锛氭€濈淮閾鹃渶瑕佸鎺ョ姸鎬?JSON 鐨勬€ф牸绛夐┍鍔紝浣?AI 琛屼负鏇磋创鍚堣鑹茶瀹?
**淇敼缁撴灉**锛欰I 姣忔鐢熸垚鍓嶄細涓诲姩妫€鏌ヨ鑹茬姸鎬佹爲锛岃涓轰笌鎬ф牸/鎶€鑳?鏉ユ簮绫诲瀷鏇翠竴鑷?
---

### 6.3 瑙掕壊绫诲瀷宸紓鍖栨彁绀鸿瘝锛堟湰鍦?vs 绌胯秺鑰咃級

**淇敼鏂囦欢**锛歚src/characterPrompt.js`銆乣server.js`

**淇敼鍐呭**锛?- 鏂板 `TRAVERSAL_PRESETS` 甯搁噺锛氬畾涔?6 绉嶇┛瓒婃柟寮忥紙寮備笘鐣岃浆鐢?閲嶇敓/澶鸿垗/鍙敜/绯荤粺绌胯秺/鑷畾涔夛級鐨勮缁嗘弿杩?- 鏂板 `buildCharTypeBlock(charType, traversalMethod, traversalDesc)` 鍑芥暟锛?  - 鏈湡锛氱畝鐭鏄庯紙鍘熶綇姘戯紝鏃犺法涓栫晫瑙嗚锛?  - 绌胯秺鑰咃細鍖呭惈绌胯秺鏂瑰紡鎻忚堪 + 鐭ヨ瘑搴撹鍒?+ 蹇冪悊鐗瑰緛锛堟枃鍖栭敊浣嶆劅锛? 闈㈡澘瑙勫垯
- `buildQuestionMessages` 鏍规嵁绌胯秺鑰呯被鍨嬮澶栫敓鎴愯法鏂囧寲閫傚簲棰樼洰
- `buildFromAnswersMessages` / `buildFromBackgroundMessages` 鎺ユ敹 `{charType, traversalMethod, traversalDesc}` 骞堕檮鍔犲樊寮傚寲鍧?- `server.js`锛歚POST /api/character/questions` 鍜?`POST /api/character/generate` 浼犲叆 `charType/traversalMethod/traversalDesc`

**淇敼鍘熷洜**锛氭湰鍦熻鑹插拰绌胯秺鑰呰鑹茬殑鐢熸垚閫昏緫瀹屽叏涓嶅悓锛堢煡璇嗗簱銆佸績鐞嗗垱浼ゃ€佺郴缁熸劅鐭ユ潵婧愶級

**淇敼缁撴灉**锛氱┛瓒婅€呰鑹茶嚜鍔ㄦ嫢鏈?鐜颁唬鍦扮悆鐭ヨ瘑"鑺傜偣鍜屾枃鍖栭敊浣嶅績鐞嗘弿鍐欙紱鏈湡瑙掕壊涓嶅彈褰卞搷

---

### 6.4 瑙掕壊鍒涘缓椤甸潰锛氱┛瓒婃柟寮忛€夋嫨 UI

**淇敼鏂囦欢**锛歚public/character.html`銆乣public/character.js`銆乣public/character.css`

**淇敼鍐呭**锛?- `character.html`锛氶棶鍗?鑳屾櫙妯″紡鍚勫鍔?`#quizTraversalBlock / #bgTraversalBlock`锛屽惈 6 涓?`.traversal-btn` 鍜岃嚜瀹氫箟鏂囨湰妗?- 閫夋嫨"绌胯秺鑰?鏃舵墠鏄剧ず绌胯秺鏂瑰紡闈㈡澘锛坄display:none` 鈫?`display:flex`锛?- 閫夋嫨"鑷畾涔?绌胯秺鏂瑰紡鏃舵樉绀烘枃鏈
- `character.js`锛?  - `state` 鏂板 `traversalMethod: 'isekai'`銆乣traversalDesc: ''`
  - 鏂板 `setupTraversalButtons()` 缁戝畾鎸夐挳閫昏緫
  - `setupCharTypeButtons()` 鑱斿姩鏄剧ず/闅愯棌绌胯秺闈㈡澘
  - 鐢熸垚璇锋眰甯﹀叆 `traversalMethod/traversalDesc` 鍙傛暟
- `character.css`锛氭柊澧?`.traversal-block`銆乣.traversal-presets`銆乣.traversal-btn` 鏍峰紡

**淇敼鍘熷洜**锛氶渶瑕佸湪 UI 灞傛彁渚涚┛瓒婃柟寮忛€夋嫨鍏ュ彛锛屽苟灏嗛€夋嫨浼犻€掔粰 AI

**淇敼缁撴灉**锛氳鑹茬敓鎴愰〉鏀寔 5 绉嶉璁剧┛瓒婃柟寮?+ 1 绉嶈嚜瀹氫箟杈撳叆锛涢€夋嫨缁撴灉褰卞搷 AI 鐨勫垱浣滄柟鍚?
---

### 6.5 鏂板缓娓告垙鍚戝锛氱┛瓒婃柟寮忛€夋嫨 UI

**淇敼鏂囦欢**锛歚public/index.html`銆乣public/app.js`銆乣public/style.css`

**淇敼鍐呭**锛?- `index.html` Step 1 鍦?绌胯秺鑰?绫诲瀷鎸夐挳涓嬫柟娣诲姞绌胯秺鏂瑰紡閫夋嫨闈㈡澘锛坄#ng-traversal-block`锛?- `app.js`锛?  - `ngState` 鏂板 `traversalMethod: 'isekai'`銆乣traversalDesc: ''`
  - 鏂板 `NG_TRAVERSAL_HINTS` 瀵硅薄
  - `openNewGame()` 閲嶇疆绌胯秺鐩稿叧鐘舵€?  - 绫诲瀷鎸夐挳鐐瑰嚮浜嬩欢鑱斿姩鏄剧ず/闅愯棌绌胯秺闈㈡澘
  - 鏂板绌胯秺鏂瑰紡鎸夐挳缁勪簨浠剁粦瀹?  - `ngUpdateSummary()` 鍦ㄦ憳瑕佷腑鏄剧ず绌胯秺鏂瑰紡锛堝"绌胯秺鑰吢烽噸鐢?锛?  - `confirmNewGame()` 浼犲叆 `traversalMethod/traversalDesc`
- `server.js`锛歚POST /api/sessions` 鎺ユ敹骞跺瓨鍌?`traversalMethod/traversalDesc`
- `style.css` 鏂板 `.traversal-btn` 鏍峰紡

**淇敼鍘熷洜**锛氭柊寤烘父鎴忔椂閫夋嫨绌胯秺鏂瑰紡锛屼娇瀛樻。浠庝竴寮€濮嬪氨璁板綍瑙掕壊鐨勬潵婧愯儗鏅?
**淇敼缁撴灉**锛氬瓨妗ｇ殑 `session.traversalMethod` 鏈夋晥璁板綍锛涜鑹插崱 `UserPanel.Origin` 鍐欏叆绌胯秺绫诲瀷

---

### 6.6 session.statData 鍐欏叆 Origin 瀛楁

**淇敼鏂囦欢**锛歚server.js`锛坄applyCharacterToSession` 鍑芥暟锛?
**淇敼鍐呭**锛?- 鍦?`applyCharacterToSession()` 涓紝鏍规嵁 `session.characterType` 鍐欏叆 `CharacterSheet.UserPanel.Origin`锛?  ```js
  up.Origin.Type = ['鏈湡'|'绌胯秺鑰?, '瑙掕壊鏉ユ簮绫诲瀷'];
  up.Origin.TraversalMethod = [鏂规硶涓枃鍚? '绌胯秺鏂瑰紡'];  // 绌胯秺鑰呬笓鐢?  up.Origin.TraversalDesc = [鑷畾涔夋弿杩? '绌胯秺璇︽儏'];   // 鑷畾涔夌┛瓒婁笓鐢?  ```

**淇敼鍘熷洜**锛歄rigin 淇℃伅闇€瑕佸啓鍏?statData 鎵嶈兘琚?CoT 鐨勬棤闄愭搴撲笓椤规鏌ユ楠よ鍙?
**淇敼缁撴灉**锛欰I 鐨勬€濈淮閾惧彲浠ユ纭鍙?`Origin.Type` 鍖哄垎鏈湡/绌胯秺鑰呭彊浜嬫柟寮?
---

## [v0.7] 鈥?涓栫晫閿氱偣鎻愮ず璇嶅鏍囧晢鍩庢槦绾х郴缁燂紙2026-02-26锛?
### 淇敼鏂囦欢
- `src/worldAnchorPrompt.js`
- `server.js`
- `src/worldArchiveStore.js`锛堣緭鍑哄瓧娈垫柊澧烇級

### 淇敼鍐呭

**`worldAnchorPrompt.js`** 瀹屾暣閲嶅啓锛?- 鏂板 `STAR_TIER_TABLE` 甯搁噺锛氬畬鏁?16鈽?鏄熺骇琛紙涓?`shopPrompt.js` 瀹屽叏涓€鑷达級锛屽寘鍚睘鎬у€艰寖鍥淬€佽兘閲忚緭鍑哄弬鑰冦€佺牬鍧忓姏鍙傜収
- 鏃х殑 6 妗ｆ枃瀛楁爣绛撅紙`low/mid/high/stellar/galactic/beyond`锛夋浛鎹负鏁存暟杈撳嚭瀛楁 `worldTier: 0-16`
- 鏂板 `midTier` 瀛楁锛氭櫘閫氶《灏栦粠涓氳€呯殑浠ｈ〃鏄熺骇锛堢敤浜庡畾浠峰熀鍑嗭級
- 鍥涙瀹℃牳鍗忚閲嶆瀯涓轰笁姝?Anti-Feat 鍗忚锛?  - **绗竴姝?*锛氬疄璇佷富涔?+ 鎵掔洅瀛愶紙鍚堝苟锛夆€?鍏堢‘璁ゅ師浣滄槸鍚︾湡瀹炲彂鐢燂紝鍐嶈繕鍘熶负鐗╃悊閲忕骇
  - **绗簩姝?*锛?*閫愬睘鎬у弽鍚戠害鏉?*锛堝鏍囧晢鍩?1A+1B+1C锛夆€?10 椤瑰睘鎬у弻鍚戠害鏉熻〃 + 鎻愮函瑙勫垯 + 鍔熻兘缁村害闄嶇骇琛?  - **绗笁姝?*锛氬弽鍚戝鏌?+ 鎻忚堪鍘婚瓍锛堝悎骞讹級鈥?姣忔潯娉曞垯蹇呴』鏈変笂闄愪緷鎹?- `powerSystems` 姣忎釜浣撶郴鏂板蹇呭～瀛楁 `antiFeatAnchor`锛堝師浣滃疄璇佺殑涓婇檺渚濇嵁锛?- `typicalTierRange/peakTierRange` 鏀逛负浣跨敤 "1-2鈽? 绛変笌鍟嗗煄瀵规爣鐨勬暟鍊艰〃杈?
**`server.js`** 鏇存柊锛?- 涓栫晫妗ｆ鐢熸垚璺敱涓細浼樺厛浠?`worldData.worldTier`锛堟柊鏁存暟瀛楁锛夋帹瀵?`tierRange`锛屽吋瀹规棫鐨勬枃瀛楁爣绛?- 瀛樺偍鏃堕澶栦繚瀛?`worldTier` 鍜?`midTier`
- 妗ｆ鍒楄〃鎺ュ彛杩斿洖 `worldTier` 鍜?`midTier` 瀛楁
- `updateArchive` 鐧藉悕鍗曞鍔?`worldTier/midTier`

**`worldArchiveStore.js`**锛堥棿鎺ワ級锛?- `detectTierRange(maxTier)` 鍑芥暟宸插瓨鍦紝琚?server.js 鐢ㄤ簬浠庢暣鏁版帹瀵兼枃瀛楁爣绛撅紙鍚戝悗鍏煎锛?
### 淇敼鍘熷洜
- 鏃х殑涓栫晫妗ｆ鏄熺骇锛坄low/mid/high` 绛夋枃瀛楁爣绛撅級涓庡晢鍩?16鈽?浣撶郴鏃犳硶瀵瑰簲锛屽鑷村晢鍩庡畾浠风己涔忓弬鑰冧緷鎹?- Anti-Feat 鍙嶅悜绾︽潫鏄晢鍩庤瘎浼扮殑鏍稿績锛屼笘鐣屾。妗堢敓鎴愪篃搴斾娇鐢ㄥ悓鏍风殑涓ユ牸鏂规硶

### 淇敼缁撴灉
- 涓栫晫妗ｆ鏄熺骇杈撳嚭鏁存暟锛?-16鈽咃級锛屼笌鍟嗗煄鍏戞崲绯荤粺瀹屽叏瀵规爣
- 姣忎釜鍔涢噺浣撶郴鏈夊彲楠岃瘉鐨勪笂闄愪緷鎹紙`antiFeatAnchor`锛?- 鏈嶅姟鍣ㄥ悜鍚庡吋瀹规棫鐨勬枃瀛楁爣绛炬牸寮?
---

## [v0.8] 鈥?绋嬪簭鏂囨。鐢熸垚锛?026-02-26锛?
### 鏂板鏂囦欢
- `ARCHITECTURE.md`锛氬畬鏁寸▼搴忔灦鏋勮鏄庯紙鎵€鏈夋枃浠躲€佸嚱鏁般€佽緭鍏ヨ緭鍑恒€佹暟鎹粨鏋勩€佹暟鎹祦閾捐矾锛?- `CHANGELOG.md`锛氭湰鐗堟湰鍙樻洿鏃ュ織锛坴0.1 鑷冲綋鍓嶏級

### 淇敼鍘熷洜
- 鐢ㄦ埛闇€瑕佸畬鏁寸殑鏂囨。鏀寔锛屼究浜庡悗缁紑鍙戝拰鐞嗚В绯荤粺缁撴瀯

---

## 寰呭姙 / 宸茬煡闂

| 鐘舵€?| 鎻忚堪 |
|------|------|
| 鉁?宸蹭慨澶?| 鎬濈淮閾炬湭瀹屽叏鎶樺彔 |
| 鉁?宸蹭慨澶?| UpdateVariable 浣嶇疆閿欒 |
| 鉁?宸蹭慨澶?| 鏃ュ織鍏抽敭鍐呭鍙兘涓㈠け |
| 鉁?宸插疄鐜?| 澶氫笘鐣屼功骞跺彂鍔犺浇 |
| 鉁?宸插疄鐜?| 璐墿杞︽壒閲忓厬鎹?|
| 鉁?宸插疄鐜?| 绌胯秺鏂瑰紡閫夋嫨 |
| 馃搵 寰呭疄鐜?| 涓栫晫妗ｆ缂栬緫椤甸潰锛堢洰鍓嶅彧鑳介€氳繃 API PATCH 淇敼锛?|
| 馃搵 寰呭疄鐜?| 瀛樻。鍒嗙粍/鏍囩绠＄悊 |
| 馃搵 寰呭疄鐜?| 鎵归噺瀵煎叆涓栫晫妗ｆ |

---

## [v0.9] 鈥?鍚庣鏋舵瀯妯″潡鍖栭噸鏋勶紙2026-03 鍓嶏級

### 淇敼鏂囦欢
- `server.js`锛堢簿绠€涓哄叆鍙?+ 渚濊禆娉ㄥ叆锛?- 鏂板 `src/core/`锛坈onfig.js, configLoader.js, session.js, llmClient.js, logger.js, sessionLock.js锛?- 鏂板 `src/engine/`锛坓ameLoop.js, promptBuilder.js, regexPipeline.js, varEngine.js锛?- 鏂板 `src/routes/`锛堟瘡涓姛鑳藉煙鐙珛璺敱鏂囦欢锛?- 鏂板 `src/features/shop/`, `src/features/world/`, `src/features/character/`, `src/features/gacha/`
- 鏂板 `src/content/`锛堝唴缃唴瀹瑰崰浣嶏級

### 淇敼鍐呭
- 灏嗗師 `server.js` 涓墍鏈夐€昏緫鎷嗗垎鍒板悇瀛愭ā鍧?- 鎵€鏈夎矾鐢辨ā鍧楃粺涓€浣跨敤渚濊禆娉ㄥ叆妯″紡 `registerRoutes(app, deps)`
- 浼氳瘽骞跺彂閿佺嫭绔嬩负 `sessionLock.js`

### 淇敼鍘熷洜
- 鍘?server.js 杩囦簬搴炲ぇ锛岄毦浠ョ淮鎶ゅ拰瀹氫綅闂

### 淇敼缁撴灉
- 妯″潡鑱岃矗娓呮櫚锛屼究浜庣嫭绔嬩慨鏀?
---

## [v0.10] 鈥?鎶藉崱绯荤粺锛?026-03 鍓嶏級

### 淇敼鏂囦欢
- 鏂板 `src/features/gacha/gachaEngine.js`
- 鏂板 `src/routes/gachaRoutes.js`

### 淇敼鍐呭
- 瀹炵幇 6 妗ｆ娊鍗℃睜锛坙ow/mid/high/stellar/galactic/beyond锛夛紝pityHard 淇濆簳鍏ㄩ儴璁句负 **100 鎶?*
- `POST /api/sessions/:id/gacha/draw` 绔偣
- 淇鍙傛暟椤哄簭鍜岃繑鍥炲€肩被鍨?bug

### 淇敼鍘熷洜
- 娓告垙闇€瑕佹娊鍗¤幏鍙栫墿鍝佹満鍒?
### 淇敼缁撴灉
- 鎶藉崱姝ｅ父鎵ц锛岀粨鏋滃瓨鍏?Arsenal.GachaPending

---

## [v0.11] 鈥?涓栫晫韬唤缁ф壙閫夐」锛?026-03-13锛?
### 淇敼鏂囦欢
- `src/routes/sessionRoutes.js`
- `src/routes/gameRoutes.js`锛坲se-anchor 绔偣锛?- `src/features/world/worldEngine.js`
- `public/app.js`锛堟柊寤哄瓨妗ｅ悜瀵?+ HUD 閿氱偣鍗★級
- `public/shop.js`锛堝厬鎹㈤敋鐐瑰悗韬唤閫夋嫨寮圭獥锛?
### 淇敼鍐呭
- 鏂板缓瀛樻。鏃讹細姣忎釜涓栫晫涓嬫柟鏄剧ず缁ф壙/涓嶇户鎵垮垏鎹㈡寜閽紝閫氳繃 `worldAnchorOptions[{id, inheritIdentity}]` 浼犻€?- 婵€娲婚敋鐐规椂锛歚POST /api/sessions/:id/use-anchor` 鎺ュ彈 `inheritIdentity` 鍙傛暟
- 鍟嗗煄鍏戞崲閿氱偣鍚庯細绔嬪嵆寮瑰嚭韬唤閫夋嫨寮圭獥锛堢户鎵?/ 澶栨潵鑰?/ 绋嶅悗婵€娲伙級
- `inheritIdentity=false` 鏃讹細WorldIdentity=null锛孡ocation 浣跨敤閫氱敤鎻忚堪锛屾竻闄?CharacterSheet.WorldContext

### 淇敼鍘熷洜
- 鐢ㄦ埛甯屾湜浠ュ鏉ヨ€呰韩浠借繘鍏ヤ笘鐣岋紝涓嶅姞杞藉師鏈変笘鐣岃韩浠?
### 淇敼缁撴灉
- 绌胯秺鏃跺彲閫夋嫨鏄惁缁ф壙涓栫晫韬唤锛岄€夋嫨绔嬪嵆鐢熸晥

---

## [v0.12] 鈥?鎻愮ず璇嶄慨姝ｏ紙2026-03-13锛?
### 淇敼鏂囦欢
- `src/engine/varEngine.js`
- `src/content/worldbook.js`锛堣縼绉诲悗锛?
### 淇敼鍐呭
- Backend Data Stream 鍔犲叆 WORLD RULES ENFORCEMENT 鎸囦护锛氫笘鐣屾硶鍒欓€氳繃鎰熺煡/鏈兘/瑙傚療鍛堢幇锛屼笉鐩存帴鍛藉悕
- 鍑绘潃鎯╃綒鎻忚堪锛氫粠"绯荤粺鏀堕泦鏁版嵁"鏀逛负"鍚岀被鐩爣绉垎杈归檯鏀剁泭浼氳繀閫熶笅闄?

### 淇敼鍘熷洜
- 涓栫晫娉曞垯鍚嶇О鐩存帴鍑虹幇鍦ㄦ鏂囦腑锛涘嚮鏉€鎯╃綒鎺緸涓嶅噯纭?
### 淇敼缁撴灉
- 娉曞垯鏁堟灉鑷劧鍛堢幇锛涚Н鍒嗚“鍑忔弿杩版纭?
---

## [v0.13] 鈥?鍐呭灞傚唴缃?+ 杩愯鏃剁紪杈戝櫒鏀寔锛?026-03-14锛?
### 淇敼鏂囦欢
- `src/content/presets.js`锛?71 鏉℃彁绀鸿瘝锛屽畬鍏ㄦ浛鎹㈠崰浣嶅唴瀹癸級
- `src/content/worldbook.js`锛? 鏉″惈绂佺敤椤癸紝鍚?ENTRIES_RAW + getAllEntries()锛?- `src/content/regex.js`锛?3 鏉″惈绂佺敤椤癸級
- `src/content/charCard.js`锛堝疄闄呰鑹插崱鍐呭锛?- `src/content/index.js`锛堟柊澧?buildPresetSTJson(), getBuiltinWorldbookRaw()锛?- `src/core/config.js`锛坢time 缂撳瓨 + overrides 鏀寔锛屾柊澧?invalidateAssetsCache()锛?- `src/core/configLoader.js`锛堟柊澧?loadPresetFromData()锛?- `src/routes/presetRoutes.js`锛堝畬鍏ㄩ噸鍐欙級
- `src/routes/worldRoutes.js`锛圙ET/POST 閲嶅啓锛?- `server.js`锛坮outeDeps 鎵╁睍锛?- `config.json`锛堟竻绌?charCardPath, presetPath锛?
### 淇敼鍐呭
- 杩佺Щ楠岃瘉锛?71 鏉℃彁绀鸿瘝椤哄簭銆乪nabled銆佸唴瀹逛笌澶栫疆 JSON 瀹屽叏涓€鑷?- `data/content-overrides.json` 浣滀负杩愯鏃惰鐩栧瓨鍌紙preset + worldbook.entries锛?- 缂栬緫鍣?GET/POST 鏀逛负璇诲啓 overrides锛屽厹搴曞埌鍐呯疆 JS 鍐呭
- `loadGameAssets()` 鍔?mtime 缂撳瓨 + overrides 浼樺厛閫昏緫

### 淇敼鍘熷洜
- 涓嶄緷璧栧缃?SillyTavern JSON 鏂囦欢
- 寮€鍙戞椂鏂逛究鍦?src/content/ 涓洿鎺ュ畾浣嶄慨鏀规彁绀鸿瘝
- 杩愯鏃剁紪杈戝櫒淇敼鍚庣珛鍗崇敓鏁堬紝鏃犻渶閲嶅惎

### 淇敼缁撴灉
- 鏈嶅姟鍣ㄥ畬鍏ㄤ娇鐢ㄥ唴缃唴瀹癸紝config.json 璺緞宸叉竻绌?- 缂栬緫鍣ㄥ姛鑳戒笌涔嬪墠瀹屽叏涓€鑷达紙鍐呭缂栬緫/寮€鍏?鎺掑簭/姝ｅ垯鐑噸杞斤級

---

## [v0.14] 鈥?Cursor 瑙勫垯 + 鏂囨。鏇存柊瑙勮寖锛?026-03-14锛?
### 鏂板鏂囦欢
- `.cursor/rules/update-docs.mdc`锛氭瘡娆′唬鐮佷慨鏀瑰悗蹇呴』鍚屾鏇存柊 ARCHITECTURE.md 鍜?CHANGELOG.md

### 淇敼鏂囦欢
- `ARCHITECTURE.md`锛氬畬鍏ㄩ噸鍐欙紝鍙嶆槧褰撳墠妯″潡鍖栨灦鏋勩€佸唴瀹瑰眰鏁版嵁娴併€佹墍鏈夊叧閿嚱鏁板拰鏁版嵁缁撴瀯
- `CHANGELOG.md`锛氳ˉ鍏?v0.9鈥攙0.14 鍙樻洿璁板綍

### 淇敼鍘熷洜
- 鏂囨。鑷?v0.8锛?026-02-26锛変弗閲嶈劚鑺傦紝涓庡綋鍓嶄唬鐮佷笉绗?
### 淇敼缁撴灉
- 鏂囨。鍑嗙‘鍙嶆槧褰撳墠绯荤粺鏋舵瀯鍜屽姛鑳?
---
## [v0.15] 鈥?Phase 4 鎴柇淇 + 缁啓閲嶈瘯锛?026-03-16锛?
### 淇敼鏂囦欢
- \src/core/llmClient.js- \src/engine/gameLoop.js
### 淇敼鍐呭
- \llmClient.js\锛歮axTokens 涓?null/0/undefined 鏃朵笉鍚?API 鍙戦€?max_tokens 瀛楁锛堜笉闄愬埗杈撳嚭闀垮害锛夛紱鏂板 opts.onFinishReason 鍥炶皟锛屽彲鎹曡幏娴佸紡鍝嶅簲鐨?finish_reason
- \gameLoop.js\ Phase 4锛氬幓鎺夌‖缂栫爜鐨?maxTokens: 2048 涓婇檺锛屾敼涓?null锛涙坊鍔犳渶澶?娆＄画鍐欓噸璇曗€斺€旇嫢 UpdateVariable 鏍囩鏈棴鍚堬紝灏嗛儴鍒嗗搷搴斾綔涓?assistant prefill锛岃拷鍔犺缁х画娑堟伅閲嶈皟 LLM

### 淇敼鍘熷洜
- 鏃ュ織涓?Phase 4锛圲pdateVariable锛変粎杈撳嚭 313 瀛楃渚挎埅鏂紝UpdateVariable 鍧楁湭闂悎
- 鍘熸湁 maxTokens: 2048 杩囧皬锛屼笖鏃犲畬鏁存€ф鏌?
### 淇敼缁撴灉
- Phase 4 涓嶅啀鍙?token 涓婇檺绾︽潫
- 鑻ヨ緭鍑轰笉瀹屾暣锛岃嚜鍔ㄧ画鍐欐渶澶?娆★紝纭繚鏍囩瀹屾暣鍖归厤

---


## 寰呭姙 / 宸茬煡闂

| 鐘舵€?| 鎻忚堪 |
|------|------|
| 鉁?宸蹭慨澶?| 鎬濈淮閾炬湭瀹屽叏鎶樺彔 |
| 鉁?宸蹭慨澶?| UpdateVariable 浣嶇疆閿欒 |
| 鉁?宸蹭慨澶?| 鏃ュ織鍏抽敭鍐呭鍙兘涓㈠け |
| 鉁?宸插疄鐜?| 澶氫笘鐣屼功骞跺彂鍔犺浇 |
| 鉁?宸插疄鐜?| 璐墿杞︽壒閲忓厬鎹?|
| 鉁?宸插疄鐜?| 绌胯秺鏂瑰紡閫夋嫨 |
| 鉁?宸插疄鐜?| 涓栫晫韬唤缁ф壙閫夐」 |
| 鉁?宸插疄鐜?| 鍐呭灞傚唴缃紙涓嶄緷璧栧缃枃浠讹級 |
| 鉁?宸插疄鐜?| 杩愯鏃剁紪杈戝櫒鏀寔锛坧reset/worldbook/regex 鐑噸杞斤級 |
| 馃搵 寰呭疄鐜?| 瀛樻。鍒嗙粍/鏍囩绠＄悊 |
| 馃搵 寰呭疄鐜?| 鎵归噺瀵煎叆涓栫晫妗ｆ |

