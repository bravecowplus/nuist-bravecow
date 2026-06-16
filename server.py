"""
server.py — WebSocket 联机对战服务
=====================================
依赖：core.game_logic（强依赖，必须导入 GameLogic）
被对接：static/main.js 通过 WebSocket 直连

职责：WebSocket 服务 / 房间管理 / 调用核心逻辑 / 双人回合同步。
禁止：重复实现飞机摆放、攻击判定（必须用核心逻辑的方法）。

启动方式：
    pip install websockets
    python server.py
    → 浏览器打开 static/index.html → 选择「联机对战」
"""

import asyncio
import json
import uuid
from websockets import serve
from websockets.exceptions import ConnectionClosed
from core.game_logic import GameLogic, BOARD_SIZE, MISS, HIT, HEADSHOT


# ===================== 房间类 =====================

class Room:
    """一个游戏房间 = 2个玩家 + 1个 GameLogic 实例。"""

    def __init__(self, room_id):
        self.room_id = room_id
        self.logic = GameLogic()              # 自动初始化棋盘 + 摆飞机
        self.players = [None, None]           # [ws0, ws1]
        self.current_turn = 0                 # 0=玩家1, 1=玩家2
        self.game_started = False
        self.game_over = False
        self.winner = None
        self.player_count = 0

    def add_player(self, websocket):
        """加入房间，返回玩家编号 0 或 1。"""
        if self.player_count >= 2:
            return None
        pid = 0 if self.players[0] is None else 1
        self.players[pid] = websocket
        self.player_count += 1
        if self.player_count == 2:
            self.game_started = True
        return pid

    def remove_player(self, websocket):
        """玩家离开。"""
        for i in range(2):
            if self.players[i] == websocket:
                self.players[i] = None
                self.player_count -= 1
                return i
        return None

    def is_full(self):
        return self.player_count >= 2

    def is_empty(self):
        return self.player_count == 0

    async def handle_attack(self, attacker_pid, row, col):
        """处理攻击 → 调用 C 逻辑 → 返回结果。"""
        if self.game_over:
            return {"success": False, "message": "游戏已结束"}
        if attacker_pid != self.current_turn:
            return {"success": False, "message": f"还没轮到你！当前是玩家{self.current_turn + 1}的回合"}

        target_pid = 1 - attacker_pid

        try:
            result = self.logic.attack(target_pid, row, col)
        except ValueError as e:
            return {"success": False, "message": str(e)}
        except IndexError as e:
            return {"success": False, "message": str(e)}

        msg_map = {MISS: "未命中！", HIT: "命中机身！", HEADSHOT: "命中机头！飞机击毁！"}
        message = msg_map.get(result, "")

        is_defeated = self.logic.is_player_defeated(target_pid)

        if is_defeated:
            self.game_over = True
            self.winner = attacker_pid

        if not self.game_over:
            self.current_turn = target_pid

        return {
            "success": True,
            "result": result,
            "message": message,
            "current_turn": self.current_turn,
            "game_over": self.game_over,
            "winner": self.winner,
            "attacker": attacker_pid,
        }

    async def broadcast(self, message):
        """向房间内所有人发送同一消息。"""
        for ws in self.players:
            if ws is not None:
                try:
                    await ws.send(json.dumps(message, ensure_ascii=False))
                except ConnectionClosed:
                    pass  # 发送失败忽略，连接断开由 handler 处理

    async def send_to(self, pid, message):
        """向指定玩家发送消息。"""
        ws = self.players[pid]
        if ws is not None:
            try:
                await ws.send(json.dumps(message, ensure_ascii=False))
            except ConnectionClosed:
                pass

    def build_game_state(self, pid):
        """构建指定玩家视角的游戏状态。"""
        enemy_pid = 1 - pid
        return {
            "your_board": self.logic.get_board_state(pid),
            "enemy_board": self._build_visible_board(enemy_pid),
            "remaining_planes": {
                "you": self._count_alive_planes(pid),
                "enemy": self._count_alive_planes(enemy_pid),
            },
        }

    def _build_visible_board(self, player_id):
        """构建可视棋盘（已攻击格可见，未攻击格=-1）。"""
        real = self.logic.get_board_state(player_id)
        attacked = self.logic.get_attacked_set(player_id)
        visible = []
        for r in range(BOARD_SIZE):
            row = []
            for c in range(BOARD_SIZE):
                if (r, c) in attacked:
                    row.append(real[r][c])
                else:
                    row.append(-1)
            visible.append(row)
        return visible

    def _count_alive_planes(self, player_id):
        heads = self.logic.get_plane_heads(player_id)
        attacked = self.logic.get_attacked_set(player_id)
        return sum(1 for (hr, hc) in heads if (hr, hc) not in attacked)


# ===================== 服务端 =====================

class PlaneBattleServer:
    """WebSocket 对战服务器 —— 房间管理 + 消息路由。"""

    def __init__(self):
        self.rooms = {}  # {room_id: Room}

    def create_room(self):
        rid = uuid.uuid4().hex[:6].upper()  # 6位房间号
        self.rooms[rid] = Room(rid)
        print(f"[房间] 创建 {rid}")
        return rid

    def delete_room(self, rid):
        if rid in self.rooms:
            del self.rooms[rid]
            print(f"[房间] 删除 {rid}")

    async def handler(self, websocket, path=None):
        """
        每个 WebSocket 连接的处理入口。
        消息格式: {"type": "create_room"|"join_room"|"attack"|"restart", ...}
        """
        current_room = None
        current_pid = None

        async def reply(msg):
            try:
                await websocket.send(json.dumps(msg, ensure_ascii=False))
            except ConnectionClosed:
                pass

        async for raw in websocket:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await reply({"type": "error", "message": "JSON 格式错误"})
                continue

            msg_type = data.get("type", "")

            # ===== 创建房间 =====
            if msg_type == "create_room":
                rid = self.create_room()
                room = self.rooms[rid]
                pid = room.add_player(websocket)
                current_room = room
                current_pid = pid
                await reply({
                    "type": "room_created",
                    "room_id": rid,
                    "player": pid,
                    "message": f"房间 {rid} 已创建，等待对手加入...",
                })
                print(f"[连接] 玩家{pid + 1} 创建并加入房间 {rid}")

            # ===== 加入房间 =====
            elif msg_type == "join_room":
                rid = data.get("room_id", "").upper()
                room = self.rooms.get(rid)
                if room is None:
                    await reply({"type": "error", "message": f"房间 {rid} 不存在"})
                    continue
                if room.is_full():
                    await reply({"type": "error", "message": f"房间 {rid} 已满"})
                    continue

                pid = room.add_player(websocket)
                current_room = room
                current_pid = pid
                await reply({
                    "type": "room_joined",
                    "room_id": rid,
                    "player": pid,
                    "message": f"已加入房间 {rid}，你是玩家{pid + 1}",
                })
                print(f"[连接] 玩家{pid + 1} 加入房间 {rid}")

                # 双方到齐 → 广播游戏开始
                if room.is_full():
                    for p in range(2):
                        state = room.build_game_state(p)
                        await room.send_to(p, {
                            "type": "game_start",
                            "player": p,
                            "current_turn": room.current_turn,
                            **state,
                        })
                    print(f"[房间] {rid} 游戏开始")

            # ===== 攻击 =====
            elif msg_type == "attack":
                if current_room is None:
                    await reply({"type": "error", "message": "你不在任何房间中"})
                    continue
                if not current_room.game_started:
                    await reply({"type": "error", "message": "等待对手加入..."})
                    continue

                row = data.get("row")
                col = data.get("col")
                if row is None or col is None:
                    await reply({"type": "error", "message": "缺少 row/col"})
                    continue

                result = await current_room.handle_attack(current_pid, row, col)

                if not result["success"]:
                    await reply({"type": "error", "message": result["message"]})
                    continue

                # 构建双方的游戏状态
                state_p0 = current_room.build_game_state(0)
                state_p1 = current_room.build_game_state(1)

                # 广播攻击结果给双方（各自视角）
                for p in range(2):
                    state = state_p0 if p == 0 else state_p1
                    await current_room.send_to(p, {
                        "type": "attack_result",
                        "result": result["result"],
                        "message": result["message"],
                        "current_turn": result["current_turn"],
                        "game_over": result["game_over"],
                        "winner": result["winner"],
                        "attacker": result["attacker"],
                        "player": p,
                        **state,
                    })

            # ===== 重新开始 =====
            elif msg_type == "restart":
                if current_room is None:
                    await reply({"type": "error", "message": "你不在任何房间中"})
                    continue
                # 重新创建逻辑实例
                current_room.logic = GameLogic()
                current_room.current_turn = 0
                current_room.game_over = False
                current_room.winner = None

                for p in range(2):
                    state = current_room.build_game_state(p)
                    await current_room.send_to(p, {
                        "type": "game_start",
                        "player": p,
                        "current_turn": 0,
                        **state,
                    })
                print(f"[房间] {current_room.room_id} 重新开始")

            else:
                await reply({"type": "error", "message": f"未知消息类型: {msg_type}"})

        # ===== 连接断开 =====
        if current_room is not None:
            current_room.remove_player(websocket)
            rid = current_room.room_id
            print(f"[断开] 玩家{current_pid + 1 if current_pid is not None else '?'} 离开房间 {rid}")

            # 通知另一方
            other_pid = 1 - current_pid if current_pid is not None else None
            if other_pid is not None:
                await current_room.send_to(other_pid, {
                    "type": "opponent_disconnected",
                    "message": "对手已断开连接",
                })

            # 空房间清理
            if current_room.is_empty():
                self.delete_room(rid)


async def main():
    server = PlaneBattleServer()
    port = 8765
    print("=" * 50)
    print(f"  联机对战服务已启动 → ws://localhost:{port}")
    print(f"  前端请打开 http://localhost:5000 并选择「联机对战」")
    print(f"  按 q + 回车 退出服务")
    print("=" * 50)

    stop = asyncio.Event()

    async with serve(server.handler, "0.0.0.0", port):
        # 在单独线程等待用户输入
        import concurrent.futures
        loop = asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            await loop.run_in_executor(pool, wait_for_quit)
            stop.set()


def wait_for_quit():
    """阻塞等待用户输入 q 退出。"""
    try:
        while True:
            cmd = input().strip().lower()
            if cmd == "q":
                break
    except (EOFError, KeyboardInterrupt):
        pass
    print("\n服务已关闭")


if __name__ == "__main__":
    asyncio.run(main())
