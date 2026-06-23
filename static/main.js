/**
 * main.js — 飞机对战游戏（四棋盘布局）
 * 每个玩家独立拥有「我方部署」+「攻击敌方」两个棋盘
 * 回合自动切换，棋盘实时刷新
 *
 * 【两大玩法模式】
 *   local  — 本地双人对战：两人共用一台电脑，通过 HTTP 调用本地 Flask 服务
 *   online — 联机对战：两人各自用浏览器，通过 WebSocket 连接中心服务器
 *
 * 【调用链概览】
 *   页面加载 → createAllBoards() + bindButtons() + setMode("local")
 *   点击攻击格 → onEnemyClick() → sendAttackLocal/Online() → 服务端返回 →
 *     handleLocalResult() 或 handleServerMessage() → 刷新棋盘 → updateTurnUI()
 */

// ==================== 常量与工具函数 ====================

const BOARD_SIZE = 10;
const LOCAL_URL  = "";  // 本地模式下默认为当前页面地址

/** 返回 WebSocket 服务器地址，联机模式专用 */
function getWsUrl() {
    return "ws://localhost:8765";
}

// ==================== 全局状态 ====================

let currentMode = "local";       // "local" | "online"
let currentTurn = 0;             // 当前回合玩家（0=玩家1, 1=玩家2）
let gameOver = false;
let ws = null;                   // WebSocket 实例（联机模式）
let currentRoomId = null;        // 联机房间号
let myPlayerId = 0;              // 联机时自己对应的玩家编号（0 或 1）
let isMyTurn = false;            // 联机时是否轮到自己

/** myCells[p][r][c] — 玩家 p 的「我方部署」棋盘上第 r 行第 c 列的 DOM 格子 */
let myCells    = [ [], [] ];

/** enemyCells[p][r][c] — 玩家 p 的「攻击敌方」棋盘上第 r 行第 c 列的 DOM 格子 */
let enemyCells = [ [], [] ];

// ==================== 初始化 ====================

/** 页面加载完成后的入口：生成全部棋盘 → 绑定按钮 → 进入本地模式 */
window.onload = function () {
    createAllBoards();
    bindButtons();
    setMode("local");
};

// ==================== 棋盘生成 ====================

/** 为两个玩家各生成「我方部署」和「攻击敌方」棋盘，共 4 个空棋盘，每个棋盘包含 10×10 个 div.cell */
function createAllBoards() {
    for (let p = 0; p <= 1; p++) {
        createBoard(`board-my-${p}`, myCells[p], true);
        createBoard(`board-enemy-${p}`, enemyCells[p], false);
    }
}

/**
 * 生成单个 10×10 棋盘的所有格子 DOM
 * @param {string} boardId  — 棋盘容器的 HTML id
 * @param {array}  cellArray — 二维数组引用，生成后 cellArray[r][c] = 对应格子 DOM
 * @param {boolean} isMyBoard — 是否为我方棋盘（当前未使用，保留参数）
 */
function createBoard(boardId, cellArray, isMyBoard) {
    const container = document.getElementById(boardId);
    container.innerHTML = "";

    for (let r = 0; r < BOARD_SIZE; r++) {
        cellArray[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.dataset.attacked = "false";

            container.appendChild(cell);
            cellArray[r][c] = cell;
        }
    }
}

/**
 * 给指定玩家的「攻击敌方」棋盘的每一个格子绑定 click 事件
 * 用 cloneNode 技巧先清除旧事件，再重新绑定，避免重复绑定
 * @param {number} playerId — 0=玩家1, 1=玩家2
 */
function bindEnemyClicks(playerId) {
    const boardEl = document.getElementById(`board-enemy-${playerId}`);
    // cloneNode 会丢弃所有旧的事件监听器
    const clone = boardEl.cloneNode(true);
    boardEl.parentNode.replaceChild(clone, boardEl);

    // 重建 enemyCells 引用并绑定新事件
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = clone.children[r * BOARD_SIZE + c];
            enemyCells[playerId][r][c] = cell;
            cell.addEventListener("click", () => onEnemyClick(playerId, r, c));
        }
    }
}

// ==================== 点击处理 ====================

/**
 * 玩家点击「攻击敌方」棋盘上某格的入口
 * 做四层校验（游戏结束? 轮到自己? 格子未被攻击过?）→ 通过后发送攻击请求
 * @param {number} playerId — 攻击方
 * @param {number} row — 行 0-9
 * @param {number} col — 列 0-9
 */
function onEnemyClick(playerId, row, col) {
    if (gameOver) {
        showMessage("游戏已结束，请重新开始");
        return;
    }
    if (currentMode === "local" && playerId !== currentTurn) {
        showMessage(`还没轮到你！当前是玩家${currentTurn + 1}的回合`);
        return;
    }
    if (currentMode === "online" && !isMyTurn) {
        showMessage("还没轮到你！");
        return;
    }
    const cell = enemyCells[playerId][row][col];
    if (cell && cell.dataset.attacked === "true") {
        showMessage("该格已攻击过");
        return;
    }

    if (currentMode === "local") {
        sendAttackLocal(playerId, row, col);
    } else {
        sendAttackOnline(row, col);
    }
}

// ==================== 发送攻击 ====================

/**
 * 本地模式：HTTP POST /attack → 服务端 game_logic.py 计算命中/落空/胜负
 * 请求体：{ player: 攻击方编号, row: 行, col: 列 }
 */
async function sendAttackLocal(attackerId, row, col) {
    try {
        const resp = await fetch(`${LOCAL_URL}/attack`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ player: attackerId, row, col }),
        });
        const data = await resp.json();
        if (data.success) {
            handleLocalResult(data);
        } else {
            showMessage(data.message || "请求失败");
        }
    } catch (err) {
        showMessage("无法连接服务，请确认 local_game.py 已启动");
        console.error(err);
    }
}

/**
 * 联机模式：WebSocket 发送攻击指令
 * 消息格式：{ type: "attack", room_id, row, col }
 */
function sendAttackOnline(row, col) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showMessage("未连接到服务器");
        return;
    }
    ws.send(JSON.stringify({ type: "attack", room_id: currentRoomId, row, col }));
}

// ==================== 本地模式：结果处理 ====================

/**
 * 本地模式攻击后的完整响应处理：
 * 显示消息 → 重新拉取双方棋盘 → 更新回合 UI → 检查胜负
 * @param {object} data — 服务端返回 { result, message, current_turn, game_over, winner }
 */
async function handleLocalResult(data) {
    const { result, message, current_turn, game_over, winner } = data;

    showMessage(message);
    await refreshBothPlayers();

    currentTurn = current_turn;
    updateTurnUI();

    if (game_over) {
        gameOver = true;
        showGameOver(`玩家${winner + 1} 获胜！`);
    }
}

/**
 * 并行请求 GET /state?player=0 和 GET /state?player=1
 * 用返回数据同时刷新四个棋盘 + 剩余敌机计数
 * 每次攻击后、游戏重开后都会调用
 */
async function refreshBothPlayers() {
    try {
        const [s0, s1] = await Promise.all([
            fetch(`${LOCAL_URL}/state?player=0`).then(r => r.json()),
            fetch(`${LOCAL_URL}/state?player=1`).then(r => r.json()),
        ]);
        // 【防偷看】当前行动方的棋盘数据 → 映射到双方"我方部署"
        // 非行动方看到的也是行动方的飞机布局，无法偷看对方真实部署
        const activePlayerBoard = s0.current_turn === 0 ? s0.your_board : s1.your_board;
        updateMyBoard(0, activePlayerBoard);
        updateMyBoard(1, activePlayerBoard);

        updateEnemyBoard(0, s0.enemy_board);
        updateEnemyBoard(1, s1.enemy_board);
        document.getElementById("score-0").textContent = s0.remaining_planes.enemy;
        document.getElementById("score-1").textContent = s1.remaining_planes.enemy;
        currentTurn = s0.current_turn;
    } catch (err) {
        console.error("刷新棋盘失败", err);
    }
}

// ==================== 棋盘渲染 ====================

/**
 * 根据服务端数据更新某个玩家的「我方部署」棋盘格子样式
 * @param {number} playerId — 玩家编号
 * @param {number[][]} boardData — 10×10 数组，值: 0=空白, 1=机身, 2=机头
 */
function updateMyBoard(playerId, boardData) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = myCells[playerId][r][c];
            if (!cell) continue;
            const val = boardData[r][c];
            cell.className = "cell";
            cell.textContent = "";
            if (val === 0) cell.classList.add("cell-empty");
            else if (val === 1) cell.classList.add("cell-body");
            else if (val === 2) cell.classList.add("cell-head");
        }
    }
}

/**
 * 根据服务端数据更新某个玩家的「攻击敌方」棋盘格子样式
 * @param {number} playerId — 玩家编号
 * @param {number[][]} boardData — 10×10 数组，值: -1=未攻击, 0=落空, 1=命中机身, 2=命中机头
 * 每种值对应不同的 CSS 类和文字符号（○/✕/💥）
 * 更新完后调用 bindEnemyClicks() 重新绑定事件
 */
function updateEnemyBoard(playerId, boardData) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = enemyCells[playerId][r][c];
            if (!cell) continue;
            const val = boardData[r][c];

            if (val === -1) {
                cell.className = "cell cell-unknown";
                cell.dataset.attacked = "false";
                cell.textContent = "";
            } else {
                cell.dataset.attacked = "true";
                cell.classList.add("cell-attacked");
                if (val === 0) {
                    cell.className = "cell cell-miss cell-attacked";
                    cell.textContent = "○";
                } else if (val === 1) {
                    cell.className = "cell cell-hit cell-attacked";
                    cell.textContent = "✕";
                } else if (val === 2) {
                    cell.className = "cell cell-headshot cell-attacked";
                    cell.textContent = "💥";
                }
            }
        }
    }
    bindEnemyClicks(playerId);
}

// ==================== 回合 UI 更新 ====================

/**
 * 根据当前模式、回合、胜负状态，更新所有 UI 状态：
 * - 回合指示器文字
 * - 玩家区域高亮（.active）
 * - 玩家标题高亮（.active-player）
 * - 我方棋盘遮罩显隐（.hidden）
 * - 攻击棋盘禁用状态（.disabled）
 * - 联机模式额外：只显示自己的区域，遮罩全隐藏
 */
function updateTurnUI() {
    const indicator = document.getElementById("turn-indicator");
    const zone0 = document.getElementById("zone-p0");
    const zone1 = document.getElementById("zone-p1");
    const title0 = zone0.querySelector(".zone-title");
    const title1 = zone1.querySelector(".zone-title");
    const boardE0 = document.getElementById("board-enemy-0");
    const boardE1 = document.getElementById("board-enemy-1");
    const cover0 = document.getElementById("cover-0");
    const cover1 = document.getElementById("cover-1");

    if (gameOver) {
        indicator.textContent = "游戏结束";
        title0.classList.remove("active-player");
        title1.classList.remove("active-player");
        zone0.classList.remove("active");
        zone1.classList.remove("active");
        if (boardE0) boardE0.classList.add("disabled");
        if (boardE1) boardE1.classList.add("disabled");
        if (cover0) cover0.classList.add("hidden");
        if (cover1) cover1.classList.add("hidden");
        return;
    }

    if (currentMode === "local") {
        // 本地模式：根据 currentTurn 高亮当前玩家
        indicator.textContent = `当前回合：玩家${currentTurn + 1}`;

        title0.classList.toggle("active-player", currentTurn === 0);
        title1.classList.toggle("active-player", currentTurn === 1);
        zone0.classList.toggle("active", currentTurn === 0);
        zone1.classList.toggle("active", currentTurn === 1);

        // 遮罩：轮到谁，谁的遮罩就透明
        if (cover0) cover0.classList.toggle("hidden", currentTurn === 0);
        if (cover1) cover1.classList.toggle("hidden", currentTurn === 1);

        // 攻击棋盘：非自己回合则禁用
        if (boardE0) boardE0.classList.toggle("disabled", currentTurn !== 0);
        if (boardE1) boardE1.classList.toggle("disabled", currentTurn !== 1);
    } else {
        // 联机模式：高亮自己的区域，遮罩全隐藏
        indicator.textContent = isMyTurn ? "轮到你了！" : "等待对手...";

        zone0.classList.toggle("active", myPlayerId === 0);
        zone1.classList.toggle("active", myPlayerId === 1);
        title0.classList.toggle("active-player", myPlayerId === 0);
        title1.classList.toggle("active-player", myPlayerId === 1);

        if (boardE0) boardE0.classList.toggle("disabled", myPlayerId !== 0 || !isMyTurn);
        if (boardE1) boardE1.classList.toggle("disabled", myPlayerId !== 1 || !isMyTurn);

        if (cover0) cover0.classList.add("hidden");
        if (cover1) cover1.classList.add("hidden");
    }
}

// ==================== 消息、弹窗、重启 ====================

/**
 * 在信息栏显示临时提示消息，文字变金色，2 秒后自动恢复原色
 * @param {string} msg — 要显示的消息文字
 */
function showMessage(msg) {
    const box = document.getElementById("message-box");
    box.textContent = msg;
    box.style.color = "#f0c040";
    setTimeout(() => { box.style.color = ""; }, 2000);
}

/** 显示游戏结束弹窗：填入获胜文字 → 弹出模态框 → 更新回合 UI */
function showGameOver(text) {
    document.getElementById("winner-text").textContent = text;
    document.getElementById("game-over-modal").style.display = "flex";
    updateTurnUI();
}

/** 隐藏游戏结束弹窗 */
function hideGameOver() {
    document.getElementById("game-over-modal").style.display = "none";
}

/**
 * 重置游戏状态：
 * 本地模式 → POST /restart + 重新拉取双方棋盘
 * 联机模式 → WebSocket 发送 restart 消息
 */
async function restartGame() {
    hideGameOver();
    gameOver = false;
    currentTurn = 0;
    document.getElementById("message-box").textContent = "";

    if (currentMode === "local") {
        document.getElementById("score-0").textContent = "3";
        document.getElementById("score-1").textContent = "3";
        await fetch(`${LOCAL_URL}/restart`, { method: "POST" });
        await refreshBothPlayers();
    } else if (currentMode === "online") {
        document.getElementById(`score-${myPlayerId}`).textContent = "3";
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "restart", room_id: currentRoomId }));
        }
    }
    updateTurnUI();
    showMessage("游戏已重置");
}

// ==================== WebSocket（联机模式）====================

/**
 * 建立 WebSocket 连接并绑定四个生命周期回调：
 * onopen     → 更新房间状态为"已连接"
 * onmessage  → 所有服务端推送消息统一交给 handleServerMessage 路由
 * onerror    → 提示连接错误
 * onclose    → 更新房间状态为"已断开"
 */
function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
        document.getElementById("room-status").textContent = "已连接";
        document.getElementById("room-status").style.color = "#4caf50";
    };
    ws.onmessage = (event) => {
        try { handleServerMessage(JSON.parse(event.data)); }
        catch (e) { console.error("[WS] parse error", e); }
    };
    ws.onerror = () => showMessage("WebSocket 连接错误");
    ws.onclose = () => {
        document.getElementById("room-status").textContent = "已断开";
        document.getElementById("room-status").style.color = "#ef5350";
    };
}

/**
 * WebSocket 消息路由器，根据 data.type 分发到对应处理逻辑：
 *   room_created           — 房主：房间创建成功，等待对手
 *   room_joined            — 客端：加入房间成功，等待游戏开始
 *   game_start             — 双方：游戏正式开局，收到自己的棋盘初始数据
 *   attack_result          — 双方：某次攻击的结果，更新棋盘 + 检查胜负
 *   opponent_disconnected  — 对手断开连接
 *   error                  — 服务端错误
 * @param {object} data — 服务端推送的 JSON 消息
 */
function handleServerMessage(data) {
    switch (data.type) {
        case "room_created":
            currentRoomId = data.room_id;
            myPlayerId = data.player;
            isMyTurn = false;
            showMyZone();
            document.getElementById("room-id-display").textContent = `房间号：${currentRoomId}`;
            document.getElementById("room-status").textContent = "等待对手加入...";
            showMessage("等待对手加入...");
            updateTurnUI();
            break;

        case "room_joined":
            currentRoomId = data.room_id;
            myPlayerId = data.player;
            isMyTurn = false;
            showMyZone();
            document.getElementById("room-id-display").textContent = `房间号：${currentRoomId}`;
            document.getElementById("room-status").textContent = `已加入，你是玩家${myPlayerId + 1}`;
            showMessage("等待游戏开始...");
            updateTurnUI();
            break;

        case "game_start":
            myPlayerId = data.player;
            isMyTurn = (data.current_turn === myPlayerId);
            showMyZone();
            updateMyBoard(myPlayerId, data.your_board);
            updateEnemyBoard(myPlayerId, data.enemy_board);
            document.getElementById(`score-${myPlayerId}`).textContent = data.remaining_planes.enemy;
            gameOver = false;
            showMessage(isMyTurn ? "游戏开始！轮到你了！" : "游戏开始！等待对手攻击...");
            updateTurnUI();
            break;

        case "attack_result":
            isMyTurn = (data.current_turn === myPlayerId);
            updateMyBoard(myPlayerId, data.your_board);
            updateEnemyBoard(myPlayerId, data.enemy_board);
            document.getElementById(`score-${myPlayerId}`).textContent = data.remaining_planes.enemy;
            showMessage(data.message);
            updateTurnUI();
            if (data.game_over) {
                gameOver = true;
                showGameOver(data.winner === myPlayerId ? "你赢了！" : "你输了...");
            }
            break;

        case "opponent_disconnected":
            showMessage("对手已断开连接");
            gameOver = true;
            updateTurnUI();
            break;

        case "error":
            showMessage(data.message || "服务器错误");
            break;
    }
}

// ==================== 联机 UI ====================

/**
 * 联机模式下，根据 myPlayerId 只显示自己对应的玩家区域（zone-p0 或 zone-p1）
 * 对方区域和分隔线均隐藏（双方不在同一台电脑上）
 */
function showMyZone() {
    const zone0 = document.getElementById("zone-p0");
    const zone1 = document.getElementById("zone-p1");
    const divider = document.querySelector(".zone-divider");

    zone0.style.display = (myPlayerId === 0) ? "" : "none";
    zone1.style.display = (myPlayerId === 1) ? "" : "none";
    divider.style.display = "none";
}

// ==================== 模式切换 ====================

/**
 * 切换本地/联机模式的总控函数
 * 重置所有全局状态 → 切换按钮高亮 → 显示/隐藏联机房间面板 →
 * 本地模式：关闭 WebSocket、重建棋盘、请求服务端重置
 * 联机模式：隐藏对方区域、建立 WebSocket 连接
 * @param {string} mode — "local" | "online"
 */
function setMode(mode) {
    currentMode = mode;
    gameOver = false;
    currentTurn = 0;
    currentRoomId = null;
    myPlayerId = 0;
    isMyTurn = false;

    document.getElementById("btn-mode-local").classList.toggle("active", mode === "local");
    document.getElementById("btn-mode-online").classList.toggle("active", mode === "online");
    document.getElementById("room-panel").style.display = (mode === "online") ? "flex" : "none";
    document.getElementById("message-box").textContent = "";
    hideGameOver();

    const c0 = document.getElementById("cover-0");
    const c1 = document.getElementById("cover-1");
    if (c0) c0.classList.add("hidden");
    if (c1) c1.classList.add("hidden");

    if (mode === "local") {
        if (ws) { ws.close(); ws = null; }
        document.getElementById("room-status").textContent = "未连接";
        document.getElementById("room-id-display").textContent = "";
        document.getElementById("zone-p0").style.display = "";
        document.getElementById("zone-p1").style.display = "";
        document.querySelector(".zone-divider").style.display = "";

        createAllBoards();
        fetch(`${LOCAL_URL}/restart`, { method: "POST" })
            .then(() => refreshBothPlayers())
            .then(() => {
                updateTurnUI();
                showMessage("玩家1先手，点击你的「攻击敌方」棋盘");
            })
            .catch(() => {});
    } else {
        document.getElementById("zone-p0").style.display = "";
        document.getElementById("zone-p1").style.display = "none";
        document.querySelector(".zone-divider").style.display = "none";
        createAllBoards();
        connectWebSocket();
        updateTurnUI();
    }
}

// ==================== 按钮绑定 ====================

/**
 * 一次性绑定所有按钮和输入框的事件监听：
 * - 模式按钮 → setMode()
 * - 创建/加入房间 → WebSocket 发送消息（若未连接则先 connect + 延迟 500ms）
 * - 重新开始/再来一局 → restartGame()
 * - 房间号输入框回车 → 触发加入房间
 */
function bindButtons() {
    document.getElementById("btn-mode-local").addEventListener("click", () => setMode("local"));
    document.getElementById("btn-mode-online").addEventListener("click", () => setMode("online"));

    document.getElementById("btn-create-room").addEventListener("click", () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "create_room" }));
        } else {
            connectWebSocket();
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN)
                    ws.send(JSON.stringify({ type: "create_room" }));
            }, 500);
        }
    });

    document.getElementById("btn-join-room").addEventListener("click", () => {
        const rid = document.getElementById("input-room-id").value.trim().toUpperCase();
        if (!rid) { showMessage("请输入房间号"); return; }
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "join_room", room_id: rid }));
        } else {
            connectWebSocket();
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN)
                    ws.send(JSON.stringify({ type: "join_room", room_id: rid }));
            }, 500);
        }
    });

    document.getElementById("btn-restart").addEventListener("click", restartGame);
    document.getElementById("btn-new-game").addEventListener("click", restartGame);

    document.getElementById("input-room-id").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("btn-join-room").click();
    });
}
