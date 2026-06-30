/**
 * core/game_logic.h — 飞机对战游戏核心逻辑（C++ 版本）
 * ======================================================
 * 依赖：无（仅使用标准库 <vector> <set> <stdexcept> <cstdlib>）
 *
 * 本模块提供纯底层能力：
 *   - 10×10 棋盘初始化
 *   - 1513 飞机坐标 + 随机摆放（4 种朝向）
 *   - 攻击判定：0=未命中 / 1=命中机身 / 2=命中机头
 *   - 重复攻击拦截
 *   - 胜负判断（全部机头被击毁）
 *   - 棋盘状态查询
 *
 * 禁止：操作界面、处理网络、控制回合。
 */

#pragma once

#include <vector>
#include <set>
#include <stdexcept>
#include <string>
#include <tuple>

// ===================== 常量 =====================

constexpr int BOARD_SIZE  = 10;   ///< 棋盘 10×10
constexpr int PLANE_COUNT = 3;    ///< 每方 3 架飞机

/// 格子状态码（棋盘上的值）
constexpr int EMPTY = 0;
constexpr int BODY  = 1;
constexpr int HEAD  = 2;

/// 攻击结果码（attack() 返回值）
constexpr int MISS     = 0;   ///< 未命中
constexpr int HIT      = 1;   ///< 命中机身/机翼
constexpr int HEADSHOT = 2;   ///< 命中机头

/// 飞机朝向
constexpr int DIR_UP    = 0;
constexpr int DIR_DOWN  = 1;
constexpr int DIR_LEFT  = 2;
constexpr int DIR_RIGHT = 3;


/**
 * @brief 飞机对战游戏核心逻辑类
 *
 * 用法（供其他文件调用）:
 * @code
 *   GameLogic game;
 *   int result = game.attack(1, 3, 5);
 *   if (game.isPlayerDefeated(1)) {
 *       std::cout << "玩家1失败\n";
 *   }
 * @endcode
 */
class GameLogic {
public:
    // ---- 公开数据类型 ----
    using Board   = std::vector<std::vector<int>>;
    using HeadSet = std::set<std::pair<int,int>>;
    using PosVec  = std::vector<std::pair<int,int>>;

    // ---- 内部偏移描述 ----
    struct Offset { int dr, dc, type; };

    // ===================== 初始化 =====================

    /**
     * @brief 创建两个 10×10 空棋盘，自动随机摆放飞机。
     */
    GameLogic();

    // ===================== 公开方法：摆放飞机 =====================

    /**
     * @brief 为指定玩家随机摆放 PLANE_COUNT 架飞机。
     * @param playerId  0 或 1
     * @return 该玩家的 10×10 二维棋盘（引用，可忽略）
     */
    Board& placePlanes(int playerId);

    // ===================== 公开方法：攻击判定 =====================

    /**
     * @brief 对指定玩家棋盘发起一次攻击。
     * @param playerId  被攻击方 0 或 1
     * @param row       攻击行 (0~9)
     * @param col       攻击列 (0~9)
     * @return MISS(0) / HIT(1) / HEADSHOT(2)
     * @throws std::out_of_range  坐标越界
     * @throws std::invalid_argument  坐标已被攻击
     */
    int attack(int playerId, int row, int col);

    // ===================== 公开方法：胜负判断 =====================

    /**
     * @brief 判断指定玩家是否所有飞机均被击毁。
     * @param playerId  0 或 1
     * @return true = 所有机头被击中（失败），false = 仍有存活飞机
     */
    bool isPlayerDefeated(int playerId) const;

    // ===================== 公开方法：状态查询 =====================

    /** @brief 获取指定玩家棋盘的完整原始状态（深拷贝）。 */
    Board getBoardState(int playerId) const;

    /** @brief 获取已攻击坐标集合（供构建"敌方可视棋盘"用）。 */
    const HeadSet& getAttackedSet(int playerId) const;

    /** @brief 获取机头坐标列表。 */
    const PosVec& getPlaneHeads(int playerId) const;

    // ---- 原始棋盘（供外部直接读取，只读）----
    const Board& boardP0() const { return board_p0_; }
    const Board& boardP1() const { return board_p1_; }

private:
    // ===================== 内部状态 =====================

    Board board_p0_;
    Board board_p1_;

    HeadSet attacked_p0_;
    HeadSet attacked_p1_;

    PosVec plane_heads_p0_;
    PosVec plane_heads_p1_;

    // ===================== 内部方法 =====================

    /**
     * @brief 获取飞机各部件相对机头的偏移量（1513 规则）。
     * @param direction DIR_UP/DOWN/LEFT/RIGHT
     * @return 偏移列表（每项含 dr, dc, type）
     */
    static std::vector<Offset> getPlaneOffsets(int direction);

    /**
     * @brief 检查飞机能否放在 (headR, headC)：不出界 + 不重叠。
     */
    static bool canPlace(const Board& board, int headR, int headC,
                         const std::vector<Offset>& offsets);

    /**
     * @brief 将一架飞机写入棋盘（无校验，由调用方保证可放置）。
     */
    static void doPlace(Board& board, int headR, int headC,
                        const std::vector<Offset>& offsets,
                        PosVec& headsList);

    /** @brief 根据 playerId 返回对应棋盘的可变引用。 */
    Board& boardOf(int playerId);

    /** @brief 根据 playerId 返回对应棋盘的常量引用。 */
    const Board& boardOf(int playerId) const;

    /** @brief 根据 playerId 返回对应已攻击集合。 */
    HeadSet& attackedOf(int playerId);
    const HeadSet& attackedOf(int playerId) const;

    /** @brief 根据 playerId 返回对应机头列表。 */
    PosVec& headsOf(int playerId);
    const PosVec& headsOf(int playerId) const;
};
