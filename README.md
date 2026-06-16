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
│   └── game_logic.py      # 核心游戏逻辑
├── static/
│   ├── index.html          # 前端页面
│   ├── style.css           # 样式表
│   └── main.js             # 交互逻辑
├── local_game.py           # 本地对战服务
├── server.py               # 联机对战服务
├── docs/                   # 文档
├── README.md               # 本文件
└── 答辩材料/               # 答辩PPT等
```

## 环境要求

- Python 3.8+  最好是10/11版本
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

