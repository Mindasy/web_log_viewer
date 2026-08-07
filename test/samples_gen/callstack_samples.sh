#!/usr/bin/env bash
# callstack_samples.sh — 调用栈测试数据（生成/校验/清理）
# 由 generate_samples.sh source 使用

CSTACK_DIR="$SAMPLES_DIR/callstack"

# ===== 校验 =====
validate_callstack_samples() {
  local ok=true
  for f in "$CSTACK_DIR/sample_cpp_src/server.cpp" "$CSTACK_DIR/sample_cpp_src/PaymentService.java" \
           "$CSTACK_DIR/cs_ability_test/ability.cpp" "$CSTACK_DIR/doxygen_demo/callgraph_main.dot" \
           "$CSTACK_DIR/perf_demo.script" "$CSTACK_DIR/callstack_demo.txt" \
           "$CSTACK_DIR/perf_callstack_demo.txt" "$CSTACK_DIR/doxygen_callstack_demo.txt"; do
    if [ ! -f "$f" ]; then
      echo "  缺少调用栈数据: $f"
      ok=false
    fi
  done
  $ok && return 0 || return 1
}

# ===== 清理 =====
clean_callstack_samples() {
  if [ -d "$CSTACK_DIR" ]; then
    rm -rf "$CSTACK_DIR"
    echo "  删除调用栈测试数据目录"
  fi
}

# ===== 生成 =====
do_generate_callstack() {
  mkdir -p "$CSTACK_DIR/sample_cpp_src" "$CSTACK_DIR/cs_ability_test" "$CSTACK_DIR/doxygen_demo"

  echo "生成调用栈测试源码 sample_cpp_src/server.cpp..."
  cat > "$CSTACK_DIR/sample_cpp_src/server.cpp" << 'EOF'
// 示例 C++ 源码 — 供 tools/callstack/extract_callstack.py 提取函数调用栈
#include <cstdio>

int connectDb(const char* host) {
    printf("connecting %s\n", host);
    return 0;
}

int queryDatabase(const char* sql) {
    int rc = connectDb("localhost");
    printf("query %s\n", sql);
    return rc;
}

int parseHeaders(const char* buf) {
    printf("parse %s\n", buf);
    return 0;
}

int sendResponse(const char* body) {
    printf("send %s\n", body);
    return 0;
}

int handleRequest(const char* req) {
    parseHeaders(req);
    queryDatabase("SELECT 1");
    sendResponse("ok");
    return 0;
}

int initLogger(void) {
    printf("logger ready\n");
    return 0;
}

int initThreadPool(int n) {
    printf("pool %d\n", n);
    return 0;
}

int initServer(void) {
    initLogger();
    initThreadPool(4);
    return 0;
}

int cleanupPool(void) {
    printf("cleanup\n");
    return 0;
}

int shutdown(void) {
    cleanupPool();
    return 0;
}

int main(void) {
    initServer();
    handleRequest("GET /");
    shutdown();
    return 0;
}
EOF

  echo "生成调用栈测试源码 sample_cpp_src/PaymentService.java..."
  cat > "$CSTACK_DIR/sample_cpp_src/PaymentService.java" << 'EOF'
// 示例 Java 源码 — 供 tools/callstack/extract_callstack.py 提取函数调用栈
public class PaymentService {
    public void refund(String orderId) {
        OrderDao dao = new OrderDao();
        dao.update(orderId);
        sendNotify(orderId);
    }
    public void sendNotify(String id) {
        System.out.println("notify " + id);
    }
}
EOF

  echo "生成调用栈能力测试源码 cs_ability_test/ability.cpp..."
  cat > "$CSTACK_DIR/cs_ability_test/ability.cpp" << 'EOF'
// 解析能力测试：函数指针 / 回调注册 / 异步任务 / lambda / 虚函数

#include <cstdio>
#include <thread>
#include <functional>

// ── 普通直接调用（应能解析）──
int directA() { printf("a\n"); return 0; }
int directB() { return directA(); }

// ── 函数指针 ──
typedef int (*HandlerFn)(int);
int handlerImpl(int x) { return x + 1; }
void registerHandler(HandlerFn fn) { printf("reg\n"); }
int dispatchFnPtr(int (*fp)(int)) { return fp(42); }   // 间接调用：fp() 目标未知
void useFunctionPointer() {
    registerHandler(handlerImpl);   // 注册回调：能识别"注册"边，但无法追踪实际调用
    HandlerFn h = handlerImpl;
    h(1);                            // 通过指针调用：无法解析到 handlerImpl
}

// ── 异步任务（线程/async）──
int asyncWorker(int n) { return n * 2; }
void launchAsync() {
    std::thread t(asyncWorker, 10);  // 线程回调：参数形式传入，不会建立调用边
    std::async(std::launch::async, asyncWorker, 20);  // 同上
    std::function<int(int)> f = asyncWorker; // std::function 包装
    t.join();
}

// ── lambda ──
int lambdaHolder() {
    auto fn = [](int v) { return v + directA(); };  // lambda 内调用 directA
    return fn(3);
}

// ── 虚函数（多态）──
class Base { public: virtual int run() { return 1; } };
class Derived : public Base { public: int run() override { return directA(); } };
void usePolymorphism(Base* b) { b->run(); }  // 实际调到 Derived::run，静态难确定

int main() {
    directB();
    useFunctionPointer();
    launchAsync();
    lambdaHolder();
    Derived d;
    usePolymorphism(&d);
    return 0;
}
EOF

  echo "生成 Doxygen dot 测试数据 doxygen_demo/callgraph_main.dot..."
  cat > "$CSTACK_DIR/doxygen_demo/callgraph_main.dot" << 'EOF'
digraph "main"
{
  fontname="Helvetica"; fontsize="10";
  node [shape=box, fontname="Helvetica", fontsize="10"];
  "main" [label="main()"];
  "initServer()" [label="initServer()"];
  "dbConnect()" [label="dbConnect()"];
  "handleRequest()" [label="handleRequest()"];
  "parseHeaders()" [label="parseHeaders()"];
  "getOrder()" [label="getOrder()"];
  "orderFromCache()" [label="orderFromCache()"];
  "cacheGet()" [label="cacheGet()"];
  "main" -> "initServer()";
  "main" -> "handleRequest()";
  "initServer()" -> "dbConnect()";
  "handleRequest()" -> "parseHeaders()";
  "handleRequest()" -> "getOrder()";
  "getOrder()" -> "orderFromCache()";
  "orderFromCache()" -> "cacheGet()";
}
EOF

  echo "生成 perf script 测试数据 perf_demo.script..."
  cat > "$CSTACK_DIR/perf_demo.script" << 'EOF'
# 模拟 perf script 输出（叶子函数在最浅缩进，往深是调用者）
myprog  12345 [001] 1700000.001: cycles:
        ffffffff810013aa worker+0x10 (/home/u/prog)
        ffffffff810013bb launchAsync (/home/u/prog)
        ffffffff810013cc main (/home/u/prog)
myprog  12345 [001] 1700000.002: cycles:
        ffffffff810013aa worker (/home/u/prog)
        ffffffff810013bb launchAsync (/home/u/prog)
        ffffffff810013cc main (/home/u/prog)
myprog  12345 [001] 1700000.003: cycles:
        ffffffff810013aa handlerImpl (/home/u/prog)
        ffffffff810013bb useFunctionPointer (/home/u/prog)
        ffffffff810013cc main (/home/u/prog)
myprog  12345 [001] 1700000.004: cycles:
        ffffffff810013aa directA (/home/u/prog)
        ffffffff810013bb directB (/home/u/prog)
        ffffffff810013cc main (/home/u/prog)
EOF

  echo "生成调用栈示例 callstack_demo.txt..."
  cat > "$CSTACK_DIR/callstack_demo.txt" << 'EOF'
# 项目函数调用栈（由 tools/callstack/extract_callstack.py 生成）
# 源码目录: test/samples/callstack/sample_cpp_src
# 函数数: 11  调用边数: 11
main
  initServer
    initLogger
    initThreadPool
  handleRequest
    parseHeaders
    queryDatabase
      connectDb
    sendResponse
  shutdown
    cleanupPool
refund
  sendNotify
EOF

  echo "生成 perf 调用栈示例 perf_callstack_demo.txt..."
  cat > "$CSTACK_DIR/perf_callstack_demo.txt" << 'EOF'
# 程序运行调用栈（由 perf 动态采集，tools/callstack/perf_to_callstack.py 转换）
# 采样栈数: 4  总调用次数: 4  调用边数: 6
main
  launchAsync
    worker
  useFunctionPointer
    handlerImpl
  directB
    directA
EOF

  echo "生成 Doxygen 调用栈示例 doxygen_callstack_demo.txt..."
  cat > "$CSTACK_DIR/doxygen_callstack_demo.txt" << 'EOF'
# Doxygen 调用图（由 tools/callstack/doxygen_callstack.py 转换）
# 函数数: 8  调用边数: 7
main
  initServer
    dbConnect
  handleRequest
    parseHeaders
    getOrder
      orderFromCache
        cacheGet
EOF

  echo "✅ 调用栈测试数据已生成到 $CSTACK_DIR"
}
