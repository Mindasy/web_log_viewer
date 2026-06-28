#!/usr/bin/env bash
# validate.sh — PR 验证入口
# 用法:
#   bash test/validate.sh              # 完整检查
#   bash test/validate.sh --fast       # 跳过服务器测试
#   bash test/validate.sh --force      # 强制重新生成样本后验证
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🔍 Web Log Viewer PR 验证"
echo ""

# 1. 校验并生成测试样本（generate_samples.sh 内部会检查完整性）
bash "$ROOT_DIR/test/generate_samples.sh" "$@"
echo ""

# 2. 运行验证（过滤掉 --force 等 generate 专用参数）
PYTHON_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --force|--check) ;;
    *) PYTHON_ARGS+=("$arg") ;;
  esac
done
python3 "$ROOT_DIR/test/validate.py" "${PYTHON_ARGS[@]}"
