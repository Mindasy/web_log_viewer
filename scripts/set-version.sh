#!/usr/bin/env bash
# 从 git tag 或命令行参数更新 APP_VERSION
# 用法:
#   ./scripts/set-version.sh              # 自动从最近的 git tag 读取
#   ./scripts/set-version.sh 1.2.3        # 手动指定版本号
#   ./scripts/set-version.sh v1.2.3       # 支持 v 前缀
#   ./scripts/set-version.sh 1.2.3-bugfix-1  # 提取 1.2.3
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UTILS_FILE="$ROOT_DIR/js/utils.js"

VERSION="${1:-}"

# 没有参数时，尝试从 git tag 获取
if [ -z "$VERSION" ]; then
    if git -C "$ROOT_DIR" rev-parse --git-dir > /dev/null 2>&1; then
        VERSION=$(git -C "$ROOT_DIR" describe --tags --abbrev=0 2>/dev/null || git -C "$ROOT_DIR" describe --tags 2>/dev/null || echo "")
    fi
    if [ -z "$VERSION" ]; then
        echo "❌ 未指定版本号，且无法从 git tag 获取"
        echo "用法: $0 [版本号]"
        exit 1
    fi
fi

# 去除 v 前缀
VERSION="${VERSION#v}"

# 提取 x.y.z 前缀（支持 1.2.3-bugfix-1 → 1.2.3）
if echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
    VERSION=$(echo "$VERSION" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+')
else
    echo "⚠️  版本号格式不符合 semver（期望 x.y.z），仍将继续: $VERSION"
fi

# 替换 APP_VERSION
if sed -i '' "s/^const APP_VERSION = '.*';/const APP_VERSION = '$VERSION';/" "$UTILS_FILE" 2>/dev/null; then
    :
else
    sed -i "s/^const APP_VERSION = '.*';/const APP_VERSION = '$VERSION';/" "$UTILS_FILE"
fi

echo "✅ APP_VERSION 已更新为: $VERSION"
echo "   文件: $UTILS_FILE"
