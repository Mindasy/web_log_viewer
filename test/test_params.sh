#!/usr/bin/env bash
# 测试 validate.sh 的所有参数组合
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

clean() { rm -rf "$ROOT_DIR/test/samples"; }

check() {
  local desc="$1"
  local want="$2"
  shift 2
  local args=()
  while [ $# -gt 0 ]; do args+=("$1"); shift; done

  echo -n "  ⏳ $desc ... "

  clean
  set +e
  if [ ${#args[@]} -gt 0 ]; then
    bash "$ROOT_DIR/test/validate.sh" "${args[@]}" > /tmp/vt.log 2>&1
  else
    bash "$ROOT_DIR/test/validate.sh" > /tmp/vt.log 2>&1
  fi
  local got=$?
  set -e

  if [ "$got" = "$want" ]; then
    echo "OK (exit $got)"
    PASS=$((PASS+1))
  else
    echo "FAIL - want exit $want, got exit $got"
    head -12 /tmp/vt.log
    FAIL=$((FAIL+1))
  fi
}

echo "======================"
echo " validate.sh 参数测试"
echo "======================"

clean

echo ""
echo "--- 正常场景 ---"
check "无参数" 0
check "--fast" 0
"$ROOT_DIR/test/generate_samples.sh" >/dev/null 2>&1
check "--fast (已有样本)" 0

echo ""
echo "--- 生成控制 ---"
check "--force" 0
check "--check (无样本)" 1
"$ROOT_DIR/test/generate_samples.sh" >/dev/null 2>&1
check "--check (有样本)" 0

clean
check "--force --check (冲突)" 0
check "--check --force (颠倒)" 0

echo ""
echo "--- 组合参数 ---"
check "--force --fast" 0
"$ROOT_DIR/test/generate_samples.sh" >/dev/null 2>&1
check "--force --fast (已有样本)" 0

echo ""
echo "--- 边界参数 ---"
check "--force --force" 0
"$ROOT_DIR/test/generate_samples.sh" >/dev/null 2>&1
check "--fast --fast" 0

echo ""
echo "--- 异常参数 ---"
check "--undefined" 2
check "--help" 0

echo ""
echo "============"
echo " $PASS pass, $FAIL fail"
echo "============"

rm -f /tmp/vt.log
exit $FAIL
