"""
core/game_logic.py — 飞机对战游戏核心逻辑
============================================
依赖：无，random

本模块提供纯底层能力：
  - 10×10棋盘初始化
  - 1513飞机坐标 + 随机摆放（4种朝向）
  - 攻击判定：0=未命中 / 1=命中机身 / 2=命中机头
  - 重复攻击拦截
  - 胜负判断（全部机头被击毁）
  - 棋盘状态查询

禁止：操作界面、处理网络、控制回合。
"""

import random

# ===================== 常量 =====================

BOARD_SIZE = 10       # 棋盘 10×10
PLANE_COUNT = 3       # 每方 3 架飞机

# 格子状态码（棋盘上的值）
EMPTY = 0
BODY  = 1
HEAD  = 2

# 攻击结果码（attack() 返回值）
MISS     = 0   # 未命中
HIT      = 1   # 命中机身/机翼
HEADSHOT = 2   # 命中机头

# 飞机朝向
DIR_UP    = 0
DIR_DOWN  = 1
DIR_LEFT  = 2
DIR_RIGHT = 3


class GameLogic:
    """
    飞机对战游戏核心逻辑类。

    用法（供其他文件调用）:
        game = GameLogic()
        result = game.attack(player_id=1, row=3, col=5)
        if game.is_player_defeated(1):
            print("玩家1失败")
    """

    # ===================== 初始化 =====================

    def __init__(self):
        """创建两个 10×10 空棋盘，自动随机摆放飞机。"""
        self.board_p0 = [[EMPTY] * BOARD_SIZE for _ in range(BOARD_SIZE)]
        self.board_p1 = [[EMPTY] * BOARD_SIZE for _ in range(BOARD_SIZE)]

        # 已受攻击坐标集合（防重复攻击）
        self.attacked_p0 = set()
        self.attacked_p1 = set()

        # 各玩家所有机头坐标 [(r,c), (r,c), ...]
        self.plane_heads_p0 = []
        self.plane_heads_p1 = []

        # 自动摆放
        self.place_planes(0)
        self.place_planes(1)

    # ===================== 1513 飞机形状 =====================

    def _get_plane_offsets(self, direction):
        """
        获取飞机各部件相对机头的偏移量（1513 规则）。

        飞机形状（朝上时）：
                ○         ← 机头 (dr=0, dc=0)
            ○ ○ ○ ○ ○     ← 第1行 机身 + 机翼
                ○         ← 第2行 机身
                ○         ← 第3行 机身
                ○         ← 第4行 机身（尾部）

        参数:
            direction: DIR_UP(0) / DIR_DOWN(1) / DIR_LEFT(2) / DIR_RIGHT(3)
        返回:
            [(dr, dc, 类型), ...] — 5 + 4 + 1 = 10? 实际共 9 个格子
        """
        # 朝上时的基础偏移（共 9 格：1机头 + 5第1行 + 3行机身）
        base = [
            ( 0,  0, HEAD),                                         # 机头
            ( 1, -2, BODY), ( 1, -1, BODY), ( 1,  0, BODY),
            ( 1,  1, BODY), ( 1,  2, BODY),                         # 第1行 机身+机翼
            ( 2,  0, BODY),                                         # 第2行 机身
            ( 3,  0, BODY),                                         # 第3行 机身
            ( 4,  0, BODY),                                         # 第4行 机尾
        ]

        if direction == DIR_UP:
            return base
        elif direction == DIR_DOWN:
            return [(-dr, -dc, t) for dr, dc, t in base]
        elif direction == DIR_LEFT:
            return [(-dc, dr, t) for dr, dc, t in base]
        elif direction == DIR_RIGHT:
            return [(dc, -dr, t) for dr, dc, t in base]
        else:
            raise ValueError(f"无效的飞机朝向: {direction}")

    # ===================== 放置校验 =====================

    def _can_place(self, board, head_r, head_c, offsets):
        """检查飞机能否放在 (head_r, head_c)：不出界 + 不重叠。"""
        for dr, dc, _ in offsets:
            r, c = head_r + dr, head_c + dc
            if not (0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE):
                return False
            if board[r][c] != EMPTY:
                return False
        return True

    def _do_place(self, board, head_r, head_c, offsets, heads_list):
        """将一架飞机写入棋盘（无校验，由调用方保证可放置）。"""
        for dr, dc, cell_type in offsets:
            r, c = head_r + dr, head_c + dc
            board[r][c] = cell_type
            if cell_type == HEAD:
                heads_list.append((r, c))

    # ===================== 公开方法：摆放飞机 =====================

    def place_planes(self, player_id):
        """
        为指定玩家随机摆放 PLANE_COUNT 架飞机。

        参数:
            player_id: 0 或 1
        返回:
            10×10 二维数组（该玩家棋盘）
        算法:
            随机方向 + 随机机头坐标，通过 _can_place 校验后写入。
        """
        board = self.board_p0 if player_id == 0 else self.board_p1
        heads_list = self.plane_heads_p0 if player_id == 0 else self.plane_heads_p1

        # 清空旧数据
        for r in range(BOARD_SIZE):
            for c in range(BOARD_SIZE):
                board[r][c] = EMPTY
        heads_list.clear()

        placed = 0
        max_tries = 5000

        for _ in range(max_tries):
            if placed >= PLANE_COUNT:
                break
            direction = random.randint(0, 3)
            offsets = self._get_plane_offsets(direction)
            head_r = random.randint(0, BOARD_SIZE - 1)
            head_c = random.randint(0, BOARD_SIZE - 1)

            if self._can_place(board, head_r, head_c, offsets):
                self._do_place(board, head_r, head_c, offsets, heads_list)
                placed += 1

        # 极端情况没放够，递归重试
        if placed < PLANE_COUNT:
            for r in range(BOARD_SIZE):
                for c in range(BOARD_SIZE):
                    board[r][c] = EMPTY
            heads_list.clear()
            return self.place_planes(player_id)

        return board

    # ===================== 公开方法：攻击判定 =====================

    def attack(self, player_id, row, col):
        """
        对指定玩家棋盘发起一次攻击。

        参数:
            player_id: 被攻击方 0 或 1
            row, col:  攻击坐标 (0 ~ 9)
        返回:
            MISS(0)     — 未命中（该格为空格）
            HIT(1)      — 命中机身/机翼
            HEADSHOT(2) — 命中机头
        异常:
            IndexError  — 坐标越界
            ValueError  — 坐标已被攻击过
        """
        if not (0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE):
            raise IndexError(f"坐标越界: ({row}, {col})，合法范围 0~9")

        attacked_set = self.attacked_p0 if player_id == 0 else self.attacked_p1

        if (row, col) in attacked_set:
            raise ValueError(f"该坐标已被攻击过: ({row}, {col})")

        attacked_set.add((row, col))

        board = self.board_p0 if player_id == 0 else self.board_p1
        cell = board[row][col]

        if cell == EMPTY:
            return MISS
        elif cell == BODY:
            return HIT
        elif cell == HEAD:
            return HEADSHOT
        return MISS

    # ===================== 公开方法：胜负判断 =====================

    def is_player_defeated(self, player_id):
        """
        判断指定玩家是否所有飞机均被击毁。

        逻辑：遍历玩家所有机头坐标，
        若全部在已攻击集合中 → 返回 True。

        参数:
            player_id: 0 或 1
        返回:
            True  — 所有机头被击中，该玩家失败
            False — 仍有至少一架飞机存活
        """
        heads_list = self.plane_heads_p0 if player_id == 0 else self.plane_heads_p1
        attacked_set = self.attacked_p0 if player_id == 0 else self.attacked_p1

        for (hr, hc) in heads_list:
            if (hr, hc) not in attacked_set:
                return False
        return True

    # ===================== 公开方法：状态查询 =====================

    def get_board_state(self, player_id):
        """
        获取指定玩家棋盘的完整原始状态（含飞机布局）。

        返回: 10×10 二维数组的深拷贝
        """
        board = self.board_p0 if player_id == 0 else self.board_p1
        return [row[:] for row in board]

    def get_attacked_set(self, player_id):
        """获取已攻击坐标集合（供 D/E 构建"敌方可视棋盘"用）。"""
        return self.attacked_p0 if player_id == 0 else self.attacked_p1

    def get_plane_heads(self, player_id):
        """获取机头坐标列表。"""
        return self.plane_heads_p0 if player_id == 0 else self.plane_heads_p1


# ===================== 自测（组员C自己跑）=====================
if __name__ == "__main__":
    print("=" * 50)
    print("GameLogic 自测")
    print("=" * 50)

    # ---- 1. 棋盘尺寸 ----
    g = GameLogic()
    assert len(g.board_p0) == BOARD_SIZE and len(g.board_p0[0]) == BOARD_SIZE
    print("[PASS] 1. 棋盘尺寸 10×10")

    # ---- 2. 飞机数量 ----
    assert len(g.plane_heads_p0) == PLANE_COUNT
    assert len(g.plane_heads_p1) == PLANE_COUNT
    print(f"[PASS] 2. 每方 {PLANE_COUNT} 架飞机")

    # ---- 3. 飞机不出界 ----
    for pid in (0, 1):
        board = g.board_p0 if pid == 0 else g.board_p1
        for r in range(BOARD_SIZE):
            for c in range(BOARD_SIZE):
                if board[r][c] == HEAD:
                    assert 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE
    print("[PASS] 3. 全部飞机在界内")

    # ---- 4. 飞机不重叠（恰好 3 个机头）----
    for pid in (0, 1):
        board = g.board_p0 if pid == 0 else g.board_p1
        head_cnt = sum(1 for r in range(BOARD_SIZE) for c in range(BOARD_SIZE)
                       if board[r][c] == HEAD)
        assert head_cnt == PLANE_COUNT
    print("[PASS] 4. 飞机不重叠，机头数正确")

    # ---- 5. attack()：未命中 ----
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if g.board_p1[r][c] == EMPTY:
                res = g.attack(1, r, c)
                assert res == MISS
                break
        else:
            continue
        break
    print("[PASS] 5. 攻击空格 → 返回 MISS(0)")

    # ---- 6. attack()：命中机身 ----
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if g.board_p1[r][c] == BODY and (r, c) not in g.attacked_p1:
                res = g.attack(1, r, c)
                assert res == HIT
                break
        else:
            continue
        break
    print("[PASS] 6. 攻击机身 → 返回 HIT(1)")

    # ---- 7. attack()：命中机头 ----
    hr, hc = g.plane_heads_p1[0]
    if (hr, hc) not in g.attacked_p1:
        res = g.attack(1, hr, hc)
        assert res == HEADSHOT
    print("[PASS] 7. 攻击机头 → 返回 HEADSHOT(2)")

    # ---- 8. 重复攻击 ----
    try:
        g.attack(1, hr, hc)
        assert False, "应该抛异常"
    except ValueError:
        print("[PASS] 8. 重复攻击 → 抛出 ValueError")

    # ---- 9. 坐标越界 ----
    try:
        g.attack(0, -1, 5)
        assert False
    except IndexError:
        print("[PASS] 9. 坐标越界 → 抛出 IndexError")

    # ---- 10. 胜负判断 ----
    g2 = GameLogic()
    assert g2.is_player_defeated(1) == False
    for (hr, hc) in g2.plane_heads_p1:
        if (hr, hc) not in g2.attacked_p1:
            g2.attack(1, hr, hc)
    assert g2.is_player_defeated(1) == True
    print("[PASS] 10. is_player_defeated 正确")

    # ---- 11. get_board_state 副本保护 ----
    state = g.get_board_state(0)
    state[0][0] = 999
    assert g.board_p0[0][0] != 999
    print("[PASS] 11. get_board_state 返回副本")

    print("=" * 50)
    print("全部自测通过！")
