#!/usr/bin/env zsh
# ============================================================================
# Web Log Viewer 下载/更新工具 (zsh)
#
# 从 GitHub Releases 自动下载最新版本资产并解压到当前目录。
# 支持自动检测系统代理，适用于 macOS（默认 shell）与安装了 zsh 的 Linux。
#
# 用法:
#   ./update-tool.zsh                             # 默认仓库 Mindasy/web_log_viewer
#   ./update-tool.zsh owner/repo                  # 指定仓库
#   ./update-tool.zsh owner/repo asset.tar.gz     # 指定资产名
# ============================================================================
setopt err_exit pipefail

REPO="${1:-Mindasy/web_log_viewer}"
ASSET_NAME="${2:-weblogviewer.tar.gz}"
EXTRACT_DIR="${ASSET_NAME%.tar.gz}"
[[ "$EXTRACT_DIR" == "$ASSET_NAME" ]] && EXTRACT_DIR="${ASSET_NAME%.tgz}"
API_URL="${WLV_API_URL:-https://api.github.com/repos/${REPO}/releases/latest}"
TMPDIR="${TMPDIR:-/tmp}"
JSON_FILE="${TMPDIR}/wlv_release_$$.json"
TMP_FILE="${TMPDIR}/wlv_asset_$$"
UA="Mozilla/5.0 (update-tool.zsh)"

# --- 终端颜色（非 tty 时关闭）---
if [[ -t 1 ]]; then
    C_INFO=$'\033[0;36m'; C_OK=$'\033[0;32m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'; C_RESET=$'\033[0m'
else
    C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_RESET=''
fi
_info() { print -r -- "${C_INFO}$*${C_RESET}"; }
_ok()   { print -r -- "${C_OK}$*${C_RESET}"; }
_warn() { print -r -- "${C_WARN}$*${C_RESET}"; }
_err()  { print -r -- "${C_ERR}$*${C_RESET}" >&2; }

# --- 自动检测系统代理 ---
# 优先级: 环境变量 > macOS 系统设置 (scutil) > Linux GNOME 设置 (gsettings)
detect_proxy() {
    local p host port
    local -a candidates
    candidates=("$HTTPS_PROXY" "$https_proxy" "$HTTP_PROXY" "$http_proxy")
    for p in $candidates; do
        [[ -n "$p" ]] && { print -r -- "$p"; return 0; }
    done
    if (( $+commands[scutil] )); then
        host=$(scutil --proxy 2>/dev/null | awk '/HTTPSProxy/ {print $3; exit}')
        port=$(scutil --proxy 2>/dev/null | awk '/HTTPSPort/ {print $3; exit}')
        if [[ -n "$host" ]]; then
            print -r -- "http://${host}:${port:-80}"
            return 0
        fi
    fi
    if (( $+commands[gsettings] )); then
        if [[ "$(gsettings get org.gnome.system.proxy mode 2>/dev/null | tr -d "'")" == "manual" ]]; then
            host=$(gsettings get org.gnome.system.proxy.http host 2>/dev/null | tr -d "'")
            port=$(gsettings get org.gnome.system.proxy.http port 2>/dev/null)
            if [[ -n "$host" ]]; then
                print -r -- "http://${host}:${port:-80}"
                return 0
            fi
        fi
    fi
    return 1
}

if PROXY=$(detect_proxy); then
    export http_proxy="$PROXY" https_proxy="$PROXY" HTTP_PROXY="$PROXY" HTTPS_PROXY="$PROXY"
    _info "[Proxy] 使用系统代理: $PROXY"
else
    _info "[Proxy] 未检测到系统代理，将直连。"
fi
echo

_info "仓库:      $REPO"
_info "目标资产:  $ASSET_NAME"
echo

# --- 依赖检查 ---
(( $+commands[curl] )) || { _err "[ERROR] 未找到 curl，请先安装（macOS 自带）"; exit 1; }
(( $+commands[tar]  )) || { _err "[ERROR] 未找到 tar，请先安装"; exit 1; }

# --- 清理旧文件 ---
_info "[清理] 移除旧资产: $ASSET_NAME"
rm -f "$ASSET_NAME" 2>/dev/null || true
_info "[清理] 移除旧解压目录: $EXTRACT_DIR/"
rm -rf "$EXTRACT_DIR" 2>/dev/null || true
echo

# --- 获取最新 release 信息 ---
_info "[API] 获取最新版本信息: $API_URL"
if ! curl -fsSL \
        -H "Accept: application/vnd.github.v3+json" \
        -H "User-Agent: $UA" \
        "$API_URL" -o "$JSON_FILE"; then
    _err "[ERROR] 获取 release 信息失败，请检查网络"
    _err "[HINT] 可手动测试: curl -v \"$API_URL\""
    exit 1
fi

if grep -q '"message"' "$JSON_FILE"; then
    _err "[ERROR] GitHub API 返回错误（可能触发限流）:"
    grep '"message"' "$JSON_FILE" | head -1
    rm -f "$JSON_FILE"
    exit 1
fi

# --- 解析资产下载 URL ---
if (( $+commands[python3] )); then
    DOWNLOAD_URL=$(python3 - "$JSON_FILE" "$ASSET_NAME" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
for a in data.get('assets', []):
    if a.get('name') == sys.argv[2]:
        print(a.get('browser_download_url', ''))
        break
PY
)
else
    DOWNLOAD_URL=$(grep -o '"browser_download_url": *"[^"]*"' "$JSON_FILE" \
        | sed 's/.*"http/http/; s/"$//' \
        | grep -F "/$ASSET_NAME" | head -1)
fi

if [[ -z "$DOWNLOAD_URL" ]]; then
    _err "[ERROR] 最新版本中未找到资产: $ASSET_NAME"
    _err "可用资产:"
    if (( $+commands[python3] )); then
        python3 - "$JSON_FILE" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
for a in data.get('assets', []):
    print('  -', a.get('name'))
PY
    else
        grep -o '"name": *"[^"]*"' "$JSON_FILE" | sed 's/.*"name": *"//; s/"$//' | sed 's/^/  - /'
    fi
    rm -f "$JSON_FILE"
    exit 1
fi

_info "下载地址: $DOWNLOAD_URL"
echo

# --- 下载资产 ---
_info "[下载] 正在下载..."
if ! curl -fSL -o "$TMP_FILE" "$DOWNLOAD_URL"; then
    _err "[ERROR] 下载失败"
    rm -f "$JSON_FILE" "$TMP_FILE"
    exit 1
fi

# --- 解压 ---
mkdir -p "$EXTRACT_DIR"
case "$ASSET_NAME" in
    *.zip)
        (( $+commands[unzip] )) || { _err "[ERROR] 需要 unzip 解压 zip 资产"; exit 1; }
        _info "[解压] 解压 zip 到 ./$EXTRACT_DIR/"
        unzip -qo "$TMP_FILE" -d "$EXTRACT_DIR"
        ;;
    *)
        _info "[解压] 解压 tar.gz 到 ./$EXTRACT_DIR/"
        tar -xzf "$TMP_FILE" -C "$EXTRACT_DIR"
        ;;
esac

# --- 清理临时文件 ---
rm -f "$JSON_FILE" "$TMP_FILE"

echo
_ok "[SUCCESS] 已下载并解压到 ./$EXTRACT_DIR/"
_info "启动方式: cd $EXTRACT_DIR && python3 server.py 然后访问 http://localhost:8765"
