#!/usr/bin/env bash
# common.sh — generate_samples.sh 的公共配置（source 使用）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAMPLES_DIR="$ROOT_DIR/test/samples"
