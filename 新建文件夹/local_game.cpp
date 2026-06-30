/**
 * local_game.cpp — 本地双人对战服务实现（C++ 版本）
 *
 * 说明：
 *   HTTP 服务器使用 cpp-httplib（third_party/httplib.h），
 *   JSON 序列化使用 nlohmann/json（third_party/nlohmann/json.hpp）。
 *   两者均为单头文件、无需编译的开源库，需在编译前下载放置：
 *     third_party/httplib.h
 *     third_party/nlohmann/json.hpp
 */

#include "local_game.h"

// 第三方库（单头文件，需自行下载，详见 README_CPP.md）
#include "third_party/httplib.h"
#include "third_party/nlohmann/json.hpp"

#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <filesystem>

using json = nlohmann::json;
namespace fs = std::filesystem;


// ===================== LocalGame 实现 =====================

LocalGame::LocalGame()
    : logic_(std::make_unique<GameLogic>()),
      currentTurn_(0),
      gameOver_(false),
      winner_(-1)
{}

// ---- 内部辅助 ----

GameLogic::Board LocalGame::buildVisibleBoard(int playerId) const {
    auto realBoard = logic_->getBoardState(playerId);
    const auto& attacked = logic_->getAttackedSet(playerId);

    GameLogic::Board visible(BOARD_SIZE, std::vector<int>(BOARD_SIZE, -1));
    for (int r = 0; r < BOARD_SIZE; ++r)
        for (int c = 0; c < BOARD_SIZE; ++c)
            if (attacked.count({r, c}))
                visible[r][c] = realBoard[r][c];
    return visible;
}

int LocalGame::countAlivePlanes(int playerId) const {
    const auto& heads    = logic_->getPlaneHeads(playerId);
    const auto& attacked = logic_->getAttackedSet(playerId);
    int count = 0;
    for (const auto& pos : heads)
        if (!attacked.count(pos)) ++count;
    return count;
}

std::string LocalGame::errorJson(const std::string& msg) {
    json j;
    j["success"] = false;
    j["message"] = msg;
    return j.dump();
}

// ---- 攻击处理 ----

std::string LocalGame::handleAttack(int attackingPlayer, int row, int col) {
    if (gameOver_)
        return errorJson("游戏已结束，请重新开始");

    if (attackingPlayer != currentTurn_)
        return errorJson("还没轮到你！当前是玩家" +
                         std::to_string(currentTurn_ + 1) + "的回合");

    int targetPlayer = 1 - attackingPlayer;

    int result;
    try {
        result = logic_->attack(targetPlayer, row, col);
    } catch (const std::invalid_argument& e) {
        return errorJson(e.what());
    } catch (const std::out_of_range& e) {
        return errorJson(e.what());
    }

    std::string message;
    switch (result) {
        case MISS:     message = "未命中！";             break;
        case HIT:      message = "命中机身！";            break;
        case HEADSHOT: message = "命中机头！飞机击毁！";  break;
        default:       message = "未知结果";
    }

    bool isDefeated = logic_->isPlayerDefeated(targetPlayer);
    if (isDefeated) {
        gameOver_ = true;
        winner_   = attackingPlayer;
    }

    if (!gameOver_)
        currentTurn_ = targetPlayer;

    auto enemyBoard = buildVisibleBoard(targetPlayer);

    // 构造 your_board（二维数组）
    auto yourBoard = logic_->getBoardState(attackingPlayer);

    json resp;
    resp["success"]      = true;
    resp["result"]       = result;
    resp["message"]      = message;
    resp["current_turn"] = currentTurn_;
    resp["game_over"]    = gameOver_;
    resp["winner"]       = winner_;   // -1 表示无赢家

    // 二维数组 → JSON array
    json yourBoardJson = json::array();
    for (const auto& row_vec : yourBoard) {
        yourBoardJson.push_back(json(row_vec));
    }
    resp["your_board"] = yourBoardJson;

    json enemyBoardJson = json::array();
    for (const auto& row_vec : enemyBoard) {
        enemyBoardJson.push_back(json(row_vec));
    }
    resp["enemy_board"] = enemyBoardJson;

    resp["remaining_planes"] = {
        {"you",   countAlivePlanes(attackingPlayer)},
        {"enemy", countAlivePlanes(targetPlayer)}
    };

    return resp.dump();
}

// ---- 状态查询 ----

std::string LocalGame::getState(int playerId) const {
    int enemyId = 1 - playerId;

    auto yourBoard  = logic_->getBoardState(playerId);
    auto enemyBoard = buildVisibleBoard(enemyId);

    json yourBoardJson = json::array();
    for (const auto& row_vec : yourBoard)
        yourBoardJson.push_back(json(row_vec));

    json enemyBoardJson = json::array();
    for (const auto& row_vec : enemyBoard)
        enemyBoardJson.push_back(json(row_vec));

    json resp;
    resp["current_turn"] = currentTurn_;
    resp["game_over"]    = gameOver_;
    resp["winner"]       = winner_;
    resp["your_board"]   = yourBoardJson;
    resp["enemy_board"]  = enemyBoardJson;
    resp["remaining_planes"] = {
        {"you",   countAlivePlanes(playerId)},
        {"enemy", countAlivePlanes(enemyId)}
    };

    return resp.dump();
}

// ---- 重置 ----

void LocalGame::restart() {
    logic_       = std::make_unique<GameLogic>();
    currentTurn_ = 0;
    gameOver_    = false;
    winner_      = -1;
}


// ===================== HTTP 服务器（main 入口）=====================

/**
 * @brief 读取文件内容到字符串。
 * @return 文件内容；文件不存在时返回空字符串。
 */
static std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open()) return "";
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

/**
 * @brief 根据扩展名返回 MIME 类型字符串。
 */
static std::string mimeType(const std::string& path) {
    if (path.size() >= 5 && path.substr(path.size()-5) == ".html") return "text/html; charset=utf-8";
    if (path.size() >= 4 && path.substr(path.size()-4) == ".css")  return "text/css; charset=utf-8";
    if (path.size() >= 3 && path.substr(path.size()-3) == ".js")   return "application/javascript; charset=utf-8";
    return "application/octet-stream";
}

int main() {
    constexpr int PORT = 5000;

    // 静态文件目录（可执行文件同级下的 static/）
    fs::path exeDir   = fs::current_path();
    std::string staticDir = (exeDir / "static").string();

    // 全局游戏实例
    LocalGame game;

    httplib::Server svr;

    // ---- GET /state ----
    svr.Get("/state", [&game](const httplib::Request& req,
                               httplib::Response& res) {
        int playerId = 0;
        if (req.has_param("player")) {
            try { playerId = std::stoi(req.get_param_value("player")); }
            catch (...) {}
        }
        res.set_content(game.getState(playerId), "application/json; charset=utf-8");
    });

    // ---- GET / 及静态文件 ----
    auto serveStatic = [&staticDir](const std::string& filename,
                                    httplib::Response& res) {
        // 防止路径穿越：拒绝包含 ".." 的请求
        if (filename.find("..") != std::string::npos) {
            res.status = 403;
            res.set_content("403 Forbidden", "text/plain");
            return;
        }
        fs::path fullPath = fs::path(staticDir) / filename;
        std::string content = readFile(fullPath.string());
        if (content.empty()) {
            res.status = 404;
            res.set_content("404 Not Found", "text/plain");
            return;
        }
        res.set_content(content, mimeType(filename));
    };

    svr.Get("/",          [&serveStatic](const httplib::Request&, httplib::Response& res) {
        serveStatic("index.html", res); });
    svr.Get("/index.html",[&serveStatic](const httplib::Request&, httplib::Response& res) {
        serveStatic("index.html", res); });
    svr.Get("/style.css", [&serveStatic](const httplib::Request&, httplib::Response& res) {
        serveStatic("style.css", res); });
    svr.Get("/main.js",   [&serveStatic](const httplib::Request&, httplib::Response& res) {
        serveStatic("main.js", res); });
    svr.Get("/favicon.ico",[](const httplib::Request&, httplib::Response& res) {
        res.status = 204; });

    // ---- POST /attack ----
    svr.Post("/attack", [&game](const httplib::Request& req,
                                 httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            int player = body.value("player", 0);
            if (!body.contains("row") || !body.contains("col")) {
                json err; err["success"] = false; err["message"] = "缺少 row/col";
                res.status = 400;
                res.set_content(err.dump(), "application/json; charset=utf-8");
                return;
            }
            int row = body["row"].get<int>();
            int col = body["col"].get<int>();
            res.set_content(game.handleAttack(player, row, col),
                            "application/json; charset=utf-8");
        } catch (const json::parse_error&) {
            json err; err["success"] = false; err["message"] = "JSON 解析失败";
            res.status = 400;
            res.set_content(err.dump(), "application/json; charset=utf-8");
        }
    });

    // ---- POST /restart ----
    svr.Post("/restart", [&game](const httplib::Request&,
                                  httplib::Response& res) {
        game.restart();
        json ok; ok["success"] = true; ok["message"] = "游戏已重置";
        res.set_content(ok.dump(), "application/json; charset=utf-8");
    });

    // ---- 404 兜底 ----
    svr.set_error_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_content("404 Not Found", "text/plain");
    });

    // ---- 启动 ----
    std::cout << std::string(50, '=') << "\n";
    std::cout << "  本地对战服务已启动\n";
    std::cout << "  浏览器打开 -> http://localhost:" << PORT << "\n";
    std::cout << "  按 Ctrl+C 退出服务\n";
    std::cout << std::string(50, '=') << "\n";

    svr.listen("0.0.0.0", PORT);
    return 0;
}
