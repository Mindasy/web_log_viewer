#!/usr/bin/env bash
# validate.sh — PR 验证入口
# 用法:
#   bash test/validate.sh              # 完整检查
#   bash test/validate.sh --fast       # 跳过服务器测试
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🔍 Web Log Viewer PR 验证"
echo ""

# 1. 生成测试样本（如尚未生成）
if [ ! -d "$ROOT_DIR/test/samples" ] || [ -z "$(ls -A "$ROOT_DIR/test/samples" 2>/dev/null)" ]; then
    echo "生成测试样本..."
    bash "$ROOT_DIR/test/generate_samples.sh"
    echo ""
fi

# 2. 运行验证
python3 "$ROOT_DIR/test/validate.py" "$@"
