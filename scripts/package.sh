#!/usr/bin/env bash
# 打包项目文件到 output 目录
# 用法:
#   ./scripts/package.sh                    -> output/weblogviewer.tar.gz
#   ./scripts/package.sh v1.0.0             -> output/v1.0.0/weblogviewer.tar.gz
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/output"
PACKAGE_NAME="weblogviewer"

VERSION="${1:-}"

if [ -n "$VERSION" ]; then
    TARGET_DIR="$OUTPUT_DIR/$VERSION"
else
    TARGET_DIR="$OUTPUT_DIR"
fi

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
    --exclude='LICENSE' \
    --exclude='.index.html' \
    --exclude='.server.py' \
    index.html \
    server.py \
    css/ \
    lib/ \
    js/ \

FILE_SIZE=$(du -h "$PACKAGE_FILE" | cut -f1)
echo "  完成: $PACKAGE_FILE ($FILE_SIZE)"
