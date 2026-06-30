"""
local_game.py — 本地双人对战服务
==================================
依赖：core.game_logic（强依赖，必须导入 GameLogic）
被对接：static/main.js 通过 HTTP JSON 调用

职责：回合控制 / HTTP 通信 / 调用核心逻辑 / 托管前端静态文件。
禁止：重复实现飞机摆放、攻击判定（必须用核心逻辑的方法）。

启动方式：
    python local_game.py
    → 浏览器打开 http://localhost:5000
"""

import json
import os
import threading
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from core.game_logic import GameLogic, BOARD_SIZE, MISS, HIT, HEADSHOT


# 静态文件根目录
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# MIME 类型补充
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/html", ".html")


class LocalGame:
    """本地双人对战服务 —— 回合管理 + 调用 GameLogic。"""

    def __init__(self):
        self.logic = GameLogic()      # 自动初始化棋盘 + 摆放飞机
        self.current_turn = 0         # 0=玩家1先手, 1=玩家2
        self.game_over = False
        self.winner = None

    def handle_attack(self, attacking_player, row, col):
        """
        处理一次攻击请求。
        attacking_player: 攻击方 0 或 1
        row, col:         攻击坐标
        返回: dict 供前端渲染
        """
        if self.game_over:
            return self._error("游戏已结束，请重新开始")
        if attacking_player != self.current_turn:
            return self._error(f"还没轮到你！当前是玩家{self.current_turn + 1}的回合")

        target_player = 1 - attacking_player

        try:
            result = self.logic.attack(target_player, row, col)
        except ValueError as e:
            return self._error(str(e))
        except IndexError as e:
            return self._error(str(e))

        msg_map = {MISS: "未命中！", HIT: "命中机身！", HEADSHOT: "命中机头！飞机击毁！"}
        message = msg_map.get(result, "未知结果")

        is_defeated = self.logic.is_player_defeated(target_player)

        if is_defeated:
            self.game_over = True
            self.winner = attacking_player

        if not self.game_over:
            self.current_turn = target_player

        enemy_board = self._build_visible_board(target_player)

        return {
            "success": True,
            "result": result,
            "message": message,
            "current_turn": self.current_turn,
            "game_over": self.game_over,
            "winner": self.winner,
            "your_board": self.logic.get_board_state(attacking_player),
            "enemy_board": enemy_board,
            "remaining_planes": {
                "you": self._count_alive_planes(attacking_player),
                "enemy": self._count_alive_planes(target_player),
            },
        }

    def _build_visible_board(self, player_id):
        """构建敌方可视棋盘：已攻击格显示实际值，未攻击格显示 -1。"""
        real_board = self.logic.get_board_state(player_id)
        attacked = self.logic.get_attacked_set(player_id)
        visible = []
        for r in range(BOARD_SIZE):
            row = []
            for c in range(BOARD_SIZE):
                if (r, c) in attacked:
                    row.append(real_board[r][c])
                else:
                    row.append(-1)
            visible.append(row)
        return visible

    def _count_alive_planes(self, player_id):
        """统计剩余存活飞机数（机头未被命中 = 存活）。"""
        heads = self.logic.get_plane_heads(player_id)
        attacked = self.logic.get_attacked_set(player_id)
        return sum(1 for (hr, hc) in heads if (hr, hc) not in attacked)

    def get_state(self, player_id=0):
        """获取指定玩家视角的游戏状态。"""
        enemy_id = 1 - player_id
        return {
            "current_turn": self.current_turn,
            "game_over": self.game_over,
            "winner": self.winner,
            "your_board": self.logic.get_board_state(player_id),
            "enemy_board": self._build_visible_board(enemy_id),
            "remaining_planes": {
                "you": self._count_alive_planes(player_id),
                "enemy": self._count_alive_planes(enemy_id),
            },
        }

    def restart(self):
        """重置游戏。"""
        self.logic = GameLogic()
        self.current_turn = 0
        self.game_over = False
        self.winner = None

    @staticmethod
    def _error(msg):
        return {"success": False, "message": msg}


# ===================== HTTP 服务（同时托管静态文件 + API）=====================

class GameHTTPHandler(BaseHTTPRequestHandler):
    """处理前端页面请求 + API 请求。"""
    game: LocalGame = None

    # ---- 静态文件服务 ----

    def _serve_static(self, file_path):
        """读取并返回静态文件内容。"""
        full_path = os.path.join(STATIC_DIR, file_path)
        # 安全检查：防止路径穿越
        full_path = os.path.normpath(full_path)
        if not full_path.startswith(os.path.normpath(STATIC_DIR)):
            self.send_response(403)
            self.end_headers()
            return

        if not os.path.isfile(full_path):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")
            return

        mime_type, _ = mimetypes.guess_type(full_path)
        if mime_type is None:
            mime_type = "application/octet-stream"

        with open(full_path, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", f"{mime_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    # ---- JSON 响应 ----

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- 路由分发 ----

    def do_GET(self):
        path = self.path.split("?")[0]  # 去掉 query string
        qs = self.path.split("?")[1] if "?" in self.path else ""

        # 解析 player 参数
        player_id = 0
        if "player=" in qs:
            try:
                player_id = int(qs.split("player=")[1].split("&")[0])
            except ValueError:
                pass

        # API 路由
        if path == "/state":
            self._send_json(self.game.get_state(player_id))
        # 静态文件路由
        elif path == "/" or path == "/index.html":
            self._serve_static("index.html")
        elif path == "/style.css":
            self._serve_static("style.css")
        elif path == "/main.js":
            self._serve_static("main.js")
        elif path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")

    def do_POST(self):
        path = self.path.split("?")[0]
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length else b"{}"

        if path == "/attack":
            try:
                req = json.loads(raw)
                player = req.get("player", 0)
                row = req.get("row")
                col = req.get("col")
                if row is None or col is None:
                    self._send_json({"success": False, "message": "缺少 row/col"}, 400)
                    return
                data = self.game.handle_attack(player, row, col)
                self._send_json(data)
            except json.JSONDecodeError:
                self._send_json({"success": False, "message": "JSON 解析失败"}, 400)

        elif path == "/restart":
            self.game.restart()
            self._send_json({"success": True, "message": "游戏已重置"})

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")

    def log_message(self, format, *args):
        """简化日志输出。"""
        print(f"[HTTP] {args[0]}" if args else "")


def main():
    port = 5000
    GameHTTPHandler.game = LocalGame()
    server = HTTPServer(("0.0.0.0", port), GameHTTPHandler)

    # 后台线程运行服务
    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.start()

    print("=" * 50)
    print(f"  本地对战服务已启动")
    print(f"  浏览器打开 → http://localhost:{port}")
    print(f"  按 q + 回车 退出服务")
    print("=" * 50)

    # 主线程等待用户按 q 退出
    try:
        while True:
            cmd = input().strip().lower()
            if cmd == "q":
                break
    except (EOFError, KeyboardInterrupt):
        pass

    print("\n服务已关闭")

    # 先关socket再立即终止进程，绝不卡住
    server.socket.close()
    import os
    os._exit(0)


if __name__ == "__main__":
    main()
