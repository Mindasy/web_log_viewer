#!/bin/bash
# collect_perf_callstack.sh — Linux 一键采集程序真实调用栈并生成调用栈文件
#
# 用法:
#   bash tools/callstack/collect_perf_callstack.sh ./myprog [程序参数...]
#   bash tools/callstack/collect_perf_callstack.sh --output out.txt ./myprog arg1 arg2
#   bash tools/callstack/collect_perf_callstack.sh --freq 199 ./myprog
#
# 原理: perf record -g 采样 → perf script 展开 → perf_to_callstack.py 转调用树
# 依赖: linux perf（sudo）、python3、带 -g 调试符号编译的程序
# 提示: 函数指针 / 异步 / 虚函数等运行时调用关系会被完整捕获

set -e
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$ROOT_DIR/example/perf_callstack.txt"
FREQ=99
PERF_DATA=$(mktemp -t perf.data.XXXXXX)
PERF_SCRIPT=$(mktemp -t perf.script.XXXXXX)
trap 'rm -f "$PERF_DATA" "$PERF_SCRIPT"' EXIT

# 解析参数
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --output) OUTPUT="$2"; shift 2;;
    --freq) FREQ="$2"; shift 2;;
    --) shift; break;;
    *) ARGS+=("$1"); shift;;
  esac
done

if [ ${#ARGS[@]} -eq 0 ]; then
  echo "用法: bash tools/callstack/collect_perf_callstack.sh [--output 输出文件] [--freq 频率] <可执行文件> [参数...]"
  exit 1
fi

echo "== 采样运行 (perf record -F $FREQ -g) =="
perf record -F "$FREQ" -g -o "$PERF_DATA" -- "${ARGS[@]}"

echo "== 展开调用栈 (perf script) =="
perf script -i "$PERF_DATA" > "$PERF_SCRIPT"

echo "== 转换为调用栈文件 =="
python3 "$ROOT_DIR/tools/callstack/perf_to_callstack.py" --perf-script "$PERF_SCRIPT" --output "$OUTPUT"
echo "== 完成: $OUTPUT =="
