---
name: game-system-dev
description: AI-VN无限武库游戏系统开发技能。用于添加新路由、修改游戏机制、更新内置世界书/预设/正则内容、调试游戏系统。当用户要求修改游戏规则、添加新功能模块、更新提示词内容、调整商城/扭蛋/角色/世界系统时使用。
---

# AI-VN 无限武库游戏系统开发

## 项目结构速查

```
server.js          入口（~150行，仅启动）
src/core/          基础设施（config, logger, session, llmClient, sessionLock）
src/content/       内置游戏内容（worldbook, presets, regex）
src/engine/        引擎（varEngine, regexPipeline, promptBuilder, gameLoop）
src/features/      功能模块（shop/, gacha/, character/, world/）
src/routes/        路由层（每个功能域一个文件）
public/            前端SPA
data/sessions/     会话持久化
data/logs/         日志
```

## 添加新路由

1. 在 `src/routes/` 创建新文件（如 `newFeatureRoutes.js`）
2. 导出 `registerRoutes(app, deps)` 函数
3. 在 `src/routes/index.js` 注册

```javascript
// src/routes/newFeatureRoutes.js
'use strict';
const log = require('../core/logger');

function registerRoutes(app, deps) {
  const { sessionMgr, getConfig } = deps;
  app.get('/api/new-feature', (req, res) => { ... });
}
module.exports = { registerRoutes };
```

## 修改内置世界书

编辑 `src/content/worldbook.js`，在对应数组中添加/修改条目：
- `WORLD_INFO_BEFORE` — 系统消息开头（游戏规则）
- `UPDATE_VARIABLE_ENTRY` — UpdateVariable指令（关键！）
- `DEPTH_ZERO_ENTRIES` — 每轮用户消息末尾注入的元规则

## 修改内置预设提示词

编辑 `src/content/presets.js`：
- `SYSTEM_PROMPTS` 数组 — nsfw标记前的系统提示词
- `USER_SUFFIX_PROMPTS` 数组 — nsfw标记后的格式指令
- `ASSISTANT_PREFILL` — 助手预填充内容

## 修改内置正则规则

编辑 `src/content/regex.js`：
- `OUTPUT_RULES` — AI输出变换规则（placement: [2]）
- `INPUT_RULES` — 用户输入变换规则（placement: [1]）

## 关键依赖关系

```
server.js → src/routes/index.js → 各路由文件
各路由文件 → src/engine/gameLoop.js（游戏回合）
gameLoop.js → src/engine/promptBuilder.js → src/content/index.js（内置内容）
gameLoop.js → src/engine/varEngine.js（状态变更）
```

## varEngine `_` API（UpdateVariable 沙盒）

LLM输出中的 `<UpdateVariable>` 块通过 `vm.runInNewContext` 执行，只暴露 `_` 对象：

```javascript
// 深度设置值
_.set('CharacterSheet.Resources.Points', 1000);

// 数值加减（自动创建缺失路径）
_.add('CharacterSheet.Resources.Points', 500);
_.add('CharacterSheet.Resources.Points', -200);

// 插入到数组（push）
_.insert('CharacterSheet.Loadout.PassiveAbilities', { name: '钢铁意志', ... });

// 插入对象属性（3参数形式）
_.insert('CharacterSheet.CoreSystem.Attributes', 'MagicPower', [8.0, '魔力']);

// 删除键或数组元素
_.remove('CharacterSheet.Loadout.Inventory[2]');  // 删除指定索引
_.remove('CharacterSheet.SomeKey');                // 删除键

// 路径支持点号和数组索引
_.set('Arsenal.WorldAnchors[0].consumed', true);
```

**注意**：路径前缀 `stat_data.` 会被自动剥离，两种写法等效：
```javascript
_.set('CharacterSheet.Tier', [6, 'Tier 6']);
_.set('stat_data.CharacterSheet.Tier', [6, 'Tier 6']);  // 同上
```

## 调试建议

- 日志文件：`data/logs/YYYY-MM-DD.log`
- 实时日志：浏览器访问 `http://localhost:3000/logs`
- API日志级别：CHAT（对话）、SHOP（商城）、SESS（会话）
- 会话存档：`data/sessions/<UUID>.json`（含完整 `statData` 快照）
