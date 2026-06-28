#!/usr/bin/env bash
# validate.sh — PR 验证入口
# 用法:
#   bash test/validate.sh                    # 完整检查
#   bash test/validate.sh --fast             # 跳过服务器测试
#   bash test/validate.sh --force            # 强制重新生成样本后验证
#   bash test/validate.sh --check            # 仅校验样本完整性
#   bash test/validate.sh --help             # 显示帮助
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 已知合法参数
VALID_ARGS="--fast --force --check --help --server"

# ===== 参数校验 =====
for arg in "$@"; do
  case " $VALID_ARGS " in
    *" $arg "*)
      # 合法参数
      ;;
    *)
      echo "❌ 未知参数: $arg"
      echo "用法: bash test/validate.sh [--fast] [--force] [--check] [--server] [--help]"
      exit 2
      ;;
  esac
done

# ===== 帮助 =====
for arg in "$@"; do
  if [ "$arg" = "--help" ]; then
    echo "Web Log Viewer 项目验证工具"
    echo ""
    echo "用法:"
    echo "  bash test/validate.sh                    # 完整验证"
    echo "  bash test/validate.sh --fast             # 跳过服务器冒烟测试"
    echo "  bash test/validate.sh --force            # 强制重新生成样本并验证"
    echo "  bash test/validate.sh --check            # 仅校验样本完整性"
    echo "  bash test/validate.sh --server           # 仅启动测试服务器"
    echo "  bash test/validate.sh --help             # 显示此帮助"
    echo ""
    echo "测试内容:"
    echo "  • HTML 结构     — 标签闭合、关键元素存在性"
    echo "  • CSS 结构      — 花括号平衡、双主题变量"
    echo "  • JS 结构       — 文件存在性、引用完整性"
    echo "  • 日志解析      — 6种格式样本对抗性测试"
    echo "  • 服务器冒烟    — HTTP 200、页面渲染、资源可访问"
    exit 0
  fi
done

echo "🔍 Web Log Viewer PR 验证"
echo ""

# 1. 校验并生成测试样本
bash "$ROOT_DIR/test/generate_samples.sh" "$@"
echo ""

# 2. 运行验证（过滤掉 generate 专用参数）
PYTHON_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --force|--check) ;;
    *) PYTHON_ARGS+=("$arg") ;;
  esac
done
python3 "$ROOT_DIR/test/validate.py" ${PYTHON_ARGS[@]+"${PYTHON_ARGS[@]}"}
