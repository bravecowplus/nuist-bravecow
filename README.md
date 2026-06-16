# 🛩️ 飞机对战游戏

基于 Python + HTML/CSS/JS 的双人回合制飞机对战游戏，支持**本地同屏对战**和 **WebSocket 联机对战**。

## 技术栈

| 层级 | 技术 | 文件 |
|------|------|------|
| 核心逻辑 | Python 3 | `core/game_logic.py` |
| 本地对战 | Python + HTTP | `local_game.py` |
| 联机对战 | Python + WebSocket | `server.py` |
| 前端页面 | HTML5 + CSS3 + JS | `static/index.html` `style.css` `main.js` |

## 项目结构

```
小组/
├── core/
│   └── game_logic.py      # 核心游戏逻辑（组员C）
├── static/
│   ├── index.html          # 前端页面（组员B）
│   ├── style.css           # 样式表（组员B）
│   └── main.js             # 交互逻辑（组员B）
├── local_game.py           # 本地对战服务（组员D）
├── server.py               # 联机对战服务（组员E）
├── docs/                   # 文档（组员A）
├── README.md               # 本文件（组员A）
└── 答辩材料/               # 答辩PPT等（组员A）
```

## 环境要求

- Python 3.8+
- 浏览器（Chrome / Edge / Firefox）

## 安装与运行

### 1. 安装依赖

```bash
pip install websockets
```

### 2. 本地双人对战

```bash
# 终端1：启动本地对战服务
python local_game.py

# 浏览器打开 static/index.html
# 选择「本地双人对战」，两名玩家轮流操作
```

### 3. 联机对战

```bash
# 终端2：启动联机服务
python server.py

# 玩家1：打开浏览器 → static/index.html → 联机对战 → 创建房间 → 记下房间号
# 玩家2：打开浏览器 → static/index.html → 联机对战 → 输入房间号 → 加入房间
```

## 游戏规则

- **棋盘**：10×10 格子
- **飞机**：每方3架，随机摆放（4种朝向），1513坐标规则
- **攻击**：轮流点击对方棋盘格子
  - ○ 未命中（灰）
  - ✕ 命中机身（红）
  - 💥 命中机头（深红，该飞机击毁）
- **胜负**：先击毁对方全部3个机头者获胜

## 成员分工

| 成员 | 角色 | 职责 |
|------|------|------|
| 组员A | 组长 | 项目规范、文档、整合、答辩 |
| 组员B | 前端 | HTML/CSS/JS 页面开发 |
| 组员C | 核心逻辑 | Python 游戏规则引擎 |
| 组员D | 本地对战 | Python 本地回合对战服务 |
| 组员E | 联机对战 | Python WebSocket 联网服务 |
