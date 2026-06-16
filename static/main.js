/**
 * main.js — 飞机对战游戏（四棋盘布局）
 * 每个玩家独立拥有「我方部署」+「攻击敌方」两个棋盘
 * 回合自动切换，棋盘实时刷新，无需遮罩
 */

// ==================== 常量 ====================

const BOARD_SIZE = 10;
const LOCAL_URL  = "";
// WebSocket 地址
function getWsUrl() {
    return "ws://localhost:8765";
}

// ==================== 全局状态 ====================

let currentMode = "local";
let currentTurn = 0;          // 当前回合玩家 0 或 1
let gameOver = false;
let ws = null;
let currentRoomId = null;
let myPlayerId = 0;           // 联机模式使用

// 四个棋盘的格子 DOM 缓存: cells[playerIndex][row][col]
let myCells    = [ [], [] ];   // 我方部署棋盘
let enemyCells = [ [], [] ];   // 攻击敌方棋盘

// ==================== 初始化 ====================

window.onload = function () {
    createAllBoards();
    bindButtons();
    setMode("local");
};

// ==================== 棋盘生成 ====================

function createAllBoards() {
    for (let p = 0; p <= 1; p++) {
        createBoard(`board-my-${p}`, myCells[p], true);
        createBoard(`board-enemy-${p}`, enemyCells[p], false);
    }
}

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

// 给敌方棋盘绑定点击（按玩家区分）
function bindEnemyClicks(playerId) {
    const boardEl = document.getElementById(`board-enemy-${playerId}`);
    // 先解绑旧事件（用 clone 方式）
    const clone = boardEl.cloneNode(true);
    boardEl.parentNode.replaceChild(clone, boardEl);

    // 重建 cell 引用
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = clone.children[r * BOARD_SIZE + c];
            enemyCells[playerId][r][c] = cell;
            cell.addEventListener("click", () => onEnemyClick(playerId, r, c));
        }
    }
}

// ==================== 点击处理 ====================

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

function sendAttackOnline(row, col) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showMessage("未连接到服务器");
        return;
    }
    ws.send(JSON.stringify({ type: "attack", room_id: currentRoomId, row, col }));
}

// ==================== 本地模式：结果处理 ====================

async function handleLocalResult(data) {
    const { result, message, current_turn, game_over, winner } = data;

    // 显示消息
    showMessage(message);

    // 刷新全部四个棋盘（双方各自视角）
    await refreshBothPlayers();

    // 更新回合
    currentTurn = current_turn;
    updateTurnUI();

    // 胜负
    if (game_over) {
        gameOver = true;
        showGameOver(`玩家${winner + 1} 获胜！`);
    }
}

// 从服务端拉取双方视角并刷新四个棋盘
async function refreshBothPlayers() {
    try {
        const [s0, s1] = await Promise.all([
            fetch(`${LOCAL_URL}/state?player=0`).then(r => r.json()),
            fetch(`${LOCAL_URL}/state?player=1`).then(r => r.json()),
        ]);
        updateMyBoard(0, s0.your_board);
        updateEnemyBoard(0, s0.enemy_board);
        updateMyBoard(1, s1.your_board);
        updateEnemyBoard(1, s1.enemy_board);
        document.getElementById("score-0").textContent = s0.remaining_planes.enemy;
        document.getElementById("score-1").textContent = s1.remaining_planes.enemy;
        currentTurn = s0.current_turn;
    } catch (err) {
        console.error("刷新棋盘失败", err);
    }
}

// ==================== 棋盘渲染 ====================

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

function updateEnemyBoard(playerId, boardData) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = enemyCells[playerId][r][c];
            if (!cell) continue;
            const val = boardData[r][c];

            if (val === -1) {
                // 未攻击
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
    // 重新绑定点击（因为 cloneNode 会丢失事件）
    bindEnemyClicks(playerId);
}

// ==================== 回合 UI ====================

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
        indicator.textContent = `当前回合：玩家${currentTurn + 1}`;

        title0.classList.toggle("active-player", currentTurn === 0);
        title1.classList.toggle("active-player", currentTurn === 1);
        zone0.classList.toggle("active", currentTurn === 0);
        zone1.classList.toggle("active", currentTurn === 1);

        if (cover0) cover0.classList.toggle("hidden", currentTurn === 0);
        if (cover1) cover1.classList.toggle("hidden", currentTurn === 1);

        if (boardE0) boardE0.classList.toggle("disabled", currentTurn !== 0);
        if (boardE1) boardE1.classList.toggle("disabled", currentTurn !== 1);
    } else {
        // 联机模式
        indicator.textContent = isMyTurn ? "轮到你了！" : "等待对手...";

        // 高亮自己的区域
        zone0.classList.toggle("active", myPlayerId === 0);
        zone1.classList.toggle("active", myPlayerId === 1);
        title0.classList.toggle("active-player", myPlayerId === 0);
        title1.classList.toggle("active-player", myPlayerId === 1);

        // 只有自己的攻击棋盘在轮到自己时可点击
        if (boardE0) boardE0.classList.toggle("disabled", myPlayerId !== 0 || !isMyTurn);
        if (boardE1) boardE1.classList.toggle("disabled", myPlayerId !== 1 || !isMyTurn);

        // 联机模式不需要遮盖（双方在不同电脑上）
        if (cover0) cover0.classList.add("hidden");
        if (cover1) cover1.classList.add("hidden");
    }
}

// ==================== 消息、弹窗、重启 ====================

function showMessage(msg) {
    const box = document.getElementById("message-box");
    box.textContent = msg;
    box.style.color = "#f0c040";
    setTimeout(() => { box.style.color = ""; }, 2000);
}

function showGameOver(text) {
    document.getElementById("winner-text").textContent = text;
    document.getElementById("game-over-modal").style.display = "flex";
    updateTurnUI();
}

function hideGameOver() {
    document.getElementById("game-over-modal").style.display = "none";
}

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

// ==================== 联机模式：显示自己的区域 ====================

function showMyZone() {
    const zone0 = document.getElementById("zone-p0");
    const zone1 = document.getElementById("zone-p1");
    const divider = document.querySelector(".zone-divider");

    zone0.style.display = (myPlayerId === 0) ? "" : "none";
    zone1.style.display = (myPlayerId === 1) ? "" : "none";
    divider.style.display = "none";  // 联机不显示分隔线
}

// ==================== 模式切换 ====================

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

    // 遮盖层隐藏
    const c0 = document.getElementById("cover-0");
    const c1 = document.getElementById("cover-1");
    if (c0) c0.classList.add("hidden");
    if (c1) c1.classList.add("hidden");

    if (mode === "local") {
        if (ws) { ws.close(); ws = null; }
        document.getElementById("room-status").textContent = "未连接";
        document.getElementById("room-id-display").textContent = "";
        // 显示双方区域
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
        // 联机模式：默认显示 zone-p0，收到 room_joined 后再切换
        document.getElementById("zone-p0").style.display = "";
        document.getElementById("zone-p1").style.display = "none";
        document.querySelector(".zone-divider").style.display = "none";
        createAllBoards();
        connectWebSocket();
        updateTurnUI();
    }
}

// ==================== 按钮绑定 ====================

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
