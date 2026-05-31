# -*- coding: utf-8 -*-
import random

# 棋盘固定尺寸
BOARD_SIZE = 10

# 原始1513飞机相对坐标（机头朝右 基准方向）
BASE_PLANE = [
    (0, 0),   # 机头
    (1, 0), (2, 0), (3, 0),  # 机身3格
    (1, -1),(1,-2),  # 左翼2格
    (1, 1), (1, 2),  # 右翼2格
    (3,-1),(3,1)  #尾翼
]

# 四个朝向：0=朝右  1=朝下  2=朝左  3=朝上
# 坐标旋转规则：实现飞机整体转向
DIRECTION_COUNT = 4


class GameLogic:
    def __init__(self):
        # 10*10棋盘：0=空地，1=飞机格子
        self.board = [[0 for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]
        # 当前飞机所有绝对坐标
        self.plane_points = []
        # 已被攻击的坐标集合
        self.hit_points = set()

        # 手动摆放新增变量
        self.head_x = 0       # 机头行坐标
        self.head_y = 0       # 机头列坐标
        self.direction = 0    # 当前朝向，默认朝右

    def is_in_board(self, x: int, y: int) -> bool:
        """校验坐标是否在10*10棋盘内"""
        return 0 <= x < BOARD_SIZE and 0 <= y < BOARD_SIZE

    def _rotate_point(self, dx: int, dy: int, dire: int) -> tuple[int, int]:
        """
        单个相对坐标按朝向旋转
        :param dx: 原始相对行偏移
        :param dy: 原始相对列偏移
        :param dire: 目标朝向 0/1/2/3
        :return: 旋转后的偏移坐标
        """
        if dire == 0:
            # 朝右（原始方向）
            return dx, dy
        elif dire == 1:
            # 朝下
            return dy, -dx
        elif dire == 2:
            # 朝左
            return -dx, -dy
        else:
            # 朝上
            return -dy, dx

    def _calc_plane_points(self) -> list[tuple[int, int]]:
        """根据机头坐标+当前朝向，计算整架飞机绝对坐标"""
        plane = []
        for dx, dy in BASE_PLANE:
            rx, ry = self._rotate_point(dx, dy, self.direction)
            abs_x = self.head_x + rx
            abs_y = self.head_y + ry
            plane.append((abs_x, abs_y))
        return plane

    def check_plane_valid(self) -> bool:
        """
        检查当前机头+朝向的飞机是否完全在棋盘内
        摆放前调用，判断位置是否合法
        """
        points = self._calc_plane_points()
        for x, y in points:
            if not self.is_in_board(x, y):
                return False
        return True

    def set_head_pos(self, x: int, y: int) -> bool:
        """
        手动设置机头坐标
        :param x: 机头行
        :param y: 机头列
        :return: True=设置成功，False=坐标越界
        """
        if not self.is_in_board(x, y):
            return False
        self.head_x = x
        self.head_y = y
        return True

    def turn_next_direction(self):
        """切换到下一个朝向（循环：右→下→左→上→右...）"""
        self.direction = (self.direction + 1) % DIRECTION_COUNT

    def refresh_plane(self) -> bool:
        """
        根据当前机头+朝向，刷新棋盘上的飞机
        :return: True=摆放成功，False=飞机出界无法摆放
        """
        # 先清空旧飞机
        for x, y in self.plane_points:
            self.board[x][y] = 0

        # 计算新点位并校验
        new_points = self._calc_plane_points()
        if not self.check_plane_valid():
            self.plane_points.clear()
            return False

        # 绘制新飞机
        for x, y in new_points:
            self.board[x][y] = 1
        self.plane_points = new_points
        return True

    # ========== 原有核心接口（完全不变，兼容D/E代码） ==========
    def put_plane_random(self):
        """保留原有随机摆放，兼容旧逻辑，可选使用"""
        while True:
            head_x = random.randint(0, BOARD_SIZE - 1)
            head_y = random.randint(0, BOARD_SIZE - 1)
            self.set_head_pos(head_x, head_y)
            self.direction = random.randint(0, 3)
            if self.refresh_plane():
                break

    def attack(self, x: int, y: int) -> int:
        """
        攻击判定
        return: -1重复攻击 | 0未命中 | 1普通击中 | 2命中机头
        """
        if (x, y) in self.hit_points:
            return -1
        self.hit_points.add((x, y))

        if (x, y) not in self.plane_points:
            return 0

        head_x, head_y = self.plane_points[0]
        if x == head_x and y == head_y:
            return 2
        return 1

    def is_plane_destroyed(self) -> bool:
        """判断飞机是否被完全击毁"""
        return set(self.plane_points[0]).issubset(self.hit_points)

    def reset_game(self):
        """重置游戏：清空飞机、攻击记录"""
        self.board = [[0]*BOARD_SIZE for _ in range(BOARD_SIZE)]
        self.plane_points.clear()
        self.hit_points.clear()
        self.head_x = 0
        self.head_y = 0
        self.direction = 0


# ==================== 自测代码 ====================
if __name__ == "__main__":
    game = GameLogic()

    # 1. 手动设置机头 (4,4)
    game.set_head_pos(4, 4)
    print(f"初始机头坐标：({game.head_x}, {game.head_y})，朝向：{game.direction}(朝右)")

    # 2. 刷新飞机
    if game.refresh_plane():
        print("飞机摆放成功，点位：", game.plane_points)
    else:
     print("位置非法，飞机出界！")

    # 3. 切换一次朝向
    game.turn_next_direction()
    print(f"\n切换朝向，当前朝向：{game.direction}(朝下)")
    game.refresh_plane()
    print("转向后飞机点位：", game.plane_points)

    # 4. 攻击测试
    head = game.plane_points[0]
    print(f"\n攻击机头{head}，结果：", game.attack(*head))
    print("飞机是否击毁：", game.is_plane_destroyed())
