#!/usr/bin/env bash
# 生成 PR 测试用的小样本日志文件
# 用法:
#   bash test/generate_samples.sh            # 自动检查已有数据，无效则重新生成
#   bash test/generate_samples.sh --force    # 强制重新生成
#   bash test/generate_samples.sh --check    # 仅校验不生成
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLES_DIR="$ROOT_DIR/test/samples"
FORCE=false
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --check) CHECK_ONLY=true ;;
  esac
done

# 定义期望的样本：文件名、预期行数（用两个并行数组，兼容 bash 3）
SAMPLE_FILES=(log4j.log log4j2.log bracket.log json.log syslog.log multiline.log)
SAMPLE_LINES=(7 3 5 3 3 5)

# ===== 校验已有数据 =====
validate_samples() {
  local all_valid=true
  local idx=0

  if [ ! -d "$SAMPLES_DIR" ]; then
    echo "  样本目录不存在"
    return 1
  fi

  for fname in "${SAMPLE_FILES[@]}"; do
    fpath="$SAMPLES_DIR/$fname"
    expected_lines="${SAMPLE_LINES[$idx]}"

    if [ ! -f "$fpath" ]; then
      echo "  缺少文件: $fname"
      all_valid=false
      ((idx++)) || true
      continue
    fi

    actual_lines=$(wc -l < "$fpath" | tr -d ' ')
    if [ "$actual_lines" -ne "$expected_lines" ]; then
      echo "  $fname: 预期 $expected_lines 行, 实际 $actual_lines 行"
      all_valid=false
    fi
    ((idx++)) || true
  done

  $all_valid && return 0 || return 1
}

# ===== 清理 =====
clean_samples() {
  echo "清理旧样本..."
  for fname in "${SAMPLE_FILES[@]}"; do
    fpath="$SAMPLES_DIR/$fname"
    if [ -f "$fpath" ]; then
      rm "$fpath"
      echo "  删除 $fname"
    fi
  done
  # 清理孤立文件（不在 SAMPLE_FILES 中的 .log 文件）
  for f in "$SAMPLES_DIR"/*.log; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    local found=false
    for known in "${SAMPLE_FILES[@]}"; do
      if [ "$base" = "$known" ]; then found=true; break; fi
    done
    if [ "$found" = false ]; then
      rm "$f"
      echo "  删除孤立文件 $base"
    fi
  done
}

# ===== 生成 =====
do_generate() {
  mkdir -p "$SAMPLES_DIR"

  echo "生成 Log4j 样本..."
  cat > "$SAMPLES_DIR/log4j.log" << 'EOF'
2025-06-28 10:15:23,456 INFO  [http-nio-8080-exec-1] com.example.web.UserController - 用户登录成功 userId=42
2025-06-28 10:15:23,789 WARN  [http-nio-8080-exec-2] com.example.service.OrderService - 订单超时 orderId=1001
2025-06-28 10:15:24,123 ERROR [http-nio-8080-exec-3] com.example.dao.UserDao - 数据库连接失败: Connection refused
2025-06-28 10:15:24,456 DEBUG [scheduling-1] com.example.cache.RedisCacheManager - Cache hit for key: user_42
2025-06-28 10:15:24,789 FATAL [main] com.example.config.SecurityConfig - 安全配置初始化失败: Invalid key
2025-06-28 10:15:25,112 TRACE [async-task-1] com.example.util.HttpClientUtil - Request completed in 45ms
2025-06-28 10:15:25,456 INFO  [mq-consumer-1] com.example.mq.MessageConsumer - 消息已处理 msgId=abc123
EOF
  echo "  -> log4j.log (7 行)"

  echo "生成 Log4j2 样本..."
  cat > "$SAMPLES_DIR/log4j2.log" << 'EOF'
2025-06-28 10:20:00,111 INFO  [main][12345] com.example.App - Application started
2025-06-28 10:20:01,222 WARN  [http-nio-8080-exec-1][67890] com.example.config - 配置项 deprecated.key 已废弃
2025-06-28 10:20:02,333 ERROR [scheduling-1][11111] com.example.service.TaskRunner - 定时任务执行失败
EOF
  echo "  -> log4j2.log (3 行)"

  echo "生成 Bracket 样本..."
  cat > "$SAMPLES_DIR/bracket.log" << 'EOF'
[2025-06-28 10:30:00,123 +0800][ERROR][1234][567][DB][com.example.dao.UserDao] 数据库查询超时: SELECT * FROM users WHERE id = ?
[2025-06-28 10:30:00,456 +0800][INFO][1234][568][WEB-API][com.example.web.UserController] Request GET /api/users completed in 120ms
[2025-06-28 10:30:00,789 +0800][WARN][1234][569][CACHE][com.example.cache.RedisCacheManager] 缓存连接重建
[2025-06-28 10:30:01,234 +0800][DEBUG][1235][570][MQ][com.example.mq.MessageConsumer] 消息消费开始 msgId=xyz789
[2025-06-28 10:30:01,567 +0800][FATAL][1235][571][SYSTEM][com.example.config.DatabaseConfig] 数据库连接池耗尽!
EOF
  echo "  -> bracket.log (5 行)"

  echo "生成 JSON 样本..."
  cat > "$SAMPLES_DIR/json.log" << 'EOF'
{"timestamp":"2025-06-28T10:40:00.123Z","level":"INFO","logger":"com.example.web.UserController","thread":"main","message":"服务启动成功"}
{"timestamp":"2025-06-28T10:40:01.456Z","level":"ERROR","logger":"com.example.dao.UserDao","thread":"http-nio-1","message":"查询失败","error":"TimeoutException"}
{"timestamp":"2025-06-28T10:40:02.789Z","level":"WARN","logger":"com.example.cache.CacheManager","thread":"scheduler-1","message":"缓存刷新耗时过长: 5000ms"}
EOF
  echo "  -> json.log (3 行)"

  echo "生成 Syslog 样本..."
  cat > "$SAMPLES_DIR/syslog.log" << 'EOF'
Jun 28 10:50:00 webserver sshd[1234]: Failed password for root from 192.168.1.100 port 22 ssh2
Jun 28 10:50:01 db-primary mysqld[5678]: [Warning] Aborted connection 42 to db: 'app' user: 'admin' host: '10.0.0.1'
Jun 28 10:50:02 app-01 nginx[9012]: 10.0.0.2 - - [28/Jun/2025:10:50:02 +0800] "GET /api/health HTTP/1.1" 200 123
EOF
  echo "  -> syslog.log (3 行)"

  echo "生成 Multiline 样本..."
  cat > "$SAMPLES_DIR/multiline.log" << 'EOF'
2025-06-28 11:00:00,000 ERROR [http-nio-1] com.example.web.ApiController - 请求处理异常
java.lang.NullPointerException: 用户信息为空
	at com.example.web.ApiController.getUser(ApiController.java:42)
	at com.example.web.ApiController.handleRequest(ApiController.java:25)
2025-06-28 11:00:01,000 INFO [main] com.example.App - 后续请求正常
EOF
  echo "  -> multiline.log (5 行原始 / 2 条独立日志)"

  echo "✅ 测试样本已生成到 $SAMPLES_DIR"
}

# ===== 主流程 =====
echo "校验测试样本..."

if [ "$CHECK_ONLY" = true ]; then
  if validate_samples; then
    echo "  所有样本验证通过 ✅"
    exit 0
  else
    echo "  样本校验失败"
    exit 1
  fi
fi

if [ "$FORCE" = true ]; then
  echo "  强制重新生成..."
  clean_samples
  echo ""
  do_generate
  exit 0
fi

if validate_samples; then
  echo "  样本数据完整有效，跳过生成 ✅"
  exit 0
else
  echo ""
  echo "  样本数据无效，清理后重新生成..."
  clean_samples
  echo ""
  do_generate
fi
