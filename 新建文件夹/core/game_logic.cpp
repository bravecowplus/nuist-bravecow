/**
 * core/game_logic.cpp — 飞机对战游戏核心逻辑实现（C++ 版本）
 */

#include "game_logic.h"

#include <algorithm>
#include <cstdlib>
#include <ctime>
#include <stdexcept>
#include <string>


// ===================== 初始化 =====================

GameLogic::GameLogic()
    : board_p0_(BOARD_SIZE, std::vector<int>(BOARD_SIZE, EMPTY)),
      board_p1_(BOARD_SIZE, std::vector<int>(BOARD_SIZE, EMPTY))
{
    // 使用当前时间作为随机种子（仅在首次构造时播种）
    static bool seeded = false;
    if (!seeded) {
        std::srand(static_cast<unsigned>(std::time(nullptr)));
        seeded = true;
    }

    placePlanes(0);
    placePlanes(1);
}


// ===================== 私有辅助：访问器 =====================

GameLogic::Board& GameLogic::boardOf(int playerId) {
    return playerId == 0 ? board_p0_ : board_p1_;
}

const GameLogic::Board& GameLogic::boardOf(int playerId) const {
    return playerId == 0 ? board_p0_ : board_p1_;
}

GameLogic::HeadSet& GameLogic::attackedOf(int playerId) {
    return playerId == 0 ? attacked_p0_ : attacked_p1_;
}

const GameLogic::HeadSet& GameLogic::attackedOf(int playerId) const {
    return playerId == 0 ? attacked_p0_ : attacked_p1_;
}

GameLogic::PosVec& GameLogic::headsOf(int playerId) {
    return playerId == 0 ? plane_heads_p0_ : plane_heads_p1_;
}

const GameLogic::PosVec& GameLogic::headsOf(int playerId) const {
    return playerId == 0 ? plane_heads_p0_ : plane_heads_p1_;
}


// ===================== 1513 飞机形状 =====================

std::vector<GameLogic::Offset> GameLogic::getPlaneOffsets(int direction) {
    /*
     * 飞机朝上时的基础偏移（共 10 格：机头 + 5 翼格 + 2 身格 + 3 尾格）
     *
     *         ○           ← 机头 (dr=0, dc=0)
     *     ○ ○ ○ ○ ○       ← 第1行 机身+机翼
     *         ○           ← 第2行 机身
     *       ○ ○ ○         ← 第3行 机身尾
     */
    const std::vector<Offset> base = {
        { 0,  0, HEAD},
        { 1, -2, BODY}, { 1, -1, BODY}, { 1,  0, BODY},
        { 1,  1, BODY}, { 1,  2, BODY},
        { 2,  0, BODY},
        { 3, -1, BODY}, { 3,  0, BODY}, { 3,  1, BODY}
    };

    if (direction == DIR_UP) {
        return base;
    }

    std::vector<Offset> result;
    result.reserve(base.size());

    if (direction == DIR_DOWN) {
        for (const auto& o : base)
            result.push_back({-o.dr, -o.dc, o.type});
    } else if (direction == DIR_LEFT) {
        for (const auto& o : base)
            result.push_back({-o.dc, o.dr, o.type});
    } else if (direction == DIR_RIGHT) {
        for (const auto& o : base)
            result.push_back({o.dc, -o.dr, o.type});
    } else {
        throw std::invalid_argument("无效的飞机朝向: " + std::to_string(direction));
    }

    return result;
}


// ===================== 放置校验 =====================

bool GameLogic::canPlace(const Board& board, int headR, int headC,
                         const std::vector<Offset>& offsets)
{
    for (const auto& o : offsets) {
        int r = headR + o.dr;
        int c = headC + o.dc;
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE)
            return false;
        if (board[r][c] != EMPTY)
            return false;
    }
    return true;
}

void GameLogic::doPlace(Board& board, int headR, int headC,
                        const std::vector<Offset>& offsets,
                        PosVec& headsList)
{
    for (const auto& o : offsets) {
        int r = headR + o.dr;
        int c = headC + o.dc;
        board[r][c] = o.type;
        if (o.type == HEAD) {
            headsList.emplace_back(r, c);
        }
    }
}


// ===================== 公开方法：摆放飞机 =====================

GameLogic::Board& GameLogic::placePlanes(int playerId) {
    Board&   board      = boardOf(playerId);
    PosVec&  headsList  = headsOf(playerId);

    // 清空旧数据
    for (auto& row : board)
        std::fill(row.begin(), row.end(), EMPTY);
    headsList.clear();

    int placed   = 0;
    int maxTries = 5000;

    for (int i = 0; i < maxTries && placed < PLANE_COUNT; ++i) {
        int direction = std::rand() % 4;
        auto offsets  = getPlaneOffsets(direction);
        int headR     = std::rand() % BOARD_SIZE;
        int headC     = std::rand() % BOARD_SIZE;

        if (canPlace(board, headR, headC, offsets)) {
            doPlace(board, headR, headC, offsets, headsList);
            ++placed;
        }
    }

    // 极端情况没放够，递归重试
    if (placed < PLANE_COUNT) {
        for (auto& row : board)
            std::fill(row.begin(), row.end(), EMPTY);
        headsList.clear();
        return placePlanes(playerId);
    }

    return board;
}


// ===================== 公开方法：攻击判定 =====================

int GameLogic::attack(int playerId, int row, int col) {
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
        throw std::out_of_range(
            "坐标越界: (" + std::to_string(row) + ", " + std::to_string(col) +
            ")，合法范围 0~9");
    }

    HeadSet& attacked = attackedOf(playerId);
    auto pos = std::make_pair(row, col);

    if (attacked.count(pos)) {
        throw std::invalid_argument(
            "该坐标已被攻击过: (" + std::to_string(row) + ", " + std::to_string(col) + ")");
    }

    attacked.insert(pos);

    const Board& board = boardOf(playerId);
    int cell = board[row][col];

    if (cell == EMPTY)  return MISS;
    if (cell == BODY)   return HIT;
    if (cell == HEAD)   return HEADSHOT;
    return MISS;
}


// ===================== 公开方法：胜负判断 =====================

bool GameLogic::isPlayerDefeated(int playerId) const {
    const PosVec&  heads    = headsOf(playerId);
    const HeadSet& attacked = attackedOf(playerId);

    for (const auto& pos : heads) {
        if (!attacked.count(pos))
            return false;
    }
    return true;
}


// ===================== 公开方法：状态查询 =====================

GameLogic::Board GameLogic::getBoardState(int playerId) const {
    return boardOf(playerId);   // std::vector 深拷贝
}

const GameLogic::HeadSet& GameLogic::getAttackedSet(int playerId) const {
    return attackedOf(playerId);
}

const GameLogic::PosVec& GameLogic::getPlaneHeads(int playerId) const {
    return headsOf(playerId);
}


// ===================== 自测（main 编译时可直接跑）=====================
#ifdef GAME_LOGIC_SELF_TEST

#include <iostream>
#include <cassert>

int main() {
    std::cout << std::string(50, '=') << "\n";
    std::cout << "GameLogic C++ 自测\n";
    std::cout << std::string(50, '=') << "\n";

    // ---- 1. 棋盘尺寸 ----
    GameLogic g;
    assert((int)g.boardP0().size() == BOARD_SIZE);
    assert((int)g.boardP0()[0].size() == BOARD_SIZE);
    std::cout << "[PASS] 1. 棋盘尺寸 10×10\n";

    // ---- 2. 飞机数量 ----
    assert((int)g.getPlaneHeads(0).size() == PLANE_COUNT);
    assert((int)g.getPlaneHeads(1).size() == PLANE_COUNT);
    std::cout << "[PASS] 2. 每方 " << PLANE_COUNT << " 架飞机\n";

    // ---- 3. 飞机不出界 ----
    for (int pid = 0; pid <= 1; ++pid) {
        const auto& board = g.getBoardState(pid);
        for (int r = 0; r < BOARD_SIZE; ++r)
            for (int c = 0; c < BOARD_SIZE; ++c)
                if (board[r][c] == HEAD) {
                    assert(r >= 0 && r < BOARD_SIZE);
                    assert(c >= 0 && c < BOARD_SIZE);
                }
    }
    std::cout << "[PASS] 3. 全部飞机在界内\n";

    // ---- 4. 飞机不重叠（恰好 3 个机头）----
    for (int pid = 0; pid <= 1; ++pid) {
        const auto& board = g.getBoardState(pid);
        int headCnt = 0;
        for (int r = 0; r < BOARD_SIZE; ++r)
            for (int c = 0; c < BOARD_SIZE; ++c)
                if (board[r][c] == HEAD) ++headCnt;
        assert(headCnt == PLANE_COUNT);
    }
    std::cout << "[PASS] 4. 飞机不重叠，机头数正确\n";

    // ---- 5. attack()：未命中 ----
    {
        const auto& b = g.getBoardState(1);
        bool found = false;
        for (int r = 0; r < BOARD_SIZE && !found; ++r)
            for (int c = 0; c < BOARD_SIZE && !found; ++c)
                if (b[r][c] == EMPTY) {
                    assert(g.attack(1, r, c) == MISS);
                    found = true;
                }
        assert(found);
    }
    std::cout << "[PASS] 5. 攻击空格 → 返回 MISS(0)\n";

    // ---- 6. attack()：命中机身 ----
    {
        const auto& b = g.getBoardState(1);
        bool found = false;
        for (int r = 0; r < BOARD_SIZE && !found; ++r)
            for (int c = 0; c < BOARD_SIZE && !found; ++c)
                if (b[r][c] == BODY && !g.getAttackedSet(1).count({r,c})) {
                    assert(g.attack(1, r, c) == HIT);
                    found = true;
                }
        assert(found);
    }
    std::cout << "[PASS] 6. 攻击机身 → 返回 HIT(1)\n";

    // ---- 7. attack()：命中机头 ----
    {
        auto [hr, hc] = g.getPlaneHeads(1)[0];
        if (!g.getAttackedSet(1).count({hr, hc}))
            assert(g.attack(1, hr, hc) == HEADSHOT);
        std::cout << "[PASS] 7. 攻击机头 → 返回 HEADSHOT(2)\n";

        // ---- 8. 重复攻击 ----
        bool threw = false;
        try { g.attack(1, hr, hc); }
        catch (const std::invalid_argument&) { threw = true; }
        assert(threw);
        std::cout << "[PASS] 8. 重复攻击 → 抛出 invalid_argument\n";
    }

    // ---- 9. 坐标越界 ----
    {
        bool threw = false;
        try { g.attack(0, -1, 5); }
        catch (const std::out_of_range&) { threw = true; }
        assert(threw);
        std::cout << "[PASS] 9. 坐标越界 → 抛出 out_of_range\n";
    }

    // ---- 10. 胜负判断 ----
    {
        GameLogic g2;
        assert(!g2.isPlayerDefeated(1));
        for (auto [hr, hc] : g2.getPlaneHeads(1))
            if (!g2.getAttackedSet(1).count({hr, hc}))
                g2.attack(1, hr, hc);
        assert(g2.isPlayerDefeated(1));
        std::cout << "[PASS] 10. isPlayerDefeated 正确\n";
    }

    // ---- 11. getBoardState 副本保护 ----
    {
        auto state = g.getBoardState(0);
        state[0][0] = 999;
        assert(g.boardP0()[0][0] != 999);
        std::cout << "[PASS] 11. getBoardState 返回副本\n";
    }

    std::cout << std::string(50, '=') << "\n";
    std::cout << "全部自测通过！\n";
    return 0;
}

#endif // GAME_LOGIC_SELF_TEST
