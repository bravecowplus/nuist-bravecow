cmake_minimum_required(VERSION 3.16)
project(PlaneGame CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ===================== 包含目录 =====================
# third_party/ 下放置 httplib.h 和 nlohmann/json.hpp
include_directories(
    ${CMAKE_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third_party
)

# ===================== 主可执行文件：local_game =====================
add_executable(local_game
    core/game_logic.cpp
    local_game.cpp
)

# cpp-httplib 在 Windows 上需要链接 ws2_32 和 wsock32
if(WIN32)
    target_link_libraries(local_game PRIVATE ws2_32 wsock32)
endif()

# ===================== 自测可执行文件：game_logic_test =====================
add_executable(game_logic_test
    core/game_logic.cpp
)
target_compile_definitions(game_logic_test PRIVATE GAME_LOGIC_SELF_TEST)
