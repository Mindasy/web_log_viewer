#!/usr/bin/env bash
# source_samples.sh — 源码关联测试数据（生成/校验/清理）
# 生成 test/samples/source_link/mini_cpp_demo/ 样例项目：
#   - 源码白名单文件（.cpp/.h，与 generate_mini_cpp_demo_log.py 的 source 行号对应）
#   - 依赖/产物/配置/文档等应被排除的文件（node_modules/build/.git/config/README）
# 由 generate_samples.sh source 使用

SRC_DIR="$SAMPLES_DIR/source_link/mini_cpp_demo"

# ===== 校验 =====
validate_source_samples() {
  local ok=true
  for f in "$SRC_DIR/src/main.cpp" "$SRC_DIR/src/http.cpp" "$SRC_DIR/src/order.cpp" \
           "$SRC_DIR/src/cache.cpp" "$SRC_DIR/src/db.cpp" "$SRC_DIR/include/order.h" \
           "$SRC_DIR/node_modules/fake-lib/index.js" "$SRC_DIR/build/main.o" \
           "$SRC_DIR/.git/config" "$SRC_DIR/config/app.ini" "$SRC_DIR/README.md"; do
    if [ ! -f "$f" ]; then
      echo "  缺少源码关联数据: $f"
      ok=false
    fi
  done
  $ok && return 0 || return 1
}

# ===== 清理 =====
clean_source_samples() {
  if [ -d "$SAMPLES_DIR/source_link" ]; then
    rm -rf "$SAMPLES_DIR/source_link"
    echo "  删除源码关联测试数据目录"
  fi
}

# ===== 生成 =====
do_generate_source() {
  mkdir -p "$SRC_DIR/src" "$SRC_DIR/include" \
           "$SRC_DIR/node_modules/fake-lib" "$SRC_DIR/build" \
           "$SRC_DIR/.git" "$SRC_DIR/config"

  echo "生成源码关联样例 mini_cpp_demo/src/main.cpp..."
  cat > "$SRC_DIR/src/main.cpp" << 'EOF'
#include <iostream>
#include <cstdio>

// mini_cpp_demo 入口源码

using namespace std;

void initServer();
void shutdown();
int main() {
    printf("server loop iteration\n");
    initServer();
    handleRequest();
    shutdown();
    return 0;
}

void initServer() {
    printf("initializing server\n");
    dbConnect("localhost");
}

void shutdown() {
    printf("shutting down\n");
    dbClose();
}

void handleRequest() {
    parseRequestLine("GET /order/42");
    checkVersion("HTTP/1.1");
    parseHeaders("Host: localhost");
    getOrder(42);
}
EOF

  echo "生成源码关联样例 mini_cpp_demo/src/http.cpp..."
  cat > "$SRC_DIR/src/http.cpp" << 'EOF'
#include "http.h"

// HTTP 处理
using namespace std;

int parseRequestLine(const char* line) {
    printf("parse %s\n", line);
    return 0;
}

int checkVersion(const char* v) {
    printf("version %s\n", v);
    return 0;
}

int parseHeaders(const char* buf) {
    printf("headers %s\n", buf);
    return 0;
}
EOF

  echo "生成源码关联样例 mini_cpp_demo/src/order.cpp..."
  cat > "$SRC_DIR/src/order.cpp" << 'EOF'
#include "order.h"

// 订单模块
using namespace std;

// 缓存查找
int lookupCache(const char* key) {
    printf("cache lookup %s\n", key);
    return 0;
}

// 数据库查询
int lookupDb(const char* sql) {
    printf("db query %s\n", sql);
    return 0;
}

// 从缓存取订单，未命中时回源数据库
int getOrder(int id) {
    char buf[32];
    snprintf(buf, sizeof(buf), "order:%d", id);
    if (lookupCache(buf) == 0) {
        return 0;
    }
    return lookupDb(buf);
}

// 优先查缓存
int orderFromCache(int id) {
    return getOrder(id);
}

// 直接查数据库
int orderFromDb(int id) {
    return lookupDb("select * from orders");
}
EOF

  echo "生成源码关联样例 mini_cpp_demo/src/cache.cpp..."
  cat > "$SRC_DIR/src/cache.cpp" << 'EOF'
#include "cache.h"

// 缓存模块
using namespace std;

int cacheGet(const char* key) {
    printf("cache get %s\n", key);
    return 0;
}

int cacheSet(const char* key) {
    printf("cache set %s\n", key);
    return 0;
}
EOF

  echo "生成源码关联样例 mini_cpp_demo/src/db.cpp..."
  cat > "$SRC_DIR/src/db.cpp" << 'EOF'
#include "db.h"

// 数据库模块
using namespace std;

int dbConnect(const char* host) {
    printf("connect %s\n", host);
    return 0;
}

int dbQuery(const char* sql) {
    printf("query %s\n", sql);
    return 0;
}

int dbClose(void) {
    printf("close\n");
    return 0;
}
EOF

  echo "生成源码关联样例 mini_cpp_demo/include/order.h..."
  cat > "$SRC_DIR/include/order.h" << 'EOF'
#ifndef ORDER_H
#define ORDER_H

int getOrder(int id);
int orderFromCache(int id);
int orderFromDb(int id);

#endif
EOF

  # ---- 以下为「应被排除」的文件（依赖 / 构建产物 / VCS / 配置 / 文档）----
  echo "生成应排除的样例文件（node_modules / build / .git / config / README）..."
  cat > "$SRC_DIR/node_modules/fake-lib/index.js" << 'EOF'
module.exports = { hello: 'world' };
EOF

  printf 'ELF fake object (should be excluded)\n' > "$SRC_DIR/build/main.o"

  cat > "$SRC_DIR/.git/config" << 'EOF'
[core]
	repositoryformatversion = 0
EOF

  cat > "$SRC_DIR/config/app.ini" << 'EOF'
[app]
name = mini_cpp_demo
EOF

  cat > "$SRC_DIR/README.md" << 'EOF'
# mini_cpp_demo

示例项目，用于源码关联功能测试。
EOF
}
