/**
 * local_game.h — 本地双人对战服务（C++ 版本）
 * =============================================
 * 依赖：core/game_logic.h（强依赖）
 *       third_party/httplib.h（cpp-httplib，单头文件 HTTP 库）
 *       third_party/nlohmann/json.hpp（nlohmann/json，单头文件 JSON 库）
 *
 * 职责：回合控制 / HTTP 通信 / 调用核心逻辑 / 托管前端静态文件。
 * 禁止：重复实现飞机摆放、攻击判定（必须用核心逻辑的方法）。
 *
 * 启动方式：
 *   ./local_game
 *   → 浏览器打开 http://localhost:5000
 */

#pragma once

#include "core/game_logic.h"

#include <memory>
#include <string>
#include <vector>


// ===================== LocalGame：回合管理 =====================

/**
 * @brief 本地双人对战服务 —— 回合管理 + 调用 GameLogic。
 */
class LocalGame {
public:
    LocalGame();

    /**
     * @brief 处理一次攻击请求。
     * @param attackingPlayer 攻击方 0 或 1
     * @param row             攻击行
     * @param col             攻击列
     * @return JSON 字符串，供前端渲染
     */
    std::string handleAttack(int attackingPlayer, int row, int col);

    /**
     * @brief 获取指定玩家视角的游戏状态（JSON 字符串）。
     * @param playerId 0 或 1
     */
    std::string getState(int playerId = 0) const;

    /**
     * @brief 重置游戏。
     */
    void restart();

private:
    std::unique_ptr<GameLogic> logic_;
    int  currentTurn_;
    bool gameOver_;
    int  winner_;     ///< -1 = 无赢家（游戏进行中）

    /**
     * @brief 构建敌方可视棋盘：已攻击格显示实际值，未攻击格显示 -1。
     */
    GameLogic::Board buildVisibleBoard(int playerId) const;

    /**
     * @brief 统计剩余存活飞机数（机头未被命中 = 存活）。
     */
    int countAlivePlanes(int playerId) const;

    /** @brief 构造错误响应 JSON 字符串。 */
    static std::string errorJson(const std::string& msg);
};
