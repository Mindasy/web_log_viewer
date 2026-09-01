#!/usr/bin/env bash
# generate_samples.sh — 生成 PR 测试用的小样本文件
# 用法:
#   bash test/generate_samples.sh            # 自动检查已有数据，无效则重新生成
#   bash test/generate_samples.sh --force    # 强制重新生成
#   bash test/generate_samples.sh --check    # 仅校验不生成
#
# 按功能拆分（test/samples_gen/）：
#   log_samples.sh         — 6 种日志格式样本
#   callstack_samples.sh   — 调用栈测试数据
#   source_samples.sh      — 源码关联测试数据
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/samples_gen/common.sh"
source "$SCRIPT_DIR/samples_gen/log_samples.sh"
source "$SCRIPT_DIR/samples_gen/callstack_samples.sh"
source "$SCRIPT_DIR/samples_gen/source_samples.sh"

FORCE=false
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --check) CHECK_ONLY=true ;;
  esac
done

# ===== 主流程 =====
echo "校验测试样本..."

if [ "$FORCE" = true ]; then
  echo "  强制重新生成..."
  clean_samples
  clean_callstack_samples
  clean_source_samples
  echo ""
  do_generate
  do_generate_callstack
  do_generate_source
  exit 0
fi

if [ "$CHECK_ONLY" = true ]; then
  if validate_samples && validate_callstack_samples && validate_source_samples; then
    echo "  所有样本验证通过 ✅"
    exit 0
  else
    echo "  样本校验失败"
    exit 1
  fi
fi

if validate_samples && validate_callstack_samples && validate_source_samples; then
  echo "  样本数据完整有效，跳过生成 ✅"
  exit 0
else
  echo ""
  echo "  样本数据无效，清理后重新生成..."
  clean_samples
  clean_callstack_samples
  clean_source_samples
  echo ""
  do_generate
  do_generate_callstack
  do_generate_source
fi
