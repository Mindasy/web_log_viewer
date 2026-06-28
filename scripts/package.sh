#!/usr/bin/env bash
# 打包项目文件到 output 目录
# 用法:
#   ./scripts/package.sh                    -> output/weblogviewer.tar.gz（版本来自 git tag）
#   ./scripts/package.sh v1.0.0             -> output/v1.0.0/weblogviewer.tar.gz
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/output"
PACKAGE_NAME="weblogviewer"
UTILS_FILE="$ROOT_DIR/js/utils.js"

VERSION="${1:-}"

# 保存原始 APP_VERSION，打包后恢复
ORIG_VERSION=$(grep "^const APP_VERSION = " "$UTILS_FILE" | sed "s/^const APP_VERSION = '\(.*\)';/\1/")

# 确保在任何退出路径上都恢复版本号
cleanup() {
    if sed -i '' "s/^const APP_VERSION = '.*';/const APP_VERSION = '$ORIG_VERSION';/" "$UTILS_FILE" 2>/dev/null; then
        :
    else
        sed -i "s/^const APP_VERSION = '.*';/const APP_VERSION = '$ORIG_VERSION';/" "$UTILS_FILE"
    fi
    echo "↩️  APP_VERSION 已恢复为: $ORIG_VERSION"
}
trap cleanup EXIT

# 先用版本号更新 APP_VERSION
"$ROOT_DIR/scripts/set-version.sh" ${VERSION:+"$VERSION"}

# 从 git tag 读取版本（不含 v 前缀）用于目录命名
if [ -z "$VERSION" ]; then
    VERSION=$(git -C "$ROOT_DIR" describe --tags --abbrev=0 2>/dev/null || echo "dev")
fi
VERSION="${VERSION#v}"
TAG_DIR="v$VERSION"

TARGET_DIR="$OUTPUT_DIR/$TAG_DIR"
mkdir -p "$TARGET_DIR"

PACKAGE_FILE="$TARGET_DIR/${PACKAGE_NAME}.tar.gz"

echo "打包项目文件..."
echo "  源目录: $ROOT_DIR"
echo "  输出文件: $PACKAGE_FILE"

tar -czf "$PACKAGE_FILE" \
    -C "$ROOT_DIR" \
    --exclude='.git' \
    --exclude='.gitignore' \
    --exclude='output' \
    --exclude='example' \
    --exclude='scripts' \
    --exclude='*.zip' \
    --exclude='*.log' \
    --exclude='.DS_Store' \
    --exclude='.github' \
    index.html \
    server.py \
    css/ \
    doc/ \
    lib/ \
    js/ \

FILE_SIZE=$(du -h "$PACKAGE_FILE" | cut -f1)
echo "  完成: $PACKAGE_FILE ($FILE_SIZE)"
