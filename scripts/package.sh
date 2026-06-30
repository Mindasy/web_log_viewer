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

# 用 Python 替换文件中的常量值（跨平台兼容，避免 sed 差异）
_replace_const() {
    local name="$1" value="$2" file="$3"
    python3 -c "
import re
with open('$file') as f: content = f.read()
content = re.sub(r\"^const $name = '.*';\", \"const $name = '$value';\", content, count=1, flags=re.MULTILINE)
with open('$file', 'w') as f: f.write(content)
"
}

_read_const() {
    local name="$1" file="$2"
    python3 -c "
import re
with open('$file') as f:
    m = re.search(r\"^const $name = '(.*)';\", f.read(), re.MULTILINE)
    print(m.group(1) if m else '')
"
}

# 保存原始 APP_VERSION 和 APP_BUILD_TIME，打包后恢复
ORIG_VERSION=$(_read_const "APP_VERSION" "$UTILS_FILE")
ORIG_BUILD_TIME=$(_read_const "APP_BUILD_TIME" "$UTILS_FILE")

# 确保在任何退出路径上都恢复
cleanup() {
    _replace_const "APP_VERSION" "$ORIG_VERSION" "$UTILS_FILE"
    _replace_const "APP_BUILD_TIME" "$ORIG_BUILD_TIME" "$UTILS_FILE"
    echo "↩️  APP_VERSION 已恢复为: $ORIG_VERSION"
    echo "↩️  APP_BUILD_TIME 已恢复为: $ORIG_BUILD_TIME"
}
trap cleanup EXIT

# 注入构建时间
BUILD_TIME=$(date "+%Y/%m/%d %H:%M:%S")
_replace_const "APP_BUILD_TIME" "$BUILD_TIME" "$UTILS_FILE"
echo "📦 APP_BUILD_TIME 已注入为: $BUILD_TIME"

# 用版本号更新 APP_VERSION
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
