# AI-VN System · 无限武库

基于无限武库角色卡、泉此方预设、对话文本构建的独立 AI 驱动游戏/视觉小说系统。

## 快速开始

```bash
# 1. 安装依赖（仅首次）
npm install

# 2. 启动服务器
node server.js
# 或双击 start.bat

# 3. 打开浏览器访问
http://localhost:3000
```

## 首次配置

1. 打开 `http://localhost:3000`
2. 点击右上角 **⚙ 设置**
3. 填写：
   - **角色卡路径**：`D:\test2\无限武库demov1.3 (5).json`
   - **预设路径**：`D:\test2\Izumi Reload 0211.json`
   - **API 地址**：你的 OpenAI 兼容 API 地址
   - **API 密钥**：你的密钥
   - **模型**：`gpt-4o`（推荐）或其他兼容模型
4. 保存后点击 **测试连接** 验证 API
5. 点击 **＋ 新游戏**，选择起始剧情开始游戏

## 项目结构

```
game-system/
├── server.js          # Express 服务器（所有 API）
├── config.json        # 用户配置（API key 等）
├── src/
│   ├── varEngine.js   # 变量引擎（_.set / _.insert / _.remove / _.add）
│   ├── configLoader.js # 读取角色卡 / 预设 JSON
│   ├── promptBuilder.js # 组装系统提示词 / 对话上下文
│   ├── regexPipeline.js # 正则处理管道（展示 / 提示词）
│   ├── llmClient.js   # OpenAI 兼容 API（支持流式输出）
│   └── session.js     # 会话管理（内存 + 磁盘持久化）
├── public/
│   ├── index.html     # 游戏主界面
│   ├── app.js         # 前端逻辑
│   └── style.css      # 深色游戏主题
└── data/sessions/     # 自动保存的存档
```

## 核心机制

### 变量系统
AI 回复中的 `<UpdateVariable>` 块会被自动执行：
- `_.set('path', value)` — 设置值
- `_.insert('path', value)` — 向数组添加元素
- `_.insert('path', 'key', value)` — 向对象添加键值
- `_.remove('path')` — 删除路径
- `_.add('path', delta)` — 数值加法

### 提示词组装
每轮对话的消息数组：
1. **system** — 泉此方角色设定 + 无限武库世界法则
2. **user** — `[Start a new chat]`
3. **assistant** — 第一条消息（含变量初始化）
4. ...历史消息...
5. **system** — 后端数据流（角色状态，深度≥4时注入）
6. **user** — 当前输入 + `<status_current_variables>` 状态快照

### 正则管道
- **promptOnly**：在发送给 LLM 前应用（清理 UpdateVariable、think 标签等）
- **markdownOnly**：在展示给用户时应用（美化选项、弹幕等）

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取配置 |
| POST | `/api/config` | 保存配置 |
| POST | `/api/config/test` | 测试 API 连接 |
| GET | `/api/assets/greetings` | 获取开场白列表 |
| GET | `/api/sessions` | 列出所有存档 |
| POST | `/api/sessions` | 创建新会话 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| POST | `/api/sessions/:id/init` | 初始化会话（处理第一条消息） |
| POST | `/api/sessions/:id/message` | 发送消息（SSE 流式） |
| GET | `/api/sessions/:id/stat` | 获取当前角色状态 |

## 支持的 API 格式

任何 OpenAI Chat Completions 兼容接口均可使用：
- OpenAI (`https://api.openai.com`)
- Azure OpenAI
- Claude (via OpenAI proxy)
- Ollama (`http://localhost:11434`)
- LM Studio (`http://localhost:1234`)
- 国内中转 API（如 oneapi）
